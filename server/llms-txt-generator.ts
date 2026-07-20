/**
 * LLMs.txt Generator — produces two-tier llms.txt + llms-full.txt for a workspace.
 *
 * llms.txt   = index with links + one-line descriptions (lightweight, for discovery)
 * llms-full.txt = full inline AI summaries per page (for deep understanding)
 *
 * Phase 4 improvements:
 * - AI-generated per-page summaries (GPT-4.1)
 * - Two-tier output (index + full)
 * - URL validation (HEAD requests, filters broken links)
 * - Removed 50-page CMS cap (now up to 500)
 * - Summary cache in SQLite for fast re-generation
 */
import { getSiteSubdomain, discoverCmsUrls, buildStaticPathSet } from './webflow-pages.js';
import { MODEL_ROLES } from './model-manifest.js';
import { getWorkspacePages } from './workspace-data.js';
import { getWorkspace } from './workspaces.js';
import { listPageKeywords } from './page-keywords.js';
import { listMatrices } from './content-matrices.js';
import { listBriefs } from './content-brief.js';
import { listContentRequests } from './content-requests.js';
import { resolvePagePath } from './utils/page-address.js';
import { createLogger } from './logger.js';
import { callAI } from './ai.js';
import { STUDIO_BOT_UA } from './constants.js';
import db from './db/index.js';
import { parseJsonSafe } from './db/json-validation.js';
import { createStmtCache } from './db/stmt-cache.js';
import { createHash, randomUUID } from 'crypto';
import { isProgrammingError } from './errors.js';
import { z } from 'zod';
import type { Workspace } from '../shared/types/workspace.js';
import { buildEffectiveBusinessPriorities } from './intelligence/business-priorities-source.js';
import { sanitizeInlinePromptText } from './utils/text.js';

const log = createLogger('llms-txt');

// ── Types ──

export interface LlmsTxtPage {
  path: string;
  title: string;
  description?: string;
  summary?: string;
  pageType?: string;
  keywords?: string[];
}

export interface LlmsTxtResult {
  content: string;
  fullContent: string;
  pageCount: number;
  generatedAt: string;
}

interface PlannedPage {
  url: string;
  keyword: string;
  status: string;
}

// ── Cache Store (SQLite) ──

const cacheStmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO llms_txt_cache (id, workspace_id, page_url, summary)
    VALUES (@id, @workspace_id, @page_url, @summary)
    ON CONFLICT(workspace_id, page_url) DO UPDATE SET
      summary = excluded.summary,
      generated_at = datetime('now')
  `),
  getOne: db.prepare<[workspaceId: string, pageUrl: string]>(
    'SELECT * FROM llms_txt_cache WHERE workspace_id = ? AND page_url = ?',
  ),
  getAll: db.prepare<[workspaceId: string]>(
    'SELECT * FROM llms_txt_cache WHERE workspace_id = ?',
  ),
  deleteOne: db.prepare<[workspaceId: string, pageUrl: string]>(
    'DELETE FROM llms_txt_cache WHERE workspace_id = ? AND page_url = ?',
  ),
  cleanupOld: db.prepare<[daysExpr: string]>(
    `DELETE FROM llms_txt_cache WHERE generated_at < datetime('now', ? || ' days')`,
  ),
}));

interface CacheRow {
  id: string;
  workspace_id: string;
  page_url: string;
  summary: string;
  generated_at: string;
}

const SUMMARY_CACHE_ENVELOPE_PREFIX = 'hmpsn:llms-summary:v1:';

const summaryCacheEnvelopeSchema = z.object({
  version: z.literal(1),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  summary: z.string().min(1),
}).strip();

interface SummaryCacheEnvelope {
  version: 1;
  evidenceHash: string;
  summary: string;
}

interface ParsedCachedSummary {
  summary: string;
  evidenceHash?: string;
}

function serializeCachedSummary(summary: string, evidenceHash?: string): string {
  if (!evidenceHash) return summary;
  const envelope: SummaryCacheEnvelope = {
    version: 1,
    evidenceHash,
    summary,
  };
  return `${SUMMARY_CACHE_ENVELOPE_PREFIX}${JSON.stringify(envelope)}`;
}

function parseCachedSummary(raw: string, workspaceId: string): ParsedCachedSummary | null {
  if (!raw.startsWith(SUMMARY_CACHE_ENVELOPE_PREFIX)) {
    return { summary: raw };
  }

  const envelope = parseJsonSafe(
    raw.slice(SUMMARY_CACHE_ENVELOPE_PREFIX.length),
    summaryCacheEnvelopeSchema,
    null,
    { workspaceId, field: 'summary', table: 'llms_txt_cache' },
  );
  if (!envelope) return null;
  return {
    summary: envelope.summary,
    evidenceHash: envelope.evidenceHash,
  };
}

export function upsertSummary(
  workspaceId: string,
  pageUrl: string,
  summary: string,
  evidenceHash?: string,
) {
  const id = randomUUID();
  cacheStmts().upsert.run({
    id,
    workspace_id: workspaceId,
    page_url: pageUrl,
    summary: serializeCachedSummary(summary, evidenceHash),
  });
}

export function getSummary(workspaceId: string, pageUrl: string) {
  const row = cacheStmts().getOne.get(workspaceId, pageUrl) as CacheRow | undefined;
  if (!row) return null;
  const parsed = parseCachedSummary(row.summary, workspaceId);
  if (!parsed) return null;
  return { ...parsed, generatedAt: row.generated_at };
}

export function getSummaries(workspaceId: string) {
  const rows = cacheStmts().getAll.all(workspaceId) as CacheRow[];
  return rows.flatMap(row => {
    const parsed = parseCachedSummary(row.summary, workspaceId);
    if (!parsed) return [];
    return [{ pageUrl: row.page_url, ...parsed, generatedAt: row.generated_at }];
  });
}

export function deleteSummary(workspaceId: string, pageUrl: string): boolean {
  const result = cacheStmts().deleteOne.run(workspaceId, pageUrl);
  return result.changes > 0;
}

export function cleanupOldLlmsTxt(maxAgeDays: number = 90): number {
  const info = cacheStmts().cleanupOld.run(`-${maxAgeDays}`);
  return info.changes;
}

// ── Stored Result (full blob, served by GET routes) ──

const storedResultStmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO llms_txt_stored_result (workspace_id, content, full_content, page_count, generated_at)
    VALUES (@workspace_id, @content, @full_content, @page_count, @generated_at)
    ON CONFLICT(workspace_id) DO UPDATE SET
      content = excluded.content,
      full_content = excluded.full_content,
      page_count = excluded.page_count,
      generated_at = excluded.generated_at
  `),
  get: db.prepare<[workspaceId: string]>(
    'SELECT content, full_content, page_count, generated_at FROM llms_txt_stored_result WHERE workspace_id = ?',
  ),
}));

interface StoredResultRow {
  content: string;
  full_content: string;
  page_count: number;
  generated_at: string;
}

/** Persist the full generation result so GET routes can serve it without re-crawling. */
export function storeResult(workspaceId: string, result: LlmsTxtResult): void {
  storedResultStmts().upsert.run({
    workspace_id: workspaceId,
    content: result.content,
    full_content: result.fullContent,
    page_count: result.pageCount,
    generated_at: result.generatedAt,
  });
}

/** Return the last stored result, or null if none exists yet. */
export function getStoredResult(workspaceId: string): LlmsTxtResult | null {
  const row = storedResultStmts().get.get(workspaceId) as StoredResultRow | undefined;
  if (!row) return null;
  return {
    content: row.content,
    fullContent: row.full_content,
    pageCount: row.page_count,
    generatedAt: row.generated_at,
  };
}

// ── Freshness Tracking ──

const freshnessStmts = createStmtCache(() => ({
  upsert: db.prepare(`
    INSERT INTO llms_txt_freshness (workspace_id, last_generated_at, trigger)
    VALUES (@workspace_id, @last_generated_at, @trigger)
    ON CONFLICT(workspace_id) DO UPDATE SET
      last_generated_at = excluded.last_generated_at,
      trigger = excluded.trigger
  `),
  get: db.prepare<[workspaceId: string]>(
    'SELECT last_generated_at FROM llms_txt_freshness WHERE workspace_id = ?',
  ),
}));

export function setLastGenerated(workspaceId: string, trigger?: string) {
  freshnessStmts().upsert.run({
    workspace_id: workspaceId,
    last_generated_at: new Date().toISOString(),
    trigger: trigger || null,
  });
}

