// ── Unified Page type (joins Webflow pages + strategy data) ────────

import type { PageKeywordMap } from './workspace.js';

export interface UnifiedPage {
  id: string;                          // page.id for Webflow pages; `strategy-${pagePath}` for strategy-only entries
  title: string;                       // strategy.pageTitle || page.title || cleaned slug
  path: string;                        // resolvePagePath(page) for real pages; sp.pagePath for strategy-only
  slug?: string;                       // raw slug when available (Webflow pages only)
  source: 'static' | 'cms' | 'strategy-only';
  publishedPath?: string | null;
  seo?: { title?: string | null; description?: string | null };
  strategy?: PageKeywordMap;           // undefined when page has no matching strategy entry
  analyzed: boolean;                   // strategy?.analysisGeneratedAt != null
}
