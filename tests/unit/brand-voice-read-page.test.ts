import { createHash, randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { brandIntakePayloadSchema } from '../../shared/types/brand-intake-schemas.js';
import type {
  CreateVoiceFinalizationAuthorizationRequest,
  FinalizeBrandVoiceRequest,
  FinalizedVoiceAnchorSnapshot,
  FinalizedVoiceSnapshot,
} from '../../shared/types/voice-finalization.js';
import { VOICE_FINALIZATION_LIMITS } from '../../shared/types/voice-finalization.js';
import { parseJsonFallback } from '../../server/db/json-validation.js';
import db from '../../server/db/index.js';
import { submitBrandIntake } from '../../server/domains/brand/intake/service.js';
import {
  consumeVoiceFinalizationAuthorization,
  createVoiceFinalizationAuthorization,
  finalizeBrandVoice,
  getBrandVoiceAuthoritySummary,
  getBrandVoicePage,
  getBrandVoiceReadiness,
  VoiceFinalizationAuthorizationError,
  VoiceFinalizationPersistenceContractError,
  VoiceFinalizationPreconditionError,
  VoiceFinalizationReadConflictError,
  VoiceFinalizationReadCursorError,
} from '../../server/domains/brand/voice-finalization.js';
import {
  createVoiceProfile,
  getVoiceProfile,
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
  db.pragma('ignore_check_constraints = OFF');
  for (const seeded of workspaces.splice(0)) {
    seeded.cleanup();
    db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(seeded.workspaceId);
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
  actorId: 'operator-read-page',
  actorLabel: 'Voice Operator',
};

const mcpActor = {
  actorType: 'mcp' as const,
  actorId: 'mcp-read-page',
  actorLabel: 'Voice MCP',
};

function workspaceWithProfile() {
  const seeded = seedWorkspace({ tier: 'growth', clientPassword: '' });
  workspaces.push(seeded);
  const profile = createVoiceProfile(seeded.workspaceId);
  return { seeded, profile };
}

function insertRawSample(
  profileId: string,
  index: number,
  overrides: Partial<{
    id: string;
    content: string;
    context: string | null;
    source: string | null;
    sortOrder: number | string | null;
    createdAt: string;
  }> = {},
): string {
  const id = overrides.id
    ?? `${profileId}-sample-${index.toString().padStart(4, '0')}`;
  db.prepare(`
    INSERT INTO voice_samples (
      id, voice_profile_id, content, context_tag, source, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    profileId,
    overrides.content ?? `Authentic sample ${index}`,
    overrides.context === undefined ? 'body' : overrides.context,
    overrides.source === undefined ? 'manual' : overrides.source,
    overrides.sortOrder === undefined ? index : overrides.sortOrder,
    overrides.createdAt ?? `2026-07-13T12:${Math.floor(index / 60).toString().padStart(2, '0')}:${(index % 60).toString().padStart(2, '0')}.000Z`,
  );
  return id;
}

function finalizationRequest(
  workspaceId: string,
  sampleId: string,
  idempotencyKey = `voice-page-${randomUUID()}`,
): FinalizeBrandVoiceRequest {
  return {
    workspaceId,
    expectedProfileRevision: getVoiceProfile(workspaceId)!.revision,
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
    authorizedBy: request.finalizedBy,
  };
}

function submitIntake(workspaceId: string, label: string, sampleCount = 2) {
  return submitBrandIntake({
    workspaceId,
    payload: brandIntakePayloadSchema.parse({
      schemaVersion: 1,
      business: { businessName: label },
      audience: {},
      brand: {},
      competitors: {},
      authenticSamples: Array.from({ length: sampleCount }, (_, index) => ({
        id: `${label}-sample-${index}`,
        kind: 'client_written',
        content: `${label} intake voice ${index}`,
        context: 'body',
        sourceRef: {
          sourceType: 'client_submission',
          sourceId: `${label}-source-${index}`,
          capturedAt: '2026-07-14T12:00:00.000Z',
        },
      })),
    }),
    source: 'client_portal',
    submitter: { actorType: 'client', actorId: `${label}-client` },
  }).revision;
}

describe('bounded brand voice authority reads', () => {
  it('pages in deterministic source order with default/max caps and no duplicates', () => {
    const { seeded, profile } = workspaceWithProfile();
    for (let index = 0; index < 130; index += 1) insertRawSample(profile.id, index);
    submitIntake(seeded.workspaceId, 'paging', 2);

    const first = getBrandVoicePage({ workspaceId: seeded.workspaceId });
    expect(first.eligibleAnchors.items).toHaveLength(
      VOICE_FINALIZATION_LIMITS.defaultEligibleAnchorPageSize,
    );
    expect(first.eligibleAnchors.hasMore).toBe(true);
    expect(first.eligibleAnchors.nextCursor).toEqual(expect.any(String));

    const max = getBrandVoicePage({
      workspaceId: seeded.workspaceId,
      anchorLimit: VOICE_FINALIZATION_LIMITS.maxEligibleAnchorPageSize,
    });
    expect(max.eligibleAnchors.items).toHaveLength(100);

    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = getBrandVoicePage({
        workspaceId: seeded.workspaceId,
        anchorLimit: 17,
        anchorCursor: cursor,
      });
      ids.push(...page.eligibleAnchors.items.map(item => item.selector.kind === 'voice_sample'
        ? item.selector.voiceSampleId
        : item.selector.sampleId));
      cursor = page.eligibleAnchors.nextCursor ?? undefined;
      expect(page.eligibleAnchors.hasMore).toBe(cursor !== undefined);
    } while (cursor);

    expect(ids).toHaveLength(132);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 130)).toEqual(
      Array.from(
        { length: 130 },
        (_, index) => `${profile.id}-sample-${index.toString().padStart(4, '0')}`,
      ),
    );
    expect(ids.slice(130)).toEqual(['paging-sample-0', 'paging-sample-1']);
  });

  it('rejects cross-workspace, malformed, tampered, and stale cursors deterministically', () => {
    const first = workspaceWithProfile();
    const second = workspaceWithProfile();
    insertRawSample(first.profile.id, 0);
    insertRawSample(first.profile.id, 1);
    const cursor = getBrandVoicePage({
      workspaceId: first.seeded.workspaceId,
      anchorLimit: 1,
    }).eligibleAnchors.nextCursor!;

    expect(() => getBrandVoicePage({
      workspaceId: second.seeded.workspaceId,
      anchorCursor: cursor,
    })).toThrow(VoiceFinalizationReadCursorError);
    expect(() => getBrandVoicePage({
      workspaceId: first.seeded.workspaceId,
      anchorCursor: 'not-a-real-cursor',
    })).toThrow(VoiceFinalizationReadCursorError);
    expect(() => getBrandVoicePage({
      workspaceId: first.seeded.workspaceId,
      anchorCursor: 'a'.repeat(VOICE_FINALIZATION_LIMITS.maxAnchorCursorLength + 1),
    })).toThrow(VoiceFinalizationReadCursorError);

    const envelope = parseJsonFallback<Record<string, unknown>>(
      Buffer.from(cursor, 'base64url').toString('utf8'),
      {},
    );
    const payload = envelope.payload as Record<string, unknown>;
    payload.offset = 999;
    const tampered = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
    expect(() => getBrandVoicePage({
      workspaceId: first.seeded.workspaceId,
      anchorCursor: tampered,
    })).toThrow(VoiceFinalizationReadCursorError);

    db.prepare(`UPDATE voice_profiles SET revision = revision + 1 WHERE id = ?`)
      .run(first.profile.id);
    expect(() => getBrandVoicePage({
      workspaceId: first.seeded.workspaceId,
      anchorCursor: cursor,
    })).toThrow(VoiceFinalizationReadConflictError);

    const currentCursor = getBrandVoicePage({
      workspaceId: first.seeded.workspaceId,
      anchorLimit: 1,
    }).eligibleAnchors.nextCursor!;
    submitIntake(first.seeded.workspaceId, 'cursor-intake', 1);
    expect(() => getBrandVoicePage({
      workspaceId: first.seeded.workspaceId,
      anchorCursor: currentCursor,
    })).toThrow(VoiceFinalizationReadConflictError);
  });
});

describe('brand voice authority integrity', () => {
  it('filters corrupt raw samples before paging and rejects known-ID finalization', () => {
    const { seeded, profile } = workspaceWithProfile();
    const valid = insertRawSample(profile.id, 0);
    const corrupt = [
      insertRawSample(profile.id, 1, { content: ' '.repeat(20) }),
      insertRawSample(profile.id, 2, { content: 'x'.repeat(10_001) }),
      insertRawSample(profile.id, 3, { content: '界'.repeat(4_000) }),
      insertRawSample(profile.id, 4, { context: 'corrupt-context' }),
      insertRawSample(profile.id, 5, { source: 'calibration_loop' }),
      insertRawSample(profile.id, 6, { createdAt: 'not-a-timestamp' }),
      insertRawSample(profile.id, 7, { sortOrder: 'not-an-integer' }),
    ];

    const page = getBrandVoicePage({ workspaceId: seeded.workspaceId, anchorLimit: 100 });
    expect(page.eligibleAnchors.items.map(item => item.selector)).toEqual([
      { kind: 'voice_sample', voiceSampleId: valid },
    ]);
    expect(page.eligibleAnchors.hasMore).toBe(false);
    expect(getBrandVoiceReadiness(seeded.workspaceId).eligibleAnchors).toHaveLength(1);

    for (const sampleId of corrupt) {
      expect(() => finalizeBrandVoice(finalizationRequest(
        seeded.workspaceId,
        sampleId,
        `corrupt-${sampleId}`,
      ))).toThrow(VoiceFinalizationPreconditionError);
    }
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM voice_profile_finalizations WHERE workspace_id = ?
    `).get(seeded.workspaceId)).toEqual({ count: 0 });
    expect(getVoiceProfile(seeded.workspaceId)?.revision).toBe(profile.revision);
  });

  it.each([
    ['status', { status: 'corrupt-status' }],
    ['voice DNA', { voice_dna_json: '{"personalityTraits":"not-an-array"}' }],
    ['guardrails', { guardrails_json: '{"forbiddenWords":"not-an-array"}' }],
    ['context modifiers', { context_modifiers_json: '[{"context":7}]' }],
  ])('fails closed across every authority read for corrupt mutable %s', (_label, update) => {
    const { seeded } = workspaceWithProfile();
    const [column, value] = Object.entries(update)[0]!;
    db.prepare(`UPDATE voice_profiles SET ${column} = ? WHERE workspace_id = ?`)
      .run(value, seeded.workspaceId);

    for (const read of [
      () => getBrandVoiceReadiness(seeded.workspaceId),
      () => getBrandVoiceAuthoritySummary(seeded.workspaceId),
      () => getBrandVoicePage({ workspaceId: seeded.workspaceId }),
    ]) {
      expect(read).toThrow(VoiceFinalizationPersistenceContractError);
    }
  });

  it('returns summary-only immutable metadata after strict full snapshot validation', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const finalized = finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sampleId));
    const page = getBrandVoicePage({ workspaceId: seeded.workspaceId });
    const summary = getBrandVoiceAuthoritySummary(seeded.workspaceId);

    expect(page.readiness.state).toBe('finalized');
    expect(page.latestSnapshot).toEqual({
      id: finalized.snapshot.id,
      voiceProfileId: finalized.snapshot.voiceProfileId,
      profileRevision: finalized.snapshot.profileRevision,
      voiceVersion: finalized.snapshot.voiceVersion,
      fingerprint: finalized.snapshot.fingerprint,
      finalizedBy: operator,
      finalizedAt: finalized.snapshot.finalizedAt,
      anchorCount: 1,
      calibrationSelectionCount: 0,
    });
    expect(Object.keys(page.latestSnapshot!)).toEqual([
      'id',
      'voiceProfileId',
      'profileRevision',
      'voiceVersion',
      'fingerprint',
      'finalizedBy',
      'finalizedAt',
      'anchorCount',
      'calibrationSelectionCount',
    ]);
    expect(summary.profile).toEqual({
      id: finalized.snapshot.voiceProfileId,
      revision: finalized.profileRevision,
      status: 'calibrated',
    });
  });

  it.each([
    ['same-revision status', { status: 'draft' }],
    ['same-revision DNA', { voice_dna_json: JSON.stringify({
      ...voiceDNA,
      sentenceStyle: 'Silently changed without a revision.',
    }) }],
    ['same-revision guardrails', { guardrails_json: JSON.stringify({
      ...guardrails,
      toneBoundaries: ['Silently changed without a revision.'],
    }) }],
    ['same-revision modifiers', { context_modifiers_json: JSON.stringify([{
      context: 'CTA',
      description: 'Silently changed without a revision.',
    }]) }],
  ])('rejects %s drift instead of reporting finalized', (_label, update) => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sampleId));
    const [column, value] = Object.entries(update)[0]!;
    db.prepare(`UPDATE voice_profiles SET ${column} = ? WHERE workspace_id = ?`)
      .run(value, seeded.workspaceId);

    expect(() => getBrandVoiceReadiness(seeded.workspaceId))
      .toThrow(VoiceFinalizationPersistenceContractError);
    expect(() => getBrandVoiceAuthoritySummary(seeded.workspaceId))
      .toThrow(VoiceFinalizationPersistenceContractError);
    expect(() => getBrandVoicePage({ workspaceId: seeded.workspaceId }))
      .toThrow(VoiceFinalizationPersistenceContractError);
  });

  it('never promotes a schema-invalid immutable row to finalized authority', () => {
    const { seeded, profile } = workspaceWithProfile();
    const now = '2026-07-14T12:00:00.000Z';
    db.prepare(`UPDATE voice_profiles SET status = 'calibrated' WHERE id = ?`) // status-ok: corrupt-row authority test fixture
      .run(profile.id);
    db.prepare(`
      INSERT INTO voice_profile_finalizations (
        id, workspace_id, voice_profile_id, voice_version, profile_revision,
        voice_dna_json, guardrails_json, context_modifiers_json, anchors_json,
        calibration_selections_json, finalized_by_json, execution_actor_json,
        fingerprint, mutation_fingerprint, idempotency_key, authorization_id,
        finalized_at, created_at
      ) VALUES (?, ?, ?, 1, 2, '{}', '{}', '[]', '[{}]', '[]', ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      `corrupt-finalization-${randomUUID()}`,
      seeded.workspaceId,
      profile.id,
      JSON.stringify(operator),
      JSON.stringify(operator),
      'a'.repeat(64),
      'b'.repeat(64),
      `corrupt-${randomUUID()}`,
      now,
      now,
    );

    expect(() => getBrandVoiceAuthoritySummary(seeded.workspaceId))
      .toThrow(VoiceFinalizationPersistenceContractError);
    expect(() => getBrandVoicePage({ workspaceId: seeded.workspaceId }))
      .toThrow(VoiceFinalizationPersistenceContractError);
  });

  it('rejects client/system immutable execution provenance as non-authoritative', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const valid = finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sampleId));
    db.pragma('ignore_check_constraints = ON');
    try {
      db.prepare(`
        INSERT INTO voice_profile_finalizations (
          id, workspace_id, voice_profile_id, voice_version, profile_revision,
          voice_dna_json, guardrails_json, context_modifiers_json, anchors_json,
          calibration_selections_json, finalized_by_json, execution_actor_json,
          fingerprint, mutation_fingerprint, idempotency_key, authorization_id,
          finalized_at, created_at
        )
        SELECT
          ?, workspace_id, voice_profile_id, voice_version + 1, profile_revision,
          voice_dna_json, guardrails_json, context_modifiers_json, anchors_json,
          calibration_selections_json, finalized_by_json, ?, fingerprint, ?, ?, NULL,
          finalized_at, created_at
        FROM voice_profile_finalizations
        WHERE id = ?
      `).run(
        `invalid-actor-${randomUUID()}`,
        JSON.stringify({ actorType: 'client', actorId: 'client-cannot-finalize' }),
        'd'.repeat(64),
        `invalid-actor-${randomUUID()}`,
        valid.snapshot.id,
      );
    } finally {
      db.pragma('ignore_check_constraints = OFF');
    }

    expect(() => getBrandVoiceAuthoritySummary(seeded.workspaceId))
      .toThrow(VoiceFinalizationPersistenceContractError);
  });

  it.each([
    {
      label: 'voice-sample source identity',
      mutate: (anchors: FinalizedVoiceAnchorSnapshot[]) => {
        anchors[0]!.evidenceRef.sourceId = 'different-voice-sample';
      },
    },
    {
      label: 'selecting operator',
      mutate: (anchors: FinalizedVoiceAnchorSnapshot[]) => {
        anchors[0]!.evidenceRef.selectedBy = {
          actorType: 'operator',
          actorId: 'different-selector',
        };
      },
    },
    {
      label: 'selection time',
      mutate: (anchors: FinalizedVoiceAnchorSnapshot[]) => {
        anchors[0]!.evidenceRef.selectedAt = new Date(
          Date.parse(anchors[0]!.evidenceRef.selectedAt) - 1_000,
        ).toISOString();
      },
    },
    {
      label: 'future capture time',
      mutate: (anchors: FinalizedVoiceAnchorSnapshot[]) => {
        anchors[0]!.evidenceRef.capturedAt = new Date(
          Date.parse(anchors[0]!.evidenceRef.selectedAt) + 1_000,
        ).toISOString();
      },
    },
  ])('rejects fingerprint-valid voice authority with corrupt anchor $label', ({ mutate }) => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const result = finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sampleId));

    overwriteSnapshotAnchorsForReadTest(result.snapshot, mutate);
    expectAuthorityReadsToRejectCorruptProof(seeded.workspaceId);
  });

  it('rejects fingerprint-valid intake authority with a mismatched revision/sample field path', () => {
    const { seeded } = workspaceWithProfile();
    const intake = submitIntake(seeded.workspaceId, 'anchor-proof', 1);
    const request: FinalizeBrandVoiceRequest = {
      ...finalizationRequest(seeded.workspaceId, 'unused-voice-sample'),
      anchorSelectors: [{
        kind: 'brand_intake_sample',
        intakeRevisionId: intake.id,
        intakeRevision: intake.revision,
        sampleId: 'anchor-proof-sample-0',
      }],
    };
    const result = finalizeBrandVoice(request);

    overwriteSnapshotAnchorsForReadTest(result.snapshot, anchors => {
      anchors[0]!.evidenceRef.sourceRevision = intake.revision + 1;
      anchors[0]!.evidenceRef.fieldPath = 'authenticSamples.different-sample';
    });
    expectAuthorityReadsToRejectCorruptProof(seeded.workspaceId);
  });
});

function authorizationTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function canonicalizeForFingerprint(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForFingerprint);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .flatMap(key => {
          const child = (value as Record<string, unknown>)[key];
          return child === undefined ? [] : [[key, canonicalizeForFingerprint(child)]];
        }),
    );
  }
  return value;
}

function snapshotContentFingerprint(
  snapshot: FinalizedVoiceSnapshot,
  anchors: FinalizedVoiceAnchorSnapshot[],
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeForFingerprint({
      voiceDNA: snapshot.voiceDNA,
      guardrails: snapshot.guardrails,
      contextModifiers: snapshot.contextModifiers,
      anchors: anchors.map(anchor => ({
        selector: anchor.selector,
        content: anchor.content,
        context: anchor.context,
        evidenceRef: anchor.evidenceRef,
      })),
      calibrationSelections: snapshot.calibrationSelections,
    })))
    .digest('hex');
}

function countRows(table: 'voice_profile_finalizations' | 'voice_finalization_authorizations', workspaceId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`)
    .get(workspaceId) as { count: number }).count;
}

