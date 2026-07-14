import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  AUDIENCE_TARGETS,
  BRAND_GENERATION_ATOMIC_TARGETS,
  BRAND_GENERATION_CONTRACT_VERSION,
  BRAND_GENERATION_LIMITS,
  BRAND_GENERATION_PRESET_POLICY,
  IDENTITY_MESSAGING_TARGETS,
  type BrandGeneratedClaim,
  type BrandGenerationAcceptedCommandResult,
  type BrandGenerationAttempt,
  type BrandGenerationAttemptStage,
  type BrandGenerationBudgetEstimate,
  type BrandGenerationBudgetUsage,
  type BrandGenerationCommand,
  type BrandGenerationItem,
  type BrandGenerationItemPage,
  type BrandGenerationItemStatus,
  type BrandGenerationRun,
  type BrandGenerationRunStatus,
  type BrandGenerationStage,
  type BrandGenerationTargetInputSnapshot,
  type BrandVoiceReadiness,
  type PersistedBrandGenerationRun,
  type PublicBrandGenerationCreatorAttribution,
  type ResumeBrandGenerationRequest,
  type ReviseBrandGenerationItemRequest,
  type StartBrandGenerationRequest,
} from '../../../../shared/types/brand-generation.js';
import {
  DEFAULT_TIER_MAP,
  type BrandDeliverable,
} from '../../../../shared/types/brand-engine.js';
import type {
  GenerationAuditReport,
  GenerationPlaceholderProjection,
  GenerationResolverAttribution,
  GenerationSanitizedError,
} from '../../../../shared/types/generation-evidence.js';
import type { GenerationProvenance } from '../../../../shared/types/ai-execution.js';
import type { McpToolExecutionContext } from '../../../../shared/types/mcp-runtime.js';
import db from '../../../db/index.js';
import { parseJsonSafe, parseJsonSafeArray } from '../../../db/json-validation.js';
import { createStmtCache } from '../../../db/stmt-cache.js';
import { JWT_SECRET } from '../../../jwt-config.js';
import { z } from '../../../middleware/validate.js';
import {
  BRAND_GENERATION_ATTEMPT_TRANSITIONS,
  BRAND_GENERATION_ITEM_TRANSITIONS,
  BRAND_GENERATION_RUN_TRANSITIONS,
  validateTransition,
} from '../../../state-machines.js';
import {
  addBrandGenerationBudgetUsage,
  assertBrandGenerationReservationFits,
  validateBrandGenerationBudgetEstimate,
  validateBrandGenerationBudgetRequest,
  validateBrandGenerationBudgetUsage,
} from './budget.js';
import {
  BrandGenerationApprovedDeliverableError,
  BrandGenerationAttemptCheckpointConflictError,
  BrandGenerationConcurrencyLimitError,
  BrandGenerationCursorError,
  BrandGenerationIdempotencyConflictError,
  BrandGenerationNotFoundError,
  BrandGenerationPersistenceContractError,
  BrandGenerationRevisionConflictError,
} from './errors.js';
import {
  canonicalBrandGenerationFingerprint,
  resumeBrandGenerationCommandSnapshot,
  reviseBrandGenerationItemCommandSnapshot,
  startBrandGenerationCommandSnapshot,
} from './fingerprint.js';
import {
  assertAttemptOutputMatchesStage,
  brandDeliverableWriteExpectationSchema,
  brandGeneratedClaimSchema,
  brandGenerationAcceptedCommandResultSchema,
  brandGenerationAttemptOutputSchema,
  brandGenerationAuditReportSchema,
  brandGenerationCommandRequestSnapshotSchema,
  brandGenerationEvidenceRequirementSchema,
  brandGenerationMcpExecutionContextSchema,
  brandGenerationPlaceholderSchema,
  brandGenerationProvenanceSchema,
  brandGenerationSanitizedErrorSchema,
  brandGenerationSelectionSchema,
  brandGenerationTargetInputSnapshotSchema,
  brandVoiceFoundationDraftSchema,
  brandVoiceReadinessSchema,
  generationResolverAttributionSchema,
} from './persistence-schemas.js';