export function getLastGenerated(workspaceId: string): string | null {
  const row = freshnessStmts().get.get(workspaceId) as { last_generated_at: string } | undefined;
  return row?.last_generated_at ?? null;
}

// ── Background Regeneration ──

/**
 * Queue a background llms.txt regeneration for a workspace.
 * Fire-and-forget — does not block the calling route.
 */
export function queueLlmsTxtRegeneration(workspaceId: string, trigger: string) {
  // Use setImmediate so the calling request completes first
  setImmediate(async () => {
    try {
      log.info({ workspaceId, trigger }, 'Auto-regenerating LLMs.txt');
      const result = await generateLlmsTxt(workspaceId);
      storeResult(workspaceId, result);
      setLastGenerated(workspaceId, trigger);
      log.info({ workspaceId, trigger }, 'LLMs.txt auto-regeneration complete');
    } catch (err) {
      log.warn({ err, workspaceId, trigger }, 'LLMs.txt auto-regeneration failed (non-critical)');
    }
  });
}

// ── Helpers ──

function slugToTitle(slug: string): string {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function groupBySection(pages: LlmsTxtPage[]): Record<string, LlmsTxtPage[]> {
  const groups: Record<string, LlmsTxtPage[]> = {};
  for (const page of pages) {
    const segments = page.path.replace(/^\//, '').split('/');
    const section = segments.length > 1 ? segments[0] : '_root';
    if (!groups[section]) groups[section] = [];
    groups[section].push(page);
  }
  return groups;
}

function sortedSections(groups: Record<string, LlmsTxtPage[]>): string[] {
  return Object.keys(groups).sort((a, b) => {
    if (a === '_root') return -1;
    if (b === '_root') return 1;
    return a.localeCompare(b);
  });
}

// ── URL Validation ──

/**
 * Batch validate URLs with HEAD requests (concurrency-limited).
 * Returns only URLs that respond HTTP 200.
 */
export async function validateUrls(urls: string[], concurrency = 10): Promise<string[]> {
  if (urls.length === 0) return [];
  const valid: string[] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const res = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'User-Agent': STUDIO_BOT_UA },
          });
          clearTimeout(timeout);
          return res.ok ? url : null;
        } catch { // catch-ok: fetch() on external URL — TypeError expected for DNS/TLS failures
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) valid.push(r);
    }
  }

  return valid;
}

// ── AI Summary Generation ──

interface SummaryKeywordContext {
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: string;
}

interface SummaryBusinessContext {
  strategyContext: string;
  industry: string;
  targetAudience: string;
  goals: string[];
  priorities: string[];
}

interface PageSummaryEvidence {
  contractVersion: 1;
  page: {
    url: string;
    title: string;
    metaDescription: string;
  };
  keywordContext: SummaryKeywordContext;
  businessContext: SummaryBusinessContext;
}

function normalizeEvidenceText(value: string | null | undefined): string {
  return sanitizeInlinePromptText(value, 2000);
}

function normalizeEvidenceList(values: readonly string[] | null | undefined): string[] {
  const unique = new Map<string, string>();
  for (const value of values ?? []) {
    const normalized = normalizeEvidenceText(value);
    if (normalized) unique.set(normalized.toLowerCase(), normalized);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
}

function resolveSummaryBusinessContext(workspace: Workspace): SummaryBusinessContext {
  return {
    strategyContext: normalizeEvidenceText(workspace.keywordStrategy?.businessContext),
    industry: normalizeEvidenceText(workspace.intelligenceProfile?.industry),
    targetAudience: normalizeEvidenceText(workspace.intelligenceProfile?.targetAudience),
    goals: normalizeEvidenceList(workspace.intelligenceProfile?.goals),
    priorities: normalizeEvidenceList(buildEffectiveBusinessPriorities(workspace.id)),
  };
}

function buildPageSummaryEvidence(input: {
  url: string;
  title: string;
  description?: string;
  keywordContext?: Partial<SummaryKeywordContext>;
  businessContext: SummaryBusinessContext;
}): PageSummaryEvidence {
  return {
    contractVersion: 1,
    page: {
      url: normalizeEvidenceText(input.url),
      title: normalizeEvidenceText(input.title),
      metaDescription: normalizeEvidenceText(input.description),
    },
    keywordContext: {
      primaryKeyword: normalizeEvidenceText(input.keywordContext?.primaryKeyword),
      secondaryKeywords: normalizeEvidenceList(input.keywordContext?.secondaryKeywords),
      searchIntent: normalizeEvidenceText(input.keywordContext?.searchIntent),
    },
    businessContext: input.businessContext,
  };
}

function hashPageSummaryEvidence(evidence: PageSummaryEvidence): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}

