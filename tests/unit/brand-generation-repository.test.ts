import { afterEach, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import {
  acceptBrandGenerationRevisionCommand,
  acceptBrandGenerationResumeCommand,
  acceptBrandGenerationStartCommand,
  beginBrandGenerationAttempt,
  brandGenerationAcceptedEffectKey,
  brandGenerationArtifactEffectKey,
  brandGenerationCompletedEffectKey,
  cancelBrandGenerationAttempt,
  commitBrandGenerationDeliverableCandidate,
  completeBrandGenerationAttempt,
  countBrandGenerationAttemptsForCommand,
  failBrandGenerationAttempt,
  getBrandGenerationAttempt,
  getBrandGenerationEffectEvent,
  getBrandGenerationItem,
  getBrandGenerationRun,
  getPersistedBrandGenerationRun,
  isBrandGenerationJobRepairEligible,
  listBrandGenerationItemsPage,
  lookupBrandGenerationStartReplay,
  reserveBrandGenerationAttemptBudget,
  transitionBrandGenerationItem,
  transitionBrandGenerationRun,
  type AcceptBrandGenerationStartCommandInput,
  type AcceptBrandGenerationResumeCommandInput,
  type AcceptBrandGenerationRevisionCommandInput,
  type BrandGenerationPreparedItem,
} from '../../server/domains/brand/generation/repository.js';
import {
  BrandGenerationApprovedDeliverableError,
  BrandGenerationAttemptCheckpointConflictError,
  BrandGenerationBudgetExceededError,
  BrandGenerationConcurrencyLimitError,
  BrandGenerationCursorError,
  BrandGenerationIdempotencyConflictError,
  BrandGenerationPersistenceContractError,
  BrandGenerationRevisionConflictError,
} from '../../server/domains/brand/generation/errors.js';
import { brandGenerationPreflightAttemptOutputSchema } from '../../server/domains/brand/generation/persistence-schemas.js';
import { canonicalBrandGenerationFingerprint } from '../../server/domains/brand/generation/fingerprint.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type {
  BrandGenerationAttempt,
  BrandGenerationTargetInputSnapshot,
  FinalizedVoiceSnapshotRef,
  StartBrandGenerationRequest,
} from '../../shared/types/brand-generation.js';
import { BRAND_GENERATION_PRESET_POLICY } from '../../shared/types/brand-generation.js';
import type { BrandIntakeRevisionRef } from '../../shared/types/brand-intake.js';

const cleanup: string[] = [];
const FINGERPRINTS = Array.from({ length: 20 }, (_, index) =>
  (index + 1).toString(16).padStart(64, '0'));

afterEach(() => {
  for (const workspaceId of cleanup.splice(0)) {
    // Vitest disables foreign keys in worker DBs, so fixture cleanup must be
    // explicit. Remove the workspace first to satisfy immutable-history
    // triggers, then clear B2-owned descendants from leaf to root.
    deleteWorkspace(workspaceId);
    db.prepare(`
      DELETE FROM brand_identity_versions
      WHERE deliverable_id IN (
        SELECT id FROM brand_identity_deliverables WHERE workspace_id = ?
      )
    `).run(workspaceId);
    db.prepare(`
      DELETE FROM brand_generation_attempts
      WHERE item_id IN (
        SELECT id FROM brand_generation_items WHERE workspace_id = ?
      )
    `).run(workspaceId);
    db.prepare('DELETE FROM brand_generation_effect_events WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_generation_commands WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_generation_items WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_generation_runs WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_identity_deliverables WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_intake_revisions WHERE workspace_id = ?').run(workspaceId);
  }
});

function seedWorkspace(label: string): { workspaceId: string; intake: BrandIntakeRevisionRef } {
  const workspaceId = createWorkspace(`${label} ${Date.now()} ${Math.random()}`).id;
  cleanup.push(workspaceId);
  const intake = {
    intakeRevisionId: `bir_${workspaceId.slice(-8)}_${Math.random().toString(16).slice(2)}`,
    revision: 1,
    fingerprint: FINGERPRINTS[0]!,
  };
  db.prepare(`
    INSERT INTO brand_intake_revisions (
      id, workspace_id, revision, schema_version, payload_json,
      evidence_resolutions_json, projection_state_json, fingerprint, source,
      submitter_json, mutation_kind, mutation_fingerprint, idempotency_key,
      supersedes_revision_id, created_at
    ) VALUES (?, ?, 1, 1, '{}', '[]',
      '{"preservedCompetitorDomains":[],"intakeOwnedCompetitorDomains":[]}',
      ?, 'admin', '{"actorType":"operator","actorId":"op-test"}',
      'submission', ?, NULL, NULL, ?)
  `).run(intake.intakeRevisionId, workspaceId, intake.fingerprint, FINGERPRINTS[1], new Date().toISOString());
  return { workspaceId, intake };
}

const finalizedVoice: FinalizedVoiceSnapshotRef = {
  voiceProfileId: 'vp-test',
  voiceVersion: 3,
  finalizedBy: { actorType: 'operator', actorId: 'op-voice', actorLabel: 'Voice lead' },
  finalizedAt: '2026-07-14T00:00:00.000Z',
  fingerprint: FINGERPRINTS[2]!,
  anchorEvidenceRefs: [{
    sourceType: 'client_submission',
    sourceId: 'sample-1',
    capturedAt: '2026-07-13T00:00:00.000Z',
    selectedBy: { actorType: 'operator', actorId: 'op-voice' },
    selectedAt: '2026-07-14T00:00:00.000Z',
  }],
};

function preparedItem(
  intake: BrandIntakeRevisionRef,
  target: BrandGenerationPreparedItem['target'],
  artifactExpectation: BrandGenerationTargetInputSnapshot['artifactExpectation'],
  _fingerprintSeed = FINGERPRINTS[3]!,
): BrandGenerationPreparedItem {
  const core = {
    schemaVersion: 1 as const,
    target,
    intakeRevision: intake,
    voiceSnapshot: target === 'voice_foundation' ? null : finalizedVoice,
    approvedDeliverables: [],
    evidenceRequirementIds: [],
    artifactExpectation,
    capturedAt: '2026-07-14T01:00:00.000Z',
  };
  return {
    target,
    inputSnapshot: {
      ...core,
      fingerprint: canonicalBrandGenerationFingerprint(core),
    },
  };
}

function mcpAttribution(workspaceId: string, requestId = 'request-1') {
  return {
    createdBy: { actorType: 'mcp' as const, actorId: 'key-1', actorLabel: 'Automation' },
    mcpExecutionContext: {
      requestId,
      toolName: 'start_brand_deliverable_generation',
      targetWorkspaceId: workspaceId,
      caller: {
        kind: 'workspace_key' as const,
        scope: workspaceId,
        workspaceId,
        keyId: 'key-1',
        keyLabel: 'Automation',
      },
    },
  };
}

const maxBudget = {
  maxProviderCalls: 114,
  maxInputTokens: 5_000_000,
  maxOutputTokens: 250_000,
  maxEstimatedCostMicros: 100_000_000,
  maxConcurrency: 3,
};

