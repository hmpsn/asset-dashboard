import { describe, expect, it } from 'vitest';
import {
  AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES,
  GENERATION_AUTOMATIC_REVISION_COUNTS,
  GENERATION_AUDIT_VERDICTS,
  GENERATION_EVIDENCE_REQUIREMENT_STAGES,
  GENERATION_EVIDENCE_STAGE_POLICY,
  GENERATION_EVIDENCE_STATUSES,
  GENERATION_RUN_STATUSES,
  STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES,
  canRenderGenerationPlaceholder,
  type AuthenticVoiceEvidenceSourceRef,
  type GenerationAuditReport,
  type GenerationEvidenceResolution,
  type GenerationEvidenceRequirement,
  type GenerationEvidenceSourceRef,
  type GenerationFactualEvidenceSourceRef,
  type GenerationResolverAttribution,
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
  BRAND_REVIEW_ITEM_DECISIONS,
  type ApprovedBrandDeliverableRef,
  type AuthenticVoiceAnchorRef,
  type BrandGeneratedClaim,
  type BrandGenerationItem,
  type BrandGenerationRun,
  type BrandGenerationSelection,
  type BrandReviewItemDecision,
  type BrandVoiceReadiness,
} from '../../shared/types/brand-generation.js';
import {
  BRAND_CONTENT_ONBOARDING_GATES,
  BRAND_CONTENT_ONBOARDING_STATUSES,
  type BrandContentOnboardingInputs,
  type BrandContentOnboardingGateEvidence,
  type MatrixPageApprovalRef,
} from '../../shared/types/brand-content-onboarding.js';
import {
  MATRIX_GENERATION_CONTRACT_VERSION,
  MATRIX_GENERATION_ATTEMPT_STATUSES,
  MATRIX_GENERATION_ITEM_STATUSES,
  MATRIX_READ_LIMITS,
  MATRIX_GENERATION_RUN_STATUSES,
  RESOLVED_SYSTEM_BLOCK_IDS,
  type AcceptContentTemplateGenerationUpgradeRequest,
  type CreateMatrixGenerationRunRequest,
  type GetContentMatrixResult,
  type MatrixArtifactRevisionExpectations,
  type MatrixGenerationInputSelection,
  type MatrixGenerationItem,
  type MatrixGenerationRun,
  type MatrixGenerationSelection,
  type MatrixGenerationReplacementAuthorization,
  type MatrixGenerationPreviewTarget,
  type PublicMatrixGenerationCreatorAttribution,
  type MatrixSourceRevision,
  type PersistedMatrixGenerationRun,
  type ResolveMatrixGenerationEvidenceRequest,
  type ResolveMatrixStructuresRequest,
  type RetryMatrixGenerationRequest,
  type ResolvedPageBlockManifest,
  type ResolvedMatrixStructuralTarget,
} from '../../shared/types/matrix-generation.js';
import type { McpToolExecutionContext } from '../../shared/types/mcp-runtime.js';
import {
  AUTHENTIC_VOICE_SAMPLE_SOURCES,
  BRAND_DELIVERABLE_TYPES,
  type AuthenticVoiceSampleSource,
  type VoiceSampleSource,
} from '../../shared/types/brand-engine.js';

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
    expect(AUTHENTIC_VOICE_EVIDENCE_SOURCE_TYPES).toEqual([
      'client_submission',
      'operator_submission',
      'brand_intake',
      'voice_sample',
      'external_research',
    ]);
    expect(AUTHENTIC_VOICE_SAMPLE_SOURCES).toEqual([
      'manual',
      'transcript_extraction',
    ]);
    expect(STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES).toEqual([
      'content_matrix',
      'content_matrix_cell',
      'content_template',
    ]);
    expect(GENERATION_AUTOMATIC_REVISION_COUNTS).toEqual([0, 1]);
    type AuthenticSourceType = AuthenticVoiceEvidenceSourceRef['sourceType'];
    const authenticSourcesAreNarrowed: AssertTrue<IsExact<
      AuthenticSourceType,
      | 'client_submission'
      | 'operator_submission'
      | 'brand_intake'
      | 'voice_sample'
      | 'external_research'
    >> = true;
    type GeneratedVoiceSampleSource = Extract<
      VoiceSampleSource,
      'calibration_loop' | 'identity_approved' | 'copy_approved'
    >;
    const generatedSamplesCannotAnchorVoice: AssertTrue<IsExact<
      Extract<AuthenticVoiceSampleSource, GeneratedVoiceSampleSource>,
      never
    >> = true;
    type StructuralSource = (typeof STRUCTURAL_ONLY_GENERATION_EVIDENCE_SOURCE_TYPES)[number];
    type FactualSource = GenerationFactualEvidenceSourceRef['sourceType'];
    const structuralLabelsCannotGroundFacts: AssertTrue<IsExact<
      Extract<FactualSource, StructuralSource>,
      never
    >> = true;
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
      claimKind: 'factual',
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
      claimKind: 'factual',
      status: 'verified',
      sourceRefs: [{
        sourceType: 'client_submission',
        sourceId: 'intake-1',
        capturedAt: '2026-07-13T12:00:00.000Z',
      }],
    };
    expect(canRenderGenerationPlaceholder(missingReady)).toBe(true);
    expect(canRenderGenerationPlaceholder(verifiedReady)).toBe(false);
    expect(authenticSourcesAreNarrowed).toBe(true);
    expect(generatedSamplesCannotAnchorVoice).toBe(true);
    expect(structuralLabelsCannotGroundFacts).toBe(true);
  });

  it('makes ready audit verdicts truthful and caps the shared automatic revision loop', () => {
    type ReadyReport = Extract<GenerationAuditReport, { verdict: 'ready_for_human_review' }>;
    type BlockedReport = Extract<GenerationAuditReport, { verdict: 'blocked_missing_evidence' }>;
    type ReadyCheckResult = ReadyReport['deterministicChecks'][number]['result'];
    type HumanRequiredResult = GenerationAuditReport['humanRequiredChecks'][number]['result'];
    const readyHasNoUnresolvedEvidence: AssertTrue<IsExact<
      ReadyReport['unresolvedRequirementIds'],
      []
    >> = true;
    const blockedHasMissingEvidence: AssertTrue<IsExact<
      BlockedReport['unresolvedRequirementIds'],
      [string, ...string[]]
    >> = true;
    const readyChecksCannotFail: AssertTrue<IsExact<
      ReadyCheckResult,
      'passed' | 'not_applicable'
    >> = true;
    const humanRequiredChecksCannotAutoPass: AssertTrue<IsExact<
      HumanRequiredResult,
      'needs_human_review' | 'not_applicable'
    >> = true;
    const brandRevisionLoopIsBounded: AssertTrue<IsExact<
      BrandGenerationItem['automaticRevisionCount'],
      0 | 1
    >> = true;
    const matrixRevisionLoopIsBounded: AssertTrue<IsExact<
      MatrixGenerationItem['automaticRevisionCount'],
      0 | 1
    >> = true;

    expect({
      readyHasNoUnresolvedEvidence,
      blockedHasMissingEvidence,
      readyChecksCannotFail,
      humanRequiredChecksCannotAutoPass,
      brandRevisionLoopIsBounded,
      matrixRevisionLoopIsBounded,
    }).toEqual({
      readyHasNoUnresolvedEvidence: true,
      blockedHasMissingEvidence: true,
      readyChecksCannotFail: true,
      humanRequiredChecksCannotAutoPass: true,
      brandRevisionLoopIsBounded: true,
      matrixRevisionLoopIsBounded: true,
    });
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

  it('makes bootstrap persistence singular and brand review decisions human-only', () => {
    type FoundationRun = Extract<
      BrandGenerationRun,
      { selection: { kind: 'atomic'; target: 'voice_foundation' } }
    >;
    type FoundationItem = Extract<BrandGenerationItem, { target: 'voice_foundation' }>;
    type Approval = Extract<BrandReviewItemDecision, { decision: 'approve' }>;
    type ChangesRequested = Extract<BrandReviewItemDecision, { decision: 'changes_requested' }>;

    const foundationTargetsAreExact: AssertTrue<IsExact<
      FoundationRun['selectedTargets'],
      readonly ['voice_foundation']
    >> = true;
    const foundationHasNoDeliverable: AssertTrue<IsExact<
      FoundationItem['deliverableId'],
      null
    >> = true;
    const foundationHasNoDeliverableVersion: AssertTrue<IsExact<
      FoundationItem['expectedDeliverableVersion'],
      null
    >> = true;
    const reviewIsHumanOnly: AssertTrue<IsExact<
      Approval['decidedBy']['actorType'],
      'operator' | 'client'
    >> = true;
    const changeNoteIsRequired: AssertTrue<IsExact<
      ChangesRequested['note'],
      string
    >> = true;

    expect(BRAND_REVIEW_ITEM_DECISIONS).toEqual(['approve', 'changes_requested']);
    expect({
      foundationTargetsAreExact,
      foundationHasNoDeliverable,
      foundationHasNoDeliverableVersion,
      reviewIsHumanOnly,
      changeNoteIsRequired,
    }).toEqual({
      foundationTargetsAreExact: true,
      foundationHasNoDeliverable: true,
      foundationHasNoDeliverableVersion: true,
      reviewIsHumanOnly: true,
      changeNoteIsRequired: true,
    });
  });

  it('requires immutable approved identity and anchored finalized voice snapshots', () => {
    type FinalizedReadiness = Extract<BrandVoiceReadiness, { state: 'finalized' }>;
    const finalizationIsOperatorOnly: AssertTrue<IsExact<
      FinalizedReadiness['snapshot']['finalizedBy']['actorType'],
      'operator'
    >> = true;
    const anchor: AuthenticVoiceAnchorRef = {
      sourceType: 'voice_sample',
      voiceSampleSource: 'manual',
      sourceId: 'sample-1',
      capturedAt: '2026-07-13T12:00:00.000Z',
      selectedBy: {
        actorType: 'operator',
        actorId: 'operator-1',
      },
      selectedAt: '2026-07-13T12:04:00.000Z',
    };
    const readiness: BrandVoiceReadiness = {
      state: 'finalized',
      snapshot: {
        voiceProfileId: 'voice-1',
        voiceVersion: 4,
        finalizedBy: {
          actorType: 'operator',
          actorId: 'operator-1',
        },
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
    expect(finalizationIsOperatorOnly).toBe(true);
    expect(approvedIdentity.approvalFingerprint).toBe('approval-fingerprint');
  });

  it('preserves evidence cardinality for intake projections and factual claims', () => {
    const missingRequirement: GenerationEvidenceRequirement = {
      id: 'req-location-proof',
      claimKind: 'factual',
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
      authenticSamples: [{
        id: 'sample-1',
        kind: 'client_written',
        content: 'An authentic client-written example',
        context: 'body',
        sourceRef: {
          sourceType: 'client_submission',
          sourceId: 'intake-revision-1',
          fieldPath: 'brand.existingExamples',
          capturedAt: '2026-07-13T12:00:00.000Z',
        },
      }],
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
    expect(payload.authenticSamples[0].sourceRef.sourceType).toBe('client_submission');
    expect(resolution.value).toEqual({ kind: 'boolean', value: true });
  });

  it('requires exact brief/post CAS, cell ownership, and explicit replacement authorization', () => {
    type ReplacementActor = MatrixGenerationReplacementAuthorization['authorizedBy']['actorType'];
    const replacementIsOperatorOnly: AssertTrue<IsExact<ReplacementActor, 'operator'>> = true;
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
    expect(replacementIsOperatorOnly).toBe(true);
  });

  it('requires non-empty previewed selections before a paid matrix run', () => {
    type RunSelection = MatrixGenerationRun['selections'];
    type CreateRunSelection = CreateMatrixGenerationRunRequest['selections'];
    type OnboardingSelection = NonNullable<BrandContentOnboardingInputs['matrixSelection']>;
    const runSelectionIsExact: AssertTrue<IsExact<
      RunSelection,
      MatrixGenerationSelection
    >> = true;
    const runSelectionIsNonEmpty: AssertTrue<
      RunSelection extends readonly [unknown, ...unknown[]] ? true : false
    > = true;
    const runPreviewIsRequired: AssertTrue<IsExact<
      RunSelection[number]['previewFingerprint'],
      string
    >> = true;
    const repositoryAlsoRequiresPreview: AssertTrue<IsExact<
      CreateRunSelection,
      MatrixGenerationSelection
    >> = true;
    const onboardingSelectionIsNonEmpty: AssertTrue<IsExact<
      OnboardingSelection,
      MatrixGenerationInputSelection
    >> = true;

    expect({
      runSelectionIsExact,
      runSelectionIsNonEmpty,
      runPreviewIsRequired,
      repositoryAlsoRequiresPreview,
      onboardingSelectionIsNonEmpty,
    }).toEqual({
      runSelectionIsExact: true,
      runSelectionIsNonEmpty: true,
      runPreviewIsRequired: true,
      repositoryAlsoRequiresPreview: true,
      onboardingSelectionIsNonEmpty: true,
    });
  });

  it('locks M0 bounded reads, explicit upgrade decisions, and internal run attribution', () => {
    type ResolveSelection = ResolveMatrixStructuresRequest['selections'];
    type UpgradeDecision = AcceptContentTemplateGenerationUpgradeRequest['decision'];
    type UpgradeIdempotency = AcceptContentTemplateGenerationUpgradeRequest['idempotencyKey'];
    type PersistedExecutionContext = PersistedMatrixGenerationRun['mcpExecutionContext'];
    type PersistedCreator = PersistedMatrixGenerationRun['createdBy'];
    type PublicCreator = MatrixGenerationRun['createdBy'];
    type PublicMcpCreator = Extract<PublicCreator, { actorType: 'mcp' }>;
    type ItemStructuralFingerprint = MatrixGenerationItem['structuralFingerprint'];
    type ItemPreviewFingerprint = MatrixGenerationItem['previewFingerprint'];
    type ReadMatrixRevision = GetContentMatrixResult['matrix']['revision'];
    type ReadCellRevision = GetContentMatrixResult['cells']['items'][number]['revision'];
    type PublicRunLeaksExecutionContext = HasKey<MatrixGenerationRun, 'mcpExecutionContext'>;
    type PublicMcpLeaksActorId = HasKey<PublicMcpCreator, 'actorId'>;
    type PublicMcpLeaksActorLabel = HasKey<PublicMcpCreator, 'actorLabel'>;

    const resolveSelectionIsNonEmpty: AssertTrue<
      ResolveSelection extends readonly [unknown, ...unknown[]] ? true : false
    > = true;
    const decisionIsExplicit: AssertTrue<IsExact<
      UpgradeDecision,
      'accept' | 'reject'
    >> = true;
    const upgradeIdempotencyIsRequired: AssertTrue<IsExact<
      UpgradeIdempotency,
      string
    >> = true;
    const internalContextIsExact: AssertTrue<IsExact<
      PersistedExecutionContext,
      McpToolExecutionContext | null
    >> = true;
    const internalCreatorIsExact: AssertTrue<IsExact<
      PersistedCreator,
      GenerationResolverAttribution
    >> = true;
    const publicCreatorIsExact: AssertTrue<IsExact<
      PublicCreator,
      PublicMatrixGenerationCreatorAttribution
    >> = true;
    const itemFingerprintsAreRequiredStrings: AssertTrue<IsExact<
      [ItemStructuralFingerprint, ItemPreviewFingerprint],
      [string, string]
    >> = true;
    const readRevisionsAreRequiredNumbers: AssertTrue<IsExact<
      [ReadMatrixRevision, ReadCellRevision],
      [number, number]
    >> = true;
    const publicRunDoesNotLeakContext: AssertFalse<PublicRunLeaksExecutionContext> = false;
    const publicMcpDoesNotLeakActorId: AssertFalse<PublicMcpLeaksActorId> = false;
    const publicMcpDoesNotLeakActorLabel: AssertFalse<PublicMcpLeaksActorLabel> = false;

    expect(MATRIX_GENERATION_CONTRACT_VERSION).toBe(1);
    expect(MATRIX_GENERATION_ATTEMPT_STATUSES).toEqual([
      'running',
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(MATRIX_READ_LIMITS).toEqual({
      defaultPageSize: 25,
      maxPageSize: 100,
      maxResolveSelection: 25,
    });
    expect({
      resolveSelectionIsNonEmpty,
      decisionIsExplicit,
      upgradeIdempotencyIsRequired,
      internalContextIsExact,
      internalCreatorIsExact,
      publicCreatorIsExact,
      itemFingerprintsAreRequiredStrings,
      readRevisionsAreRequiredNumbers,
      publicRunDoesNotLeakContext,
      publicMcpDoesNotLeakActorId,
      publicMcpDoesNotLeakActorLabel,
    }).toEqual({
      resolveSelectionIsNonEmpty: true,
      decisionIsExplicit: true,
      upgradeIdempotencyIsRequired: true,
      internalContextIsExact: true,
      internalCreatorIsExact: true,
      publicCreatorIsExact: true,
      itemFingerprintsAreRequiredStrings: true,
      readRevisionsAreRequiredNumbers: true,
      publicRunDoesNotLeakContext: false,
      publicMcpDoesNotLeakActorId: false,
      publicMcpDoesNotLeakActorLabel: false,
    });
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
    expect(BRAND_CONTENT_ONBOARDING_GATES).toEqual([
      'intake_accepted',
      'voice_reviewed',
      'voice_finalized',
      'operator_brand_reviewed',
      'client_brand_reviewed',
      'content_authorized',
      'all_pages_approved',
      'publish_preconditions_passed',
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
        sourceRevision: {
          matrixRevision: 2,
          templateRevision: 3,
          cellRevision: 4,
        },
        postId: 'post-1',
        postGenerationRevision: 10,
        approvedBy: { actorType: 'client', actorId: 'client-1' },
        approvedAt: '2026-07-13T12:20:00.000Z',
      }],
      recordedBy: { actorType: 'operator', actorId: 'operator-1' },
      recordedAt: '2026-07-13T12:20:00.000Z',
    };
    const contentAuthorization: BrandContentOnboardingGateEvidence = {
      id: 'gate-evidence-2',
      gate: 'content_authorized',
      authorizationId: 'authorization-1',
      matrixSelectionFingerprint: 'selection-fingerprint',
      authorizedCellIds: ['cell-1'],
      authorizedBy: { actorType: 'operator', actorId: 'operator-1' },
      authorizedAt: '2026-07-13T12:18:00.000Z',
      recordedBy: { actorType: 'system', actorId: 'onboarding-controller' },
      recordedAt: '2026-07-13T12:18:00.000Z',
    };
    type ContentAuthorization = Extract<
      BrandContentOnboardingGateEvidence,
      { gate: 'content_authorized' }
    >;
    const authorizationIsHuman: AssertTrue<IsExact<
      ContentAuthorization['authorizedBy']['actorType'],
      'operator' | 'client'
    >> = true;
    const pageApprovalIsHuman: AssertTrue<IsExact<
      MatrixPageApprovalRef['approvedBy']['actorType'],
      'operator' | 'client'
    >> = true;
    expect(pageApprovalEvidence.pageApprovals[0]).toMatchObject({
      cellId: 'cell-1',
      sourceRevision: {
        matrixRevision: 2,
        templateRevision: 3,
        cellRevision: 4,
      },
      postGenerationRevision: 10,
    });
    expect(contentAuthorization.authorizationId).toBe('authorization-1');
    expect(authorizationIsHuman).toBe(true);
    expect(pageApprovalIsHuman).toBe(true);
  });
});
