import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CreateVoiceFinalizationAuthorizationRequest,
  FinalizeBrandVoiceRequest,
} from '../../shared/types/voice-finalization.js';
import { brandIntakePayloadSchema } from '../../shared/types/brand-intake-schemas.js';
import db from '../../server/db/index.js';
import {
  createVoiceFinalizationAuthorization,
  consumeVoiceFinalizationAuthorization,
  finalizeBrandVoice,
  getFinalizedVoiceSnapshotForGeneration,
  getBrandVoiceReadiness,
  VoiceFinalizationAuthorizationError,
  VoiceFinalizationConflictError,
  VoiceFinalizationIdempotencyConflictError,
  VoiceFinalizationNotFoundError,
  VoiceFinalizationPreconditionError,
  VoiceFinalizationPersistenceContractError,
  VoiceGenerationAuthorityConflictError,
} from '../../server/domains/brand/voice-finalization.js';
import { submitBrandIntake } from '../../server/domains/brand/intake/service.js';
import {
  addVoiceSample,
  createVoiceProfile,
  deleteVoiceSample,
  getVoiceProfile,
  updateVoiceProfile,
} from '../../server/voice-calibration.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

vi.mock('../../server/monthly-digest-cache.js', () => ({
  invalidateMonthlyDigestCache: vi.fn(),
}));
vi.mock('../../server/intelligence/cache-clear.js', () => ({
  clearIntelligenceCache: vi.fn(),
}));

const workspaces: SeededFullWorkspace[] = [];

afterEach(() => {
  db.exec('DROP TRIGGER IF EXISTS fail_voice_finalization_insert');
  db.exec('DROP TRIGGER IF EXISTS fail_voice_authorization_consume');
  for (const workspace of workspaces.splice(0)) {
    workspace.cleanup();
    db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(workspace.workspaceId);
  }
});

const voiceDNA = {
  personalityTraits: ['Warm and exact'],
  toneSpectrum: { formal_casual: 6, serious_playful: 4, technical_accessible: 8 },
  sentenceStyle: 'Short sentences with a calm cadence.',
  vocabularyLevel: 'Plain language without flattening expertise.',
};

const guardrails = {
  forbiddenWords: ['miracle'],
  requiredTerminology: [],
  toneBoundaries: ['Never pressure the reader.'],
  antiPatterns: [],
};

const operator = {
  actorType: 'operator' as const,
  actorId: 'operator-voice-1',
  actorLabel: 'Voice Operator',
};

const mcpActor = {
  actorType: 'mcp' as const,
  actorId: 'mcp-key-voice-1',
  actorLabel: 'Voice MCP key',
};

function workspace(): SeededFullWorkspace {
  const seeded = seedWorkspace({ tier: 'growth', clientPassword: '' });
  workspaces.push(seeded);
  return seeded;
}

function profileWithSample(source: 'manual' | 'transcript_extraction' | 'calibration_loop' = 'manual') {
  const seeded = workspace();
  const profile = createVoiceProfile(seeded.workspaceId);
  const sample = addVoiceSample(
    seeded.workspaceId,
    'We explain what matters, then let you decide.',
    'body',
    source,
  );
  return { seeded, profile: getVoiceProfile(seeded.workspaceId)!, sample };
}

function finalizationRequest(
  workspaceId: string,
  sampleId: string,
  expectedProfileRevision = getVoiceProfile(workspaceId)!.revision,
  idempotencyKey = `voice-finalize-${randomUUID()}`,
): FinalizeBrandVoiceRequest {
  return {
    workspaceId,
    expectedProfileRevision,
    voiceDNA,
    guardrails,
    contextModifiers: [],
    anchorSelectors: [{ kind: 'voice_sample', voiceSampleId: sampleId }],
    calibrationSelections: [],
    idempotencyKey,
    finalizedBy: operator,
    executionActor: operator,
  };
}

function authorizationRequest(
  request: FinalizeBrandVoiceRequest,
): CreateVoiceFinalizationAuthorizationRequest {
  return {
    workspaceId: request.workspaceId,
    expectedProfileRevision: request.expectedProfileRevision,
    voiceDNA: request.voiceDNA,
    guardrails: request.guardrails,
    contextModifiers: request.contextModifiers,
    anchorSelectors: request.anchorSelectors,
    calibrationSelections: request.calibrationSelections,
    idempotencyKey: request.idempotencyKey,
    authorizedBy: operator,
  };
}

