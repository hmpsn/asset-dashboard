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
  // Implementation in Task 2
  throw new Error('assembleSiteContext: not yet implemented');
  void pages; void baseUrl; void canonicalEntities;
}
