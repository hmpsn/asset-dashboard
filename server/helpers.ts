/**
 * Shared utility functions extracted from server/index.ts.
 * Pure functions with no side effects — safe to import anywhere.
 */
import fs from 'fs';
import path from 'path';
import type { SeoAuditResult } from './seo-audit.js';
import type { SchemaContext } from './schema-suggester.js';
import type { CustomDateRange } from './google-analytics.js';
import { listWorkspaces } from './workspaces.js';
import { getAllGscPages } from './search-console.js';
import { getGA4TopPages } from './google-analytics.js';
import { getUploadRoot } from './data-dir.js';

// ── Page Path Utilities ──

/** Normalize a page path: ensure leading slash, strip trailing slash (keep '/' as-is) */
export function normalizePath(p: string): string {
  const s = p.startsWith('/') ? p : `/${p}`;
  return s.length > 1 && s.endsWith('/') ? s.slice(0, -1) : s;
}

/** Exact path match with trailing-slash normalization */
export function matchPagePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/** Find a pageMap entry by path (exact match with normalization) */
export function findPageMapEntry<T extends { pagePath: string }>(pageMap: T[], path: string): T | undefined {
  const norm = normalizePath(path);
  return pageMap.find(p => normalizePath(p.pagePath) === norm);
}

/** Resolve a Webflow page's canonical path from publishedPath or slug */
export function resolvePagePath(page: { publishedPath?: string | null; slug?: string }): string {
  return page.publishedPath || (page.slug ? `/${page.slug}` : '/');
}

// ── Input Validation ──

