import { createHash } from 'node:crypto';
import { normalizeCompetitorDomain } from '../../../competitor-domain-filter.js';
import db from '../../../db/index.js';
import { parseJsonSafe, parseJsonSafeArray } from '../../../db/json-validation.js';
import { createStmtCache } from '../../../db/stmt-cache.js';
import {
  BRAND_INTAKE_FIELD_POLICY,
  BRAND_INTAKE_LIMITS,
  BRAND_INTAKE_MUTATION_KINDS,
  brandIntakeEvidenceRequirementId,
  type BrandIntakeCompatibilityProjectionState,
  type BrandIntakeEvidenceResolution,
  type BrandIntakeMutationKind,
  type BrandIntakePayload,
  type BrandIntakeRevision,
  type BrandIntakeSource,
  type BrandIntakeSubmitter,
} from '../../../../shared/types/brand-intake.js';
import {
  brandIntakeCompatibilityProjectionStateSchema,
  brandIntakeEvidenceResolutionSchema,
  brandIntakeEvidenceResolutionsSchema,
  brandIntakePayloadSchema,
  brandIntakeSourceSchema,
  brandIntakeSubmitterSchema,
} from '../../../../shared/types/brand-intake-schemas.js';

interface BrandIntakeRevisionRow {
  id: string;
  workspace_id: string;
  revision: number;
  schema_version: number;
  payload_json: string;
  evidence_resolutions_json: string;
  evidence_resolution_raw_count: number;
  projection_state_json: string;
  fingerprint: string;
  source: string;
  submitter_json: string;
  mutation_kind: string;
  mutation_fingerprint: string;
  idempotency_key: string | null;
  supersedes_revision_id: string | null;
  superseded_by_revision_id: string | null;
  created_at: string;
}

interface BrandIntakeSubmissionCommandRow {
  intake_revision_id: string;
  mutation_fingerprint: string;
}

export interface StoredBrandIntakeRevision {
  revision: BrandIntakeRevision;
  projectionState: BrandIntakeCompatibilityProjectionState;
  mutationFingerprint: string;
  idempotencyKey: string | null;
}

export interface InsertBrandIntakeRevisionInput {
  id: string;
  workspaceId: string;
  revision: number;
  payload: BrandIntakePayload;
  evidenceResolutions: BrandIntakeEvidenceResolution[];
  projectionState: BrandIntakeCompatibilityProjectionState;
  fingerprint: string;
  source: BrandIntakeSource;
  submitter: BrandIntakeSubmitter;
  mutationKind: BrandIntakeMutationKind;
  mutationFingerprint: string;
  idempotencyKey: string | null;
  supersedesRevisionId: string | null;
  createdAt: string;
}

export class BrandIntakePersistenceContractError extends Error {
  readonly code = 'brand_intake_persistence_contract';

  constructor(message: string) {
    super(message);
    this.name = 'BrandIntakePersistenceContractError';
  }
}

export function computeBrandIntakeFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function computeBrandIntakeRevisionFingerprint(
  payload: BrandIntakePayload,
  evidenceResolutions: BrandIntakeEvidenceResolution[],
): string {
  return computeBrandIntakeFingerprint({ payload, evidenceResolutions });
}

const REVISION_SELECT = `
  SELECT
    revision_row.id,
    revision_row.workspace_id,
    revision_row.revision,
    revision_row.schema_version,
    revision_row.payload_json,
    revision_row.evidence_resolutions_json,
    json_array_length(revision_row.evidence_resolutions_json) AS evidence_resolution_raw_count,
    revision_row.projection_state_json,
    revision_row.fingerprint,
    revision_row.source,
    revision_row.submitter_json,
    revision_row.mutation_kind,
    revision_row.mutation_fingerprint,
    revision_row.idempotency_key,
    revision_row.supersedes_revision_id,
    successor.id AS superseded_by_revision_id,
    revision_row.created_at
  FROM brand_intake_revisions revision_row
  LEFT JOIN brand_intake_revisions successor
    ON successor.workspace_id = revision_row.workspace_id
   AND successor.supersedes_revision_id = revision_row.id
`;

