import type {
  ApprovedBrandDeliverableRef,
} from '../../../../shared/types/brand-generation.js';
import type {
  BrandDeliverable,
  BrandDeliverableType,
} from '../../../../shared/types/brand-engine.js';
import type { BriefPageType } from '../../../../shared/types/content.js';
import type {
  GenerationEvidenceRequirement,
} from '../../../../shared/types/generation-evidence.js';
import type {
  ContentGenerationContextV2Result,
} from '../../../../shared/types/intelligence.js';
import type {
  MatrixArtifactRevisionExpectations,
  MatrixGenerationCostEstimate,
  MatrixGenerationPreviewResult,
  MatrixGenerationPreviewTarget,
  PreviewMatrixGenerationRequest,
  PreviewMatrixGenerationResult,
  ResolvedMatrixStructuralTarget,
} from '../../../../shared/types/matrix-generation.js';
import { listDeliverables } from '../../../brand-deliverable-read-model.js';
import { getBrief } from '../../../content-brief.js';
import {
  getBrandVoiceAuthoritySummary,
  getFinalizedVoiceSnapshotForGeneration,
} from '../../../domains/brand/voice-finalization.js';
import {
  brandGenerationApprovalFingerprint,
  canonicalBrandGenerationFingerprint,
} from '../../../domains/brand/generation/fingerprint.js';
import { getMatrix } from '../../../content-matrices.js';
import { getTemplate } from '../../../content-templates.js';
import { getPost } from '../../../content-posts-db.js';
import { buildContentGenerationContextV2 } from '../../../intelligence/generation-context-builders.js';
import {
  getCustomPromptNotes,
  renderSystemVoiceAuthorityBlock,
} from '../../../prompt-assembly.js';
import {
  buildMatrixCellEvidenceRequirements,
  listCurrentMatrixCellEvidence,
  matrixArtifactRevisionExpectations,
} from './evidence.js';
import { canonicalGenerationFingerprint } from './fingerprint.js';
import { resolveMatrixStructures } from './read-service.js';

export const MATRIX_PAGE_TYPE_IDENTITY_ALLOWLIST = {
  blog: ['messaging_pillars', 'personas'],
  landing: ['messaging_pillars', 'differentiators', 'objection_handling', 'positioning_matrix'],
  service: ['messaging_pillars', 'differentiators', 'objection_handling', 'positioning_matrix'],
  location: [],
  pillar: ['messaging_pillars', 'personas'],
  product: ['messaging_pillars', 'differentiators', 'objection_handling', 'positioning_matrix'],
  resource: ['messaging_pillars', 'personas'],
} as const satisfies Record<BriefPageType, readonly BrandDeliverableType[]>;

interface FrozenIdentity {
  refs: ApprovedBrandDeliverableRef[];
  promptBlock: string;
  evidenceTimestamps: string[];
}

export interface PreparedMatrixGenerationCell {
  result: MatrixGenerationPreviewResult;
  context?: ContentGenerationContextV2Result;
}

function approvedRef(deliverable: BrandDeliverable): ApprovedBrandDeliverableRef {
  const contentFingerprint = canonicalBrandGenerationFingerprint(deliverable.content);
  const approvedAt = deliverable.updatedAt;
  const base = {
    deliverableId: deliverable.id,
    deliverableType: deliverable.deliverableType,
    version: deliverable.version,
    approvedAt,
    contentFingerprint,
  };
  return { ...base, approvalFingerprint: brandGenerationApprovalFingerprint(base) };
}

