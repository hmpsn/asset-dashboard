/**
 * Recommendation Engine
 * 
 * Analyzes audit data, traffic, and keyword strategy to produce
 * prioritized, actionable recommendations for each workspace.
 * 
 * Priority tiers:
 *   fix_now   — Critical issues on high-traffic pages (errors, broken redirects, missing titles)
 *   fix_soon  — Important issues that affect rankings (warnings on key pages, missing schema)
 *   fix_later — Minor issues on low-traffic pages, cosmetic improvements
 *   ongoing   — Content gaps, keyword opportunities, continuous optimization
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db from './db/index.js';
import { getWorkspace, updatePageState, getPageIdBySlug } from './workspaces.js';
import type { Workspace, QuickWin, ContentGap } from './workspaces.js';
import { getLatestSnapshot } from './reports.js';
import type { AuditSnapshot } from './reports.js';
import { getAllGscPages } from './search-console.js';
import { getGA4TopPages } from './google-analytics.js';

// ─── Types ────────────────────────────────────────────────────────

export type { RecPriority, RecType, RecStatus, RecActionType, Recommendation, RecommendationSet } from '../shared/types/recommendations.ts';
import type { RecPriority, RecType, RecStatus, RecActionType, Recommendation, RecommendationSet } from '../shared/types/recommendations.ts';
import { createLogger } from './logger.js';

const log = createLogger('recommendations');

interface TrafficMap {
  [path: string]: { clicks: number; impressions: number; sessions: number; pageviews: number };
}

// ─── Storage ──────────────────────────────────────────────────────

interface RecSetRow {
  workspace_id: string;
  generated_at: string;
  recommendations: string;
  summary: string;
}

interface RecStmts {
  select: ReturnType<typeof db.prepare>;
  upsert: ReturnType<typeof db.prepare>;
}

let _recStmts: RecStmts | null = null;
function recStmts(): RecStmts {
  if (!_recStmts) {
    _recStmts = {
      select: db.prepare(
        `SELECT * FROM recommendation_sets WHERE workspace_id = ?`,
      ),
      upsert: db.prepare(
        `INSERT INTO recommendation_sets (workspace_id, generated_at, recommendations, summary)
         VALUES (@workspace_id, @generated_at, @recommendations, @summary)
         ON CONFLICT(workspace_id) DO UPDATE SET
           generated_at = @generated_at, recommendations = @recommendations, summary = @summary`,
      ),
    };
  }
  return _recStmts;
}

export function loadRecommendations(workspaceId: string): RecommendationSet | null {
  const row = recStmts().select.get(workspaceId) as RecSetRow | undefined;
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    generatedAt: row.generated_at,
    recommendations: JSON.parse(row.recommendations),
    summary: JSON.parse(row.summary),
  };
}

export function saveRecommendations(set: RecommendationSet): void {
  recStmts().upsert.run({
    workspace_id: set.workspaceId,
    generated_at: set.generatedAt,
    recommendations: JSON.stringify(set.recommendations),
    summary: JSON.stringify(set.summary),
  });
}

export function updateRecommendationStatus(
  workspaceId: string,
  recId: string,
  status: RecStatus
): Recommendation | null {
  const set = loadRecommendations(workspaceId);
  if (!set) return null;
  const rec = set.recommendations.find(r => r.id === recId);
  if (!rec) return null;
  rec.status = status;
  rec.updatedAt = new Date().toISOString();
  saveRecommendations(set);
  return rec;
}

export function dismissRecommendation(workspaceId: string, recId: string): boolean {
  return updateRecommendationStatus(workspaceId, recId, 'dismissed') !== null;
}

// ─── Traffic Fetching ─────────────────────────────────────────────

async function fetchTrafficMap(ws: Workspace): Promise<TrafficMap> {
  const trafficMap: TrafficMap = {};

  if (ws.gscPropertyUrl) {
    try {
      const gscPages = await getAllGscPages(ws.id, ws.gscPropertyUrl, 28);
      for (const p of gscPages) {
        try {
          const pagePath = new URL(p.page).pathname;
          if (!trafficMap[pagePath]) trafficMap[pagePath] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
          trafficMap[pagePath].clicks += p.clicks;
          trafficMap[pagePath].impressions += p.impressions;
        } catch { /* skip */ }
      }
    } catch { /* GSC unavailable */ }
  }

  if (ws.ga4PropertyId) {
    try {
      const ga4Pages = await getGA4TopPages(ws.ga4PropertyId, 28, 500);
      for (const p of ga4Pages) {
        const pagePath = p.path.startsWith('/') ? p.path : `/${p.path}`;
        if (!trafficMap[pagePath]) trafficMap[pagePath] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
        trafficMap[pagePath].pageviews += p.pageviews;
        trafficMap[pagePath].sessions += p.users;
      }
    } catch { /* GA4 unavailable */ }
  }

  return trafficMap;
}

