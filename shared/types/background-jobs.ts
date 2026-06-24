export const BACKGROUND_JOB_TYPES = {
  SEO_AUDIT: 'seo-audit',
  COMPRESS: 'compress',
  BULK_COMPRESS: 'bulk-compress',
  BULK_ALT: 'bulk-alt',
  BULK_SEO_FIX: 'bulk-seo-fix',
  SALES_REPORT: 'sales-report',
  KEYWORD_STRATEGY: 'keyword-strategy',
  SCHEMA_GENERATOR: 'schema-generator',
  SCHEMA_PLAN_GENERATION: 'schema-plan-generation',
  PAGE_ANALYSIS: 'page-analysis',
  DEEP_DIAGNOSTIC: 'deep-diagnostic',
  CONTENT_BRIEF_GENERATION: 'content-brief-generation',
  CONTENT_POST_GENERATION: 'content-post-generation',
  COPY_BATCH_GENERATION: 'copy-batch-generation',
  KNOWLEDGE_BASE_GENERATION: 'knowledge-base-generation',
  BRAND_VOICE_GENERATION: 'brand-voice-generation',
  PERSONA_GENERATION: 'persona-generation',
  SEO_BULK_ANALYZE: 'seo-bulk-analyze',
  SEO_BULK_REWRITE: 'seo-bulk-rewrite',
  SEO_BULK_ACCEPT_FIXES: 'seo-bulk-accept-fixes',
  ACTION_PLAYBOOK_EXECUTE: 'action-playbook-execute',
  RECOMMENDATIONS_GENERATION: 'recommendations-generation',
  LOCAL_SEO_REFRESH: 'local-seo-refresh',
  LOCAL_SEO_LOCATION_BACKFILL: 'local-seo-location-backfill',
  COPY_ENTRY_GENERATION: 'copy-entry-generation',
  BLUEPRINT_GENERATION: 'blueprint-generation',
  LLMS_TXT_GENERATION: 'llms-txt-generation',
  AEO_SITE_REVIEW: 'aeo-site-review',
  CONTENT_PUBLISH: 'content-publish',
  CONTENT_BRIEF_REGENERATE: 'content-brief-regenerate',
  CONTENT_POST_REVIEW: 'content-post-review',
  CONTENT_POST_FIX: 'content-post-fix',
  CONTENT_POST_VOICE_SCORE: 'content-post-voice-score',
  INTELLIGENCE_RECOMPUTE: 'intelligence-recompute',
  NATIONAL_SERP_REFRESH: 'national-serp-refresh',
  LOCAL_GBP_REFRESH: 'local-gbp-refresh',
} as const;

export type BackgroundJobType = typeof BACKGROUND_JOB_TYPES[keyof typeof BACKGROUND_JOB_TYPES];

export type BackgroundJobResultBehavior =
  | 'ephemeral'
  | 'domain-store'
  | 'domain-store-and-result';

export type BackgroundJobStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled';

export interface BackgroundJobRecord {
  id: string;
  type: BackgroundJobType | string;
  status: BackgroundJobStatus;
  progress?: number;
  total?: number;
  message?: string;
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  workspaceId?: string;
}

