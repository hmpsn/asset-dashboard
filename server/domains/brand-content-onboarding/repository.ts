import { randomUUID } from 'node:crypto';

import {
  BRAND_CONTENT_ONBOARDING_GATES,
  BRAND_CONTENT_ONBOARDING_STATUSES,
  type BrandContentOnboardingChildren,
  type BrandContentOnboardingGate,
  type BrandContentOnboardingGateEvidence,
  type BrandContentOnboardingResumeStatus,
  type BrandContentOnboardingRun,
  type BrandContentOnboardingStatus,
  type MatrixPageApprovalRef,
} from '../../../shared/types/brand-content-onboarding.js';
import { BRAND_DELIVERABLE_TYPES } from '../../../shared/types/brand-engine.js';
import type { BrandGenerationBudgetRequest } from '../../../shared/types/brand-generation.js';
import type { BrandIntakeRevisionRef } from '../../../shared/types/brand-intake.js';
import type { MatrixGenerationInputSelection } from '../../../shared/types/matrix-generation.js';
import type { GenerationResolverAttribution } from '../../../shared/types/generation-evidence.js';
import { finalizedVoiceSnapshotRefSchema } from '../../../shared/types/voice-finalization-schemas.js';
import db from '../../db/index.js';
import { parseJsonSafe, parseJsonSafeArray } from '../../db/json-validation.js';
import { createStmtCache } from '../../db/stmt-cache.js';
import { canonicalGenerationFingerprint } from '../../generation-provenance.js';
import { z } from '../../middleware/validate.js';
import {
  BRAND_CONTENT_ONBOARDING_TRANSITIONS,
  validateTransition,
} from '../../state-machines.js';

const idSchema = z.string().trim().min(1).max(128);
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
const timestampSchema = z.string().datetime();
const statusSchema = z.enum(BRAND_CONTENT_ONBOARDING_STATUSES);
const gateSchema = z.enum(BRAND_CONTENT_ONBOARDING_GATES);
const resumeStatusSchema = z.enum([
  'brand_generating',
  'awaiting_voice_review',
  'awaiting_voice_finalization',
  'brand_generating_dependents',
  'awaiting_operator_review',
  'awaiting_client_review',
  'awaiting_content_authorization',
  'content_generating',
  'awaiting_content_review',
]);

const resolverSchema = z.object({
  actorType: z.enum(['operator', 'client', 'mcp', 'system']),
  actorId: idSchema,
  actorLabel: z.string().trim().min(1).max(200).optional(),
}).strict();
const humanReviewerSchema = resolverSchema.extend({
  actorType: z.enum(['operator', 'client']),
}).strict();
const intakeRevisionSchema = z.object({
  intakeRevisionId: idSchema,
  revision: z.number().int().positive(),
  fingerprint: fingerprintSchema,
}).strict();
const sourceRevisionSchema = z.object({
  matrixRevision: z.number().int().nonnegative(),
  templateRevision: z.number().int().nonnegative(),
  cellRevision: z.number().int().nonnegative(),
}).strict();
const matrixSelectionItemSchema = z.object({
  matrixId: idSchema,
  cellId: idSchema,
  sourceRevision: sourceRevisionSchema,
  structuralFingerprint: fingerprintSchema,
  previewFingerprint: fingerprintSchema.nullable(),
}).strict();
const approvedIdentitySchema = z.object({
  deliverableId: idSchema,
  deliverableType: z.enum(BRAND_DELIVERABLE_TYPES),
  version: z.number().int().positive(),
  approvedAt: timestampSchema,
  contentFingerprint: fingerprintSchema,
  approvalFingerprint: fingerprintSchema,
}).strict();
const pageApprovalSchema = z.object({
  approvalId: idSchema,
  matrixRunId: idSchema,
  matrixRunRevision: z.number().int().nonnegative(),
  matrixItemId: idSchema,
  matrixItemRevision: z.number().int().nonnegative(),
  matrixId: idSchema,
  cellId: idSchema,
  sourceRevision: sourceRevisionSchema,
  postId: idSchema,
  postGenerationRevision: z.number().int().nonnegative(),
  approvedBy: humanReviewerSchema,
  approvedAt: timestampSchema,
}).strict();
const childrenSchema = z.object({
  brandRunId: idSchema.nullable(),
  voiceReviewDeliverableId: idSchema.nullable(),
  brandReviewDeliverableId: idSchema.nullable(),
  matrixRunId: idSchema.nullable(),
  pageApprovals: z.array(pageApprovalSchema),
}).strict();

