import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BrandIntakePayload } from '../../shared/types/brand-intake.js';
import { brandIntakePayloadSchema } from '../../shared/types/brand-intake-schemas.js';
import db from '../../server/db/index.js';
import { submitBrandIntake } from '../../server/domains/brand/intake/index.js';
import { signToken } from '../../server/auth.js';
import { createUser, deleteUser } from '../../server/users.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);

let workspaceId = '';
let emptyWorkspaceId = '';
let otherWorkspaceId = '';
let operatorId = '';
let operatorToken = '';
let intakeRevisionId = '';
let otherIntakeRevisionId = '';

function payload(businessName = 'Brand Intake Route Co'): BrandIntakePayload {
  return brandIntakePayloadSchema.parse({
    schemaVersion: 1,
    business: {
      businessName,
      industry: 'Professional services',
      description: 'A grounded brand intake route fixture.',
      services: 'Strategy\nImplementation',
      locations: 'Chicago',
      differentiators: 'Evidence-first recommendations',
      website: 'https://brand-intake-route.example',
    },
    audience: {
      primaryAudience: 'Operations leaders',
      painPoints: 'Disconnected systems',
      goals: 'Ship dependable improvements',
      objections: 'Implementation risk',
      buyingStage: 'consideration',
      secondaryAudience: '',
    },
    brand: {
      tone: 'Direct and calm',
      personality: ['Clear', 'Practical'],
      avoidWords: 'Guaranteed',
      contentFormats: ['Guides'],
      existingExamples: '',
    },
    competitors: {
      competitors: 'https://competitor-route.example',
      whatTheyDoBetter: 'Publish more often',
      whatYouDoBetter: 'Ground every claim',
      referenceUrls: 'https://competitor-route.example/about',
    },
    authenticSamples: [],
  });
}

function operatorHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${operatorToken}` };
}

function resolutionBody(idempotencyKey = 'brand-intake-route-resolve-website') {
  return {
    expectedRevision: 1,
    requirementId: 'brand-intake:business.website',
    fieldPath: 'business.website',
    value: { kind: 'url', value: 'https://verified-brand-intake.example' },
    sourceRef: {
      sourceType: 'operator_attestation',
      sourceId: 'brand-intake-route-attestation',
      fieldPath: 'business.website',
      capturedAt: '2026-07-13T12:00:00.000Z',
    },
    idempotencyKey,
  } as const;
}

function countEvidenceActivities(): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count
    FROM activity_log
    WHERE workspace_id = ? AND type = 'brand_intake_evidence_resolved'
  `).get(workspaceId) as { count: number }).count;
}

beforeAll(async () => {
  await ctx.startServer();

  workspaceId = createWorkspace('Brand Intake Admin Route Workspace').id;
  emptyWorkspaceId = createWorkspace('Brand Intake Empty Route Workspace').id;
  otherWorkspaceId = createWorkspace('Brand Intake Other Route Workspace').id;

  const operator = await createUser(
    `brand-intake-route-${randomUUID()}@test.local`,
    'BrandIntakeRoutePass1!',
    'Brand Intake Operator',
    'member',
    [workspaceId, emptyWorkspaceId],
  );
  operatorId = operator.id;
  operatorToken = signToken({ userId: operator.id, email: operator.email, role: operator.role });

  intakeRevisionId = submitBrandIntake({
    workspaceId,
    payload: payload(),
    source: 'admin',
    submitter: { actorType: 'operator', actorId: 'seed-operator' },
  }).revision.id;
  otherIntakeRevisionId = submitBrandIntake({
    workspaceId: otherWorkspaceId,
    payload: payload('Other Workspace Brand'),
    source: 'admin',
    submitter: { actorType: 'operator', actorId: 'seed-operator' },
  }).revision.id;
}, 30_000);

afterAll(async () => {
  deleteUser(operatorId);
  deleteWorkspace(workspaceId);
  deleteWorkspace(emptyWorkspaceId);
  deleteWorkspace(otherWorkspaceId);
  await ctx.stopServer();
});

