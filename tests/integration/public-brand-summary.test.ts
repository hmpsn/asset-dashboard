import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { finalizeBrandVoice } from '../../server/domains/brand/voice-finalization.js';
import { updateVoiceProfile } from '../../server/voice-calibration.js';
import type { ClientBrandSummary } from '../../shared/types/brand-generation.js';
import type { BrandDeliverableType } from '../../shared/types/brand-engine.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, clearCookies } = ctx;

const PRIVATE_SENTINELS = [
  'DRAFT_CONTENT_SENTINEL',
  'DRAFT_VOICE_SENTINEL',
  'RAW_INTAKE_SENTINEL',
  'VOICE_SAMPLE_SENTINEL',
  'VOICE_DNA_PRIVATE_DETAIL',
  'VOICE_GUARDRAIL_SENTINEL',
  'INTERNAL_PROMPT_SENTINEL',
  'EVIDENCE_SENTINEL',
  'PROVENANCE_SENTINEL',
  'RUN_SOURCE_REF_SENTINEL',
] as const;

let workspaceId = '';
let emptyWorkspaceId = '';
let finalizedWorkspaceId = '';
let staleWorkspaceId = '';
let clientUserId = '';
let emptyClientUserId = '';
let finalizedClientUserId = '';
let staleClientUserId = '';
let clientToken = '';
let emptyClientToken = '';
let finalizedClientToken = '';
let staleClientToken = '';
let finalizedAt = '';
let cleanupWorkspace: (() => void) | undefined;
let cleanupEmptyWorkspace: (() => void) | undefined;
let cleanupFinalizedWorkspace: (() => void) | undefined;
let cleanupStaleWorkspace: (() => void) | undefined;

function clientCookie(targetWorkspaceId: string, token: string): string {
  return `client_user_token_${targetWorkspaceId}=${token}`;
}

function clientGet(
  path: string,
  cookieWorkspaceId: string,
  token: string,
): Promise<Response> {
  clearCookies();
  return api(path, {
    headers: { Cookie: clientCookie(cookieWorkspaceId, token) },
  });
}