// ─── Scoring Helpers ──────────────────────────────────────────────

/** Critical SEO checks that warrant "Fix Now" when on high-traffic pages */
const CRITICAL_CHECKS = new Set([
  'title', 'meta-description', 'canonical', 'h1', 'robots',
  'duplicate-title', 'mixed-content', 'ssl', 'robots-txt',
  'redirect-chains', 'redirects',
  'aeo-author', 'aeo-answer-first', 'aeo-trust-pages',
]);

function isCriticalCheck(check: string): boolean {
  return CRITICAL_CHECKS.has(check);
}

function getTrafficScore(traffic: TrafficMap, slug: string): number {
  const t = traffic[`/${slug}`] || traffic[slug];
  if (!t) return 0;
  return t.clicks * 2 + t.impressions * 0.1 + t.pageviews;
}

function getTrafficForSlug(traffic: TrafficMap, slug: string): { clicks: number; impressions: number } {
  const t = traffic[`/${slug}`] || traffic[slug] || { clicks: 0, impressions: 0 };
  return { clicks: t.clicks, impressions: t.impressions };
}

/** Compute a 0–100 impact score for a recommendation */
function computeImpactScore(
  severity: 'error' | 'warning' | 'info',
  isCritical: boolean,
  trafficScore: number,
  maxTrafficScore: number,
): number {
  // Severity base: error=60, warning=35, info=15
  const sevBase = severity === 'error' ? 60 : severity === 'warning' ? 35 : 15;
  // Critical bonus: +20
  const critBonus = isCritical ? 20 : 0;
  // Traffic multiplier: 0–20 based on relative traffic
  const trafficMultiplier = maxTrafficScore > 0
    ? (trafficScore / maxTrafficScore) * 20
    : 0;
  return Math.min(100, Math.round(sevBase + critBonus + trafficMultiplier));
}

/** Determine priority tier from impact score and severity */
function determinePriority(
  impactScore: number,
  severity: 'error' | 'warning' | 'info',
  trafficScore: number,
): RecPriority {
  if (impactScore >= 70 || (severity === 'error' && trafficScore > 0)) return 'fix_now';
  if (impactScore >= 45 || severity === 'error') return 'fix_soon';
  if (impactScore >= 20) return 'fix_later';
  return 'fix_later';
}

/** Map check name to recommendation type */
function checkToRecType(check: string, category?: string): RecType {
  const chk = check.toLowerCase();
  if (chk.startsWith('aeo-')) return 'aeo';
  if (chk.includes('meta') || chk.includes('title') || chk.includes('description')) return 'metadata';
  if (chk.includes('schema') || chk.includes('structured')) return 'schema';
  if (chk.includes('img-alt') || chk.includes('alt')) return 'accessibility';
  if (chk.includes('cwv') || chk.includes('performance') || chk.includes('speed')) return 'performance';
  if (category === 'content') return 'content';
  return 'technical';
}

/** Map issue type to purchasable product */
function mapToProduct(recType: RecType, pageCount: number): { productType?: string; productPrice?: number } {
  switch (recType) {
    case 'metadata':
      return pageCount >= 10
        ? { productType: 'fix_meta_10', productPrice: 179 }
        : { productType: 'fix_meta', productPrice: 20 };
    case 'schema':
      return pageCount >= 10
        ? { productType: 'schema_10', productPrice: 299 }
        : { productType: 'schema_page', productPrice: 39 };
    case 'accessibility':
      return { productType: 'fix_alt', productPrice: 50 };
    case 'aeo':
      return pageCount >= 5
        ? { productType: 'aeo_site_review', productPrice: 499 }
        : { productType: 'aeo_page_review', productPrice: 99 };
    default:
      return {};
  }
}

