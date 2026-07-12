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

export type AuditWritableField = 'seoTitle' | 'seoDescription';

const AUDIT_TITLE_WRITE_CHECKS = new Set([
  'title',
  'title_length',
  'missing_title',
  'duplicate-title',
]);

const AUDIT_DESCRIPTION_WRITE_CHECKS = new Set([
  'meta-description',
  'meta_length',
  'missing_meta',
  'duplicate-description',
]);

/**
 * Resolve an audit check to a real Webflow SEO write target. Unknown and structural
 * checks deliberately return null so recommendation prose can never be applied as a
 * page title or meta description.
 */
export function auditWritableFieldForCheck(check: string): AuditWritableField | null {
  const normalized = (check || '').trim().toLowerCase();
  if (AUDIT_TITLE_WRITE_CHECKS.has(normalized)) return 'seoTitle';
  if (AUDIT_DESCRIPTION_WRITE_CHECKS.has(normalized)) return 'seoDescription';
  return null;
}

/**
 * Field label stored on an approval item. Writable title/meta checks retain their
 * canonical field; structural checks receive a non-writeable `audit-*` label so they
 * remain reviewable without masquerading as a meta-description edit.
 */
export function auditApprovalFieldForCheck(check: string): string {
  const writableField = auditWritableFieldForCheck(check);
  if (writableField) return writableField;
  const normalized = (check || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `audit-${normalized || 'issue'}`;
}