function seedBrandDeliverable(input: {
  id: string;
  deliverableType: BrandDeliverableType;
  content: string;
  status: 'draft' | 'approved';
  version: number;
  tier?: 'essentials' | 'professional' | 'premium';
  updatedAt: string;
}): void {
  db.prepare(`
    INSERT INTO brand_identity_deliverables (
      id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    workspaceId,
    input.deliverableType,
    input.content,
    input.status,
    input.version,
    input.tier ?? 'essentials',
    '2026-07-10T12:00:00.000Z',
    input.updatedAt,
  );
}

function seedCalibratedVoiceProfile(targetWorkspaceId: string): {
  profileId: string;
  sampleId: string;
} {
  const profileId = `vp_brand_summary_${randomUUID()}`;
  db.prepare(`
    INSERT INTO voice_profiles (
      id, workspace_id, status, revision, voice_dna_json, guardrails_json,
      context_modifiers_json, created_at, updated_at
    ) VALUES (?, ?, 'calibrated', 4, ?, ?, ?, ?, ?)
  `).run(
    profileId,
    targetWorkspaceId,
    JSON.stringify({
      personalityTraits: ['Warm', 'Clear', 'Confident'],
      toneSpectrum: {
        formal_casual: 6,
        serious_playful: 4,
        technical_accessible: 8,
      },
      sentenceStyle: 'Direct sentences with a reassuring rhythm',
      vocabularyLevel: 'Plain-language',
      humorStyle: 'VOICE_DNA_PRIVATE_DETAIL',
    }),
    JSON.stringify({
      forbiddenWords: ['VOICE_GUARDRAIL_SENTINEL'],
      requiredTerminology: [],
      toneBoundaries: ['INTERNAL_PROMPT_SENTINEL'],
      antiPatterns: [],
    }),
    JSON.stringify([
      { context: 'Internal evidence', description: 'EVIDENCE_SENTINEL' },
    ]),
    '2026-07-11T12:00:00.000Z',
    '2026-07-13T12:00:00.000Z',
  );

  const sampleId = `vs_brand_summary_${randomUUID()}`;
  db.prepare(`
    INSERT INTO voice_samples (
      id, voice_profile_id, content, context_tag, source, sort_order, created_at
    ) VALUES (?, ?, ?, 'body', 'manual', 0, ?)
  `).run(
    sampleId,
    profileId,
    'VOICE_SAMPLE_SENTINEL',
    '2026-07-12T12:00:00.000Z',
  );
  return { profileId, sampleId };
}

const FINALIZED_VOICE_DNA = {
  personalityTraits: ['Warm', 'Clear', 'Confident'],
  toneSpectrum: {
    formal_casual: 6,
    serious_playful: 4,
    technical_accessible: 8,
  },
  sentenceStyle: 'Direct sentences with a reassuring rhythm',
  vocabularyLevel: 'Plain-language',
  humorStyle: 'VOICE_DNA_PRIVATE_DETAIL',
};

function finalizeSeededVoice(
  targetWorkspaceId: string,
  sampleId: string,
): string {
  const actor = {
    actorType: 'operator' as const,
    actorId: 'operator-brand-summary',
    actorLabel: 'Brand Summary Test Operator',
  };
  return finalizeBrandVoice({
    workspaceId: targetWorkspaceId,
    expectedProfileRevision: 4,
    voiceDNA: FINALIZED_VOICE_DNA,
    guardrails: {
      forbiddenWords: ['VOICE_GUARDRAIL_SENTINEL'],
      requiredTerminology: [],
      toneBoundaries: ['INTERNAL_PROMPT_SENTINEL'],
      antiPatterns: [],
    },
    contextModifiers: [
      { context: 'Internal evidence', description: 'EVIDENCE_SENTINEL' },
    ],
    anchorSelectors: [{ kind: 'voice_sample', voiceSampleId: sampleId }],
    calibrationSelections: [],
    idempotencyKey: `brand-summary-finalization-${randomUUID()}`,
    finalizedBy: actor,
    executionActor: actor,
  }).snapshot.finalizedAt;
}

function seedDraftVoiceProfile(): void {
  db.prepare(`
    INSERT INTO voice_profiles (
      id, workspace_id, status, revision, voice_dna_json, guardrails_json,
      context_modifiers_json, created_at, updated_at
    ) VALUES (?, ?, 'draft', 1, ?, ?, '[]', ?, ?)
  `).run(
    `vp_brand_summary_draft_${randomUUID()}`,
    emptyWorkspaceId,
    JSON.stringify({
      personalityTraits: ['DRAFT_VOICE_SENTINEL'],
      toneSpectrum: {
        formal_casual: 5,
        serious_playful: 5,
        technical_accessible: 5,
      },
      sentenceStyle: 'DRAFT_VOICE_SENTINEL',
      vocabularyLevel: 'DRAFT_VOICE_SENTINEL',
    }),
    JSON.stringify({
      forbiddenWords: [],
      requiredTerminology: [],
      toneBoundaries: [],
      antiPatterns: [],
    }),
    '2026-07-12T12:00:00.000Z',
    '2026-07-14T12:00:00.000Z',
  );
}

beforeAll(async () => {
  await ctx.startServer();

  const seeded = seedWorkspace({
    clientPassword: 'BrandSummaryPass1!',
    brandVoice: 'RAW_INTAKE_SENTINEL',
  });
  workspaceId = seeded.workspaceId;
  cleanupWorkspace = seeded.cleanup;

  const emptySeeded = seedWorkspace({ clientPassword: 'BrandSummaryPass2!' });
  emptyWorkspaceId = emptySeeded.workspaceId;
  cleanupEmptyWorkspace = emptySeeded.cleanup;

  const finalizedSeeded = seedWorkspace({ clientPassword: 'BrandSummaryPass3!' });
  finalizedWorkspaceId = finalizedSeeded.workspaceId;
  cleanupFinalizedWorkspace = finalizedSeeded.cleanup;

  const staleSeeded = seedWorkspace({ clientPassword: 'BrandSummaryPass4!' });
  staleWorkspaceId = staleSeeded.workspaceId;
  cleanupStaleWorkspace = staleSeeded.cleanup;

  const clientUser = await createClientUser(
    `brand-summary-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Brand Summary Client',
    workspaceId,
    'client_member',
  );
  clientUserId = clientUser.id;
  clientToken = signClientToken(clientUser);

  const emptyClientUser = await createClientUser(
    `brand-summary-empty-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Empty Brand Summary Client',
    emptyWorkspaceId,
    'client_member',
  );
  emptyClientUserId = emptyClientUser.id;
  emptyClientToken = signClientToken(emptyClientUser);

  const finalizedClientUser = await createClientUser(
    `brand-summary-finalized-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Finalized Brand Summary Client',
    finalizedWorkspaceId,
    'client_member',
  );
  finalizedClientUserId = finalizedClientUser.id;
  finalizedClientToken = signClientToken(finalizedClientUser);

  const staleClientUser = await createClientUser(
    `brand-summary-stale-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Stale Brand Summary Client',
    staleWorkspaceId,
    'client_member',
  );
  staleClientUserId = staleClientUser.id;
  staleClientToken = signClientToken(staleClientUser);

  seedBrandDeliverable({
    id: `brand_mission_${randomUUID()}`,
    deliverableType: 'mission',
    content: 'Make expert guidance feel clear and human.',
    status: 'approved',
    version: 3,
    updatedAt: '2026-07-12T12:00:00.000Z',
  });
  seedBrandDeliverable({
    id: `brand_values_${randomUUID()}`,
    deliverableType: 'values',
    content: 'Clarity first. Earn trust. Stay useful.',
    status: 'approved',
    version: 2,
    updatedAt: '2026-07-11T12:00:00.000Z',
  });
  seedBrandDeliverable({
    id: `brand_draft_${randomUUID()}`,
    deliverableType: 'tagline',
    content: [
      'DRAFT_CONTENT_SENTINEL',
      'INTERNAL_PROMPT_SENTINEL',
      'EVIDENCE_SENTINEL',
      'PROVENANCE_SENTINEL',
      'RUN_SOURCE_REF_SENTINEL',
    ].join(' '),
    status: 'draft',
    version: 9,
    updatedAt: '2026-07-14T12:00:00.000Z',
  });
  seedCalibratedVoiceProfile(workspaceId);
  seedDraftVoiceProfile();
  const finalizedVoice = seedCalibratedVoiceProfile(finalizedWorkspaceId);
  finalizedAt = finalizeSeededVoice(finalizedWorkspaceId, finalizedVoice.sampleId);
  const staleVoice = seedCalibratedVoiceProfile(staleWorkspaceId);
  finalizeSeededVoice(staleWorkspaceId, staleVoice.sampleId);
  updateVoiceProfile(staleWorkspaceId, {
    voiceDNA: {
      ...FINALIZED_VOICE_DNA,
      sentenceStyle: 'STALE_EDIT_SENTINEL',
    },
  });
}, 30_000);

afterAll(async () => {
  await ctx.stopServer();

  if (clientUserId) deleteClientUser(clientUserId, workspaceId);
  if (emptyClientUserId) deleteClientUser(emptyClientUserId, emptyWorkspaceId);
  if (finalizedClientUserId) {
    deleteClientUser(finalizedClientUserId, finalizedWorkspaceId);
  }
  if (staleClientUserId) deleteClientUser(staleClientUserId, staleWorkspaceId);
  cleanupWorkspace?.();
  cleanupEmptyWorkspace?.();
  cleanupFinalizedWorkspace?.();
  cleanupStaleWorkspace?.();
});

describe('GET /api/public/brand-summary/:workspaceId', () => {
  it('requires an authenticated client-portal actor', async () => {
    clearCookies();
    const response = await api(`/api/public/brand-summary/${workspaceId}`, {
      headers: { 'x-no-auto-public-auth': 'true' },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required. Please log in to the dashboard.',
    });
  });

  it('rejects a client token scoped to another workspace', async () => {
    const response = await clientGet(
      `/api/public/brand-summary/${workspaceId}`,
      emptyWorkspaceId,
      emptyClientToken,
    );

    expect(response.status).toBe(401);
  });

  it('returns an approved-only projection and hides legacy calibrated voice without a snapshot', async () => {
    const response = await clientGet(
      `/api/public/brand-summary/${workspaceId}`,
      workspaceId,
      clientToken,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as ClientBrandSummary;

    expect(Object.keys(body).sort()).toEqual([
      'approvedDeliverables',
      'updatedAt',
      'voiceSummary',
      'workspaceId',
    ]);
    expect(body).toEqual({
      workspaceId,
      approvedDeliverables: [
        {
          deliverableType: 'mission',
          content: 'Make expert guidance feel clear and human.',
          version: 3,
        },
        {
          deliverableType: 'values',
          content: 'Clarity first. Earn trust. Stay useful.',
          version: 2,
        },
      ],
      voiceSummary: null,
      updatedAt: '2026-07-12T12:00:00.000Z',
    });

    for (const deliverable of body.approvedDeliverables) {
      expect(Object.keys(deliverable).sort()).toEqual([
        'content',
        'deliverableType',
        'version',
      ]);
    }

    const serialized = JSON.stringify(body);
    for (const sentinel of PRIVATE_SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }
    for (const privateField of [
      'voiceDNA',
      'guardrails',
      'contextModifiers',
      'samples',
      'intake',
      'evidence',
      'prompt',
      'provenance',
      'runId',
      'sourceRef',
      'expectedDeliverableVersion',
      'decidedBy',
    ]) {
      expect(serialized).not.toContain(privateField);
    }
  });

  it('renders voice only from the current immutable finalized snapshot', async () => {
    const response = await clientGet(
      `/api/public/brand-summary/${finalizedWorkspaceId}`,
      finalizedWorkspaceId,
      finalizedClientToken,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as ClientBrandSummary;
    expect(body).toEqual({
      workspaceId: finalizedWorkspaceId,
      approvedDeliverables: [],
      voiceSummary: 'Warm, Clear, Confident — Direct sentences with a reassuring rhythm, Plain-language vocabulary',
      updatedAt: finalizedAt,
    });
    const serialized = JSON.stringify(body);
    for (const sentinel of PRIVATE_SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('fails closed when the mutable profile was edited after finalization', async () => {
    const response = await clientGet(
      `/api/public/brand-summary/${staleWorkspaceId}`,
      staleWorkspaceId,
      staleClientToken,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as ClientBrandSummary;
    expect(body.approvedDeliverables).toEqual([]);
    expect(body.voiceSummary).toBeNull();
    expect(body.updatedAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain('STALE_EDIT_SENTINEL');
    expect(JSON.stringify(body)).not.toContain('VOICE_DNA_PRIVATE_DETAIL');
  });

  it('returns an honest empty summary without exposing draft or legacy voice data', async () => {
    const response = await clientGet(
      `/api/public/brand-summary/${emptyWorkspaceId}`,
      emptyWorkspaceId,
      emptyClientToken,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as ClientBrandSummary;
    expect(body.workspaceId).toBe(emptyWorkspaceId);
    expect(body.approvedDeliverables).toEqual([]);
    expect(body.voiceSummary).toBeNull();
    expect(body.updatedAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain('DRAFT_VOICE_SENTINEL');
  });

  it('returns 404 for an unknown workspace before exposing whether any brand data exists', async () => {
    const response = await clientGet(
      '/api/public/brand-summary/ws_brand_summary_missing',
      workspaceId,
      clientToken,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Workspace not found' });
  });
});