describe('brand voice finalization domain', () => {
  it('distinguishes an absent workspace from an existing workspace without a profile', () => {
    expect(() => getBrandVoiceReadiness('missing-workspace'))
      .toThrow(VoiceFinalizationNotFoundError);
    const seeded = workspace();
    expect(getBrandVoiceReadiness(seeded.workspaceId)).toMatchObject({
      profile: null,
      readiness: { state: 'missing' },
      latestSnapshot: null,
    });
  });

  it('finalizes a draft through the legal path and freezes authentic content', () => {
    const { seeded, sample } = profileWithSample();
    const request = finalizationRequest(seeded.workspaceId, sample.id);
    const result = finalizeBrandVoice(request);
    const profile = getVoiceProfile(seeded.workspaceId)!;

    expect(result).toMatchObject({
      created: true,
      replayed: false,
      readiness: { state: 'finalized' },
      profileRevision: request.expectedProfileRevision + 1,
      snapshot: {
        voiceVersion: 1,
        profileRevision: request.expectedProfileRevision + 1,
        voiceDNA,
        guardrails,
        finalizedBy: operator,
        executionActor: operator,
      },
    });
    expect(result.snapshot.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.snapshot.anchors[0]).toMatchObject({
      content: sample.content,
      context: 'body',
      evidenceRef: {
        sourceType: 'voice_sample',
        sourceId: sample.id,
        voiceSampleSource: 'manual',
        selectedBy: operator,
      },
    });
    expect(profile).toMatchObject({
      status: 'calibrated',
      revision: request.expectedProfileRevision + 1,
      voiceDNA,
      guardrails,
    });
  });

  it('keeps direct finalization operator-only and delegated execution behind authorization', () => {
    const { seeded, sample } = profileWithSample();
    const request = finalizationRequest(seeded.workspaceId, sample.id);
    const before = getVoiceProfile(seeded.workspaceId)!;
    const unauthorizedRequests: FinalizeBrandVoiceRequest[] = [
      {
        ...request,
        executionActor: mcpActor,
      },
      {
        ...request,
        executionActor: {
          actorType: 'operator',
          actorId: 'different-operator',
          actorLabel: 'Different Operator',
        },
      },
      {
        ...request,
        authorizationId: `vfa_${randomUUID()}`,
      },
    ];

    for (const unauthorized of unauthorizedRequests) {
      expect(() => finalizeBrandVoice(unauthorized))
        .toThrow(VoiceFinalizationAuthorizationError);
    }
    expect(getVoiceProfile(seeded.workspaceId)).toMatchObject({
      revision: before.revision,
      status: before.status,
    });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM voice_profile_finalizations
      WHERE workspace_id = ?
    `).get(seeded.workspaceId)).toEqual({ count: 0 });

    expect(finalizeBrandVoice(request)).toMatchObject({ created: true, replayed: false });
  });

  it('replays exactly, rejects key mutation, and rejects a second finalization key', () => {
    const { seeded, sample } = profileWithSample();
    const request = finalizationRequest(seeded.workspaceId, sample.id);
    const created = finalizeBrandVoice(request);
    const replay = finalizeBrandVoice(request);

    expect(replay).toMatchObject({ created: false, replayed: true });
    expect(replay.snapshot.id).toBe(created.snapshot.id);
    expect(() => finalizeBrandVoice({
      ...request,
      voiceDNA: { ...voiceDNA, sentenceStyle: 'Changed under the same key.' },
    })).toThrow(VoiceFinalizationIdempotencyConflictError);
    expect(() => finalizeBrandVoice({
      ...request,
      expectedProfileRevision: created.profileRevision,
      idempotencyKey: `second-${randomUUID()}`,
    })).toThrow(VoiceFinalizationPreconditionError);
  });

  it('rejects stale revisions, generated samples, and cross-workspace samples', () => {
    const authentic = profileWithSample();
    const generated = profileWithSample('calibration_loop');

    expect(() => finalizeBrandVoice(finalizationRequest(
      authentic.seeded.workspaceId,
      authentic.sample.id,
      authentic.profile.revision - 1,
    ))).toThrow(VoiceFinalizationConflictError);
    expect(() => finalizeBrandVoice(finalizationRequest(
      generated.seeded.workspaceId,
      generated.sample.id,
    ))).toThrow(VoiceFinalizationPreconditionError);
    expect(() => finalizeBrandVoice(finalizationRequest(
      authentic.seeded.workspaceId,
      generated.sample.id,
    ))).toThrow(VoiceFinalizationPreconditionError);
  });

  it('freezes the exact durable calibration variation behind each rating', () => {
    const { seeded, sample, profile } = profileWithSample();
    const sessionId = `cal_${randomUUID()}`;
    db.prepare(`
      INSERT INTO voice_calibration_sessions (
        id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?)
    `).run(
      sessionId,
      profile.id,
      'hero_headline',
      JSON.stringify([{ text: 'Care that explains itself.' }]),
      new Date().toISOString(),
    );
    const request = {
      ...finalizationRequest(seeded.workspaceId, sample.id),
      calibrationSelections: [{
        sessionId,
        variationIndex: 0,
        rating: 'on_brand' as const,
        selected: true,
        feedback: 'This sounds like us.',
      }],
    };
    const result = finalizeBrandVoice(request);

    expect(result.snapshot.calibrationSelections).toEqual([{
      ...request.calibrationSelections[0],
      promptType: 'hero_headline',
      variationText: 'Care that explains itself.',
    }]);
    db.prepare(`
      UPDATE voice_calibration_sessions
      SET variations_json = '[{"text":"Later mutation"}]'
      WHERE id = ?
    `).run(sessionId);
    expect(finalizeBrandVoice(request).snapshot.calibrationSelections[0].variationText)
      .toBe('Care that explains itself.');
  });

  it('rejects cross-workspace, out-of-range, and corrupt selection refs', () => {
    const a = profileWithSample();
    const b = profileWithSample();
    const sessionId = `cal_${randomUUID()}`;
    db.prepare(`
      INSERT INTO voice_calibration_sessions (
        id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at
      ) VALUES (?, ?, 'hero_headline', '[{"text":"Known"}]', NULL, ?)
    `).run(sessionId, b.profile.id, new Date().toISOString());
    const base = finalizationRequest(a.seeded.workspaceId, a.sample.id);
    const selection = {
      sessionId,
      variationIndex: 0,
      rating: 'close' as const,
      selected: true,
    };

    expect(() => finalizeBrandVoice({ ...base, calibrationSelections: [selection] }))
      .toThrow(VoiceFinalizationPreconditionError);
    db.prepare(`UPDATE voice_calibration_sessions SET voice_profile_id = ? WHERE id = ?`)
      .run(a.profile.id, sessionId);
    expect(() => finalizeBrandVoice({
      ...base,
      calibrationSelections: [{ ...selection, variationIndex: 4 }],
    })).toThrow(VoiceFinalizationPreconditionError);
    db.prepare(`UPDATE voice_calibration_sessions SET variations_json = '{}' WHERE id = ?`)
      .run(sessionId);
    expect(() => finalizeBrandVoice({ ...base, calibrationSelections: [selection] }))
      .toThrowError(/invalid stored variations/i);
  });

  it('marks exact replays stale after an edit and reopens calibrated profiles', () => {
    const { seeded, sample } = profileWithSample();
    const request = finalizationRequest(seeded.workspaceId, sample.id);
    const created = finalizeBrandVoice(request);
    const edited = updateVoiceProfile(seeded.workspaceId, {
      voiceDNA: { ...voiceDNA, sentenceStyle: 'An operator revision.' },
    });

    expect(edited).toMatchObject({
      status: 'calibrating',
      revision: created.profileRevision + 1,
    });
    expect(getBrandVoiceReadiness(seeded.workspaceId).readiness.state).toBe('stale');
    const replay = finalizeBrandVoice(request);
    expect(replay.snapshot.id).toBe(created.snapshot.id);
    expect(replay.profileRevision).toBe(created.profileRevision);
    expect(replay.readiness.state).toBe('stale');
  });

  it('bumps revision and reopens finalized voice when samples are added or deleted', () => {
    const { seeded, sample } = profileWithSample();
    const first = finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sample.id));
    const added = addVoiceSample(seeded.workspaceId, 'Another authentic line.', 'cta', 'manual');
    const afterAdd = getVoiceProfile(seeded.workspaceId)!;
    expect(afterAdd).toMatchObject({
      status: 'calibrating',
      revision: first.profileRevision + 1,
    });
    expect(getBrandVoiceReadiness(seeded.workspaceId).readiness.state).toBe('stale');

    const second = finalizeBrandVoice(finalizationRequest(
      seeded.workspaceId,
      sample.id,
      afterAdd.revision,
    ));
    expect(deleteVoiceSample(seeded.workspaceId, added.id)).toBe(true);
    expect(getVoiceProfile(seeded.workspaceId)).toMatchObject({
      status: 'calibrating',
      revision: second.profileRevision + 1,
    });
    expect(getBrandVoiceReadiness(seeded.workspaceId).readiness.state).toBe('stale');
  });

  it('keeps immutable history and increments voice versions after re-finalization', () => {
    const { seeded, sample } = profileWithSample();
    const first = finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sample.id));
    const edited = updateVoiceProfile(seeded.workspaceId, {
      guardrails: { ...guardrails, forbiddenWords: ['miracle', 'guaranteed'] },
    });
    const second = finalizeBrandVoice(finalizationRequest(
      seeded.workspaceId,
      sample.id,
      edited.revision,
    ));

    expect(second.snapshot.voiceVersion).toBe(2);
    expect(second.snapshot.id).not.toBe(first.snapshot.id);
    expect(() => db.prepare(`
      UPDATE voice_profile_finalizations SET fingerprint = ? WHERE id = ?
    `).run('f'.repeat(64), first.snapshot.id)).toThrow(/immutable/i);
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM voice_profile_finalizations WHERE workspace_id = ?
    `).get(seeded.workspaceId)).toEqual({ count: 2 });
  });

  it('reads only the exact current finalized voice authority for paid generation', () => {
    const { seeded, sample } = profileWithSample();
    const finalized = finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sample.id));

    expect(getFinalizedVoiceSnapshotForGeneration({
      workspaceId: seeded.workspaceId,
      expectedVoiceVersion: finalized.snapshot.voiceVersion,
      expectedFingerprint: finalized.snapshot.fingerprint,
      requireCurrentAuthority: true,
    })).toEqual(finalized.snapshot);
    expect(() => getFinalizedVoiceSnapshotForGeneration({
      workspaceId: seeded.workspaceId,
      expectedVoiceVersion: finalized.snapshot.voiceVersion + 1,
      expectedFingerprint: finalized.snapshot.fingerprint,
      requireCurrentAuthority: true,
    })).toThrow(VoiceGenerationAuthorityConflictError);
    expect(() => getFinalizedVoiceSnapshotForGeneration({
      workspaceId: seeded.workspaceId,
      expectedVoiceVersion: finalized.snapshot.voiceVersion,
      expectedFingerprint: 'f'.repeat(64),
      requireCurrentAuthority: true,
    })).toThrow(VoiceGenerationAuthorityConflictError);
  });

  it('lets an in-flight worker re-read its frozen voice while new starts require current authority', () => {
    const { seeded, sample } = profileWithSample();
    const first = finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sample.id));
    const edited = updateVoiceProfile(seeded.workspaceId, {
      guardrails: { ...guardrails, forbiddenWords: ['miracle', 'guaranteed'] },
    });

    expect(() => getFinalizedVoiceSnapshotForGeneration({
      workspaceId: seeded.workspaceId,
      expectedVoiceVersion: first.snapshot.voiceVersion,
      expectedFingerprint: first.snapshot.fingerprint,
      requireCurrentAuthority: true,
    })).toThrow(VoiceFinalizationPreconditionError);
    expect(getFinalizedVoiceSnapshotForGeneration({
      workspaceId: seeded.workspaceId,
      expectedVoiceVersion: first.snapshot.voiceVersion,
      expectedFingerprint: first.snapshot.fingerprint,
      requireCurrentAuthority: false,
    })).toEqual(first.snapshot);

    const second = finalizeBrandVoice(finalizationRequest(
      seeded.workspaceId,
      sample.id,
      edited.revision,
    ));
    expect(() => getFinalizedVoiceSnapshotForGeneration({
      workspaceId: seeded.workspaceId,
      expectedVoiceVersion: first.snapshot.voiceVersion,
      expectedFingerprint: first.snapshot.fingerprint,
      requireCurrentAuthority: true,
    })).toThrow(VoiceFinalizationPreconditionError);
    expect(getFinalizedVoiceSnapshotForGeneration({
      workspaceId: seeded.workspaceId,
      expectedVoiceVersion: second.snapshot.voiceVersion,
      expectedFingerprint: second.snapshot.fingerprint,
      requireCurrentAuthority: true,
    })).toEqual(second.snapshot);
  });

  it('reads compatibility-only calibrated rows as missing until truthfully finalized', () => {
    const { seeded, sample } = profileWithSample();
    db.prepare(`UPDATE voice_profiles SET status = 'calibrated' WHERE workspace_id = ?`) // status-ok: seed legacy compatibility row
      .run(seeded.workspaceId);
    expect(getBrandVoiceReadiness(seeded.workspaceId).readiness).toMatchObject({
      state: 'missing',
    });
    expect(finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sample.id)).readiness.state)
      .toBe('finalized');
  });

  it('resolves an immutable brand-intake sample by exact revision and freezes intake lineage', () => {
    const seeded = workspace();
    const profile = createVoiceProfile(seeded.workspaceId);
    const sampleId = `intake-sample-${randomUUID()}`;
    const revision = submitBrandIntake({
      workspaceId: seeded.workspaceId,
      payload: brandIntakePayloadSchema.parse({
        schemaVersion: 1,
        business: {}, audience: {}, brand: {}, competitors: {},
        authenticSamples: [{
          id: sampleId,
          kind: 'client_written',
          content: 'You deserve a clear answer before making a decision.',
          context: 'body',
          sourceRef: {
            sourceType: 'client_submission',
            sourceId: 'client-intake-answer-1',
            capturedAt: '2026-07-14T12:00:00.000Z',
          },
        }],
      }),
      source: 'client_portal',
      submitter: { actorType: 'client', actorId: 'client-voice-1' },
    }).revision;
    const base = finalizationRequest(seeded.workspaceId, 'unused', profile.revision);
    expect(() => finalizeBrandVoice({
      ...base,
      anchorSelectors: [{
        kind: 'brand_intake_sample', intakeRevisionId: revision.id,
        intakeRevision: revision.revision + 1, sampleId,
      }],
    })).toThrow(VoiceFinalizationPreconditionError);
    expect(() => finalizeBrandVoice({
      ...base,
      idempotencyKey: `missing-intake-sample-${randomUUID()}`,
      anchorSelectors: [{
        kind: 'brand_intake_sample', intakeRevisionId: revision.id,
        intakeRevision: revision.revision, sampleId: 'missing-sample',
      }],
    })).toThrow(VoiceFinalizationPreconditionError);
    const result = finalizeBrandVoice({
      ...base,
      idempotencyKey: `intake-finalize-${randomUUID()}`,
      anchorSelectors: [{
        kind: 'brand_intake_sample',
        intakeRevisionId: revision.id,
        intakeRevision: revision.revision,
        sampleId,
      }],
    });

    expect(result.snapshot.anchors[0]).toMatchObject({
      selector: { intakeRevisionId: revision.id, intakeRevision: 1, sampleId },
      content: 'You deserve a clear answer before making a decision.',
      evidenceRef: {
        sourceType: 'brand_intake',
        sourceId: revision.id,
        sourceRevision: 1,
        fieldPath: `authenticSamples.${sampleId}`,
        capturedAt: revision.createdAt,
      },
    });
  });

  it('classifies invalid persisted profile status as an internal contract failure', () => {
    const { seeded, sample, profile } = profileWithSample();
    db.prepare(`UPDATE voice_profiles SET status = 'corrupt' WHERE workspace_id = ?`) // status-ok: deliberately corrupt persistence for fail-closed coverage
      .run(seeded.workspaceId);
    expect(() => finalizeBrandVoice(finalizationRequest(
      seeded.workspaceId,
      sample.id,
      profile.revision,
    )))
      .toThrow(VoiceFinalizationPersistenceContractError);
  });

  it('stores only a token digest and atomically consumes an operator-bound command', () => {
    const { seeded, sample } = profileWithSample();
    const request = finalizationRequest(seeded.workspaceId, sample.id);
    const created = createVoiceFinalizationAuthorization(authorizationRequest(request));
    const row = db.prepare(`
      SELECT token_hash, request_json, authorized_by_json, consumed_at
      FROM voice_finalization_authorizations WHERE id = ?
    `).get(created.authorization.authorizationId) as {
      token_hash: string;
      request_json: string;
      authorized_by_json: string;
      consumed_at: string | null;
    };

    expect(created.authorizationToken).not.toBe(row.token_hash);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.request_json).not.toContain(created.authorizationToken);
    expect(row.authorized_by_json).toContain(operator.actorId);
    expect(row.consumed_at).toBeNull();

    const result = consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: created.authorizationToken,
      executionActor: mcpActor,
    });
    expect(result).toMatchObject({
      created: true,
      replayed: false,
      snapshot: { finalizedBy: operator, executionActor: mcpActor },
    });
    expect(db.prepare(`
      SELECT consumed_at, finalization_id
      FROM voice_finalization_authorizations WHERE id = ?
    `).get(created.authorization.authorizationId)).toMatchObject({
      consumed_at: expect.any(String),
      finalization_id: result.snapshot.id,
    });
  });

  it('lets multiple exact authorizations consume/replay one immutable result', () => {
    const { seeded, sample } = profileWithSample();
    const request = authorizationRequest(finalizationRequest(seeded.workspaceId, sample.id));
    const firstToken = createVoiceFinalizationAuthorization(request);
    const secondToken = createVoiceFinalizationAuthorization(request);
    const first = consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: firstToken.authorizationToken,
      executionActor: mcpActor,
    });
    const second = consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: secondToken.authorizationToken,
      executionActor: { ...mcpActor, actorId: 'mcp-key-voice-2' },
    });

    expect(second).toMatchObject({ created: false, replayed: true });
    expect(second.snapshot.id).toBe(first.snapshot.id);
    expect(second.snapshot.executionActor).toEqual(mcpActor);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM voice_finalization_authorizations WHERE finalization_id = ?
    `).get(first.snapshot.id)).toEqual({ count: 2 });
  });

  it('replays a consumed token after expiry but rejects an expired unconsumed token', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
      const first = profileWithSample();
      const consumedToken = createVoiceFinalizationAuthorization(authorizationRequest(
        finalizationRequest(first.seeded.workspaceId, first.sample.id),
      ));
      const second = profileWithSample();
      const expiredToken = createVoiceFinalizationAuthorization(authorizationRequest(
        finalizationRequest(second.seeded.workspaceId, second.sample.id),
      ));
      const result = consumeVoiceFinalizationAuthorization({
        workspaceId: first.seeded.workspaceId,
        authorizationToken: consumedToken.authorizationToken,
        executionActor: mcpActor,
      });

      vi.advanceTimersByTime(16 * 60 * 1_000);
      expect(consumeVoiceFinalizationAuthorization({
        workspaceId: first.seeded.workspaceId,
        authorizationToken: consumedToken.authorizationToken,
        executionActor: mcpActor,
      }).snapshot.id).toBe(result.snapshot.id);
      expect(() => consumeVoiceFinalizationAuthorization({
        workspaceId: second.seeded.workspaceId,
        authorizationToken: expiredToken.authorizationToken,
        executionActor: mcpActor,
      })).toThrow(VoiceFinalizationAuthorizationError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back the profile and snapshot when immutable persistence fails', () => {
    const { seeded, sample } = profileWithSample();
    const before = getVoiceProfile(seeded.workspaceId)!;
    db.exec(`
      CREATE TEMP TRIGGER fail_voice_finalization_insert
      BEFORE INSERT ON voice_profile_finalizations
      BEGIN
        SELECT RAISE(ABORT, 'snapshot persistence failed');
      END;
    `);

    expect(() => finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sample.id)))
      .toThrow(/snapshot persistence failed/);
    expect(getVoiceProfile(seeded.workspaceId)).toMatchObject({
      revision: before.revision,
      status: before.status,
    });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM voice_profile_finalizations WHERE workspace_id = ?
    `).get(seeded.workspaceId)).toEqual({ count: 0 });
  });

  it('rolls back finalization if authorization consumption cannot commit', () => {
    const { seeded, sample } = profileWithSample();
    const before = getVoiceProfile(seeded.workspaceId)!;
    const authorization = createVoiceFinalizationAuthorization(authorizationRequest(
      finalizationRequest(seeded.workspaceId, sample.id),
    ));
    db.exec(`
      CREATE TEMP TRIGGER fail_voice_authorization_consume
      BEFORE UPDATE ON voice_finalization_authorizations
      BEGIN
        SELECT RAISE(ABORT, 'authorization consume failed');
      END;
    `);

    expect(() => consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: authorization.authorizationToken,
      executionActor: mcpActor,
    })).toThrow(/authorization consume failed/);
    expect(getVoiceProfile(seeded.workspaceId)).toMatchObject({
      revision: before.revision,
      status: before.status,
    });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM voice_profile_finalizations WHERE workspace_id = ?
    `).get(seeded.workspaceId)).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT consumed_at FROM voice_finalization_authorizations WHERE id = ?
    `).get(authorization.authorization.authorizationId)).toEqual({ consumed_at: null });
  });
});
