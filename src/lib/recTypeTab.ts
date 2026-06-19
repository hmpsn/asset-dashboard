import type { Page } from '../routes';
import type { Recommendation, RecType } from '../../shared/types/recommendations';

/**
 * Admin fix-CTA routing: maps a recommendation type to the admin Page tab whose surface
 * resolves the fix. This is the ADMIN map (Page values) — distinct from the client-portal
 * REC_TYPE_TAB in InsightsEngine (which maps to client tabs via a narrower onNavigate).
 *
 * Notes from the routing audit:
 *  - content/content_refresh route to 'content-pipeline', NOT 'seo-briefs' — seo-briefs is a
 *    redirect that drops router state, so a fixContext sent there is silently lost.
 *  - seo-audit / seo-strategy / performance do NOT consume fixContext; CTAs there are tab-nav only.
 *  - metadata (seo-editor), schema (seo-schema), content* (content-pipeline) DO pre-fill via fixContext.
 */
export const REC_TYPE_ADMIN_TAB: Record<RecType, Page> = {
  metadata: 'seo-editor',
  schema: 'seo-schema',
  technical: 'seo-audit',
  performance: 'performance',
  accessibility: 'seo-audit',
  content: 'content-pipeline',
  content_refresh: 'content-pipeline',
  strategy: 'seo-strategy',
  aeo: 'seo-audit',
  keyword_gap: 'seo-strategy',
  topic_cluster: 'seo-strategy',
  cannibalization: 'seo-audit',
  local_visibility: 'seo-strategy',
  local_service_gap: 'seo-strategy',
  competitor: 'seo-strategy',
};

/** The fixContext payload an admin fix-CTA carries (a subset of App.tsx FixContext). */
export interface RecFixContext {
  targetRoute: Page;
  pageSlug?: string;
  pageName?: string;
  primaryKeyword?: string;
}

/** Resolve the destination tab + fixContext for a recommendation's fix-CTA. */
export function buildRecFixContext(rec: Recommendation): { tab: Page; fixContext: RecFixContext } {
  const tab = REC_TYPE_ADMIN_TAB[rec.type] ?? 'seo-audit';
  return {
    tab,
    fixContext: {
      targetRoute: tab,
      pageSlug: rec.affectedPages[0],
      pageName: rec.title,
      primaryKeyword: rec.targetKeyword,
    },
  };
}
