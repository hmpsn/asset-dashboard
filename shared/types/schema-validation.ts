/**
 * Typed validation findings emitted by the lean schema validator.
 *
 * Replaces the prior `string[]` return shape so consumers can filter by
 * severity, group by @type, deep-link to specific fields (PR2 completeness
 * widget), and integrate with future shape validators (e.g. schemarama in
 * Pillar 3) without re-parsing string messages.
 */
export interface ValidationFinding {
  /** error: schema is malformed or missing required Google rich-result data.
   *  warning: recommended-tier field missing; schema is still valid. */
  severity: 'error' | 'warning';
  /** Schema.org @type of the affected node, e.g. "Article", "BlogPosting", "BreadcrumbList". */
  type: string;
  /** Missing or malformed field (e.g. "publisher.logo", "image", "datePublished").
   *  Undefined for whole-graph issues like "missing @context". */
  field?: string;
  /** Stable rule id for filtering, disable lists, and future pr-check parity.
   *  Example values: "required-field-missing", "publisher-logo-shape", "iso-8601-date",
   *  "absolute-url", "breadcrumb-position-ordering". */
  ruleId: string;
  /** Human-readable message for admin UI rendering. */
  message: string;
}

export interface WholeSiteSchemaGraphNode {
  id: string;
  type: string;
  pageId: string;
  pagePath: string;
  source: 'site-template' | 'page-schema';
}

export interface WholeSiteSchemaGraphFinding extends ValidationFinding {
  pageId?: string;
  pagePath?: string;
  sourceId?: string;
  targetId?: string;
}

export interface WholeSiteSchemaGraphValidationResult {
  status: 'valid' | 'warnings' | 'errors';
  checkedPageCount: number;
  nodeCount: number;
  referenceCount: number;
  findings: WholeSiteSchemaGraphFinding[];
  nodes: WholeSiteSchemaGraphNode[];
}