// ─── Insight Text Generators ──────────────────────────────────────

function auditInsight(
  check: string,
  _severity: string,
  affectedCount: number,
  trafficAtRisk: number,
): string {
  const chk = check.toLowerCase();
  const hasTraffic = trafficAtRisk > 0;
  const trafficStr = trafficAtRisk >= 1000
    ? `${(trafficAtRisk / 1000).toFixed(1)}k`
    : trafficAtRisk.toString();

  if (chk.includes('title')) {
    return hasTraffic
      ? `${affectedCount} pages with title issues are receiving ${trafficStr} organic clicks/mo. The title tag is the #1 factor in whether someone clicks your result in Google — fixing these will directly improve CTR.`
      : `${affectedCount} pages have title tag issues. This is the single most visible element in search results and directly controls click-through rates.`;
  }
  if (chk.includes('meta-description') || chk.includes('meta')) {
    return hasTraffic
      ? `${affectedCount} pages with metadata issues drive ${trafficStr} clicks/mo. Well-crafted meta descriptions can increase CTR by 5-10% — that's significant traffic you're leaving on the table.`
      : `${affectedCount} pages need metadata optimization. Google displays your meta description in search results — generic or missing descriptions mean lower click-through rates.`;
  }
  if (chk.includes('h1')) {
    return `${affectedCount} pages have H1 heading issues. The H1 is a strong ranking signal that tells Google what your page is about — missing or duplicate H1s confuse search engines.`;
  }
  if (chk.includes('canonical')) {
    return `${affectedCount} pages have canonical tag issues. Without proper canonicals, Google may see duplicate content and dilute your rankings across multiple URLs.`;
  }
  if (chk.includes('structured') || chk.includes('schema')) {
    return hasTraffic
      ? `${affectedCount} pages getting ${trafficStr} clicks/mo lack structured data. Adding schema markup can unlock rich snippets (stars, FAQs, breadcrumbs) which typically boost CTR by 20-30%.`
      : `${affectedCount} pages are missing structured data. Schema markup enables rich snippets in Google — the enhanced listings that stand out and get significantly more clicks.`;
  }
  if (chk.includes('img-alt') || chk.includes('alt')) {
    return `${affectedCount} pages have images missing alt text. This affects both Google Image Search visibility and accessibility compliance — two quick wins from a single fix.`;
  }
  if (chk.includes('redirect')) {
    return `Redirect chains slow page loads and dilute link equity — each hop loses ~10-15% of the SEO value being passed through. Cleaning these up is a quick technical win.`;
  }
  if (chk.includes('ssl') || chk.includes('mixed-content')) {
    return `Security issues directly affect rankings — Google uses HTTPS as a ranking signal. Mixed content warnings also erode user trust and can trigger browser warnings.`;
  }
  if (chk.includes('og-tags') || chk.includes('og-image')) {
    return `${affectedCount} pages are missing Open Graph tags. When shared on social media, these pages won't display a proper preview — reducing click-through from social channels.`;
  }
  // AEO-specific insights
  if (chk === 'aeo-author') {
    return hasTraffic
      ? `${affectedCount} pages receiving ${trafficStr} clicks/mo lack author attribution. AI answer engines (ChatGPT, Perplexity, Google AI Overviews) strongly prefer citing content with named, credentialed authors — especially for health, finance, and legal topics.`
      : `${affectedCount} pages are missing author bylines or reviewer attribution. AI systems treat anonymous content as less trustworthy and are less likely to cite it in generated answers.`;
  }
  if (chk === 'aeo-date') {
    return hasTraffic
      ? `${affectedCount} pages with ${trafficStr} clicks/mo have no visible "last updated" date. AI systems deprioritize undated content because they can't verify freshness — adding dates is a quick trust signal.`
      : `${affectedCount} pages are missing visible dates. LLMs and AI answer engines use recency as a ranking signal — undated content gets deprioritized in AI-generated answers.`;
  }
  if (chk === 'aeo-answer-first') {
    return hasTraffic
      ? `${affectedCount} pages driving ${trafficStr} clicks/mo open with generic intros instead of direct answers. AI systems extract the first substantive paragraph as the cited snippet — burying the answer below fluff means you won't get cited.`
      : `${affectedCount} pages start with "Welcome to…" or similar generic intros instead of directly answering the search query. Restructuring to answer-first layout makes content extractable by LLM retrievers.`;
  }
  if (chk === 'aeo-faq-no-schema') {
    return `${affectedCount} pages have FAQ-style content but no FAQPage schema markup. This is a low-hanging win — adding FAQPage JSON-LD enables rich snippets in Google AND makes Q&A pairs directly extractable by AI answer engines.`;
  }
  if (chk === 'aeo-hidden-content') {
    return `${affectedCount} pages hide significant content behind accordions, tabs, or collapsed sections. LLMs typically read only what's visible in the initial HTML — critical information in hidden elements won't get cited.`;
  }
  if (chk === 'aeo-citations') {
    return hasTraffic
      ? `${affectedCount} pages receiving ${trafficStr} clicks/mo lack external citations to authoritative sources. AI systems prefer citing pages that themselves cite primary sources (.gov, .edu, journals, professional associations) — it's a chain-of-trust signal.`
      : `${affectedCount} pages have no outbound links to authoritative sources. Content without citations appears less credible to AI systems — adding references to journals, .gov, .edu, or industry associations increases citation likelihood.`;
  }
  if (chk === 'aeo-dark-patterns') {
    return `${affectedCount} pages contain aggressive popups, autoplay media, or interstitials. AI retrieval systems downrank pages with dark patterns because they signal low-quality user experience.`;
  }
  if (chk === 'aeo-trust-pages') {
    return `Your site is missing essential trust pages (/about, /contact). AI systems use the presence of trust pages as a site-level credibility signal — especially for YMYL (Your Money or Your Life) topics like health, finance, and legal.`;
  }
  if (chk.includes('cwv') || chk.includes('performance')) {
    return hasTraffic
      ? `Core Web Vitals issues on pages driving ${trafficStr} clicks/mo. Google uses page experience as a ranking factor — slow pages lose both rankings and visitors.`
      : `Core Web Vitals issues detected. Page speed is a direct Google ranking factor and impacts user experience — slow pages have higher bounce rates.`;
  }
  return `${affectedCount} page${affectedCount !== 1 ? 's' : ''} affected. Fixing this will improve your site's overall SEO health score and search engine compatibility.`;
}

