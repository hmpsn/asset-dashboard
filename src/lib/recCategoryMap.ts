import type { RecType } from '../../shared/types/recommendations';

/** Strategy v2 Act-queue filter categories. */
export type ActCategory = 'content' | 'technical' | 'quick-win';

export const ACT_CATEGORIES: readonly ActCategory[] = ['content', 'technical', 'quick-win'];

/**
 * Maps every recommendation type to an Act-queue filter category. An exhaustive `Record<RecType, …>`
 * so a newly-added RecType fails to compile until it is categorized here.
 */
export const REC_TYPE_ACT_CATEGORY: Record<RecType, ActCategory> = {
  content: 'content',
  content_refresh: 'content',
  keyword_gap: 'content',
  topic_cluster: 'content',
  local_service_gap: 'content',
  technical: 'technical',
  metadata: 'technical',
  schema: 'technical',
  performance: 'technical',
  accessibility: 'technical',
  aeo: 'technical',
  cannibalization: 'technical',
  strategy: 'quick-win',
  // Local-visibility gaps are local content/landing-page work, not low-effort quick wins.
  local_visibility: 'content',
  // Competitive gap analysis is research/technical work — no content deliverable, no quick win.
  competitor: 'technical',
};

export function recActCategory(type: RecType): ActCategory {
  return REC_TYPE_ACT_CATEGORY[type];
}