const evidenceBase = {
  id: idSchema,
  recordedBy: resolverSchema,
  recordedAt: timestampSchema,
};
const gateEvidenceSchema = z.discriminatedUnion('gate', [
  z.object({ ...evidenceBase, gate: z.literal('intake_accepted'), intakeRevision: intakeRevisionSchema }).strict(),
  z.object({
    ...evidenceBase,
    gate: z.literal('voice_reviewed'),
    brandRunId: idSchema,
    foundationItemId: idSchema,
    foundationItemRevision: z.number().int().nonnegative(),
    reviewDeliverableId: idSchema,
  }).strict(),
  z.object({ ...evidenceBase, gate: z.literal('voice_finalized'), voice: finalizedVoiceSnapshotRefSchema }).strict(),
  z.object({
    ...evidenceBase,
    gate: z.literal('operator_brand_reviewed'),
    brandRunId: idSchema,
    brandRunRevision: z.number().int().nonnegative(),
    reviewDeliverableId: idSchema,
    reviewedItemIds: z.array(idSchema).min(1),
  }).strict(),
  z.object({
    ...evidenceBase,
    gate: z.literal('client_brand_reviewed'),
    brandRunId: idSchema,
    brandRunRevision: z.number().int().nonnegative(),
    reviewDeliverableId: idSchema,
    approvedItemIds: z.array(idSchema).min(1),
  }).strict(),
  z.object({
    ...evidenceBase,
    gate: z.literal('content_authorized'),
    authorizationId: idSchema,
    matrixSelectionFingerprint: fingerprintSchema,
    authorizedCellIds: z.array(idSchema).min(1),
    authorizedBy: humanReviewerSchema,
    authorizedAt: timestampSchema,
  }).strict(),
  z.object({
    ...evidenceBase,
    gate: z.literal('all_pages_approved'),
    pageApprovals: z.array(pageApprovalSchema).min(1),
  }).strict(),
  z.object({
    ...evidenceBase,
    gate: z.literal('publish_preconditions_passed'),
    pageApprovalsFingerprint: fingerprintSchema,
    preconditionCheckIds: z.array(idSchema).min(1),
    checkedAt: timestampSchema,
  }).strict(),
]);

