import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralTestContext } from './helpers.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import db from '../../server/db/index.js';
import { signToken } from '../../server/auth.js';
import { createUser, deleteUser } from '../../server/users.js';
import { createWorkspace, deleteWorkspace, getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import type { BrandIntakeQuestionnaireData } from '../../shared/types/brand-intake.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });

let workspaceId = '';
let workspaceToken = '';
let workspaceClientUserId = '';

let otherWorkspaceId = '';
let otherWorkspaceToken = '';
let otherWorkspaceClientUserId = '';
let historyWorkspaceId = '';
let historyWorkspaceToken = '';
let historyWorkspaceClientUserId = '';
let serializerWorkspaceId = '';
let internalOperatorId = '';
let internalOperatorToken = '';

function authCookie(wsId: string, token: string): string {
  return `client_user_token_${wsId}=${token}`;
}

function questionnaire(
  businessName = 'Acme Labs',
): BrandIntakeQuestionnaireData {
  return {
    business: {
      businessName,
      industry: 'SaaS',
      description: 'We build workflow software.',
      services: 'Migration support\nAutomation setup',
      locations: 'USA, Canada',
      differentiators: 'Fast onboarding',
      website: 'https://acme.example.com',
    },
    audience: {
      primaryAudience: 'Marketing teams at midsize SaaS companies',
      secondaryAudience: 'RevOps leaders',
      painPoints: 'Slow reporting\nManual data reconciliation',
      goals: 'Increase pipeline velocity\nReduce operational drag',
      objections: 'Concerned about migration effort',
      buyingStage: 'consideration',
    },
    brand: {
      personality: ['authoritative', 'friendly'],
      tone: 'Confident, clear, practical',
      avoidWords: 'Synergy, disruption',
      contentFormats: ['How-to guides', 'Case studies'],
      existingExamples: 'https://acme.example.com/blog',
    },
    competitors: {
      competitors: 'https://www.duplicate.com\nhttps://new-competitor.example.com',
      whatTheyDoBetter: 'Publish more frequently',
      whatYouDoBetter: 'Better implementation quality',
      referenceUrls: '',
    },
  };
}

function countBrandIntakeRevisions(targetWorkspaceId = workspaceId): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count
    FROM brand_intake_revisions
    WHERE workspace_id = ?
  `).get(targetWorkspaceId) as { count: number }).count;
}

function countOnboardingActivities(targetWorkspaceId = workspaceId): number {
  return (db.prepare(`
    SELECT COUNT(*) AS count
    FROM activity_log
    WHERE workspace_id = ? AND type = 'client_onboarding_submitted'
  `).get(targetWorkspaceId) as { count: number }).count;
}

beforeAll(async () => {
  await ctx.startServer();

  const workspace = createWorkspace('Public Onboarding Route Test Workspace');
  workspaceId = workspace.id;
  updateWorkspace(workspaceId, {
    knowledgeBase: 'Existing KB context',
    brandVoice: 'Existing voice context',
    competitorDomains: ['existing.com', 'duplicate.com'],
    personas: [{
      id: 'persona-existing',
      name: 'Existing Persona',
      description: 'Existing persona description',
      painPoints: ['Existing pain point'],
      goals: ['Existing goal'],
      objections: ['Existing objection'],
    }],
  });

  const otherWorkspace = createWorkspace('Public Onboarding Route Other Workspace');
  otherWorkspaceId = otherWorkspace.id;

  historyWorkspaceId = createWorkspace('Public Onboarding Route History Workspace').id;
  serializerWorkspaceId = createWorkspace('Public Onboarding Route Serializer Workspace').id;

  const workspaceClientUser = await createClientUser(
    'public-onboarding-routes@test.local',
    'ClientPass1!',
    'Public Onboarding Client',
    workspaceId,
    'client_member',
  );
  workspaceClientUserId = workspaceClientUser.id;
  workspaceToken = signClientToken(workspaceClientUser);

  const otherWorkspaceClientUser = await createClientUser(
    'public-onboarding-routes-other@test.local',
    'ClientPass1!',
    'Public Onboarding Other Client',
    otherWorkspaceId,
    'client_member',
  );
  otherWorkspaceClientUserId = otherWorkspaceClientUser.id;
  otherWorkspaceToken = signClientToken(otherWorkspaceClientUser);

  const historyWorkspaceClientUser = await createClientUser(
    'public-onboarding-routes-history@test.local',
    'ClientPass1!',
    'Public Onboarding History Client',
    historyWorkspaceId,
    'client_member',
  );
  historyWorkspaceClientUserId = historyWorkspaceClientUser.id;
  historyWorkspaceToken = signClientToken(historyWorkspaceClientUser);

  const internalOperator = await createUser(
    'public-onboarding-routes-operator@test.local',
    'OperatorPass1!',
    'Public Onboarding Operator',
    'member',
    [otherWorkspaceId],
  );
  internalOperatorId = internalOperator.id;
  internalOperatorToken = signToken({
    userId: internalOperator.id,
    email: internalOperator.email,
    role: internalOperator.role,
  });
}, 30_000);

afterAll(async () => {
  deleteClientUser(workspaceClientUserId, workspaceId);
  deleteClientUser(otherWorkspaceClientUserId, otherWorkspaceId);
  deleteClientUser(historyWorkspaceClientUserId, historyWorkspaceId);
  deleteUser(internalOperatorId);
  deleteWorkspace(workspaceId);
  deleteWorkspace(otherWorkspaceId);
  deleteWorkspace(historyWorkspaceId);
  deleteWorkspace(serializerWorkspaceId);
  await ctx.stopServer();
});

describe('POST /api/public/onboarding/:id', () => {
  it('rejects unauthenticated submissions', async () => {
    const res = await ctx.api(`/api/public/onboarding/${workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-no-auto-public-auth': 'true' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('rejects cross-workspace client JWTs', async () => {
    const res = await ctx.api(`/api/public/onboarding/${workspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie(workspaceId, otherWorkspaceToken),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('attributes HMAC and internal-JWT submissions to operators, never client engagement', async () => {
    const adminSeed = await ctx.api(`/api/public/onboarding/${otherWorkspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(questionnaire('Operator Seed')),
    });
    expect(adminSeed.status).toBe(200);

    const internalSeed = await ctx.api(`/api/public/onboarding/${otherWorkspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalOperatorToken}`,
      },
      body: JSON.stringify(questionnaire('Operator Seed')),
    });
    expect(internalSeed.status).toBe(200);

    const revisions = db.prepare(`
      SELECT revision, source,
        json_extract(submitter_json, '$.actorType') AS actorType,
        json_extract(submitter_json, '$.actorId') AS actorId
      FROM brand_intake_revisions
      WHERE workspace_id = ?
      ORDER BY revision
    `).all(otherWorkspaceId) as Array<{
      revision: number;
      source: string;
      actorType: string;
      actorId: string;
    }>;
    expect(revisions).toEqual([
      { revision: 1, source: 'admin', actorType: 'operator', actorId: 'admin-hmac' },
      { revision: 2, source: 'admin', actorType: 'operator', actorId: internalOperatorId },
    ]);

    const activityCounts = db.prepare(`
      SELECT type, COUNT(*) AS count
      FROM activity_log
      WHERE workspace_id = ?
        AND type IN ('brand_intake_submitted', 'client_onboarding_submitted')
      GROUP BY type
      ORDER BY type
    `).all(otherWorkspaceId) as Array<{ type: string; count: number }>;
    expect(activityCounts).toEqual([{ type: 'brand_intake_submitted', count: 2 }]);
  });

  it('persists, projects, and replays an identical authenticated client submission without duplicate effects', async () => {
    db.prepare(`
      INSERT INTO intelligence_sub_cache (workspace_id, cache_key, ttl_seconds, data)
      VALUES (?, 'brand-intake-route-test', 300, '{}')
    `).run(workspaceId);

    const res = await ctx.api(`/api/public/onboarding/${workspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie(workspaceId, workspaceToken),
      },
      body: JSON.stringify({
        business: {
          businessName: 'Acme Labs',
          industry: 'SaaS',
          description: 'We build workflow software.',
          services: 'Migration support\nAutomation setup',
          locations: 'USA, Canada',
          differentiators: 'Fast onboarding',
          website: 'https://acme.example.com',
        },
        audience: {
          primaryAudience: 'Marketing teams at midsize SaaS companies',
          secondaryAudience: 'RevOps leaders',
          painPoints: 'Slow reporting\nManual data reconciliation',
          goals: 'Increase pipeline velocity\nReduce operational drag',
          objections: 'Concerned about migration effort',
          buyingStage: 'consideration',
        },
        brand: {
          personality: ['authoritative', 'friendly'],
          tone: 'Confident, clear, practical',
          avoidWords: 'Synergy, disruption',
          contentFormats: ['How-to guides', 'Case studies'],
          existingExamples: 'https://acme.example.com/blog',
        },
        competitors: {
          competitors: 'https://www.duplicate.com\nhttps://new-competitor.example.com',
          whatTheyDoBetter: 'Publish more frequently',
          whatYouDoBetter: 'Better implementation quality',
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      message: 'Onboarding responses saved successfully',
    });

    expect(countBrandIntakeRevisions()).toBe(1);
    expect(countOnboardingActivities()).toBe(1);
    expect(db.prepare(`
      SELECT invalidated_at AS invalidatedAt
      FROM intelligence_sub_cache
      WHERE workspace_id = ? AND cache_key = 'brand-intake-route-test'
    `).get(workspaceId)).toMatchObject({ invalidatedAt: expect.any(String) });

    const stored = db.prepare(`
      SELECT
        json_extract(submitter_json, '$.actorType') AS actorType,
        json_extract(submitter_json, '$.actorId') AS actorId,
        json_extract(submitter_json, '$.actorLabel') AS actorLabel
      FROM brand_intake_revisions
      WHERE workspace_id = ?
    `).get(workspaceId) as { actorType: string; actorId: string; actorLabel: string };
    expect(stored).toEqual({
      actorType: 'client',
      actorId: workspaceClientUserId,
      actorLabel: 'Public Onboarding Client',
    });

    const updated = getWorkspace(workspaceId);
    expect(updated).toBeDefined();
    expect(updated?.onboardingCompleted).toBe(true);

    expect(updated?.knowledgeBase).toContain('Existing KB context');
    expect(updated?.knowledgeBase).toContain('--- BRAND INTAKE KNOWLEDGE — MANAGED ---');
    expect(updated?.knowledgeBase).toContain('Business Name: Acme Labs');
    expect(updated?.knowledgeBase).toContain('Competitor Strengths: Publish more frequently');

    expect(updated?.brandVoice).toContain('Existing voice context');
    expect(updated?.brandVoice).toContain('Brand Personality: authoritative, friendly');
    expect(updated?.brandVoice).toContain('Tone: Confident, clear, practical');

    expect(updated?.personas?.length).toBeGreaterThanOrEqual(3);
    expect(updated?.personas?.some(persona => persona.name === 'Existing Persona')).toBe(true);
    expect(updated?.personas?.some(persona => persona.description.includes('Marketing teams at midsize SaaS companies'))).toBe(true);
    expect(updated?.personas?.some(persona => persona.description.includes('RevOps leaders'))).toBe(true);

    expect(updated?.competitorDomains).toContain('existing.com');
    expect(updated?.competitorDomains).toContain('duplicate.com');
    expect(updated?.competitorDomains).toContain('new-competitor.example.com');
    expect(updated?.competitorDomains?.filter(domain => domain === 'duplicate.com').length).toBe(1);

    db.prepare(`
      UPDATE intelligence_sub_cache
      SET invalidated_at = NULL
      WHERE workspace_id = ? AND cache_key = 'brand-intake-route-test'
    `).run(workspaceId);
    const replay = await ctx.api(`/api/public/onboarding/${workspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie(workspaceId, workspaceToken),
      },
      body: JSON.stringify(questionnaire()),
    });
    expect(replay.status).toBe(200);
    expect(countBrandIntakeRevisions()).toBe(1);
    expect(countOnboardingActivities()).toBe(1);
    expect(db.prepare(`
      SELECT invalidated_at AS invalidatedAt
      FROM intelligence_sub_cache
      WHERE workspace_id = ? AND cache_key = 'brand-intake-route-test'
    `).get(workspaceId)).toEqual({ invalidatedAt: null });
  });

  it('creates immutable successors for changed answers, including A to B to A', async () => {
    const initialRes = await ctx.api(`/api/public/onboarding/${historyWorkspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie(historyWorkspaceId, historyWorkspaceToken),
      },
      body: JSON.stringify(questionnaire()),
    });
    expect(initialRes.status).toBe(200);

    const changed = questionnaire('Acme Labs B');
    const changedRes = await ctx.api(`/api/public/onboarding/${historyWorkspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie(historyWorkspaceId, historyWorkspaceToken),
      },
      body: JSON.stringify(changed),
    });
    expect(changedRes.status).toBe(200);

    const revertedRes = await ctx.api(`/api/public/onboarding/${historyWorkspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie(historyWorkspaceId, historyWorkspaceToken),
      },
      body: JSON.stringify(questionnaire()),
    });
    expect(revertedRes.status).toBe(200);
    expect(countBrandIntakeRevisions(historyWorkspaceId)).toBe(3);
    expect(countOnboardingActivities(historyWorkspaceId)).toBe(3);

    const revisions = db.prepare(`
      SELECT revision, json_extract(payload_json, '$.business.businessName') AS businessName
      FROM brand_intake_revisions
      WHERE workspace_id = ?
      ORDER BY revision
    `).all(historyWorkspaceId) as Array<{ revision: number; businessName: string }>;
    expect(revisions.map(row => row.revision)).toEqual([1, 2, 3]);
    expect(revisions.map(row => row.businessName)).toEqual(['Acme Labs', 'Acme Labs B', 'Acme Labs']);
  });

  it('returns 400 for malformed questionnaire fields', async () => {
    const revisionCountBefore = countBrandIntakeRevisions();
    const malformed = questionnaire();
    malformed.business.website = 'not-a-url';
    const res = await ctx.api(`/api/public/onboarding/${workspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie(workspaceId, workspaceToken),
      },
      body: JSON.stringify(malformed),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('business.website'),
    });
    expect(countBrandIntakeRevisions()).toBe(revisionCountBefore);
  });

  it('keeps raw brand intake out of the public workspace serializer', async () => {
    const seeded = await ctx.api(`/api/public/onboarding/${serializerWorkspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(questionnaire('Serializer Secret Brand')),
    });
    expect(seeded.status).toBe(200);
    expect(countBrandIntakeRevisions(serializerWorkspaceId)).toBe(1);

    const res = await ctx.api(`/api/public/workspace/${serializerWorkspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('brandIntake');
    expect(body).not.toHaveProperty('brandIntakeRevision');
    expect(body).not.toHaveProperty('knowledgeBase');
    expect(body).not.toHaveProperty('brandVoice');
    expect(body).not.toHaveProperty('personas');
    expect(body).not.toHaveProperty('competitorDomains');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('Serializer Secret Brand');
    expect(serialized).not.toContain('Marketing teams at midsize SaaS companies');
  });

  it('returns 404 for unknown workspaces', async () => {
    const res = await ctx.api('/api/public/onboarding/ws_does_not_exist_onboarding_route', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: authCookie(workspaceId, workspaceToken),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });
});
