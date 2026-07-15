import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrandDeliverable } from '../../shared/types/brand-engine.js';
import type { GetBrandGenerationResult } from '../../shared/types/brand-generation.js';
import type { ClientDeliverable } from '../../shared/types/client-deliverable.js';
import type {
  GetMatrixGenerationResult,
  MatrixGenerationInputSelection,
  MatrixGenerationPreviewTarget,
} from '../../shared/types/matrix-generation.js';
import db from '../../server/db/index.js';
import {
  createBrandContentOnboardingRun,
  transitionBrandContentOnboardingRun,
} from '../../server/domains/brand-content-onboarding/repository.js';
import {
  authorizeBrandContentGeneration,
  BrandContentOnboardingServiceError,
  getBrandContentOnboarding,
  resumeBrandContentOnboarding,
  startBrandContentOnboarding,
  type BrandContentOnboardingDependencies,
} from '../../server/domains/brand-content-onboarding/service.js';
import { BrandGenerationBudgetExceededError } from '../../server/domains/brand/generation/errors.js';
import { canonicalGenerationFingerprint } from '../../server/generation-provenance.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const cleanup: string[] = [];
const intakeFingerprint = 'a'.repeat(64);
const structuralFingerprint = 'b'.repeat(64);
const previewFingerprint = 'c'.repeat(64);
const voiceFingerprint = 'd'.repeat(64);

afterEach(() => {
  for (const workspaceId of cleanup.splice(0)) {
    deleteWorkspace(workspaceId);
    db.prepare('DELETE FROM brand_content_onboarding_runs WHERE workspace_id = ?').run(workspaceId);
    db.prepare('DELETE FROM brand_intake_revisions WHERE workspace_id = ?').run(workspaceId);
  }
});