interface BrandContentOnboardingRow {
  id: string;
  workspace_id: string;
  intake_revision_id: string;
  intake_revision: number;
  intake_fingerprint: string;
  status: string;
  revision: number;
  idempotency_key: string;
  input_fingerprint: string;
  matrix_selection_json: string;
  finalized_voice_json: string | null;
  approved_identity_json: string;
  children_json: string;
  current_gate: string | null;
  gate_evidence_json: string;
  attention_resume_status: string | null;
  created_by_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface BrandContentOnboardingCommandRow {
  run_id: string;
  workspace_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  result_revision: number;
  result_status: string;
  paid_job_id: string | null;
  created_at: string;
}

const EMPTY_CHILDREN: BrandContentOnboardingChildren = {
  brandRunId: null,
  voiceReviewDeliverableId: null,
  brandReviewDeliverableId: null,
  matrixRunId: null,
  pageApprovals: [],
};

export class BrandContentOnboardingNotFoundError extends Error {
  readonly code = 'brand_content_onboarding_not_found';
  constructor() {
    super('Brand content onboarding run not found');
    this.name = 'BrandContentOnboardingNotFoundError';
  }
}

export class BrandContentOnboardingIdempotencyConflictError extends Error {
  readonly code = 'brand_content_onboarding_idempotency_conflict';
  constructor() {
    super('Brand content onboarding idempotency key already represents different inputs');
    this.name = 'BrandContentOnboardingIdempotencyConflictError';
  }
}

export class BrandContentOnboardingResumeIdempotencyConflictError extends Error {
  readonly code = 'brand_content_onboarding_resume_idempotency_conflict';
  constructor() {
    super('Brand content onboarding resume key already represents a different request');
    this.name = 'BrandContentOnboardingResumeIdempotencyConflictError';
  }
}

export class BrandContentOnboardingRevisionConflictError extends Error {
  readonly code = 'brand_content_onboarding_revision_conflict';
  readonly expectedRevision: number;
  readonly actualRevision: number | null;
  constructor(expectedRevision: number, actualRevision: number | null) {
    super('Brand content onboarding revision changed');
    this.name = 'BrandContentOnboardingRevisionConflictError';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class BrandContentOnboardingPersistenceContractError extends Error {
  readonly code = 'brand_content_onboarding_persistence_contract';
  constructor(message: string) {
    super(message);
    this.name = 'BrandContentOnboardingPersistenceContractError';
  }
}

function storedContract(message: string): never {
  throw new BrandContentOnboardingPersistenceContractError(message);
}

function rowToRun(row: BrandContentOnboardingRow): BrandContentOnboardingRun {
  const context = { workspaceId: row.workspace_id, table: 'brand_content_onboarding_runs' };
  const status = statusSchema.safeParse(row.status);
  const currentGate = row.current_gate === null ? null : gateSchema.safeParse(row.current_gate);
  const attentionStatus = row.attention_resume_status === null
    ? null
    : resumeStatusSchema.safeParse(row.attention_resume_status);
  if (!status.success || (currentGate !== null && !currentGate.success)
    || (attentionStatus !== null && !attentionStatus.success)) {
    return storedContract('Stored onboarding lifecycle value is invalid');
  }

  const matrixSelectionItems = parseJsonSafeArray(
    row.matrix_selection_json,
    matrixSelectionItemSchema,
    { ...context, field: 'matrix_selection_json' },
  );
  if (matrixSelectionItems.length === 0) {
    return storedContract('Stored onboarding matrix selection is invalid');
  }
  const finalizedVoice = parseJsonSafe(
    row.finalized_voice_json,
    finalizedVoiceSnapshotRefSchema,
    null,
    { ...context, field: 'finalized_voice_json' },
  );
  const approvedIdentity = parseJsonSafeArray(
    row.approved_identity_json,
    approvedIdentitySchema,
    { ...context, field: 'approved_identity_json' },
  );
  const children = parseJsonSafe(
    row.children_json,
    childrenSchema,
    null,
    { ...context, field: 'children_json' },
  );
  const gateEvidence = parseJsonSafeArray(
    row.gate_evidence_json,
    gateEvidenceSchema,
    { ...context, field: 'gate_evidence_json' },
  );
  const createdBy = parseJsonSafe(
    row.created_by_json,
    resolverSchema,
    null,
    { ...context, field: 'created_by_json' },
  );
  if (!children || !createdBy) {
    return storedContract('Stored onboarding JSON contract is invalid');
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    status: status.data,
    revision: row.revision,
    idempotencyKey: row.idempotency_key,
    inputs: {
      intakeRevision: {
        intakeRevisionId: row.intake_revision_id,
        revision: row.intake_revision,
        fingerprint: row.intake_fingerprint,
      },
      matrixSelection: matrixSelectionItems as unknown as MatrixGenerationInputSelection,
    },
    finalizedVoice: finalizedVoice as BrandContentOnboardingRun['finalizedVoice'],
    approvedIdentity,
    children: children as BrandContentOnboardingChildren,
    currentGate: currentGate === null ? null : currentGate.data,
    gateEvidence: gateEvidence as BrandContentOnboardingGateEvidence[],
    attentionResumeStatus: attentionStatus === null ? null : attentionStatus.data,
    createdBy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

const stmts = createStmtCache(() => ({
  selectById: db.prepare(`
    SELECT * FROM brand_content_onboarding_runs
    WHERE id = ? AND workspace_id = ?
  `),
  selectByIdempotency: db.prepare(`
    SELECT * FROM brand_content_onboarding_runs
    WHERE workspace_id = ? AND intake_revision_id = ? AND idempotency_key = ?
  `),
  selectCommand: db.prepare(`
    SELECT * FROM brand_content_onboarding_commands
    WHERE run_id = ? AND workspace_id = ? AND idempotency_key = ?
  `),
  insert: db.prepare(`
    INSERT INTO brand_content_onboarding_runs (
      id, workspace_id, intake_revision_id, intake_revision, intake_fingerprint,
      status, revision, idempotency_key, input_fingerprint, matrix_selection_json,
      finalized_voice_json, approved_identity_json, children_json, current_gate,
      gate_evidence_json, attention_resume_status, created_by_json,
      created_at, updated_at, completed_at
    ) VALUES (
      @id, @workspace_id, @intake_revision_id, @intake_revision, @intake_fingerprint,
      'intake_ready', 0, @idempotency_key, @input_fingerprint, @matrix_selection_json,
      NULL, '[]', @children_json, 'intake_accepted',
      @gate_evidence_json, NULL, @created_by_json,
      @created_at, @updated_at, NULL
    )
  `),
  update: db.prepare(`
    UPDATE brand_content_onboarding_runs
    SET status = @next_status, -- status-ok: transitionBrandContentOnboardingRun validates BRAND_CONTENT_ONBOARDING_TRANSITIONS before this CAS
        revision = revision + 1,
        finalized_voice_json = @finalized_voice_json,
        approved_identity_json = @approved_identity_json,
        children_json = @children_json,
        current_gate = @current_gate,
        gate_evidence_json = @gate_evidence_json,
        attention_resume_status = @attention_resume_status,
        updated_at = @updated_at,
        completed_at = @completed_at
    WHERE id = @id AND workspace_id = @workspace_id
      AND revision = @expected_revision AND status = @expected_status
  `),
  insertCommand: db.prepare(`
    INSERT INTO brand_content_onboarding_commands (
      run_id, workspace_id, idempotency_key, request_fingerprint,
      result_revision, result_status, paid_job_id, created_at
    ) VALUES (
      @run_id, @workspace_id, @idempotency_key, @request_fingerprint,
      @result_revision, @result_status, @paid_job_id, @created_at
    )
  `),
}));

export interface CreateBrandContentOnboardingRunInput {
  workspaceId: string;
  intakeRevision: BrandIntakeRevisionRef;
  matrixSelection: MatrixGenerationInputSelection;
  brandBudget: BrandGenerationBudgetRequest;
  idempotencyKey: string;
  createdBy: GenerationResolverAttribution;
  intakeEvidence: Extract<BrandContentOnboardingGateEvidence, { gate: 'intake_accepted' }>;
  now?: string;
}

export interface CreateBrandContentOnboardingRunResult {
  run: BrandContentOnboardingRun;
  existing: boolean;
}

function onboardingInputFingerprint(input: Pick<
  CreateBrandContentOnboardingRunInput,
  'intakeRevision' | 'matrixSelection' | 'brandBudget'
>): string {
  return canonicalGenerationFingerprint({
    intakeRevision: input.intakeRevision,
    matrixSelection: input.matrixSelection,
    brandBudget: input.brandBudget,
  });
}

function assertCreateInput(input: CreateBrandContentOnboardingRunInput): void {
  idSchema.parse(input.workspaceId);
  intakeRevisionSchema.parse(input.intakeRevision);
  idSchema.parse(input.idempotencyKey);
  resolverSchema.parse(input.createdBy);
  timestampSchema.parse(input.now ?? new Date().toISOString());
  const evidence = gateEvidenceSchema.parse(input.intakeEvidence);
  if (evidence.gate !== 'intake_accepted'
    || canonicalGenerationFingerprint(evidence.intakeRevision)
      !== canonicalGenerationFingerprint(input.intakeRevision)) {
    throw new BrandContentOnboardingPersistenceContractError(
      'Intake acceptance evidence must identify the exact onboarding intake revision',
    );
  }
  if (input.matrixSelection.length === 0) {
    throw new BrandContentOnboardingPersistenceContractError(
      'Onboarding matrix selection must not be empty',
    );
  }
  for (const selection of input.matrixSelection) matrixSelectionItemSchema.parse(selection);
}

export function getBrandContentOnboardingRun(
  workspaceId: string,
  runId: string,
): BrandContentOnboardingRun | null {
  const row = stmts().selectById.get(runId, workspaceId) as BrandContentOnboardingRow | undefined;
  return row ? rowToRun(row) : null;
}

/** Replays any previously accepted transition command for this run. */
export function getBrandContentOnboardingResumeReplay(
  workspaceId: string,
  runId: string,
  idempotencyKey: string,
  requestFingerprint: string,
): { run: BrandContentOnboardingRun; paidJobId: string | null } | null {
  const command = stmts().selectCommand.get(
    runId,
    workspaceId,
    idempotencyKey,
  ) as BrandContentOnboardingCommandRow | undefined;
  const row = stmts().selectById.get(runId, workspaceId) as BrandContentOnboardingRow | undefined;
  if (!command) return null;
  if (!row) throw new BrandContentOnboardingNotFoundError();
  if (command.request_fingerprint !== requestFingerprint) {
    throw new BrandContentOnboardingResumeIdempotencyConflictError();
  }
  if (command.result_revision > row.revision
    || !statusSchema.safeParse(command.result_status).success) {
    throw new BrandContentOnboardingPersistenceContractError(
      'Stored onboarding command result is invalid',
    );
  }
  return { run: rowToRun(row), paidJobId: command.paid_job_id };
}

export function createBrandContentOnboardingRun(
  input: CreateBrandContentOnboardingRunInput,
): CreateBrandContentOnboardingRunResult {
  assertCreateInput(input);
  const inputFingerprint = onboardingInputFingerprint(input);
  const now = input.now ?? new Date().toISOString();

  return db.transaction(() => {
    const existing = stmts().selectByIdempotency.get(
      input.workspaceId,
      input.intakeRevision.intakeRevisionId,
      input.idempotencyKey,
    ) as BrandContentOnboardingRow | undefined;
    if (existing) {
      if (existing.input_fingerprint !== inputFingerprint) {
        throw new BrandContentOnboardingIdempotencyConflictError();
      }
      return { run: rowToRun(existing), existing: true };
    }

    const id = `bco_${randomUUID()}`;
    stmts().insert.run({
      id,
      workspace_id: input.workspaceId,
      intake_revision_id: input.intakeRevision.intakeRevisionId,
      intake_revision: input.intakeRevision.revision,
      intake_fingerprint: input.intakeRevision.fingerprint,
      idempotency_key: input.idempotencyKey,
      input_fingerprint: inputFingerprint,
      matrix_selection_json: JSON.stringify(input.matrixSelection),
      children_json: JSON.stringify(EMPTY_CHILDREN),
      gate_evidence_json: JSON.stringify([input.intakeEvidence]),
      created_by_json: JSON.stringify(input.createdBy),
      created_at: now,
      updated_at: now,
    });
    const row = stmts().selectById.get(id, input.workspaceId) as BrandContentOnboardingRow | undefined;
    if (!row) throw new BrandContentOnboardingPersistenceContractError('Created onboarding run was not readable');
    return { run: rowToRun(row), existing: false };
  })();
}

export interface TransitionBrandContentOnboardingRunInput {
  workspaceId: string;
  runId: string;
  expectedRevision: number;
  expectedStatus: BrandContentOnboardingStatus;
  nextStatus: BrandContentOnboardingStatus;
  currentGate: BrandContentOnboardingGate | null;
  attentionResumeStatus: BrandContentOnboardingResumeStatus | null;
  finalizedVoice?: NonNullable<BrandContentOnboardingRun['finalizedVoice']>;
  approvedIdentity?: BrandContentOnboardingRun['approvedIdentity'];
  children?: Partial<Omit<BrandContentOnboardingChildren, 'pageApprovals'>> & {
    pageApprovals?: MatrixPageApprovalRef[];
  };
  evidence?: BrandContentOnboardingGateEvidence[];
  resume: {
    idempotencyKey: string;
    requestFingerprint: string;
  };
  paidJobId?: string | null;
  now?: string;
}

export interface TransitionBrandContentOnboardingRunResult {
  run: BrandContentOnboardingRun;
  replayed: boolean;
}

function mergeImmutableChildren(
  current: BrandContentOnboardingChildren,
  patch: TransitionBrandContentOnboardingRunInput['children'],
): BrandContentOnboardingChildren {
  if (!patch) return current;
  const next = { ...current, ...patch };
  for (const key of [
    'brandRunId',
    'voiceReviewDeliverableId',
    'brandReviewDeliverableId',
    'matrixRunId',
  ] as const) {
    if (current[key] !== null && next[key] !== current[key]) {
      throw new BrandContentOnboardingPersistenceContractError(
        `Onboarding child reference ${key} is immutable once recorded`,
      );
    }
  }
  if (current.pageApprovals.length > 0
    && canonicalGenerationFingerprint(current.pageApprovals)
      !== canonicalGenerationFingerprint(next.pageApprovals)) {
    throw new BrandContentOnboardingPersistenceContractError(
      'Onboarding page approval snapshot is immutable once recorded',
    );
  }
  childrenSchema.parse(next);
  return next;
}

export function transitionBrandContentOnboardingRun(
  input: TransitionBrandContentOnboardingRunInput,
): TransitionBrandContentOnboardingRunResult {
  idSchema.parse(input.workspaceId);
  idSchema.parse(input.runId);
  statusSchema.parse(input.expectedStatus);
  statusSchema.parse(input.nextStatus);
  if (input.currentGate !== null) gateSchema.parse(input.currentGate);
  if (input.attentionResumeStatus !== null) resumeStatusSchema.parse(input.attentionResumeStatus);
  idSchema.parse(input.resume.idempotencyKey);
  fingerprintSchema.parse(input.resume.requestFingerprint);
  const now = input.now ?? new Date().toISOString();
  timestampSchema.parse(now);
  if ((input.nextStatus === 'needs_attention') !== (input.attentionResumeStatus !== null)) {
    throw new BrandContentOnboardingPersistenceContractError(
      'needs_attention requires one exact recovery status and other states must clear it',
    );
  }
  for (const evidence of input.evidence ?? []) gateEvidenceSchema.parse(evidence);

  return db.transaction(() => {
    const row = stmts().selectById.get(
      input.runId,
      input.workspaceId,
    ) as BrandContentOnboardingRow | undefined;
    if (!row) throw new BrandContentOnboardingNotFoundError();

    const priorCommand = stmts().selectCommand.get(
      input.runId,
      input.workspaceId,
      input.resume.idempotencyKey,
    ) as BrandContentOnboardingCommandRow | undefined;
    if (priorCommand) {
      if (priorCommand.request_fingerprint !== input.resume.requestFingerprint) {
        throw new BrandContentOnboardingResumeIdempotencyConflictError();
      }
      return { run: rowToRun(row), replayed: true };
    }
    if (row.revision !== input.expectedRevision || row.status !== input.expectedStatus) {
      throw new BrandContentOnboardingRevisionConflictError(input.expectedRevision, row.revision);
    }

    validateTransition(
      'brand_content_onboarding',
      BRAND_CONTENT_ONBOARDING_TRANSITIONS,
      input.expectedStatus,
      input.nextStatus,
    );
    const current = rowToRun(row);
    const nextFinalizedVoice = input.finalizedVoice ?? current.finalizedVoice;
    if (current.finalizedVoice && input.finalizedVoice
      && canonicalGenerationFingerprint(current.finalizedVoice)
        !== canonicalGenerationFingerprint(input.finalizedVoice)) {
      throw new BrandContentOnboardingPersistenceContractError(
        'Finalized voice snapshot is immutable once frozen',
      );
    }
    const nextApprovedIdentity = input.approvedIdentity ?? current.approvedIdentity;
    if (current.approvedIdentity.length > 0 && input.approvedIdentity
      && canonicalGenerationFingerprint(current.approvedIdentity)
        !== canonicalGenerationFingerprint(input.approvedIdentity)) {
      throw new BrandContentOnboardingPersistenceContractError(
        'Approved identity snapshot is immutable once frozen',
      );
    }
    if (input.finalizedVoice) finalizedVoiceSnapshotRefSchema.parse(input.finalizedVoice);
    for (const ref of nextApprovedIdentity) approvedIdentitySchema.parse(ref);
    const nextChildren = mergeImmutableChildren(current.children, input.children);
    const evidence = [...current.gateEvidence];
    const knownEvidenceIds = new Set(evidence.map(item => item.id));
    for (const item of input.evidence ?? []) {
      if (knownEvidenceIds.has(item.id)) {
        throw new BrandContentOnboardingPersistenceContractError(
          `Onboarding gate evidence ${item.id} is already recorded`,
        );
      }
      knownEvidenceIds.add(item.id);
      evidence.push(item);
    }

    const terminal = ['ready_to_publish', 'cancelled', 'failed'].includes(input.nextStatus);
    const result = stmts().update.run({
      id: input.runId,
      workspace_id: input.workspaceId,
      expected_revision: input.expectedRevision,
      expected_status: input.expectedStatus,
      next_status: input.nextStatus,
      finalized_voice_json: nextFinalizedVoice === null ? null : JSON.stringify(nextFinalizedVoice),
      approved_identity_json: JSON.stringify(nextApprovedIdentity),
      children_json: JSON.stringify(nextChildren),
      current_gate: input.currentGate,
      gate_evidence_json: JSON.stringify(evidence),
      attention_resume_status: input.attentionResumeStatus,
      updated_at: now,
      completed_at: terminal ? now : null,
    });
    if (result.changes !== 1) {
      const actual = stmts().selectById.get(
        input.runId,
        input.workspaceId,
      ) as BrandContentOnboardingRow | undefined;
      throw new BrandContentOnboardingRevisionConflictError(
        input.expectedRevision,
        actual?.revision ?? null,
      );
    }
    stmts().insertCommand.run({
      run_id: input.runId,
      workspace_id: input.workspaceId,
      idempotency_key: input.resume.idempotencyKey,
      request_fingerprint: input.resume.requestFingerprint,
      result_revision: input.expectedRevision + 1,
      result_status: input.nextStatus,
      paid_job_id: input.paidJobId ?? null,
      created_at: now,
    });
    const updated = stmts().selectById.get(
      input.runId,
      input.workspaceId,
    ) as BrandContentOnboardingRow | undefined;
    if (!updated) throw new BrandContentOnboardingNotFoundError();
    return { run: rowToRun(updated), replayed: false };
  })();
}