const stmts = createStmtCache(() => ({
  getCurrent: db.prepare(`
    ${REVISION_SELECT}
    WHERE revision_row.workspace_id = ?
      AND successor.id IS NULL
    ORDER BY revision_row.revision DESC, revision_row.id
    LIMIT 1
  `),
  getById: db.prepare(`
    ${REVISION_SELECT}
    WHERE revision_row.workspace_id = ?
      AND revision_row.id = ?
    LIMIT 1
  `),
  getByIdempotencyKey: db.prepare(`
    ${REVISION_SELECT}
    WHERE revision_row.workspace_id = ?
      AND revision_row.idempotency_key = ?
    LIMIT 1
  `),
  getSubmissionCommand: db.prepare(`
    SELECT intake_revision_id, mutation_fingerprint
    FROM brand_intake_submission_commands
    WHERE workspace_id = ? AND idempotency_key = ?
  `),
  insertSubmissionCommand: db.prepare(`
    INSERT INTO brand_intake_submission_commands (
      workspace_id, idempotency_key, mutation_fingerprint, intake_revision_id, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `),
  insert: db.prepare(`
    INSERT INTO brand_intake_revisions (
      id,
      workspace_id,
      revision,
      schema_version,
      payload_json,
      evidence_resolutions_json,
      projection_state_json,
      fingerprint,
      source,
      submitter_json,
      mutation_kind,
      mutation_fingerprint,
      idempotency_key,
      supersedes_revision_id,
      created_at
    ) VALUES (
      @id,
      @workspace_id,
      @revision,
      @schema_version,
      @payload_json,
      @evidence_resolutions_json,
      @projection_state_json,
      @fingerprint,
      @source,
      @submitter_json,
      @mutation_kind,
      @mutation_fingerprint,
      @idempotency_key,
      @supersedes_revision_id,
      @created_at
    )
  `),
}));

function assertEvidenceResolutionCensus(
  evidenceResolutions: BrandIntakeEvidenceResolution[],
  revisionId: string,
): void {
  if (evidenceResolutions.length > BRAND_INTAKE_LIMITS.maxEvidenceResolutions) {
    throw new BrandIntakePersistenceContractError(
      `Brand intake revision ${revisionId} exceeds the evidence-resolution field census`,
    );
  }

  const seenFieldPaths = new Set<string>();
  const seenRequirementIds = new Set<string>();
  const seenResolutionIds = new Set<string>();
  for (const resolution of evidenceResolutions) {
    if (seenFieldPaths.has(resolution.fieldPath)) {
      throw new BrandIntakePersistenceContractError(
        `Brand intake revision ${revisionId} contains duplicate evidence for ${resolution.fieldPath}`,
      );
    }
    if (seenRequirementIds.has(resolution.requirementId)) {
      throw new BrandIntakePersistenceContractError(
        `Brand intake revision ${revisionId} contains duplicate evidence requirement ${resolution.requirementId}`,
      );
    }
    if (seenResolutionIds.has(resolution.id)) {
      throw new BrandIntakePersistenceContractError(
        `Brand intake revision ${revisionId} contains duplicate evidence resolution ID ${resolution.id}`,
      );
    }
    seenFieldPaths.add(resolution.fieldPath);
    seenRequirementIds.add(resolution.requirementId);
    seenResolutionIds.add(resolution.id);

    const policy = BRAND_INTAKE_FIELD_POLICY[resolution.fieldPath];
    if (resolution.value.kind !== policy.valueKind) {
      throw new BrandIntakePersistenceContractError(
        `Brand intake revision ${revisionId} has the wrong value kind for ${resolution.fieldPath}`,
      );
    }
  }
}