const maxEstimate = {
  providerCalls: 114,
  inputTokens: 5_000_000,
  outputTokens: 250_000,
  estimatedCostMicros: 100_000_000,
  maxConcurrency: 3,
};

type BrandGenerationAttemptOutput = Exclude<BrandGenerationAttempt['output'], null>;

function foundationStart(
  workspaceId: string,
  intake: BrandIntakeRevisionRef,
  key = 'start-foundation',
  requestId = 'request-1',
): AcceptBrandGenerationStartCommandInput {
  const request: StartBrandGenerationRequest = {
    workspaceId,
    intakeRevisionId: intake.intakeRevisionId,
    expectedIntakeRevision: intake.revision,
    expectedIntakeFingerprint: intake.fingerprint,
    selection: { kind: 'preset', preset: 'full_brand_system' },
    budget: maxBudget,
    idempotencyKey: key,
    ...mcpAttribution(workspaceId, requestId),
  };
  const items: [BrandGenerationPreparedItem, ...BrandGenerationPreparedItem[]] = [
    preparedItem(intake, 'voice_foundation', null),
  ];
  return {
    request,
    items,
    voiceReadiness: { state: 'missing', blockingReasons: ['Voice foundation must be finalized'] },
    selectionFingerprint: canonicalBrandGenerationFingerprint({
      selection: request.selection,
      initialTargets: items.map(item => item.target),
    }),
    effectiveInputFingerprint: canonicalBrandGenerationFingerprint(
      items.map(item => item.inputSnapshot.fingerprint),
    ),
    jobId: `job-${key}`,
    estimate: maxEstimate,
    dashboardUrl: `/ws/${workspaceId}/brand`,
  };
}

function durableStart(
  workspaceId: string,
  intake: BrandIntakeRevisionRef,
  target: 'mission' | 'vision' = 'mission',
  key = `start-${target}`,
): AcceptBrandGenerationStartCommandInput {
  const request: StartBrandGenerationRequest = {
    workspaceId,
    intakeRevisionId: intake.intakeRevisionId,
    expectedIntakeRevision: intake.revision,
    expectedIntakeFingerprint: intake.fingerprint,
    selection: { kind: 'atomic', target },
    expectedVoiceVersion: finalizedVoice.voiceVersion,
    expectedVoiceFingerprint: finalizedVoice.fingerprint,
    budget: maxBudget,
    idempotencyKey: key,
    createdBy: { actorType: 'operator', actorId: 'op-test' },
    mcpExecutionContext: null,
  };
  const items: [BrandGenerationPreparedItem, ...BrandGenerationPreparedItem[]] = [
    preparedItem(intake, target, { kind: 'create', deliverableId: null, expectedVersion: 0 }),
  ];
  return {
    request,
    items,
    voiceReadiness: { state: 'finalized', snapshot: finalizedVoice, blockingReasons: [] },
    selectionFingerprint: canonicalBrandGenerationFingerprint({
      selection: request.selection,
      initialTargets: items.map(item => item.target),
    }),
    effectiveInputFingerprint: canonicalBrandGenerationFingerprint(
      items.map(item => item.inputSnapshot.fingerprint),
    ),
    jobId: `job-${key}`,
    estimate: { providerCalls: 6, inputTokens: 10_000, outputTokens: 5_000, estimatedCostMicros: 500_000, maxConcurrency: 1 },
    dashboardUrl: `/ws/${workspaceId}/brand`,
  };
}

function audienceStart(
  workspaceId: string,
  intake: BrandIntakeRevisionRef,
): AcceptBrandGenerationStartCommandInput {
  const targets = ['personas', 'customer_journey', 'objection_handling', 'emotional_triggers'] as const;
  const request: StartBrandGenerationRequest = {
    workspaceId,
    intakeRevisionId: intake.intakeRevisionId,
    expectedIntakeRevision: intake.revision,
    expectedIntakeFingerprint: intake.fingerprint,
    selection: { kind: 'preset', preset: 'audience' },
    expectedVoiceVersion: finalizedVoice.voiceVersion,
    expectedVoiceFingerprint: finalizedVoice.fingerprint,
    budget: maxBudget,
    idempotencyKey: 'start-audience',
    createdBy: { actorType: 'operator', actorId: 'op-test' },
    mcpExecutionContext: null,
  };
  const items = targets.map((target, index) => preparedItem(
    intake,
    target,
    { kind: 'create', deliverableId: null, expectedVersion: 0 },
    FINGERPRINTS[8 + index]!,
  )) as [BrandGenerationPreparedItem, ...BrandGenerationPreparedItem[]];
  return {
    request,
    items,
    voiceReadiness: { state: 'finalized', snapshot: finalizedVoice, blockingReasons: [] },
    selectionFingerprint: canonicalBrandGenerationFingerprint({
      selection: request.selection,
      initialTargets: items.map(item => item.target),
    }),
    effectiveInputFingerprint: canonicalBrandGenerationFingerprint(
      items.map(item => item.inputSnapshot.fingerprint),
    ),
    jobId: 'job-audience',
    estimate: { providerCalls: 24, inputTokens: 100_000, outputTokens: 30_000, estimatedCostMicros: 2_000_000, maxConcurrency: 3 },
    dashboardUrl: `/ws/${workspaceId}/brand`,
  };
}

function candidateOutput(content = 'A grounded mission.'): BrandGenerationAttemptOutput {
  return {
    kind: 'deliverable_candidate',
    content,
    foundationDraft: null,
    claims: [{ text: content, classification: 'creative_proposal', evidenceKeys: [], sourceRefs: [] }],
    requirements: [],
    placeholders: [],
  };
}

function auditOutput(verdict: 'ready_for_human_review' | 'needs_attention'): BrandGenerationAttemptOutput {
  return {
    kind: 'audit',
    auditReport: {
      verdict,
      deterministicChecks: [],
      unresolvedRequirementIds: [],
      modelFindings: [],
      humanRequiredChecks: [],
      revisionCount: 0,
      auditedAt: '2026-07-14T02:00:00.000Z',
    },
  };
}

function rehashSnapshot(
  snapshot: BrandGenerationTargetInputSnapshot,
): BrandGenerationTargetInputSnapshot {
  const { fingerprint: _fingerprint, ...core } = snapshot;
  return { ...core, fingerprint: canonicalBrandGenerationFingerprint(core) };
}

const provenance = {
  runId: 'ai-run-1',
  operation: 'brand-deliverable-generate',
  provider: 'anthropic' as const,
  model: 'claude-opus-4-6',
  inputFingerprint: FINGERPRINTS[3]!,
  startedAt: '2026-07-14T01:00:00.000Z',
  completedAt: '2026-07-14T01:01:00.000Z',
};

const zeroReservation = {
  providerCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostMicros: 0,
};

