import { describe, expect, it } from 'vitest';
import {
  GENERATION_AUDIT_VERDICTS,
  GENERATION_EVIDENCE_REQUIREMENT_STAGES,
  GENERATION_EVIDENCE_STAGE_POLICY,
  GENERATION_EVIDENCE_STATUSES,
  GENERATION_RUN_STATUSES,
  canRenderGenerationPlaceholder,
  type GenerationEvidenceResolution,
  type GenerationEvidenceRequirement,
  type GenerationEvidenceSourceRef,
} from '../../shared/types/generation-evidence.js';
import {
  BRAND_INTAKE_SCHEMA_VERSION,
  type BrandIntakeEvidenceRef,
  type BrandIntakePayload,
} from '../../shared/types/brand-intake.js';
import {
  BRAND_DELIVERABLE_TARGET_POLICY,
  BRAND_GENERATION_ATOMIC_TARGETS,
  BRAND_GENERATION_ITEM_STATUSES,
  BRAND_GENERATION_PRESETS,
  BRAND_GENERATION_PRESET_POLICY,
  BRAND_GENERATION_RUN_STATUSES,
  type ApprovedBrandDeliverableRef,
  type BrandGeneratedClaim,
  type BrandGenerationSelection,
  type BrandVoiceReadiness,
} from '../../shared/types/brand-generation.js';
import {
  BRAND_CONTENT_ONBOARDING_STATUSES,
  type BrandContentOnboardingGateEvidence,
} from '../../shared/types/brand-content-onboarding.js';
import {
  MATRIX_GENERATION_ITEM_STATUSES,
  MATRIX_GENERATION_RUN_STATUSES,
  RESOLVED_SYSTEM_BLOCK_IDS,
  type MatrixArtifactRevisionExpectations,
  type MatrixGenerationPreviewTarget,
  type MatrixSourceRevision,
  type ResolveMatrixGenerationEvidenceRequest,
  type RetryMatrixGenerationRequest,
  type ResolvedPageBlockManifest,
  type ResolvedMatrixStructuralTarget,
} from '../../shared/types/matrix-generation.js';
import { BRAND_DELIVERABLE_TYPES } from '../../shared/types/brand-engine.js';

type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type AssertFalse<T extends false> = T;
type AssertTrue<T extends true> = T;
type IsExact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;
type Last<T extends readonly unknown[]> = T extends readonly [...unknown[], infer L] ? L : never;