function formatPageSummaryEvidence(evidence: PageSummaryEvidence): string {
  const keywordLines = [
    `- Primary keyword: ${evidence.keywordContext.primaryKeyword || 'None provided'}`,
    `- Secondary keywords: ${evidence.keywordContext.secondaryKeywords.join(', ') || 'None provided'}`,
    `- Search intent: ${evidence.keywordContext.searchIntent || 'None provided'}`,
  ];
  const businessLines = [
    `- Strategy context: ${evidence.businessContext.strategyContext || 'None provided'}`,
    `- Industry: ${evidence.businessContext.industry || 'None provided'}`,
    `- Target audience: ${evidence.businessContext.targetAudience || 'None provided'}`,
    `- Goals: ${evidence.businessContext.goals.join('; ') || 'None provided'}`,
    `- Business priorities: ${evidence.businessContext.priorities.join('; ') || 'None provided'}`,
  ];

  return [
    'Page evidence:',
    `- Title: ${evidence.page.title}`,
    `- URL: ${evidence.page.url}`,
    `- Meta description: ${evidence.page.metaDescription || 'None provided'}`,
    '',
    'Keyword context:',
    ...keywordLines,
    '',
    'Business context:',
    ...businessLines,
    '',
    'Summarize this page in 2-3 sentences.',
  ].join('\n');
}

async function generatePageSummary(
  workspaceId: string,
  evidence: PageSummaryEvidence,
): Promise<string | null> {
  try {
    const result = await callAI({
      model: MODEL_ROLES.utilityExtraction,
      system: 'You are a concise web content summarizer. Summarize the given page in 2-3 sentences for an AI assistant. Capture what the page is about, what services or expertise it represents, and who the target audience is. Use only the supplied page, keyword, and business evidence. Do not infer offerings, audiences, or claims that are not present; omit unsupported details instead. Be factual and precise. Do not use marketing language or Markdown.',
      messages: [{
        role: 'user',
        content: formatPageSummaryEvidence(evidence),
      }],
      maxTokens: 200,
      feature: 'llms-txt-summary',
      workspaceId,
    });
    return result.text.trim() || null;
  } catch (err) {
    log.warn({ err, pageUrl: evidence.page.url }, 'Failed to generate page summary');
    return null;
  }
}

// ── Two-Tier Output Builders (exported for testing) ──

interface IndexInput {
  siteName: string;
  baseUrl: string;
  description?: string;
  pages: LlmsTxtPage[];
  plannedPages: PlannedPage[];
}