function stageDurableCandidate(
  workspaceId: string,
  intake: BrandIntakeRevisionRef,
  verdict: 'ready_for_human_review' | 'needs_attention',
  key: string,
  generatedCandidate: BrandGenerationAttemptOutput = candidateOutput(),
) {
  const accepted = acceptBrandGenerationStartCommand(durableStart(workspaceId, intake, 'mission', key));
  const running = transitionBrandGenerationRun({
    workspaceId,
    runId: accepted.run.id,
    expectedRevision: 0,
    nextStatus: 'running',
    nextStage: 'dependent_generation',
  });
  let item = transitionBrandGenerationItem({
    workspaceId,
    runId: accepted.run.id,
    itemId: accepted.items[0]!.id,
    expectedRevision: 0,
    nextStatus: 'preflighting',
  });
  item = transitionBrandGenerationItem({
    workspaceId,
    runId: accepted.run.id,
    itemId: item.id,
    expectedRevision: item.revision,
    nextStatus: 'generating',
  });
  const candidate = beginBrandGenerationAttempt({
    workspaceId,
    runId: accepted.run.id,
    itemId: item.id,
    commandId: accepted.command.id,
    jobId: accepted.command.jobId,
    stage: 'dependent_generation',
    expectedRunRevision: running.revision,
    expectedItemRevision: item.revision,
    expectedDeliverableVersion: 0,
    sourceInputFingerprint: item.inputSnapshot!.fingerprint,
    effectiveInputFingerprint: FINGERPRINTS[16]!,
    reservation: zeroReservation,
  });
  completeBrandGenerationAttempt({
    workspaceId,
    runId: accepted.run.id,
    itemId: item.id,
    attemptId: candidate.id,
    output: generatedCandidate,
    provenance: { ...provenance, inputFingerprint: FINGERPRINTS[16]! },
  });
  item = transitionBrandGenerationItem({
    workspaceId,
    runId: accepted.run.id,
    itemId: item.id,
    expectedRevision: item.revision,
    nextStatus: 'auditing_deterministic',
  });
  const audit = beginBrandGenerationAttempt({
    workspaceId,
    runId: accepted.run.id,
    itemId: item.id,
    commandId: accepted.command.id,
    jobId: accepted.command.jobId,
    stage: 'deterministic_audit',
    expectedRunRevision: running.revision,
    expectedItemRevision: item.revision,
    expectedDeliverableVersion: 0,
    sourceInputFingerprint: item.inputSnapshot!.fingerprint,
    effectiveInputFingerprint: FINGERPRINTS[17]!,
    reservation: zeroReservation,
  });
  completeBrandGenerationAttempt({
    workspaceId,
    runId: accepted.run.id,
    itemId: item.id,
    attemptId: audit.id,
    output: auditOutput(verdict),
    provenance: null,
  });
  return { accepted, running, item, candidate, audit };
}

