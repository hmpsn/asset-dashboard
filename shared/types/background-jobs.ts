export const BACKGROUND_JOB_TYPES = {
  SEO_AUDIT: 'seo-audit',
  COMPRESS: 'compress',
  BULK_COMPRESS: 'bulk-compress',
  BULK_ALT: 'bulk-alt',
  BULK_SEO_FIX: 'bulk-seo-fix',
  SALES_REPORT: 'sales-report',
  KEYWORD_STRATEGY: 'keyword-strategy',
  SCHEMA_GENERATOR: 'schema-generator',
  PAGE_ANALYSIS: 'page-analysis',
  DEEP_DIAGNOSTIC: 'deep-diagnostic',
  CONTENT_POST_GENERATION: 'content-post-generation',
  SEO_BULK_ANALYZE: 'seo-bulk-analyze',
  SEO_BULK_REWRITE: 'seo-bulk-rewrite',
  SEO_BULK_ACCEPT_FIXES: 'seo-bulk-accept-fixes',
} as const;

export type BackgroundJobType = typeof BACKGROUND_JOB_TYPES[keyof typeof BACKGROUND_JOB_TYPES];

export type BackgroundJobResultBehavior =
  | 'ephemeral'
  | 'domain-store'
  | 'domain-store-and-result';

export interface BackgroundJobTypeMetadata {
  label: string;
  description: string;
  cancellable: boolean;
  resultBehavior: BackgroundJobResultBehavior;
}

export const BACKGROUND_JOB_METADATA: { [K in BackgroundJobType]: BackgroundJobTypeMetadata } = {
  [BACKGROUND_JOB_TYPES.SEO_AUDIT]: {
    label: 'SEO Audit',
    description: 'Scans a site and saves an audit snapshot.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.COMPRESS]: {
    label: 'Image Compression',
    description: 'Compresses a single image asset.',
    cancellable: false,
    resultBehavior: 'ephemeral',
  },
  [BACKGROUND_JOB_TYPES.BULK_COMPRESS]: {
    label: 'Bulk Compression',
    description: 'Compresses multiple image assets.',
    cancellable: false,
    resultBehavior: 'ephemeral',
  },
  [BACKGROUND_JOB_TYPES.BULK_ALT]: {
    label: 'Bulk Alt Text',
    description: 'Generates alt text for multiple images.',
    cancellable: false,
    resultBehavior: 'ephemeral',
  },
  [BACKGROUND_JOB_TYPES.BULK_SEO_FIX]: {
    label: 'Bulk SEO Fix',
    description: 'Applies AI-generated SEO metadata fixes.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.SALES_REPORT]: {
    label: 'Sales Report',
    description: 'Audits a prospect site and stores a sales report.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY]: {
    label: 'Keyword Strategy',
    description: 'Builds a workspace keyword strategy.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR]: {
    label: 'Schema Generator',
    description: 'Generates schema suggestions across a site.',
    cancellable: true,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.PAGE_ANALYSIS]: {
    label: 'Page Analysis',
    description: 'Analyzes pages for keyword strategy context.',
    cancellable: true,
    resultBehavior: 'domain-store',
  },
  [BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC]: {
    label: 'Deep Diagnostic',
    description: 'Runs a diagnostic investigation for an insight.',
    cancellable: false,
    resultBehavior: 'domain-store',
  },
  [BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION]: {
    label: 'Content Post Generation',
    description: 'Generates a full post from a saved content brief.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE]: {
    label: 'Bulk SEO Analysis',
    description: 'Analyzes pages for SEO recommendations.',
    cancellable: true,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE]: {
    label: 'Bulk SEO Rewrite',
    description: 'Generates SEO title and description rewrites.',
    cancellable: true,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.SEO_BULK_ACCEPT_FIXES]: {
    label: 'Bulk Fix Publish',
    description: 'Applies approved SEO fixes to Webflow.',
    cancellable: true,
    resultBehavior: 'domain-store-and-result',
  },
};

export function isBackgroundJobType(type: string): type is BackgroundJobType {
  return Object.prototype.hasOwnProperty.call(BACKGROUND_JOB_METADATA, type);
}

export function getBackgroundJobMetadata(type: string): BackgroundJobTypeMetadata | undefined {
  return isBackgroundJobType(type) ? BACKGROUND_JOB_METADATA[type] : undefined;
}

export function getBackgroundJobLabel(type: string): string {
  return getBackgroundJobMetadata(type)?.label ?? type;
}

export function isBackgroundJobCancellable(type: string): boolean {
  return getBackgroundJobMetadata(type)?.cancellable ?? true;
}