describe('MCP matrix + brand generation shared contracts', () => {
  it('locks evidence classifications, stages, placeholder policy, and audit verdicts', () => {
    expect(GENERATION_EVIDENCE_STATUSES).toEqual([
      'verified',
      'inferred',
      'missing',
      'conflicting',
      'creative_proposal',
    ]);
    expect(GENERATION_EVIDENCE_REQUIREMENT_STAGES).toEqual([
      'preflight',
      'ready',
      'optional_omit',
    ]);
    expect(GENERATION_EVIDENCE_STAGE_POLICY).toEqual({
      preflight: {
        blocksPaidWork: true,
        permitsTypedPlaceholderWhenMissing: false,
        blocksReviewReady: true,
      },
      ready: {
        blocksPaidWork: false,
        permitsTypedPlaceholderWhenMissing: true,
        blocksReviewReady: true,
      },
      optional_omit: {
        blocksPaidWork: false,
        permitsTypedPlaceholderWhenMissing: false,
        blocksReviewReady: false,
      },
    });
    expect(GENERATION_AUDIT_VERDICTS).toEqual([
      'ready_for_human_review',
      'needs_attention',
      'blocked_missing_evidence',
    ]);

    const missingReady: GenerationEvidenceRequirement = {
      id: 'req-hours',
      status: 'missing',
      fieldPath: 'business.hours',
      claim: 'Opening hours',
      reason: 'No durable source',
      sourceRefs: [],
      requirementStage: 'ready',
      clientSafePrompt: 'What are your opening hours?',
    };
    const verifiedReady: GenerationEvidenceRequirement = {
      ...missingReady,
      status: 'verified',
      sourceRefs: [{
        sourceType: 'client_submission',
        sourceId: 'intake-1',
        capturedAt: '2026-07-13T12:00:00.000Z',
      }],
    };
    expect(canRenderGenerationPlaceholder(missingReady)).toBe(true);
    expect(canRenderGenerationPlaceholder(verifiedReady)).toBe(false);
  });

  it('locks truthful shared run outcomes and stage-specific item outcomes', () => {
    expect(GENERATION_RUN_STATUSES).toEqual([
      'queued',
      'running',
      'awaiting_review',
      'completed',
      'completed_with_errors',
      'blocked',
      'conflict',
      'cancelled',
      'failed',
    ]);
    expect(MATRIX_GENERATION_ITEM_STATUSES).toEqual([
      'queued',
      'preflighting',
      'preflighted',
      'generating_brief',
      'generating_post',
      'auditing_deterministic',
      'auditing_model',
      'revising',
      'ready_for_human_review',
      'needs_attention',
      'blocked_missing_evidence',
      'conflict',
      'cancelled',
      'failed',
    ]);
    expect(BRAND_GENERATION_ITEM_STATUSES).toEqual([
      'queued',
      'preflighting',
      'generating',
      'auditing_deterministic',
      'auditing_model',
      'revising',
      'ready_for_human_review',
      'approved',
      'changes_requested',
      'needs_attention',
      'blocked_missing_evidence',
      'conflict',
      'cancelled',
      'failed',
    ]);
    expect(MATRIX_GENERATION_RUN_STATUSES).toEqual(GENERATION_RUN_STATUSES);
    expect(BRAND_GENERATION_RUN_STATUSES).toEqual(GENERATION_RUN_STATUSES);
  });

  it('keeps the structural matrix target free of ready-only generation context', () => {
    const sourceRevision: MatrixSourceRevision = {
      matrixRevision: 3,
      templateRevision: 5,
      cellRevision: 8,
    };
    expect(sourceRevision).toEqual({ matrixRevision: 3, templateRevision: 5, cellRevision: 8 });

    const structuralHasVoice: AssertFalse<HasKey<ResolvedMatrixStructuralTarget, 'voiceSnapshot'>> = false;
    const structuralHasArtifactRevisions: AssertFalse<HasKey<ResolvedMatrixStructuralTarget, 'expectedArtifactRevisions'>> = false;
    const previewHasVoice: AssertTrue<HasKey<MatrixGenerationPreviewTarget, 'voiceSnapshot'>> = true;
    const previewHasArtifactRevisions: AssertTrue<HasKey<MatrixGenerationPreviewTarget, 'expectedArtifactRevisions'>> = true;
    expect({ structuralHasVoice, structuralHasArtifactRevisions, previewHasVoice, previewHasArtifactRevisions })
      .toEqual({
        structuralHasVoice: false,
        structuralHasArtifactRevisions: false,
        previewHasVoice: true,
        previewHasArtifactRevisions: true,
      });
  });

  it('locks exactly one stable system wrapper at each end of the page manifest', () => {
    type Blocks = ResolvedPageBlockManifest['blocks'];
    type SystemBlockIds = Extract<Blocks[number], { source: 'system' }>['id'];

    const firstIsIntroduction: AssertTrue<
      IsExact<Blocks[0]['id'], typeof RESOLVED_SYSTEM_BLOCK_IDS.introduction>
    > = true;
    const lastIsConclusion: AssertTrue<
      IsExact<Last<Blocks> extends { id: infer Id } ? Id : never, typeof RESOLVED_SYSTEM_BLOCK_IDS.conclusion>
    > = true;
    const systemIdsAreExact: AssertTrue<
      IsExact<SystemBlockIds, 'system:introduction' | 'system:conclusion'>
    > = true;

    expect(RESOLVED_SYSTEM_BLOCK_IDS).toEqual({
      introduction: 'system:introduction',
      conclusion: 'system:conclusion',
    });
    expect({ firstIsIntroduction, lastIsConclusion, systemIdsAreExact })
      .toEqual({ firstIsIntroduction: true, lastIsConclusion: true, systemIdsAreExact: true });
  });

  it('keeps voice foundation atomic, not a normal preset, and exhaustively gates durable targets', () => {
    expect(BRAND_GENERATION_ATOMIC_TARGETS).toEqual([
      'voice_foundation',
      ...BRAND_DELIVERABLE_TYPES,
    ]);
    expect(BRAND_GENERATION_PRESETS).toEqual([
      'identity_messaging',
      'audience',
      'full_brand_system',
    ]);
    expect(BRAND_GENERATION_PRESETS).not.toContain('voice_foundation');
    expect(BRAND_DELIVERABLE_TARGET_POLICY.voice_foundation).toEqual({
      voicePolicy: 'bootstrap',
      persistence: 'run_item',
      claimPolicy: 'mixed',
    });
    for (const target of BRAND_DELIVERABLE_TYPES) {
      expect(BRAND_DELIVERABLE_TARGET_POLICY[target].voicePolicy)
        .toBe('requires_finalized_voice');
    }
    expect(BRAND_DELIVERABLE_TARGET_POLICY.naming.claimPolicy).toBe('creative_proposal');
    expect(BRAND_DELIVERABLE_TARGET_POLICY.tagline.claimPolicy).toBe('creative_proposal');
    expect(BRAND_GENERATION_PRESET_POLICY.identity_messaging.startMode)
      .toBe('requires_finalized_voice');
    expect(BRAND_GENERATION_PRESET_POLICY.audience.startMode)
      .toBe('requires_finalized_voice');
    expect(BRAND_GENERATION_PRESET_POLICY.full_brand_system).toEqual({
      startMode: 'bootstrap_then_resume',
      initialTargets: ['voice_foundation'],
      resumeTargets: BRAND_DELIVERABLE_TYPES,
    });
    const atomicSelection: BrandGenerationSelection = {
      kind: 'atomic',
      target: 'voice_foundation',
    };
    expect(atomicSelection).toEqual({ kind: 'atomic', target: 'voice_foundation' });

    const groupedDurableTargets = [
      ...BRAND_GENERATION_PRESET_POLICY.identity_messaging.initialTargets,
      ...BRAND_GENERATION_PRESET_POLICY.audience.initialTargets,
    ];
    expect(groupedDurableTargets).toHaveLength(BRAND_DELIVERABLE_TYPES.length);
    expect(new Set(groupedDurableTargets)).toEqual(new Set(BRAND_DELIVERABLE_TYPES));
  });

  it('requires immutable approved identity and anchored finalized voice snapshots', () => {
    const anchor: GenerationEvidenceSourceRef = {
      sourceType: 'voice_sample',
      sourceId: 'sample-1',
      capturedAt: '2026-07-13T12:00:00.000Z',
    };
    const readiness: BrandVoiceReadiness = {
      state: 'finalized',
      snapshot: {
        voiceProfileId: 'voice-1',
        voiceVersion: 4,
        finalizedAt: '2026-07-13T12:05:00.000Z',
        fingerprint: 'voice-fingerprint',
        anchorEvidenceRefs: [anchor],
      },
      blockingReasons: [],
    };
    const approvedIdentity: ApprovedBrandDeliverableRef = {
      deliverableId: 'deliverable-1',
      deliverableType: 'differentiators',
      version: 2,
      approvedAt: '2026-07-13T12:10:00.000Z',
      contentFingerprint: 'content-fingerprint',
      approvalFingerprint: 'approval-fingerprint',
    };
    expect(readiness.state).toBe('finalized');
    expect(readiness.snapshot.anchorEvidenceRefs).toHaveLength(1);
    expect(approvedIdentity.approvalFingerprint).toBe('approval-fingerprint');
  });

  it('preserves evidence cardinality for intake projections and factual claims', () => {
    const missingRequirement: GenerationEvidenceRequirement = {
      id: 'req-location-proof',
      status: 'missing',
      fieldPath: 'business.locations',
      claim: 'Office presence',
      reason: 'A matrix label is not proof',
      sourceRefs: [],
      requirementStage: 'preflight',
    };
    const intakeEvidence: BrandIntakeEvidenceRef = {
      intakeRevisionId: 'intake-1',
      section: 'business',
      fieldPath: 'locations',
      requirement: missingRequirement,
    };
    const factualClaim: BrandGeneratedClaim = {
      text: 'Verified operator-supplied fact',
      classification: 'factual',
      sourceRefs: [{
        sourceType: 'operator_attestation',
        sourceId: 'attestation-1',
        capturedAt: '2026-07-13T12:00:00.000Z',
      }],
    };
    expect(intakeEvidence.requirement.sourceRefs).toEqual([]);
    expect(factualClaim.sourceRefs).toHaveLength(1);
  });

  it('shares the current questionnaire payload without weakening typed evidence resolution', () => {
    const payload: BrandIntakePayload = {
      schemaVersion: 1,
      authenticSamples: [],
      business: {
        businessName: 'Example Co',
        industry: 'Services',
        description: 'A grounded description',
        services: 'Consulting',
        locations: 'Chicago',
        differentiators: 'Operator supplied',
        website: 'https://example.com',
      },
      audience: {
        primaryAudience: 'Operators',
        painPoints: 'Limited time',
        goals: 'Reliable growth',
        objections: 'Proof',
        buyingStage: 'mixed',
        secondaryAudience: '',
      },
      brand: {
        tone: 'Clear',
        personality: ['Direct'],
        avoidWords: 'Revolutionary',
        contentFormats: ['How-to guides'],
        existingExamples: 'An authentic client example',
      },
      competitors: {
        competitors: 'Example Rival',
        whatTheyDoBetter: 'Distribution',
        whatYouDoBetter: 'Service',
        referenceUrls: 'https://example.com/reference',
      },
    };
    const resolution: GenerationEvidenceResolution<MatrixSourceRevision> = {
      id: 'resolution-1',
      requirementId: 'req-service-availability',
      value: { kind: 'boolean', value: true },
      sourceRef: {
        sourceType: 'client_submission',
        sourceId: 'intake-revision-1',
        capturedAt: '2026-07-13T12:00:00.000Z',
      },
      resolvedBy: {
        actorType: 'client',
        actorId: 'client-1',
      },
      expectedSourceRevision: {
        matrixRevision: 1,
        templateRevision: 1,
        cellRevision: 1,
      },
      expectedArtifactRevisions: [],
      resolvedAt: '2026-07-13T12:00:00.000Z',
    };

    expect(BRAND_INTAKE_SCHEMA_VERSION).toBe(1);
    expect(payload.business.businessName).toBe('Example Co');
    expect(resolution.value).toEqual({ kind: 'boolean', value: true });
  });

  it('requires exact brief/post CAS, cell ownership, and explicit replacement authorization', () => {
    const sourceRevision: MatrixSourceRevision = {
      matrixRevision: 1,
      templateRevision: 2,
      cellRevision: 3,
    };
    const artifactRevisions: MatrixArtifactRevisionExpectations = {
      brief: {
        artifactType: 'content_brief',
        artifactId: 'brief-1',
        generationRevision: 4,
      },
      post: {
        artifactType: 'generated_post',
        artifactId: 'post-1',
        generationRevision: 5,
      },
    };
    const evidenceRequest: ResolveMatrixGenerationEvidenceRequest = {
      workspaceId: 'workspace-1',
      matrixId: 'matrix-1',
      cellId: 'cell-1',
      requirementId: 'req-hours',
      value: { kind: 'text', value: '9am–5pm' },
      sourceRef: {
        sourceType: 'operator_attestation',
        sourceId: 'attestation-1',
        capturedAt: '2026-07-13T12:00:00.000Z',
      },
      resolvedBy: { actorType: 'operator', actorId: 'operator-1' },
      expectedSourceRevision: sourceRevision,
      expectedArtifactRevisions: artifactRevisions,
      idempotencyKey: 'resolve-1',
    };
    const retry: RetryMatrixGenerationRequest = {
      runId: 'run-1',
      expectedRunRevision: 6,
      mode: 'replace',
      items: [{
        itemId: 'item-1',
        expectedItemRevision: 7,
        sourceRevision,
        expectedArtifactRevisions: artifactRevisions,
        reusableCheckpointFingerprint: null,
      }],
      idempotencyKey: 'retry-1',
      replacementAuthorization: {
        authorizedBy: { actorType: 'operator', actorId: 'operator-1' },
        reason: 'Replace the explicitly selected stale draft',
        authorizedAt: '2026-07-13T12:10:00.000Z',
      },
    };

    expect(evidenceRequest).toMatchObject({
      workspaceId: 'workspace-1',
      matrixId: 'matrix-1',
      cellId: 'cell-1',
    });
    expect(retry.mode).toBe('replace');
    expect(retry.replacementAuthorization.reason).toContain('explicitly selected');
  });

  it('locks onboarding gates without creating a pre-persistence transition machine', () => {
    expect(BRAND_CONTENT_ONBOARDING_STATUSES).toEqual([
      'intake_ready',
      'brand_generating',
      'awaiting_voice_review',
      'awaiting_voice_finalization',
      'brand_generating_dependents',
      'awaiting_operator_review',
      'awaiting_client_review',
      'awaiting_content_authorization',
      'content_generating',
      'awaiting_content_review',
      'ready_to_publish',
      'needs_attention',
      'cancelled',
      'failed',
    ]);
    expect(BRAND_CONTENT_ONBOARDING_STATUSES.indexOf('awaiting_content_review'))
      .toBeLessThan(BRAND_CONTENT_ONBOARDING_STATUSES.indexOf('ready_to_publish'));

    const pageApprovalEvidence: BrandContentOnboardingGateEvidence = {
      id: 'gate-evidence-1',
      gate: 'all_pages_approved',
      pageApprovals: [{
        approvalId: 'approval-1',
        matrixRunId: 'matrix-run-1',
        matrixRunRevision: 8,
        matrixItemId: 'matrix-item-1',
        matrixItemRevision: 9,
        matrixId: 'matrix-1',
        cellId: 'cell-1',
        postId: 'post-1',
        postGenerationRevision: 10,
        approvedAt: '2026-07-13T12:20:00.000Z',
      }],
      recordedBy: { actorType: 'operator', actorId: 'operator-1' },
      recordedAt: '2026-07-13T12:20:00.000Z',
    };
    expect(pageApprovalEvidence.pageApprovals[0]).toMatchObject({
      cellId: 'cell-1',
      postGenerationRevision: 10,
    });
  });
});