function assertProjectionStateOwnership(
  projectionState: BrandIntakeCompatibilityProjectionState,
  revisionId: string,
): void {
  const identity = (domain: string) => normalizeCompetitorDomain(domain) || domain.trim().toLowerCase();
  const preserved = new Set<string>();
  for (const domain of projectionState.preservedCompetitorDomains) {
    const key = identity(domain);
    if (preserved.has(key)) {
      throw new BrandIntakePersistenceContractError(
        `Brand intake revision ${revisionId} contains duplicate preserved competitor ownership`,
      );
    }
    preserved.add(key);
  }
  const intakeOwned = new Set<string>();
  for (const domain of projectionState.intakeOwnedCompetitorDomains) {
    const key = identity(domain);
    if (intakeOwned.has(key) || preserved.has(key)) {
      throw new BrandIntakePersistenceContractError(
        `Brand intake revision ${revisionId} contains ambiguous competitor ownership`,
      );
    }
    intakeOwned.add(key);
  }
}

function isBrandIntakePayload(value: unknown): value is BrandIntakePayload {
  return brandIntakePayloadSchema.safeParse(value).success;
}

function rowToStoredRevision(row: BrandIntakeRevisionRow): StoredBrandIntakeRevision {
  const context = { workspaceId: row.workspace_id, table: 'brand_intake_revisions' };
  const payload = parseJsonSafe(
    row.payload_json,
    brandIntakePayloadSchema,
    null,
    { ...context, field: 'payload_json' },
  );
  if (!payload || !isBrandIntakePayload(payload)) {
    throw new BrandIntakePersistenceContractError(
      `Brand intake revision ${row.id} contains an invalid payload`,
    );
  }

  const submitter = parseJsonSafe(
    row.submitter_json,
    brandIntakeSubmitterSchema,
    null,
    { ...context, field: 'submitter_json' },
  );
  if (!submitter) {
    throw new BrandIntakePersistenceContractError(
      `Brand intake revision ${row.id} contains an invalid submitter`,
    );
  }

  const parsedEvidenceResolutions = parseJsonSafeArray(
    row.evidence_resolutions_json,
    brandIntakeEvidenceResolutionSchema,
    { ...context, field: 'evidence_resolutions_json' },
  );
  if (parsedEvidenceResolutions.length !== row.evidence_resolution_raw_count) {
    throw new BrandIntakePersistenceContractError(
      `Brand intake revision ${row.id} contains invalid evidence-resolution entries`,
    );
  }
  brandIntakeEvidenceResolutionsSchema.parse(parsedEvidenceResolutions);
  const evidenceResolutions: BrandIntakeEvidenceResolution[] = parsedEvidenceResolutions.map(
    resolution => ({
      ...resolution,
      requirementId: brandIntakeEvidenceRequirementId(resolution.fieldPath),
    }),
  );
  assertEvidenceResolutionCensus(evidenceResolutions, row.id);
  if (row.schema_version !== payload.schemaVersion) {
    throw new BrandIntakePersistenceContractError(
      `Brand intake revision ${row.id} has mismatched schema versions`,
    );
  }
  if (row.fingerprint !== computeBrandIntakeRevisionFingerprint(payload, evidenceResolutions)) {
    throw new BrandIntakePersistenceContractError(
      `Brand intake revision ${row.id} has a stale or corrupt fingerprint`,
    );
  }

  const projectionState = parseJsonSafe(
    row.projection_state_json,
    brandIntakeCompatibilityProjectionStateSchema,
    null,
    { ...context, field: 'projection_state_json' },
  );
  if (!projectionState) {
    throw new BrandIntakePersistenceContractError(
      `Brand intake revision ${row.id} contains invalid compatibility projection state`,
    );
  }
  assertProjectionStateOwnership(projectionState, row.id);

  const source = brandIntakeSourceSchema.safeParse(row.source);
  const mutationKind = BRAND_INTAKE_MUTATION_KINDS.find(kind => kind === row.mutation_kind);
  if (!source.success || !mutationKind) {
    throw new BrandIntakePersistenceContractError(
      `Brand intake revision ${row.id} contains invalid source metadata`,
    );
  }

  return {
    revision: {
      id: row.id,
      workspaceId: row.workspace_id,
      revision: row.revision,
      schemaVersion: payload.schemaVersion,
      payload,
      evidenceResolutions,
      fingerprint: row.fingerprint,
      source: source.data,
      submitter,
      mutationKind,
      supersedesRevisionId: row.supersedes_revision_id,
      supersededByRevisionId: row.superseded_by_revision_id,
      createdAt: row.created_at,
    },
    projectionState,
    mutationFingerprint: row.mutation_fingerprint,
    idempotencyKey: row.idempotency_key,
  };
}

