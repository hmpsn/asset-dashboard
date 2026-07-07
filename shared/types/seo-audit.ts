export const AUDIT_CATEGORY_SCORE_VERSION = 1 as const;

export const AUDIT_DISPLAY_CATEGORIES = [
  'index',
  'onpage',
  'schema',
  'links',
  'perf',
  'mobile',
] as const;

export type AuditDisplayCategory = typeof AUDIT_DISPLAY_CATEGORIES[number];

export const AUDIT_DISPLAY_CATEGORY_LABELS: Record<AuditDisplayCategory, string> = {
  index: 'Indexing',
  onpage: 'On-page',
  schema: 'Schema',
  links: 'Links',
  perf: 'Performance',
  mobile: 'Mobile UX',
};

export interface AuditCategoryScore {
  category: AuditDisplayCategory;
  label: string;
  score: number;
  /** Indexed pages included in this category score denominator. Noindex pages are excluded. */
  denominatorPages: number;
  /** Pages with at least one issue in this display category. */
  affectedPages: number;
  errors: number;
  warnings: number;
  infos: number;
}

export interface AuditCategoryScoreEnvelope {
  categoryScoreVersion: typeof AUDIT_CATEGORY_SCORE_VERSION;
  categoryScores: AuditCategoryScore[];
}

export interface AuditDisplayIssueFields {
  /** Additive six-category presentation remap. Persisted `check` and `category` remain unchanged. */
  displayCategory?: AuditDisplayCategory;
}
