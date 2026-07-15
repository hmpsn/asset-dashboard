import type { Tool } from '@modelcontextprotocol/sdk/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  recordPaidCallOnce: vi.fn(() => ({ count: 1 })),
}));

vi.mock('../../server/mcp/paid-call-counter.js', () => ({
  recordPaidCallOnce: h.recordPaidCallOnce,
}));

import type {
  PublicBrandContentOnboardingRun,
} from '../../shared/types/brand-content-onboarding.js';
import type { McpToolExecutionContext } from '../../shared/types/mcp-runtime.js';
import {
  brandContentOnboardingActionTools,
  createBrandContentOnboardingActionHandler,
  type BrandContentOnboardingActionDependencies,
} from '../../server/mcp/tools/brand-content-onboarding-actions.js';

const workspaceId = 'workspace-1';
const runId = 'onboarding-run-1';
const fingerprint = 'a'.repeat(64);

const context: McpToolExecutionContext = {
  requestId: 'request-1',
  toolName: 'start_brand_content_onboarding',
  targetWorkspaceId: workspaceId,
  caller: {
    kind: 'workspace_key',
    scope: workspaceId,
    workspaceId,
    keyId: 'key-1',
    keyLabel: 'Onboarding automation',
  },
};

function run(): PublicBrandContentOnboardingRun {
  return {
    id: runId,
    workspaceId,
    status: 'brand_generating',
    revision: 1,
    inputs: {
      intakeRevision: { intakeRevisionId: 'intake-1', revision: 1, fingerprint },
      matrixSelection: [{
        matrixId: 'matrix-1',
        cellId: 'cell-1',
        sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 3 },
        structuralFingerprint: 'b'.repeat(64),
        previewFingerprint: null,
      }],
    },
    finalizedVoice: null,
    approvedIdentity: [],
    children: {
      brandRunId: 'brand-run-1',
      voiceReviewDeliverableId: null,
      brandReviewDeliverableId: null,
      matrixRunId: null,
      pageApprovals: [],
    },
    currentGate: null,
    gateEvidence: [{
      id: 'intake-evidence-1',
      gate: 'intake_accepted',
      intakeRevision: { intakeRevisionId: 'intake-1', revision: 1, fingerprint },
      recordedBy: { actorType: 'mcp' },
      recordedAt: '2026-07-14T00:00:00.000Z',
    }],
    attentionResumeStatus: null,
    createdBy: { actorType: 'mcp' },
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:01:00.000Z',
    completedAt: null,
  };
}

function deps() {
  const start = vi.fn<BrandContentOnboardingActionDependencies['startBrandContentOnboarding']>(
    () => ({ run: run(), advanced: true, replayed: false, paidJobId: 'brand-job-1' }),
  );
  const get = vi.fn<BrandContentOnboardingActionDependencies['getBrandContentOnboarding']>(run);
  const resume = vi.fn<BrandContentOnboardingActionDependencies['resumeBrandContentOnboarding']>(
    () => ({ run: run(), advanced: false, replayed: false, paidJobId: null }),
  );
  return {
    value: {
      startBrandContentOnboarding: start,
      getBrandContentOnboarding: get,
      resumeBrandContentOnboarding: resume,
    },
    start,
    get,
    resume,
  };
}

function payload(result: Awaited<ReturnType<ReturnType<
  typeof createBrandContentOnboardingActionHandler
>>>): Record<string, unknown> {
  const first = result.content[0];
  expect(first?.type).toBe('text');
  return JSON.parse(first && 'text' in first ? first.text : '{}') as Record<string, unknown>;
}

describe('MCP brand content onboarding actions', () => {
  beforeEach(() => h.recordPaidCallOnce.mockClear());

  it('advertises exactly three workspace-scoped snake_case JSON-v1 tools', () => {
    expect(brandContentOnboardingActionTools.map(tool => tool.name)).toEqual([
      'start_brand_content_onboarding',
      'get_brand_content_onboarding',
      'resume_brand_content_onboarding',
    ]);
    expect(brandContentOnboardingActionTools.some(
      tool => tool.name.includes('authorize'),
    )).toBe(false);
    for (const tool of brandContentOnboardingActionTools as Tool[]) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.properties).toHaveProperty('workspace_id');
      expect(tool.inputSchema.properties).not.toHaveProperty('workspaceId');
    }
  });

  it('maps exact start authority and meters the accepted child job once', async () => {
    const dependencies = deps();
    const result = await createBrandContentOnboardingActionHandler(dependencies.value)(
      'start_brand_content_onboarding',
      {
        workspace_id: workspaceId,
        intake_revision_id: 'intake-1',
        expected_intake_revision: 1,
        expected_intake_fingerprint: fingerprint,
        matrix_selection: [{
          matrix_id: 'matrix-1',
          cell_id: 'cell-1',
          source_revision: { matrix_revision: 1, template_revision: 2, cell_revision: 3 },
          structural_fingerprint: 'b'.repeat(64),
          preview_fingerprint: null,
        }],
        brand_budget: {
          max_provider_calls: 10,
          max_input_tokens: 10_000,
          max_output_tokens: 5_000,
          max_estimated_cost_micros: 100_000,
          max_concurrency: 1,
        },
        idempotency_key: 'onboarding-start-1',
      },
      context,
    );

    expect(result.isError).not.toBe(true);
    expect(dependencies.start).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId,
      intakeRevisionId: 'intake-1',
      matrixSelection: [expect.objectContaining({ matrixId: 'matrix-1', cellId: 'cell-1' })],
      startedBy: {
        actorType: 'mcp', actorId: 'key-1', actorLabel: 'Onboarding automation',
      },
      mcpExecutionContext: context,
    }));
    expect(h.recordPaidCallOnce).toHaveBeenCalledWith(
      'mcp:brand-content-onboarding:accepted-child:brand-job-1',
      1,
      workspaceId,
    );
    const resultPayload = payload(result);
    expect(resultPayload).toMatchObject({
      run: { workspace_id: workspaceId, created_by: { actor_type: 'mcp' } },
      paid_job_id: 'brand-job-1',
    });
    expect(JSON.stringify(resultPayload)).not.toContain('key-1');
    expect(JSON.stringify(resultPayload)).not.toContain('Onboarding automation');
  });

  it('reads and resumes without metering when no paid child was accepted', async () => {
    const dependencies = deps();
    const read = await createBrandContentOnboardingActionHandler(dependencies.value)(
      'get_brand_content_onboarding',
      { workspace_id: workspaceId, run_id: runId },
      { ...context, toolName: 'get_brand_content_onboarding' },
    );
    expect(payload(read)).toMatchObject({ workspace_id: workspaceId, status: 'brand_generating' });

    const resumed = await createBrandContentOnboardingActionHandler(dependencies.value)(
      'resume_brand_content_onboarding',
      {
        workspace_id: workspaceId,
        run_id: runId,
        expected_revision: 1,
        expected_status: 'brand_generating',
        gate_evidence_id: 'brand-run-1',
        idempotency_key: 'resume-1',
      },
      { ...context, toolName: 'resume_brand_content_onboarding' },
    );
    expect(resumed.isError).not.toBe(true);
    expect(dependencies.resume).toHaveBeenCalledWith(expect.objectContaining({
      expectedStatus: 'brand_generating',
      gateEvidenceId: 'brand-run-1',
    }));
    expect(h.recordPaidCallOnce).not.toHaveBeenCalled();
  });
});
