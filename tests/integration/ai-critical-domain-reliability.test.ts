import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type DomainSignal = {
  pipelineId: string;
  evidenceFiles: string[];
  successTokens: string[];
  failureTokens: string[];
  noSideEffectTokens: string[];
};

const DOMAIN_SIGNALS: DomainSignal[] = [
  {
    pipelineId: 'schema-generation-review',
    evidenceFiles: [
      'tests/integration/schema-plan-public-routes.test.ts',
      'tests/unit/schema-validation-pipeline.test.ts',
    ],
    successTokens: ['status).toBe(200)', 'client_approved'],
    failureTokens: ['status).toBe(400)', 'status).toBe(409)', 'invalid'],
    noSideEffectTokens: ['should not save', 'does not update', 'toBe(0)'],
  },
  {
    pipelineId: 'content-brief-review',
    evidenceFiles: [
      'tests/integration/content-posts-ai-fix.test.ts',
      'tests/integration/content-posts-workflow.test.ts',
    ],
    successTokens: ['status).toBe(200)', 'broadcast', 'updated'],
    failureTokens: ['status).toBe(500)', 'error', 'failed'],
    noSideEffectTokens: ['toHaveLength(0)', 'does not mutate', 'should not save'],
  },
  {
    pipelineId: 'seo-editor-assist',
    evidenceFiles: [
      'tests/integration/bulk-accept-webflow-failure.test.ts',
      'tests/contract/external-provider-write-failure-contract.test.ts',
    ],
    successTokens: ['status).toBe(200)', 'jobId'],
    failureTokens: ['rate limited', 'failed', 'status).toBe(500)'],
    noSideEffectTokens: ['applied).toBe(0)', 'no phantom success', 'failed).toBe'],
  },
  {
    pipelineId: 'client-decision-support',
    evidenceFiles: [
      'tests/integration/client-actions-broadcasts.test.ts',
      'tests/integration/client-actions-routes.test.ts',
      'tests/contract/public-workspace-intelligence-contract.test.ts',
    ],
    successTokens: ['status).toBe(200)', 'client_action_update', 'responded'],
    failureTokens: ['status).toBe(400)', 'status).toBe(409)', 'error'],
    noSideEffectTokens: ['does not broadcast', 'does not mutate', 'toHaveLength(0)'],
  },
  {
    pipelineId: 'diagnostic-synthesis',
    evidenceFiles: [
      'tests/integration/deep-diagnostic-jobs.test.ts',
      'tests/integration/deep-diagnostic-mutation-safety.test.ts',
    ],
    successTokens: ['diagnostic complete', 'status: \'done\'', 'diagnostic_completed'],
    failureTokens: ['status: \'error\'', 'status).toBe(404)', 'diagnostic failed'],
    noSideEffectTokens: ['countActivities(workspaceAId, \'diagnostic_completed\')).toBe(0)', 'countRows(\'diagnostic_reports\', workspaceBId)).toBe(0)'],
  },
  {
    pipelineId: 'admin-insights-chat',
    evidenceFiles: [
      'server/routes/ai.ts',
      'tests/unit/ai-dispatch.test.ts',
      'tests/unit/admin-chat-question-routing.test.ts',
    ],
    successTokens: ['assembleAdminContext', 'buildSystemPrompt', 'callAI'],
    failureTokens: ['question required', 'workspaceId required', 'OPENAI_API_KEY not configured'],
    noSideEffectTokens: ['res.status(400).json', 'res.status(500).json'],
  },
  {
    pipelineId: 'client-search-chat',
    evidenceFiles: [
      'server/routes/public-analytics.ts',
      'tests/integration/public-chat-routes.test.ts',
      'tests/integration/client-signals-routes.test.ts',
    ],
    successTokens: ['classifyMessageIntent', 'detectedIntent', 'createClientSignal'],
    failureTokens: ['status).toBe(400)', 'status).toBe(404)', 'error'],
    noSideEffectTokens: ['Promise.allSettled', 'non-critical — never block chat response', 'hasRecentSignal'],
  },
  {
    pipelineId: 'brand-voice-provenance',
    evidenceFiles: [
      'tests/integration/brand-identity-hardening.test.ts',
      'tests/integration/voice-calibration-hardening.test.ts',
      'tests/integration/content-posts-ai-fix.test.ts',
      'tests/contract/factual-ai-output-contracts.test.ts',
    ],
    successTokens: ['researchMode: true', 'voice profile', 'brand voice'],
    failureTokens: ['status).toBe(429)', 'status).toBe(500)', 'usage_limit'],
    noSideEffectTokens: ['human-review required', 'sanitizeErrorMessage', 'does not'],
  },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readEvidence(files: string[]): string {
  return files
    .map(file => {
      const absolutePath = path.resolve(ROOT, file);
      expect(existsSync(absolutePath), `Missing evidence file: ${file}`).toBe(true);
      return readFileSync(absolutePath, 'utf8').toLowerCase();
    })
    .join('\n');
}

function hasAnyToken(source: string, tokens: string[]): boolean {
  return tokens.some(token => source.includes(token.toLowerCase()));
}

describe('AI critical domain reliability signals', () => {
  it('keeps explicit success, failure, and no-side-effect assertions for each critical domain', () => {
    for (const signal of DOMAIN_SIGNALS) {
      const merged = readEvidence(signal.evidenceFiles);
      expect(hasAnyToken(merged, signal.successTokens), `${signal.pipelineId} success signal`).toBe(true);
      expect(hasAnyToken(merged, signal.failureTokens), `${signal.pipelineId} failure signal`).toBe(true);
      expect(hasAnyToken(merged, signal.noSideEffectTokens), `${signal.pipelineId} no-side-effect signal`).toBe(true);
    }
  });
});
