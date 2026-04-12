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
import { getWorkspacePages } from './workspace-data.js';
import { getWorkspace } from './workspaces.js';
import { listPageKeywords } from './page-keywords.js';
import { listMatrices } from './content-matrices.js';
import { listBriefs } from './content-brief.js';
import { listContentRequests } from './content-requests.js';
import { resolvePagePath } from './helpers.js';
import { createLogger } from './logger.js';
import { callOpenAI } from './openai-helpers.js';
import { STUDIO_BOT_UA } from './constants.js';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { randomUUID } from 'crypto';

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

export function upsertSummary(workspaceId: string, pageUrl: string, summary: string) {
  const id = randomUUID();
  cacheStmts().upsert.run({ id, workspace_id: workspaceId, page_url: pageUrl, summary });
}

export function getSummary(workspaceId: string, pageUrl: string) {
  const row = cacheStmts().getOne.get(workspaceId, pageUrl) as CacheRow | undefined;
  if (!row) return null;
  return { summary: row.summary, generatedAt: row.generated_at };
}

export function getSummaries(workspaceId: string) {
  const rows = cacheStmts().getAll.all(workspaceId) as CacheRow[];
  return rows.map(r => ({ pageUrl: r.page_url, summary: r.summary, generatedAt: r.generated_at }));
}

export function deleteSummary(workspaceId: string, pageUrl: string): boolean {
  const result = cacheStmts().deleteOne.run(workspaceId, pageUrl);
  return result.changes > 0;
}

export function cleanupOldLlmsTxt(maxAgeDays: number = 90): number {
  const info = cacheStmts().cleanupOld.run(`-${maxAgeDays}`);
  return info.changes;
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
      await generateLlmsTxt(workspaceId);
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
        } catch {
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

async function generatePageSummary(title: string, description: string, pageUrl: string): Promise<string> {
  try {
    const result = await callOpenAI({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a concise web content summarizer. Summarize the given page in 2-3 sentences for an AI assistant. Capture: what the page is about, what services/expertise it represents, and who the target audience is. Be factual and precise. Do not use marketing language.',
        },
        {
          role: 'user',
          content: `Page: ${title}\nURL: ${pageUrl}\nMeta description: ${description || 'None'}\n\nSummarize this page in 2-3 sentences.`,
        },
      ],
      maxTokens: 200,
      temperature: 0.3,
      feature: 'llms-txt-summary',
    });
    return result.text.trim();
  } catch (err) {
    log.warn({ err, pageUrl }, 'Failed to generate page summary');
    return description || '';
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
      review: 'In Review', approved: 'Approved',
      client_review: 'Client Review', in_progress: 'In Progress',
    };

    for (const p of plannedPages) {
      const url = baseUrl ? `${baseUrl}${p.url.startsWith('/') ? p.url : '/' + p.url}` : p.url;
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
  const keywordMap = new Map<string, { keyword: string; intent?: string }>();
  const kwPages = listPageKeywords(ws.id);
  for (const pm of kwPages) {
    const path = pm.pagePath.startsWith('/') ? pm.pagePath : `/${pm.pagePath}`;
    keywordMap.set(path.toLowerCase(), { keyword: pm.primaryKeyword || '', intent: pm.searchIntent });
  }
  for (const page of pages) {
    const kwData = keywordMap.get(page.path.toLowerCase());
    if (kwData?.keyword) page.keywords = [kwData.keyword];
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
  const existingCache = new Map(getSummaries(workspaceId).map(s => [s.pageUrl, s.summary]));
  const needsSummary = pages.filter(p => {
    const url = baseUrl ? `${baseUrl}${p.path}` : p.path;
    return !existingCache.has(url);
  });

  // Generate missing summaries in batches of 5
  if (needsSummary.length > 0) {
    log.info({ count: needsSummary.length }, 'Generating AI summaries for LLMs.txt');
    for (let i = 0; i < needsSummary.length; i += 5) {
      const batch = needsSummary.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(p => generatePageSummary(p.title, p.description || '', baseUrl ? `${baseUrl}${p.path}` : p.path))
      );
      for (let j = 0; j < batch.length; j++) {
        const url = baseUrl ? `${baseUrl}${batch[j].path}` : batch[j].path;
        if (results[j]) {
          upsertSummary(workspaceId, url, results[j]);
          existingCache.set(url, results[j]);
        }
      }
    }
  }

  // Attach summaries to pages
  for (const page of pages) {
    const url = baseUrl ? `${baseUrl}${page.path}` : page.path;
    page.summary = existingCache.get(url);
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
      ['brief_generated', 'client_review', 'approved', 'in_progress'].includes(r.status) &&
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
  } catch { /* non-critical */ }

  // 6. Build both tiers
  const businessContext = ws.keywordStrategy?.businessContext;

  const content = buildLlmsTxtIndex({
    siteName,
    baseUrl,
    description: businessContext,
    pages,
    plannedPages,
  });

  const fullContent = buildLlmsFullTxt({
    siteName,
    baseUrl,
    description: businessContext,
    pages,
  });

  const generatedAt = new Date().toISOString();

  // Persist freshness timestamp
  try { setLastGenerated(workspaceId, 'manual'); } catch { /* non-critical */ }

  log.info({ workspaceId, pageCount: pages.length, plannedCount: plannedPages.length, summariesGenerated: needsSummary.length }, 'LLMs.txt generated (two-tier)');

  return {
    content,
    fullContent,
    pageCount: pages.length + plannedPages.length,
    generatedAt,
  };
}
