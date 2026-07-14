import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  BrandIntakeEvidenceResolution,
  BrandIntakeFieldEvidence,
  BrandIntakeFieldPath,
  BrandIntakePayload,
  BrandIntakeRevision,
  BrandIntakeSubmissionRequest,
  BrandIntakeSubmissionResult,
  BrandIntakeWorkspaceUpdatedMetadata,
  GetBrandIntakeRequest,
  GetBrandIntakeResult,
  ResolveBrandIntakeEvidenceRequest,
  ResolveBrandIntakeEvidenceResult,
} from '../../../../shared/types/brand-intake.js';
import {
  BRAND_INTAKE_FIELD_PATHS,
  BRAND_INTAKE_FIELD_POLICY,
  BRAND_INTAKE_LIMITS,
  BRAND_INTAKE_SOURCE_ACTOR_POLICY,
  BRAND_INTAKE_WORKSPACE_EVENT_ACTION,
  BRAND_INTAKE_WORKSPACE_EVENT_DOMAIN,
  brandIntakeEvidenceRequirementId,
} from '../../../../shared/types/brand-intake.js';
import {
  brandIntakeEvidenceValueSchema,
  brandIntakePayloadSchema,
  brandIntakeResolutionSourceRefSchema,
  brandIntakeResolverAttributionSchema,
  brandIntakeSourceSchema,
  brandIntakeSubmitterSchema,
} from '../../../../shared/types/brand-intake-schemas.js';
import type { GenerationFactualEvidenceSourceRef } from '../../../../shared/types/generation-evidence.js';
import db from '../../../db/index.js';
import { getWorkspace } from '../../../workspaces.js';
import {
  buildBrandIntakeCompatibilityProjectionState,
  materializeBrandIntakePayload,
  materializeBrandIntakePayloadFrom,
  projectBrandIntakeCompatibility,
} from './projection.js';
import {
  computeBrandIntakeFingerprint,
  computeBrandIntakeRevisionFingerprint,
  getCurrentStoredBrandIntakeRevision,
  getStoredBrandIntakeRevisionById,
  getStoredBrandIntakeRevisionByIdempotencyKey,
  insertStoredBrandIntakeRevision,
  type StoredBrandIntakeRevision,
} from './repository.js';

const submissionRequestSchema = z.object({
  workspaceId: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  payload: brandIntakePayloadSchema,
  source: brandIntakeSourceSchema,
  submitter: brandIntakeSubmitterSchema,
}).strict().superRefine((value, ctx) => {
  const expectedActorType = BRAND_INTAKE_SOURCE_ACTOR_POLICY[value.source];
  if (value.submitter.actorType !== expectedActorType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['submitter', 'actorType'],
      message: `${value.source} submissions require actorType ${expectedActorType}`,
    });
  }
});

const evidenceResolutionRequestSchema = z.object({
  workspaceId: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  intakeRevisionId: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  requirementId: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  fieldPath: z.enum(BRAND_INTAKE_FIELD_PATHS),
  value: brandIntakeEvidenceValueSchema,
  sourceRef: brandIntakeResolutionSourceRefSchema,
  resolvedBy: brandIntakeResolverAttributionSchema,
  idempotencyKey: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdempotencyKeyLength),
}).strict().superRefine((value, ctx) => {
  if (value.requirementId !== brandIntakeEvidenceRequirementId(value.fieldPath)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['requirementId'],
      message: `requirementId must address ${value.fieldPath}`,
    });
  }
});

const getRequestSchema = z.object({
  workspaceId: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength),
  intakeRevisionId: z.string().trim().min(1).max(BRAND_INTAKE_LIMITS.maxIdLength).optional(),
}).strict();

export interface BrandIntakePostCommitEffect {
  workspaceUpdated: BrandIntakeWorkspaceUpdatedMetadata;
  activity: {
    type: 'client_onboarding_submitted' | 'brand_intake_submitted' | 'brand_intake_evidence_resolved';
    title: string;
    description: string;
  };
}

export interface BrandIntakeSubmissionServiceResult extends BrandIntakeSubmissionResult {
  postCommitEffect: BrandIntakePostCommitEffect | null;
}

export interface ResolveBrandIntakeEvidenceServiceResult extends ResolveBrandIntakeEvidenceResult {
  postCommitEffect: BrandIntakePostCommitEffect | null;
}

export class BrandIntakeConflictError extends Error {
  readonly code = 'brand_intake_revision_conflict';
  readonly workspaceId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number | null;