function strategyInsight(type: 'content_gap' | 'quick_win' | 'keyword_gap', item: ContentGap | QuickWin): string {
  if (type === 'quick_win') {
    const qw = item as QuickWin;
    return `Quick win on ${qw.pagePath}: ${qw.action}. ${qw.rationale}`;
  }
  if (type === 'content_gap') {
    const cg = item as ContentGap;
    return `Content opportunity: "${cg.topic}" targeting "${cg.targetKeyword}". ${cg.rationale}`;
  }
  return '';
}

// ─── Main Engine ──────────────────────────────────────────────────

export async function generateRecommendations(workspaceId: string): Promise<RecommendationSet> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const now = new Date().toISOString();
  const recs: Recommendation[] = [];
  const tier = ws.tier || 'free';
  const assignedTo: 'team' | 'client' = tier === 'premium' ? 'team' : 'client';

  // ── Fetch data sources ──
  const audit: AuditSnapshot | null = ws.webflowSiteId ? getLatestSnapshot(ws.webflowSiteId) : null;
  const traffic = await fetchTrafficMap(ws);
  const strategy = ws.keywordStrategy;

  // Compute max traffic score for normalization
  let maxTrafficScore = 1;
  if (audit) {
    for (const page of audit.audit.pages) {
      const ts = getTrafficScore(traffic, page.slug);
      if (ts > maxTrafficScore) maxTrafficScore = ts;
    }
  }

  // ── 1. Audit-based recommendations ──
  if (audit) {
    // Group issues by check type across pages
    const issueGroups: Map<string, {
      check: string;
      severity: 'error' | 'warning' | 'info';
      category?: string;
      pages: { slug: string; pageTitle: string; message: string; recommendation: string }[];
      totalTrafficScore: number;
      totalClicks: number;
      totalImpressions: number;
    }> = new Map();

    for (const page of audit.audit.pages) {
      for (const issue of page.issues) {
        const key = issue.check;
        if (!issueGroups.has(key)) {
          issueGroups.set(key, {
            check: issue.check,
            severity: issue.severity,
            category: issue.category,
            pages: [] as { slug: string; pageTitle: string; message: string; recommendation: string }[],
            totalTrafficScore: 0,
            totalClicks: 0,
            totalImpressions: 0,
          });
        }
        const group = issueGroups.get(key)!;
        const ts = getTrafficScore(traffic, page.slug);
        const t = getTrafficForSlug(traffic, page.slug);
        group.pages.push({ slug: page.slug, pageTitle: page.slug, message: issue.message, recommendation: issue.recommendation });
        group.totalTrafficScore += ts;
        group.totalClicks += t.clicks;
        group.totalImpressions += t.impressions;
      }
    }

    // Create one recommendation per issue group
    for (const [, group] of issueGroups) {
      const isCrit = isCriticalCheck(group.check);
      const impactScore = computeImpactScore(
        group.severity,
        isCrit,
        group.totalTrafficScore,
        maxTrafficScore * group.pages.length,
      );

      const priority = determinePriority(impactScore, group.severity, group.totalTrafficScore);
      const recType = checkToRecType(group.check, group.category);
      const product = mapToProduct(recType, group.pages.length);

      // Sort affected pages by traffic (highest first)
      const sortedPages = group.pages
        .map(p => ({ ...p, ts: getTrafficScore(traffic, p.slug) }))
        .sort((a, b) => b.ts - a.ts);

      const impact: 'high' | 'medium' | 'low' =
        impactScore >= 60 ? 'high' : impactScore >= 35 ? 'medium' : 'low';
      const effort: 'low' | 'medium' | 'high' =
        recType === 'metadata' || recType === 'accessibility' ? 'low'
        : recType === 'schema' ? 'medium'
        : 'medium';

      const estimatedGain =
        group.totalClicks > 0
          ? `Fixing this could increase organic clicks by 5-15% on ${group.pages.length} affected page${group.pages.length !== 1 ? 's' : ''}`
          : `Improves SEO health score and search engine compatibility across ${group.pages.length} page${group.pages.length !== 1 ? 's' : ''}`;

      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority,
        type: recType,
        title: `${group.check.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — ${group.pages.length} page${group.pages.length !== 1 ? 's' : ''}`,
        description: sortedPages[0].recommendation,
        insight: auditInsight(group.check, group.severity, group.pages.length, group.totalClicks),
        impact,
        effort,
        impactScore,
        source: `audit:${group.check}`,
        affectedPages: sortedPages.map(p => p.slug),
        trafficAtRisk: group.totalClicks,
        impressionsAtRisk: group.totalImpressions,
        estimatedGain,
        actionType: product.productType ? 'purchase' : 'manual',
        productType: product.productType,
        productPrice: product.productPrice,
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Site-wide issues as individual recommendations
    for (const issue of audit.audit.siteWideIssues) {
      const isCrit = isCriticalCheck(issue.check);
      const impactScore = isCrit ? 80 : 50;
      const priority: RecPriority = isCrit ? 'fix_now' : 'fix_soon';

      const pages = issue.affectedPages || [];
      const pageTraffic = pages.reduce((sum, slug) => {
        const t = getTrafficForSlug(traffic, slug.replace(/^\//, ''));
        return sum + t.clicks;
      }, 0);
      const pageImpressions = pages.reduce((sum, slug) => {
        const t = getTrafficForSlug(traffic, slug.replace(/^\//, ''));
        return sum + t.impressions;
      }, 0);

      const estimatedGain = pages.length > 0
        ? `Affects ${pages.length} page${pages.length !== 1 ? 's' : ''} on the site`
        : 'Affects the entire site';

      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority,
        type: 'technical',
        title: `Site-Wide: ${issue.check.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
        description: issue.recommendation,
        insight: issue.message,
        impact: isCrit ? 'high' : 'medium',
        effort: 'low',
        impactScore,
        source: `audit:site-wide:${issue.check}`,
        affectedPages: pages.map(p => p.replace(/^\//, '')),
        trafficAtRisk: pageTraffic,
        impressionsAtRisk: pageImpressions,
        estimatedGain,
        actionType: 'manual',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // ── 2. Strategy-based recommendations ──
  if (strategy) {
    // Quick wins → fix_now or fix_soon
    if (strategy.quickWins) {
      for (const qw of strategy.quickWins) {
        const t = getTrafficForSlug(traffic, qw.pagePath.replace(/^\//, ''));
        const impactScore = qw.estimatedImpact === 'high' ? 75 : qw.estimatedImpact === 'medium' ? 55 : 35;
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: qw.estimatedImpact === 'high' ? 'fix_now' : 'fix_soon',
          type: 'strategy',
          title: `Quick Win: ${qw.action}`,
          description: qw.rationale,
          insight: strategyInsight('quick_win', qw),
          impact: qw.estimatedImpact as 'high' | 'medium' | 'low',
          effort: 'low',
          impactScore,
          source: 'strategy:quick-win',
          affectedPages: [qw.pagePath.replace(/^\//, '')],
          trafficAtRisk: t.clicks,
          impressionsAtRisk: t.impressions,
          estimatedGain: `${qw.estimatedImpact} impact potential based on current traffic and keyword position`,
          actionType: 'manual',
          status: 'pending',
          assignedTo,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Content gaps → ongoing
    if (strategy.contentGaps) {
      for (const cg of strategy.contentGaps) {
        const impactScore = cg.priority === 'high' ? 65 : cg.priority === 'medium' ? 45 : 25;
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: cg.priority === 'high' ? 'fix_soon' : 'ongoing',
          type: 'content',
          title: `Content Gap: ${cg.topic}`,
          description: cg.rationale,
          insight: strategyInsight('content_gap', cg),
          impact: cg.priority as 'high' | 'medium' | 'low',
          effort: 'high',
          impactScore,
          source: 'strategy:content-gap',
          affectedPages: [],
          trafficAtRisk: 0,
          impressionsAtRisk: 0,
          estimatedGain: `New ${cg.suggestedPageType || 'page'} targeting "${cg.targetKeyword}" (${cg.intent} intent)`,
          actionType: 'content_creation',
          status: 'pending',
          assignedTo,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Pages with declining positions (from page map)
    if (strategy.pageMap) {
      for (const pm of strategy.pageMap) {
        if (pm.currentPosition && pm.currentPosition > 3 && pm.currentPosition <= 20 && pm.impressions && pm.impressions > 100) {
          // Page ranking 4-20 with decent impressions — opportunity to push up
          const impactScore = pm.currentPosition <= 10 ? 60 : 40;
          recs.push({
            id: `rec_${crypto.randomBytes(6).toString('hex')}`,
            workspaceId,
            priority: pm.currentPosition <= 10 ? 'fix_soon' : 'ongoing',
            type: 'strategy',
            title: `Ranking Opportunity: "${pm.primaryKeyword}" (pos ${Math.round(pm.currentPosition)})`,
            description: `${pm.pagePath} ranks #${Math.round(pm.currentPosition)} for "${pm.primaryKeyword}" with ${pm.impressions?.toLocaleString()} impressions. Optimizing this page could push it onto page 1 or into the top 3.`,
            insight: pm.currentPosition <= 10
              ? `This page is on page 1 but not in the top 3. Moving from position ${Math.round(pm.currentPosition)} to top 3 could 2-3x click-through rate.`
              : `This page ranks on page 2 — just outside where most clicks happen. A focused optimization push could move it onto page 1.`,
            impact: pm.currentPosition <= 10 ? 'high' : 'medium',
            effort: 'medium',
            impactScore,
            source: 'strategy:ranking-opportunity',
            affectedPages: [pm.pagePath.replace(/^\//, '')],
            trafficAtRisk: pm.clicks || 0,
            impressionsAtRisk: pm.impressions || 0,
            estimatedGain: `Moving to top 3 could increase clicks by ${Math.round((pm.impressions || 0) * 0.15)} - ${Math.round((pm.impressions || 0) * 0.3)}/mo`,
            actionType: 'manual',
            status: 'pending',
            assignedTo,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
  }

  // ── Merge with existing recommendations ──
  // Preserve statuses from previous run and auto-resolve issues no longer detected
  const existing = loadRecommendations(workspaceId);
  let autoResolved = 0;

  if (existing) {
    // Build lookup: source → existing rec (for audit-based and site-wide recs)
    // For strategy recs, use source + first affected page as key
    const existingByKey = new Map<string, Recommendation>();
    for (const oldRec of existing.recommendations) {
      const key = oldRec.source.startsWith('strategy:')
        ? `${oldRec.source}::${oldRec.affectedPages[0] || oldRec.title}`
        : oldRec.source;
      existingByKey.set(key, oldRec);
    }

    const newSources = new Set<string>();
    for (const newRec of recs) {
      const key = newRec.source.startsWith('strategy:')
        ? `${newRec.source}::${newRec.affectedPages[0] || newRec.title}`
        : newRec.source;
      newSources.add(key);

      // Preserve status from existing rec if it was in_progress or completed
      const oldRec = existingByKey.get(key);
      if (oldRec) {
        if (oldRec.status === 'in_progress' || oldRec.status === 'completed') {
          newRec.status = oldRec.status;
          newRec.id = oldRec.id; // keep same ID for frontend continuity
          newRec.createdAt = oldRec.createdAt;
        } else if (oldRec.status === 'dismissed') {
          newRec.status = 'dismissed';
          newRec.id = oldRec.id;
          newRec.createdAt = oldRec.createdAt;
        }
      }
    }

    // Auto-resolve: old pending/in_progress recs whose source is gone (issue fixed!)
    for (const oldRec of existing.recommendations) {
      if (oldRec.status === 'completed' || oldRec.status === 'dismissed') continue;
      const key = oldRec.source.startsWith('strategy:')
        ? `${oldRec.source}::${oldRec.affectedPages[0] || oldRec.title}`
        : oldRec.source;
      if (!newSources.has(key)) {
        // Issue no longer detected — auto-resolve
        recs.push({
          ...oldRec,
          status: 'completed',
          updatedAt: now,
          insight: `✓ Auto-resolved — this issue is no longer detected in the latest audit. ${oldRec.insight}`,
        });
        autoResolved++;
        // Mark affected pages as live
        if (oldRec.affectedPages && oldRec.affectedPages.length > 0) {
          for (const pageSlug of oldRec.affectedPages) {
            const resolvedPageId = getPageIdBySlug(workspaceId, pageSlug) ?? pageSlug;
            updatePageState(workspaceId, resolvedPageId, {
              status: 'live',
              source: 'recommendation',
              recommendationId: oldRec.id,
            });
          }
        }
      }
    }
  }

  // ── Sort by impact score (highest first within each priority) ──
  recs.sort((a, b) => {
    const priorityOrder: Record<RecPriority, number> = { fix_now: 0, fix_soon: 1, fix_later: 2, ongoing: 3 };
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    return b.impactScore - a.impactScore;
  });

  // ── Build summary (exclude auto-resolved from active counts) ──
  const activeRecs = recs.filter(r => r.status !== 'completed' && r.status !== 'dismissed');
  const summary = {
    fixNow: activeRecs.filter(r => r.priority === 'fix_now').length,
    fixSoon: activeRecs.filter(r => r.priority === 'fix_soon').length,
    fixLater: activeRecs.filter(r => r.priority === 'fix_later').length,
    ongoing: activeRecs.filter(r => r.priority === 'ongoing').length,
    totalImpactScore: activeRecs.reduce((s, r) => s + r.impactScore, 0),
    trafficAtRisk: activeRecs.reduce((s, r) => s + r.trafficAtRisk, 0),
  };

  const set: RecommendationSet = {
    workspaceId,
    generatedAt: now,
    recommendations: recs,
    summary,
  };

  saveRecommendations(set);
  log.info(`Generated ${recs.length} recommendations for ${workspaceId}: ${summary.fixNow} fix-now, ${summary.fixSoon} fix-soon, ${summary.fixLater} fix-later, ${summary.ongoing} ongoing${autoResolved > 0 ? `, ${autoResolved} auto-resolved` : ''}`);

  return set;
}
