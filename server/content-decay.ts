/**
 * Content Refresh / Decay Engine
 * Monitors published page performance via GSC, flags decaying content (clicks drop >30%
 * over 60 days), generates AI refresh recommendations.
 */

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { getAllGscPages } from './search-console.js';
import { callOpenAI } from './openai-helpers.js';
import { buildSeoContext, buildPageAnalysisContext } from './seo-context.js';
import type { Workspace } from './workspaces.js';
import { createLogger } from './logger.js';

const log = createLogger('content-decay');

// ── Types ──

export interface DecayingPage {
  page: string;           // URL path
  title?: string;
  currentClicks: number;
  previousClicks: number;
  clickDeclinePct: number;
  currentImpressions: number;
  previousImpressions: number;
  impressionChangePct: number;
  currentPosition: number;
  previousPosition: number;
  positionChange: number;
  severity: 'critical' | 'warning' | 'watch';
  refreshRecommendation?: string;
}

export interface DecayAnalysis {
  workspaceId: string;
  analyzedAt: string;
  totalPages: number;
  decayingPages: DecayingPage[];
  summary: {
    critical: number;
    warning: number;
    watch: number;
    totalDecaying: number;
    avgDeclinePct: number;
  };
}

// ── SQLite row shape ──

interface DecayRow {
  workspace_id: string;
  analyzed_at: string;
  total_pages: number;
  decaying_pages: string;
  summary: string;
}

const stmts = createStmtCache(() => ({
  select: db.prepare(
    `SELECT * FROM decay_analyses WHERE workspace_id = ?`,
  ),
  upsert: db.prepare(
    `INSERT INTO decay_analyses (workspace_id, analyzed_at, total_pages, decaying_pages, summary)
         VALUES (@workspace_id, @analyzed_at, @total_pages, @decaying_pages, @summary)
         ON CONFLICT(workspace_id) DO UPDATE SET
           analyzed_at = @analyzed_at, total_pages = @total_pages,
           decaying_pages = @decaying_pages, summary = @summary`,
  ),
}));

// ── Storage ──

export function loadDecayAnalysis(workspaceId: string): DecayAnalysis | null {
  const row = stmts().select.get(workspaceId) as DecayRow | undefined;
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    analyzedAt: row.analyzed_at,
    totalPages: row.total_pages,
    decayingPages: JSON.parse(row.decaying_pages),
    summary: JSON.parse(row.summary),
  };
}

function saveDecayAnalysis(analysis: DecayAnalysis): void {
  stmts().upsert.run({
    workspace_id: analysis.workspaceId,
    analyzed_at: analysis.analyzedAt,
    total_pages: analysis.totalPages,
    decaying_pages: JSON.stringify(analysis.decayingPages),
    summary: JSON.stringify(analysis.summary),
  });
}

// ── Analysis Engine ──