function corruptStoredProofForReadTest(
  triggerNames: Array<
    | 'voice_profile_finalizations_immutable_update'
    | 'voice_finalization_authorizations_bound_update'
  >,
  mutate: () => void,
): void {
  const triggers = triggerNames.map(name => {
    const row = db.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?
    `).get(name) as { sql: string } | undefined;
    if (!row?.sql) throw new Error(`Missing integrity trigger ${name}`);
    return { name, sql: row.sql };
  });
  const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true }) === 1;
  try {
    for (const trigger of triggers) db.exec(`DROP TRIGGER ${trigger.name}`);
    db.pragma('foreign_keys = OFF');
    db.pragma('ignore_check_constraints = ON');
    mutate();
  } finally {
    db.pragma('ignore_check_constraints = OFF');
    if (foreignKeysEnabled) db.pragma('foreign_keys = ON');
    for (const trigger of triggers) db.exec(trigger.sql);
  }
}

function overwriteSnapshotAnchorsForReadTest(
  snapshot: FinalizedVoiceSnapshot,
  mutate: (anchors: FinalizedVoiceAnchorSnapshot[]) => void,
): void {
  const anchors = structuredClone(snapshot.anchors) as FinalizedVoiceAnchorSnapshot[];
  mutate(anchors);
  corruptStoredProofForReadTest(
    ['voice_profile_finalizations_immutable_update'],
    () => db.prepare(`
      UPDATE voice_profile_finalizations
      SET anchors_json = ?, fingerprint = ?
      WHERE id = ?
    `).run(
      JSON.stringify(anchors),
      snapshotContentFingerprint(snapshot, anchors),
      snapshot.id,
    ),
  );
}

function insertRawAuthorization(input: {
  workspaceId: string;
  profileId: string;
  profileRevision: number;
  token: string;
  issuedAt: string;
  expiresAt: string;
}): void {
  db.pragma('ignore_check_constraints = ON');
  try {
    db.prepare(`
      INSERT INTO voice_finalization_authorizations (
        id, token_hash, workspace_id, voice_profile_id,
        expected_profile_revision, request_json, mutation_fingerprint,
        authorized_by_json, issued_at, expires_at, consumed_at,
        finalization_id, execution_actor_json
      ) VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, NULL, NULL, NULL)
    `).run(
      `raw-auth-${randomUUID()}`,
      authorizationTokenHash(input.token),
      input.workspaceId,
      input.profileId,
      input.profileRevision,
      'c'.repeat(64),
      JSON.stringify(operator),
      input.issuedAt,
      input.expiresAt,
    );
  } finally {
    db.pragma('ignore_check_constraints = OFF');
  }
}

function expectAuthorityReadsToRejectCorruptProof(workspaceId: string): void {
  for (const read of [
    () => getBrandVoiceReadiness(workspaceId),
    () => getBrandVoiceAuthoritySummary(workspaceId),
    () => getBrandVoicePage({ workspaceId }),
  ]) {
    expect(read).toThrow(VoiceFinalizationPersistenceContractError);
  }
}

describe('brand voice finalization preflight bounds', () => {
  it('rejects oversized raw authentic content before authorization or finalization writes', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0, { content: '界'.repeat(4_000) });
    const request = finalizationRequest(seeded.workspaceId, sampleId);

    expect(() => createVoiceFinalizationAuthorization(authorizationRequest(request)))
      .toThrow(VoiceFinalizationPreconditionError);
    expect(() => finalizeBrandVoice(request)).toThrow(VoiceFinalizationPreconditionError);
    expect(countRows('voice_finalization_authorizations', seeded.workspaceId)).toBe(0);
    expect(countRows('voice_profile_finalizations', seeded.workspaceId)).toBe(0);
    expect(getVoiceProfile(seeded.workspaceId)?.revision).toBe(profile.revision);
  });

  it('fails fast on an oversized stored calibration session with no mutation', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const sessionId = `large-session-${randomUUID()}`;
    const variations = Array.from({ length: 60 }, () => ({ text: 'x'.repeat(9_000) }));
    db.prepare(`
      INSERT INTO voice_calibration_sessions (
        id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at
      ) VALUES (?, ?, 'body', ?, NULL, ?)
    `).run(sessionId, profile.id, JSON.stringify(variations), '2026-07-14T12:00:00.000Z');
    const base = finalizationRequest(seeded.workspaceId, sampleId);
    const request: FinalizeBrandVoiceRequest = {
      ...base,
      calibrationSelections: variations.map((_, variationIndex) => ({
        sessionId,
        variationIndex,
        rating: 'on_brand',
        selected: true,
      })),
    };

    expect(() => createVoiceFinalizationAuthorization(authorizationRequest(request)))
      .toThrow(VoiceFinalizationPreconditionError);
    expect(() => finalizeBrandVoice(request)).toThrow(VoiceFinalizationPreconditionError);
    expect(countRows('voice_finalization_authorizations', seeded.workspaceId)).toBe(0);
    expect(countRows('voice_profile_finalizations', seeded.workspaceId)).toBe(0);
    expect(getVoiceProfile(seeded.workspaceId)?.revision).toBe(profile.revision);
  });

  it('resolves many selections from one bounded session and freezes each exact variation', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const sessionId = `bounded-session-${randomUUID()}`;
    const variations = Array.from({ length: 20 }, (_, index) => ({ text: `Variation ${index}` }));
    db.prepare(`
      INSERT INTO voice_calibration_sessions (
        id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at
      ) VALUES (?, ?, 'body', ?, NULL, ?)
    `).run(sessionId, profile.id, JSON.stringify(variations), '2026-07-14T12:00:00.000Z');
    const request: FinalizeBrandVoiceRequest = {
      ...finalizationRequest(seeded.workspaceId, sampleId),
      calibrationSelections: variations.map((_, variationIndex) => ({
        sessionId,
        variationIndex,
        rating: 'on_brand',
        selected: variationIndex === 0,
      })),
    };

    const result = finalizeBrandVoice(request);
    expect(result.snapshot.calibrationSelections.map(item => item.variationText))
      .toEqual(variations.map(item => item.text));
  });

  it('rereads a legal direct snapshot whose reconstructed command exceeds the authorization cap', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const sessionId = `direct-large-session-${randomUUID()}`;
    const variations = Array.from({ length: 100 }, (_, index) => ({ text: `Voice ${index}` }));
    db.prepare(`
      INSERT INTO voice_calibration_sessions (
        id, voice_profile_id, prompt_type, variations_json, steering_notes, created_at
      ) VALUES (?, ?, 'body', ?, NULL, ?)
    `).run(sessionId, profile.id, JSON.stringify(variations), '2026-07-14T12:00:00.000Z');
    const request: FinalizeBrandVoiceRequest = {
      ...finalizationRequest(seeded.workspaceId, sampleId),
      voiceDNA: {
        ...voiceDNA,
        sentenceStyle: '界'.repeat(9_000),
        vocabularyLevel: '界'.repeat(9_000),
        humorStyle: '界'.repeat(9_000),
      },
      calibrationSelections: variations.map((_, variationIndex) => ({
        sessionId,
        variationIndex,
        rating: 'on_brand' as const,
        selected: variationIndex === 0,
        feedback: '界'.repeat(1_500),
      })),
    };
    const {
      workspaceId: _workspaceId,
      finalizedBy: _finalizedBy,
      executionActor: _executionActor,
      ...storedCommand
    } = request;
    void _workspaceId;
    void _finalizedBy;
    void _executionActor;
    expect(new TextEncoder().encode(JSON.stringify(storedCommand)).byteLength)
      .toBeGreaterThan(VOICE_FINALIZATION_LIMITS.maxAuthorizationJsonBytes);

    const result = finalizeBrandVoice(request);
    expect(getBrandVoiceReadiness(seeded.workspaceId).latestSnapshot?.id)
      .toBe(result.snapshot.id);
    expect(getBrandVoiceAuthoritySummary(seeded.workspaceId).readiness.state)
      .toBe('finalized');
  });

  it('rejects a direct operator label spoof under the same actor ID', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const request = finalizationRequest(seeded.workspaceId, sampleId);
    expect(() => finalizeBrandVoice({
      ...request,
      executionActor: { ...operator, actorLabel: 'Spoofed audit label' },
    })).toThrow(VoiceFinalizationAuthorizationError);
    expect(countRows('voice_profile_finalizations', seeded.workspaceId)).toBe(0);
  });
});

describe('brand voice authorization envelope integrity', () => {
  it('rejects an MCP-authored immutable snapshot with no origin authorization backlink', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const request = finalizationRequest(seeded.workspaceId, sampleId);
    const authorization = createVoiceFinalizationAuthorization(authorizationRequest(request));
    const result = consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: authorization.authorizationToken,
      executionActor: mcpActor,
    });

    corruptStoredProofForReadTest(
      ['voice_profile_finalizations_immutable_update'],
      () => db.prepare(`
        UPDATE voice_profile_finalizations
        SET authorization_id = NULL
        WHERE id = ?
      `).run(result.snapshot.id),
    );

    expectAuthorityReadsToRejectCorruptProof(seeded.workspaceId);
  });

  it('rejects direct authority whose operator executor differs from its finalizer', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const result = finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sampleId));

    corruptStoredProofForReadTest(
      ['voice_profile_finalizations_immutable_update'],
      () => db.prepare(`
        UPDATE voice_profile_finalizations
        SET execution_actor_json = ?
        WHERE id = ?
      `).run(
        JSON.stringify({ actorType: 'operator', actorId: 'other-operator' }),
        result.snapshot.id,
      ),
    );

    expectAuthorityReadsToRejectCorruptProof(seeded.workspaceId);
  });

  it.each([
    { label: 'unknown snapshot schema version', setSql: 'schema_version = 99' },
    { label: 'impossible snapshot profile revision', setSql: 'profile_revision = 1' },
    { label: 'snapshot-derived idempotency command', setSql: `idempotency_key = 'tampered-key'` },
  ])('rejects direct authority with a corrupt $label', ({ setSql }) => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const result = finalizeBrandVoice(finalizationRequest(seeded.workspaceId, sampleId));

    corruptStoredProofForReadTest(
      ['voice_profile_finalizations_immutable_update'],
      () => db.prepare(`
        UPDATE voice_profile_finalizations
        SET ${setSql}
        WHERE id = ?
      `).run(result.snapshot.id),
    );

    expectAuthorityReadsToRejectCorruptProof(seeded.workspaceId);
  });

  it.each([
    {
      label: 'voice profile backlink',
      setSql: `voice_profile_id = 'vp-other'`,
    },
    {
      label: 'expected profile revision',
      setSql: 'expected_profile_revision = expected_profile_revision + 1',
    },
    {
      label: 'mutation fingerprint',
      setSql: `mutation_fingerprint = '${'e'.repeat(64)}'`,
    },
    {
      label: 'empty version 1 request payload',
      setSql: `request_json = '{}'`,
    },
    {
      label: 'unknown request schema version',
      setSql: 'request_schema_version = 99',
    },
    {
      label: 'tampered version 1 request payload',
      setSql: `request_json = json_set(request_json, '$.idempotencyKey', 'tampered-request')`,
    },
    {
      label: 'finalizing operator',
      setSql: `authorized_by_json = '{"actorType":"operator","actorId":"other-operator"}'`,
    },
    {
      label: 'consumed finalization backlink',
      setSql: 'finalization_id = NULL',
    },
    {
      label: 'MCP executor',
      setSql: `execution_actor_json = '{"actorType":"mcp","actorId":"other-mcp"}'`,
    },
    {
      label: 'consumed time window',
      setSql: 'consumed_at = expires_at',
    },
  ])('rejects immutable authority with a corrupt origin authorization $label', ({ setSql }) => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const request = finalizationRequest(seeded.workspaceId, sampleId);
    const authorization = createVoiceFinalizationAuthorization(authorizationRequest(request));
    consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: authorization.authorizationToken,
      executionActor: mcpActor,
    });

    corruptStoredProofForReadTest(
      ['voice_finalization_authorizations_bound_update'],
      () => db.prepare(`
        UPDATE voice_finalization_authorizations
        SET ${setSql}
        WHERE id = ?
      `).run(authorization.authorization.authorizationId),
    );

    expectAuthorityReadsToRejectCorruptProof(seeded.workspaceId);
  });

  it.each([
    ['malformed timestamp', 'not-a-time', '2026-07-14T12:10:00.000Z'],
    ['inverted time window', '2026-07-14T12:10:00.000Z', '2026-07-14T12:00:00.000Z'],
    ['overlong time window', '2026-07-14T12:00:00.000Z', '2026-07-14T12:16:00.001Z'],
  ])('fails closed on a stored %s', (_label, issuedAt, expiresAt) => {
    const { seeded, profile } = workspaceWithProfile();
    const token = `temporal-${randomUUID()}`;
    insertRawAuthorization({
      workspaceId: seeded.workspaceId,
      profileId: profile.id,
      profileRevision: profile.revision,
      token,
      issuedAt,
      expiresAt,
    });

    expect(() => consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: token,
      executionActor: mcpActor,
    })).toThrow(VoiceFinalizationPersistenceContractError);
    expect(countRows('voice_profile_finalizations', seeded.workspaceId)).toBe(0);
    expect(getVoiceProfile(seeded.workspaceId)?.revision).toBe(profile.revision);
  });

  it('rejects an otherwise valid authorization issued in the future', () => {
    const { seeded, profile } = workspaceWithProfile();
    const token = `future-${randomUUID()}`;
    const issuedAt = new Date(Date.now() + 5 * 60_000);
    const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
    insertRawAuthorization({
      workspaceId: seeded.workspaceId,
      profileId: profile.id,
      profileRevision: profile.revision,
      token,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    expect(() => consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: token,
      executionActor: mcpActor,
    })).toThrow(VoiceFinalizationAuthorizationError);
    expect(countRows('voice_profile_finalizations', seeded.workspaceId)).toBe(0);
  });

  it('rejects operator, client, and system execution actors before mutation', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const request = finalizationRequest(seeded.workspaceId, sampleId);
    const authorization = createVoiceFinalizationAuthorization(authorizationRequest(request));

    for (const actorType of ['operator', 'client', 'system'] as const) {
      expect(() => consumeVoiceFinalizationAuthorization({
        workspaceId: seeded.workspaceId,
        authorizationToken: authorization.authorizationToken,
        executionActor: {
          actorType,
          actorId: `${actorType}-executor`,
          actorLabel: `${actorType} executor`,
        },
      } as never)).toThrow(VoiceFinalizationAuthorizationError);
    }
    expect(countRows('voice_profile_finalizations', seeded.workspaceId)).toBe(0);
    expect(getVoiceProfile(seeded.workspaceId)?.revision).toBe(profile.revision);
    expect(db.prepare(`
      SELECT consumed_at, finalization_id, execution_actor_json
      FROM voice_finalization_authorizations
      WHERE id = ?
    `).get(authorization.authorization.authorizationId)).toEqual({
      consumed_at: null,
      finalization_id: null,
      execution_actor_json: null,
    });
  });

  it('replays a consumed immutable result through the frozen version 1 request codec', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const request = finalizationRequest(seeded.workspaceId, sampleId);
    const firstAuthorization = createVoiceFinalizationAuthorization(
      authorizationRequest(request),
    );
    const first = consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: firstAuthorization.authorizationToken,
      executionActor: mcpActor,
    });
    const finalizationRow = db.prepare(`
      SELECT mutation_fingerprint
      FROM voice_profile_finalizations
      WHERE id = ?
    `).get(first.snapshot.id) as { mutation_fingerprint: string };
    const replayActor = {
      actorType: 'mcp' as const,
      actorId: 'mcp-redundant-proof',
      actorLabel: 'Redundant proof executor',
    };
    const replayToken = `replay-${randomUUID()}`;
    const issuedAt = new Date();
    const consumedAt = new Date(issuedAt.getTime() + 100);
    const {
      workspaceId: _workspaceId,
      authorizedBy: _authorizedBy,
      ...storedInput
    } = authorizationRequest(request);
    void _workspaceId;
    void _authorizedBy;
    db.prepare(`
      INSERT INTO voice_finalization_authorizations (
        id, token_hash, workspace_id, voice_profile_id,
        expected_profile_revision, request_json, mutation_fingerprint,
        authorized_by_json, issued_at, expires_at, consumed_at,
        finalization_id, execution_actor_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `replay-auth-${randomUUID()}`,
      authorizationTokenHash(replayToken),
      seeded.workspaceId,
      profile.id,
      request.expectedProfileRevision,
      JSON.stringify(storedInput),
      finalizationRow.mutation_fingerprint,
      JSON.stringify(operator),
      issuedAt.toISOString(),
      new Date(issuedAt.getTime() + 15 * 60_000).toISOString(),
      consumedAt.toISOString(),
      first.snapshot.id,
      JSON.stringify(replayActor),
    );

    const replay = consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: replayToken,
      executionActor: replayActor,
    });
    expect(replay).toMatchObject({ created: false, replayed: true });
    expect(replay.snapshot.id).toBe(first.snapshot.id);
    expect(replay.snapshot.executionActor).toEqual(mcpActor);
    expect(() => consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: replayToken,
      executionActor: mcpActor,
    })).toThrow(VoiceFinalizationAuthorizationError);
  });

  it('records redundant MCP proof when an operator directly finalized first', () => {
    const { seeded, profile } = workspaceWithProfile();
    const sampleId = insertRawSample(profile.id, 0);
    const request = finalizationRequest(seeded.workspaceId, sampleId);
    const authorization = createVoiceFinalizationAuthorization(authorizationRequest(request));
    const direct = finalizeBrandVoice(request);
    const redundantActor = {
      actorType: 'mcp' as const,
      actorId: 'mcp-after-direct',
      actorLabel: 'MCP after direct finalization',
    };

    const consumed = consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: authorization.authorizationToken,
      executionActor: redundantActor,
    });
    expect(consumed).toMatchObject({ created: false, replayed: true });
    expect(consumed.snapshot.id).toBe(direct.snapshot.id);
    expect(consumed.snapshot.executionActor).toEqual(operator);
    expect(db.prepare(`
      SELECT finalization_id, execution_actor_json
      FROM voice_finalization_authorizations
      WHERE id = ?
    `).get(authorization.authorization.authorizationId)).toEqual({
      finalization_id: direct.snapshot.id,
      execution_actor_json: JSON.stringify(redundantActor),
    });
    expect(consumeVoiceFinalizationAuthorization({
      workspaceId: seeded.workspaceId,
      authorizationToken: authorization.authorizationToken,
      executionActor: redundantActor,
    })).toMatchObject({ replayed: true });
  });
});
