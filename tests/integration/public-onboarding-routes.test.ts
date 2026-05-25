import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext } from './helpers.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { createWorkspace, deleteWorkspace, getWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13358); // port-ok: next free after 13357

let workspaceId = '';
let workspaceToken = '';
let workspaceClientUserId = '';

let otherWorkspaceId = '';
let otherWorkspaceToken = '';
let otherWorkspaceClientUserId = '';

function authCookie(wsId: string, token: string): string {
  return `client_user_token_${wsId}=${token}`;
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
}, 30_000);

afterAll(async () => {
  deleteClientUser(workspaceClientUserId, workspaceId);
  deleteClientUser(otherWorkspaceClientUserId, otherWorkspaceId);
  deleteWorkspace(workspaceId);
  deleteWorkspace(otherWorkspaceId);
  await ctx.stopServer();
});

describe('POST /api/public/onboarding/:id', () => {
  it('rejects unauthenticated submissions', async () => {
    const res = await ctx.api(`/api/public/onboarding/${workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  it('merges onboarding responses into workspace context with authenticated client JWT', async () => {
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

    const updated = getWorkspace(workspaceId);
    expect(updated).toBeDefined();
    expect(updated?.onboardingCompleted).toBe(true);

    expect(updated?.knowledgeBase).toContain('Existing KB context');
    expect(updated?.knowledgeBase).toContain('--- Client Onboarding Responses ---');
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
