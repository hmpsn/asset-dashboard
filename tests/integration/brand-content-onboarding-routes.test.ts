import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signToken } from '../../server/auth.js';
import db from '../../server/db/index.js';
import { createBrandContentOnboardingRun } from '../../server/domains/brand-content-onboarding/repository.js';
import { createUser, deleteUser } from '../../server/users.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const intakeFingerprint = 'a'.repeat(64);
let workspaceId = '';
let otherWorkspaceId = '';
let intakeRevisionId = '';
let runId = '';
let operatorId = '';
let operatorToken = '';

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${operatorToken}` };
}

function matrixSelection() {
  return [{
    matrixId: 'matrix-1',
    cellId: 'cell-1',
    sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 3 },
    structuralFingerprint: 'b'.repeat(64),
    previewFingerprint: null,
  }] as const;
}

beforeAll(async () => {
  await ctx.startServer();
  workspaceId = createWorkspace('Brand Content Onboarding Routes').id;
  otherWorkspaceId = createWorkspace('Brand Content Onboarding Other Workspace').id;
  intakeRevisionId = `intake-${workspaceId}`;
  db.prepare(`
    INSERT INTO brand_intake_revisions (
      id, workspace_id, revision, schema_version, payload_json,
      evidence_resolutions_json, projection_state_json, fingerprint, source,
      submitter_json, mutation_kind, mutation_fingerprint, idempotency_key,
      supersedes_revision_id, created_at
    ) VALUES (?, ?, 1, 1, '{}', '[]',
      '{"preservedCompetitorDomains":[],"intakeOwnedCompetitorDomains":[]}',
      ?, 'admin', '{"actorType":"operator","actorId":"route-seed"}',
      'submission', ?, NULL, NULL, ?)
  `).run(
    intakeRevisionId,
    workspaceId,
    intakeFingerprint,
    '1'.repeat(64),
    '2026-07-14T00:00:00.000Z',
  );
  runId = createBrandContentOnboardingRun({
    workspaceId,
    intakeRevision: { intakeRevisionId, revision: 1, fingerprint: intakeFingerprint },
    matrixSelection: matrixSelection(),
    brandBudget: {
      maxProviderCalls: 20,
      maxInputTokens: 10_000,
      maxOutputTokens: 5_000,
      maxEstimatedCostMicros: 10_000,
      maxConcurrency: 1,
    },
    idempotencyKey: 'route-seed',
    createdBy: { actorType: 'operator', actorId: 'route-seed' },
    intakeEvidence: {
      id: 'route-intake-accepted',
      gate: 'intake_accepted',
      intakeRevision: { intakeRevisionId, revision: 1, fingerprint: intakeFingerprint },
      recordedBy: { actorType: 'operator', actorId: 'route-seed' },
      recordedAt: '2026-07-14T00:00:00.000Z',
    },
  }).run.id;
  const operator = await createUser(
    `brand-content-onboarding-${randomUUID()}@test.local`,
    'BrandContentRoutePass1!',
    'Onboarding Operator',
    'member',
    [workspaceId],
  );
  operatorId = operator.id;
  operatorToken = signToken({
    userId: operator.id,
    email: operator.email,
    role: operator.role,
  });
}, 30_000);

afterAll(async () => {
  deleteUser(operatorId);
  deleteWorkspace(workspaceId);
  deleteWorkspace(otherWorkspaceId);
  await ctx.stopServer();
});

describe('brand content onboarding HTTP adapters', () => {
  it('returns the safe durable projection and enforces workspace scope', async () => {
    const response = await ctx.api(
      `/api/brand-content-onboarding/${workspaceId}/runs/${runId}`,
      { headers: headers() },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      id: runId,
      workspaceId,
      status: 'intake_ready',
      createdBy: { actorType: 'operator', actorId: 'route-seed' },
    });
    expect(body).not.toHaveProperty('idempotencyKey');

    const forbidden = await ctx.api(
      `/api/brand-content-onboarding/${otherWorkspaceId}/runs/${runId}`,
      { headers: headers() },
    );
    expect(forbidden.status).toBe(403);
  });

  it('validates commands and keeps disabled paid orchestration closed', async () => {
    const invalid = await ctx.api(
      `/api/brand-content-onboarding/${workspaceId}/runs`,
      {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ intakeRevisionId }),
      },
    );
    expect(invalid.status).toBe(400);

    const disabled = await ctx.api(
      `/api/brand-content-onboarding/${workspaceId}/runs`,
      {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intakeRevisionId,
          expectedIntakeRevision: 1,
          expectedIntakeFingerprint: intakeFingerprint,
          matrixSelection: matrixSelection(),
          brandBudget: {
            maxProviderCalls: 20,
            maxInputTokens: 10_000,
            maxOutputTokens: 5_000,
            maxEstimatedCostMicros: 10_000,
            maxConcurrency: 1,
          },
          idempotencyKey: 'disabled-route-start',
        }),
      },
    );
    expect(disabled.status).toBe(403);
    await expect(disabled.json()).resolves.toMatchObject({ code: 'feature_disabled' });

    const invalidPreview = await ctx.api(
      `/api/brand-content-onboarding/${workspaceId}/runs/${runId}/content-authorization-preview`,
      {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: 0 }),
      },
    );
    expect(invalidPreview.status).toBe(400);

    const disabledPreview = await ctx.api(
      `/api/brand-content-onboarding/${workspaceId}/runs/${runId}/content-authorization-preview`,
      {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: 0,
          expectedStatus: 'awaiting_content_authorization',
        }),
      },
    );
    expect(disabledPreview.status).toBe(403);
    await expect(disabledPreview.json()).resolves.toMatchObject({ code: 'feature_disabled' });

    const forbiddenPreview = await ctx.api(
      `/api/brand-content-onboarding/${otherWorkspaceId}/runs/${runId}/content-authorization-preview`,
      {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: 0,
          expectedStatus: 'awaiting_content_authorization',
        }),
      },
    );
    expect(forbiddenPreview.status).toBe(403);
  });
});