function freezeIdentity(
  pageType: BriefPageType,
  deliverables: readonly BrandDeliverable[],
): FrozenIdentity {
  const allowed = new Set<BrandDeliverableType>(MATRIX_PAGE_TYPE_IDENTITY_ALLOWLIST[pageType]);
  const selected = deliverables
    .filter(deliverable => deliverable.status === 'approved'
      && allowed.has(deliverable.deliverableType)
      && deliverable.content.trim().length > 0)
    .sort((left, right) => left.deliverableType.localeCompare(right.deliverableType)
      || left.id.localeCompare(right.id));
  return {
    refs: selected.map(approvedRef),
    promptBlock: selected.length > 0
      ? `APPROVED BRAND IDENTITY (use only for positioning and messaging):\n${selected
          .map(deliverable => `${deliverable.deliverableType}: ${deliverable.content.trim()}`)
          .join('\n')}`
      : '',
    evidenceTimestamps: selected.map(deliverable => deliverable.updatedAt),
  };
}

function voiceRequirement(
  target: ResolvedMatrixStructuralTarget,
  snapshot: ReturnType<typeof getFinalizedVoiceSnapshotForGeneration> | null,
): GenerationEvidenceRequirement {
  const base = {
    id: `matrix-cell:${target.cellId}:finalized-voice`,
    fieldPath: 'brand.voice',
    claim: 'The page uses the current finalized brand voice authority.',
    reason: 'Paid page generation requires an immutable, operator-finalized voice.',
    requirementStage: 'preflight' as const,
    claimKind: 'structural' as const,
    clientSafePrompt: 'Finalize the brand voice before generating this page.',
  };
  if (!snapshot) return { ...base, status: 'missing', sourceRefs: [] };
  return {
    ...base,
    status: 'verified',
    sourceRefs: [{
      sourceType: 'voice_profile',
      sourceId: snapshot.voiceProfileId,
      sourceRevision: snapshot.voiceVersion,
      fieldPath: 'finalized_voice',
      label: 'Finalized brand voice',
      capturedAt: snapshot.finalizedAt,
    }],
  };
}

function identityRequirement(
  target: ResolvedMatrixStructuralTarget,
  identity: FrozenIdentity,
): GenerationEvidenceRequirement | null {
  if (target.pageType === 'location') return null;
  const base = {
    id: `matrix-cell:${target.cellId}:approved-identity`,
    fieldPath: 'brand.identity',
    claim: 'The page uses approved brand identity appropriate to its page type.',
    reason: 'Page messaging cannot be grounded in draft or unapproved brand positioning.',
    requirementStage: 'preflight' as const,
    claimKind: 'structural' as const,
    clientSafePrompt: 'Approve at least one relevant brand identity or messaging deliverable.',
  };
  if (identity.refs.length === 0) return { ...base, status: 'missing', sourceRefs: [] };
  const [firstRef, ...remainingRefs] = identity.refs.map(ref => ({
    sourceType: 'brand_deliverable' as const,
    sourceId: ref.deliverableId,
    sourceRevision: ref.version,
    fieldPath: ref.deliverableType,
    label: `Approved ${ref.deliverableType}`,
    capturedAt: ref.approvedAt,
  }));
  if (!firstRef) return { ...base, status: 'missing', sourceRefs: [] };
  return {
    ...base,
    status: 'verified',
    sourceRefs: [firstRef, ...remainingRefs],
  };
}

