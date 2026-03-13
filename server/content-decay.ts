/**
 * Content Refresh / Decay Engine
 * Monitors published page performance via GSC, flags decaying content (clicks drop >30%
 * over 60 days), generates AI refresh recommendations.
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from './data-dir.js';
import { getAllGscPages } from './search-console.js';
import { callOpenAI } from './openai-helpers.js';
import { buildSeoContext } from './seo-context.js';
import type { Workspace } from './workspaces.js';

const DECAY_DIR = getDataDir('content-decay');

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

// ── Storage ──

function getFile(workspaceId: string): string {
  return path.join(DECAY_DIR, `${workspaceId}.json`);
}

export function loadDecayAnalysis(workspaceId: string): DecayAnalysis | null {
  try {
    const f = getFile(workspaceId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch { /* fresh */ }
  return null;
}

function saveDecayAnalysis(analysis: DecayAnalysis): void {
  fs.writeFileSync(getFile(analysis.workspaceId), JSON.stringify(analysis, null, 2));
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

    decayingPages.push({
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
    });
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
  const seoContext = await buildSeoContext(ws.id, page.page);

  const prompt = `You are an SEO content strategist. A page on this site is experiencing content decay — declining search performance.

Page: ${page.page}
Click decline: ${page.clickDeclinePct}% (from ${page.previousClicks} to ${page.currentClicks} clicks/month)
Impression change: ${page.impressionChangePct}%
Position change: ${page.positionChange > 0 ? '+' : ''}${page.positionChange} (now ${page.currentPosition})

${seoContext ? `SEO Context:\n${seoContext}\n` : ''}

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
        console.error(`[content-decay] Failed to generate recommendation for ${page.page}:`, err);
        page.refreshRecommendation = 'Unable to generate recommendation. Please review this page manually.';
      }
    }
  }

  saveDecayAnalysis(analysis);
  return analysis;
}
