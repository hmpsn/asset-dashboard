import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface ProviderSignal {
  provider: string;
  files: string[];
  mustContainOneOf: string[];
}

const PROVIDER_SIGNALS: ProviderSignal[] = [
  {
    provider: 'webflow',
    files: [
      'tests/integration/webflow-cms-writes.test.ts',
      'tests/integration/webflow-cms-mutation-safety.test.ts',
      'tests/integration/seo-background-job-mutation-safety.test.ts',
      'tests/integration/webflow-schema-writes.test.ts',
      'tests/integration/content-publish-writes.test.ts',
      'tests/integration/public-approval-broadcasts.test.ts',
    ],
    mustContainOneOf: ['failed', 'error', 'status).toBe(500)'],
  },
  {
    provider: 'stripe',
    files: [
      'tests/integration/stripe-webhooks.test.ts',
      'tests/integration/stripe-webhook-idempotency.test.ts',
      'tests/integration/stripe-webhook-route-contracts.test.ts',
      'tests/contract/billing-mutation-lifecycle.test.ts',
    ],
    mustContainOneOf: ['failed', 'error', 'idempot'],
  },
  {
    provider: 'google-gsc-ga4',
    files: [
      'tests/integration/misc-endpoints.test.ts',
      'tests/integration/public-analytics.test.ts',
      'tests/unit/rank-tracking-scheduler.test.ts',
    ],
    mustContainOneOf: ['failed', 'error', 'reject', 'status).toBe(4'],
  },
  {
    provider: 'dataforseo-semrush',
    files: [
      'tests/integration/semrush-routes.test.ts',
      'tests/integration/keyword-strategy-job-mutation-safety.test.ts',
      'tests/unit/seo-provider-routing.test.ts',
      'tests/unit/jobs-bulk-analysis.test.ts',
    ],
    mustContainOneOf: ['seo provider fetch failed', 'failed', 'error', 'balance is zero', 'fallback'],
  },
  {
    provider: 'openai',
    files: [
      'tests/integration/seo-background-job-mutation-safety.test.ts',
      'tests/integration/keyword-strategy-job-mutation-safety.test.ts',
      'tests/integration/background-job-mutation-safety.test.ts',
      'tests/integration/content-post-generation-mutation-safety.test.ts',
      'tests/unit/discovery-ingestion-ai-failure.test.ts',
    ],
    mustContainOneOf: ['OPENAI', 'failed', 'error'],
  },
  {
    provider: 'anthropic',
    files: [
      'tests/unit/ai-dispatch.test.ts',
      'tests/integration/webflow-seo-bulk-slugless.test.ts',
      'tests/integration/brand-identity-hardening.test.ts',
      'tests/unit/content-quality-rules.test.ts',
    ],
    mustContainOneOf: ['anthropic', 'Claude', 'failed', 'error'],
  },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readSignalFile(relativeFile: string): string {
  const absolutePath = path.resolve(ROOT, relativeFile);
  expect(existsSync(absolutePath), `${relativeFile} should exist`).toBe(true);
  return readFileSync(absolutePath, 'utf8');
}

describe('external-provider write failure contract matrix', () => {
  it('keeps failure-signal coverage files present for every critical provider group', () => {
    for (const providerSignal of PROVIDER_SIGNALS) {
      expect(providerSignal.files.length).toBeGreaterThan(0);
      for (const file of providerSignal.files) {
        expect(existsSync(path.resolve(ROOT, file)), `${providerSignal.provider}: missing ${file}`).toBe(true);
      }
    }
  });

  it('ensures each provider signal includes explicit failure assertions/paths', () => {
    for (const providerSignal of PROVIDER_SIGNALS) {
      const mergedSource = providerSignal.files
        .map(file => readSignalFile(file).toLowerCase())
        .join('\n');

      expect(
        providerSignal.mustContainOneOf.some(token => mergedSource.includes(token.toLowerCase())),
        `${providerSignal.provider} should include explicit failure-path signals`,
      ).toBe(true);
    }
  });
});
