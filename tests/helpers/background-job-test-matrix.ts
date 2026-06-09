import {
  BACKGROUND_JOB_TYPES,
  type BackgroundJobResultBehavior,
  type BackgroundJobType,
} from '../../shared/types/background-jobs.js';

type BackgroundJobTypeKey = keyof typeof BACKGROUND_JOB_TYPES;

export interface BackgroundJobCoverageSignal {
  file: string;
  mustContainOneOf: readonly string[];
}

export interface BackgroundJobLifecycleMatrixEntry {
  coverageSignals: readonly BackgroundJobCoverageSignal[];
  expectedLabel: string;
  expectedCancellable: boolean;
  expectedResultBehavior: BackgroundJobResultBehavior;
}

function signal(key: BackgroundJobTypeKey, file: string): BackgroundJobCoverageSignal {
  const type = BACKGROUND_JOB_TYPES[key];
  return {
    file,
    mustContainOneOf: [type, `BACKGROUND_JOB_TYPES.${key}`],
  };
}

function entry(
  key: BackgroundJobTypeKey,
  expectations: Omit<BackgroundJobLifecycleMatrixEntry, 'coverageSignals'>,
  ...files: string[]
): BackgroundJobLifecycleMatrixEntry {
  return {
    expectedLabel: expectations.expectedLabel,
    expectedCancellable: expectations.expectedCancellable,
    expectedResultBehavior: expectations.expectedResultBehavior,
    coverageSignals: files.map(file => signal(key, file)),
  };
}