describe('brand generation repository', () => {
  it('rejects internally inconsistent paid-work preflight checkpoints', () => {
    const output = {
      kind: 'preflight' as const,
      readyForPaidWork: true,
      blockingRequirementIds: ['required-proof'],
      requirements: [{
        id: 'required-proof',
        fieldPath: 'claims.proof',
        claim: 'A required fact',
        reason: 'Paid work needs this evidence',
        requirementStage: 'preflight' as const,
        claimKind: 'factual' as const,
        status: 'missing' as const,
        sourceRefs: [],
      }],
      placeholders: [],
      estimate: maxEstimate,
    };
    expect(brandGenerationPreflightAttemptOutputSchema.safeParse(output).success).toBe(false);
    expect(brandGenerationPreflightAttemptOutputSchema.safeParse({
      ...output,
      readyForPaidWork: false,
    }).success).toBe(true);
  });

  it('persists immutable start command lineage and redacts MCP/idempotency data publicly', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository replay');
    const input = foundationStart(workspaceId, intake);
    const accepted = acceptBrandGenerationStartCommand(input);

    expect(accepted.existing).toBe(false);
    expect(accepted.run).toMatchObject({
      workspaceId,
      selection: { kind: 'preset', preset: 'full_brand_system' },
      selectedTargets: ['voice_foundation'],
      counts: { selected: 1, queued: 1 },
      currentJobId: input.jobId,
      budget: {
        estimate: { maxConcurrency: 3 },
        limits: { maxConcurrency: 3 },
      },
    });
    expect(accepted.command).toMatchObject({
      runId: accepted.run.id,
      kind: 'start',
      jobId: input.jobId,
      result: { runId: accepted.run.id, selectionCount: 1 },
    });
    expect(getBrandGenerationEffectEvent(
      brandGenerationAcceptedEffectKey(accepted.command.id),
    )).toMatchObject({
      workspaceId,
      runId: accepted.run.id,
      commandId: accepted.command.id,
      kind: 'command_accepted',
      itemId: null,
      attemptCount: 0,
      appliedAt: null,
    });
    expect(accepted.items[0]?.inputSnapshot).toEqual(input.items[0].inputSnapshot);

    const publicRun = getBrandGenerationRun(workspaceId, accepted.run.id);
    expect(publicRun?.createdBy).toEqual({ actorType: 'mcp' });
    expect(publicRun).not.toHaveProperty('idempotencyKey');
    expect(publicRun).not.toHaveProperty('mcpExecutionContext');
    expect(JSON.stringify(publicRun)).not.toContain('key-1');

    const replayRequest = {
      ...input.request,
      ...mcpAttribution(workspaceId, 'a-new-server-request-id'),
    } as StartBrandGenerationRequest;
    const replay = lookupBrandGenerationStartReplay(replayRequest);
    expect(replay).toMatchObject({ existing: true, result: accepted.result });
    expect(replay?.command.id).toBe(accepted.command.id);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM brand_generation_effect_events
      WHERE effect_key = ?
    `).get(brandGenerationAcceptedEffectKey(accepted.command.id))).toEqual({ count: 1 });

    const changedBusinessRequest: StartBrandGenerationRequest = {
      ...replayRequest,
      selection: { kind: 'atomic', target: 'voice_foundation' },
    };
    expect(() => lookupBrandGenerationStartReplay(changedBusinessRequest))
      .toThrow(BrandGenerationIdempotencyConflictError);
  });

  it('rejects forged acceptance fingerprints and fingerprint drift on hydrated runs', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository fingerprint integrity');

    const forgedSelection = foundationStart(workspaceId, intake, 'forged-selection');
    forgedSelection.selectionFingerprint = FINGERPRINTS[19]!;
    expect(() => acceptBrandGenerationStartCommand(forgedSelection))
      .toThrow(/fingerprints do not match the ordered prepared inputs/i);

    const forgedSnapshot = foundationStart(workspaceId, intake, 'forged-snapshot');
    forgedSnapshot.items[0] = {
      ...forgedSnapshot.items[0],
      inputSnapshot: {
        ...forgedSnapshot.items[0].inputSnapshot,
        capturedAt: '2026-07-14T01:00:01.000Z',
      },
    };
    expect(() => acceptBrandGenerationStartCommand(forgedSnapshot))
      .toThrow(/prepared item snapshot is invalid/i);

    const accepted = acceptBrandGenerationStartCommand(
      foundationStart(workspaceId, intake, 'stored-fingerprint-drift'),
    );
    db.prepare(`
      UPDATE brand_generation_runs
      SET selection_fingerprint = ?
      WHERE id = ? AND workspace_id = ?
    `).run(FINGERPRINTS[19], accepted.run.id, workspaceId);
    expect(() => getPersistedBrandGenerationRun(workspaceId, accepted.run.id))
      .toThrow(/fingerprints do not match their immutable inputs/i);
  });

  it('preserves an immutable estimate concurrency below the run limit across reads and replay', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository concurrency estimate');
    const input = durableStart(workspaceId, intake, 'mission', 'start-concurrency-estimate');
    expect(input.estimate.maxConcurrency).toBe(1);
    expect(input.request.budget.maxConcurrency).toBe(3);

    const accepted = acceptBrandGenerationStartCommand(input);
    expect(accepted.run.budget).toMatchObject({
      estimate: { maxConcurrency: 1 },
      limits: { maxConcurrency: 3 },
    });

    const persisted = getPersistedBrandGenerationRun(workspaceId, accepted.run.id);
    expect(persisted?.budget).toMatchObject({
      estimate: { maxConcurrency: 1 },
      limits: { maxConcurrency: 3 },
    });

    const replay = lookupBrandGenerationStartReplay(input.request);
    expect(replay?.run.budget).toMatchObject({
      estimate: { maxConcurrency: 1 },
      limits: { maxConcurrency: 3 },
    });
  });

  it('scopes every read to workspace and fails closed on corrupt stored JSON', () => {
    const first = seedWorkspace('brand repository scope first');
    const second = seedWorkspace('brand repository scope second');
    const accepted = acceptBrandGenerationStartCommand(foundationStart(first.workspaceId, first.intake));

    expect(getPersistedBrandGenerationRun(second.workspaceId, accepted.run.id)).toBeNull();
    expect(getBrandGenerationItem(second.workspaceId, accepted.run.id, accepted.items[0]!.id)).toBeNull();

    db.pragma('ignore_check_constraints = ON');
    try {
      db.prepare(`UPDATE brand_generation_items SET claims_json = '[{"bad":true}]' WHERE id = ?`)
        .run(accepted.items[0]!.id);
    } finally {
      db.pragma('ignore_check_constraints = OFF');
    }
    expect(() => getBrandGenerationItem(first.workspaceId, accepted.run.id, accepted.items[0]!.id))
      .toThrow(BrandGenerationPersistenceContractError);
  });

  it('rechecks that intake is current and refuses approved deliverables inside start transaction', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository current authority');
    db.prepare(`
      INSERT INTO brand_intake_revisions (
        id, workspace_id, revision, schema_version, payload_json,
        evidence_resolutions_json, projection_state_json, fingerprint, source,
        submitter_json, mutation_kind, mutation_fingerprint, idempotency_key,
        supersedes_revision_id, created_at
      ) VALUES (?, ?, 2, 1, '{}', '[]',
        '{"preservedCompetitorDomains":[],"intakeOwnedCompetitorDomains":[]}',
        ?, 'admin', '{"actorType":"operator","actorId":"op-test"}',
        'submission', ?, NULL, ?, ?)
    `).run(`bir_successor_${Math.random()}`, workspaceId, FINGERPRINTS[14], FINGERPRINTS[15], intake.intakeRevisionId, new Date().toISOString());
    expect(() => acceptBrandGenerationStartCommand(foundationStart(workspaceId, intake)))
      .toThrow(BrandGenerationRevisionConflictError);

    const current = { intakeRevisionId: db.prepare(`
      SELECT id FROM brand_intake_revisions WHERE workspace_id = ? AND revision = 2
    `).get(workspaceId) as { id: string }, revision: 2, fingerprint: FINGERPRINTS[14]! };
    const currentRef: BrandIntakeRevisionRef = {
      intakeRevisionId: current.intakeRevisionId.id,
      revision: current.revision,
      fingerprint: current.fingerprint,
    };
    db.prepare(`
      INSERT INTO brand_identity_deliverables (
        id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at
      ) VALUES ('approved-mission', ?, 'mission', 'Human mission', 'approved', 1, 'essentials', ?, ?)
    `).run(workspaceId, new Date().toISOString(), new Date().toISOString());
    expect(() => acceptBrandGenerationStartCommand(durableStart(workspaceId, currentRef)))
      .toThrow(BrandGenerationApprovedDeliverableError);
  });

  it('derives counts from item rows and lets siblings progress without bumping shared run revision', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository sibling progress');
    const accepted = acceptBrandGenerationStartCommand(audienceStart(workspaceId, intake));
    const running = transitionBrandGenerationRun({
      workspaceId,
      runId: accepted.run.id,
      expectedRevision: 0,
      nextStatus: 'running',
      nextStage: 'dependent_generation',
    });
    const [first, second] = accepted.items;
    transitionBrandGenerationItem({
      workspaceId, runId: accepted.run.id, itemId: first!.id,
      expectedRevision: 0, nextStatus: 'preflighting',
    });
    transitionBrandGenerationItem({
      workspaceId, runId: accepted.run.id, itemId: second!.id,
      expectedRevision: 0, nextStatus: 'preflighting',
    });
    const after = getPersistedBrandGenerationRun(workspaceId, accepted.run.id);
    expect(after?.revision).toBe(running.revision);
    expect(after?.counts).toMatchObject({ selected: 4, queued: 2, running: 2 });
  });

  it('enforces concurrency, reserves every provider dispatch, and allocates retry numbers transactionally', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository attempt budget');
    const accepted = acceptBrandGenerationStartCommand(audienceStart(workspaceId, intake));
    const running = transitionBrandGenerationRun({
      workspaceId,
      runId: accepted.run.id,
      expectedRevision: 0,
      nextStatus: 'running',
      nextStage: 'dependent_generation',
    });
    expect(() => beginBrandGenerationAttempt({
      workspaceId,
      runId: accepted.run.id,
      itemId: accepted.items[0]!.id,
      commandId: accepted.command.id,
      jobId: accepted.command.jobId,
      stage: 'dependent_generation',
      expectedRunRevision: running.revision,
      expectedItemRevision: 0,
      expectedDeliverableVersion: 0,
      sourceInputFingerprint: accepted.items[0]!.inputSnapshot!.fingerprint,
      effectiveInputFingerprint: accepted.items[0]!.effectiveInputFingerprint!,
      reservation: zeroReservation,
    })).toThrow(BrandGenerationPersistenceContractError);
    const items = accepted.items.map(item => transitionBrandGenerationItem({
      workspaceId,
      runId: accepted.run.id,
      itemId: item.id,
      expectedRevision: 0,
      nextStatus: 'preflighting',
    }));
    const begin = (item: (typeof items)[number]) => beginBrandGenerationAttempt({
      workspaceId,
      runId: accepted.run.id,
      itemId: item.id,
      commandId: accepted.command.id,
      jobId: accepted.command.jobId,
      stage: 'preflight',
      expectedRunRevision: running.revision,
      expectedItemRevision: item.revision,
      expectedDeliverableVersion: 0,
      sourceInputFingerprint: item.inputSnapshot!.fingerprint,
      effectiveInputFingerprint: item.effectiveInputFingerprint!,
      reservation: zeroReservation,
    });
    const attempts = items.slice(0, 3).map(begin);
    expect(attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ commandId: accepted.command.id, jobId: accepted.command.jobId, attemptNumber: 1 }),
    ]));
    expect(() => begin(items[3]!)).toThrow(BrandGenerationConcurrencyLimitError);
    expect(() => beginBrandGenerationAttempt({
      workspaceId,
      runId: accepted.run.id,
      itemId: items[0]!.id,
      commandId: accepted.command.id,
      jobId: accepted.command.jobId,
      stage: 'preflight',
      expectedRunRevision: running.revision,
      expectedItemRevision: items[0]!.revision,
      expectedDeliverableVersion: 0,
      sourceInputFingerprint: items[0]!.inputSnapshot!.fingerprint,
      effectiveInputFingerprint: items[0]!.effectiveInputFingerprint!,
      reservation: { ...zeroReservation, providerCalls: 1 },
    })).toThrow(BrandGenerationAttemptCheckpointConflictError);

    const reserved = reserveBrandGenerationAttemptBudget({
      workspaceId,
      runId: accepted.run.id,
      itemId: items[0]!.id,
      attemptId: attempts[0]!.id,
      expectedRunRevision: running.revision,
      expectedItemRevision: items[0]!.revision,
      effectiveInputFingerprint: FINGERPRINTS[19]!,
      reservation: { ...zeroReservation, providerCalls: 114 },
    });
    expect(reserved.budgetUsage.providerCalls).toBe(114);
    expect(reserved.effectiveInputFingerprint).toBe(FINGERPRINTS[19]);
    expect(() => reserveBrandGenerationAttemptBudget({
      workspaceId,
      runId: accepted.run.id,
      itemId: items[0]!.id,
      attemptId: attempts[0]!.id,
      expectedRunRevision: running.revision,
      expectedItemRevision: items[0]!.revision,
      effectiveInputFingerprint: FINGERPRINTS[18]!,
      reservation: { ...zeroReservation, providerCalls: 1 },
    })).toThrow(BrandGenerationBudgetExceededError);
    expect(getBrandGenerationAttempt(
      workspaceId,
      accepted.run.id,
      items[0]!.id,
      attempts[0]!.id,
    )).toMatchObject({
      effectiveInputFingerprint: FINGERPRINTS[19],
      budgetUsage: { providerCalls: 114 },
    });

    failBrandGenerationAttempt({
      workspaceId,
      runId: accepted.run.id,
      itemId: items[0]!.id,
      attemptId: attempts[0]!.id,
      error: { code: 'provider_timeout', message: 'Provider timed out', retryable: true, stage: 'preflight' },
    });
    const retry = begin(items[0]!);
    expect(retry.attemptNumber).toBe(2);
    for (const [attempt, item] of [[attempts[1]!, items[1]!], [attempts[2]!, items[2]!], [retry, items[0]!]] as const) {
      cancelBrandGenerationAttempt({
        workspaceId,
        runId: accepted.run.id,
        itemId: item.id,
        attemptId: attempt.id,
      });
    }
  });

  it('signs item cursors and rejects tampering or a stale item revision snapshot', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository cursor');
    const accepted = acceptBrandGenerationStartCommand(audienceStart(workspaceId, intake));
    const firstPage = listBrandGenerationItemsPage(workspaceId, accepted.run.id, { limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();
    const cursor = firstPage.nextCursor!;
    const tampered = `${cursor.slice(0, -2)}xx`;
    expect(() => listBrandGenerationItemsPage(workspaceId, accepted.run.id, { cursor: tampered, limit: 2 }))
      .toThrow(BrandGenerationCursorError);

    transitionBrandGenerationItem({
      workspaceId,
      runId: accepted.run.id,
      itemId: accepted.items[0]!.id,
      expectedRevision: 0,
      nextStatus: 'preflighting',
    });
    expect(() => listBrandGenerationItemsPage(workspaceId, accepted.run.id, { cursor, limit: 2 }))
      .toThrow(BrandGenerationCursorError);
  });

  it('commits only audited review-ready output and withholds attention output from legacy deliverables', () => {
    const readyWorkspace = seedWorkspace('brand repository ready commit');
    const ready = stageDurableCandidate(
      readyWorkspace.workspaceId,
      readyWorkspace.intake,
      'ready_for_human_review',
      'ready-commit',
    );
    const committed = commitBrandGenerationDeliverableCandidate({
      workspaceId: readyWorkspace.workspaceId,
      runId: ready.accepted.run.id,
      itemId: ready.item.id,
      candidateAttemptId: ready.candidate.id,
      finalAuditAttemptId: ready.audit.id,
      expectedRunRevision: ready.running.revision,
      expectedItemRevision: ready.item.revision,
      nextStatus: 'ready_for_human_review',
    });
    expect(committed).toMatchObject({
      kind: 'committed',
      deliverable: { content: 'A grounded mission.', status: 'draft', version: 1 },
      item: { status: 'ready_for_human_review', committedDeliverableVersion: 1 },
    });
    if (committed.kind !== 'committed') throw new Error('Expected committed effect fixture');
    expect(getBrandGenerationEffectEvent(brandGenerationArtifactEffectKey(
      ready.accepted.command.id,
      ready.item.id,
      committed.deliverable.version,
    ))).toMatchObject({
      kind: 'artifact_committed',
      itemId: ready.item.id,
      payload: {
        deliverableId: committed.deliverable.id,
        deliverableVersion: committed.deliverable.version,
      },
    });

    const attentionWorkspace = seedWorkspace('brand repository withheld commit');
    const attention = stageDurableCandidate(
      attentionWorkspace.workspaceId,
      attentionWorkspace.intake,
      'needs_attention',
      'attention-commit',
    );
    const withheld = commitBrandGenerationDeliverableCandidate({
      workspaceId: attentionWorkspace.workspaceId,
      runId: attention.accepted.run.id,
      itemId: attention.item.id,
      candidateAttemptId: attention.candidate.id,
      finalAuditAttemptId: attention.audit.id,
      expectedRunRevision: attention.running.revision,
      expectedItemRevision: attention.item.revision,
      nextStatus: 'needs_attention',
    });
    expect(withheld).toMatchObject({ kind: 'withheld', item: { status: 'needs_attention' } });
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM brand_generation_effect_events
      WHERE workspace_id = ? AND effect_kind = 'artifact_committed'
    `).get(attentionWorkspace.workspaceId)).toEqual({ count: 0 });
    expect(db.prepare(`
      SELECT COUNT(*) AS count FROM brand_identity_deliverables
      WHERE workspace_id = ? AND deliverable_type = 'mission'
    `).get(attentionWorkspace.workspaceId)).toEqual({ count: 0 });
  });

  it('refuses review-ready commit when the candidate still has unresolved ready evidence', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository unresolved ready evidence');
    const candidate = {
      ...candidateOutput(),
      requirements: [{
        id: 'missing-ready-proof',
        fieldPath: 'mission.proof',
        claim: 'A client-specific proof point',
        reason: 'The client must supply this fact',
        requirementStage: 'ready' as const,
        claimKind: 'factual' as const,
        status: 'missing' as const,
        sourceRefs: [],
        clientSafePrompt: 'Please provide the proof point.',
      }],
      placeholders: [{
        requirementId: 'missing-ready-proof',
        token: '[NEEDS CLIENT INPUT: proof point]' as const,
        prompt: 'Please provide the proof point.',
      }],
    };
    const staged = stageDurableCandidate(
      workspaceId,
      intake,
      'ready_for_human_review',
      'unresolved-ready',
      candidate,
    );
    expect(() => commitBrandGenerationDeliverableCandidate({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: staged.item.id,
      candidateAttemptId: staged.candidate.id,
      finalAuditAttemptId: staged.audit.id,
      expectedRunRevision: staged.running.revision,
      expectedItemRevision: staged.item.revision,
      nextStatus: 'ready_for_human_review',
    })).toThrow(BrandGenerationPersistenceContractError);
  });

  it('binds the final audit to its exact lifecycle-successor candidate and provenance fingerprint', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository exact audit lineage');
    const staged = stageDurableCandidate(workspaceId, intake, 'ready_for_human_review', 'audit-lineage');
    let item = transitionBrandGenerationItem({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: staged.item.id,
      expectedRevision: staged.item.revision,
      nextStatus: 'revising',
    });
    const revisedCandidate = beginBrandGenerationAttempt({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: item.id,
      commandId: staged.accepted.command.id,
      jobId: staged.accepted.command.jobId,
      stage: 'revision',
      expectedRunRevision: staged.running.revision,
      expectedItemRevision: item.revision,
      expectedDeliverableVersion: 0,
      sourceInputFingerprint: item.inputSnapshot!.fingerprint,
      effectiveInputFingerprint: FINGERPRINTS[18]!,
      reservation: zeroReservation,
    });
    expect(() => completeBrandGenerationAttempt({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: item.id,
      attemptId: revisedCandidate.id,
      output: candidateOutput('A revised grounded mission.'),
      provenance: { ...provenance, inputFingerprint: FINGERPRINTS[17]! },
    })).toThrow(BrandGenerationPersistenceContractError);
    completeBrandGenerationAttempt({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: item.id,
      attemptId: revisedCandidate.id,
      output: candidateOutput('A revised grounded mission.'),
      provenance: { ...provenance, inputFingerprint: FINGERPRINTS[18]! },
    });
    item = transitionBrandGenerationItem({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: item.id,
      expectedRevision: item.revision,
      nextStatus: 'auditing_deterministic',
    });
    const revisedAudit = beginBrandGenerationAttempt({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: item.id,
      commandId: staged.accepted.command.id,
      jobId: staged.accepted.command.jobId,
      stage: 'deterministic_audit',
      expectedRunRevision: staged.running.revision,
      expectedItemRevision: item.revision,
      expectedDeliverableVersion: 0,
      sourceInputFingerprint: item.inputSnapshot!.fingerprint,
      effectiveInputFingerprint: FINGERPRINTS[19]!,
      reservation: zeroReservation,
    });
    completeBrandGenerationAttempt({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: item.id,
      attemptId: revisedAudit.id,
      output: auditOutput('ready_for_human_review'),
      provenance: null,
    });
    expect(() => commitBrandGenerationDeliverableCandidate({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: item.id,
      candidateAttemptId: staged.candidate.id,
      finalAuditAttemptId: revisedAudit.id,
      expectedRunRevision: staged.running.revision,
      expectedItemRevision: item.revision,
      nextStatus: 'ready_for_human_review',
    })).toThrow(BrandGenerationPersistenceContractError);
    expect(commitBrandGenerationDeliverableCandidate({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: item.id,
      candidateAttemptId: revisedCandidate.id,
      finalAuditAttemptId: revisedAudit.id,
      expectedRunRevision: staged.running.revision,
      expectedItemRevision: item.revision,
      nextStatus: 'ready_for_human_review',
    })).toMatchObject({
      kind: 'committed',
      deliverable: { content: 'A revised grounded mission.' },
    });
  });

  it('preserves a newer operator artifact and both paid checkpoints on CAS loss', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository cas conflict');
    const staged = stageDurableCandidate(workspaceId, intake, 'ready_for_human_review', 'cas-conflict');
    const now = new Date().toISOString();
    const manualId = `manual-mission-${Math.random()}`;
    db.prepare(`
      INSERT INTO brand_identity_deliverables (
        id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at
      ) VALUES (?, ?, 'mission', 'Operator-authored mission', 'draft', 1, 'essentials', ?, ?)
    `).run(manualId, workspaceId, now, now);

    const result = commitBrandGenerationDeliverableCandidate({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: staged.item.id,
      candidateAttemptId: staged.candidate.id,
      finalAuditAttemptId: staged.audit.id,
      expectedRunRevision: staged.running.revision,
      expectedItemRevision: staged.item.revision,
      nextStatus: 'ready_for_human_review',
    });
    expect(result).toMatchObject({ kind: 'conflict', reason: 'deliverable_created', item: { status: 'conflict' } });
    expect(db.prepare(`SELECT content FROM brand_identity_deliverables WHERE id = ?`).get(manualId))
      .toEqual({ content: 'Operator-authored mission' });
    expect(getBrandGenerationAttempt(workspaceId, staged.accepted.run.id, staged.item.id, staged.candidate.id)?.output)
      .toEqual(candidateOutput());
    expect(getBrandGenerationAttempt(workspaceId, staged.accepted.run.id, staged.item.id, staged.audit.id)?.output)
      .toEqual(auditOutput('ready_for_human_review'));
  });

  it('keeps the original full-suite estimate cumulative while resume returns a command-local estimate', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository resume budget');
    const initial = acceptBrandGenerationStartCommand(foundationStart(workspaceId, intake, 'resume-budget-start'));
    const running = transitionBrandGenerationRun({
      workspaceId,
      runId: initial.run.id,
      expectedRevision: 0,
      nextStatus: 'running',
      nextStage: 'voice_foundation_generation',
    });
    const foundation = transitionBrandGenerationItem({
      workspaceId,
      runId: initial.run.id,
      itemId: initial.items[0]!.id,
      expectedRevision: initial.items[0]!.revision,
      nextStatus: 'preflighting',
    });
    const priorAttempt = beginBrandGenerationAttempt({
      workspaceId,
      runId: initial.run.id,
      itemId: foundation.id,
      commandId: initial.command.id,
      jobId: initial.command.jobId,
      stage: 'preflight',
      expectedRunRevision: running.revision,
      expectedItemRevision: foundation.revision,
      expectedDeliverableVersion: null,
      sourceInputFingerprint: foundation.inputSnapshot!.fingerprint,
      effectiveInputFingerprint: FINGERPRINTS[17]!,
      reservation: zeroReservation,
    });
    completeBrandGenerationAttempt({
      workspaceId,
      runId: initial.run.id,
      itemId: foundation.id,
      attemptId: priorAttempt.id,
      output: {
        kind: 'preflight',
        readyForPaidWork: true,
        blockingRequirementIds: [],
        requirements: [],
        placeholders: [],
        estimate: maxEstimate,
      },
      provenance: null,
    });
    const paused = transitionBrandGenerationRun({
      workspaceId,
      runId: initial.run.id,
      expectedRevision: running.revision,
      nextStatus: 'awaiting_review',
      nextStage: 'awaiting_voice_finalization',
      completionCommandId: initial.command.id,
    });
    const resumeEstimate = {
      providerCalls: 80,
      inputTokens: 2_000_000,
      outputTokens: 200_000,
      estimatedCostMicros: 80_000_000,
      maxConcurrency: 3,
    };
    const resumeInput: AcceptBrandGenerationResumeCommandInput = {
      request: {
        workspaceId,
        runId: initial.run.id,
        expectedRunRevision: paused.revision,
        expectedVoiceVersion: finalizedVoice.voiceVersion,
        expectedVoiceFingerprint: finalizedVoice.fingerprint,
        idempotencyKey: 'resume-budget-command',
        resumedBy: { actorType: 'operator', actorId: 'op-test' },
        mcpExecutionContext: null,
      },
      items: BRAND_GENERATION_PRESET_POLICY.full_brand_system.resumeTargets.map((target, index) => preparedItem(
        intake,
        target,
        { kind: 'create', deliverableId: null, expectedVersion: 0 },
        FINGERPRINTS[(index % (FINGERPRINTS.length - 1)) + 1]!,
      )) as [BrandGenerationPreparedItem, ...BrandGenerationPreparedItem[]],
      voiceReadiness: { state: 'finalized', snapshot: finalizedVoice, blockingReasons: [] },
      jobId: 'job-resume-budget',
      estimate: resumeEstimate,
      dashboardUrl: `/ws/${workspaceId}/brand`,
    };
    db.prepare(`
      UPDATE brand_generation_runs
      SET reserved_provider_calls = 40
      WHERE id = ? AND workspace_id = ?
    `).run(initial.run.id, workspaceId);
    expect(() => acceptBrandGenerationResumeCommand(resumeInput))
      .toThrow(BrandGenerationBudgetExceededError);
    db.prepare(`
      UPDATE brand_generation_runs
      SET reserved_provider_calls = 0
      WHERE id = ? AND workspace_id = ?
    `).run(initial.run.id, workspaceId);
    const resumed = acceptBrandGenerationResumeCommand(resumeInput);
    expect(resumed.result.estimate).toEqual(resumeEstimate);
    expect(resumed.command.result.estimate).toEqual(resumeEstimate);
    expect(resumed.run.budget.estimate).toEqual(maxEstimate);
    expect(resumed.run.counts.selected).toBe(19);
    expect(countBrandGenerationAttemptsForCommand(
      workspaceId,
      resumed.run.id,
      initial.command.id,
    )).toBe(1);
    expect(countBrandGenerationAttemptsForCommand(
      workspaceId,
      resumed.run.id,
      resumed.command.id,
    )).toBe(0);
    expect(isBrandGenerationJobRepairEligible(
      resumed.run,
      resumed.command,
      resumed.items,
    )).toBe(true);
  });

  it('accepts revision only against exact run, item, and deliverable versions with a replacement snapshot', () => {
    const { workspaceId, intake } = seedWorkspace('brand repository revision cas');
    const staged = stageDurableCandidate(workspaceId, intake, 'ready_for_human_review', 'revision-source');
    const committed = commitBrandGenerationDeliverableCandidate({
      workspaceId,
      runId: staged.accepted.run.id,
      itemId: staged.item.id,
      candidateAttemptId: staged.candidate.id,
      finalAuditAttemptId: staged.audit.id,
      expectedRunRevision: staged.running.revision,
      expectedItemRevision: staged.item.revision,
      nextStatus: 'ready_for_human_review',
    });
    expect(committed.kind).toBe('committed');
    if (committed.kind !== 'committed') throw new Error('Expected committed revision fixture');
    const editedDeliverableVersion = committed.deliverable.version + 1;
    db.prepare(`
      UPDATE brand_identity_deliverables
      SET content = ?, version = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `).run(
      'Operator-authored mission to refine',
      editedDeliverableVersion,
      new Date().toISOString(),
      committed.deliverable.id,
      workspaceId,
    );
    const completedRun = transitionBrandGenerationRun({
      workspaceId,
      runId: staged.accepted.run.id,
      expectedRevision: staged.running.revision,
      nextStatus: 'completed',
      nextStage: 'complete',
      completedAt: new Date().toISOString(),
      completionCommandId: staged.accepted.command.id,
    });
    expect(getBrandGenerationEffectEvent(
      brandGenerationCompletedEffectKey(staged.accepted.command.id),
    )).toMatchObject({
      kind: 'command_completed',
      payload: { status: 'completed', counts: completedRun.counts },
    });
    const replacementSnapshot: BrandGenerationTargetInputSnapshot = {
      ...committed.item.inputSnapshot!,
      artifactExpectation: {
        kind: 'update',
        deliverableId: committed.deliverable.id,
        expectedVersion: editedDeliverableVersion,
      },
      capturedAt: '2026-07-14T03:00:00.000Z',
      fingerprint: FINGERPRINTS[18]!,
    };
    const base: AcceptBrandGenerationRevisionCommandInput = {
      request: {
        workspaceId,
        runId: staged.accepted.run.id,
        itemId: committed.item.id,
        expectedRunRevision: completedRun.revision,
        expectedItemRevision: committed.item.revision,
        deliverableId: committed.deliverable.id,
        expectedDeliverableVersion: editedDeliverableVersion,
        direction: 'Make the mission more specific.',
        idempotencyKey: 'revision-success',
        requestedBy: { actorType: 'operator', actorId: 'op-test' },
        mcpExecutionContext: null,
      },
      inputSnapshot: replacementSnapshot,
      jobId: 'job-revision-success',
      estimate: {
        providerCalls: 3,
        inputTokens: 5_000,
        outputTokens: 2_500,
        estimatedCostMicros: 250_000,
        maxConcurrency: 1,
      },
      dashboardUrl: `/ws/${workspaceId}/brand`,
    };

    expect(() => acceptBrandGenerationRevisionCommand({
      ...base,
      request: { ...base.request, expectedRunRevision: completedRun.revision - 1, idempotencyKey: 'stale-run' },
    })).toThrow(BrandGenerationRevisionConflictError);
    expect(() => acceptBrandGenerationRevisionCommand({
      ...base,
      request: { ...base.request, expectedItemRevision: committed.item.revision - 1, idempotencyKey: 'stale-item' },
    })).toThrow(BrandGenerationRevisionConflictError);
    expect(() => acceptBrandGenerationRevisionCommand({
      ...base,
      request: {
        ...base.request,
        expectedDeliverableVersion: editedDeliverableVersion + 1,
        idempotencyKey: 'stale-deliverable',
      },
      inputSnapshot: {
        ...replacementSnapshot,
        artifactExpectation: {
          kind: 'update',
          deliverableId: committed.deliverable.id,
          expectedVersion: editedDeliverableVersion + 1,
        },
        fingerprint: FINGERPRINTS[19]!,
      },
    })).toThrow(BrandGenerationRevisionConflictError);

    db.prepare(`
      UPDATE brand_generation_runs
      SET reserved_provider_calls = 113
      WHERE id = ? AND workspace_id = ?
    `).run(staged.accepted.run.id, workspaceId);
    expect(() => acceptBrandGenerationRevisionCommand({
      ...base,
      request: { ...base.request, idempotencyKey: 'revision-budget-exhausted' },
    })).toThrow(BrandGenerationBudgetExceededError);
    db.prepare(`
      UPDATE brand_generation_runs
      SET reserved_provider_calls = 0
      WHERE id = ? AND workspace_id = ?
    `).run(staged.accepted.run.id, workspaceId);

    const accepted = acceptBrandGenerationRevisionCommand(base);
    expect(accepted).toMatchObject({
      existing: false,
      run: { status: 'running', stage: 'revision' },
      command: {
        kind: 'revision',
        priorItemStatus: 'ready_for_human_review',
        expectedDeliverableVersion: editedDeliverableVersion,
      },
    });
    expect(accepted.items.find(item => item.id === committed.item.id)).toMatchObject({
      status: 'revising',
      inputSnapshot: replacementSnapshot,
      artifactExpectation: replacementSnapshot.artifactExpectation,
      content: 'Operator-authored mission to refine',
      claims: [],
      placeholders: [],
      auditReport: null,
      provenance: null,
      committedDeliverableId: committed.deliverable.id,
      committedDeliverableVersion: editedDeliverableVersion,
    });
    expect(countBrandGenerationAttemptsForCommand(
      workspaceId,
      accepted.run.id,
      accepted.command.id,
    )).toBe(0);
    expect(isBrandGenerationJobRepairEligible(
      accepted.run,
      accepted.command,
      accepted.items,
    )).toBe(true);
  });

  it.each([
    ['needs_attention', 'completed_with_errors'],
    ['conflict', 'conflict'],
  ] as const)(
    'allows an explicitly linked %s revision item to be retried against current authority',
    (itemStatus, runStatus) => {
      const { workspaceId, intake } = seedWorkspace(`brand revision retry ${itemStatus}`);
      const staged = stageDurableCandidate(
        workspaceId,
        intake,
        'ready_for_human_review',
        `retry-source-${itemStatus}`,
      );
      const committed = commitBrandGenerationDeliverableCandidate({
        workspaceId,
        runId: staged.accepted.run.id,
        itemId: staged.item.id,
        candidateAttemptId: staged.candidate.id,
        finalAuditAttemptId: staged.audit.id,
        expectedRunRevision: staged.running.revision,
        expectedItemRevision: staged.item.revision,
        nextStatus: 'ready_for_human_review',
      });
      if (committed.kind !== 'committed') throw new Error('Expected committed retry fixture');
      const initialRun = transitionBrandGenerationRun({
        workspaceId,
        runId: staged.accepted.run.id,
        expectedRevision: staged.running.revision,
        nextStatus: 'completed',
        nextStage: 'complete',
        completedAt: new Date().toISOString(),
        completionCommandId: staged.accepted.command.id,
      });
      const firstSnapshot = rehashSnapshot({
        ...committed.item.inputSnapshot!,
        artifactExpectation: {
          kind: 'update',
          deliverableId: committed.deliverable.id,
          expectedVersion: committed.deliverable.version,
        },
        capturedAt: '2026-07-14T04:00:00.000Z',
      });
      const firstRevision = acceptBrandGenerationRevisionCommand({
        request: {
          workspaceId,
          runId: staged.accepted.run.id,
          itemId: committed.item.id,
          expectedRunRevision: initialRun.revision,
          expectedItemRevision: committed.item.revision,
          deliverableId: committed.deliverable.id,
          expectedDeliverableVersion: committed.deliverable.version,
          direction: 'Resolve the review finding without inventing facts.',
          idempotencyKey: `first-revision-${itemStatus}`,
          requestedBy: { actorType: 'operator', actorId: 'op-test' },
          mcpExecutionContext: null,
        },
        inputSnapshot: firstSnapshot,
        jobId: `job-first-revision-${itemStatus}`,
        estimate: {
          providerCalls: 3,
          inputTokens: 5_000,
          outputTokens: 2_500,
          estimatedCostMicros: 250_000,
          maxConcurrency: 1,
        },
        dashboardUrl: `/ws/${workspaceId}/brand`,
      });
      const revisingItem = firstRevision.items.find(item => item.id === committed.item.id)!;
      let currentVersion = committed.deliverable.version;
      if (itemStatus === 'conflict') {
        currentVersion += 1;
        db.prepare(`
          UPDATE brand_identity_deliverables
          SET content = ?, version = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `).run(
          'A later operator edit that must win',
          currentVersion,
          new Date().toISOString(),
          committed.deliverable.id,
          workspaceId,
        );
      }
      const retryableItem = transitionBrandGenerationItem({
        workspaceId,
        runId: staged.accepted.run.id,
        itemId: revisingItem.id,
        expectedRevision: revisingItem.revision,
        nextStatus: itemStatus,
        patch: {
          completedAt: new Date().toISOString(),
          ...(itemStatus === 'conflict' ? {
            error: {
              code: 'deliverable_changed',
              message: 'A newer operator edit was preserved.',
              retryable: true,
              stage: 'artifact_commit',
            },
          } : {}),
        },
      });
      const endedRun = transitionBrandGenerationRun({
        workspaceId,
        runId: staged.accepted.run.id,
        expectedRevision: firstRevision.run.revision,
        nextStatus: runStatus,
        nextStage: 'awaiting_operator_review',
        completedAt: new Date().toISOString(),
        completionCommandId: firstRevision.command.id,
      });
      const retrySnapshot = rehashSnapshot({
        ...firstSnapshot,
        artifactExpectation: {
          kind: 'update',
          deliverableId: committed.deliverable.id,
          expectedVersion: currentVersion,
        },
        capturedAt: '2026-07-14T05:00:00.000Z',
      });
      const retry = acceptBrandGenerationRevisionCommand({
        request: {
          workspaceId,
          runId: staged.accepted.run.id,
          itemId: retryableItem.id,
          expectedRunRevision: endedRun.revision,
          expectedItemRevision: retryableItem.revision,
          deliverableId: committed.deliverable.id,
          expectedDeliverableVersion: currentVersion,
          direction: 'Retry against the latest operator-owned version.',
          idempotencyKey: `retry-revision-${itemStatus}`,
          requestedBy: { actorType: 'operator', actorId: 'op-test' },
          mcpExecutionContext: null,
        },
        inputSnapshot: retrySnapshot,
        jobId: `job-retry-revision-${itemStatus}`,
        estimate: {
          providerCalls: 3,
          inputTokens: 5_000,
          outputTokens: 2_500,
          estimatedCostMicros: 250_000,
          maxConcurrency: 1,
        },
        dashboardUrl: `/ws/${workspaceId}/brand`,
      });
      expect(retry.command).toMatchObject({
        kind: 'revision',
        priorItemStatus: itemStatus,
        expectedDeliverableVersion: currentVersion,
      });
      expect(retry.items.find(item => item.id === retryableItem.id)).toMatchObject({
        status: 'revising',
        committedDeliverableId: committed.deliverable.id,
        artifactExpectation: retrySnapshot.artifactExpectation,
      });
    },
  );
});