describe('brand intake admin routes', () => {
  it('returns the current intake and a stable empty result when no intake exists', async () => {
    const current = await ctx.api(`/api/brand-intake/${workspaceId}`, {
      headers: operatorHeaders(),
    });
    expect(current.status).toBe(200);
    const currentBody = await current.json() as {
      revision: { id: string; revision: number; payload: BrandIntakePayload };
      fieldEvidence: Array<{ fieldPath: string; availability: string }>;
    };
    expect(currentBody.revision).toMatchObject({
      id: intakeRevisionId,
      revision: 1,
      payload: { business: { businessName: 'Brand Intake Route Co' } },
    });
    expect(currentBody.fieldEvidence).toHaveLength(22);

    const empty = await ctx.api(`/api/brand-intake/${emptyWorkspaceId}`, {
      headers: operatorHeaders(),
    });
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ revision: null, fieldEvidence: [] });
  });

  it('enforces workspace scope before reading or mutating another workspace intake', async () => {
    const read = await ctx.api(`/api/brand-intake/${otherWorkspaceId}`, {
      headers: operatorHeaders(),
    });
    expect(read.status).toBe(403);

    const mutate = await ctx.api(
      `/api/brand-intake/${otherWorkspaceId}/${otherIntakeRevisionId}/evidence-resolutions`,
      {
        method: 'POST',
        headers: { ...operatorHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(resolutionBody('cross-workspace-attempt')),
      },
    );
    expect(mutate.status).toBe(403);
  });

  it('returns 400 before mutation when the shared evidence body contract fails', async () => {
    const invalid = {
      ...resolutionBody('invalid-requirement-pair'),
      requirementId: 'brand-intake:business.industry',
    };
    const res = await ctx.api(
      `/api/brand-intake/${workspaceId}/${intakeRevisionId}/evidence-resolutions`,
      {
        method: 'POST',
        headers: { ...operatorHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(invalid),
      },
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('requirementId'),
    });
    expect(countEvidenceActivities()).toBe(0);
  });

  it('creates one server-attributed resolution, replays it without effects, and maps conflicts', async () => {
    db.prepare(`
      INSERT INTO intelligence_sub_cache (workspace_id, cache_key, ttl_seconds, data)
      VALUES (?, 'brand-intake-admin-route-test', 300, '{}')
    `).run(workspaceId);
    const body = resolutionBody();
    const path = `/api/brand-intake/${workspaceId}/${intakeRevisionId}/evidence-resolutions`;
    const created = await ctx.api(path, {
      method: 'POST',
      headers: { ...operatorHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      created: boolean;
      replayed: boolean;
      revision: {
        id: string;
        revision: number;
        submitter: { actorType: string; actorId: string; actorLabel?: string };
        evidenceResolutions: Array<{
          resolvedBy: { actorType: string; actorId: string; actorLabel?: string };
        }>;
      };
    };
    expect(createdBody).toMatchObject({ created: true, replayed: false });
    expect(createdBody.revision).toMatchObject({
      revision: 2,
      submitter: {
        actorType: 'operator',
        actorId: operatorId,
        actorLabel: 'Brand Intake Operator',
      },
      evidenceResolutions: [{
        resolvedBy: {
          actorType: 'operator',
          actorId: operatorId,
          actorLabel: 'Brand Intake Operator',
        },
      }],
    });
    expect(countEvidenceActivities()).toBe(1);
    expect(db.prepare(`
      SELECT actor_id AS actorId, actor_name AS actorName,
        json_extract(metadata, '$.cause') AS cause
      FROM activity_log
      WHERE workspace_id = ? AND type = 'brand_intake_evidence_resolved'
    `).get(workspaceId)).toEqual({
      actorId: operatorId,
      actorName: 'Brand Intake Operator',
      cause: 'evidence_resolution',
    });
    expect(db.prepare(`
      SELECT invalidated_at AS invalidatedAt
      FROM intelligence_sub_cache
      WHERE workspace_id = ? AND cache_key = 'brand-intake-admin-route-test'
    `).get(workspaceId)).toMatchObject({ invalidatedAt: expect.any(String) });

    db.prepare(`
      UPDATE intelligence_sub_cache
      SET invalidated_at = NULL
      WHERE workspace_id = ? AND cache_key = 'brand-intake-admin-route-test'
    `).run(workspaceId);
    const replay = await ctx.api(path, {
      method: 'POST',
      headers: { ...operatorHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      created: false,
      replayed: true,
      revision: { id: createdBody.revision.id, revision: 2 },
    });
    expect(countEvidenceActivities()).toBe(1);
    expect(db.prepare(`
      SELECT invalidated_at AS invalidatedAt
      FROM intelligence_sub_cache
      WHERE workspace_id = ? AND cache_key = 'brand-intake-admin-route-test'
    `).get(workspaceId)).toEqual({ invalidatedAt: null });

    const idempotencyConflict = await ctx.api(path, {
      method: 'POST',
      headers: { ...operatorHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        value: { kind: 'url', value: 'https://different-verification.example' },
      }),
    });
    expect(idempotencyConflict.status).toBe(409);
    await expect(idempotencyConflict.json()).resolves.toMatchObject({
      code: 'brand_intake_idempotency_conflict',
    });

    const stale = await ctx.api(path, {
      method: 'POST',
      headers: { ...operatorHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(resolutionBody('brand-intake-stale-resolution')),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: 'brand_intake_revision_conflict',
      expectedRevision: 1,
      actualRevision: 2,
    });

    const missing = await ctx.api(
      `/api/brand-intake/${workspaceId}/intake_missing/evidence-resolutions`,
      {
        method: 'POST',
        headers: { ...operatorHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...resolutionBody('brand-intake-missing-resolution'),
          expectedRevision: 2,
        }),
      },
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      code: 'brand_intake_revision_not_found',
    });
    expect(countEvidenceActivities()).toBe(1);

    const read = await ctx.api(`/api/brand-intake/${workspaceId}`, {
      headers: operatorHeaders(),
    });
    expect(read.status).toBe(200);
    const readBody = await read.json() as {
      revision: { revision: number };
      fieldEvidence: Array<{ fieldPath: string; availability: string }>;
    };
    expect(readBody.revision.revision).toBe(2);
    expect(readBody.fieldEvidence.find(item => item.fieldPath === 'business.website'))
      .toMatchObject({ availability: 'resolved' });
  });
});
