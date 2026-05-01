/**
 * Cross-page entity graph for schema generation.
 * Pure functions only — no DB, no async, no AI.
 */
import { classifyPage } from './classifier.js';
import type { PageKind } from './classifier.js';
import type { WebflowPage } from '../webflow-pages.js';
import type { CanonicalEntity } from '../../shared/types/schema-plan.js';

export interface SiteContextPage {
  /** URL path segment, e.g. '/services/design' */
  path: string;
  /** Full absolute URL, e.g. 'https://example.com/services/design' */
  url: string;
  kind: PageKind;
  /** Primary schema.org @type, e.g. 'Service' */
  primaryType: string;
  /** Full @id for this page's primary node, e.g. 'https://example.com/services/design#service' */
  id: string;
  /** Path of the closest ancestor hub page, or null */
  parentPath: string | null;
  /** Paths of qualifying child pages (Service, BlogPosting, Article, CaseStudy kinds only).
   *  Sorted: date desc (lastPublished) for dated pages, null-date pages last then alpha. */
  childPaths: string[];
}

export interface SiteContext {
  pages: SiteContextPage[];
  /** Canonical entities from Site Plan, if available; empty array when no plan exists. */
  canonicalEntities: CanonicalEntity[];
}

// Exported so tests can import without going through the implementation.
export { classifyPage };

const CHILD_KINDS = new Set<PageKind>(['Service', 'BlogPosting', 'CaseStudy']);

function kindToIdSuffix(kind: PageKind): string {
  switch (kind) {
    case 'Service': return 'service';
    case 'BlogPosting': return 'article';
    case 'CaseStudy': return 'article';
    case 'BlogIndex': return 'blog';
    case 'ServiceIndex': return 'service';
    case 'CaseStudyIndex': return 'collection';
    default: return 'webpage';
  }
}

/** Derive the canonical path for a page, handling homepage slug variants. */
function derivePath(page: WebflowPage): string {
  if (page.publishedPath) return page.publishedPath;
  const slug = page.slug ?? '';
  if (!slug || slug === 'index' || slug === 'home') return '/';
  return `/${slug}`;
}

/**
 * Build a cross-page entity map from the workspace page list.
 * Pure synchronous function — call once per regenerate-all run.
 *
 * @param pages - Published Webflow pages (from getWorkspacePages)
 * @param baseUrl - Site base URL with no trailing slash
 * @param canonicalEntities - From Site Plan; empty array when no plan exists
 */
export function assembleSiteContext(
  pages: WebflowPage[],
  baseUrl: string,
  canonicalEntities: CanonicalEntity[] = [],
): SiteContext {
  baseUrl = baseUrl.replace(/\/+$/, '');
  // Build a path-keyed map for sorting lookups later
  const rawByPath = new Map<string, WebflowPage>();

  const sitePages: SiteContextPage[] = pages.map(page => {
    const path = derivePath(page);
    rawByPath.set(path, page);
    const url = `${baseUrl}${path}`;
    const classified = classifyPage(url, baseUrl);
    return {
      path,
      url,
      kind: classified.kind,
      primaryType: classified.primaryType,
      id: `${url}#${kindToIdSuffix(classified.kind)}`,
      parentPath: null,
      childPaths: [],
    };
  });

  const byPath = new Map(sitePages.map(p => [p.path, p]));

  // Determine parent-child relationships.
  // A page is a qualifying child if its kind is in CHILD_KINDS.
  // Its parent is the longest-path ancestor in the page list (avoids skipping levels).
  for (const page of sitePages) {
    if (!CHILD_KINDS.has(page.kind)) continue;
    let longestAncestorPath = '';
    for (const candidate of sitePages) {
      if (candidate.path === page.path) continue;
      if (
        page.path.startsWith(candidate.path === '/' ? '/' : candidate.path + '/') &&
        candidate.path.length > longestAncestorPath.length
      ) {
        longestAncestorPath = candidate.path;
      }
    }
    if (longestAncestorPath) {
      page.parentPath = longestAncestorPath;
      const parent = byPath.get(longestAncestorPath);
      if (parent) parent.childPaths.push(page.path);
    }
  }

  // Sort each hub's childPaths: date desc (null last), then path alpha.
  for (const page of sitePages) {
    if (page.childPaths.length < 2) continue;
    page.childPaths.sort((a, b) => {
      const aRaw = (rawByPath.get(a) as Record<string, unknown>)?.lastPublished;
      const bRaw = (rawByPath.get(b) as Record<string, unknown>)?.lastPublished;
      const aMs = typeof aRaw === 'string' ? new Date(aRaw).getTime() : NaN;
      const bMs = typeof bRaw === 'string' ? new Date(bRaw).getTime() : NaN;
      const aValid = Number.isFinite(aMs);
      const bValid = Number.isFinite(bMs);
      if (aValid && bValid) return bMs - aMs;   // both dated: newer first
      if (aValid) return -1;                     // a has date, b doesn't
      if (bValid) return 1;                      // b has date, a doesn't
      return a.localeCompare(b);                 // both null: alpha
    });
  }

  return { pages: sitePages, canonicalEntities };
}
