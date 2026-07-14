import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  BrandIntakePayload,
  BrandIntakeSubmissionRequest,
  ResolveBrandIntakeEvidenceRequest,
} from '../../shared/types/brand-intake.js';
import { brandIntakePayloadSchema } from '../../shared/types/brand-intake-schemas.js';
import db from '../../server/db/index.js';
import {
  BrandIntakeConflictError,
  BrandIntakeIdempotencyConflictError,
  BrandIntakeNotFoundError,
  BrandIntakePersistenceContractError,
  getBrandIntakeRevision,
  resolveBrandIntakeEvidence,
  submitBrandIntake,
} from '../../server/domains/brand/intake/index.js';
import { createWorkspace, deleteWorkspace, getWorkspace, updateWorkspace } from '../../server/workspaces.js';

const cleanupWorkspaceIds: string[] = [];

afterEach(() => {
  db.exec('DROP TRIGGER IF EXISTS fail_brand_intake_projection');
  db.exec('DROP TRIGGER IF EXISTS fail_authoritative_brand_voice_write');
  for (const workspaceId of cleanupWorkspaceIds.splice(0)) {
    db.prepare('DELETE FROM voice_profiles WHERE workspace_id = ?').run(workspaceId);
    deleteWorkspace(workspaceId);
  }
});

function createTestWorkspace(label: string): string {
  const workspace = createWorkspace(`Brand Intake ${label} ${Date.now()} ${randomUUID()}`);
  cleanupWorkspaceIds.push(workspace.id);
  return workspace.id;
}

function payload(overrides: Partial<BrandIntakePayload> = {}): BrandIntakePayload {
  const base = brandIntakePayloadSchema.parse({
    schemaVersion: 1,
    business: {
      businessName: 'Northstar Dental',
      industry: 'Dentistry',
      description: 'Patient-first dental care.',
      services: 'Preventive care\nCosmetic dentistry',
      locations: 'Austin, Texas',
      differentiators: 'Longer appointments and plain-language guidance.',
      website: 'https://northstar.example',
    },
    audience: {
      primaryAudience: 'Busy families',
      painPoints: 'Hard-to-book appointments\nConfusing treatment plans',
      goals: 'Stay healthy\nUnderstand every option',
      objections: 'Cost uncertainty',
      buyingStage: 'consideration',
      secondaryAudience: 'Anxious adults',
    },
    brand: {
      tone: 'Warm, direct, and reassuring',
      personality: ['Patient', 'Clear'],
      avoidWords: 'Pain-free guarantee',
      contentFormats: ['Guides', 'FAQs'],
      existingExamples: 'We explain what matters, then let you decide.',
    },
    competitors: {
      competitors: 'https://www.competitor-a.example/services\ncompetitor-b.example',
      whatTheyDoBetter: 'More locations',
      whatYouDoBetter: 'More time with each patient',
      referenceUrls: 'https://competitor-a.example/about',
    },
    authenticSamples: [],
  });
  return brandIntakePayloadSchema.parse({ ...base, ...overrides });
}

function submission(
  workspaceId: string,
  intakePayload = payload(),
): BrandIntakeSubmissionRequest {
  return {
    workspaceId,
    payload: intakePayload,
    source: 'client_portal',
    submitter: {
      actorType: 'client',
      actorId: `client:${workspaceId}`,
      actorLabel: 'Client portal',
    },
  };
}

function resolution(
  workspaceId: string,
  intakeRevisionId: string,
  expectedRevision: number,
  idempotencyKey = 'resolve-website-1',
): ResolveBrandIntakeEvidenceRequest {
  return {
    workspaceId,
    intakeRevisionId,
    expectedRevision,
    requirementId: 'brand-intake:business.website',
    fieldPath: 'business.website',
    value: { kind: 'url', value: 'https://verified.example' },
    sourceRef: {
      sourceType: 'operator_attestation',
      sourceId: 'attestation-website-1',
      fieldPath: 'business.website',
      capturedAt: '2026-07-13T12:00:00.000Z',
    },
    resolvedBy: {
      actorType: 'operator',
      actorId: 'operator-1',
      actorLabel: 'Operator One',
    },
    idempotencyKey,
  };
}