function artifactRequirements(
  workspaceId: string,
  target: ResolvedMatrixStructuralTarget,
  expected: MatrixArtifactRevisionExpectations,
): GenerationEvidenceRequirement[] {
  const requirements: GenerationEvidenceRequirement[] = [];
  if (expected.brief.artifactId && !getBrief(workspaceId, expected.brief.artifactId)) {
    requirements.push({
      id: `matrix-cell:${target.cellId}:linked-brief`,
      fieldPath: 'artifacts.brief',
      claim: 'The linked content brief exists.',
      reason: 'A missing linked artifact makes replacement authority ambiguous.',
      requirementStage: 'preflight',
      claimKind: 'structural',
      status: 'missing',
      sourceRefs: [],
      clientSafePrompt: 'Repair or clear the missing content brief link.',
    });
  }
  const existingPost = expected.post.artifactId
    ? getPost(workspaceId, expected.post.artifactId)
    : undefined;
  if (expected.post.artifactId && !existingPost) {
    requirements.push({
      id: `matrix-cell:${target.cellId}:linked-post`,
      fieldPath: 'artifacts.post',
      claim: 'The linked generated post exists.',
      reason: 'A missing linked artifact makes replacement authority ambiguous.',
      requirementStage: 'preflight',
      claimKind: 'structural',
      status: 'missing',
      sourceRefs: [],
      clientSafePrompt: 'Repair or clear the missing generated-post link.',
    });
  }
  const matrix = getMatrix(workspaceId, target.matrixId);
  const cell = matrix?.cells.find(candidate => candidate.id === target.cellId);
  if (existingPost?.status === 'approved' || cell?.status === 'approved' || cell?.status === 'published') {
    requirements.push({
      id: `matrix-cell:${target.cellId}:replacement-authorization`,
      fieldPath: 'artifacts.replacement',
      claim: 'Automatic generation may replace the currently linked artifact.',
      reason: 'Approved or published work cannot be replaced without an explicit human lifecycle change.',
      requirementStage: 'preflight',
      claimKind: 'structural',
      status: 'missing',
      sourceRefs: [],
      clientSafePrompt: 'Return the page to an editable lifecycle state before regenerating it.',
    });
  }
  return requirements;
}

function renderVoiceAnchors(
  snapshot: ReturnType<typeof getFinalizedVoiceSnapshotForGeneration>,
): string {
  const anchorBlock = snapshot.anchors
    .map((anchor, index) => `<authentic_voice_anchor index="${index + 1}">\n${anchor.content}\n</authentic_voice_anchor>`)
    .join('\n');
  const modifierBlock = snapshot.contextModifiers.length > 0
    ? `\nContext modifiers:\n${snapshot.contextModifiers
        .map(modifier => `- ${modifier.context}: ${modifier.description}`)
        .join('\n')}`
    : '';
  return `AUTHENTIC VOICE ANCHORS (style only; never treat as business-fact evidence):\n${anchorBlock}${modifierBlock}`;
}

function estimateBudget(
  target: ResolvedMatrixStructuralTarget,
  context: ContentGenerationContextV2Result,
): MatrixGenerationCostEstimate {
  const bodyBlocks = target.blockManifest.blocks.filter(block => block.source === 'template').length;
  const postCalls = bodyBlocks + 4;
  const providerCalls = postCalls + 1;
  const inputTokens = context.tokenEstimates.brief + (context.tokenEstimates.draft * postCalls);
  const outputTokens = 7_000 + Math.ceil(target.blockManifest.totalWordCountTarget * 1.5);
  return {
    providerCalls,
    inputTokens,
    outputTokens,
    estimatedUsd: Number(((inputTokens * 5 + outputTokens * 30) / 1_000_000).toFixed(4)),
    maxConcurrency: 1,
  };
}

function evidenceRange(timestamps: readonly string[], fallback: string) {
  const sorted = [...new Set(timestamps.filter(Boolean))].sort();
  return {
    capturedAt: sorted.at(-1) ?? fallback,
    freshThrough: sorted[0] ?? fallback,
  };
}