/** Sanitize a string field: trim, limit length, strip control characters */
export function sanitizeString(val: unknown, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** Validate that a value is one of the allowed options */
export function validateEnum<T extends string>(val: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(val as T) ? (val as T) : fallback;
}

/** Parse optional startDate/endDate query params into a CustomDateRange (or undefined). */
export function parseDateRange(query: Record<string, unknown>): CustomDateRange | undefined {
  const s = query.startDate as string | undefined;
  const e = query.endDate as string | undefined;
  return (s && e) ? { startDate: s, endDate: e } : undefined;
}

// ── Glob Pattern Matching ──

/** Convert a simple glob pattern to a RegExp. Supports * (any chars) and ? (single char). */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`, 'i');
}

// ── Audit Suppression Helpers ──

// Scoring weights must mirror seo-audit.ts auditPage() exactly
export const CRITICAL_CHECKS_SET = new Set([
  'title', 'meta-description', 'canonical', 'h1', 'robots',
  'duplicate-title', 'mixed-content', 'ssl', 'robots-txt',
]);
export const MODERATE_CHECKS_SET = new Set([
  'content-length', 'heading-hierarchy', 'internal-links', 'img-alt',
  'og-tags', 'og-image', 'link-text', 'url', 'lang', 'viewport',
  'duplicate-description', 'img-filesize', 'html-size',
]);

export interface AuditSuppression { check: string; pageSlug: string; pagePattern?: string; reason?: string; createdAt: string }

export function applySuppressionsToAudit(
  audit: SeoAuditResult,
  suppressions: AuditSuppression[],
): SeoAuditResult {
  if (!suppressions || suppressions.length === 0) return audit;

  // Exact suppressions: "check::pageSlug" → true
  const exactSupps = suppressions.filter(s => !s.pagePattern);
  const suppSet = new Set(exactSupps.map(s => `${s.check}::${s.pageSlug}`));

  // Pattern suppressions: check + glob pattern (e.g. "blog/*", "resources/*")
  const patternSupps = suppressions.filter(s => s.pagePattern);
  const patternMatchers = patternSupps.map(s => ({
    check: s.check,
    regex: globToRegex(s.pagePattern!),
  }));

  let totalErrors = 0, totalWarnings = 0, totalInfos = 0;

  const filteredPages = audit.pages.map(page => {
    const filteredIssues = page.issues.filter(issue => {
      // Exact match
      if (suppSet.has(`${issue.check}::${page.slug}`)) return false;
      // Pattern match
      for (const pm of patternMatchers) {
        if (pm.check === issue.check && pm.regex.test(page.slug)) return false;
      }
      return true;
    });

    // Recalculate page score with remaining issues
    // Weights must mirror audit-page.ts: info=0, softer warning/error deductions
    let score = 100;
    for (const issue of filteredIssues) {
      const isCritical = CRITICAL_CHECKS_SET.has(issue.check);
      const isModerate = MODERATE_CHECKS_SET.has(issue.check);
      if (issue.severity === 'error') {
        score -= isCritical ? 15 : 10;
      } else if (issue.severity === 'warning') {
        score -= isCritical ? 5 : isModerate ? 3 : 2;
      }
      // info severity: no score impact (industry standard)
    }
    score = Math.max(0, Math.min(100, score));

    for (const i of filteredIssues) {
      if (i.severity === 'error') totalErrors++;
      else if (i.severity === 'warning') totalWarnings++;
      else totalInfos++;
    }

    return { ...page, issues: filteredIssues, score };
  });

  // Site-wide issues are not per-page, so they aren't suppressed
  for (const i of audit.siteWideIssues) {
    if (i.severity === 'error') totalErrors++;
    else if (i.severity === 'warning') totalWarnings++;
    else totalInfos++;
  }

  // Exclude noindex pages from site score — they don't affect search rankings
  const indexedPages = filteredPages.filter(p => !p.noindex);
  const siteScore = indexedPages.length > 0
    ? Math.round(indexedPages.reduce((s, r) => s + r.score, 0) / indexedPages.length)
    : 100;

  return {
    siteScore,
    totalPages: filteredPages.length,
    errors: totalErrors,
    warnings: totalWarnings,
    infos: audit.infos !== undefined ? totalInfos : totalInfos,
    pages: filteredPages,
    siteWideIssues: audit.siteWideIssues,
    cwvSummary: audit.cwvSummary,
  };
}

// ── Schema Context Builder ──

export function buildSchemaContext(siteId: string): { ctx: SchemaContext; pageKeywordMap?: { pagePath: string; primaryKeyword: string; secondaryKeywords: string[]; searchIntent?: string }[] } {
  const allWs = listWorkspaces();
  const ws = allWs.find(w => w.webflowSiteId === siteId);
  const ctx: SchemaContext = {};
  if (ws) {
    ctx.companyName = ws.name;
    ctx.liveDomain = ws.liveDomain;
    ctx.brandVoice = ws.brandVoice;
    ctx.businessContext = ws.keywordStrategy?.businessContext;
    ctx.siteKeywords = ws.keywordStrategy?.siteKeywords;
    ctx.logoUrl = ws.brandLogoUrl;
    ctx.workspaceId = ws.id;
    ctx._siteId = siteId;

    // Build knowledge base for schema enrichment (credentials, locations, sameAs URLs, etc.)
    const kbParts: string[] = [];
    if (ws.knowledgeBase?.trim()) kbParts.push(ws.knowledgeBase.trim());
    // Also read knowledge-docs/ folder if it exists
    try {
      const kbDir = path.join(getUploadRoot(), ws.folder, 'knowledge-docs');
      if (fs.existsSync(kbDir)) {
        const kbFiles = fs.readdirSync(kbDir).filter(f => /\.(txt|md)$/i.test(f)).sort();
        let kbContent = '';
        for (const file of kbFiles) {
          const text = fs.readFileSync(path.join(kbDir, file), 'utf-8').trim();
          if (text) kbContent += `--- ${file} ---\n${text}\n\n`;
          if (kbContent.length > 3000) break;
        }
        if (kbContent) kbParts.push(kbContent.slice(0, 3000));
      }
    } catch { /* knowledge-docs not available */ }
    if (kbParts.length > 0) ctx.knowledgeBase = kbParts.join('\n\n').slice(0, 4000);
  }
  const pageKeywordMap = ws?.keywordStrategy?.pageMap?.map(p => ({
    pagePath: p.pagePath,
    primaryKeyword: p.primaryKeyword,
    secondaryKeywords: p.secondaryKeywords || [],
    searchIntent: p.searchIntent,
    topicCluster: p.topicCluster,
    contentGaps: p.contentGaps,
    optimizationScore: p.optimizationScore,
  }));
  return { ctx, pageKeywordMap };
}

// ── Audit Traffic Cache ──

const auditTrafficCache: Record<string, { data: Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>; ts: number }> = {};

export async function getAuditTrafficForWorkspace(ws: { id: string; webflowSiteId?: string; gscPropertyUrl?: string; ga4PropertyId?: string }): Promise<Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }>> {
  if (!ws.webflowSiteId) return {};
  const cacheKey = ws.id;
  const cached = auditTrafficCache[cacheKey];
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data;
  const trafficMap: Record<string, { clicks: number; impressions: number; sessions: number; pageviews: number }> = {};
  if (ws.gscPropertyUrl) {
    try {
      const gscPages = await getAllGscPages(ws.id, ws.gscPropertyUrl, 28);
      for (const p of gscPages) {
        try {
          const urlPath = new URL(p.page).pathname;
          if (!trafficMap[urlPath]) trafficMap[urlPath] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
          trafficMap[urlPath].clicks += p.clicks;
          trafficMap[urlPath].impressions += p.impressions;
        } catch { /* skip */ }
      }
    } catch { /* GSC unavailable */ }
  }
  if (ws.ga4PropertyId) {
    try {
      const ga4Pages = await getGA4TopPages(ws.ga4PropertyId, 28, 500);
      for (const p of ga4Pages) {
        const urlPath = p.path.startsWith('/') ? p.path : `/${p.path}`;
        if (!trafficMap[urlPath]) trafficMap[urlPath] = { clicks: 0, impressions: 0, sessions: 0, pageviews: 0 };
        trafficMap[urlPath].pageviews += p.pageviews;
        trafficMap[urlPath].sessions += p.users;
      }
    } catch { /* GA4 unavailable */ }
  }
  auditTrafficCache[cacheKey] = { data: trafficMap, ts: Date.now() };
  return trafficMap;
}

// ── .env File Helpers ──

const ENV_PATH = path.resolve(process.cwd(), '.env');

export function readEnvFile(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    }
  }
  return vars;
}

export function writeEnvFile(vars: Record<string, string>) {
  const content = Object.entries(vars).map(([k, v]) => `${k}=${v.replace(/[\r\n]/g, '')}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content);
}
