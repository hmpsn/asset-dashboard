/**
 * LLMs.txt Generator — produces an LLMs.txt file for a workspace's site.
 *
 * LLMs.txt is a standard that helps AI models understand a site's structure,
 * purpose, and content. Similar to robots.txt but for LLM consumption.
 *
 * Gathers data from:
 * - Workspace config (name, domain, business context)
 * - Webflow pages (published static + CMS)
 * - Keyword strategy (page assignments, content gaps)
 * - Content matrices (planned pages)
 * - Brand docs (tone, audience)
 */
import { listPages, filterPublishedPages, getSiteSubdomain, discoverCmsUrls, buildStaticPathSet } from './webflow-pages.js';
import { getWorkspace } from './workspaces.js';
import { listMatrices } from './content-matrices.js';
import { listBriefs } from './content-brief.js';
import { listContentRequests } from './content-requests.js';
import { resolvePagePath } from './helpers.js';
import { createLogger } from './logger.js';

const log = createLogger('llms-txt');

// ── Types ──

export interface LlmsTxtPage {
  path: string;
  title: string;
  description?: string;
  pageType?: string;
  keywords?: string[];
}

export interface LlmsTxtResult {
  content: string;
  pageCount: number;
  generatedAt: string;
}

// ── Helpers ──

function slugToTitle(slug: string): string {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Group pages by their top-level path segment (e.g., /blog/*, /services/*).
 */
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

// ── Main generator ──

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
      const token = ws.webflowToken || process.env.WEBFLOW_API_TOKEN;
      const allPages = await listPages(ws.webflowSiteId, token || undefined);
      const published = filterPublishedPages(allPages);

      for (const p of published) {
        const pagePath = resolvePagePath(p);
        pages.push({
          path: pagePath,
          title: p.title || slugToTitle(p.slug || 'Home'),
          description: p.seo?.description || undefined,
        });
      }

      // CMS pages from sitemap
      const subdomain = await getSiteSubdomain(ws.webflowSiteId, token || undefined);
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

  // Enrich with keyword strategy data
  const keywordMap = new Map<string, { keyword: string; intent?: string }>();
  if (ws.keywordStrategy?.pageMap) {
    for (const pm of ws.keywordStrategy.pageMap) {
      const path = pm.pagePath.startsWith('/') ? pm.pagePath : `/${pm.pagePath}`;
      keywordMap.set(path.toLowerCase(), {
        keyword: pm.primaryKeyword || '',
        intent: pm.searchIntent,
      });
    }
  }

  for (const page of pages) {
    const kwData = keywordMap.get(page.path.toLowerCase());
    if (kwData?.keyword) {
      page.keywords = [kwData.keyword];
    }
  }

  // Build the LLMs.txt content
  const lines: string[] = [];

  // Header
  lines.push(`# ${siteName}`);
  lines.push('');

  // Site description
  const businessContext = ws.keywordStrategy?.businessContext;
  if (businessContext) {
    lines.push(`> ${businessContext}`);
    lines.push('');
  }

  if (baseUrl) {
    lines.push(`- Website: ${baseUrl}`);
    lines.push('');
  }

  // Pages grouped by section
  const groups = groupBySection(pages);
  const sectionOrder = Object.keys(groups).sort((a, b) => {
    if (a === '_root') return -1;
    if (b === '_root') return 1;
    return a.localeCompare(b);
  });

  for (const section of sectionOrder) {
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

  // Planned content (from matrices) — with status labels
  const matrices = listMatrices(workspaceId);
  const plannedPages = matrices.flatMap(m =>
    m.cells.filter(c => c.plannedUrl && c.status !== 'published')
      .map(c => ({ url: c.plannedUrl, keyword: c.targetKeyword, status: c.status }))
  );

  if (plannedPages.length > 0) {
    lines.push('## Upcoming Content');
    lines.push('');
    lines.push('> The following pages are planned or in production.');
    lines.push('');

    const statusLabel: Record<string, string> = {
      planned: 'Planned', keyword_validated: 'Planned',
      brief_generated: 'Brief Ready', draft: 'In Draft',
      review: 'In Review', approved: 'Approved',
    };

    for (const p of plannedPages.slice(0, 50)) {
      const url = baseUrl ? `${baseUrl}${p.url.startsWith('/') ? p.url : '/' + p.url}` : p.url;
      const label = statusLabel[p.status] || 'Planned';
      lines.push(`- [${p.keyword}](${url}) — ${label}`);
    }
    if (plannedPages.length > 50) {
      lines.push(`- ... and ${plannedPages.length - 50} more planned pages`);
    }
    lines.push('');
  }

  // Approved / in-progress content requests not already covered by matrix cells
  const matrixKeywords = new Set(plannedPages.map(p => p.keyword.toLowerCase()));
  try {
    const requests = listContentRequests(workspaceId);
    const briefs = listBriefs(workspaceId);
    const briefMap = new Map(briefs.map(b => [b.id, b]));

    const activeRequests = requests.filter(r =>
      ['brief_generated', 'client_review', 'approved', 'in_progress'].includes(r.status) &&
      !matrixKeywords.has((r.targetKeyword || r.topic || '').toLowerCase())
    );

    if (activeRequests.length > 0) {
      lines.push('## Content In Production');
      lines.push('');
      lines.push('> Approved or in-progress content not yet published.');
      lines.push('');

      const statusLabel: Record<string, string> = {
        brief_generated: 'Brief Ready', client_review: 'Client Review',
        approved: 'Approved', in_progress: 'In Progress',
      };

      for (const r of activeRequests.slice(0, 30)) {
        const brief = r.briefId ? briefMap.get(r.briefId) : undefined;
        const title = brief?.suggestedTitle || r.topic || r.targetKeyword || 'Untitled';
        lines.push(`- ${title} — ${statusLabel[r.status] || r.status}`);
      }
      lines.push('');
    }
  } catch { /* non-critical */ }

  const content = lines.join('\n');
  const briefCount = plannedPages.length;

  log.info({ workspaceId, pageCount: pages.length, plannedCount: briefCount }, 'LLMs.txt generated');

  return {
    content,
    pageCount: pages.length + plannedPages.length,
    generatedAt: new Date().toISOString(),
  };
}
