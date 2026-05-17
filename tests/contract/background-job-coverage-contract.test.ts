import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKGROUND_JOB_TYPES,
  type BackgroundJobType,
} from '../../shared/types/background-jobs.js';

interface CoverageSignal {
  file: string;
  mustContainOneOf: string[];
}

const COVERAGE_SIGNALS: Record<BackgroundJobType, CoverageSignal[]> = {
  [BACKGROUND_JOB_TYPES.SEO_AUDIT]: [
    {
      file: 'tests/integration/legacy-jobs-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.SEO_AUDIT, 'BACKGROUND_JOB_TYPES.SEO_AUDIT'],
    },
  ],
  [BACKGROUND_JOB_TYPES.COMPRESS]: [
    {
      file: 'tests/integration/media-jobs-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.COMPRESS, 'BACKGROUND_JOB_TYPES.COMPRESS'],
    },
  ],
  [BACKGROUND_JOB_TYPES.BULK_COMPRESS]: [
    {
      file: 'tests/integration/media-jobs-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.BULK_COMPRESS, 'BACKGROUND_JOB_TYPES.BULK_COMPRESS'],
    },
  ],
  [BACKGROUND_JOB_TYPES.BULK_ALT]: [
    {
      file: 'tests/integration/media-jobs-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.BULK_ALT, 'BACKGROUND_JOB_TYPES.BULK_ALT'],
    },
  ],
  [BACKGROUND_JOB_TYPES.BULK_SEO_FIX]: [
    {
      file: 'tests/integration/legacy-jobs-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.BULK_SEO_FIX, 'BACKGROUND_JOB_TYPES.BULK_SEO_FIX'],
    },
  ],
  [BACKGROUND_JOB_TYPES.SALES_REPORT]: [
    {
      file: 'tests/integration/legacy-jobs-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.SALES_REPORT, 'BACKGROUND_JOB_TYPES.SALES_REPORT'],
    },
  ],
  [BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY]: [
    {
      file: 'tests/integration/keyword-strategy-job-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, 'BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY'],
    },
  ],
  [BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR]: [
    {
      file: 'tests/integration/schema-generator-job-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR, 'BACKGROUND_JOB_TYPES.SCHEMA_GENERATOR'],
    },
  ],
  [BACKGROUND_JOB_TYPES.PAGE_ANALYSIS]: [
    {
      file: 'tests/integration/page-analysis-job-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.PAGE_ANALYSIS, 'BACKGROUND_JOB_TYPES.PAGE_ANALYSIS'],
    },
  ],
  [BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC]: [
    {
      file: 'tests/integration/deep-diagnostic-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC, 'BACKGROUND_JOB_TYPES.DEEP_DIAGNOSTIC'],
    },
  ],
  [BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION]: [
    {
      file: 'tests/integration/content-post-generation-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, 'BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION'],
    },
  ],
  [BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION]: [
    {
      file: 'tests/integration/workspace-context-job-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION, 'BACKGROUND_JOB_TYPES.KNOWLEDGE_BASE_GENERATION'],
    },
  ],
  [BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION]: [
    {
      file: 'tests/integration/workspace-context-job-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION, 'BACKGROUND_JOB_TYPES.BRAND_VOICE_GENERATION'],
    },
  ],
  [BACKGROUND_JOB_TYPES.PERSONA_GENERATION]: [
    {
      file: 'tests/integration/workspace-context-job-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.PERSONA_GENERATION, 'BACKGROUND_JOB_TYPES.PERSONA_GENERATION'],
    },
  ],
  [BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE]: [
    {
      file: 'tests/integration/seo-background-job-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, 'BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE'],
    },
  ],
  [BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE]: [
    {
      file: 'tests/integration/seo-background-job-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE, 'BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE'],
    },
  ],
  [BACKGROUND_JOB_TYPES.SEO_BULK_ACCEPT_FIXES]: [
    {
      file: 'tests/integration/seo-background-job-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.SEO_BULK_ACCEPT_FIXES, 'BACKGROUND_JOB_TYPES.SEO_BULK_ACCEPT_FIXES'],
    },
  ],
  [BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE]: [
    {
      file: 'tests/integration/background-job-mutation-safety.test.ts',
      mustContainOneOf: [BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE, 'BACKGROUND_JOB_TYPES.ACTION_PLAYBOOK_EXECUTE'],
    },
  ],
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readSignalFile(relativeFile: string): string {
  const absolutePath = path.resolve(ROOT, relativeFile);
  expect(existsSync(absolutePath), `${relativeFile} should exist`).toBe(true);
  return readFileSync(absolutePath, 'utf8');
}

describe('background-job coverage contract', () => {
  it('maps every registered background job type to at least one lifecycle signal file', () => {
    const registeredTypes = Object.values(BACKGROUND_JOB_TYPES).sort();
    const mappedTypes = Object.keys(COVERAGE_SIGNALS).sort();
    expect(mappedTypes).toEqual(registeredTypes);

    for (const type of registeredTypes) {
      expect(COVERAGE_SIGNALS[type]).toBeDefined();
      expect(COVERAGE_SIGNALS[type].length).toBeGreaterThan(0);
    }
  });

  it('keeps each lifecycle signal file present and anchored to the expected job type', () => {
    for (const [jobType, signals] of Object.entries(COVERAGE_SIGNALS)) {
      for (const signal of signals) {
        const source = readSignalFile(signal.file);
        expect(
          signal.mustContainOneOf.some(token => source.includes(token)),
          `${signal.file} should reference ${jobType}`,
        ).toBe(true);
      }
    }
  });
});