describe('brand intake durable service', () => {
  it('creates the first immutable revision and a deterministic compatibility projection', () => {
    const workspaceId = createTestWorkspace('first');
    updateWorkspace(workspaceId, {
      knowledgeBase: 'Manual knowledge stays.',
      brandVoice: 'Manual voice stays.',
      competitorDomains: ['manual.example'],
      personas: [{
        id: 'manual-persona',
        name: 'Manual persona',
        description: 'Do not replace me.',
        painPoints: [],
        goals: [],
        objections: [],
      }],
    });

    const basePayload = payload();
    const result = submitBrandIntake(submission(workspaceId, payload({
      competitors: {
        ...basePayload.competitors,
        competitors: `${basePayload.competitors.competitors}\nhttps://northstar.example\nhttps://youtube.com`,
      },
    })));
    const workspace = getWorkspace(workspaceId);

    expect(result.created).toBe(true);
    expect(result.postCommitEffect?.activity.type).toBe('client_onboarding_submitted');
    expect(result.projectionChanged).toBe(true);
    expect(result.revision.revision).toBe(1);
    expect(result.revision.supersedesRevisionId).toBeNull();
    expect(result.revision.supersededByRevisionId).toBeNull();
    expect(workspace?.onboardingCompleted).toBe(true);
    expect(workspace?.knowledgeBase).toContain('Manual knowledge stays.');
    expect(workspace?.knowledgeBase).toContain('Business Name: Northstar Dental');
    expect(workspace?.brandVoice).toContain('Manual voice stays.');
    expect(workspace?.brandVoice).toContain('Tone: Warm, direct, and reassuring');
    expect(workspace?.competitorDomains).toEqual([
      'manual.example',
      'competitor-a.example',
      'competitor-b.example',
    ]);
    expect(workspace?.personas?.map(persona => persona.id)).toEqual([
      'manual-persona',
      'persona_brand_intake_primary',
      'persona_brand_intake_secondary',
    ]);

    const read = getBrandIntakeRevision({ workspaceId });
    expect(read.revision?.id).toBe(result.revision.id);
    expect(read.fieldEvidence).toHaveLength(22);
    expect(read.fieldEvidence.find(item => item.fieldPath === 'business.website')?.availability)
      .toBe('submitted');
    expect(read.fieldEvidence.find(item => item.fieldPath === 'audience.buyingStage')?.availability)
      .toBe('submitted');
  });

  it('distinguishes an omitted buying stage from an explicit All stages answer', () => {
    const omittedWorkspaceId = createTestWorkspace('buying-stage-omitted');
    const explicitWorkspaceId = createTestWorkspace('buying-stage-explicit');
    const omitted = payload();
    omitted.audience.buyingStage = '';

    submitBrandIntake(submission(omittedWorkspaceId, omitted));
    submitBrandIntake(submission(explicitWorkspaceId));

    expect(getBrandIntakeRevision({ workspaceId: omittedWorkspaceId }).fieldEvidence
      .find(item => item.fieldPath === 'audience.buyingStage')?.availability).toBe('missing');
    expect(getBrandIntakeRevision({ workspaceId: explicitWorkspaceId }).fieldEvidence
      .find(item => item.fieldPath === 'audience.buyingStage')?.availability).toBe('submitted');
  });

  it('replays an identical current submission without a new row or duplicate projection', () => {
    const workspaceId = createTestWorkspace('repeat');
    const request = submission(workspaceId);
    const first = submitBrandIntake(request);
    const second = submitBrandIntake(request);
    const workspace = getWorkspace(workspaceId);

    expect(second.created).toBe(false);
    expect(second.projectionChanged).toBe(false);
    expect(second.revision.id).toBe(first.revision.id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM brand_intake_revisions WHERE workspace_id = ?')
      .get(workspaceId)).toEqual({ count: 1 });
    expect(workspace?.knowledgeBase?.match(/BRAND INTAKE KNOWLEDGE — MANAGED/g)).toHaveLength(1);
    expect(workspace?.brandVoice?.match(/BRAND INTAKE VOICE — MANAGED/g)).toHaveLength(1);
    expect(workspace?.personas?.filter(persona => persona.id.startsWith('persona_brand_intake_')))
      .toHaveLength(2);
  });

  it('records identical answers again when submission provenance changes', () => {
    const workspaceId = createTestWorkspace('provenance-change');
    const intakePayload = payload();
    const adminRequest: BrandIntakeSubmissionRequest = {
      workspaceId,
      payload: intakePayload,
      source: 'admin',
      submitter: { actorType: 'operator', actorId: 'operator-1' },
    };

    const adminSeed = submitBrandIntake(adminRequest);
    const clientConfirmation = submitBrandIntake(submission(workspaceId, intakePayload));
    const adminConfirmation = submitBrandIntake(adminRequest);
    const adminRetry = submitBrandIntake(adminRequest);

    expect(adminSeed.revision.revision).toBe(1);
    expect(clientConfirmation).toMatchObject({ created: true });
    expect(clientConfirmation.revision).toMatchObject({
      revision: 2,
      source: 'client_portal',
      submitter: { actorType: 'client' },
    });
    expect(clientConfirmation.postCommitEffect?.activity.type)
      .toBe('client_onboarding_submitted');
    expect(adminConfirmation).toMatchObject({ created: true });
    expect(adminConfirmation.revision).toMatchObject({ revision: 3, source: 'admin' });
    expect(adminConfirmation.postCommitEffect?.activity.type).toBe('brand_intake_submitted');
    expect(adminRetry).toMatchObject({ created: false, postCommitEffect: null });
  });

  it('rejects source and submitter actor mismatches before persistence or activity', () => {
    const workspaceId = createTestWorkspace('source-actor-pair');
    const base = submission(workspaceId);
    const invalidRequests: BrandIntakeSubmissionRequest[] = [
      { ...base, source: 'client_portal', submitter: { actorType: 'operator', actorId: 'operator-1' } },
      { ...base, source: 'admin', submitter: { actorType: 'client', actorId: 'client-1' } },
      { ...base, source: 'mcp', submitter: { actorType: 'operator', actorId: 'operator-1' } },
      { ...base, source: 'migration', submitter: { actorType: 'mcp', actorId: 'mcp-1' } },
    ];

    for (const request of invalidRequests) {
      expect(() => submitBrandIntake(request)).toThrow();
    }
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM brand_intake_revisions WHERE workspace_id = ?
    `).get(workspaceId)).toEqual({ count: 0 });
  });

  it('creates revision 2 for changed input and revision 3 for a legal A to B to A restoration', () => {
    const workspaceId = createTestWorkspace('restore');
    const a = payload();
    const b = payload({
      business: { ...a.business, description: 'A newly revised description.' },
    });

    const revision1 = submitBrandIntake(submission(workspaceId, a)).revision;
    const revision2 = submitBrandIntake(submission(workspaceId, b)).revision;
    const revision3 = submitBrandIntake(submission(workspaceId, a)).revision;

    expect([revision1.revision, revision2.revision, revision3.revision]).toEqual([1, 2, 3]);
    expect(revision2.supersedesRevisionId).toBe(revision1.id);
    expect(revision3.supersedesRevisionId).toBe(revision2.id);
    expect(revision3.fingerprint).toBe(revision1.fingerprint);
    expect(getBrandIntakeRevision({ workspaceId, intakeRevisionId: revision1.id }).revision)
      .toMatchObject({ id: revision1.id, supersededByRevisionId: revision2.id });
    expect(db.prepare('SELECT supersedes_revision_id FROM brand_intake_revisions WHERE id = ?')
      .get(revision1.id)).toEqual({ supersedes_revision_id: null });
  });

  it('replaces legacy append-only blocks and timestamp personas while preserving unrelated data', () => {
    const workspaceId = createTestWorkspace('legacy');
    updateWorkspace(workspaceId, {
      knowledgeBase: 'Manual KB\n\n--- Client Onboarding Responses ---\nOld intake response',
      brandVoice: 'Manual Voice\n\n--- Client Onboarding Responses ---\nOld voice response',
      personas: [
        {
          id: 'persona_onboard_123', name: 'Old primary', description: '',
          painPoints: [], goals: [], objections: [],
        },
        {
          id: 'persona_onboard2_456', name: 'Old secondary', description: '',
          painPoints: [], goals: [], objections: [],
        },
        {
          id: 'unrelated', name: 'Unrelated', description: 'Keep',
          painPoints: [], goals: [], objections: [],
        },
      ],
    });

    submitBrandIntake(submission(workspaceId));
    const workspace = getWorkspace(workspaceId);

    expect(workspace?.knowledgeBase).toContain('Manual KB');
    expect(workspace?.knowledgeBase).not.toContain('Old intake response');
    expect(workspace?.brandVoice).toContain('Manual Voice');
    expect(workspace?.brandVoice).not.toContain('Old voice response');
    expect(workspace?.personas?.map(persona => persona.id)).toEqual([
      'unrelated',
      'persona_brand_intake_primary',
      'persona_brand_intake_secondary',
    ]);

    const completeKnowledgeBlock = [
      '--- BRAND INTAKE KNOWLEDGE — MANAGED ---',
      'obsolete complete knowledge',
      '--- END MANAGED BRAND INTAKE KNOWLEDGE ---',
    ].join('\n');
    const completeVoiceBlock = [
      '--- BRAND INTAKE VOICE — MANAGED ---',
      'obsolete complete voice',
      '--- END MANAGED BRAND INTAKE VOICE ---',
    ].join('\n');
    updateWorkspace(workspaceId, {
      knowledgeBase: [
        'Manual prefix',
        completeKnowledgeBlock,
        'Manual suffix',
        completeKnowledgeBlock,
        '--- BRAND INTAKE KNOWLEDGE — MANAGED ---',
        'malformed knowledge marker stays',
      ].join('\n\n'),
      brandVoice: [
        'Manual voice prefix',
        completeVoiceBlock,
        'Manual voice suffix',
        completeVoiceBlock,
        '--- BRAND INTAKE VOICE — MANAGED ---',
        'malformed voice marker stays',
        '--- Brand Voice (from onboarding) ---',
        'cross-column marker stays',
      ].join('\n\n'),
    });
    const revised = payload({
      business: { ...payload().business, description: 'Changed to force revision 2.' },
    });
    submitBrandIntake(submission(workspaceId, revised));
    const replaced = getWorkspace(workspaceId);
    expect(replaced?.knowledgeBase).toContain('Manual prefix');
    expect(replaced?.knowledgeBase).toContain('Manual suffix');
    expect(replaced?.knowledgeBase).toContain('malformed knowledge marker stays');
    expect(replaced?.knowledgeBase).not.toContain('obsolete complete knowledge');
    expect(replaced?.knowledgeBase?.match(/END MANAGED BRAND INTAKE KNOWLEDGE/g)).toHaveLength(1);
    expect(replaced?.brandVoice).toContain('Manual voice prefix');
    expect(replaced?.brandVoice).toContain('Manual voice suffix');
    expect(replaced?.brandVoice).toContain('malformed voice marker stays');
    expect(replaced?.brandVoice).toContain('cross-column marker stays');
    expect(replaced?.brandVoice).not.toContain('obsolete complete voice');
    expect(replaced?.brandVoice?.match(/END MANAGED BRAND INTAKE VOICE/g)).toHaveLength(1);
  });

  it('leaves calibrated legacy brand voice byte-for-byte unchanged and folds intake voice into knowledge', () => {
    const workspaceId = createTestWorkspace('calibrated');
    const exactVoice = 'CALIBRATED LEGACY VOICE\n  Preserve spacing exactly.  ';
    updateWorkspace(workspaceId, {
      brandVoice: exactVoice,
      knowledgeBase: 'Manual KB\n\n--- Brand Voice (from onboarding) ---\nOld folded voice',
    });
    const now = '2026-07-13T12:00:00.000Z';
    db.prepare(`
      INSERT INTO voice_profiles (
        id, workspace_id, status, voice_dna_json, guardrails_json,
        context_modifiers_json, created_at, updated_at
      ) VALUES (?, ?, 'calibrated', NULL, NULL, NULL, ?, ?)
    `).run(`voice-${randomUUID()}`, workspaceId, now, now);
    db.exec(`
      CREATE TEMP TRIGGER fail_authoritative_brand_voice_write
      BEFORE UPDATE OF brand_voice ON workspaces
      WHEN NEW.id = '${workspaceId}'
      BEGIN
        SELECT RAISE(ABORT, 'authoritative brand voice must not be written');
      END;
    `);

    submitBrandIntake(submission(workspaceId));
    const workspace = getWorkspace(workspaceId);

    expect(workspace?.brandVoice).toBe(exactVoice);
    expect(workspace?.knowledgeBase).toContain('Brand Voice Preferences (intake)');
    expect(workspace?.knowledgeBase).toContain('Tone: Warm, direct, and reassuring');
    expect(workspace?.knowledgeBase).not.toContain('Old folded voice');
  });

  it('removes only predecessor intake-owned competitor domains when the submission changes', () => {
    const workspaceId = createTestWorkspace('competitors');
    updateWorkspace(workspaceId, { competitorDomains: ['manual.example', 'overlap.example'] });
    const basePayload = payload();
    const firstPayload = payload({
      competitors: {
        ...basePayload.competitors,
        competitors: `${basePayload.competitors.competitors}\noverlap.example`,
      },
    });
    const secondPayload = payload({
      competitors: {
        ...firstPayload.competitors,
        competitors: 'https://competitor-c.example',
      },
    });

    submitBrandIntake(submission(workspaceId, firstPayload));
    submitBrandIntake(submission(workspaceId, secondPayload));

    expect(getWorkspace(workspaceId)?.competitorDomains).toEqual([
      'manual.example',
      'overlap.example',
      'competitor-c.example',
    ]);
  });

  it('creates an immutable evidence-resolution successor and replays the same idempotency key', () => {
    const workspaceId = createTestWorkspace('resolution');
    const source = submitBrandIntake(submission(workspaceId)).revision;
    const request = resolution(workspaceId, source.id, source.revision);

    const created = resolveBrandIntakeEvidence(request);
    const replay = resolveBrandIntakeEvidence(request);

    expect(created).toMatchObject({ created: true, replayed: false });
    expect(created.postCommitEffect?.activity.type).toBe('brand_intake_evidence_resolved');
    expect(created.revision.revision).toBe(2);
    expect(created.revision.supersedesRevisionId).toBe(source.id);
    expect(created.revision.evidenceResolutions).toHaveLength(1);
    expect(replay).toMatchObject({ created: false, replayed: true });
    expect(replay.revision.id).toBe(created.revision.id);
    expect(getWorkspace(workspaceId)?.knowledgeBase).toContain('Website: https://verified.example');
    expect(getBrandIntakeRevision({ workspaceId }).fieldEvidence
      .find(item => item.fieldPath === 'business.website')).toMatchObject({ availability: 'resolved' });

    const resubmitted = submitBrandIntake(submission(workspaceId));
    expect(resubmitted.created).toBe(true);
    expect(resubmitted.revision.revision).toBe(3);
    expect(resubmitted.revision.evidenceResolutions).toEqual([]);
    expect(getWorkspace(workspaceId)?.knowledgeBase).toContain('Website: https://northstar.example');
  });

  it('uses an admin-only intake activity for operator and MCP submissions', () => {
    const workspaceId = createTestWorkspace('activity-mapping');
    const operator = submitBrandIntake({
      ...submission(workspaceId),
      source: 'admin',
      submitter: { actorType: 'operator', actorId: 'operator-1' },
    });
    expect(operator.postCommitEffect?.activity.type).toBe('brand_intake_submitted');

    const base = payload();
    const fromMcp = submitBrandIntake({
      ...submission(workspaceId, payload({
        business: { ...base.business, description: 'Changed by MCP.' },
      })),
      source: 'mcp',
      submitter: { actorType: 'mcp', actorId: 'mcp-key-1' },
    });
    expect(fromMcp.postCommitEffect?.activity.type).toBe('brand_intake_submitted');
  });

  it('rejects stale evidence writes, idempotency-key mutation conflicts, and wrong value kinds', () => {
    const workspaceId = createTestWorkspace('resolution-conflicts');
    const source = submitBrandIntake(submission(workspaceId)).revision;
    const original = resolution(workspaceId, source.id, source.revision);
    resolveBrandIntakeEvidence(original);

    expect(() => resolveBrandIntakeEvidence({
      ...original,
      value: { kind: 'url', value: 'https://different.example' },
    })).toThrow(BrandIntakeIdempotencyConflictError);
    expect(() => resolveBrandIntakeEvidence({
      ...original,
      idempotencyKey: 'stale-new-key',
    })).toThrow(BrandIntakeConflictError);
    expect(() => resolveBrandIntakeEvidence({
      ...original,
      idempotencyKey: 'wrong-kind',
      intakeRevisionId: getBrandIntakeRevision({ workspaceId }).revision!.id,
      expectedRevision: 2,
      value: { kind: 'text_list', value: ['not a URL'] },
    } as ResolveBrandIntakeEvidenceRequest)).toThrow();

    expect(() => resolveBrandIntakeEvidence({
      ...original,
      intakeRevisionId: 'intake-does-not-exist',
      expectedRevision: 999,
      idempotencyKey: 'missing-revision',
    })).toThrow(BrandIntakeNotFoundError);
  });

  it('rolls back the immutable row when compatibility projection fails', () => {
    const workspaceId = createTestWorkspace('rollback');
    db.exec(`
      CREATE TEMP TRIGGER fail_brand_intake_projection
      BEFORE UPDATE OF onboarding_completed ON workspaces
      WHEN NEW.id = '${workspaceId}'
      BEGIN
        SELECT RAISE(ABORT, 'projection failed');
      END;
    `);

    expect(() => submitBrandIntake(submission(workspaceId))).toThrow(/projection failed/);
    expect(db.prepare('SELECT COUNT(*) AS count FROM brand_intake_revisions WHERE workspace_id = ?')
      .get(workspaceId)).toEqual({ count: 0 });
    expect(getWorkspace(workspaceId)?.onboardingCompleted).not.toBe(true);
  });

  it('fails closed when stored evidence arrays exceed the field census or duplicate a field', () => {
    const duplicateWorkspaceId = createTestWorkspace('corrupt-duplicates');
    const invalidWorkspaceId = createTestWorkspace('corrupt-invalid');
    const projectionWorkspaceId = createTestWorkspace('corrupt-projection');
    const duplicateSource = submitBrandIntake(submission(duplicateWorkspaceId)).revision;
    const invalidSource = submitBrandIntake(submission(invalidWorkspaceId)).revision;
    const projectionSource = submitBrandIntake(submission(projectionWorkspaceId)).revision;
    const duplicate = {
      id: 'duplicate-resolution',
      requirementId: 'brand-intake:business.website',
      fieldPath: 'business.website',
      value: { kind: 'url', value: 'https://verified.example' },
      sourceRef: {
        sourceType: 'operator_attestation',
        sourceId: 'attestation-1',
        capturedAt: '2026-07-13T12:00:00.000Z',
      },
      resolvedBy: { actorType: 'operator', actorId: 'operator-1' },
      expectedSourceRevision: 1,
      expectedArtifactRevisions: [],
      resolvedAt: '2026-07-13T12:00:00.000Z',
    };
    const insertCorruptSuccessor = db.prepare(`
      INSERT INTO brand_intake_revisions (
        id, workspace_id, revision, schema_version, payload_json,
        evidence_resolutions_json, projection_state_json, fingerprint, source,
        submitter_json, mutation_kind, mutation_fingerprint, idempotency_key,
        supersedes_revision_id, created_at
      )
      SELECT
        @id, workspace_id, 2, schema_version, payload_json,
        @evidence_resolutions_json, @projection_state_json, @fingerprint, 'admin',
        '{"actorType":"operator","actorId":"operator-1"}',
        'evidence_resolution', @mutation_fingerprint, @idempotency_key,
        id, '2026-07-13T12:00:00.000Z'
      FROM brand_intake_revisions
      WHERE id = @source_id
    `);
    const insertCorrupt = (
      sourceId: string,
      id: string,
      evidenceResolutionsJson: string,
      projectionStateJson?: string,
    ) => {
      const root = db.prepare(`
        SELECT projection_state_json FROM brand_intake_revisions WHERE id = ?
      `).get(sourceId) as { projection_state_json: string };
      return insertCorruptSuccessor.run({
        id,
        evidence_resolutions_json: evidenceResolutionsJson,
        projection_state_json: projectionStateJson ?? root.projection_state_json,
        fingerprint: 'd'.repeat(64),
        mutation_fingerprint: 'e'.repeat(64),
        idempotency_key: id,
        source_id: sourceId,
      });
    };

    insertCorrupt(
      duplicateSource.id,
      'intake-corrupt-duplicates',
      JSON.stringify([duplicate, { ...duplicate, id: 'duplicate-resolution-2' }]),
    );

    expect(() => getBrandIntakeRevision({ workspaceId: duplicateWorkspaceId }))
      .toThrow(BrandIntakePersistenceContractError);

    insertCorrupt(
      invalidSource.id,
      'intake-corrupt-invalid',
      JSON.stringify([duplicate, { id: 'invalid-resolution' }]),
    );
    expect(() => getBrandIntakeRevision({ workspaceId: invalidWorkspaceId }))
      .toThrow(BrandIntakePersistenceContractError);

    insertCorrupt(
      projectionSource.id,
      'intake-corrupt-projection',
      '[]',
      JSON.stringify({
        preservedCompetitorDomains: ['www.overlap.example'],
        intakeOwnedCompetitorDomains: ['overlap.example'],
      }),
    );
    expect(() => getBrandIntakeRevision({ workspaceId: projectionWorkspaceId }))
      .toThrow(BrandIntakePersistenceContractError);
  });
});