function seedWorkspace(): { workspaceId: string; intakeRevisionId: string } {
  const workspaceId = createWorkspace(`onboarding service ${Date.now()} ${Math.random()}`).id;
  cleanup.push(workspaceId);
  const intakeRevisionId = `intake-${workspaceId}`;
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
  `).run(intakeRevisionId, workspaceId, intakeFingerprint, '1'.repeat(64), '2026-07-14T00:00:00.000Z');
  return { workspaceId, intakeRevisionId };
}

function missionDeliverable(workspaceId = 'filled-by-test'): BrandDeliverable {
  return {
    id: 'deliverable-mission', workspaceId, deliverableType: 'mission',
    content: 'Our mission.', status: 'approved', version: 1, tier: 'essentials',
    createdAt: '2026-07-14T00:01:00.000Z', updatedAt: '2026-07-14T00:02:00.000Z',
  };
}

function missionIdentityRef() {
  const deliverable = missionDeliverable();
  const ref = {
    deliverableId: deliverable.id,
    deliverableType: deliverable.deliverableType,
    version: deliverable.version,
    approvedAt: deliverable.updatedAt,
    contentFingerprint: canonicalGenerationFingerprint(deliverable.content),
  };
  return { ...ref, approvalFingerprint: canonicalGenerationFingerprint({ ...ref, status: 'approved' }) };
}

function brandResult(
  phase: 'running' | 'foundation_ready' | 'dependents_ready' | 'dependents_approved' | 'cancelled',
): GetBrandGenerationResult {
  const foundationReady = phase !== 'running';
  const dependentsReady = phase === 'dependents_ready' || phase === 'dependents_approved';
  const dependentsApproved = phase === 'dependents_approved';
  return {
    run: {
      id: 'brand-run-1',
      workspaceId: 'filled-by-test',
      intakeRevision: { intakeRevisionId: 'intake', revision: 1, fingerprint: intakeFingerprint },
      status: phase === 'cancelled'
        ? 'cancelled'
        : phase === 'running'
          ? 'running'
          : phase === 'foundation_ready'
            ? 'awaiting_review'
            : 'completed',
      stage: phase === 'dependents_ready'
        ? 'complete'
        : foundationReady ? 'awaiting_voice_finalization' : 'voice_foundation_generation',
      revision: dependentsReady ? 4 : foundationReady ? 2 : 1,
      selectionFingerprint: '2'.repeat(64),
      effectiveInputFingerprint: '3'.repeat(64),
      currentJobId: phase === 'running' ? 'brand-job-start' : null,
      voiceReadiness: { state: 'missing', blockingReasons: ['Finalize voice'] },
      counts: {
        selected: dependentsReady ? 2 : 1,
        queued: 0,
        running: phase === 'running' ? 1 : 0,
        readyForHumanReview: phase === 'dependents_ready' ? 2 : foundationReady ? 1 : 0,
        needsAttention: 0,
        blocked: 0,
        conflicts: 0,
        failed: 0,
        cancelled: phase === 'cancelled' ? 1 : 0,
        approved: dependentsApproved ? 1 : 0,
        changesRequested: 0,
      },
      budget: {
        estimate: { providerCalls: 2, inputTokens: 100, outputTokens: 50, estimatedCostMicros: 100, maxConcurrency: 1 },
        limits: { providerCalls: 20, inputTokens: 10_000, outputTokens: 5_000, maxEstimatedCostMicros: 10_000, maxConcurrency: 1 },
        reserved: { providerCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0 },
      },
      selectedTargets: phase === 'dependents_ready' ? ['mission'] : ['voice_foundation'],
      selection: { kind: 'preset', preset: 'full_brand_system' },
      createdBy: { actorType: 'mcp' },
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:01:00.000Z',
      completedAt: phase === 'dependents_ready' ? '2026-07-14T00:01:00.000Z' : null,
    },
    itemPage: {
      items: [
        {
          id: 'foundation-item',
          runId: 'brand-run-1',
          target: 'voice_foundation',
          status: foundationReady ? 'ready_for_human_review' : 'generating',
          revision: 1,
          inputSnapshot: null,
          content: null,
          foundationDraft: foundationReady ? {
            schemaVersion: 1,
            summary: 'Clear, warm, direct.',
            voiceDNA: { personalityTraits: ['Clear'], toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 }, sentenceStyle: 'Direct.', vocabularyLevel: 'Plain.' },
            guardrails: { forbiddenWords: [], requiredTerminology: [], toneBoundaries: ['Stay direct'], antiPatterns: [] },
            contextModifiers: [],
            evidenceRequirementIds: [],
            fingerprint: '4'.repeat(64),
          } : null,
          claims: [], requirements: [], placeholders: [], auditReport: null,
          attemptCount: 1, automaticRevisionCount: 0,
          effectiveInputFingerprint: null, provenance: null, error: null,
          committedDeliverableId: null, committedDeliverableVersion: null,
          createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:01:00.000Z',
          completedAt: foundationReady ? '2026-07-14T00:01:00.000Z' : null,
        },
        ...(dependentsReady ? [{
          id: 'mission-item', runId: 'brand-run-1', target: 'mission' as const,
          status: dependentsApproved ? 'approved' as const : 'ready_for_human_review' as const,
          inputSnapshot: null, content: 'Our mission.', foundationDraft: null,
          claims: [], requirements: [], placeholders: [], auditReport: null,
          attemptCount: 1, automaticRevisionCount: 0 as const,
          effectiveInputFingerprint: null, provenance: null, error: null,
          committedDeliverableId: 'deliverable-mission', committedDeliverableVersion: 1,
          createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:01:00.000Z',
          completedAt: '2026-07-14T00:01:00.000Z',
        }] : []),
      ],
      nextCursor: null,
      hasMore: false,
    },
  } as unknown as GetBrandGenerationResult;
}

function review(
  kind: 'voice_foundation' | 'brand_suite',
  status: 'awaiting_client' | 'approved' | 'changes_requested',
): ClientDeliverable {
  const approved = status === 'approved';
  const changesRequested = status === 'changes_requested';
  const decision = approved || changesRequested
    ? kind === 'voice_foundation'
      ? {
          runId: 'brand-run-1', itemId: 'foundation-item',
          expectedGenerationItemRevision: 1, resultingGenerationItemRevision: 1,
          decision: approved ? 'approve' : 'changes_requested',
          ...(changesRequested ? { note: 'Please revise the tone.' } : {}),
          decidedBy: { actorType: 'client', actorId: 'client-1' },
          decidedAt: '2026-07-14T00:02:00.000Z',
        }
      : {
          runId: 'brand-run-1', itemId: 'mission-item',
          expectedGenerationItemRevision: 2, resultingGenerationItemRevision: approved ? 3 : 2,
          deliverableId: 'deliverable-mission', deliverableType: 'mission',
          expectedDeliverableVersion: 1,
          decision: approved ? 'approve' : 'changes_requested',
          ...(changesRequested ? { note: 'Please revise the mission.' } : {}),
          decidedBy: { actorType: 'client', actorId: 'client-1' },
          decidedAt: '2026-07-14T00:02:00.000Z',
        }
    : null;
  return {
    id: kind === 'voice_foundation' ? 'voice-review-1' : 'suite-review-1',
    workspaceId: 'filled-by-test',
    externalRef: null,
    type: 'brand_generation',
    kind: 'review',
    status,
    title: 'Brand review',
    summary: null,
    payload: {
      schemaVersion: 1,
      family: 'brand_generation',
      reviewKind: kind,
      runId: 'brand-run-1',
      runRevision: kind === 'voice_foundation' ? 2 : 4,
    },
    note: null,
    clientResponseNote: null,
    parentDeliverableId: null,
    sentAt: '2026-07-14T00:01:00.000Z',
    decidedAt: decision ? '2026-07-14T00:02:00.000Z' : null,
    dueAt: null,
    appliedAt: null,
    generatedAt: null,
    source: 'brand-generation',
    sourceRef: `brand_generation:${kind}:brand-run-1`,
    createdAt: '2026-07-14T00:01:00.000Z',
    updatedAt: '2026-07-14T00:02:00.000Z',
    items: [{
      id: kind === 'voice_foundation' ? 'voice-review-item' : 'suite-review-item',
      deliverableId: kind === 'voice_foundation' ? 'voice-review-1' : 'suite-review-1',
      status: approved ? 'approved' : changesRequested ? 'changes_requested' : 'awaiting_client',
      targetRef: null, collectionId: null, field: kind === 'voice_foundation' ? 'voice_foundation' : 'mission',
      currentValue: null, proposedValue: 'Review copy', clientValue: null,
      clientNote: changesRequested ? 'Please revise.' : null,
      applyable: false,
      itemPayload: {
        schemaVersion: 1,
        family: 'brand_generation',
        reviewKind: kind,
        runId: 'brand-run-1',
        runRevision: kind === 'voice_foundation' ? 2 : 4,
        generationItemId: kind === 'voice_foundation' ? 'foundation-item' : 'mission-item',
        generationItemRevision: kind === 'voice_foundation' ? 1 : approved ? 3 : 2,
        target: kind === 'voice_foundation' ? 'voice_foundation' : 'mission',
        sourceDeliverableId: kind === 'voice_foundation' ? null : 'deliverable-mission',
        expectedDeliverableVersion: kind === 'voice_foundation' ? null : 1,
        decision,
      },
      sortOrder: 0,
      createdAt: '2026-07-14T00:01:00.000Z',
    }],
  } as ClientDeliverable;
}

function previewTarget(workspaceId: string): MatrixGenerationPreviewTarget {
  return {
    workspaceId,
    matrixId: 'matrix-1',
    templateId: 'template-1',
    cellId: 'cell-1',
    sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 3 },
    variableValues: { city: 'Chicago' }, slugSubstitutions: { city: 'chicago' },
    proseSubstitutions: { city: 'Chicago' },
    targetKeyword: { value: 'Chicago service', source: 'target', evidenceRefs: [] },
    plannedUrl: '/chicago-service', title: 'Chicago Service', metaDescription: 'Chicago service.',
    renderedHeadings: ['Chicago Service'], pageType: 'location', schemaTypes: [],
    blockManifest: {
      generationContractVersion: 1,
      blocks: [{ id: 'body', source: 'system', generationRole: 'body', order: 0, heading: { level: null, renderedText: null, locked: true }, guidance: 'Write grounded copy.', aeoContract: { modes: [], required: false }, ctaContract: { role: 'none', required: false } }],
      totalWordCountTarget: 300,
      fingerprint: '5'.repeat(64),
    },
    generationContractVersion: 1,
    structuralRequirements: [], structuralBlockingRequirementIds: [], structuralFingerprint,
    voiceSnapshot: {
      voiceProfileId: 'voice-1', voiceVersion: 1,
      finalizedBy: { actorType: 'operator', actorId: 'operator-1' },
      finalizedAt: '2026-07-14T00:03:00.000Z', fingerprint: voiceFingerprint,
      anchorEvidenceRefs: [{ sourceType: 'client_submission', sourceId: 'sample-1', capturedAt: '2026-07-13T00:00:00.000Z', selectedBy: { actorType: 'operator', actorId: 'operator-1' }, selectedAt: '2026-07-14T00:03:00.000Z' }],
    },
    identitySnapshot: [],
    evidenceRequirements: [], evidenceCapturedAt: '2026-07-14T00:03:00.000Z', evidenceFreshThrough: '2026-07-14T00:03:00.000Z',
    expectedArtifactRevisions: { brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 }, post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 } },
    effectiveInputFingerprint: previewFingerprint, blockingRequirementIds: [],
    estimatedPaidBudget: { providerCalls: 2, inputTokens: 100, outputTokens: 200, estimatedUsd: 0.05, maxConcurrency: 1 },
  };
}

function matrixResult(
  workspaceId: string,
  approved: boolean,
  status: 'running' | 'completed' | 'completed_with_errors' | 'cancelled' = 'completed',
  itemCount = 1,
  unapprovedIndex: number | null = null,
): GetMatrixGenerationResult {
  const targets = Array.from({ length: itemCount }, (_, index) => {
    const target = previewTarget(workspaceId);
    const number = index + 1;
    return {
      ...target,
      cellId: `cell-${number}`,
      sourceRevision: { ...target.sourceRevision, cellRevision: number + 2 },
      plannedUrl: `/chicago-service-${number}`,
    };
  });
  return {
    run: {
      id: 'matrix-run-1', workspaceId, matrixId: 'matrix-1', templateId: 'template-1',
      status, revision: 2, selectionFingerprint: '6'.repeat(64),
      selections: targets.map(target => ({
        matrixId: 'matrix-1', cellId: target.cellId, sourceRevision: target.sourceRevision,
        structuralFingerprint, previewFingerprint,
      })),
      jobId: status === 'running' ? 'matrix-job-1' : null,
      acceptedBudget: null,
      setAuditReport: null,
      counts: { selected: itemCount, queued: 0, running: status === 'running' ? itemCount : 0, readyForHumanReview: status === 'completed' ? itemCount : 0, needsAttention: 0, blocked: 0, conflicts: 0, failed: status === 'completed_with_errors' ? itemCount : 0, cancelled: status === 'cancelled' ? itemCount : 0 },
      createdBy: { actorType: 'operator', actorId: 'operator-1' },
      createdAt: '2026-07-14T00:04:00.000Z', updatedAt: '2026-07-14T00:05:00.000Z',
      completedAt: status === 'running' ? null : '2026-07-14T00:05:00.000Z',
    },
    items: {
      items: targets.map((target, index) => {
        const number = index + 1;
        const hasApproval = approved && unapprovedIndex !== index;
        return {
        id: `matrix-item-${number}`, runId: 'matrix-run-1', workspaceId,
        matrixId: 'matrix-1', cellId: target.cellId, sourceRevision: target.sourceRevision,
        status: status === 'completed' ? 'ready_for_human_review' : status === 'running' ? 'generating_post' : status === 'cancelled' ? 'cancelled' : 'failed',
        revision: hasApproval ? 4 : 3,
        structuralFingerprint, previewFingerprint,
        briefId: `brief-${number}`, postId: `post-${number}`, auditReport: null,
        approvalEvidence: hasApproval ? {
          runId: 'matrix-run-1', itemId: `matrix-item-${number}`, matrixId: 'matrix-1', cellId: target.cellId,
          sourceRevision: target.sourceRevision, postId: `post-${number}`, postRevision: 7,
          approvedBy: { actorType: 'client', actorId: 'client-1' },
          approvedAt: '2026-07-14T00:06:00.000Z',
        } : null,
        attemptCount: 1, automaticRevisionCount: 0, error: null,
        createdAt: '2026-07-14T00:04:00.000Z', updatedAt: '2026-07-14T00:06:00.000Z',
        completedAt: status === 'completed' ? '2026-07-14T00:05:00.000Z' : null,
        target: { targetKeyword: 'Chicago service', plannedUrl: target.plannedUrl, pageType: 'location' },
        setAuditFindings: [],
        currentArtifactRevisions: { brief: { artifactType: 'content_brief', artifactId: `brief-${number}`, generationRevision: 1 }, post: { artifactType: 'generated_post', artifactId: `post-${number}`, generationRevision: 7 } },
        reusableCheckpointFingerprint: null,
      }; }),
      nextCursor: null,
    },
  } as GetMatrixGenerationResult;
}

function harness(workspaceId: string, intakeRevisionId: string) {
  const state: {
    brandPhase: 'running' | 'foundation_ready' | 'dependents_ready' | 'dependents_approved' | 'cancelled';
    voiceReview: ClientDeliverable | null;
    suiteReview: ClientDeliverable | null;
    voiceFinalized: boolean;
    matrixApproved: boolean;
    matrixStatus: 'running' | 'completed' | 'completed_with_errors' | 'cancelled';
  } = {
    brandPhase: 'running',
    voiceReview: null,
    suiteReview: null,
    voiceFinalized: false,
    matrixApproved: false,
    matrixStatus: 'running',
  };
  const publishPreflight = vi.fn(() => 'publish-check-post-1');
  const deps: Partial<BrandContentOnboardingDependencies> = {
    isFeatureEnabled: () => true,
    getBrandIntakeRevision: () => ({
      revision: {
        id: intakeRevisionId, workspaceId, revision: 1, schemaVersion: 1,
        payload: {} as never, evidenceResolutions: [], fingerprint: intakeFingerprint,
        source: 'admin', submitter: { actorType: 'operator', actorId: 'operator-1' },
        mutationKind: 'submission', supersedesRevisionId: null, supersededByRevisionId: null,
        createdAt: '2026-07-14T00:00:00.000Z',
      },
      fieldEvidence: [],
    }),
    startBrandGeneration: () => ({
      runId: 'brand-run-1', runRevision: 0, jobId: 'brand-job-start', selectionCount: 1,
      estimate: { providerCalls: 2, inputTokens: 100, outputTokens: 50, estimatedCostMicros: 100, maxConcurrency: 1 },
      dashboardUrl: '/brand', existing: false,
    }),
    getBrandGeneration: () => {
      const result = brandResult(state.brandPhase);
      result.run.workspaceId = workspaceId;
      result.run.intakeRevision = { intakeRevisionId, revision: 1, fingerprint: intakeFingerprint };
      return result;
    },
    resumeBrandGeneration: () => ({
      runId: 'brand-run-1', runRevision: 3, jobId: 'brand-job-dependent', selectionCount: 1,
      estimate: { providerCalls: 2, inputTokens: 100, outputTokens: 50, estimatedCostMicros: 100, maxConcurrency: 1 },
      dashboardUrl: '/brand', existing: false,
    }),
    getBrandVoiceAuthoritySummary: () => state.voiceFinalized ? ({
      profile: { id: 'voice-1', revision: 1, status: 'calibrated' },
      readiness: {
        state: 'finalized',
        snapshot: { id: 'voice-finalization-1', voiceProfileId: 'voice-1', profileRevision: 1, voiceVersion: 1, fingerprint: voiceFingerprint, finalizedBy: { actorType: 'operator', actorId: 'operator-1' }, finalizedAt: '2026-07-14T00:03:00.000Z', anchorCount: 1, calibrationSelectionCount: 0 },
        blockingReasons: [],
      },
      latestSnapshot: null,
    }) : ({ profile: null, readiness: { state: 'missing', blockingReasons: ['Finalize voice'] }, latestSnapshot: null }),
    getFinalizedVoiceSnapshotForGeneration: () => ({
      ...previewTarget(workspaceId).voiceSnapshot,
      id: 'voice-finalization-1', workspaceId, profileRevision: 1,
      voiceDNA: { personalityTraits: ['Clear'], toneSpectrum: { formal_casual: 5, serious_playful: 5, technical_accessible: 5 }, sentenceStyle: 'Direct.', vocabularyLevel: 'Plain.' },
      guardrails: { forbiddenWords: [], requiredTerminology: [], toneBoundaries: ['Stay direct'], antiPatterns: [] },
      contextModifiers: [],
      anchors: [{ selector: { kind: 'voice_sample', voiceSampleId: 'sample-1' }, content: 'Sample', context: 'body', evidenceRef: previewTarget(workspaceId).voiceSnapshot.anchorEvidenceRefs[0] }],
      calibrationSelections: [], executionActor: { actorType: 'operator', actorId: 'operator-1' },
      createdAt: '2026-07-14T00:03:00.000Z',
    }),
    findBySourceRef: (_workspace, _type, sourceRef) => sourceRef.includes('voice_foundation')
      ? state.voiceReview
      : state.suiteReview,
    listBrandDeliverables: () => [missionDeliverable(workspaceId)],
    assertMatrixSelectionCurrent: () => {},
    previewMatrixGeneration: async () => ({ results: [{ status: 'ready', ...previewTarget(workspaceId), target: previewTarget(workspaceId) }], estimatedBatchBudget: { providerCalls: 2, inputTokens: 100, outputTokens: 200, estimatedUsd: 0.05, maxConcurrency: 1 } }),
    startMatrixGeneration: async () => ({ run: matrixResult(workspaceId, false, 'running').run, jobId: 'matrix-job-1', estimatedBudget: { providerCalls: 2, inputTokens: 100, outputTokens: 200, estimatedUsd: 0.05, maxConcurrency: 1 }, existing: false }),
    getMatrixGeneration: () => matrixResult(workspaceId, state.matrixApproved, state.matrixStatus),
    assertPagePublishPreconditions: publishPreflight,
  };
  return { state, deps, publishPreflight };
}

const brandBudget = {
  maxProviderCalls: 20,
  maxInputTokens: 10_000,
  maxOutputTokens: 5_000,
  maxEstimatedCostMicros: 10_000,
  maxConcurrency: 1,
};

const matrixBudget = {
  maxProviderCalls: 2,
  maxInputTokens: 100,
  maxOutputTokens: 200,
  maxEstimatedUsd: 0.05,
  maxConcurrency: 1,
};

function matrixInputSelection(count: number): MatrixGenerationInputSelection {
  const selections = Array.from({ length: count }, (_, index) => ({
    matrixId: 'matrix-1',
    cellId: `cell-${index + 1}`,
    sourceRevision: {
      matrixRevision: 1,
      templateRevision: 2,
      cellRevision: index + 3,
    },
    structuralFingerprint,
    previewFingerprint: null,
  }));
  return selections as MatrixGenerationInputSelection;
}

function seedContentGate(
  workspaceId: string,
  intakeRevisionId: string,
  targetStatus:
    | 'brand_generating_dependents'
    | 'awaiting_content_authorization'
    | 'content_generating'
    | 'awaiting_content_review',
  selectionCount = 1,
) {
  const actor = { actorType: 'operator' as const, actorId: 'operator-1' };
  const intakeRevision = {
    intakeRevisionId,
    revision: 1,
    fingerprint: intakeFingerprint,
  };
  let run = createBrandContentOnboardingRun({
    workspaceId,
    intakeRevision,
    matrixSelection: matrixInputSelection(selectionCount),
    brandBudget,
    idempotencyKey: `seed-${targetStatus}`,
    createdBy: actor,
    intakeEvidence: {
      id: `seed-intake-${targetStatus}`,
      gate: 'intake_accepted',
      intakeRevision,
      recordedBy: actor,
      recordedAt: '2026-07-14T00:00:00.000Z',
    },
  }).run;
  const path = [
    'brand_generating',
    'awaiting_voice_review',
    'awaiting_voice_finalization',
    'brand_generating_dependents',
    'awaiting_operator_review',
    'awaiting_client_review',
    'awaiting_content_authorization',
    'content_generating',
    'awaiting_content_review',
  ] as const;
  const gateFor = {
    brand_generating: null,
    awaiting_voice_review: 'voice_reviewed',
    awaiting_voice_finalization: 'voice_finalized',
    brand_generating_dependents: null,
    awaiting_operator_review: 'operator_brand_reviewed',
    awaiting_client_review: 'client_brand_reviewed',
    awaiting_content_authorization: 'content_authorized',
    content_generating: null,
    awaiting_content_review: 'all_pages_approved',
  } as const;
  for (const nextStatus of path) {
    const transitioned = transitionBrandContentOnboardingRun({
      workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      expectedStatus: run.status,
      nextStatus,
      currentGate: gateFor[nextStatus],
      attentionResumeStatus: null,
      ...(nextStatus === 'brand_generating'
        ? { children: { brandRunId: 'brand-run-1' } }
        : {}),
      ...(nextStatus === 'brand_generating_dependents'
        ? { finalizedVoice: previewTarget(workspaceId).voiceSnapshot }
        : {}),
      ...(nextStatus === 'awaiting_content_authorization'
        ? { approvedIdentity: [missionIdentityRef()] }
        : {}),
      ...(nextStatus === 'content_generating'
        ? { children: { matrixRunId: 'matrix-run-1' } }
        : {}),
      resume: {
        idempotencyKey: `seed-${run.revision}-${nextStatus}`,
        requestFingerprint: canonicalGenerationFingerprint({
          runId: run.id,
          revision: run.revision,
          nextStatus,
        }),
      },
    });
    run = transitioned.run;
    if (run.status === targetStatus) return run;
  }
  throw new Error(`Unable to seed onboarding status ${targetStatus}`);
}

function resumeRequest(
  workspaceId: string,
  run: { id: string; revision: number; status: string },
  idempotencyKey: string,
  gateEvidenceId: string,
) {
  return {
    workspaceId,
    runId: run.id,
    expectedRevision: run.revision,
    expectedStatus: run.status,
    gateEvidenceId,
    idempotencyKey,
    resumedBy: { actorType: 'mcp' as const, actorId: 'key-1' },
    mcpExecutionContext: null,
  };
}

describe('brand content onboarding service', () => {
  it('walks every human gate and reaches readiness without sending, approving, or publishing', async () => {
    const { workspaceId, intakeRevisionId } = seedWorkspace();
    const { state, deps, publishPreflight } = harness(workspaceId, intakeRevisionId);
    const selection = [{
      matrixId: 'matrix-1', cellId: 'cell-1',
      sourceRevision: { matrixRevision: 1, templateRevision: 2, cellRevision: 3 },
      structuralFingerprint,
      previewFingerprint: null,
    }] as const;

    let result = startBrandContentOnboarding({
      workspaceId,
      intakeRevisionId,
      expectedIntakeRevision: 1,
      expectedIntakeFingerprint: intakeFingerprint,
      matrixSelection: selection,
      brandBudget,
      idempotencyKey: 'onboarding-start',
      startedBy: { actorType: 'mcp', actorId: 'key-1' },
      mcpExecutionContext: null,
    }, deps);
    expect(result.run.status).toBe('brand_generating');
    expect(result.paidJobId).toBe('brand-job-start');
    expect(result.run.createdBy).toEqual({ actorType: 'mcp' });
    expect(result.run.gateEvidence[0]?.recordedBy).toEqual({ actorType: 'mcp' });
    expect(getBrandContentOnboarding({ workspaceId, runId: result.run.id }))
      .toMatchObject({
        createdBy: { actorType: 'mcp' },
        gateEvidence: [{ recordedBy: { actorType: 'mcp' } }],
      });

    state.brandPhase = 'foundation_ready';
    result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'resume-foundation-ready', 'brand-run-1'),
      deps,
    );
    expect(result.run.status).toBe('awaiting_voice_review');

    state.voiceReview = review('voice_foundation', 'approved');
    result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'resume-voice-review', 'voice-review-1'),
      deps,
    );
    expect(result.run.status).toBe('awaiting_voice_finalization');

    state.voiceFinalized = true;
    result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'resume-voice-finalized', 'voice-finalization-1'),
      deps,
    );
    expect(result.run.status).toBe('brand_generating_dependents');
    expect(result.paidJobId).toBe('brand-job-dependent');

    state.brandPhase = 'dependents_ready';
    result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'resume-brand-ready', 'brand-run-1'),
      deps,
    );
    expect(result.run.status).toBe('awaiting_operator_review');

    state.suiteReview = review('brand_suite', 'awaiting_client');
    result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'resume-operator-review', 'suite-review-1'),
      deps,
    );
    expect(result.run.status).toBe('awaiting_client_review');

    state.suiteReview = review('brand_suite', 'approved');
    result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'resume-client-review', 'suite-review-1'),
      deps,
    );
    expect(result.run.status).toBe('awaiting_content_authorization');
    expect(result.run.approvedIdentity).toHaveLength(1);

    const startSelections = [{
      cellId: 'cell-1',
      expectedSourceRevision: selection[0].sourceRevision,
      expectedPreviewFingerprint: previewFingerprint,
    }];
    result = await authorizeBrandContentGeneration({
      workspaceId,
      runId: result.run.id,
      expectedRevision: result.run.revision,
      expectedStatus: 'awaiting_content_authorization',
      authorizationId: 'content-authorization-1',
      expectedMatrixSelectionFingerprint: canonicalGenerationFingerprint({
        matrixId: 'matrix-1',
        selections: startSelections,
      }),
      acceptedBudget: matrixBudget,
      idempotencyKey: 'authorize-content',
      authorizedBy: { actorType: 'operator', actorId: 'operator-1' },
    }, deps);
    expect(result.run.status).toBe('content_generating');
    expect(result.paidJobId).toBe('matrix-job-1');

    state.matrixStatus = 'completed';
    result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'resume-content-ready', 'matrix-run-1'),
      deps,
    );
    expect(result.run.status).toBe('awaiting_content_review');

    const waiting = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'resume-waiting-approval', 'matrix-run-1'),
      deps,
    );
    expect(waiting.run.status).toBe('awaiting_content_review');
    expect(waiting.advanced).toBe(false);
    expect(publishPreflight).not.toHaveBeenCalled();

    state.matrixApproved = true;
    result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, waiting.run, 'resume-approved-pages', 'matrix-run-1'),
      deps,
    );
    expect(result.run.status).toBe('ready_to_publish');
    expect(result.run.children.pageApprovals).toHaveLength(1);
    expect(publishPreflight).toHaveBeenCalledTimes(1);
  });

  it('terminalizes a rejected voice foundation because that child cannot be revised', () => {
    const { workspaceId, intakeRevisionId } = seedWorkspace();
    const { state, deps } = harness(workspaceId, intakeRevisionId);
    let result = startBrandContentOnboarding({
      workspaceId, intakeRevisionId, expectedIntakeRevision: 1,
      expectedIntakeFingerprint: intakeFingerprint,
      matrixSelection: matrixInputSelection(1), brandBudget, idempotencyKey: 'start-changes',
      startedBy: { actorType: 'mcp', actorId: 'key-1' }, mcpExecutionContext: null,
    }, deps);
    state.brandPhase = 'foundation_ready';
    result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'foundation-ready', 'brand-run-1'),
      deps,
    );
    state.voiceReview = review('voice_foundation', 'changes_requested');
    result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'voice-changes', 'voice-review-1'),
      deps,
    );
    expect(result.run).toMatchObject({ status: 'failed', attentionResumeStatus: null });
    expect(() => resumeBrandContentOnboarding(
      resumeRequest(workspaceId, result.run, 'recover-voice-review', 'voice-review-1'),
      deps,
    )).toThrow(/terminal/);
  });

  it('accepts dependent brand items that were approved before the coordinator observed them', () => {
    const { workspaceId, intakeRevisionId } = seedWorkspace();
    const { state, deps } = harness(workspaceId, intakeRevisionId);
    const run = seedContentGate(
      workspaceId,
      intakeRevisionId,
      'brand_generating_dependents',
    );
    state.brandPhase = 'dependents_approved';

    const result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, run, 'observe-early-approval', 'brand-run-1'),
      deps,
    );

    expect(result.run.status).toBe('awaiting_operator_review');
  });

  it('propagates a cancelled child run without relabeling it as success', () => {
    const { workspaceId, intakeRevisionId } = seedWorkspace();
    const { state, deps } = harness(workspaceId, intakeRevisionId);
    const started = startBrandContentOnboarding({
      workspaceId, intakeRevisionId, expectedIntakeRevision: 1,
      expectedIntakeFingerprint: intakeFingerprint,
      matrixSelection: matrixInputSelection(1), brandBudget, idempotencyKey: 'start-cancel',
      startedBy: { actorType: 'mcp', actorId: 'key-1' }, mcpExecutionContext: null,
    }, deps);
    state.brandPhase = 'cancelled';
    const result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, started.run, 'observe-cancel', 'brand-run-1'),
      deps,
    );
    expect(result.run.status).toBe('cancelled');
  });

  it('stops before paid content work when frozen brand authority changed', async () => {
    const { workspaceId, intakeRevisionId } = seedWorkspace();
    const { deps } = harness(workspaceId, intakeRevisionId);
    const run = seedContentGate(
      workspaceId,
      intakeRevisionId,
      'awaiting_content_authorization',
    );
    const startMatrix = vi.fn(deps.startMatrixGeneration!);

    const result = await authorizeBrandContentGeneration({
      workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      expectedStatus: 'awaiting_content_authorization',
      authorizationId: 'authority-drift-authorization',
      expectedMatrixSelectionFingerprint: 'e'.repeat(64),
      acceptedBudget: matrixBudget,
      idempotencyKey: 'authority-drift',
      authorizedBy: { actorType: 'operator', actorId: 'operator-1' },
    }, { ...deps, startMatrixGeneration: startMatrix });

    expect(result.run).toMatchObject({
      status: 'needs_attention',
      attentionResumeStatus: 'awaiting_content_authorization',
    });
    expect(startMatrix).not.toHaveBeenCalled();
  });

  it('reattaches an exact paid matrix child before attempting a stale live preview', async () => {
    const { workspaceId, intakeRevisionId } = seedWorkspace();
    const { deps } = harness(workspaceId, intakeRevisionId);
    const run = seedContentGate(
      workspaceId,
      intakeRevisionId,
      'awaiting_content_authorization',
    );
    const accepted = matrixResult(workspaceId, false, 'running').run;
    accepted.acceptedBudget = {
      estimate: {
        providerCalls: 2,
        inputTokens: 100,
        outputTokens: 200,
        estimatedUsd: 0.05,
        maxConcurrency: 1,
      },
      limits: matrixBudget,
      reserved: { providerCalls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
    };
    const preview = vi.fn(async () => {
      throw new Error('live source revisions already advanced');
    });
    const startMatrix = vi.fn(async () => {
      throw new Error('paid child must not be started twice');
    });
    const startSelections = [{
      cellId: 'cell-1',
      expectedSourceRevision: run.inputs.matrixSelection[0].sourceRevision,
      expectedPreviewFingerprint: previewFingerprint,
    }];

    const result = await authorizeBrandContentGeneration({
      workspaceId,
      runId: run.id,
      expectedRevision: run.revision,
      expectedStatus: 'awaiting_content_authorization',
      authorizationId: 'recover-content-authorization',
      expectedMatrixSelectionFingerprint: canonicalGenerationFingerprint({
        matrixId: 'matrix-1',
        selections: startSelections,
      }),
      acceptedBudget: matrixBudget,
      idempotencyKey: 'recover-content-child',
      authorizedBy: { actorType: 'operator', actorId: 'retrying-operator' },
    }, {
      ...deps,
      getMatrixGenerationByIdempotency: () => accepted,
      previewMatrixGeneration: preview,
      startMatrixGeneration: startMatrix,
    });

    expect(result.run.status).toBe('content_generating');
    expect(result.run.children.matrixRunId).toBe('matrix-run-1');
    expect(result.paidJobId).toBe('matrix-job-1');
    expect(preview).not.toHaveBeenCalled();
    expect(startMatrix).not.toHaveBeenCalled();
  });

  it('translates a typed child budget rejection at the coordinator boundary', () => {
    const { workspaceId, intakeRevisionId } = seedWorkspace();
    const { deps } = harness(workspaceId, intakeRevisionId);

    expect(() => startBrandContentOnboarding({
      workspaceId,
      intakeRevisionId,
      expectedIntakeRevision: 1,
      expectedIntakeFingerprint: intakeFingerprint,
      matrixSelection: matrixInputSelection(1),
      brandBudget,
      idempotencyKey: 'child-budget-error',
      startedBy: { actorType: 'mcp', actorId: 'key-1' },
      mcpExecutionContext: null,
    }, {
      ...deps,
      startBrandGeneration: () => {
        throw new BrandGenerationBudgetExceededError('providerCalls', 21, 20);
      },
    })).toThrow(expect.objectContaining<Partial<BrandContentOnboardingServiceError>>({
      code: 'precondition_failed',
      status: 422,
    }));
  });

  it('rejects stale matrix source authority before starting paid brand work', () => {
    const { workspaceId, intakeRevisionId } = seedWorkspace();
    const { deps } = harness(workspaceId, intakeRevisionId);
    const startBrand = vi.fn(deps.startBrandGeneration!);

    expect(() => startBrandContentOnboarding({
      workspaceId,
      intakeRevisionId,
      expectedIntakeRevision: 1,
      expectedIntakeFingerprint: intakeFingerprint,
      matrixSelection: matrixInputSelection(1),
      brandBudget,
      idempotencyKey: 'stale-matrix-before-brand',
      startedBy: { actorType: 'mcp', actorId: 'key-1' },
      mcpExecutionContext: null,
    }, {
      ...deps,
      assertMatrixSelectionCurrent: () => {
        throw new BrandContentOnboardingServiceError(
          'authority_changed',
          'The selected matrix source changed',
          409,
        );
      },
      startBrandGeneration: startBrand,
    })).toThrow(/matrix source changed/);
    expect(startBrand).not.toHaveBeenCalled();
  });

  it('records a partial matrix child as needs-attention instead of content success', () => {
    const { workspaceId, intakeRevisionId } = seedWorkspace();
    const { state, deps } = harness(workspaceId, intakeRevisionId);
    const run = seedContentGate(workspaceId, intakeRevisionId, 'content_generating');
    state.matrixStatus = 'completed_with_errors';

    const result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, run, 'partial-matrix', 'matrix-run-1'),
      deps,
    );

    expect(result.run).toMatchObject({
      status: 'needs_attention',
      attentionResumeStatus: 'content_generating',
    });
  });

  it('keeps a 10-page set in review when even one page lacks human approval', () => {
    const { workspaceId, intakeRevisionId } = seedWorkspace();
    const { state, deps, publishPreflight } = harness(workspaceId, intakeRevisionId);
    const run = seedContentGate(
      workspaceId,
      intakeRevisionId,
      'awaiting_content_review',
      10,
    );
    state.voiceFinalized = true;
    const getMatrixGeneration = vi.fn(() => (
      matrixResult(workspaceId, true, 'completed', 10, 9)
    ));

    const result = resumeBrandContentOnboarding(
      resumeRequest(workspaceId, run, 'one-page-unapproved', 'matrix-run-1'),
      { ...deps, getMatrixGeneration },
    );

    expect(result.run.status).toBe('awaiting_content_review');
    expect(result.advanced).toBe(false);
    expect(publishPreflight).not.toHaveBeenCalled();
  });
});