interface BrandGenerationRunRow {
  id: string;
  schema_version: number;
  workspace_id: string;
  intake_revision_id: string;
  intake_revision: number;
  intake_fingerprint: string;
  selection_json: string;
  dispatch_targets_json: string;
  dispatch_target_count: number | null;
  status: BrandGenerationRunStatus;
  stage: BrandGenerationStage;
  revision: number;
  idempotency_key: string;
  selection_fingerprint: string;
  effective_input_fingerprint: string;
  voice_snapshot_json: string | null;
  current_job_id: string | null;
  selected_count: number;
  queued_count: number;
  running_count: number;
  ready_for_human_review_count: number;
  needs_attention_count: number;
  blocked_count: number;
  conflict_count: number;
  failed_count: number;
  cancelled_count: number;
  approved_count: number;
  changes_requested_count: number;
  estimated_provider_calls: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_microusd: number;
  max_provider_calls: number;
  max_input_tokens: number;
  max_output_tokens: number;
  max_cost_microusd: number;
  max_concurrency: number;
  reserved_provider_calls: number;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
  reserved_cost_microusd: number;
  created_by_json: string;
  mcp_execution_context_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

type BrandGenerationAttemptOutput = Exclude<BrandGenerationAttempt['output'], null>;

interface BrandGenerationItemRow {
  id: string;
  schema_version: number;
  run_id: string;
  workspace_id: string;
  target: BrandGenerationItem['target'];
  status: BrandGenerationItemStatus;
  revision: number;
  input_snapshot_json: string | null;
  foundation_draft_json: string | null;
  content: string | null;
  claims_json: string;
  claims_count: number | null;
  requirements_json: string;
  requirements_count: number | null;
  placeholders_json: string;
  placeholders_count: number | null;
  audit_report_json: string | null;
  attempt_count: number;
  automatic_revision_count: 0 | 1;
  effective_input_fingerprint: string | null;
  provenance_json: string | null;
  error_json: string | null;
  artifact_expectation_json: string | null;
  committed_deliverable_id: string | null;
  committed_deliverable_version: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface BrandGenerationCommandRow {
  id: string;
  schema_version: number;
  run_id: string;
  workspace_id: string;
  item_id: string | null;
  command_kind: BrandGenerationCommand['kind'];
  idempotency_key: string;
  request_fingerprint: string;
  request_snapshot_json: string;
  expected_run_revision: number | null;
  expected_item_revision: number | null;
  expected_deliverable_version: number | null;
  prior_item_status: 'ready_for_human_review' | 'changes_requested' | null;
  job_id: string;
  result_json: string;
  actor_json: string;
  mcp_execution_context_json: string | null;
  created_at: string;
}

interface BrandGenerationAttemptRow {
  id: string;
  schema_version: number;
  item_id: string;
  run_id: string;
  workspace_id: string;
  command_id: string;
  job_id: string;
  attempt_number: number;
  stage: BrandGenerationAttemptStage;
  status: BrandGenerationAttempt['status'];
  expected_run_revision: number;
  expected_item_revision: number;
  expected_deliverable_version: number | null;
  effective_input_fingerprint: string;
  reserved_provider_calls: number;
  reserved_input_tokens: number;
  reserved_output_tokens: number;
  reserved_cost_microusd: number;
  output_snapshot_json: string | null;
  provenance_json: string | null;
  error_json: string | null;
  started_at: string;
  completed_at: string | null;
}

interface DeliverableRow {
  id: string;
  workspace_id: string;
  deliverable_type: BrandDeliverable['deliverableType'];
  content: string;
  status: BrandDeliverable['status'];
  version: number;
  tier: BrandDeliverable['tier'];
  created_at: string;
  updated_at: string;
}

export interface BrandGenerationPreparedItem {
  target: BrandGenerationItem['target'];
  inputSnapshot: BrandGenerationTargetInputSnapshot;
}

interface AcceptCommandCommon {
  jobId: string;
  estimate: BrandGenerationBudgetEstimate;
  dashboardUrl: string;
}

export interface AcceptBrandGenerationStartCommandInput extends AcceptCommandCommon {
  request: StartBrandGenerationRequest;
  items: [BrandGenerationPreparedItem, ...BrandGenerationPreparedItem[]];
  voiceReadiness: BrandVoiceReadiness;
  selectionFingerprint: string;
  effectiveInputFingerprint: string;
}

export interface AcceptBrandGenerationResumeCommandInput extends AcceptCommandCommon {
  request: ResumeBrandGenerationRequest;
  items: [BrandGenerationPreparedItem, ...BrandGenerationPreparedItem[]];
  voiceReadiness: Extract<BrandVoiceReadiness, { state: 'finalized' }>;
}

export interface AcceptBrandGenerationRevisionCommandInput extends AcceptCommandCommon {
  request: ReviseBrandGenerationItemRequest;
  inputSnapshot: BrandGenerationTargetInputSnapshot;
}

export interface BrandGenerationAcceptedPersistenceResult {
  run: PersistedBrandGenerationRun;
  command: BrandGenerationCommand;
  items: BrandGenerationItem[];
  result: BrandGenerationAcceptedCommandResult;
  existing: boolean;
}

export interface BeginBrandGenerationAttemptInput {
  workspaceId: string;
  runId: string;
  itemId: string;
  commandId: string;
  jobId: string;
  stage: BrandGenerationAttemptStage;
  expectedRunRevision: number;
  expectedItemRevision: number;
  expectedDeliverableVersion: number | null;
  effectiveInputFingerprint: string;
  reservation: BrandGenerationBudgetUsage;
}

export interface ReserveBrandGenerationAttemptBudgetInput {
  workspaceId: string;
  runId: string;
  itemId: string;
  attemptId: string;
  expectedRunRevision: number;
  expectedItemRevision: number;
  reservation: BrandGenerationBudgetUsage;
}

export interface CompleteBrandGenerationAttemptInput {
  workspaceId: string;
  runId: string;
  itemId: string;
  attemptId: string;
  output: BrandGenerationAttemptOutput;
  provenance: GenerationProvenance | null;
}

export interface EndBrandGenerationAttemptInput {
  workspaceId: string;
  runId: string;
  itemId: string;
  attemptId: string;
  error?: GenerationSanitizedError | null;
}

export interface TransitionBrandGenerationItemPatch {
  inputSnapshot?: BrandGenerationTargetInputSnapshot | null;
  foundationDraft?: Extract<BrandGenerationItem, { target: 'voice_foundation' }>['foundationDraft'];
  content?: string | null;
  claims?: BrandGeneratedClaim[];
  requirements?: BrandGenerationItem['requirements'];
  placeholders?: GenerationPlaceholderProjection[];
  auditReport?: GenerationAuditReport | null;
  automaticRevisionCount?: 0 | 1;
  effectiveInputFingerprint?: string | null;
  provenance?: GenerationProvenance | null;
  error?: GenerationSanitizedError | null;
  completedAt?: string | null;
}

export interface TransitionBrandGenerationItemInput {
  workspaceId: string;
  runId: string;
  itemId: string;
  expectedRevision: number;
  nextStatus: BrandGenerationItemStatus;
  patch?: TransitionBrandGenerationItemPatch;
}

export interface TransitionBrandGenerationRunInput {
  workspaceId: string;
  runId: string;
  expectedRevision: number;
  nextStatus: BrandGenerationRunStatus;
  nextStage: BrandGenerationStage;
  currentJobId?: string | null;
  voiceReadiness?: BrandVoiceReadiness;
  completedAt?: string | null;
}

export interface CommitBrandGenerationCandidateInput {
  workspaceId: string;
  runId: string;
  itemId: string;
  candidateAttemptId: string;
  finalAuditAttemptId: string;
  expectedRunRevision: number;
  expectedItemRevision: number;
  nextStatus: Extract<BrandGenerationItemStatus,
    'ready_for_human_review' | 'needs_attention' | 'blocked_missing_evidence'>;
}

export type BrandGenerationDeliverableCasConflictReason =
  | 'deliverable_missing'
  | 'deliverable_created'
  | 'deliverable_changed'
  | 'deliverable_approved';

export type CommitBrandGenerationDeliverableResult =
  | { kind: 'committed'; deliverable: BrandDeliverable; item: BrandGenerationItem }
  | { kind: 'withheld'; item: BrandGenerationItem }
  | { kind: 'conflict'; reason: BrandGenerationDeliverableCasConflictReason; item: BrandGenerationItem };

const runSelect = `
  SELECT run.*, json_array_length(run.dispatch_targets_json) AS dispatch_target_count
  FROM brand_generation_runs run
`;

const itemSelect = `
  SELECT item.*,
    json_array_length(item.claims_json) AS claims_count,
    json_array_length(item.requirements_json) AS requirements_count,
    json_array_length(item.placeholders_json) AS placeholders_count
  FROM brand_generation_items item
`;

const attemptSelect = `
  SELECT attempt.*, item.workspace_id, command.job_id
  FROM brand_generation_attempts attempt
  JOIN brand_generation_items item
    ON item.id = attempt.item_id AND item.run_id = attempt.run_id
  JOIN brand_generation_commands command
    ON command.id = attempt.command_id AND command.run_id = attempt.run_id
`;

const stmts = createStmtCache(() => ({
  intakeRevision: db.prepare(`
    SELECT id, workspace_id, revision, fingerprint
    FROM brand_intake_revisions
    WHERE id = ? AND workspace_id = ?
  `),
  currentIntakeRevision: db.prepare(`
    SELECT id, workspace_id, revision, fingerprint
    FROM brand_intake_revisions
    WHERE workspace_id = ?
    ORDER BY revision DESC, id DESC LIMIT 1
  `),
  runById: db.prepare(`${runSelect} WHERE run.id = ? AND run.workspace_id = ?`),
  runByStartIdempotency: db.prepare(`${runSelect}
    WHERE run.workspace_id = ? AND run.intake_revision_id = ? AND run.idempotency_key = ?
  `),
  insertRun: db.prepare(`
    INSERT INTO brand_generation_runs (
      id, schema_version, workspace_id, intake_revision_id, intake_revision,
      intake_fingerprint, selection_json, dispatch_targets_json, status, stage,
      revision, idempotency_key, selection_fingerprint, effective_input_fingerprint,
      voice_snapshot_json, current_job_id,
      selected_count, queued_count, running_count,
      ready_for_human_review_count, needs_attention_count, blocked_count,
      conflict_count, failed_count, cancelled_count, approved_count,
      changes_requested_count, estimated_provider_calls, estimated_input_tokens,
      estimated_output_tokens, estimated_cost_microusd, max_provider_calls,
      max_input_tokens, max_output_tokens, max_cost_microusd, max_concurrency,
      reserved_provider_calls, reserved_input_tokens, reserved_output_tokens,
      reserved_cost_microusd, created_by_json, mcp_execution_context_json,
      created_at, updated_at, completed_at
    ) VALUES (
      @id, 1, @workspace_id, @intake_revision_id, @intake_revision,
      @intake_fingerprint, @selection_json, @dispatch_targets_json, 'queued', 'preflight',
      0, @idempotency_key, @selection_fingerprint, @effective_input_fingerprint,
      @voice_snapshot_json, @current_job_id,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      @estimated_provider_calls, @estimated_input_tokens,
      @estimated_output_tokens, @estimated_cost_microusd, @max_provider_calls,
      @max_input_tokens, @max_output_tokens, @max_cost_microusd, @max_concurrency,
      0, 0, 0, 0, @created_by_json, @mcp_execution_context_json,
      @created_at, @updated_at, NULL
    )
  `),
  updateRunForCommand: db.prepare(`
    UPDATE brand_generation_runs SET
      dispatch_targets_json = @dispatch_targets_json,
      status = @status,
      stage = @stage,
      revision = revision + 1,
      voice_snapshot_json = @voice_snapshot_json,
      current_job_id = @current_job_id,
      estimated_provider_calls = @estimated_provider_calls,
      estimated_input_tokens = @estimated_input_tokens,
      estimated_output_tokens = @estimated_output_tokens,
      estimated_cost_microusd = @estimated_cost_microusd,
      updated_at = @updated_at,
      completed_at = NULL
    WHERE id = @id AND workspace_id = @workspace_id AND revision = @expected_revision
  `),
  updateRunTransition: db.prepare(`
    UPDATE brand_generation_runs SET
      status = @status, stage = @stage, revision = revision + 1,
      current_job_id = @current_job_id, voice_snapshot_json = @voice_snapshot_json,
      updated_at = @updated_at, completed_at = @completed_at
    WHERE id = @id AND workspace_id = @workspace_id AND revision = @expected_revision
  `),
  updateRunCounts: db.prepare(`
    UPDATE brand_generation_runs SET
      selected_count = @selected_count, queued_count = @queued_count,
      running_count = @running_count,
      ready_for_human_review_count = @ready_count,
      needs_attention_count = @attention_count, blocked_count = @blocked_count,
      conflict_count = @conflict_count, failed_count = @failed_count,
      cancelled_count = @cancelled_count, approved_count = @approved_count,
      changes_requested_count = @changes_requested_count, updated_at = @updated_at
    WHERE id = @run_id AND workspace_id = @workspace_id
  `),
  reserveBudget: db.prepare(`
    UPDATE brand_generation_runs SET
      reserved_provider_calls = @provider_calls,
      reserved_input_tokens = @input_tokens,
      reserved_output_tokens = @output_tokens,
      reserved_cost_microusd = @cost_microusd,
      updated_at = @updated_at
    WHERE id = @id AND workspace_id = @workspace_id
  `),
  itemById: db.prepare(`${itemSelect}
    WHERE item.id = ? AND item.run_id = ? AND item.workspace_id = ?
  `),
  itemsByRun: db.prepare(`${itemSelect}
    WHERE item.run_id = ? AND item.workspace_id = ?
    ORDER BY item.created_at ASC, item.id ASC
  `),
  insertItem: db.prepare(`
    INSERT INTO brand_generation_items (
      id, schema_version, run_id, workspace_id, target, status, revision,
      input_snapshot_json, foundation_draft_json, content, claims_json,
      requirements_json, placeholders_json, audit_report_json, attempt_count,
      automatic_revision_count, effective_input_fingerprint, provenance_json,
      error_json, artifact_expectation_json, committed_deliverable_id,
      committed_deliverable_version, created_at, updated_at, completed_at
    ) VALUES (
      @id, 1, @run_id, @workspace_id, @target, 'queued', 0,
      @input_snapshot_json, NULL, NULL, '[]', '[]', '[]', NULL, 0, 0,
      @effective_input_fingerprint, NULL, NULL, @artifact_expectation_json,
      NULL, NULL, @created_at, @updated_at, NULL
    )
  `),
  updateItem: db.prepare(`
    UPDATE brand_generation_items SET
      status = @status, revision = revision + 1,
      input_snapshot_json = @input_snapshot_json,
      foundation_draft_json = @foundation_draft_json, content = @content,
      claims_json = @claims_json, requirements_json = @requirements_json,
      placeholders_json = @placeholders_json, audit_report_json = @audit_report_json,
      automatic_revision_count = @automatic_revision_count,
      effective_input_fingerprint = @effective_input_fingerprint,
      provenance_json = @provenance_json, error_json = @error_json,
      artifact_expectation_json = @artifact_expectation_json,
      committed_deliverable_id = @committed_deliverable_id,
      committed_deliverable_version = @committed_deliverable_version,
      updated_at = @updated_at, completed_at = @completed_at
    WHERE id = @id AND run_id = @run_id AND workspace_id = @workspace_id
      AND revision = @expected_revision
  `),
  refreshItemAttemptCount: db.prepare(`
    UPDATE brand_generation_items SET attempt_count = (
      SELECT COUNT(*) FROM brand_generation_attempts WHERE item_id = @item_id
    ), updated_at = @updated_at
    WHERE id = @item_id AND run_id = @run_id AND workspace_id = @workspace_id
  `),
  itemStatusCounts: db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM brand_generation_items
    WHERE run_id = ? AND workspace_id = ?
    GROUP BY status
  `),
  commandById: db.prepare(`
    SELECT * FROM brand_generation_commands
    WHERE id = ? AND run_id = ? AND workspace_id = ?
  `),
  commandsByJob: db.prepare(`
    SELECT * FROM brand_generation_commands
    WHERE workspace_id = ? AND job_id = ?
    ORDER BY created_at ASC, id ASC
  `),
  activeRuns: db.prepare(`${runSelect}
    WHERE run.status IN ('queued', 'running')
    ORDER BY run.updated_at ASC, run.id ASC
    LIMIT ?
  `),
  runCommandByIdempotency: db.prepare(`
    SELECT * FROM brand_generation_commands
    WHERE run_id = ? AND workspace_id = ? AND item_id IS NULL
      AND command_kind = ? AND idempotency_key = ?
  `),
  itemCommandByIdempotency: db.prepare(`
    SELECT * FROM brand_generation_commands
    WHERE run_id = ? AND workspace_id = ? AND item_id = ?
      AND command_kind = 'revision' AND idempotency_key = ?
  `),
  insertCommand: db.prepare(`
    INSERT INTO brand_generation_commands (
      id, schema_version, run_id, workspace_id, item_id, command_kind,
      idempotency_key, request_fingerprint, request_snapshot_json,
      expected_run_revision, expected_item_revision, expected_deliverable_version,
      prior_item_status, job_id, result_json, actor_json,
      mcp_execution_context_json, created_at
    ) VALUES (
      @id, 1, @run_id, @workspace_id, @item_id, @command_kind,
      @idempotency_key, @request_fingerprint, @request_snapshot_json,
      @expected_run_revision, @expected_item_revision, @expected_deliverable_version,
      @prior_item_status, @job_id, @result_json, @actor_json,
      @mcp_execution_context_json, @created_at
    )
  `),
  attemptById: db.prepare(`${attemptSelect}
    WHERE attempt.id = ? AND attempt.item_id = ? AND attempt.run_id = ?
      AND item.workspace_id = ?
  `),
  attemptCheckpoint: db.prepare(`${attemptSelect}
    WHERE attempt.item_id = ? AND attempt.run_id = ? AND item.workspace_id = ?
      AND attempt.stage = ? AND attempt.attempt_number = ?
  `),
  activeAttemptForCommandStage: db.prepare(`${attemptSelect}
    WHERE attempt.item_id = ? AND attempt.run_id = ? AND item.workspace_id = ?
      AND attempt.command_id = ? AND attempt.stage = ? AND attempt.status = 'running'
    ORDER BY attempt.attempt_number DESC LIMIT 1
  `),
  nextAttemptNumber: db.prepare(`
    SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_number
    FROM brand_generation_attempts
    WHERE item_id = ? AND stage = ?
  `),
  runningAttemptCount: db.prepare(`
    SELECT COUNT(*) AS count
    FROM brand_generation_attempts attempt
    JOIN brand_generation_items item
      ON item.id = attempt.item_id AND item.run_id = attempt.run_id
    WHERE attempt.run_id = ? AND item.workspace_id = ? AND attempt.status = 'running'
  `),
  insertAttempt: db.prepare(`
    INSERT INTO brand_generation_attempts (
      id, schema_version, item_id, run_id, command_id, attempt_number,
      stage, status, expected_run_revision, expected_item_revision,
      expected_deliverable_version, effective_input_fingerprint,
      reserved_provider_calls, reserved_input_tokens, reserved_output_tokens,
      reserved_cost_microusd, output_snapshot_json, provenance_json, error_json,
      started_at, completed_at
    ) VALUES (
      @id, 1, @item_id, @run_id, @command_id, @attempt_number,
      @stage, 'running', @expected_run_revision, @expected_item_revision,
      @expected_deliverable_version, @effective_input_fingerprint,
      @reserved_provider_calls, @reserved_input_tokens, @reserved_output_tokens,
      @reserved_cost_microusd, NULL, NULL, NULL, @started_at, NULL
    )
  `),
  updateAttemptTerminal: db.prepare(`
    UPDATE brand_generation_attempts SET
      status = @status, output_snapshot_json = @output_snapshot_json,
      provenance_json = @provenance_json, error_json = @error_json,
      completed_at = @completed_at
    WHERE id = @id AND item_id = @item_id AND run_id = @run_id
      AND status = 'running'
  `),
  reserveAttemptBudget: db.prepare(`
    UPDATE brand_generation_attempts SET
      reserved_provider_calls = @provider_calls,
      reserved_input_tokens = @input_tokens,
      reserved_output_tokens = @output_tokens,
      reserved_cost_microusd = @cost_microusd
    WHERE id = @id AND item_id = @item_id AND run_id = @run_id
      AND status = 'running'
  `),
  runningAttemptsByJob: db.prepare(`${attemptSelect}
    WHERE item.workspace_id = ? AND attempt.run_id = ?
      AND command.job_id = ? AND attempt.status = 'running'
    ORDER BY attempt.started_at ASC, attempt.id ASC
  `),
  deliverableById: db.prepare(`
    SELECT * FROM brand_identity_deliverables WHERE id = ? AND workspace_id = ?
  `),
  deliverableByType: db.prepare(`
    SELECT * FROM brand_identity_deliverables
    WHERE workspace_id = ? AND deliverable_type = ?
    ORDER BY updated_at DESC LIMIT 1
  `),
  insertDeliverable: db.prepare(`
    INSERT INTO brand_identity_deliverables (
      id, workspace_id, deliverable_type, content, status, version, tier,
      created_at, updated_at
    ) VALUES (
      @id, @workspace_id, @deliverable_type, @content, 'draft', 1, @tier,
      @created_at, @updated_at
    )
  `),
  insertDeliverableVersion: db.prepare(`
    INSERT INTO brand_identity_versions (
      id, deliverable_id, content, steering_notes, version, created_at
    ) VALUES (
      @id, @deliverable_id, @content, @steering_notes, @version, @created_at
    )
  `),
  updateDeliverableCas: db.prepare(`
    UPDATE brand_identity_deliverables SET
      -- status-ok: version CAS preserves the existing draft lifecycle state.
      content = @content, status = 'draft', version = version + 1,
      updated_at = @updated_at
    WHERE id = @id AND workspace_id = @workspace_id
      AND version = @expected_version AND status = 'draft'
  `),
}));

function parseStoredObject<T>(
  raw: string | null,
  schema: z.ZodType<T>,
  workspaceId: string,
  table: string,
  field: string,
  nullable = false,
): T | null {
  if (raw === null) {
    if (nullable) return null;
    throw new BrandGenerationPersistenceContractError(`Stored ${table}.${field} is missing`);
  }
  const parsed = parseJsonSafe(raw, schema, null, { workspaceId, table, field });
  if (parsed === null) {
    throw new BrandGenerationPersistenceContractError(`Stored ${table}.${field} is invalid`);
  }
  return parsed;
}

function parseStoredArray<T>(
  raw: string,
  itemSchema: z.ZodType<T>,
  storedCount: number | null,
  workspaceId: string,
  table: string,
  field: string,
): T[] {
  const parsed = parseJsonSafeArray(raw, itemSchema, { workspaceId, table, field });
  if (storedCount === null || parsed.length !== storedCount) {
    throw new BrandGenerationPersistenceContractError(`Stored ${table}.${field} is invalid`);
  }
  return parsed;
}

function assertAttributionContext(
  workspaceId: string,
  actor: GenerationResolverAttribution,
  context: McpToolExecutionContext | null,
): void {
  if (actor.actorType === 'mcp' && context === null) {
    throw new BrandGenerationPersistenceContractError('MCP attribution requires execution context');
  }
  if (actor.actorType !== 'mcp' && context !== null) {
    throw new BrandGenerationPersistenceContractError('MCP execution context requires MCP attribution');
  }
  if (!context) return;
  if (context.targetWorkspaceId !== workspaceId) {
    throw new BrandGenerationPersistenceContractError('MCP execution workspace does not match the run');
  }
  if (context.caller.kind === 'workspace_key') {
    if (context.caller.workspaceId !== workspaceId || context.caller.scope !== workspaceId) {
      throw new BrandGenerationPersistenceContractError('MCP workspace key scope does not match the run');
    }
    if (actor.actorId !== context.caller.keyId
      || (actor.actorLabel !== undefined && actor.actorLabel !== context.caller.keyLabel)) {
      throw new BrandGenerationPersistenceContractError('MCP actor does not match the authenticated key');
    }
  }
}

function parseAttribution(
  rawActor: string,
  rawContext: string | null,
  workspaceId: string,
  table: string,
): { actor: GenerationResolverAttribution; context: McpToolExecutionContext | null } {
  const actor = parseStoredObject(
    rawActor,
    generationResolverAttributionSchema,
    workspaceId,
    table,
    'actor',
  );
  const context = parseStoredObject(
    rawContext,
    brandGenerationMcpExecutionContextSchema,
    workspaceId,
    table,
    'mcp_execution_context',
    true,
  );
  if (!actor) throw new BrandGenerationPersistenceContractError('Stored actor is invalid');
  assertAttributionContext(workspaceId, actor, context);
  return { actor, context };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertSelectionDispatch(
  selection: z.infer<typeof brandGenerationSelectionSchema>,
  targets: BrandGenerationItem['target'][],
): void {
  let expected: readonly BrandGenerationItem['target'][];
  if (selection.kind === 'atomic') {
    expected = [selection.target];
  } else if (selection.preset === 'identity_messaging') {
    expected = IDENTITY_MESSAGING_TARGETS;
  } else if (selection.preset === 'audience') {
    expected = AUDIENCE_TARGETS;
  } else {
    const initial = BRAND_GENERATION_PRESET_POLICY.full_brand_system.initialTargets;
    const resumed = BRAND_GENERATION_PRESET_POLICY.full_brand_system.resumeTargets;
    if (!arraysEqual(targets, initial) && !arraysEqual(targets, resumed)) {
      throw new BrandGenerationPersistenceContractError('Full brand system dispatch target set is invalid');
    }
    return;
  }
  if (!arraysEqual(targets, expected)) {
    throw new BrandGenerationPersistenceContractError('Stored selection and dispatch targets disagree');
  }
}

function countsFromItemRows(rows: Array<{ status: BrandGenerationItemStatus; count: number }>) {
  const counts = {
    selected: 0,
    queued: 0,
    running: 0,
    readyForHumanReview: 0,
    needsAttention: 0,
    blocked: 0,
    conflicts: 0,
    failed: 0,
    cancelled: 0,
    approved: 0,
    changesRequested: 0,
  };
  for (const row of rows) {
    counts.selected += row.count;
    if (row.status === 'queued') counts.queued += row.count;
    else if (['preflighting', 'generating', 'auditing_deterministic', 'auditing_model', 'revising'].includes(row.status)) counts.running += row.count;
    else if (row.status === 'ready_for_human_review') counts.readyForHumanReview += row.count;
    else if (row.status === 'needs_attention') counts.needsAttention += row.count;
    else if (row.status === 'blocked_missing_evidence') counts.blocked += row.count;
    else if (row.status === 'conflict') counts.conflicts += row.count;
    else if (row.status === 'failed') counts.failed += row.count;
    else if (row.status === 'cancelled') counts.cancelled += row.count;
    else if (row.status === 'approved') counts.approved += row.count;
    else if (row.status === 'changes_requested') counts.changesRequested += row.count;
  }
  return counts;
}

function deriveCounts(workspaceId: string, runId: string) {
  return countsFromItemRows(
    stmts().itemStatusCounts.all(runId, workspaceId) as Array<{
      status: BrandGenerationItemStatus;
      count: number;
    }>,
  );
}

function persistDerivedCounts(workspaceId: string, runId: string, now: string): void {
  const counts = deriveCounts(workspaceId, runId);
  stmts().updateRunCounts.run({
    run_id: runId,
    workspace_id: workspaceId,
    selected_count: counts.selected,
    queued_count: counts.queued,
    running_count: counts.running,
    ready_count: counts.readyForHumanReview,
    attention_count: counts.needsAttention,
    blocked_count: counts.blocked,
    conflict_count: counts.conflicts,
    failed_count: counts.failed,
    cancelled_count: counts.cancelled,
    approved_count: counts.approved,
    changes_requested_count: counts.changesRequested,
    updated_at: now,
  });
}

function runCountsFromRow(row: BrandGenerationRunRow) {
  const stored = {
    selected: row.selected_count,
    queued: row.queued_count,
    running: row.running_count,
    readyForHumanReview: row.ready_for_human_review_count,
    needsAttention: row.needs_attention_count,
    blocked: row.blocked_count,
    conflicts: row.conflict_count,
    failed: row.failed_count,
    cancelled: row.cancelled_count,
    approved: row.approved_count,
    changesRequested: row.changes_requested_count,
  };
  const derived = deriveCounts(row.workspace_id, row.id);
  if (JSON.stringify(stored) !== JSON.stringify(derived)) {
    throw new BrandGenerationPersistenceContractError('Stored brand generation counts drifted from item rows');
  }
  return stored;
}

function rowToRun(row: BrandGenerationRunRow): PersistedBrandGenerationRun {
  if (row.schema_version !== BRAND_GENERATION_CONTRACT_VERSION) {
    throw new BrandGenerationPersistenceContractError('Stored brand generation run schema is unsupported');
  }
  const selection = parseStoredObject(
    row.selection_json,
    brandGenerationSelectionSchema,
    row.workspace_id,
    'brand_generation_runs',
    'selection_json',
  );
  const selectedTargets = parseStoredArray(
    row.dispatch_targets_json,
    z.enum(BRAND_GENERATION_ATOMIC_TARGETS),
    row.dispatch_target_count,
    row.workspace_id,
    'brand_generation_runs',
    'dispatch_targets_json',
  ) as BrandGenerationItem['target'][];
  if (!selection) throw new BrandGenerationPersistenceContractError('Stored run selection is invalid');
  assertSelectionDispatch(selection, selectedTargets);
  const voiceReadiness = parseStoredObject(
    row.voice_snapshot_json,
    brandVoiceReadinessSchema,
    row.workspace_id,
    'brand_generation_runs',
    'voice_snapshot_json',
  );
  if (!voiceReadiness) throw new BrandGenerationPersistenceContractError('Stored voice readiness is invalid');
  const typedVoiceReadiness = voiceReadiness as BrandVoiceReadiness;
  const { actor: createdBy, context: mcpExecutionContext } = parseAttribution(
    row.created_by_json,
    row.mcp_execution_context_json,
    row.workspace_id,
    'brand_generation_runs',
  );
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    intakeRevision: {
      intakeRevisionId: row.intake_revision_id,
      revision: row.intake_revision,
      fingerprint: row.intake_fingerprint,
    },
    selection,
    selectedTargets,
    status: row.status,
    stage: row.stage,
    revision: row.revision,
    idempotencyKey: row.idempotency_key,
    selectionFingerprint: row.selection_fingerprint,
    effectiveInputFingerprint: row.effective_input_fingerprint,
    currentJobId: row.current_job_id,
    voiceReadiness: typedVoiceReadiness,
    counts: runCountsFromRow(row),
    budget: {
      estimate: {
        providerCalls: row.estimated_provider_calls,
        inputTokens: row.estimated_input_tokens,
        outputTokens: row.estimated_output_tokens,
        estimatedCostMicros: row.estimated_cost_microusd,
        maxConcurrency: row.max_concurrency,
      },
      limits: {
        providerCalls: row.max_provider_calls,
        inputTokens: row.max_input_tokens,
        outputTokens: row.max_output_tokens,
        maxEstimatedCostMicros: row.max_cost_microusd,
        maxConcurrency: row.max_concurrency,
      },
      reserved: {
        providerCalls: row.reserved_provider_calls,
        inputTokens: row.reserved_input_tokens,
        outputTokens: row.reserved_output_tokens,
        estimatedCostMicros: row.reserved_cost_microusd,
      },
    },
    createdBy,
    mcpExecutionContext,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  } as unknown as PersistedBrandGenerationRun;
}

function projectPublicCreator(
  actor: GenerationResolverAttribution,
): PublicBrandGenerationCreatorAttribution {
  if (actor.actorType === 'mcp' || actor.actorType === 'system') {
    return { actorType: actor.actorType };
  }
  return {
    actorType: actor.actorType,
    actorId: actor.actorId,
    ...(actor.actorLabel === undefined ? {} : { actorLabel: actor.actorLabel }),
  };
}

export function projectBrandGenerationRun(run: PersistedBrandGenerationRun): BrandGenerationRun {
  const {
    idempotencyKey: _idempotencyKey,
    mcpExecutionContext: _mcpExecutionContext,
    createdBy,
    ...publicFields
  } = run;
  return { ...publicFields, createdBy: projectPublicCreator(createdBy) } as BrandGenerationRun;
}

function rowToItem(row: BrandGenerationItemRow): BrandGenerationItem {
  if (row.schema_version !== BRAND_GENERATION_CONTRACT_VERSION) {
    throw new BrandGenerationPersistenceContractError('Stored brand generation item schema is unsupported');
  }
  const parsedInputSnapshot = parseStoredObject(
    row.input_snapshot_json,
    brandGenerationTargetInputSnapshotSchema,
    row.workspace_id,
    'brand_generation_items',
    'input_snapshot_json',
    true,
  );
  const inputSnapshot = parsedInputSnapshot as BrandGenerationTargetInputSnapshot | null;
  if (inputSnapshot && inputSnapshot.target !== row.target) {
    throw new BrandGenerationPersistenceContractError('Stored item snapshot target does not match its row');
  }
  const foundationDraft = parseStoredObject(
    row.foundation_draft_json,
    brandVoiceFoundationDraftSchema,
    row.workspace_id,
    'brand_generation_items',
    'foundation_draft_json',
    true,
  ) as Extract<BrandGenerationItem, { target: 'voice_foundation' }>['foundationDraft'];
  const artifactExpectation = parseStoredObject(
    row.artifact_expectation_json,
    brandDeliverableWriteExpectationSchema,
    row.workspace_id,
    'brand_generation_items',
    'artifact_expectation_json',
    true,
  );
  if (inputSnapshot && canonicalBrandGenerationFingerprint(inputSnapshot.artifactExpectation)
    !== canonicalBrandGenerationFingerprint(artifactExpectation)) {
    throw new BrandGenerationPersistenceContractError('Stored item artifact expectation drifted from its input snapshot');
  }
  const claims = parseStoredArray(
    row.claims_json,
    brandGeneratedClaimSchema,
    row.claims_count,
    row.workspace_id,
    'brand_generation_items',
    'claims_json',
  );
  const requirements = parseStoredArray(
    row.requirements_json,
    brandGenerationEvidenceRequirementSchema,
    row.requirements_count,
    row.workspace_id,
    'brand_generation_items',
    'requirements_json',
  );
  const placeholders = parseStoredArray(
    row.placeholders_json,
    brandGenerationPlaceholderSchema,
    row.placeholders_count,
    row.workspace_id,
    'brand_generation_items',
    'placeholders_json',
  );
  const base = {
    id: row.id,
    runId: row.run_id,
    status: row.status,
    revision: row.revision,
    inputSnapshot,
    claims,
    requirements,
    placeholders,
    auditReport: parseStoredObject(
      row.audit_report_json,
      brandGenerationAuditReportSchema,
      row.workspace_id,
      'brand_generation_items',
      'audit_report_json',
      true,
    ),
    attemptCount: row.attempt_count,
    automaticRevisionCount: row.automatic_revision_count,
    effectiveInputFingerprint: row.effective_input_fingerprint,
    provenance: parseStoredObject(
      row.provenance_json,
      brandGenerationProvenanceSchema,
      row.workspace_id,
      'brand_generation_items',
      'provenance_json',
      true,
    ),
    error: parseStoredObject(
      row.error_json,
      brandGenerationSanitizedErrorSchema,
      row.workspace_id,
      'brand_generation_items',
      'error_json',
      true,
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
  if (row.target === 'voice_foundation') {
    if (artifactExpectation !== null || row.content !== null
      || row.committed_deliverable_id !== null || row.committed_deliverable_version !== null) {
      throw new BrandGenerationPersistenceContractError('Stored foundation item has durable artifact fields');
    }
    return {
      ...base,
      target: 'voice_foundation',
      content: null,
      foundationDraft,
      artifactExpectation: null,
      committedDeliverableId: null,
      committedDeliverableVersion: null,
    } as unknown as BrandGenerationItem;
  }
  if (foundationDraft !== null || artifactExpectation === null) {
    throw new BrandGenerationPersistenceContractError('Stored durable item has an invalid artifact shape');
  }
  if ((row.committed_deliverable_id === null) !== (row.committed_deliverable_version === null)) {
    throw new BrandGenerationPersistenceContractError('Stored deliverable link is incomplete');
  }
  return {
    ...base,
    target: row.target,
    content: row.content,
    foundationDraft: null,
    artifactExpectation,
    committedDeliverableId: row.committed_deliverable_id,
    committedDeliverableVersion: row.committed_deliverable_version,
  } as BrandGenerationItem;
}

function rowToCommand(row: BrandGenerationCommandRow): BrandGenerationCommand {
  if (row.schema_version !== BRAND_GENERATION_CONTRACT_VERSION) {
    throw new BrandGenerationPersistenceContractError('Stored brand generation command schema is unsupported');
  }
  const requestSnapshot = parseStoredObject(
    row.request_snapshot_json,
    brandGenerationCommandRequestSnapshotSchema,
    row.workspace_id,
    'brand_generation_commands',
    'request_snapshot_json',
  );
  const result = parseStoredObject(
    row.result_json,
    brandGenerationAcceptedCommandResultSchema,
    row.workspace_id,
    'brand_generation_commands',
    'result_json',
  );
  if (!requestSnapshot || !result || requestSnapshot.kind !== row.command_kind
    || result.runId !== row.run_id || result.jobId !== row.job_id
    || canonicalBrandGenerationFingerprint(requestSnapshot.command) !== row.request_fingerprint) {
    throw new BrandGenerationPersistenceContractError('Stored brand generation command identity is invalid');
  }
  const { actor, context } = parseAttribution(
    row.actor_json,
    row.mcp_execution_context_json,
    row.workspace_id,
    'brand_generation_commands',
  );
  return {
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    kind: row.command_kind,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    requestSnapshot,
    itemId: row.item_id,
    expectedRunRevision: row.expected_run_revision,
    expectedItemRevision: row.expected_item_revision,
    expectedDeliverableVersion: row.expected_deliverable_version,
    priorItemStatus: row.prior_item_status,
    jobId: row.job_id,
    result,
    actor,
    mcpExecutionContext: context,
    createdAt: row.created_at,
  } as BrandGenerationCommand;
}

function rowToAttempt(row: BrandGenerationAttemptRow): BrandGenerationAttempt {
  if (row.schema_version !== BRAND_GENERATION_CONTRACT_VERSION) {
    throw new BrandGenerationPersistenceContractError('Stored brand generation attempt schema is unsupported');
  }
  const output = parseStoredObject(
    row.output_snapshot_json,
    brandGenerationAttemptOutputSchema,
    row.workspace_id,
    'brand_generation_attempts',
    'output_snapshot_json',
    true,
  );
  if (output) {
    try {
      assertAttemptOutputMatchesStage(row.stage, output);
    } catch (cause) {
      throw new BrandGenerationPersistenceContractError(
        'Stored attempt output does not match its stage',
        { cause },
      );
    }
  }
  const provenance = parseStoredObject(
    row.provenance_json,
    brandGenerationProvenanceSchema,
    row.workspace_id,
    'brand_generation_attempts',
    'provenance_json',
    true,
  );
  const error = parseStoredObject(
    row.error_json,
    brandGenerationSanitizedErrorSchema,
    row.workspace_id,
    'brand_generation_attempts',
    'error_json',
    true,
  );
  if ((row.status === 'running' && (output !== null || error !== null || row.completed_at !== null))
    || (row.status === 'completed' && (output === null || error !== null || row.completed_at === null))
    || (row.status === 'failed' && (output !== null || error === null || row.completed_at === null))
    || (row.status === 'cancelled' && (output !== null || row.completed_at === null))) {
    throw new BrandGenerationPersistenceContractError('Stored attempt lifecycle fields disagree');
  }
  return {
    id: row.id,
    runId: row.run_id,
    itemId: row.item_id,
    commandId: row.command_id,
    jobId: row.job_id,
    attemptNumber: row.attempt_number,
    stage: row.stage,
    status: row.status,
    expectedRunRevision: row.expected_run_revision,
    expectedItemRevision: row.expected_item_revision,
    expectedDeliverableVersion: row.expected_deliverable_version,
    effectiveInputFingerprint: row.effective_input_fingerprint,
    budgetUsage: {
      providerCalls: row.reserved_provider_calls,
      inputTokens: row.reserved_input_tokens,
      outputTokens: row.reserved_output_tokens,
      estimatedCostMicros: row.reserved_cost_microusd,
    },
    output,
    provenance,
    error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  } as BrandGenerationAttempt;
}

function deliverableFromRow(row: DeliverableRow): BrandDeliverable {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    deliverableType: row.deliverable_type,
    content: row.content,
    status: row.status,
    version: row.version,
    tier: row.tier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validatePreparedItems(
  request: StartBrandGenerationRequest | ResumeBrandGenerationRequest,
  items: [BrandGenerationPreparedItem, ...BrandGenerationPreparedItem[]],
): BrandGenerationPreparedItem[] {
  if (items.length > BRAND_GENERATION_LIMITS.maxTargets) {
    throw new BrandGenerationPersistenceContractError('Too many brand generation targets');
  }
  const seen = new Set<string>();
  for (const item of items) {
    const parsed = brandGenerationTargetInputSnapshotSchema.safeParse(item.inputSnapshot);
    if (!parsed.success || item.target !== item.inputSnapshot.target) {
      throw new BrandGenerationPersistenceContractError('Prepared item snapshot is invalid');
    }
    if (item.inputSnapshot.intakeRevision.intakeRevisionId !== ('intakeRevisionId' in request
      ? request.intakeRevisionId
      : item.inputSnapshot.intakeRevision.intakeRevisionId)) {
      throw new BrandGenerationPersistenceContractError('Prepared item intake identity is invalid');
    }
    if (seen.has(item.target)) {
      throw new BrandGenerationPersistenceContractError('Brand generation target cannot be selected twice');
    }
    seen.add(item.target);
  }
  return items;
}

function validateActorInput(
  workspaceId: string,
  actor: GenerationResolverAttribution,
  context: McpToolExecutionContext | null,
): void {
  if (!generationResolverAttributionSchema.safeParse(actor).success
    || (context !== null && !brandGenerationMcpExecutionContextSchema.safeParse(context).success)) {
    throw new BrandGenerationPersistenceContractError('Brand generation attribution is invalid');
  }
  assertAttributionContext(workspaceId, actor, context);
}

function validateArtifactExpectations(
  workspaceId: string,
  items: BrandGenerationPreparedItem[],
): void {
  for (const prepared of items) {
    if (prepared.target === 'voice_foundation') continue;
    const expectation = prepared.inputSnapshot.artifactExpectation;
    if (!expectation) {
      throw new BrandGenerationPersistenceContractError('Durable target is missing an artifact expectation');
    }
    const byType = stmts().deliverableByType.get(workspaceId, prepared.target) as DeliverableRow | undefined;
    if (expectation.kind === 'create') {
      if (byType?.status === 'approved') throw new BrandGenerationApprovedDeliverableError(byType.id);
      if (byType) {
        throw new BrandGenerationRevisionConflictError('deliverable', 0, byType.version);
      }
      continue;
    }
    const row = stmts().deliverableById.get(expectation.deliverableId, workspaceId) as DeliverableRow | undefined;
    if (!row || row.deliverable_type !== prepared.target) {
      throw new BrandGenerationRevisionConflictError('deliverable', expectation.expectedVersion, null);
    }
    if (row.status === 'approved') throw new BrandGenerationApprovedDeliverableError(row.id);
    if (row.version !== expectation.expectedVersion) {
      throw new BrandGenerationRevisionConflictError('deliverable', expectation.expectedVersion, row.version);
    }
  }
}

interface BrandGenerationItemCursorPayload {
  version: 1;
  workspaceId: string;
  runId: string;
  snapshotFingerprint: string;
  lastCreatedAt: string;
  lastItemId: string;
}

function cursorSignature(encodedPayload: string): string {
  return createHmac('sha256', JWT_SECRET)
    .update(`brand-generation-items:${encodedPayload}`)
    .digest('base64url');
}

function encodeItemCursor(payload: BrandGenerationItemCursorPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${cursorSignature(encodedPayload)}`;
}

function decodeItemCursor(
  cursor: string,
  workspaceId: string,
  runId: string,
): BrandGenerationItemCursorPayload {
  try {
    if (cursor.length > BRAND_GENERATION_LIMITS.maxCursorLength) throw new Error('cursor too long');
    const [encodedPayload, signature, extra] = cursor.split('.');
    if (!encodedPayload || !signature || extra) throw new Error('malformed cursor');
    const expected = Buffer.from(cursorSignature(encodedPayload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error('invalid cursor signature');
    }
    const decoded = parseJsonSafe(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      z.object({
        version: z.literal(1),
        workspaceId: z.string().min(1).max(BRAND_GENERATION_LIMITS.maxIdLength),
        runId: z.string().min(1).max(BRAND_GENERATION_LIMITS.maxIdLength),
        snapshotFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
        lastCreatedAt: z.string().datetime(),
        lastItemId: z.string().min(1).max(BRAND_GENERATION_LIMITS.maxIdLength),
      }).strict(),
      null,
      { workspaceId, table: 'brand_generation_items', field: 'cursor' },
    );
    if (!decoded || decoded.workspaceId !== workspaceId || decoded.runId !== runId) {
      throw new Error('cursor scope mismatch');
    }
    return decoded;
  } catch (cause) {
    throw new BrandGenerationCursorError(
      'Brand generation item cursor is invalid or stale',
      { cause },
    );
  }
}

export function getPersistedBrandGenerationRun(
  workspaceId: string,
  runId: string,
): PersistedBrandGenerationRun | null {
  const row = stmts().runById.get(runId, workspaceId) as BrandGenerationRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function getBrandGenerationRun(
  workspaceId: string,
  runId: string,
): BrandGenerationRun | null {
  const run = getPersistedBrandGenerationRun(workspaceId, runId);
  return run ? projectBrandGenerationRun(run) : null;
}

export function getBrandGenerationItem(
  workspaceId: string,
  runId: string,
  itemId: string,
): BrandGenerationItem | null {
  const row = stmts().itemById.get(itemId, runId, workspaceId) as BrandGenerationItemRow | undefined;
  return row ? rowToItem(row) : null;
}

export function getBrandGenerationAttempt(
  workspaceId: string,
  runId: string,
  itemId: string,
  attemptId: string,
): BrandGenerationAttempt | null {
  const row = stmts().attemptById.get(
    attemptId,
    itemId,
    runId,
    workspaceId,
  ) as BrandGenerationAttemptRow | undefined;
  return row ? rowToAttempt(row) : null;
}

export function listPersistedBrandGenerationItems(
  workspaceId: string,
  runId: string,
): BrandGenerationItem[] {
  const rows = stmts().itemsByRun.all(runId, workspaceId) as BrandGenerationItemRow[];
  return rows.map(rowToItem);
}

export function listBrandGenerationItemsPage(
  workspaceId: string,
  runId: string,
  options: { cursor?: string; limit?: number } = {},
): BrandGenerationItemPage {
  if (!getPersistedBrandGenerationRun(workspaceId, runId)) {
    throw new BrandGenerationNotFoundError('run');
  }
  const limit = options.limit ?? BRAND_GENERATION_LIMITS.defaultItemPageSize;
  if (!Number.isInteger(limit) || limit < 1 || limit > BRAND_GENERATION_LIMITS.maxItemPageSize) {
    throw new BrandGenerationPersistenceContractError('Brand generation item page limit is invalid');
  }
  const rows = stmts().itemsByRun.all(runId, workspaceId) as BrandGenerationItemRow[];
  const snapshotFingerprint = canonicalBrandGenerationFingerprint(
    rows.map(row => ({ id: row.id, revision: row.revision })),
  );
  const cursor = options.cursor ? decodeItemCursor(options.cursor, workspaceId, runId) : null;
  if (cursor && cursor.snapshotFingerprint !== snapshotFingerprint) {
    throw new BrandGenerationCursorError('Brand generation items changed after this cursor was issued');
  }
  const startIndex = cursor
    ? rows.findIndex(row => row.created_at === cursor.lastCreatedAt && row.id === cursor.lastItemId) + 1
    : 0;
  if (cursor && startIndex === 0) throw new BrandGenerationCursorError();
  const pageRows = rows.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + pageRows.length < rows.length;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(rowToItem),
    hasMore,
    nextCursor: hasMore && last
      ? encodeItemCursor({
          version: 1,
          workspaceId,
          runId,
          snapshotFingerprint,
          lastCreatedAt: last.created_at,
          lastItemId: last.id,
        })
      : null,
  };
}

export function getBrandGenerationCommand(
  workspaceId: string,
  runId: string,
  commandId: string,
): BrandGenerationCommand | null {
  const row = stmts().commandById.get(commandId, runId, workspaceId) as BrandGenerationCommandRow | undefined;
  return row ? rowToCommand(row) : null;
}

export function listBrandGenerationCommandsByJob(
  workspaceId: string,
  jobId: string,
): BrandGenerationCommand[] {
  return (stmts().commandsByJob.all(workspaceId, jobId) as BrandGenerationCommandRow[])
    .map(rowToCommand);
}

export function listActiveBrandGenerationRunsForRecovery(
  limit = 100,
): PersistedBrandGenerationRun[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new BrandGenerationPersistenceContractError('Recovery page limit is invalid');
  }
  return (stmts().activeRuns.all(limit) as BrandGenerationRunRow[]).map(rowToRun);
}

function expectedStartTargets(request: StartBrandGenerationRequest): readonly BrandGenerationItem['target'][] {
  if (request.selection.kind === 'atomic') return [request.selection.target];
  return BRAND_GENERATION_PRESET_POLICY[request.selection.preset].initialTargets;
}

function assertEstimateWithinOriginal(
  estimate: BrandGenerationBudgetEstimate,
  original: BrandGenerationBudgetEstimate,
): void {
  if (estimate.providerCalls > original.providerCalls
    || estimate.inputTokens > original.inputTokens
    || estimate.outputTokens > original.outputTokens
    || estimate.estimatedCostMicros > original.estimatedCostMicros
    || estimate.maxConcurrency > original.maxConcurrency) {
    throw new BrandGenerationPersistenceContractError(
      'Command estimate exceeds the original accepted run estimate',
    );
  }
}

function validateStartPreparedInputs(input: AcceptBrandGenerationStartCommandInput): void {
  const { request } = input;
  validateActorInput(request.workspaceId, request.createdBy, request.mcpExecutionContext);
  const items = validatePreparedItems(request, input.items);
  if (!arraysEqual(items.map(item => item.target), expectedStartTargets(request))) {
    throw new BrandGenerationPersistenceContractError('Prepared start targets do not match the selected policy');
  }
  if (!/^[0-9a-f]{64}$/.test(input.selectionFingerprint)
    || !/^[0-9a-f]{64}$/.test(input.effectiveInputFingerprint)) {
    throw new BrandGenerationPersistenceContractError('Start fingerprints must be canonical SHA-256 values');
  }
  if (!brandVoiceReadinessSchema.safeParse(input.voiceReadiness).success) {
    throw new BrandGenerationPersistenceContractError('Start voice readiness is invalid');
  }
  for (const item of items) {
    if (item.inputSnapshot.intakeRevision.intakeRevisionId !== request.intakeRevisionId
      || item.inputSnapshot.intakeRevision.revision !== request.expectedIntakeRevision
      || item.inputSnapshot.intakeRevision.fingerprint !== request.expectedIntakeFingerprint) {
      throw new BrandGenerationPersistenceContractError('Prepared start item does not freeze the requested intake');
    }
  }
  if ('expectedVoiceVersion' in request) {
    if (input.voiceReadiness.state !== 'finalized'
      || input.voiceReadiness.snapshot.voiceVersion !== request.expectedVoiceVersion
      || input.voiceReadiness.snapshot.fingerprint !== request.expectedVoiceFingerprint
      || items.some(item => item.inputSnapshot.voiceSnapshot?.voiceVersion !== request.expectedVoiceVersion
        || item.inputSnapshot.voiceSnapshot?.fingerprint !== request.expectedVoiceFingerprint)) {
      throw new BrandGenerationPersistenceContractError('Prepared start voice snapshot does not match the request');
    }
  } else if (items.some(item => item.inputSnapshot.voiceSnapshot !== null)) {
    throw new BrandGenerationPersistenceContractError('Bootstrap start cannot freeze a finalized voice');
  }
}

function insertPreparedItems(
  workspaceId: string,
  runId: string,
  items: BrandGenerationPreparedItem[],
  now: string,
): void {
  for (const prepared of items) {
    stmts().insertItem.run({
      id: `bgi_${randomUUID()}`,
      run_id: runId,
      workspace_id: workspaceId,
      target: prepared.target,
      input_snapshot_json: JSON.stringify(prepared.inputSnapshot),
      effective_input_fingerprint: prepared.inputSnapshot.fingerprint,
      artifact_expectation_json: prepared.inputSnapshot.artifactExpectation
        ? JSON.stringify(prepared.inputSnapshot.artifactExpectation)
        : null,
      created_at: now,
      updated_at: now,
    });
  }
}

interface InsertCommandInput {
  id: string;
  runId: string;
  workspaceId: string;
  itemId: string | null;
  kind: BrandGenerationCommand['kind'];
  idempotencyKey: string;
  requestFingerprint: string;
  requestSnapshot: BrandGenerationCommand['requestSnapshot'];
  expectedRunRevision: number | null;
  expectedItemRevision: number | null;
  expectedDeliverableVersion: number | null;
  priorItemStatus: 'ready_for_human_review' | 'changes_requested' | null;
  jobId: string;
  result: BrandGenerationAcceptedCommandResult;
  actor: GenerationResolverAttribution;
  context: McpToolExecutionContext | null;
  createdAt: string;
}

function insertCommand(input: InsertCommandInput): void {
  stmts().insertCommand.run({
    id: input.id,
    run_id: input.runId,
    workspace_id: input.workspaceId,
    item_id: input.itemId,
    command_kind: input.kind,
    idempotency_key: input.idempotencyKey,
    request_fingerprint: input.requestFingerprint,
    request_snapshot_json: JSON.stringify(input.requestSnapshot),
    expected_run_revision: input.expectedRunRevision,
    expected_item_revision: input.expectedItemRevision,
    expected_deliverable_version: input.expectedDeliverableVersion,
    prior_item_status: input.priorItemStatus,
    job_id: input.jobId,
    result_json: JSON.stringify(input.result),
    actor_json: JSON.stringify(input.actor),
    mcp_execution_context_json: input.context ? JSON.stringify(input.context) : null,
    created_at: input.createdAt,
  });
}

function replayResult(
  run: PersistedBrandGenerationRun,
  command: BrandGenerationCommand,
): BrandGenerationAcceptedPersistenceResult {
  return {
    run,
    command,
    items: listPersistedBrandGenerationItems(run.workspaceId, run.id),
    result: command.result,
    existing: true,
  };
}

/** Free replay probe intended to run before flags, source reads, or paid preflight. */
export function lookupBrandGenerationStartReplay(
  request: StartBrandGenerationRequest,
): BrandGenerationAcceptedPersistenceResult | null {
  const fingerprint = canonicalBrandGenerationFingerprint(
    startBrandGenerationCommandSnapshot(request),
  );
  const runRow = stmts().runByStartIdempotency.get(
    request.workspaceId,
    request.intakeRevisionId,
    request.idempotencyKey,
  ) as BrandGenerationRunRow | undefined;
  if (!runRow) return null;
  const commandRow = stmts().runCommandByIdempotency.get(
    runRow.id,
    request.workspaceId,
    'start',
    request.idempotencyKey,
  ) as BrandGenerationCommandRow | undefined;
  if (!commandRow) {
    throw new BrandGenerationPersistenceContractError('Start replay is missing its command ledger row');
  }
  if (commandRow.request_fingerprint !== fingerprint) {
    throw new BrandGenerationIdempotencyConflictError('start');
  }
  return replayResult(rowToRun(runRow), rowToCommand(commandRow));
}

export function lookupBrandGenerationResumeReplay(
  request: ResumeBrandGenerationRequest,
): BrandGenerationAcceptedPersistenceResult | null {
  const fingerprint = canonicalBrandGenerationFingerprint(
    resumeBrandGenerationCommandSnapshot(request),
  );
  const commandRow = stmts().runCommandByIdempotency.get(
    request.runId,
    request.workspaceId,
    'resume',
    request.idempotencyKey,
  ) as BrandGenerationCommandRow | undefined;
  if (!commandRow) return null;
  if (commandRow.request_fingerprint !== fingerprint) {
    throw new BrandGenerationIdempotencyConflictError('resume');
  }
  const run = getPersistedBrandGenerationRun(request.workspaceId, request.runId);
  if (!run) throw new BrandGenerationNotFoundError('run');
  return replayResult(run, rowToCommand(commandRow));
}

export function lookupBrandGenerationRevisionReplay(
  request: ReviseBrandGenerationItemRequest,
): BrandGenerationAcceptedPersistenceResult | null {
  const fingerprint = canonicalBrandGenerationFingerprint(
    reviseBrandGenerationItemCommandSnapshot(request),
  );
  const commandRow = stmts().itemCommandByIdempotency.get(
    request.runId,
    request.workspaceId,
    request.itemId,
    request.idempotencyKey,
  ) as BrandGenerationCommandRow | undefined;
  if (!commandRow) return null;
  if (commandRow.request_fingerprint !== fingerprint) {
    throw new BrandGenerationIdempotencyConflictError('revision');
  }
  const run = getPersistedBrandGenerationRun(request.workspaceId, request.runId);
  if (!run) throw new BrandGenerationNotFoundError('run');
  return replayResult(run, rowToCommand(commandRow));
}

export function acceptBrandGenerationStartCommand(
  input: AcceptBrandGenerationStartCommandInput,
): BrandGenerationAcceptedPersistenceResult {
  validateStartPreparedInputs(input);
  const limits = validateBrandGenerationBudgetRequest(input.request.budget);
  const estimate = validateBrandGenerationBudgetEstimate(input.estimate, limits);
  const commandBusiness = startBrandGenerationCommandSnapshot(input.request);
  const requestFingerprint = canonicalBrandGenerationFingerprint(commandBusiness);
  const accept = db.transaction((): BrandGenerationAcceptedPersistenceResult => {
    const replayRow = stmts().runByStartIdempotency.get(
      input.request.workspaceId,
      input.request.intakeRevisionId,
      input.request.idempotencyKey,
    ) as BrandGenerationRunRow | undefined;
    if (replayRow) {
      const commandRow = stmts().runCommandByIdempotency.get(
        replayRow.id,
        input.request.workspaceId,
        'start',
        input.request.idempotencyKey,
      ) as BrandGenerationCommandRow | undefined;
      if (!commandRow || commandRow.request_fingerprint !== requestFingerprint) {
        throw new BrandGenerationIdempotencyConflictError('start');
      }
      return replayResult(rowToRun(replayRow), rowToCommand(commandRow));
    }

    const intake = stmts().intakeRevision.get(
      input.request.intakeRevisionId,
      input.request.workspaceId,
    ) as { id: string; workspace_id: string; revision: number; fingerprint: string } | undefined;
    if (!intake) throw new BrandGenerationNotFoundError('run');
    const currentIntake = stmts().currentIntakeRevision.get(
      input.request.workspaceId,
    ) as { id: string; workspace_id: string; revision: number; fingerprint: string } | undefined;
    if (!currentIntake || currentIntake.id !== intake.id
      || intake.revision !== input.request.expectedIntakeRevision
      || intake.fingerprint !== input.request.expectedIntakeFingerprint) {
      throw new BrandGenerationRevisionConflictError(
        'run',
        input.request.expectedIntakeRevision,
        currentIntake?.revision ?? intake.revision,
      );
    }
    validateArtifactExpectations(input.request.workspaceId, input.items);
    const runId = `bgr_${randomUUID()}`;
    const now = new Date().toISOString();
    stmts().insertRun.run({
      id: runId,
      workspace_id: input.request.workspaceId,
      intake_revision_id: intake.id,
      intake_revision: intake.revision,
      intake_fingerprint: intake.fingerprint,
      selection_json: JSON.stringify(input.request.selection),
      dispatch_targets_json: JSON.stringify(input.items.map(item => item.target)),
      idempotency_key: input.request.idempotencyKey,
      selection_fingerprint: input.selectionFingerprint,
      effective_input_fingerprint: input.effectiveInputFingerprint,
      voice_snapshot_json: JSON.stringify(input.voiceReadiness),
      current_job_id: input.jobId,
      estimated_provider_calls: estimate.providerCalls,
      estimated_input_tokens: estimate.inputTokens,
      estimated_output_tokens: estimate.outputTokens,
      estimated_cost_microusd: estimate.estimatedCostMicros,
      max_provider_calls: limits.providerCalls,
      max_input_tokens: limits.inputTokens,
      max_output_tokens: limits.outputTokens,
      max_cost_microusd: limits.maxEstimatedCostMicros,
      max_concurrency: limits.maxConcurrency,
      created_by_json: JSON.stringify(input.request.createdBy),
      mcp_execution_context_json: input.request.mcpExecutionContext
        ? JSON.stringify(input.request.mcpExecutionContext)
        : null,
      created_at: now,
      updated_at: now,
    });
    insertPreparedItems(input.request.workspaceId, runId, input.items, now);
    persistDerivedCounts(input.request.workspaceId, runId, now);
    const result: BrandGenerationAcceptedCommandResult = {
      runId,
      runRevision: 0,
      jobId: input.jobId,
      selectionCount: input.items.length,
      estimate,
      dashboardUrl: input.dashboardUrl,
    };
    const commandId = `bgc_${randomUUID()}`;
    insertCommand({
      id: commandId,
      runId,
      workspaceId: input.request.workspaceId,
      itemId: null,
      kind: 'start',
      idempotencyKey: input.request.idempotencyKey,
      requestFingerprint,
      requestSnapshot: { schemaVersion: 1, kind: 'start', command: commandBusiness },
      expectedRunRevision: null,
      expectedItemRevision: null,
      expectedDeliverableVersion: null,
      priorItemStatus: null,
      jobId: input.jobId,
      result,
      actor: input.request.createdBy,
      context: input.request.mcpExecutionContext,
      createdAt: now,
    });
    const run = getPersistedBrandGenerationRun(input.request.workspaceId, runId);
    const command = getBrandGenerationCommand(input.request.workspaceId, runId, commandId);
    if (!run || !command) throw new BrandGenerationPersistenceContractError('Accepted start did not persist');
    return { run, command, items: listPersistedBrandGenerationItems(input.request.workspaceId, runId), result, existing: false };
  });
  return accept.immediate();
}

export function acceptBrandGenerationResumeCommand(
  input: AcceptBrandGenerationResumeCommandInput,
): BrandGenerationAcceptedPersistenceResult {
  const { request } = input;
  validateActorInput(request.workspaceId, request.resumedBy, request.mcpExecutionContext);
  const items = validatePreparedItems(request, input.items);
  if (!arraysEqual(items.map(item => item.target), BRAND_GENERATION_PRESET_POLICY.full_brand_system.resumeTargets)
    || items.some(item => item.inputSnapshot.voiceSnapshot?.voiceVersion !== request.expectedVoiceVersion
      || item.inputSnapshot.voiceSnapshot?.fingerprint !== request.expectedVoiceFingerprint)
    || input.voiceReadiness.snapshot.voiceVersion !== request.expectedVoiceVersion
    || input.voiceReadiness.snapshot.fingerprint !== request.expectedVoiceFingerprint) {
    throw new BrandGenerationPersistenceContractError('Prepared resume inputs do not match the finalized voice');
  }
  const commandBusiness = resumeBrandGenerationCommandSnapshot(request);
  const requestFingerprint = canonicalBrandGenerationFingerprint(commandBusiness);
  const accept = db.transaction((): BrandGenerationAcceptedPersistenceResult => {
    const replayRow = stmts().runCommandByIdempotency.get(
      request.runId, request.workspaceId, 'resume', request.idempotencyKey,
    ) as BrandGenerationCommandRow | undefined;
    if (replayRow) {
      if (replayRow.request_fingerprint !== requestFingerprint) {
        throw new BrandGenerationIdempotencyConflictError('resume');
      }
      const run = getPersistedBrandGenerationRun(request.workspaceId, request.runId);
      if (!run) throw new BrandGenerationNotFoundError('run');
      return replayResult(run, rowToCommand(replayRow));
    }
    const runRow = stmts().runById.get(request.runId, request.workspaceId) as BrandGenerationRunRow | undefined;
    if (!runRow) throw new BrandGenerationNotFoundError('run');
    const run = rowToRun(runRow);
    if (run.revision !== request.expectedRunRevision) {
      throw new BrandGenerationRevisionConflictError('run', request.expectedRunRevision, run.revision);
    }
    if (run.selection.kind !== 'preset' || run.selection.preset !== 'full_brand_system'
      || run.status !== 'awaiting_review' || run.stage !== 'awaiting_voice_finalization') {
      throw new BrandGenerationPersistenceContractError('Only a paused full brand system run can resume');
    }
    for (const item of items) {
      if (item.inputSnapshot.intakeRevision.intakeRevisionId !== run.intakeRevision.intakeRevisionId
        || item.inputSnapshot.intakeRevision.revision !== run.intakeRevision.revision
        || item.inputSnapshot.intakeRevision.fingerprint !== run.intakeRevision.fingerprint) {
        throw new BrandGenerationPersistenceContractError('Prepared resume item changed the frozen intake');
      }
    }
    validateArtifactExpectations(request.workspaceId, items);
    validateTransition('brand_generation_run', BRAND_GENERATION_RUN_TRANSITIONS, run.status, 'running');
    const estimate = validateBrandGenerationBudgetEstimate(input.estimate, run.budget.limits);
    assertEstimateWithinOriginal(estimate, run.budget.estimate);
    const now = new Date().toISOString();
    const update = stmts().updateRunForCommand.run({
      id: run.id,
      workspace_id: request.workspaceId,
      expected_revision: request.expectedRunRevision,
      dispatch_targets_json: JSON.stringify(items.map(item => item.target)),
      status: 'running',
      stage: 'dependent_generation',
      voice_snapshot_json: JSON.stringify(input.voiceReadiness),
      current_job_id: input.jobId,
      estimated_provider_calls: run.budget.estimate.providerCalls,
      estimated_input_tokens: run.budget.estimate.inputTokens,
      estimated_output_tokens: run.budget.estimate.outputTokens,
      estimated_cost_microusd: run.budget.estimate.estimatedCostMicros,
      updated_at: now,
    });
    if (update.changes !== 1) {
      throw new BrandGenerationRevisionConflictError('run', request.expectedRunRevision, null);
    }
    insertPreparedItems(request.workspaceId, run.id, items, now);
    persistDerivedCounts(request.workspaceId, run.id, now);
    const result: BrandGenerationAcceptedCommandResult = {
      runId: run.id,
      runRevision: run.revision + 1,
      jobId: input.jobId,
      selectionCount: items.length,
      estimate,
      dashboardUrl: input.dashboardUrl,
    };
    const commandId = `bgc_${randomUUID()}`;
    insertCommand({
      id: commandId, runId: run.id, workspaceId: request.workspaceId, itemId: null,
      kind: 'resume', idempotencyKey: request.idempotencyKey, requestFingerprint,
      requestSnapshot: { schemaVersion: 1, kind: 'resume', command: commandBusiness },
      expectedRunRevision: request.expectedRunRevision, expectedItemRevision: null,
      expectedDeliverableVersion: null, priorItemStatus: null, jobId: input.jobId,
      result, actor: request.resumedBy, context: request.mcpExecutionContext, createdAt: now,
    });
    const persistedRun = getPersistedBrandGenerationRun(request.workspaceId, run.id);
    const command = getBrandGenerationCommand(request.workspaceId, run.id, commandId);
    if (!persistedRun || !command) throw new BrandGenerationPersistenceContractError('Accepted resume did not persist');
    return { run: persistedRun, command, items: listPersistedBrandGenerationItems(request.workspaceId, run.id), result, existing: false };
  });
  return accept.immediate();
}

export function acceptBrandGenerationRevisionCommand(
  input: AcceptBrandGenerationRevisionCommandInput,
): BrandGenerationAcceptedPersistenceResult {
  const { request } = input;
  validateActorInput(request.workspaceId, request.requestedBy, request.mcpExecutionContext);
  const commandBusiness = reviseBrandGenerationItemCommandSnapshot(request);
  const requestFingerprint = canonicalBrandGenerationFingerprint(commandBusiness);
  const accept = db.transaction((): BrandGenerationAcceptedPersistenceResult => {
    const replayRow = stmts().itemCommandByIdempotency.get(
      request.runId, request.workspaceId, request.itemId, request.idempotencyKey,
    ) as BrandGenerationCommandRow | undefined;
    if (replayRow) {
      if (replayRow.request_fingerprint !== requestFingerprint) {
        throw new BrandGenerationIdempotencyConflictError('revision');
      }
      const run = getPersistedBrandGenerationRun(request.workspaceId, request.runId);
      if (!run) throw new BrandGenerationNotFoundError('run');
      return replayResult(run, rowToCommand(replayRow));
    }
    const runRow = stmts().runById.get(request.runId, request.workspaceId) as BrandGenerationRunRow | undefined;
    const itemRow = stmts().itemById.get(request.itemId, request.runId, request.workspaceId) as BrandGenerationItemRow | undefined;
    if (!runRow) throw new BrandGenerationNotFoundError('run');
    if (!itemRow) throw new BrandGenerationNotFoundError('item');
    const run = rowToRun(runRow);
    const item = rowToItem(itemRow);
    if (run.revision !== request.expectedRunRevision) {
      throw new BrandGenerationRevisionConflictError('run', request.expectedRunRevision, run.revision);
    }
    if (item.revision !== request.expectedItemRevision) {
      throw new BrandGenerationRevisionConflictError('item', request.expectedItemRevision, item.revision);
    }
    if (item.target === 'voice_foundation' || item.committedDeliverableId !== request.deliverableId) {
      throw new BrandGenerationPersistenceContractError('Revision item is not linked to the requested deliverable');
    }
    if (!brandGenerationTargetInputSnapshotSchema.safeParse(input.inputSnapshot).success
      || input.inputSnapshot.target !== item.target
      || input.inputSnapshot.artifactExpectation?.kind !== 'update'
      || input.inputSnapshot.artifactExpectation.deliverableId !== request.deliverableId
      || input.inputSnapshot.artifactExpectation.expectedVersion !== request.expectedDeliverableVersion
      || !item.inputSnapshot) {
      throw new BrandGenerationPersistenceContractError('Revision snapshot does not bind the requested artifact version');
    }
    const authorityCore = (snapshot: BrandGenerationTargetInputSnapshot) => ({
      target: snapshot.target,
      intakeRevision: snapshot.intakeRevision,
      voiceSnapshot: snapshot.voiceSnapshot,
      approvedDeliverables: snapshot.approvedDeliverables,
      evidenceRequirementIds: snapshot.evidenceRequirementIds,
    });
    if (canonicalBrandGenerationFingerprint(authorityCore(input.inputSnapshot))
      !== canonicalBrandGenerationFingerprint(authorityCore(item.inputSnapshot))) {
      throw new BrandGenerationPersistenceContractError('Revision snapshot changed frozen authority inputs');
    }
    if (item.status !== 'ready_for_human_review' && item.status !== 'changes_requested') {
      throw new BrandGenerationPersistenceContractError('Revision requires a prior review state');
    }
    const deliverable = stmts().deliverableById.get(request.deliverableId, request.workspaceId) as DeliverableRow | undefined;
    if (!deliverable) throw new BrandGenerationNotFoundError('deliverable');
    if (deliverable.status === 'approved') throw new BrandGenerationApprovedDeliverableError(deliverable.id);
    if (deliverable.version !== request.expectedDeliverableVersion) {
      throw new BrandGenerationRevisionConflictError('deliverable', request.expectedDeliverableVersion, deliverable.version);
    }
    validateTransition('brand_generation_item', BRAND_GENERATION_ITEM_TRANSITIONS, item.status, 'revising');
    validateTransition('brand_generation_run', BRAND_GENERATION_RUN_TRANSITIONS, run.status, 'running');
    const estimate = validateBrandGenerationBudgetEstimate(input.estimate, run.budget.limits);
    assertEstimateWithinOriginal(estimate, run.budget.estimate);
    const now = new Date().toISOString();
    const itemUpdate = writeItemTransition(itemRow, 'revising', {
      inputSnapshot: input.inputSnapshot,
      effectiveInputFingerprint: input.inputSnapshot.fingerprint,
      error: null,
      completedAt: null,
    }, now);
    if (itemUpdate.changes !== 1) throw new BrandGenerationRevisionConflictError('item', item.revision, null);
    const runUpdate = stmts().updateRunForCommand.run({
      id: run.id, workspace_id: request.workspaceId, expected_revision: run.revision,
      dispatch_targets_json: JSON.stringify(run.selectedTargets), status: 'running', stage: 'revision',
      voice_snapshot_json: JSON.stringify(run.voiceReadiness), current_job_id: input.jobId,
      estimated_provider_calls: run.budget.estimate.providerCalls,
      estimated_input_tokens: run.budget.estimate.inputTokens,
      estimated_output_tokens: run.budget.estimate.outputTokens,
      estimated_cost_microusd: run.budget.estimate.estimatedCostMicros,
      updated_at: now,
    });
    if (runUpdate.changes !== 1) throw new BrandGenerationRevisionConflictError('run', run.revision, null);
    persistDerivedCounts(request.workspaceId, run.id, now);
    const result: BrandGenerationAcceptedCommandResult = {
      runId: run.id, runRevision: run.revision + 1, jobId: input.jobId,
      selectionCount: 1, estimate, dashboardUrl: input.dashboardUrl,
    };
    const commandId = `bgc_${randomUUID()}`;
    insertCommand({
      id: commandId, runId: run.id, workspaceId: request.workspaceId, itemId: item.id,
      kind: 'revision', idempotencyKey: request.idempotencyKey, requestFingerprint,
      requestSnapshot: { schemaVersion: 1, kind: 'revision', command: commandBusiness },
      expectedRunRevision: request.expectedRunRevision, expectedItemRevision: request.expectedItemRevision,
      expectedDeliverableVersion: request.expectedDeliverableVersion, priorItemStatus: item.status,
      jobId: input.jobId, result, actor: request.requestedBy,
      context: request.mcpExecutionContext, createdAt: now,
    });
    const persistedRun = getPersistedBrandGenerationRun(request.workspaceId, run.id);
    const command = getBrandGenerationCommand(request.workspaceId, run.id, commandId);
    if (!persistedRun || !command) throw new BrandGenerationPersistenceContractError('Accepted revision did not persist');
    return { run: persistedRun, command, items: listPersistedBrandGenerationItems(request.workspaceId, run.id), result, existing: false };
  });
  return accept.immediate();
}

function writeItemTransition(
  row: BrandGenerationItemRow,
  nextStatus: BrandGenerationItemStatus,
  patch: TransitionBrandGenerationItemPatch,
  now: string,
  committed?: { id: string | null; version: number | null },
) {
  const current = rowToItem(row);
  const value = <K extends keyof TransitionBrandGenerationItemPatch>(
    key: K,
    fallback: TransitionBrandGenerationItemPatch[K],
  ): TransitionBrandGenerationItemPatch[K] => (
    Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : fallback
  );
  const inputSnapshot = value('inputSnapshot', current.inputSnapshot);
  const foundationDraft = value('foundationDraft', current.foundationDraft);
  const content = value('content', current.content);
  const claims = value('claims', current.claims) ?? [];
  const requirements = value('requirements', current.requirements) ?? [];
  const placeholders = value('placeholders', current.placeholders) ?? [];
  const auditReport = value('auditReport', current.auditReport);
  const provenance = value('provenance', current.provenance);
  const error = value('error', current.error);
  if ((inputSnapshot !== null && !brandGenerationTargetInputSnapshotSchema.safeParse(inputSnapshot).success)
    || (foundationDraft !== null && !brandVoiceFoundationDraftSchema.safeParse(foundationDraft).success)
    || !z.array(brandGeneratedClaimSchema).safeParse(claims).success
    || !z.array(brandGenerationEvidenceRequirementSchema).safeParse(requirements).success
    || !z.array(brandGenerationPlaceholderSchema).safeParse(placeholders).success
    || (auditReport !== null && !brandGenerationAuditReportSchema.safeParse(auditReport).success)
    || (provenance !== null && !brandGenerationProvenanceSchema.safeParse(provenance).success)
    || (error !== null && !brandGenerationSanitizedErrorSchema.safeParse(error).success)) {
    throw new BrandGenerationPersistenceContractError('Brand generation item patch is invalid');
  }
  return stmts().updateItem.run({
    id: row.id,
    run_id: row.run_id,
    workspace_id: row.workspace_id,
    expected_revision: row.revision,
    status: nextStatus,
    input_snapshot_json: inputSnapshot ? JSON.stringify(inputSnapshot) : null,
    foundation_draft_json: foundationDraft ? JSON.stringify(foundationDraft) : null,
    content,
    claims_json: JSON.stringify(claims),
    requirements_json: JSON.stringify(requirements),
    placeholders_json: JSON.stringify(placeholders),
    audit_report_json: auditReport ? JSON.stringify(auditReport) : null,
    automatic_revision_count: value('automaticRevisionCount', current.automaticRevisionCount),
    effective_input_fingerprint: value('effectiveInputFingerprint', current.effectiveInputFingerprint),
    provenance_json: provenance ? JSON.stringify(provenance) : null,
    error_json: error ? JSON.stringify(error) : null,
    artifact_expectation_json: inputSnapshot?.artifactExpectation
      ? JSON.stringify(inputSnapshot.artifactExpectation)
      : null,
    committed_deliverable_id: committed?.id ?? current.committedDeliverableId,
    committed_deliverable_version: committed?.version ?? current.committedDeliverableVersion,
    updated_at: now,
    completed_at: value('completedAt', current.completedAt),
  });
}

export function transitionBrandGenerationItem(
  input: TransitionBrandGenerationItemInput,
): BrandGenerationItem {
  const transition = db.transaction((): BrandGenerationItem => {
    const row = stmts().itemById.get(input.itemId, input.runId, input.workspaceId) as BrandGenerationItemRow | undefined;
    if (!row) throw new BrandGenerationNotFoundError('item');
    if (row.revision !== input.expectedRevision) {
      throw new BrandGenerationRevisionConflictError('item', input.expectedRevision, row.revision);
    }
    validateTransition('brand_generation_item', BRAND_GENERATION_ITEM_TRANSITIONS, row.status, input.nextStatus);
    const now = new Date().toISOString();
    if (writeItemTransition(row, input.nextStatus, input.patch ?? {}, now).changes !== 1) {
      throw new BrandGenerationRevisionConflictError('item', input.expectedRevision, null);
    }
    persistDerivedCounts(input.workspaceId, input.runId, now);
    const next = getBrandGenerationItem(input.workspaceId, input.runId, input.itemId);
    if (!next) throw new BrandGenerationNotFoundError('item');
    return next;
  });
  return transition.immediate();
}

export function transitionBrandGenerationRun(
  input: TransitionBrandGenerationRunInput,
): PersistedBrandGenerationRun {
  const transition = db.transaction((): PersistedBrandGenerationRun => {
    const row = stmts().runById.get(input.runId, input.workspaceId) as BrandGenerationRunRow | undefined;
    if (!row) throw new BrandGenerationNotFoundError('run');
    if (row.revision !== input.expectedRevision) {
      throw new BrandGenerationRevisionConflictError('run', input.expectedRevision, row.revision);
    }
    validateTransition('brand_generation_run', BRAND_GENERATION_RUN_TRANSITIONS, row.status, input.nextStatus);
    const voice = input.voiceReadiness ?? rowToRun(row).voiceReadiness;
    if (!brandVoiceReadinessSchema.safeParse(voice).success) {
      throw new BrandGenerationPersistenceContractError('Run voice readiness is invalid');
    }
    const now = new Date().toISOString();
    const update = stmts().updateRunTransition.run({
      id: input.runId,
      workspace_id: input.workspaceId,
      expected_revision: input.expectedRevision,
      status: input.nextStatus,
      stage: input.nextStage,
      current_job_id: input.currentJobId === undefined ? row.current_job_id : input.currentJobId,
      voice_snapshot_json: JSON.stringify(voice),
      updated_at: now,
      completed_at: input.completedAt === undefined ? row.completed_at : input.completedAt,
    });
    if (update.changes !== 1) {
      throw new BrandGenerationRevisionConflictError('run', input.expectedRevision, null);
    }
    const next = getPersistedBrandGenerationRun(input.workspaceId, input.runId);
    if (!next) throw new BrandGenerationNotFoundError('run');
    return next;
  });
  return transition.immediate();
}

function assertArtifactStillMatchesItem(workspaceId: string, item: BrandGenerationItem): void {
  if (item.target === 'voice_foundation') return;
  const expectation = item.artifactExpectation;
  if (expectation.kind === 'create') {
    const existing = stmts().deliverableByType.get(workspaceId, item.target) as DeliverableRow | undefined;
    if (existing?.status === 'approved') throw new BrandGenerationApprovedDeliverableError(existing.id);
    if (existing) throw new BrandGenerationRevisionConflictError('deliverable', 0, existing.version);
    return;
  }
  const existing = stmts().deliverableById.get(expectation.deliverableId, workspaceId) as DeliverableRow | undefined;
  if (!existing || existing.deliverable_type !== item.target) {
    throw new BrandGenerationRevisionConflictError('deliverable', expectation.expectedVersion, null);
  }
  if (existing.status === 'approved') throw new BrandGenerationApprovedDeliverableError(existing.id);
  if (existing.version !== expectation.expectedVersion) {
    throw new BrandGenerationRevisionConflictError('deliverable', expectation.expectedVersion, existing.version);
  }
}

function reserveRunBudget(
  row: BrandGenerationRunRow,
  reservation: BrandGenerationBudgetUsage,
  now: string,
): BrandGenerationBudgetUsage {
  const current = {
    providerCalls: row.reserved_provider_calls,
    inputTokens: row.reserved_input_tokens,
    outputTokens: row.reserved_output_tokens,
    estimatedCostMicros: row.reserved_cost_microusd,
  };
  const next = addBrandGenerationBudgetUsage(current, reservation);
  assertBrandGenerationReservationFits(next, {
    providerCalls: row.max_provider_calls,
    inputTokens: row.max_input_tokens,
    outputTokens: row.max_output_tokens,
    maxEstimatedCostMicros: row.max_cost_microusd,
    maxConcurrency: row.max_concurrency,
  });
  stmts().reserveBudget.run({
    id: row.id,
    workspace_id: row.workspace_id,
    provider_calls: next.providerCalls,
    input_tokens: next.inputTokens,
    output_tokens: next.outputTokens,
    cost_microusd: next.estimatedCostMicros,
    updated_at: now,
  });
  return next;
}

function isZeroBudgetUsage(usage: BrandGenerationBudgetUsage): boolean {
  return usage.providerCalls === 0
    && usage.inputTokens === 0
    && usage.outputTokens === 0
    && usage.estimatedCostMicros === 0;
}

function expectedArtifactVersion(item: BrandGenerationItem): number | null {
  if (item.target === 'voice_foundation') return null;
  return item.artifactExpectation.expectedVersion;
}

function assertAttemptStageAllowed(
  run: BrandGenerationRunRow,
  item: BrandGenerationItemRow,
  command: BrandGenerationCommandRow,
  stage: BrandGenerationAttemptStage,
): void {
  const expectedRunStage = command.command_kind === 'revision'
    ? 'revision'
    : item.target === 'voice_foundation'
      ? 'voice_foundation_generation'
      : 'dependent_generation';
  const itemStageAllowed = (
    (stage === 'preflight' && (
      item.status === 'preflighting'
      || (command.command_kind === 'revision' && item.status === 'revising')
    ))
    || (stage === 'voice_foundation_generation'
      && item.target === 'voice_foundation' && item.status === 'generating')
    || (stage === 'dependent_generation'
      && item.target !== 'voice_foundation' && item.status === 'generating')
    || (stage === 'revision'
      && item.target !== 'voice_foundation' && item.status === 'revising')
    || (stage === 'deterministic_audit' && item.status === 'auditing_deterministic')
    || (stage === 'model_audit' && item.status === 'auditing_model')
  );
  if (run.stage !== expectedRunStage || !itemStageAllowed) {
    throw new BrandGenerationPersistenceContractError(
      'Attempt stage is not legal for the current run and item lifecycle',
    );
  }
}

export function beginBrandGenerationAttempt(
  input: BeginBrandGenerationAttemptInput,
): BrandGenerationAttempt {
  validateBrandGenerationBudgetUsage(input.reservation);
  const begin = db.transaction((): BrandGenerationAttempt => {
    const runRow = stmts().runById.get(input.runId, input.workspaceId) as BrandGenerationRunRow | undefined;
    const itemRow = stmts().itemById.get(input.itemId, input.runId, input.workspaceId) as BrandGenerationItemRow | undefined;
    const commandRow = stmts().commandById.get(input.commandId, input.runId, input.workspaceId) as BrandGenerationCommandRow | undefined;
    if (!runRow) throw new BrandGenerationNotFoundError('run');
    if (!itemRow) throw new BrandGenerationNotFoundError('item');
    if (!commandRow) throw new BrandGenerationNotFoundError('command');
    if (runRow.revision !== input.expectedRunRevision) {
      throw new BrandGenerationRevisionConflictError('run', input.expectedRunRevision, runRow.revision);
    }
    if (itemRow.revision !== input.expectedItemRevision) {
      throw new BrandGenerationRevisionConflictError('item', input.expectedItemRevision, itemRow.revision);
    }
    if (runRow.status !== 'running' || runRow.current_job_id !== input.jobId
      || commandRow.job_id !== input.jobId
      || (commandRow.item_id !== null && commandRow.item_id !== input.itemId)) {
      throw new BrandGenerationPersistenceContractError('Attempt command is not active for this item');
    }
    const item = rowToItem(itemRow);
    assertArtifactStillMatchesItem(input.workspaceId, item);
    if (input.expectedDeliverableVersion !== expectedArtifactVersion(item)) {
      throw new BrandGenerationAttemptCheckpointConflictError();
    }
    assertAttemptStageAllowed(runRow, itemRow, commandRow, input.stage);
    const active = stmts().activeAttemptForCommandStage.get(
      input.itemId,
      input.runId,
      input.workspaceId,
      input.commandId,
      input.stage,
    ) as BrandGenerationAttemptRow | undefined;
    if (active) {
      if (active.job_id !== input.jobId
        || active.expected_run_revision !== input.expectedRunRevision
        || active.expected_item_revision !== input.expectedItemRevision
        || active.expected_deliverable_version !== input.expectedDeliverableVersion
        || active.effective_input_fingerprint !== input.effectiveInputFingerprint
        || !isZeroBudgetUsage(input.reservation)) {
        throw new BrandGenerationAttemptCheckpointConflictError();
      }
      return rowToAttempt(active);
    }
    const running = stmts().runningAttemptCount.get(input.runId, input.workspaceId) as { count: number };
    if (running.count >= runRow.max_concurrency) {
      throw new BrandGenerationConcurrencyLimitError(running.count, runRow.max_concurrency);
    }
    const now = new Date().toISOString();
    reserveRunBudget(runRow, input.reservation, now);
    const next = stmts().nextAttemptNumber.get(input.itemId, input.stage) as { next_number: number };
    const attemptId = `bga_${randomUUID()}`;
    stmts().insertAttempt.run({
      id: attemptId,
      item_id: input.itemId,
      run_id: input.runId,
      command_id: input.commandId,
      attempt_number: next.next_number,
      stage: input.stage,
      expected_run_revision: input.expectedRunRevision,
      expected_item_revision: input.expectedItemRevision,
      expected_deliverable_version: input.expectedDeliverableVersion,
      effective_input_fingerprint: input.effectiveInputFingerprint,
      reserved_provider_calls: input.reservation.providerCalls,
      reserved_input_tokens: input.reservation.inputTokens,
      reserved_output_tokens: input.reservation.outputTokens,
      reserved_cost_microusd: input.reservation.estimatedCostMicros,
      started_at: now,
    });
    stmts().refreshItemAttemptCount.run({
      item_id: input.itemId,
      run_id: input.runId,
      workspace_id: input.workspaceId,
      updated_at: now,
    });
    const row = stmts().attemptById.get(
      attemptId, input.itemId, input.runId, input.workspaceId,
    ) as BrandGenerationAttemptRow;
    return rowToAttempt(row);
  });
  return begin.immediate();
}

export function reserveBrandGenerationAttemptBudget(
  input: ReserveBrandGenerationAttemptBudgetInput,
): BrandGenerationAttempt {
  validateBrandGenerationBudgetUsage(input.reservation);
  const reserve = db.transaction((): BrandGenerationAttempt => {
    const runRow = stmts().runById.get(input.runId, input.workspaceId) as BrandGenerationRunRow | undefined;
    const itemRow = stmts().itemById.get(input.itemId, input.runId, input.workspaceId) as BrandGenerationItemRow | undefined;
    const attemptRow = stmts().attemptById.get(
      input.attemptId, input.itemId, input.runId, input.workspaceId,
    ) as BrandGenerationAttemptRow | undefined;
    if (!runRow) throw new BrandGenerationNotFoundError('run');
    if (!itemRow) throw new BrandGenerationNotFoundError('item');
    if (!attemptRow) throw new BrandGenerationNotFoundError('attempt');
    if (runRow.revision !== input.expectedRunRevision) {
      throw new BrandGenerationRevisionConflictError('run', input.expectedRunRevision, runRow.revision);
    }
    if (itemRow.revision !== input.expectedItemRevision) {
      throw new BrandGenerationRevisionConflictError('item', input.expectedItemRevision, itemRow.revision);
    }
    if (runRow.status !== 'running' || attemptRow.status !== 'running') {
      throw new BrandGenerationPersistenceContractError('Only a running attempt may reserve provider budget');
    }
    const now = new Date().toISOString();
    reserveRunBudget(runRow, input.reservation, now);
    const nextAttemptUsage = addBrandGenerationBudgetUsage({
      providerCalls: attemptRow.reserved_provider_calls,
      inputTokens: attemptRow.reserved_input_tokens,
      outputTokens: attemptRow.reserved_output_tokens,
      estimatedCostMicros: attemptRow.reserved_cost_microusd,
    }, input.reservation);
    const updated = stmts().reserveAttemptBudget.run({
      id: input.attemptId,
      item_id: input.itemId,
      run_id: input.runId,
      provider_calls: nextAttemptUsage.providerCalls,
      input_tokens: nextAttemptUsage.inputTokens,
      output_tokens: nextAttemptUsage.outputTokens,
      cost_microusd: nextAttemptUsage.estimatedCostMicros,
    });
    if (updated.changes !== 1) throw new BrandGenerationAttemptCheckpointConflictError();
    const row = stmts().attemptById.get(
      input.attemptId, input.itemId, input.runId, input.workspaceId,
    ) as BrandGenerationAttemptRow;
    return rowToAttempt(row);
  });
  return reserve.immediate();
}

export function completeBrandGenerationAttempt(
  input: CompleteBrandGenerationAttemptInput,
): BrandGenerationAttempt {
  const parsed = brandGenerationAttemptOutputSchema.safeParse(input.output);
  if (!parsed.success
    || (input.provenance !== null && !brandGenerationProvenanceSchema.safeParse(input.provenance).success)) {
    throw new BrandGenerationPersistenceContractError('Completed attempt output is invalid');
  }
  const complete = db.transaction((): BrandGenerationAttempt => {
    const row = stmts().attemptById.get(
      input.attemptId, input.itemId, input.runId, input.workspaceId,
    ) as BrandGenerationAttemptRow | undefined;
    if (!row) throw new BrandGenerationNotFoundError('attempt');
    if (input.provenance && input.provenance.inputFingerprint !== row.effective_input_fingerprint) {
      throw new BrandGenerationPersistenceContractError(
        'Attempt provenance does not match the frozen input fingerprint',
      );
    }
    if (row.status === 'completed') {
      const existing = rowToAttempt(row);
      if (canonicalBrandGenerationFingerprint(existing.output)
          !== canonicalBrandGenerationFingerprint(input.output)
        || canonicalBrandGenerationFingerprint(existing.provenance)
          !== canonicalBrandGenerationFingerprint(input.provenance)) {
        throw new BrandGenerationAttemptCheckpointConflictError();
      }
      return existing;
    }
    validateTransition('brand_generation_attempt', BRAND_GENERATION_ATTEMPT_TRANSITIONS, row.status, 'completed');
    try {
      assertAttemptOutputMatchesStage(row.stage, parsed.data);
    } catch (cause) {
      throw new BrandGenerationPersistenceContractError(
        'Completed attempt output does not match its stage',
        { cause },
      );
    }
    const now = new Date().toISOString();
    const updated = stmts().updateAttemptTerminal.run({
      id: input.attemptId,
      item_id: input.itemId,
      run_id: input.runId,
      status: 'completed',
      output_snapshot_json: JSON.stringify(parsed.data),
      provenance_json: input.provenance ? JSON.stringify(input.provenance) : null,
      error_json: null,
      completed_at: now,
    });
    if (updated.changes !== 1) throw new BrandGenerationAttemptCheckpointConflictError();
    const next = stmts().attemptById.get(
      input.attemptId, input.itemId, input.runId, input.workspaceId,
    ) as BrandGenerationAttemptRow;
    return rowToAttempt(next);
  });
  return complete.immediate();
}

function endAttempt(
  input: EndBrandGenerationAttemptInput,
  status: 'failed' | 'cancelled',
): BrandGenerationAttempt {
  if (status === 'failed' && !input.error) {
    throw new BrandGenerationPersistenceContractError('Failed attempts require a sanitized error');
  }
  if (input.error && !brandGenerationSanitizedErrorSchema.safeParse(input.error).success) {
    throw new BrandGenerationPersistenceContractError('Attempt error is invalid');
  }
  const end = db.transaction((): BrandGenerationAttempt => {
    const row = stmts().attemptById.get(
      input.attemptId, input.itemId, input.runId, input.workspaceId,
    ) as BrandGenerationAttemptRow | undefined;
    if (!row) throw new BrandGenerationNotFoundError('attempt');
    if (row.status === status) return rowToAttempt(row);
    validateTransition('brand_generation_attempt', BRAND_GENERATION_ATTEMPT_TRANSITIONS, row.status, status);
    const now = new Date().toISOString();
    const updated = stmts().updateAttemptTerminal.run({
      id: input.attemptId,
      item_id: input.itemId,
      run_id: input.runId,
      status,
      output_snapshot_json: null,
      provenance_json: null,
      error_json: input.error ? JSON.stringify(input.error) : null,
      completed_at: now,
    });
    if (updated.changes !== 1) throw new BrandGenerationAttemptCheckpointConflictError();
    const next = stmts().attemptById.get(
      input.attemptId, input.itemId, input.runId, input.workspaceId,
    ) as BrandGenerationAttemptRow;
    return rowToAttempt(next);
  });
  return end.immediate();
}

export function failBrandGenerationAttempt(input: EndBrandGenerationAttemptInput): BrandGenerationAttempt {
  return endAttempt(input, 'failed');
}

export function cancelBrandGenerationAttempt(input: EndBrandGenerationAttemptInput): BrandGenerationAttempt {
  return endAttempt(input, 'cancelled');
}

export function listRunningBrandGenerationAttemptsForJob(
  workspaceId: string,
  runId: string,
  jobId: string,
): BrandGenerationAttempt[] {
  return (stmts().runningAttemptsByJob.all(workspaceId, runId, jobId) as BrandGenerationAttemptRow[])
    .map(rowToAttempt);
}

interface FinalCandidateBundle {
  runRow: BrandGenerationRunRow;
  itemRow: BrandGenerationItemRow;
  item: BrandGenerationItem;
  candidate: BrandGenerationAttempt;
  audit: BrandGenerationAttempt;
  auditReport: GenerationAuditReport;
}

function assertAuditMatchesCandidate(
  candidate: BrandGenerationAttempt,
  audit: BrandGenerationAttempt,
  currentItemRevision: number,
): void {
  if (!candidate.output || (candidate.output.kind !== 'foundation_candidate'
      && candidate.output.kind !== 'deliverable_candidate')
    || !audit.output || audit.output.kind !== 'audit') {
    throw new BrandGenerationPersistenceContractError('Final checkpoints have invalid output kinds');
  }
  const expectedAuditRevisionDelta = audit.stage === 'deterministic_audit' ? 1 : 2;
  if (candidate.commandId !== audit.commandId
    || candidate.expectedRunRevision !== audit.expectedRunRevision
    || candidate.expectedDeliverableVersion !== audit.expectedDeliverableVersion
    || audit.expectedItemRevision !== candidate.expectedItemRevision + expectedAuditRevisionDelta
    || audit.expectedItemRevision !== currentItemRevision
    || !candidate.completedAt
    || candidate.completedAt > audit.startedAt) {
    throw new BrandGenerationPersistenceContractError(
      'Final audit is not the lifecycle successor of the selected candidate',
    );
  }
  const unresolvedRequirementIds = candidate.output.requirements
    .filter(requirement => (
      requirement.requirementStage === 'ready'
      && (requirement.status === 'missing' || requirement.status === 'conflicting')
    ))
    .map(requirement => requirement.id)
    .sort();
  const declaredUnresolvedIds = [...audit.output.auditReport.unresolvedRequirementIds].sort();
  if (JSON.stringify(unresolvedRequirementIds) !== JSON.stringify(declaredUnresolvedIds)) {
    throw new BrandGenerationPersistenceContractError(
      'Final audit unresolved evidence does not match the selected candidate',
    );
  }
  const expectedPlaceholderIds = candidate.output.requirements
    .filter(requirement => (
      requirement.requirementStage === 'ready' && requirement.status === 'missing'
    ))
    .map(requirement => requirement.id)
    .sort();
  const declaredPlaceholderIds = candidate.output.placeholders
    .map(placeholder => placeholder.requirementId)
    .sort();
  if (new Set(declaredPlaceholderIds).size !== declaredPlaceholderIds.length
    || JSON.stringify(expectedPlaceholderIds) !== JSON.stringify(declaredPlaceholderIds)) {
    throw new BrandGenerationPersistenceContractError(
      'Final candidate placeholders do not match its unresolved evidence',
    );
  }
  if (audit.output.auditReport.verdict === 'ready_for_human_review'
    && audit.output.auditReport.modelFindings.some(finding => finding.severity !== 'info')) {
    throw new BrandGenerationPersistenceContractError(
      'Review-ready audit cannot retain warning or error model findings',
    );
  }
}

function loadFinalCandidate(input: CommitBrandGenerationCandidateInput): FinalCandidateBundle {
  const runRow = stmts().runById.get(input.runId, input.workspaceId) as BrandGenerationRunRow | undefined;
  const itemRow = stmts().itemById.get(input.itemId, input.runId, input.workspaceId) as BrandGenerationItemRow | undefined;
  if (!runRow) throw new BrandGenerationNotFoundError('run');
  if (!itemRow) throw new BrandGenerationNotFoundError('item');
  if (runRow.revision !== input.expectedRunRevision) {
    throw new BrandGenerationRevisionConflictError('run', input.expectedRunRevision, runRow.revision);
  }
  if (itemRow.revision !== input.expectedItemRevision) {
    throw new BrandGenerationRevisionConflictError('item', input.expectedItemRevision, itemRow.revision);
  }
  if (runRow.status !== 'running') {
    throw new BrandGenerationPersistenceContractError('Final candidate run is no longer active');
  }
  const candidateRow = stmts().attemptById.get(
    input.candidateAttemptId, input.itemId, input.runId, input.workspaceId,
  ) as BrandGenerationAttemptRow | undefined;
  const auditRow = stmts().attemptById.get(
    input.finalAuditAttemptId, input.itemId, input.runId, input.workspaceId,
  ) as BrandGenerationAttemptRow | undefined;
  if (!candidateRow || !auditRow) throw new BrandGenerationNotFoundError('attempt');
  const candidate = rowToAttempt(candidateRow);
  const audit = rowToAttempt(auditRow);
  if (candidate.status !== 'completed' || audit.status !== 'completed'
    || !candidate.output || !audit.output || audit.output.kind !== 'audit'
    || candidate.effectiveInputFingerprint !== audit.effectiveInputFingerprint
    || candidate.effectiveInputFingerprint !== itemRow.effective_input_fingerprint) {
    throw new BrandGenerationPersistenceContractError('Final candidate checkpoints do not share one frozen input');
  }
  assertAuditMatchesCandidate(candidate, audit, itemRow.revision);
  const expectedStatus = audit.output.auditReport.verdict;
  if (expectedStatus !== input.nextStatus) {
    throw new BrandGenerationPersistenceContractError('Final item status does not match the audit verdict');
  }
  validateTransition(
    'brand_generation_item',
    BRAND_GENERATION_ITEM_TRANSITIONS,
    itemRow.status,
    input.nextStatus,
  );
  return {
    runRow,
    itemRow,
    item: rowToItem(itemRow),
    candidate,
    audit,
    auditReport: audit.output.auditReport,
  };
}

function candidateItemPatch(bundle: FinalCandidateBundle): TransitionBrandGenerationItemPatch {
  if (!bundle.candidate.output
    || (bundle.candidate.output.kind !== 'foundation_candidate'
      && bundle.candidate.output.kind !== 'deliverable_candidate')) {
    throw new BrandGenerationPersistenceContractError('Final candidate attempt has no generated output');
  }
  return {
    foundationDraft: bundle.candidate.output.foundationDraft,
    content: bundle.candidate.output.content,
    claims: bundle.candidate.output.claims,
    requirements: bundle.candidate.output.requirements,
    placeholders: bundle.candidate.output.placeholders,
    auditReport: bundle.auditReport,
    automaticRevisionCount: bundle.auditReport.revisionCount,
    effectiveInputFingerprint: bundle.candidate.effectiveInputFingerprint,
    provenance: bundle.candidate.provenance,
    error: null,
    completedAt: new Date().toISOString(),
  };
}

function markDeliverableCasConflict(
  bundle: FinalCandidateBundle,
  reason: BrandGenerationDeliverableCasConflictReason,
  now: string,
): BrandGenerationItem {
  validateTransition(
    'brand_generation_item',
    BRAND_GENERATION_ITEM_TRANSITIONS,
    bundle.itemRow.status,
    'conflict',
  );
  const updated = writeItemTransition(bundle.itemRow, 'conflict', {
    error: {
      code: reason,
      message: 'A newer brand deliverable change was preserved. Review and retry explicitly.',
      retryable: true,
      stage: 'artifact_commit',
    },
    completedAt: now,
  }, now);
  if (updated.changes !== 1) {
    throw new BrandGenerationRevisionConflictError('item', bundle.itemRow.revision, null);
  }
  persistDerivedCounts(bundle.itemRow.workspace_id, bundle.itemRow.run_id, now);
  const item = getBrandGenerationItem(
    bundle.itemRow.workspace_id,
    bundle.itemRow.run_id,
    bundle.itemRow.id,
  );
  if (!item) throw new BrandGenerationNotFoundError('item');
  return item;
}

export function commitBrandVoiceFoundationCandidate(
  input: CommitBrandGenerationCandidateInput,
): BrandGenerationItem {
  const commit = db.transaction((): BrandGenerationItem => {
    const bundle = loadFinalCandidate(input);
    if (bundle.item.target !== 'voice_foundation'
      || bundle.candidate.output?.kind !== 'foundation_candidate') {
      throw new BrandGenerationPersistenceContractError('Foundation commit requires a foundation candidate');
    }
    const now = new Date().toISOString();
    const updated = writeItemTransition(
      bundle.itemRow,
      input.nextStatus,
      { ...candidateItemPatch(bundle), completedAt: now },
      now,
    );
    if (updated.changes !== 1) {
      throw new BrandGenerationRevisionConflictError('item', input.expectedItemRevision, null);
    }
    persistDerivedCounts(input.workspaceId, input.runId, now);
    const item = getBrandGenerationItem(input.workspaceId, input.runId, input.itemId);
    if (!item) throw new BrandGenerationNotFoundError('item');
    return item;
  });
  return commit.immediate();
}

export function commitBrandGenerationDeliverableCandidate(
  input: CommitBrandGenerationCandidateInput,
): CommitBrandGenerationDeliverableResult {
  const commit = db.transaction((): CommitBrandGenerationDeliverableResult => {
    const bundle = loadFinalCandidate(input);
    if (bundle.item.target === 'voice_foundation'
      || bundle.candidate.output?.kind !== 'deliverable_candidate') {
      throw new BrandGenerationPersistenceContractError('Deliverable commit requires a durable candidate');
    }
    const now = new Date().toISOString();
    if (input.nextStatus !== 'ready_for_human_review') {
      const itemUpdated = writeItemTransition(
        bundle.itemRow,
        input.nextStatus,
        { ...candidateItemPatch(bundle), completedAt: now },
        now,
      );
      if (itemUpdated.changes !== 1) {
        throw new BrandGenerationRevisionConflictError('item', input.expectedItemRevision, null);
      }
      persistDerivedCounts(input.workspaceId, input.runId, now);
      const item = getBrandGenerationItem(input.workspaceId, input.runId, input.itemId);
      if (!item) throw new BrandGenerationNotFoundError('item');
      return { kind: 'withheld', item };
    }
    const expectation = bundle.item.artifactExpectation;
    let deliverable: BrandDeliverable;
    if (expectation.kind === 'create') {
      const existing = stmts().deliverableByType.get(
        input.workspaceId,
        bundle.item.target,
      ) as DeliverableRow | undefined;
      if (existing) {
        const reason = existing.status === 'approved' ? 'deliverable_approved' : 'deliverable_created';
        return { kind: 'conflict', reason, item: markDeliverableCasConflict(bundle, reason, now) };
      }
      const id = `bid_${randomUUID()}`;
      stmts().insertDeliverable.run({
        id,
        workspace_id: input.workspaceId,
        deliverable_type: bundle.item.target,
        content: bundle.candidate.output.content,
        tier: DEFAULT_TIER_MAP[bundle.item.target],
        created_at: now,
        updated_at: now,
      });
      deliverable = {
        id,
        workspaceId: input.workspaceId,
        deliverableType: bundle.item.target,
        content: bundle.candidate.output.content,
        status: 'draft',
        version: 1,
        tier: DEFAULT_TIER_MAP[bundle.item.target],
        createdAt: now,
        updatedAt: now,
      };
    } else {
      const existing = stmts().deliverableById.get(
        expectation.deliverableId,
        input.workspaceId,
      ) as DeliverableRow | undefined;
      if (!existing || existing.deliverable_type !== bundle.item.target) {
        return { kind: 'conflict', reason: 'deliverable_missing', item: markDeliverableCasConflict(bundle, 'deliverable_missing', now) };
      }
      if (existing.status === 'approved') {
        return { kind: 'conflict', reason: 'deliverable_approved', item: markDeliverableCasConflict(bundle, 'deliverable_approved', now) };
      }
      if (existing.version !== expectation.expectedVersion) {
        return { kind: 'conflict', reason: 'deliverable_changed', item: markDeliverableCasConflict(bundle, 'deliverable_changed', now) };
      }
      stmts().insertDeliverableVersion.run({
        id: `biv_${randomUUID()}`,
        deliverable_id: existing.id,
        content: existing.content,
        steering_notes: 'B2 grounded generation replacement',
        version: existing.version,
        created_at: now,
      });
      const updated = stmts().updateDeliverableCas.run({
        id: existing.id,
        workspace_id: input.workspaceId,
        expected_version: expectation.expectedVersion,
        content: bundle.candidate.output.content,
        updated_at: now,
      });
      if (updated.changes !== 1) {
        throw new BrandGenerationRevisionConflictError('deliverable', expectation.expectedVersion, null);
      }
      deliverable = { ...deliverableFromRow(existing), content: bundle.candidate.output.content, status: 'draft', version: existing.version + 1, updatedAt: now };
    }
    const itemUpdated = writeItemTransition(
      bundle.itemRow,
      input.nextStatus,
      { ...candidateItemPatch(bundle), completedAt: now },
      now,
      { id: deliverable.id, version: deliverable.version },
    );
    if (itemUpdated.changes !== 1) {
      throw new BrandGenerationRevisionConflictError('item', input.expectedItemRevision, null);
    }
    persistDerivedCounts(input.workspaceId, input.runId, now);
    const item = getBrandGenerationItem(input.workspaceId, input.runId, input.itemId);
    if (!item) throw new BrandGenerationNotFoundError('item');
    return { kind: 'committed', deliverable, item };
  });
  return commit.immediate();
}