export async function analyzeContentDecay(ws: Workspace): Promise<DecayAnalysis> {
  if (!ws.gscPropertyUrl || !ws.webflowSiteId) {
    throw new Error('GSC not configured for this workspace');
  }

  // Get page-level data for current 30 days
  const currentPages = await getAllGscPages(ws.webflowSiteId, ws.gscPropertyUrl, 30);

  // Build map of current period pages
  const currentMap = new Map<string, { clicks: number; impressions: number; ctr: number; position: number }>();
  for (const p of currentPages) {
    try {
      const url = new URL(p.page);
      currentMap.set(url.pathname, { clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position });
    } catch {
      currentMap.set(p.page, { clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position });
    }
  }

  // Get previous period pages (30 days before current 30 days = 60 days ago to 30 days ago)
  const prevPages = await getAllGscPages(ws.webflowSiteId, ws.gscPropertyUrl, 60);
  const prevMap = new Map<string, { clicks: number; impressions: number; position: number }>();
  for (const p of prevPages) {
    try {
      const url = new URL(p.page);
      const path = url.pathname;
      // Only store if not in prevMap yet, or accumulate
      if (!prevMap.has(path)) {
        prevMap.set(path, { clicks: p.clicks, impressions: p.impressions, position: p.position });
      }
    } catch {
      if (!prevMap.has(p.page)) {
        prevMap.set(p.page, { clicks: p.clicks, impressions: p.impressions, position: p.position });
      }
    }
  }

  // Compare: find pages with declining clicks
  const decayingPages: DecayingPage[] = [];

  for (const [pagePath, current] of currentMap) {
    const prev = prevMap.get(pagePath);
    if (!prev || prev.clicks < 5) continue; // Skip pages with no previous data or very low traffic

    const clickDecline = prev.clicks > 0 ? ((current.clicks - prev.clicks) / prev.clicks) * 100 : 0;
    const impressionChange = prev.impressions > 0 ? ((current.impressions - prev.impressions) / prev.impressions) * 100 : 0;
    const positionChange = current.position - prev.position; // positive = worse

    // Only flag pages with meaningful decline
    if (clickDecline >= -10) continue; // Not declining enough

    const severity: DecayingPage['severity'] =
      clickDecline <= -50 ? 'critical' :
      clickDecline <= -30 ? 'warning' : 'watch';

    const decayingPage: DecayingPage = {
      page: pagePath,
      currentClicks: current.clicks,
      previousClicks: prev.clicks,
      clickDeclinePct: Math.round(clickDecline),
      currentImpressions: current.impressions,
      previousImpressions: prev.impressions,
      impressionChangePct: Math.round(impressionChange),
      currentPosition: Math.round(current.position * 10) / 10,
      previousPosition: Math.round(prev.position * 10) / 10,
      positionChange: Math.round(positionChange * 10) / 10,
      severity,
    };

    // ── Bridge #8: Check for repeat_decay ─────────────────────────────
    // If a prior content_refresh action for this page scored 'loss', tag as repeat_decay
    try {
      const { getActionsByPage, getOutcomesForAction } = await import('./outcome-tracking.js');
      const priorActions = getActionsByPage(ws.id, pagePath);
      const refreshActions = priorActions.filter(a => a.actionType === 'content_refresh');
      if (refreshActions.length > 0) {
        for (const action of refreshActions) {
          const outcomes = getOutcomesForAction(action.id);
          const hasLoss = outcomes.some(o => o.score === 'loss');
          if (hasLoss) {
            (decayingPage as any).isRepeatDecay = true;
            (decayingPage as any).priority = 'high';
            break;
          }
        }
      }
    } catch {
      // Non-critical — outcome tracking may not have data for this page
    }

    decayingPages.push(decayingPage);
  }

  // Sort by decline severity
  decayingPages.sort((a, b) => a.clickDeclinePct - b.clickDeclinePct);

  const critical = decayingPages.filter(p => p.severity === 'critical').length;
  const warning = decayingPages.filter(p => p.severity === 'warning').length;
  const watch = decayingPages.filter(p => p.severity === 'watch').length;
  const avgDecline = decayingPages.length > 0
    ? Math.round(decayingPages.reduce((s, p) => s + p.clickDeclinePct, 0) / decayingPages.length)
    : 0;

  const analysis: DecayAnalysis = {
    workspaceId: ws.id,
    analyzedAt: new Date().toISOString(),
    totalPages: currentMap.size,
    decayingPages,
    summary: {
      critical,
      warning,
      watch,
      totalDecaying: decayingPages.length,
      avgDeclinePct: avgDecline,
    },
  };

  saveDecayAnalysis(analysis);
  return analysis;
}

// ── AI Refresh Recommendations ──

export async function generateRefreshRecommendation(
  ws: Workspace,
  page: DecayingPage,
): Promise<string> {
  const { fullContext } = buildSeoContext(ws.id, page.page);
  const pageAnalysis = buildPageAnalysisContext(ws.id, page.page);

  const prompt = `You are an SEO content strategist. A page on this site is experiencing content decay — declining search performance.

Page: ${page.page}
Click decline: ${page.clickDeclinePct}% (from ${page.previousClicks} to ${page.currentClicks} clicks/month)
Impression change: ${page.impressionChangePct}%
Position change: ${page.positionChange > 0 ? '+' : ''}${page.positionChange} (now ${page.currentPosition})

${fullContext ? `SEO Context:\n${fullContext}\n` : ''}${pageAnalysis}

Provide a concise, actionable content refresh plan (3-5 bullet points). Focus on:
1. What's likely causing the decline (algorithm changes, fresher competitors, outdated info)
2. Specific content updates to make (new sections, updated stats, better structure)
3. Technical SEO improvements (title tag, meta description, internal links, schema)
4. Quick wins that could recover traffic within 30 days

Keep each bullet to 1-2 sentences. Be specific to this page's situation.`;

  const result = await callOpenAI({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 500,
    temperature: 0.7,
    feature: 'content-decay',
    workspaceId: ws.id,
  });

  return result.text || 'Unable to generate recommendations.';
}

export async function generateBatchRecommendations(
  ws: Workspace,
  analysis: DecayAnalysis,
  maxPages: number = 5,
): Promise<DecayAnalysis> {
  // Generate recommendations for top decaying pages (critical + warning first)
  const targets = analysis.decayingPages
    .filter(p => p.severity === 'critical' || p.severity === 'warning')
    .slice(0, maxPages);

  for (const page of targets) {
    if (!page.refreshRecommendation) {
      try {
        page.refreshRecommendation = await generateRefreshRecommendation(ws, page);
      } catch (err) {
        log.error({ err: err }, `Failed to generate recommendation for ${page.page}:`);
        page.refreshRecommendation = 'Unable to generate recommendation. Please review this page manually.';
      }
    }
  }

  saveDecayAnalysis(analysis);
  return analysis;
}