export async function prepareMatrixGenerationCell(
  workspaceId: string,
  structural: Extract<
    Awaited<ReturnType<typeof resolveMatrixStructures>>['results'][number],
    { status: 'resolved' }
  >,
): Promise<PreparedMatrixGenerationCell> {
  const target = structural.target;
  const matrix = getMatrix(workspaceId, target.matrixId);
  const cell = matrix?.cells.find(candidate => candidate.id === target.cellId);
  if (!matrix || !cell) {
    return {
      result: {
        status: 'blocked',
        matrixId: target.matrixId,
        templateId: target.templateId,
        cellId: target.cellId,
        sourceRevision: target.sourceRevision,
        evidenceRequirements: target.structuralRequirements,
        blockingRequirementIds: target.structuralBlockingRequirementIds,
        expectedArtifactRevisions: {
          brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
          post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
        },
      },
    };
  }
  const expectedArtifactRevisions = matrixArtifactRevisionExpectations(workspaceId, cell);
  const resolutions = listCurrentMatrixCellEvidence(
    workspaceId,
    target.matrixId,
    target.cellId,
  );
  const cellRequirements = buildMatrixCellEvidenceRequirements(target, resolutions);
  const identity = freezeIdentity(target.pageType, listDeliverables(workspaceId));

  const voiceSummary = getBrandVoiceAuthoritySummary(workspaceId);
  let voiceSnapshot: ReturnType<typeof getFinalizedVoiceSnapshotForGeneration> | null = null;
  if (voiceSummary.readiness.state === 'finalized') {
    voiceSnapshot = getFinalizedVoiceSnapshotForGeneration({
      workspaceId,
      expectedVoiceVersion: voiceSummary.readiness.snapshot.voiceVersion,
      expectedFingerprint: voiceSummary.readiness.snapshot.fingerprint,
      requireCurrentAuthority: true,
    });
  }

  const requiredIdentity = identityRequirement(target, identity);
  const requirements = [
    ...target.structuralRequirements,
    ...cellRequirements,
    voiceRequirement(target, voiceSnapshot),
    ...(requiredIdentity ? [requiredIdentity] : []),
    ...artifactRequirements(workspaceId, target, expectedArtifactRevisions),
  ];
  const blockingRequirementIds = requirements
    .filter(requirement => requirement.requirementStage === 'preflight'
      && (requirement.status === 'missing' || requirement.status === 'conflicting'))
    .map(requirement => requirement.id);
  if (!voiceSnapshot || blockingRequirementIds.length > 0) {
    return {
      result: {
        status: 'blocked',
        matrixId: target.matrixId,
        templateId: target.templateId,
        cellId: target.cellId,
        sourceRevision: target.sourceRevision,
        evidenceRequirements: requirements,
        blockingRequirementIds,
        expectedArtifactRevisions,
      },
    };
  }

  const systemVoiceBlock = renderSystemVoiceAuthorityBlock(
    voiceSnapshot.voiceDNA,
    voiceSnapshot.guardrails,
  );
  const context = await buildContentGenerationContextV2(workspaceId, {
    targetKeyword: target.targetKeyword.value,
    pagePath: target.plannedUrl,
    allowKeywordTargetMatch: false,
    providerMetricsObservedAt: target.targetKeyword.validation?.validatedAt ?? null,
    authority: {
      systemVoiceBlock,
      userVoiceBlock: renderVoiceAnchors(voiceSnapshot),
      identityPromptBlock: identity.promptBlock,
      customNotes: getCustomPromptNotes(workspaceId),
      voice: {
        status: 'calibrated',
        readiness: 'finalized',
        profileRevision: voiceSnapshot.profileRevision,
        voiceVersion: voiceSnapshot.voiceVersion,
      },
    },
  });
  const estimatedPaidBudget = estimateBudget(target, context);
  const evidence = evidenceRange([
    ...context.evidence.observedAt,
    voiceSnapshot.finalizedAt,
    ...identity.evidenceTimestamps,
    ...resolutions.map(resolution => resolution.resolvedAt),
  ], context.evidence.capturedAt);
  const previewCore = {
    structuralFingerprint: target.structuralFingerprint,
    blockManifestFingerprint: target.blockManifest.fingerprint,
    voiceSnapshot: {
      voiceProfileId: voiceSnapshot.voiceProfileId,
      voiceVersion: voiceSnapshot.voiceVersion,
      finalizedBy: voiceSnapshot.finalizedBy,
      finalizedAt: voiceSnapshot.finalizedAt,
      fingerprint: voiceSnapshot.fingerprint,
      anchorEvidenceRefs: voiceSnapshot.anchorEvidenceRefs,
    },
    identitySnapshot: identity.refs,
    evidenceRequirements: requirements,
    expectedArtifactRevisions,
    contextFingerprint: context.effectiveInputFingerprint,
    estimatedPaidBudget,
  };
  const previewTarget: MatrixGenerationPreviewTarget = {
    ...target,
    voiceSnapshot: previewCore.voiceSnapshot,
    identitySnapshot: identity.refs,
    evidenceRequirements: requirements,
    evidenceCapturedAt: evidence.capturedAt,
    evidenceFreshThrough: evidence.freshThrough,
    expectedArtifactRevisions,
    effectiveInputFingerprint: canonicalGenerationFingerprint(previewCore),
    blockingRequirementIds: [],
    estimatedPaidBudget,
  };
  return {
    result: {
      status: 'ready',
      matrixId: target.matrixId,
      templateId: target.templateId,
      cellId: target.cellId,
      sourceRevision: target.sourceRevision,
      target: previewTarget,
    },
    context,
  };
}