export type PublicBackgroundJob = Omit<BackgroundJobRecord, 'result'>;

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
    resultBehavior: 'domain-store',
  },
  [BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR]: {
    label: 'Schema Generator',
    description: 'Generates schema suggestions across a site.',
    cancellable: true,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION]: {
    label: 'Schema Plan Generation',
    description: 'Builds the site-wide schema plan for a workspace.',
    cancellable: false,
    resultBehavior: 'domain-store',
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
  [BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION]: {
    label: 'Content Brief Generation',
    description: 'Generates and stores a content brief.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION]: {
    label: 'Content Post Generation',
    description: 'Generates a full post from a saved content brief.',
    cancellable: true,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION]: {
    label: 'Copy Batch Generation',
    description: 'Generates page copy for a blueprint batch.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION]: {
    label: 'Knowledge Base Generation',
    description: 'Crawls a site and prepares a knowledge base draft for review.',
    cancellable: false,
    resultBehavior: 'ephemeral',
  },
  [BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION]: {
    label: 'Brand Voice Generation',
    description: 'Crawls a site and prepares a brand voice draft for review.',
    cancellable: false,
    resultBehavior: 'ephemeral',
  },
  [BACKGROUND_JOB_TYPES.PERSONA_GENERATION]: {
    label: 'Persona Generation',
    description: 'Crawls a site and prepares audience persona drafts for review.',
    cancellable: false,
    resultBehavior: 'ephemeral',
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
  [BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE]: {
    label: 'Action Playbook',
    description: 'Executes an automated implementation playbook after client approval.',
    cancellable: false,
    resultBehavior: 'domain-store',
  },
  [BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION]: {
    label: 'Recommendations Generation',
    description: 'Regenerates prioritized client recommendations for a workspace.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH]: {
    label: 'Local SEO Refresh',
    description: 'Refreshes local pack visibility for selected markets and keywords.',
    cancellable: true,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL]: {
    label: 'Recalculating local match history',
    description: 'Re-evaluates saved local visibility snapshots against configured client locations.',
    cancellable: false,
    resultBehavior: 'ephemeral',
  },
  [BACKGROUND_JOB_TYPES.COPY_ENTRY_GENERATION]: {
    label: 'Copy Entry Generation',
    description: 'Generates copy sections for a blueprint entry.',
    cancellable: false,
    resultBehavior: 'domain-store',
  },
  [BACKGROUND_JOB_TYPES.BLUEPRINT_GENERATION]: {
    label: 'Blueprint Generation',
    description: 'Generates a blueprint from workspace intelligence.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.LLMS_TXT_GENERATION]: {
    label: 'LLMs.txt Generation',
    description: 'Generates an LLMs.txt file with AI page summaries.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.AEO_SITE_REVIEW]: {
    label: 'AEO Site Review',
    description: 'Runs an AI-powered AEO review across site pages.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.CONTENT_PUBLISH]: {
    label: 'Publishing to Webflow',
    description: 'Publishes an approved content post to the Webflow CMS on approval.',
    cancellable: false,
    resultBehavior: 'domain-store',
  },
  [BACKGROUND_JOB_TYPES.CONTENT_BRIEF_REGENERATE]: {
    label: 'Brief Regeneration',
    description: 'Regenerates a content brief (or its outline) from user feedback.',
    cancellable: false,
    resultBehavior: 'domain-store',
  },
  [BACKGROUND_JOB_TYPES.CONTENT_POST_REVIEW]: {
    label: 'AI Content Review',
    description: 'Runs the AI quality review checklist against a generated post.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.CONTENT_POST_FIX]: {
    // Review-before-save: the AI fix draft is returned in job.result and applied by
    // the user via the post PATCH path; the job itself persists nothing. Same posture
    // as the *_GENERATION draft jobs (ephemeral) — see background-generation.md §3.
    label: 'AI Content Fix',
    description: 'Generates a targeted AI revision draft for a post for review before applying.',
    cancellable: false,
    resultBehavior: 'ephemeral',
  },
  [BACKGROUND_JOB_TYPES.CONTENT_POST_VOICE_SCORE]: {
    label: 'Brand Voice Scoring',
    description: 'Scores a generated post against the workspace brand voice.',
    cancellable: false,
    resultBehavior: 'domain-store-and-result',
  },
  [BACKGROUND_JOB_TYPES.INTELLIGENCE_RECOMPUTE]: {
    label: 'Refreshing signals',
    description: 'Recomputes analytics insights / intelligence signals for a workspace.',
    cancellable: false,
    resultBehavior: 'domain-store',
  },
  [BACKGROUND_JOB_TYPES.NATIONAL_SERP_REFRESH]: {
    label: 'Refreshing national SERP ranks',
    description: 'Reads national advanced-SERP rank + AI-Overview citation for tracked keywords.',
    cancellable: true,
    resultBehavior: 'domain-store',
  },
  [BACKGROUND_JOB_TYPES.LOCAL_GBP_REFRESH]: {
    label: 'Refreshing GBP + reviews',
    description: 'Reads Google Business Profile health + review counts for the client and local competitors.',
    cancellable: true,
    resultBehavior: 'domain-store',
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

export function toPublicBackgroundJob(job: BackgroundJobRecord): PublicBackgroundJob {
  const { result: _result, ...publicJob } = job;
  void _result;
  return publicJob;
}