export function buildLlmsTxtIndex(input: IndexInput): string {
  const { siteName, baseUrl, description, pages, plannedPages } = input;
  const lines: string[] = [];

  lines.push(`# ${siteName}`);
  lines.push('');

  if (description) {
    lines.push(`> ${description}`);
    lines.push('');
  }

  if (baseUrl) {
    lines.push(`- Website: ${baseUrl}`);
  }
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Pages grouped by section
  const groups = groupBySection(pages);
  for (const section of sortedSections(groups)) {
    const sectionPages = groups[section];
    const sectionTitle = section === '_root' ? 'Main Pages' : slugToTitle(section);

    lines.push(`## ${sectionTitle}`);
    lines.push('');

    for (const page of sectionPages) {
      const url = baseUrl ? `${baseUrl}${page.path}` : page.path;
      const desc = page.description ? `: ${page.description}` : '';
      lines.push(`- [${page.title}](${url})${desc}`);
    }
    lines.push('');
  }

  // Planned content
  if (plannedPages.length > 0) {
    lines.push('## Upcoming Content');
    lines.push('');
    lines.push('> The following pages are planned or in production.');
    lines.push('');

    const statusLabel: Record<string, string> = {
      planned: 'Planned', keyword_validated: 'Planned',
      brief_generated: 'Brief Ready', draft: 'In Draft',
      review: 'In Review', flagged: 'Needs Review', approved: 'Approved',
      client_review: 'Client Review', in_progress: 'In Progress',
    };

    for (const p of plannedPages) {
      const normalizedPath = p.url.startsWith('/') ? p.url : `/${p.url}`;
      const url = baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
      const label = statusLabel[p.status] || 'Planned';
      lines.push(`- [${p.keyword}](${url}) — ${label}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

interface FullInput {
  siteName: string;
  baseUrl: string;
  description?: string;
  pages: Array<{ path: string; title: string; description?: string; summary?: string }>;
}

export function buildLlmsFullTxt(input: FullInput): string {
  const { siteName, baseUrl, description, pages } = input;
  const lines: string[] = [];

  lines.push(`# ${siteName}`);
  lines.push('');

  if (description) {
    lines.push(`> ${description}`);
    lines.push('');
  }

  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Pages grouped by section with inline summaries
  const groups = groupBySection(pages as LlmsTxtPage[]);
  for (const section of sortedSections(groups)) {
    const sectionPages = groups[section];
    const sectionTitle = section === '_root' ? 'Main Pages' : slugToTitle(section);

    lines.push(`## ${sectionTitle}`);
    lines.push('');

    for (const page of sectionPages) {
      const url = baseUrl ? `${baseUrl}${page.path}` : page.path;
      lines.push(`### [${page.title}](${url})`);
      const content = page.summary || page.description || '*No summary available.*';
      lines.push(content);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Main Generator ──

export async function generateLlmsTxt(workspaceId: string): Promise<LlmsTxtResult> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const domain = ws.liveDomain?.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const siteName = ws.name || domain || 'Website';
  const baseUrl = domain ? `https://${domain}` : '';
  const siteDescription = ws.keywordStrategy?.businessContext;
  const summaryBusinessContext = resolveSummaryBusinessContext(ws);

  const pages: LlmsTxtPage[] = [];

  // 1. Webflow static pages
  if (ws.webflowSiteId) {
    try {
      const published = await getWorkspacePages(workspaceId, ws.webflowSiteId);

      for (const p of published) {
        const pagePath = resolvePagePath(p);
        pages.push({
          path: pagePath,
          title: p.title || slugToTitle(p.slug || 'Home'),
          description: p.seo?.description || undefined,
        });
      }

      // CMS pages from sitemap (removed 50-page cap — now up to 500)
      const subdomain = await getSiteSubdomain(ws.webflowSiteId, ws.webflowToken || undefined);
      const sitemapBase = baseUrl || (subdomain ? `https://${subdomain}.webflow.io` : '');
      if (sitemapBase) {
        const staticPaths = buildStaticPathSet(published);
        const { cmsUrls } = await discoverCmsUrls(sitemapBase, staticPaths, 500);
        for (const cms of cmsUrls) {
          pages.push({
            path: cms.path,
            title: cms.pageName,
          });
        }
      }
    } catch (err) {
      log.warn({ err }, 'Failed to fetch pages for LLMs.txt');
    }
  }

  // 2. Enrich with keyword strategy data
  const keywordMap = new Map<string, SummaryKeywordContext>();
  const kwPages = listPageKeywords(ws.id);
  for (const pm of kwPages) {
    const path = pm.pagePath.startsWith('/') ? pm.pagePath : `/${pm.pagePath}`;
    keywordMap.set(path.toLowerCase(), {
      primaryKeyword: pm.primaryKeyword || '',
      secondaryKeywords: pm.secondaryKeywords || [],
      searchIntent: pm.searchIntent || '',
    });
  }
  for (const page of pages) {
    const kwData = keywordMap.get(page.path.toLowerCase());
    if (kwData?.primaryKeyword) page.keywords = [kwData.primaryKeyword];
  }

  // 3. URL validation (filter broken links)
  if (baseUrl && pages.length > 0) {
    try {
      const urlsToCheck = pages.map(p => `${baseUrl}${p.path}`);
      const validUrls = new Set(await validateUrls(urlsToCheck));
      const before = pages.length;
      const filtered = pages.filter(p => validUrls.has(`${baseUrl}${p.path}`));
      if (filtered.length < before) {
        log.info({ removed: before - filtered.length, total: before }, 'Removed broken URLs from LLMs.txt');
      }
      // Replace pages array — only use filtered if we got at least some results
      // (avoid stripping everything if network is down)
      if (filtered.length > 0) {
        pages.length = 0;
        pages.push(...filtered);
      }
    } catch (err) {
      log.warn({ err }, 'URL validation failed, using unvalidated page list');
    }
  }

  // 4. AI summaries (cached)
  const existingCache = new Map(getSummaries(workspaceId).map(summary => [summary.pageUrl, {
    summary: summary.summary,
    evidenceHash: summary.evidenceHash,
  }]));
  const summaryWork = pages.map(page => {
    const url = baseUrl ? `${baseUrl}${page.path}` : page.path;
    const evidence = buildPageSummaryEvidence({
      url,
      title: page.title,
      description: page.description,
      keywordContext: keywordMap.get(page.path.toLowerCase()),
      businessContext: summaryBusinessContext,
    });
    return {
      url,
      evidence,
      evidenceHash: hashPageSummaryEvidence(evidence),
    };
  });
  const needsSummary = summaryWork.filter(item =>
    existingCache.get(item.url)?.evidenceHash !== item.evidenceHash
  );

  // Generate missing summaries in batches of 5
  if (needsSummary.length > 0) {
    log.info({ count: needsSummary.length }, 'Generating AI summaries for LLMs.txt');
    for (let i = 0; i < needsSummary.length; i += 5) {
      const batch = needsSummary.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(item => generatePageSummary(workspaceId, item.evidence))
      );
      for (let j = 0; j < batch.length; j++) {
        const summary = results[j];
        if (summary) {
          upsertSummary(workspaceId, batch[j].url, summary, batch[j].evidenceHash);
          existingCache.set(batch[j].url, {
            summary,
            evidenceHash: batch[j].evidenceHash,
          });
        }
      }
    }
  }

  // Attach summaries to pages
  for (const page of pages) {
    const url = baseUrl ? `${baseUrl}${page.path}` : page.path;
    page.summary = existingCache.get(url)?.summary;
  }

  // 5. Planned content
  const matrices = listMatrices(workspaceId);
  const plannedPages: PlannedPage[] = matrices.flatMap(m =>
    m.cells.filter(c => c.plannedUrl && c.status !== 'published')
      .map(c => ({ url: c.plannedUrl, keyword: c.targetKeyword, status: c.status }))
  );

  // Active content requests
  const matrixKeywords = new Set(plannedPages.map(p => p.keyword.toLowerCase()));
  try {
    const requests = listContentRequests(workspaceId);
    const briefs = listBriefs(workspaceId);
    const briefMap = new Map(briefs.map(b => [b.id, b]));

    const activeRequests = requests.filter(r =>
      ['brief_generated', 'client_review', 'approved', 'in_progress', 'post_review'].includes(r.status) &&
      !matrixKeywords.has((r.targetKeyword || r.topic || '').toLowerCase())
    );

    for (const r of activeRequests.slice(0, 30)) {
      // Skip requests without a targetPageSlug — the llms.txt index is a
      // crawlable link map, and `|| '#'` would emit a markdown entry pointing
      // at the site root with an empty anchor (e.g. `[Title](https://site.com/#)`).
      // That's a broken link from the crawler's perspective and pollutes the
      // index with entries that no LLM can actually fetch. A content request
      // that hasn't been assigned a URL yet isn't ready to be advertised.
      // (The matrix branch above already filters by `c.plannedUrl` truthiness
      // for the same reason.)
      if (!r.targetPageSlug) continue;
      const brief = r.briefId ? briefMap.get(r.briefId) : undefined;
      const title = brief?.suggestedTitle || r.topic || r.targetKeyword || 'Untitled';
      plannedPages.push({
        url: r.targetPageSlug,
        keyword: title,
        status: r.status,
      });
    }
  } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'llms-txt-generator: programming error'); /* non-critical */ }

  // 6. Build both tiers
  const content = buildLlmsTxtIndex({
    siteName,
    baseUrl,
    description: siteDescription,
    pages,
    plannedPages,
  });

  const fullContent = buildLlmsFullTxt({
    siteName,
    baseUrl,
    description: siteDescription,
    pages,
  });

  const generatedAt = new Date().toISOString();

  // Persist freshness timestamp
  try { setLastGenerated(workspaceId, 'manual'); } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'llms-txt-generator: programming error'); /* non-critical */ }

  log.info({ workspaceId, pageCount: pages.length, plannedCount: plannedPages.length, summariesGenerated: needsSummary.length }, 'LLMs.txt generated (two-tier)');

  return {
    content,
    fullContent,
    pageCount: pages.length + plannedPages.length,
    generatedAt,
  };
}