export const BACKGROUND_JOB_LIFECYCLE_MATRIX: Record<BackgroundJobType, BackgroundJobLifecycleMatrixEntry> = {
  [BACKGROUND_JOB_TYPES.SEO_AUDIT]: entry(
    'SEO_AUDIT',
    { expectedLabel: 'SEO Audit', expectedCancellable: false, expectedResultBehavior: 'domain-store-and-result' },
    'tests/integration/legacy-jobs-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.COMPRESS]: entry(
    'COMPRESS',
    { expectedLabel: 'Image Compression', expectedCancellable: false, expectedResultBehavior: 'ephemeral' },
    'tests/integration/media-jobs-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.BULK_COMPRESS]: entry(
    'BULK_COMPRESS',
    { expectedLabel: 'Bulk Compression', expectedCancellable: false, expectedResultBehavior: 'ephemeral' },
    'tests/integration/media-jobs-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.BULK_ALT]: entry(
    'BULK_ALT',
    { expectedLabel: 'Bulk Alt Text', expectedCancellable: false, expectedResultBehavior: 'ephemeral' },
    'tests/integration/media-jobs-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.BULK_SEO_FIX]: entry(
    'BULK_SEO_FIX',
    { expectedLabel: 'Bulk SEO Fix', expectedCancellable: false, expectedResultBehavior: 'domain-store-and-result' },
    'tests/integration/legacy-jobs-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.SALES_REPORT]: entry(
    'SALES_REPORT',
    { expectedLabel: 'Sales Report', expectedCancellable: false, expectedResultBehavior: 'domain-store-and-result' },
    'tests/integration/legacy-jobs-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY]: entry(
    'KEYWORD_STRATEGY',
    { expectedLabel: 'Keyword Strategy', expectedCancellable: false, expectedResultBehavior: 'domain-store' },
    'tests/integration/keyword-strategy-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR]: entry(
    'SCHEMA_GENERATOR',
    { expectedLabel: 'Schema Generator', expectedCancellable: true, expectedResultBehavior: 'domain-store-and-result' },
    'tests/integration/schema-generator-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.SCHEMA_PLAN_GENERATION]: entry(
    'SCHEMA_PLAN_GENERATION',
    { expectedLabel: 'Schema Plan Generation', expectedCancellable: false, expectedResultBehavior: 'domain-store' },
    'tests/integration/schema-plan-generation-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.PAGE_ANALYSIS]: entry(
    'PAGE_ANALYSIS',
    { expectedLabel: 'Page Analysis', expectedCancellable: true, expectedResultBehavior: 'domain-store' },
    'tests/integration/page-analysis-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC]: entry(
    'DEEP_DIAGNOSTIC',
    { expectedLabel: 'Deep Diagnostic', expectedCancellable: false, expectedResultBehavior: 'domain-store' },
    'tests/integration/deep-diagnostic-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION]: entry(
    'CONTENT_BRIEF_GENERATION',
    {
      expectedLabel: 'Content Brief Generation',
      expectedCancellable: false,
      expectedResultBehavior: 'domain-store-and-result',
    },
    'tests/component/ContentBriefs.test.tsx',
  ),
  [BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION]: entry(
    'CONTENT_POST_GENERATION',
    {
      expectedLabel: 'Content Post Generation',
      expectedCancellable: true,
      expectedResultBehavior: 'domain-store-and-result',
    },
    'tests/integration/content-post-generation-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.COPY_BATCH_GENERATION]: entry(
    'COPY_BATCH_GENERATION',
    {
      expectedLabel: 'Copy Batch Generation',
      expectedCancellable: false,
      expectedResultBehavior: 'domain-store-and-result',
    },
    'tests/unit/api-modules-b.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION]: entry(
    'KNOWLEDGE_BASE_GENERATION',
    {
      expectedLabel: 'Knowledge Base Generation',
      expectedCancellable: false,
      expectedResultBehavior: 'ephemeral',
    },
    'tests/integration/workspace-context-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION]: entry(
    'BRAND_VOICE_GENERATION',
    {
      expectedLabel: 'Brand Voice Generation',
      expectedCancellable: false,
      expectedResultBehavior: 'ephemeral',
    },
    'tests/integration/workspace-context-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.PERSONA_GENERATION]: entry(
    'PERSONA_GENERATION',
    {
      expectedLabel: 'Persona Generation',
      expectedCancellable: false,
      expectedResultBehavior: 'ephemeral',
    },
    'tests/integration/workspace-context-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE]: entry(
    'SEO_BULK_ANALYZE',
    {
      expectedLabel: 'Bulk SEO Analysis',
      expectedCancellable: true,
      expectedResultBehavior: 'domain-store-and-result',
    },
    'tests/integration/seo-background-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE]: entry(
    'SEO_BULK_REWRITE',
    {
      expectedLabel: 'Bulk SEO Rewrite',
      expectedCancellable: true,
      expectedResultBehavior: 'domain-store-and-result',
    },
    'tests/integration/seo-background-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.SEO_BULK_ACCEPT_FIXES]: entry(
    'SEO_BULK_ACCEPT_FIXES',
    {
      expectedLabel: 'Bulk Fix Publish',
      expectedCancellable: true,
      expectedResultBehavior: 'domain-store-and-result',
    },
    'tests/integration/seo-background-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE]: entry(
    'ACTION_PLAYBOOK_EXECUTE',
    { expectedLabel: 'Action Playbook', expectedCancellable: false, expectedResultBehavior: 'domain-store' },
    'tests/integration/background-job-mutation-safety.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.RECOMMENDATIONS_GENERATION]: entry(
    'RECOMMENDATIONS_GENERATION',
    {
      expectedLabel: 'Recommendations Generation',
      expectedCancellable: false,
      expectedResultBehavior: 'domain-store-and-result',
    },
    'tests/integration/recommendations-lifecycle.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.LOCAL_SEO_REFRESH]: entry(
    'LOCAL_SEO_REFRESH',
    {
      expectedLabel: 'Local SEO Refresh',
      expectedCancellable: true,
      expectedResultBehavior: 'domain-store-and-result',
    },
    'tests/integration/local-seo-routes.test.ts',
  ),
  [BACKGROUND_JOB_TYPES.LOCAL_SEO_LOCATION_BACKFILL]: entry(
    'LOCAL_SEO_LOCATION_BACKFILL',
    {
      expectedLabel: 'Recalculating local match history',
      expectedCancellable: false,
      expectedResultBehavior: 'ephemeral',
    },
    'tests/integration/client-locations.test.ts',
  ),
};