  constructor(workspaceId: string, expectedRevision: number, actualRevision: number | null) {
    super(`Brand intake revision conflict for workspace ${workspaceId}`);
    this.name = 'BrandIntakeConflictError';
    this.workspaceId = workspaceId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class BrandIntakeIdempotencyConflictError extends Error {
  readonly code = 'brand_intake_idempotency_conflict';
  readonly workspaceId: string;
  readonly idempotencyKey: string;

  constructor(workspaceId: string, idempotencyKey: string) {
    super(`Brand intake idempotency key already represents another mutation in workspace ${workspaceId}`);
    this.name = 'BrandIntakeIdempotencyConflictError';
    this.workspaceId = workspaceId;
    this.idempotencyKey = idempotencyKey;
  }
}

export class BrandIntakeNotFoundError extends Error {
  readonly code = 'brand_intake_revision_not_found';
  readonly workspaceId: string;
  readonly intakeRevisionId: string;

  constructor(workspaceId: string, intakeRevisionId: string) {
    super('Brand intake revision not found');
    this.name = 'BrandIntakeNotFoundError';
    this.workspaceId = workspaceId;
    this.intakeRevisionId = intakeRevisionId;
  }
}

function postCommitEffectFor(
  revision: BrandIntakeRevision,
): BrandIntakePostCommitEffect {
  const isClientSubmission = revision.mutationKind === 'submission'
    && revision.source === 'client_portal'
    && revision.submitter.actorType === 'client';
  return {
    workspaceUpdated: {
      domain: BRAND_INTAKE_WORKSPACE_EVENT_DOMAIN,
      action: BRAND_INTAKE_WORKSPACE_EVENT_ACTION,
      cause: revision.mutationKind,
      intakeRevisionId: revision.id,
      revision: revision.revision,
    },
    activity: isClientSubmission
      ? {
          type: 'client_onboarding_submitted',
          title: 'Client completed onboarding questionnaire',
          description: 'Via client portal',
        }
      : {
          type: revision.mutationKind === 'evidence_resolution'
            ? 'brand_intake_evidence_resolved'
            : 'brand_intake_submitted',
          title: revision.mutationKind === 'evidence_resolution'
            ? 'Resolved brand intake evidence'
            : 'Updated brand intake',
          description: `Brand intake revision ${revision.revision}`,
        },
  };
}

function valueIsPresent(payload: BrandIntakePayload, fieldPath: BrandIntakeFieldPath): boolean {
  switch (fieldPath) {
    case 'business.businessName': return payload.business.businessName.length > 0;
    case 'business.industry': return payload.business.industry.length > 0;
    case 'business.description': return payload.business.description.length > 0;
    case 'business.services': return payload.business.services.length > 0;
    case 'business.locations': return payload.business.locations.length > 0;
    case 'business.differentiators': return payload.business.differentiators.length > 0;
    case 'business.website': return payload.business.website.length > 0;
    case 'audience.primaryAudience': return payload.audience.primaryAudience.length > 0;
    case 'audience.painPoints': return payload.audience.painPoints.length > 0;
    case 'audience.goals': return payload.audience.goals.length > 0;
    case 'audience.objections': return payload.audience.objections.length > 0;
    case 'audience.buyingStage': return payload.audience.buyingStage !== '';
    case 'audience.secondaryAudience': return payload.audience.secondaryAudience.length > 0;
    case 'brand.tone': return payload.brand.tone.length > 0;
    case 'brand.personality': return payload.brand.personality.length > 0;
    case 'brand.avoidWords': return payload.brand.avoidWords.length > 0;
    case 'brand.contentFormats': return payload.brand.contentFormats.length > 0;
    case 'brand.existingExamples': return payload.brand.existingExamples.length > 0;
    case 'competitors.competitors': return payload.competitors.competitors.length > 0;
    case 'competitors.whatTheyDoBetter': return payload.competitors.whatTheyDoBetter.length > 0;
    case 'competitors.whatYouDoBetter': return payload.competitors.whatYouDoBetter.length > 0;
    case 'competitors.referenceUrls': return payload.competitors.referenceUrls.length > 0;
  }
}

function buildFieldEvidence(revision: BrandIntakeRevision): BrandIntakeFieldEvidence[] {
  const effectivePayload = materializeBrandIntakePayload(revision);
  const resolutions = new Map(revision.evidenceResolutions.map(item => [item.fieldPath, item]));
  return BRAND_INTAKE_FIELD_PATHS.map(fieldPath => {
    const resolution = resolutions.get(fieldPath) ?? null;
    const submitted = valueIsPresent(effectivePayload, fieldPath);
    const submittedSourceRef: GenerationFactualEvidenceSourceRef = {
      sourceType: 'brand_intake',
      sourceId: revision.id,
      sourceRevision: revision.revision,
      fieldPath,
      capturedAt: revision.createdAt,
    };
    return {
      requirementId: brandIntakeEvidenceRequirementId(fieldPath),
      fieldPath,
      availability: resolution ? 'resolved' : submitted ? 'submitted' : 'missing',
      sourceRefs: resolution
        ? [resolution.sourceRef]
        : submitted
          ? [submittedSourceRef]
          : [],
      resolution,
    };
  });
}

function assertResolutionValueMatchesField(
  fieldPath: BrandIntakeFieldPath,
  value: ResolveBrandIntakeEvidenceRequest['value'],
): void {
  const expectedKind = BRAND_INTAKE_FIELD_POLICY[fieldPath].valueKind;
  if (value.kind !== expectedKind) {
    throw new Error(`Evidence value kind ${value.kind} does not match ${fieldPath}`);
  }
  if ((value.kind === 'text_list' || value.kind === 'url_list') && value.value.length === 0) {
    throw new Error(`Evidence value for ${fieldPath} must contain at least one item`);
  }
}

function requireInsertedRevision(workspaceId: string, revisionId: string): BrandIntakeRevision {
  const stored = getStoredBrandIntakeRevisionById(workspaceId, revisionId);
  if (!stored) throw new Error('Brand intake revision insert did not persist');
  return stored.revision;
}

function projectionStateFor(
  workspaceId: string,
  payload: BrandIntakePayload,
  evidenceResolutions: BrandIntakeEvidenceResolution[],
  previous: StoredBrandIntakeRevision | null,
) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const effectivePayload = materializeBrandIntakePayloadFrom(payload, evidenceResolutions);
  return buildBrandIntakeCompatibilityProjectionState({
    currentWorkspaceDomains: workspace.competitorDomains ?? [],
    previousProjectionState: previous?.projectionState ?? null,
    effectivePayload,
    clientDomain: workspace.liveDomain || effectivePayload.business.website,
  });
}

/** Persist a normalized intake and update compatibility columns in one IMMEDIATE transaction. */
export function submitBrandIntake(
  request: BrandIntakeSubmissionRequest,
): BrandIntakeSubmissionServiceResult {
  const parsed = submissionRequestSchema.parse(request);
  const targetRevisionFingerprint = computeBrandIntakeRevisionFingerprint(parsed.payload, []);

  const transaction = db.transaction((): BrandIntakeSubmissionServiceResult => {
    const current = getCurrentStoredBrandIntakeRevision(parsed.workspaceId);
    const sameSubmissionProvenance = current?.revision.mutationKind === 'submission'
      && current.revision.source === parsed.source
      && current.revision.submitter.actorType === parsed.submitter.actorType
      && current.revision.submitter.actorId === parsed.submitter.actorId;
    if (
      current
      && current.revision.fingerprint === targetRevisionFingerprint
      && sameSubmissionProvenance
    ) {
      return {
        revision: current.revision,
        created: false,
        projectionChanged: false,
        postCommitEffect: null,
      };
    }

    const id = `intake_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const projectionState = projectionStateFor(parsed.workspaceId, parsed.payload, [], current);
    insertStoredBrandIntakeRevision({
      id,
      workspaceId: parsed.workspaceId,
      revision: (current?.revision.revision ?? 0) + 1,
      payload: parsed.payload,
      evidenceResolutions: [],
      projectionState,
      fingerprint: targetRevisionFingerprint,
      source: parsed.source,
      submitter: parsed.submitter,
      mutationKind: 'submission',
      mutationFingerprint: computeBrandIntakeFingerprint(parsed.payload),
      idempotencyKey: null,
      supersedesRevisionId: current?.revision.id ?? null,
      createdAt,
    });
    const revision = requireInsertedRevision(parsed.workspaceId, id);
    const projectionChanged = projectBrandIntakeCompatibility({
      workspaceId: parsed.workspaceId,
      revision,
      projectionState,
    });
    return {
      revision,
      created: true,
      projectionChanged,
      postCommitEffect: postCommitEffectFor(revision),
    };
  });

  return transaction.immediate();
}

export function getBrandIntakeRevision(request: GetBrandIntakeRequest): GetBrandIntakeResult {
  const parsed = getRequestSchema.parse(request);
  const stored = parsed.intakeRevisionId
    ? getStoredBrandIntakeRevisionById(parsed.workspaceId, parsed.intakeRevisionId)
    : getCurrentStoredBrandIntakeRevision(parsed.workspaceId);
  if (!stored) return { revision: null, fieldEvidence: [] };
  return {
    revision: stored.revision,
    fieldEvidence: buildFieldEvidence(stored.revision),
  };
}

function resolutionMutationFingerprint(
  request: z.output<typeof evidenceResolutionRequestSchema>,
): string {
  return computeBrandIntakeFingerprint({
    mutationKind: 'evidence_resolution',
    intakeRevisionId: request.intakeRevisionId,
    expectedRevision: request.expectedRevision,
    requirementId: request.requirementId,
    fieldPath: request.fieldPath,
    value: request.value,
    sourceRef: request.sourceRef,
    resolvedBy: request.resolvedBy,
  });
}

function replayOrConflict(
  request: z.output<typeof evidenceResolutionRequestSchema>,
  mutationFingerprint: string,
): StoredBrandIntakeRevision | null {
  const replay = getStoredBrandIntakeRevisionByIdempotencyKey(
    request.workspaceId,
    request.idempotencyKey,
  );
  if (!replay) return null;
  if (replay.mutationFingerprint !== mutationFingerprint) {
    throw new BrandIntakeIdempotencyConflictError(
      request.workspaceId,
      request.idempotencyKey,
    );
  }
  return replay;
}

/** Create a version-safe immutable successor for a structured evidence resolution. */
export function resolveBrandIntakeEvidence(
  request: ResolveBrandIntakeEvidenceRequest,
): ResolveBrandIntakeEvidenceServiceResult {
  const parsed = evidenceResolutionRequestSchema.parse(request);
  assertResolutionValueMatchesField(parsed.fieldPath, parsed.value);
  const mutationFingerprint = resolutionMutationFingerprint(parsed);

  const transaction = db.transaction((): ResolveBrandIntakeEvidenceServiceResult => {
    const replay = replayOrConflict(parsed, mutationFingerprint);
    if (replay) {
      return {
        revision: replay.revision,
        created: false,
        replayed: true,
        postCommitEffect: null,
      };
    }

    const current = getCurrentStoredBrandIntakeRevision(parsed.workspaceId);
    const requested = getStoredBrandIntakeRevisionById(
      parsed.workspaceId,
      parsed.intakeRevisionId,
    );
    if (!requested) {
      throw new BrandIntakeNotFoundError(parsed.workspaceId, parsed.intakeRevisionId);
    }
    if (
      !current
      || current.revision.id !== parsed.intakeRevisionId
      || current.revision.revision !== parsed.expectedRevision
    ) {
      throw new BrandIntakeConflictError(
        parsed.workspaceId,
        parsed.expectedRevision,
        current?.revision.revision ?? null,
      );
    }

    const createdAt = new Date().toISOString();
    const evidenceResolution: BrandIntakeEvidenceResolution = {
      id: `intake_resolution_${randomUUID()}`,
      requirementId: brandIntakeEvidenceRequirementId(parsed.fieldPath),
      fieldPath: parsed.fieldPath,
      value: parsed.value,
      sourceRef: parsed.sourceRef,
      resolvedBy: parsed.resolvedBy,
      expectedSourceRevision: parsed.expectedRevision,
      expectedArtifactRevisions: [],
      resolvedAt: createdAt,
    };
    const evidenceResolutions = [
      ...current.revision.evidenceResolutions.filter(
        existing => existing.fieldPath !== parsed.fieldPath,
      ),
      evidenceResolution,
    ].sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));

    const id = `intake_${randomUUID()}`;
    const projectionState = projectionStateFor(
      parsed.workspaceId,
      current.revision.payload,
      evidenceResolutions,
      current,
    );
    insertStoredBrandIntakeRevision({
      id,
      workspaceId: parsed.workspaceId,
      revision: current.revision.revision + 1,
      payload: current.revision.payload,
      evidenceResolutions,
      projectionState,
      fingerprint: computeBrandIntakeRevisionFingerprint(
        current.revision.payload,
        evidenceResolutions,
      ),
      source: parsed.resolvedBy.actorType === 'mcp'
        ? 'mcp'
        : parsed.resolvedBy.actorType === 'client'
          ? 'client_portal'
          : 'admin',
      submitter: {
        actorType: parsed.resolvedBy.actorType,
        actorId: parsed.resolvedBy.actorId,
        ...(parsed.resolvedBy.actorLabel ? { actorLabel: parsed.resolvedBy.actorLabel } : {}),
      },
      mutationKind: 'evidence_resolution',
      mutationFingerprint,
      idempotencyKey: parsed.idempotencyKey,
      supersedesRevisionId: current.revision.id,
      createdAt,
    });
    const revision = requireInsertedRevision(parsed.workspaceId, id);
    projectBrandIntakeCompatibility({
      workspaceId: parsed.workspaceId,
      revision,
      projectionState,
    });
    return {
      revision,
      created: true,
      replayed: false,
      postCommitEffect: postCommitEffectFor(revision),
    };
  });

  return transaction.immediate();
}