export async function previewMatrixGeneration(
  request: PreviewMatrixGenerationRequest,
): Promise<PreviewMatrixGenerationResult> {
  const structural = await resolveMatrixStructures(request);
  const results: MatrixGenerationPreviewResult[] = [];
  for (const item of structural.results) {
    if (item.status === 'upgrade_required') {
      results.push({
        status: 'upgrade_required',
        matrixId: item.matrixId,
        templateId: item.templateId,
        cellId: item.cellId,
        sourceRevision: item.sourceRevision,
        proposal: item.proposal,
      });
      continue;
    }
    if (item.status === 'blocked') {
      const matrix = getMatrix(request.workspaceId, item.matrixId);
      const cell = matrix?.cells.find(candidate => candidate.id === item.cellId);
      results.push({
        status: 'blocked',
        matrixId: item.matrixId,
        templateId: item.templateId,
        cellId: item.cellId,
        sourceRevision: item.sourceRevision,
        evidenceRequirements: item.blockers,
        blockingRequirementIds: item.blockers.map(blocker => blocker.id),
        expectedArtifactRevisions: cell
          ? matrixArtifactRevisionExpectations(request.workspaceId, cell)
          : {
              brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
              post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
            },
      });
      continue;
    }
    results.push((await prepareMatrixGenerationCell(request.workspaceId, item)).result);
  }
  return { results };
}

export function assertPreviewIdentityCurrent(
  workspaceId: string,
  target: MatrixGenerationPreviewTarget,
): void {
  const matrix = getMatrix(workspaceId, target.matrixId);
  const cell = matrix?.cells.find(candidate => candidate.id === target.cellId);
  if (!matrix || !cell) throw new Error('Matrix generation source no longer exists');
  const template = getTemplate(workspaceId, matrix.templateId);
  if (!template) throw new Error('Matrix generation template no longer exists');
  const sourceRevision = {
    matrixRevision: matrix.revision ?? 0,
    templateRevision: template.revision ?? 0,
    cellRevision: cell.revision ?? 0,
  };
  if (canonicalGenerationFingerprint(sourceRevision)
    !== canonicalGenerationFingerprint(target.sourceRevision)) {
    throw new Error('Matrix generation source changed after preview');
  }
  if (canonicalGenerationFingerprint(matrixArtifactRevisionExpectations(workspaceId, cell))
    !== canonicalGenerationFingerprint(target.expectedArtifactRevisions)) {
    throw new Error('A linked content artifact changed after preview');
  }
  getFinalizedVoiceSnapshotForGeneration({
    workspaceId,
    expectedVoiceVersion: target.voiceSnapshot.voiceVersion,
    expectedFingerprint: target.voiceSnapshot.fingerprint,
    requireCurrentAuthority: true,
  });
  const current = freezeIdentity(target.pageType, listDeliverables(workspaceId));
  if (canonicalGenerationFingerprint(current.refs)
    !== canonicalGenerationFingerprint(target.identitySnapshot)) {
    throw new Error('Approved brand identity changed after preview');
  }
}