export function getCurrentStoredBrandIntakeRevision(
  workspaceId: string,
): StoredBrandIntakeRevision | null {
  const row = stmts().getCurrent.get(workspaceId) as BrandIntakeRevisionRow | undefined;
  return row ? rowToStoredRevision(row) : null;
}

export function getStoredBrandIntakeRevisionById(
  workspaceId: string,
  revisionId: string,
): StoredBrandIntakeRevision | null {
  const row = stmts().getById.get(workspaceId, revisionId) as BrandIntakeRevisionRow | undefined;
  return row ? rowToStoredRevision(row) : null;
}

export function getStoredBrandIntakeRevisionByIdempotencyKey(
  workspaceId: string,
  idempotencyKey: string,
): StoredBrandIntakeRevision | null {
  const row = stmts().getByIdempotencyKey.get(
    workspaceId,
    idempotencyKey,
  ) as BrandIntakeRevisionRow | undefined;
  return row ? rowToStoredRevision(row) : null;
}

export function getBrandIntakeSubmissionCommand(
  workspaceId: string,
  idempotencyKey: string,
): { revision: StoredBrandIntakeRevision; mutationFingerprint: string } | null {
  const row = stmts().getSubmissionCommand.get(
    workspaceId,
    idempotencyKey,
  ) as BrandIntakeSubmissionCommandRow | undefined;
  if (!row) return null;
  const revision = getStoredBrandIntakeRevisionById(workspaceId, row.intake_revision_id);
  if (!revision) {
    throw new BrandIntakePersistenceContractError(
      'Brand intake submission command references a missing revision',
    );
  }
  return { revision, mutationFingerprint: row.mutation_fingerprint };
}

export function insertBrandIntakeSubmissionCommand(input: {
  workspaceId: string;
  idempotencyKey: string;
  mutationFingerprint: string;
  intakeRevisionId: string;
  createdAt: string;
}): void {
  stmts().insertSubmissionCommand.run(
    input.workspaceId,
    input.idempotencyKey,
    input.mutationFingerprint,
    input.intakeRevisionId,
    input.createdAt,
  );
}

export function insertStoredBrandIntakeRevision(input: InsertBrandIntakeRevisionInput): void {
  const payload = brandIntakePayloadSchema.parse(input.payload);
  if (!isBrandIntakePayload(payload)) {
    throw new BrandIntakePersistenceContractError('Brand intake insert payload is invalid');
  }
  for (const resolution of input.evidenceResolutions) {
    brandIntakeEvidenceResolutionSchema.parse(resolution);
  }
  brandIntakeEvidenceResolutionsSchema.parse(input.evidenceResolutions);
  assertEvidenceResolutionCensus(input.evidenceResolutions, input.id);
  if (input.fingerprint !== computeBrandIntakeRevisionFingerprint(payload, input.evidenceResolutions)) {
    throw new BrandIntakePersistenceContractError('Brand intake insert fingerprint is invalid');
  }
  const projectionState = brandIntakeCompatibilityProjectionStateSchema.parse(
    input.projectionState,
  );
  assertProjectionStateOwnership(projectionState, input.id);
  const source = brandIntakeSourceSchema.parse(input.source);
  const submitter = brandIntakeSubmitterSchema.parse(input.submitter);
  stmts().insert.run({
    id: input.id,
    workspace_id: input.workspaceId,
    revision: input.revision,
    schema_version: input.payload.schemaVersion,
    payload_json: JSON.stringify(payload),
    evidence_resolutions_json: JSON.stringify(input.evidenceResolutions),
    projection_state_json: JSON.stringify(projectionState),
    fingerprint: input.fingerprint,
    source,
    submitter_json: JSON.stringify(submitter),
    mutation_kind: input.mutationKind,
    mutation_fingerprint: input.mutationFingerprint,
    idempotency_key: input.idempotencyKey,
    supersedes_revision_id: input.supersedesRevisionId,
    created_at: input.createdAt,
  });
}
