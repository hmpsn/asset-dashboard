import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';

import db from '../../db/index.js';
import {
  parseJsonFallback,
  parseJsonSafe,
  parseJsonSafeArray,
} from '../../db/json-validation.js';
import { createStmtCache } from '../../db/stmt-cache.js';
import { getStoredBrandIntakeRevisionById, getCurrentStoredBrandIntakeRevision } from './intake/repository.js';
import { JWT_SECRET } from '../../jwt-config.js';
import {
  InvalidTransitionError,
  VOICE_PROFILE_TRANSITIONS,
  validateTransition,
} from '../../state-machines.js';
import {
  AUTHENTIC_VOICE_SAMPLE_SOURCES,
  type AuthenticVoiceSampleSource,
  type ContextModifier,
  type VoiceDNA,
  type VoiceGuardrails,
  type VoiceProfileStatus,
  type VoiceSampleContext,
} from '../../../shared/types/brand-engine.js';
import type {
  BrandVoiceReadiness,
  FinalizedVoiceSnapshotRef,
} from '../../../shared/types/brand-generation.js';
import type {
  CreateVoiceFinalizationAuthorizationRequest,
  CreateVoiceFinalizationAuthorizationResult,
  BrandVoiceProfileSummary,
  EligibleVoiceAnchor,
  FinalizeBrandVoiceRequest,
  FinalizeBrandVoiceResult,
  FinalizedVoiceAnchorSnapshot,
  FinalizedVoiceSnapshot,
  FinalizedVoiceSnapshotSummary,
  GetBrandVoiceAuthoritySummaryResult,
  GetBrandVoicePageRequest,
  GetBrandVoicePageResult,
  GetBrandVoiceResult,
  VoiceCalibrationSelectionSnapshot,
  VoiceProfileFinalizationInput,
  VoiceFinalizationAuthorizationRef,
  ConsumeVoiceFinalizationAuthorizationRequest,
} from '../../../shared/types/voice-finalization.js';
import {
  VOICE_FINALIZATION_LIMITS,
  VOICE_FINALIZATION_SCHEMA_VERSIONS,
} from '../../../shared/types/voice-finalization.js';
import {
  boundedMutableContextModifiersSchema,
  boundedMutableVoiceDNASchema,
  boundedMutableVoiceGuardrailsSchema,
  createVoiceFinalizationAuthorizationRequestSchema,
  finalizedVoiceAnchorsSnapshotSchema,
  finalizeBrandVoiceRequestSchema,
  finalizedVoiceAnchorSnapshotSchema,
  finalizedVoiceSnapshotSchema,
  finalizedVoiceSnapshotV1Schema,
  generationOperatorAttributionSchema,
  voiceFinalizationExecutionAttributionSchema,
  voiceCalibrationSelectionSnapshotSchema,
  voiceCalibrationSelectionsSnapshotSchema,
  voiceDNASchema,
  voiceGuardrailsSchema,
  voiceProfileFinalizationInputV1Schema,
  voiceProfileFinalizationStructuralInputV1Schema,
  voiceFinalizationAuthorizationRefSchema,
  contextModifierSchema,
} from '../../../shared/types/voice-finalization-schemas.js';

export class VoiceFinalizationNotFoundError extends Error {
  readonly code = 'voice_finalization_not_found';

  constructor(message = 'No voice profile exists for this workspace') {
    super(message);
    this.name = 'VoiceFinalizationNotFoundError';
  }
}

export class VoiceFinalizationConflictError extends Error {
  readonly code = 'voice_finalization_conflict';
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(`Voice profile revision conflict: expected ${expected}, actual ${actual}`);
    this.name = 'VoiceFinalizationConflictError';
    this.expected = expected;
    this.actual = actual;
  }
}

export class VoiceFinalizationIdempotencyConflictError extends Error {
  readonly code = 'voice_finalization_idempotency_conflict';
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(`Voice finalization idempotency key ${idempotencyKey} was already used for a different command`);
    this.name = 'VoiceFinalizationIdempotencyConflictError';
    this.idempotencyKey = idempotencyKey;
  }
}

export class VoiceFinalizationPreconditionError extends Error {
  readonly code = 'voice_finalization_precondition';

  constructor(message: string) {
    super(message);
    this.name = 'VoiceFinalizationPreconditionError';
  }
}

export class VoiceFinalizationAuthorizationError extends Error {
  readonly code = 'voice_finalization_authorization';

  constructor(message = 'Voice finalization authorization is invalid or expired') {
    super(message);
    this.name = 'VoiceFinalizationAuthorizationError';
  }
}

export class VoiceFinalizationPersistenceContractError extends Error {
  readonly code = 'voice_finalization_persistence_contract';

  constructor(message: string) {
    super(message);
    this.name = 'VoiceFinalizationPersistenceContractError';
  }
}

export class VoiceFinalizationReadCursorError extends Error {
  readonly code = 'voice_finalization_read_cursor';

  constructor() {
    super('The eligible-anchor cursor is invalid');
    this.name = 'VoiceFinalizationReadCursorError';
  }
}

export class VoiceFinalizationReadConflictError extends Error {
  readonly code = 'voice_finalization_read_conflict';

  constructor() {
    super('The brand-voice authority changed after the eligible-anchor cursor was issued');
    this.name = 'VoiceFinalizationReadConflictError';
  }
}

interface VoiceProfileRow {
  id: string;
  workspace_id: string;
  status: string;
  revision: number;
}

interface VoiceProfileReadRow extends VoiceProfileRow {
  voice_dna_json: string | null;
  guardrails_json: string | null;
  context_modifiers_json: string | null;
  updated_at: string;
}

interface VoiceSampleAnchorRow {
  id: string;
  content: string;
  context_tag: string | null;
  source: string | null;
  sort_order: number | null;
  created_at: string;
}

interface CalibrationSessionRow {
  id: string;
  prompt_type: string;
  variations_json: string | null;
  variation_json_bytes: number;
  variation_json_type: string | null;
  variation_count: number | null;
}

interface VoiceFinalizationRow {
  id: string;
  schema_version: number;
  workspace_id: string;
  voice_profile_id: string;
  voice_version: number;
  profile_revision: number;
  voice_dna_json: string;
  guardrails_json: string;
  context_modifiers_json: string;
  anchors_json: string;
  calibration_selections_json: string;
  finalized_by_json: string;
  execution_actor_json: string;
  fingerprint: string;
  mutation_fingerprint: string;
  idempotency_key: string;
  authorization_id: string | null;
  finalized_at: string;
  created_at: string;
}

interface VoiceAuthorizationRow {
  id: string;
  request_schema_version: number;
  token_hash: string;
  workspace_id: string;
  voice_profile_id: string;
  expected_profile_revision: number;
  request_json: string;
  mutation_fingerprint: string;
  authorized_by_json: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  finalization_id: string | null;
  execution_actor_json: string | null;
}

interface BrandVoiceAnchorCursorPayload {
  version: 1;
  kind: 'brand_voice_anchors';
  workspaceId: string;
  profileId: string | null;
  profileRevision: number | null;
  intakeRevisionId: string | null;
  intakeRevision: number | null;
  offset: number;
}

interface BrandVoiceAnchorCursorEnvelope {
  payload: BrandVoiceAnchorCursorPayload;
  signature: string;
}

type CurrentBrandIntakeRevision = NonNullable<
  ReturnType<typeof getCurrentStoredBrandIntakeRevision>
>['revision'];

const eligibleVoiceSampleRowSchema = z.object({
  id: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxIdLength),
  content: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxTextLength),
  context_tag: z.enum(['headline', 'body', 'cta', 'about', 'service', 'social', 'seo'])
    .nullable(),
  source: z.enum(AUTHENTIC_VOICE_SAMPLE_SOURCES),
  sort_order: z.number().int().nullable(),
  created_at: z.string().datetime(),
}).strict();

const finalizedVoiceSnapshotSummarySchema = z.object({
  id: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxIdLength),
  voiceProfileId: z.string().trim().min(1).max(VOICE_FINALIZATION_LIMITS.maxIdLength),
  profileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  voiceVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  finalizedBy: generationOperatorAttributionSchema,
  finalizedAt: z.string().datetime(),
  anchorCount: z.number().int().min(1).max(VOICE_FINALIZATION_LIMITS.maxAnchors),
  calibrationSelectionCount: z.number().int().min(0)
    .max(VOICE_FINALIZATION_LIMITS.maxCalibrationSelections),
}).strict();

const FINALIZATION_SELECT = `
  SELECT
    id, schema_version, workspace_id, voice_profile_id, voice_version, profile_revision,
    voice_dna_json, guardrails_json, context_modifiers_json, anchors_json,
    calibration_selections_json, finalized_by_json, execution_actor_json,
    fingerprint, mutation_fingerprint, idempotency_key, authorization_id,
    finalized_at, created_at
  FROM voice_profile_finalizations
`;

const stmts = createStmtCache(() => ({
  workspaceExists: db.prepare(`SELECT 1 FROM workspaces WHERE id = ? LIMIT 1`),
  getProfile: db.prepare(`
    SELECT id, workspace_id, status, revision
    FROM voice_profiles
    WHERE workspace_id = ?
    LIMIT 1
  `),
  getProfileForRead: db.prepare(`
    SELECT
      id, workspace_id, status, revision, voice_dna_json, guardrails_json,
      context_modifiers_json, updated_at
    FROM voice_profiles
    WHERE workspace_id = ?
    LIMIT 1
  `),
  getVoiceSample: db.prepare(`
    SELECT
      sample.id, sample.content, sample.context_tag, sample.source,
      sample.sort_order, sample.created_at
    FROM voice_samples sample
    JOIN voice_profiles profile ON profile.id = sample.voice_profile_id
    WHERE profile.workspace_id = ?
      AND profile.id = ?
      AND sample.id = ?
    LIMIT 1
  `),
  countEligibleVoiceSamples: db.prepare(`
    SELECT COUNT(*) AS count
    FROM voice_samples sample
    WHERE sample.voice_profile_id = @voice_profile_id
      AND sample.source IN ('manual', 'transcript_extraction')
      AND (sample.sort_order IS NULL OR typeof(sample.sort_order) = 'integer')
      AND length(sample.id) BETWEEN 1 AND @max_id_length
      AND sample.id = trim(sample.id)
      AND length(trim(sample.content)) > 0
      AND length(sample.content) <= @max_content_length
      AND length(CAST(sample.content AS BLOB)) <= @max_content_utf8_bytes
      AND (
        sample.context_tag IS NULL
        OR sample.context_tag IN ('headline', 'body', 'cta', 'about', 'service', 'social', 'seo')
      )
      AND sample.created_at = trim(sample.created_at)
      AND sample.created_at GLOB '????-??-??T??:??:??*Z'
      AND julianday(sample.created_at) IS NOT NULL
  `),
  listEligibleVoiceSamplesPage: db.prepare(`
    SELECT
      sample.id, sample.content, sample.context_tag, sample.source,
      sample.sort_order, sample.created_at
    FROM voice_samples sample
    WHERE sample.voice_profile_id = @voice_profile_id
      AND sample.source IN ('manual', 'transcript_extraction')
      AND (sample.sort_order IS NULL OR typeof(sample.sort_order) = 'integer')
      AND length(sample.id) BETWEEN 1 AND @max_id_length
      AND sample.id = trim(sample.id)
      AND length(trim(sample.content)) > 0
      AND length(sample.content) <= @max_content_length
      AND length(CAST(sample.content AS BLOB)) <= @max_content_utf8_bytes
      AND (
        sample.context_tag IS NULL
        OR sample.context_tag IN ('headline', 'body', 'cta', 'about', 'service', 'social', 'seo')
      )
      AND sample.created_at = trim(sample.created_at)
      AND sample.created_at GLOB '????-??-??T??:??:??*Z'
      AND julianday(sample.created_at) IS NOT NULL
    ORDER BY
      CASE WHEN sample.sort_order IS NULL THEN 1 ELSE 0 END,
      sample.sort_order ASC,
      sample.created_at ASC,
      sample.id ASC
    LIMIT @limit OFFSET @offset
  `),
  getCalibrationSession: db.prepare(`
    SELECT
      session.id,
      session.prompt_type,
      length(CAST(session.variations_json AS BLOB)) AS variation_json_bytes,
      CASE
        WHEN length(CAST(session.variations_json AS BLOB)) <= @max_variation_json_bytes
        THEN session.variations_json
        ELSE NULL
      END AS variations_json,
      CASE WHEN length(CAST(session.variations_json AS BLOB)) <= @max_variation_json_bytes
        AND json_valid(session.variations_json)
        THEN json_type(session.variations_json) ELSE NULL END AS variation_json_type,
      CASE WHEN length(CAST(session.variations_json AS BLOB)) <= @max_variation_json_bytes
        AND json_valid(session.variations_json)
        THEN json_array_length(session.variations_json) ELSE NULL END AS variation_count
    FROM voice_calibration_sessions session
    JOIN voice_profiles profile ON profile.id = session.voice_profile_id
    WHERE profile.workspace_id = @workspace_id
      AND profile.id = @voice_profile_id
      AND session.id = @session_id
    LIMIT 1
  `),
  latestFinalization: db.prepare(`
    ${FINALIZATION_SELECT}
    WHERE workspace_id = ?
    ORDER BY voice_version DESC, id DESC
    LIMIT 1
  `),
  finalizationById: db.prepare(`
    ${FINALIZATION_SELECT}
    WHERE workspace_id = ? AND id = ?
    LIMIT 1
  `),
  finalizationByIdempotencyKey: db.prepare(`
    ${FINALIZATION_SELECT}
    WHERE workspace_id = ? AND idempotency_key = ?
    LIMIT 1
  `),
  nextVoiceVersion: db.prepare(`
    SELECT COALESCE(MAX(voice_version), 0) + 1 AS version
    FROM voice_profile_finalizations
    WHERE voice_profile_id = ?
  `),
  updateProfileForFinalization: db.prepare(`
    UPDATE voice_profiles
    SET status = 'calibrated', -- status-ok: finalizer validates the legal path before CAS
        voice_dna_json = @voice_dna_json,
        guardrails_json = @guardrails_json,
        context_modifiers_json = @context_modifiers_json,
        revision = revision + 1,
        updated_at = @updated_at
    WHERE id = @id
      AND workspace_id = @workspace_id
      AND revision = @expected_revision
  `),
  insertFinalization: db.prepare(`
    INSERT INTO voice_profile_finalizations (
      id, schema_version, workspace_id, voice_profile_id, voice_version, profile_revision,
      voice_dna_json, guardrails_json, context_modifiers_json, anchors_json,
      calibration_selections_json, finalized_by_json, execution_actor_json,
      fingerprint, mutation_fingerprint, idempotency_key, authorization_id,
      finalized_at, created_at
    ) VALUES (
      @id, @schema_version, @workspace_id, @voice_profile_id, @voice_version, @profile_revision,
      @voice_dna_json, @guardrails_json, @context_modifiers_json, @anchors_json,
      @calibration_selections_json, @finalized_by_json, @execution_actor_json,
      @fingerprint, @mutation_fingerprint, @idempotency_key, @authorization_id,
      @finalized_at, @created_at
    )
  `),
  insertAuthorization: db.prepare(`
    INSERT INTO voice_finalization_authorizations (
      id, request_schema_version, token_hash, workspace_id, voice_profile_id,
      expected_profile_revision, request_json, mutation_fingerprint,
      authorized_by_json, issued_at, expires_at, consumed_at, finalization_id,
      execution_actor_json
    ) VALUES (
      @id, @request_schema_version, @token_hash, @workspace_id, @voice_profile_id,
      @expected_profile_revision, @request_json, @mutation_fingerprint,
      @authorized_by_json, @issued_at, @expires_at, NULL, NULL, NULL
    )
  `),
  authorizationByToken: db.prepare(`
    SELECT *
    FROM voice_finalization_authorizations
    WHERE workspace_id = ? AND token_hash = ?
    LIMIT 1
  `),
  authorizationById: db.prepare(`
    SELECT *
    FROM voice_finalization_authorizations
    WHERE workspace_id = ? AND id = ?
    LIMIT 1
  `),
  consumeAuthorization: db.prepare(`
    UPDATE voice_finalization_authorizations
    SET consumed_at = @consumed_at,
        finalization_id = @finalization_id,
        execution_actor_json = @execution_actor_json
    WHERE id = @id
      AND workspace_id = @workspace_id
      AND consumed_at IS NULL
      AND finalization_id IS NULL
  `),
}));

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) output[key] = canonicalize(entry);
    }
    return output;
  }
  return value;
}

function canonicalFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function cursorPayloadJson(payload: BrandVoiceAnchorCursorPayload): string {
  return JSON.stringify(canonicalize(payload));
}

function cursorSignature(payload: BrandVoiceAnchorCursorPayload): string {
  return createHmac('sha256', JWT_SECRET)
    .update('brand-voice-anchor-page:v1:')
    .update(cursorPayloadJson(payload))
    .digest('base64url');
}

function encodeBrandVoiceAnchorCursor(payload: BrandVoiceAnchorCursorPayload): string {
  const envelope: BrandVoiceAnchorCursorEnvelope = {
    payload,
    signature: cursorSignature(payload),
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBrandVoiceAnchorCursor(
  cursor: string,
  workspaceId: string,
): BrandVoiceAnchorCursorPayload {
  try {
    if (cursor.length > VOICE_FINALIZATION_LIMITS.maxAnchorCursorLength) {
      throw new Error('cursor exceeds the encoded length limit');
    }
    const decoded = Buffer.from(cursor, 'base64url');
    if (
      decoded.length === 0
      || decoded.toString('base64url') !== cursor
      || decoded.length > VOICE_FINALIZATION_LIMITS.maxAnchorCursorLength
    ) {
      throw new Error('non-canonical cursor');
    }
    const envelope = parseJsonFallback<unknown>(decoded.toString('utf8'), null);
    if (!isRecord(envelope) || !isRecord(envelope.payload)) {
      throw new Error('invalid cursor envelope');
    }
    const signature = envelope.signature;
    if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
      throw new Error('invalid cursor signature');
    }
    const payload = envelope.payload;
    if (
      payload.version !== 1
      || payload.kind !== 'brand_voice_anchors'
      || typeof payload.workspaceId !== 'string'
      || (payload.profileId !== null && typeof payload.profileId !== 'string')
      || (payload.profileRevision !== null
        && (typeof payload.profileRevision !== 'number'
          || !Number.isInteger(payload.profileRevision)
          || payload.profileRevision < 1))
      || (payload.intakeRevisionId !== null && typeof payload.intakeRevisionId !== 'string')
      || (payload.intakeRevision !== null
        && (typeof payload.intakeRevision !== 'number'
          || !Number.isInteger(payload.intakeRevision)
          || payload.intakeRevision < 1))
      || typeof payload.offset !== 'number'
      || !Number.isInteger(payload.offset)
      || payload.offset < 0
      || payload.offset > Number.MAX_SAFE_INTEGER
    ) {
      throw new Error('invalid cursor payload');
    }
    const candidate = payload as unknown as BrandVoiceAnchorCursorPayload;
    const actual = Buffer.from(signature, 'base64url');
    const expected = Buffer.from(cursorSignature(candidate), 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error('cursor signature mismatch');
    }
    if (candidate.workspaceId !== workspaceId) {
      throw new Error('cursor workspace mismatch');
    }
    return candidate;
  } catch (error) {
    if (error instanceof VoiceFinalizationReadCursorError) throw error;
    // catch-ok - caller-controlled opaque cursor failures are normalized below.
    throw new VoiceFinalizationReadCursorError();
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const storedCalibrationVariationSchema = z.object({
  text: z.string(),
}).passthrough();

function parseRequiredJson<T>(
  raw: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  row: VoiceFinalizationRow | VoiceAuthorizationRow,
  field: string,
): T {
  const parsed = parseJsonSafe(raw, schema as z.ZodType<T>, null, {
    workspaceId: row.workspace_id,
    table: 'voice_version' in row
      ? 'voice_profile_finalizations'
      : 'voice_finalization_authorizations',
    field,
  });
  if (parsed === null) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice finalization data is invalid (${field})`,
    );
  }
  return parsed;
}

function snapshotFingerprintPayload(snapshot: Pick<
  FinalizedVoiceSnapshot,
  'voiceDNA' | 'guardrails' | 'contextModifiers' | 'anchors' | 'calibrationSelections'
>): unknown {
  return {
    voiceDNA: snapshot.voiceDNA,
    guardrails: snapshot.guardrails,
    contextModifiers: snapshot.contextModifiers,
    anchors: snapshot.anchors.map(anchor => ({
      selector: anchor.selector,
      content: anchor.content,
      context: anchor.context,
      evidenceRef: anchor.evidenceRef,
    })),
    calibrationSelections: snapshot.calibrationSelections,
  };
}

function parseFinalizedSnapshotByVersion(
  row: VoiceFinalizationRow,
  candidate: unknown,
): FinalizedVoiceSnapshot {
  switch (row.schema_version) {
    case VOICE_FINALIZATION_SCHEMA_VERSIONS.snapshot: {
      const parsed = finalizedVoiceSnapshotV1Schema.safeParse(candidate);
      if (parsed.success) return parsed.data as FinalizedVoiceSnapshot;
      break;
    }
    default:
      break;
  }
  throw new VoiceFinalizationPersistenceContractError(
    `Stored voice finalization ${row.id} has an unsupported or invalid schema version`,
  );
}

function rowToSnapshot(row: VoiceFinalizationRow): FinalizedVoiceSnapshot {
  const voiceDNA = parseRequiredJson(row.voice_dna_json, voiceDNASchema, row, 'voice_dna_json');
  const guardrails = parseRequiredJson(
    row.guardrails_json,
    voiceGuardrailsSchema,
    row,
    'guardrails_json',
  );
  const contextModifiers = parseRequiredJson(
    row.context_modifiers_json,
    contextModifierSchema.array().max(VOICE_FINALIZATION_LIMITS.maxContextModifiers),
    row,
    'context_modifiers_json',
  );
  const anchors = parseRequiredJson(
    row.anchors_json,
    finalizedVoiceAnchorSnapshotSchema.array()
      .min(1)
      .max(VOICE_FINALIZATION_LIMITS.maxAnchors),
    row,
    'anchors_json',
  );
  const calibrationSelections = parseRequiredJson(
    row.calibration_selections_json,
    voiceCalibrationSelectionSnapshotSchema.array()
      .max(VOICE_FINALIZATION_LIMITS.maxCalibrationSelections),
    row,
    'calibration_selections_json',
  );
  const finalizedBy = parseRequiredJson(
    row.finalized_by_json,
    generationOperatorAttributionSchema,
    row,
    'finalized_by_json',
  );
  const executionActor = parseRequiredJson(
    row.execution_actor_json,
    voiceFinalizationExecutionAttributionSchema,
    row,
    'execution_actor_json',
  );
  const anchorTuple = anchors as [FinalizedVoiceAnchorSnapshot, ...FinalizedVoiceAnchorSnapshot[]];
  const fingerprintPayload = {
    voiceDNA,
    guardrails,
    contextModifiers,
    anchors: anchorTuple,
    calibrationSelections,
  };
  if (canonicalFingerprint(snapshotFingerprintPayload(fingerprintPayload)) !== row.fingerprint) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice finalization ${row.id} has a stale or corrupt fingerprint`,
    );
  }

  const candidate = {
    id: row.id,
    workspaceId: row.workspace_id,
    voiceProfileId: row.voice_profile_id,
    voiceVersion: row.voice_version,
    profileRevision: row.profile_revision,
    voiceDNA,
    guardrails,
    contextModifiers,
    anchors: anchorTuple,
    calibrationSelections,
    finalizedBy,
    executionActor,
    finalizedAt: row.finalized_at,
    createdAt: row.created_at,
    fingerprint: row.fingerprint,
    anchorEvidenceRefs: anchorTuple.map(anchor => anchor.evidenceRef),
  };
  const snapshot = parseFinalizedSnapshotByVersion(row, candidate);
  assertSnapshotAuthorizationBinding(row, snapshot);
  return snapshot;
}

function snapshotRef(snapshot: FinalizedVoiceSnapshot): FinalizedVoiceSnapshotRef {
  return {
    voiceProfileId: snapshot.voiceProfileId,
    voiceVersion: snapshot.voiceVersion,
    finalizedBy: snapshot.finalizedBy,
    finalizedAt: snapshot.finalizedAt,
    fingerprint: snapshot.fingerprint,
    anchorEvidenceRefs: snapshot.anchorEvidenceRefs,
  };
}

function finalizedReadiness(snapshot: FinalizedVoiceSnapshot): Extract<
  BrandVoiceReadiness,
  { state: 'finalized' }
> {
  return {
    state: 'finalized',
    snapshot: snapshotRef(snapshot),
    blockingReasons: [],
  };
}

function profileStatus(value: string): VoiceProfileStatus {
  if (value === 'draft' || value === 'calibrating' || value === 'calibrated') return value;
  throw new VoiceFinalizationPersistenceContractError(
    `Voice profile has invalid stored status ${value}`,
  );
}

function getProfileRow(workspaceId: string): VoiceProfileRow | null {
  return (stmts().getProfile.get(workspaceId) as VoiceProfileRow | undefined) ?? null;
}

function getProfileReadRow(workspaceId: string): VoiceProfileReadRow | null {
  return (
    stmts().getProfileForRead.get(workspaceId) as VoiceProfileReadRow | undefined
  ) ?? null;
}

function parseMutableProfileJson<T>(
  raw: string | null,
  schema: z.ZodType<T>,
  row: VoiceProfileReadRow,
  field: string,
): T | undefined {
  if (raw === null) return undefined;
  const parsed = parseJsonSafe(raw, schema, null, {
    workspaceId: row.workspace_id,
    table: 'voice_profiles',
    field,
  });
  if (parsed === null) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice profile data is invalid (${field})`,
    );
  }
  return parsed;
}

function rowToProfileSummary(row: VoiceProfileReadRow): BrandVoiceProfileSummary {
  if (
    row.id.trim() !== row.id
    || row.id.length < 1
    || row.id.length > VOICE_FINALIZATION_LIMITS.maxIdLength
    || !Number.isInteger(row.revision)
    || row.revision < 1
    || !z.string().datetime().safeParse(row.updated_at).success
  ) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice profile ${row.id} violates the authority envelope contract`,
    );
  }
  const voiceDNA = parseMutableProfileJson<VoiceDNA>(
    row.voice_dna_json,
    boundedMutableVoiceDNASchema,
    row,
    'voice_dna_json',
  );
  const guardrails = parseMutableProfileJson<VoiceGuardrails>(
    row.guardrails_json,
    boundedMutableVoiceGuardrailsSchema,
    row,
    'guardrails_json',
  );
  const contextModifiers = parseMutableProfileJson<ContextModifier[]>(
    row.context_modifiers_json,
    boundedMutableContextModifiersSchema,
    row,
    'context_modifiers_json',
  ) ?? [];
  return {
    id: row.id,
    revision: row.revision,
    status: profileStatus(row.status),
    voiceDNA,
    guardrails,
    contextModifiers,
    updatedAt: row.updated_at,
  };
}

function latestSnapshot(workspaceId: string): FinalizedVoiceSnapshot | null {
  const row = stmts().latestFinalization.get(workspaceId) as VoiceFinalizationRow | undefined;
  return row ? rowToSnapshot(row) : null;
}

interface LightweightAuthoritySnapshot {
  summary: FinalizedVoiceSnapshotSummary;
  ref: FinalizedVoiceSnapshotRef;
  validatedSnapshot: FinalizedVoiceSnapshot;
}

function latestSnapshotSummary(workspaceId: string): LightweightAuthoritySnapshot | null {
  // Authority must be earned through the same strict bounded parser used by
  // generation. Summary-only columns cannot prove JSON/provenance/fingerprint integrity.
  const snapshot = latestSnapshot(workspaceId);
  if (!snapshot) return null;
  const parsed = finalizedVoiceSnapshotSummarySchema.safeParse({
    id: snapshot.id,
    voiceProfileId: snapshot.voiceProfileId,
    profileRevision: snapshot.profileRevision,
    voiceVersion: snapshot.voiceVersion,
    fingerprint: snapshot.fingerprint,
    finalizedBy: snapshot.finalizedBy,
    finalizedAt: snapshot.finalizedAt,
    anchorCount: snapshot.anchors.length,
    calibrationSelectionCount: snapshot.calibrationSelections.length,
  });
  if (!parsed.success) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice finalization ${snapshot.id} violates the summary contract`,
    );
  }
  return {
    summary: parsed.data,
    ref: snapshotRef(snapshot),
    validatedSnapshot: snapshot,
  };
}

function assertFinalizedProfileParity(
  profile: BrandVoiceProfileSummary,
  snapshot: FinalizedVoiceSnapshot,
): void {
  if (
    profile.status !== 'calibrated'
    || profile.voiceDNA === undefined
    || profile.guardrails === undefined
    || canonicalFingerprint(profile.voiceDNA) !== canonicalFingerprint(snapshot.voiceDNA)
    || canonicalFingerprint(profile.guardrails) !== canonicalFingerprint(snapshot.guardrails)
    || canonicalFingerprint(profile.contextModifiers)
      !== canonicalFingerprint(snapshot.contextModifiers)
  ) {
    throw new VoiceFinalizationPersistenceContractError(
      'Current voice profile does not match its same-revision immutable authority',
    );
  }
}

function summarizedReadiness(
  profile: BrandVoiceProfileSummary | null,
  authoritySnapshot: LightweightAuthoritySnapshot | null,
): GetBrandVoiceAuthoritySummaryResult['readiness'] {
  const snapshot = authoritySnapshot?.summary ?? null;
  if (!profile) {
    if (snapshot) {
      throw new VoiceFinalizationPersistenceContractError(
        'Stored voice finalization has no owning voice profile',
      );
    }
    return {
      state: 'missing',
      blockingReasons: ['No voice profile exists for this workspace.'],
    };
  }
  if (!snapshot) {
    return {
      state: 'missing',
      blockingReasons: [profile.status === 'calibrated'
        ? 'Legacy calibrated voice has no verified finalization snapshot.'
        : 'Brand voice has not been finalized.'],
    };
  }
  if (snapshot.profileRevision === profile.revision) {
    assertFinalizedProfileParity(profile, authoritySnapshot!.validatedSnapshot);
    return { state: 'finalized', snapshot, blockingReasons: [] };
  }
  return {
    state: 'stale',
    snapshot,
    blockingReasons: ['The voice profile changed after its latest finalization.'],
  };
}

function referenceReadiness(
  profile: BrandVoiceProfileSummary | null,
  snapshot: LightweightAuthoritySnapshot | null,
): BrandVoiceReadiness {
  if (!profile) {
    if (snapshot) {
      throw new VoiceFinalizationPersistenceContractError(
        'Stored voice finalization has no owning voice profile',
      );
    }
    return {
      state: 'missing',
      blockingReasons: ['No voice profile exists for this workspace.'],
    };
  }
  if (!snapshot) {
    return {
      state: 'missing',
      blockingReasons: [profile.status === 'calibrated'
        ? 'Legacy calibrated voice has no verified finalization snapshot.'
        : 'Brand voice has not been finalized.'],
    };
  }
  if (snapshot.summary.profileRevision === profile.revision) {
    assertFinalizedProfileParity(profile, snapshot.validatedSnapshot);
    return { state: 'finalized', snapshot: snapshot.ref, blockingReasons: [] };
  }
  return {
    state: 'stale',
    snapshot: snapshot.ref,
    blockingReasons: ['The voice profile changed after its latest finalization.'],
  };
}

const eligibleVoiceSampleQueryBounds = {
  max_id_length: VOICE_FINALIZATION_LIMITS.maxIdLength,
  max_content_length: VOICE_FINALIZATION_LIMITS.maxTextLength,
  max_content_utf8_bytes: VOICE_FINALIZATION_LIMITS.maxTextLength,
} as const;

function parseEligibleVoiceSampleRow(row: unknown) {
  if (
    !isRecord(row)
    || typeof row.id !== 'string'
    || row.id !== row.id.trim()
    || typeof row.content !== 'string'
    || new TextEncoder().encode(row.content).byteLength
      > eligibleVoiceSampleQueryBounds.max_content_utf8_bytes
  ) return null;
  const parsed = eligibleVoiceSampleRowSchema.safeParse(row);
  return parsed.success ? parsed.data : null;
}

function rowToEligibleVoiceAnchor(row: unknown): EligibleVoiceAnchor {
  const sample = parseEligibleVoiceSampleRow(row);
  if (!sample) {
    throw new VoiceFinalizationPersistenceContractError(
      'A SQL-filtered eligible voice sample violates the paging contract',
    );
  }
  return {
    selector: { kind: 'voice_sample', voiceSampleId: sample.id },
    content: sample.content,
    context: sample.context_tag ?? 'body',
    sourceLabel: sample.source === 'manual'
      ? 'Operator-entered voice sample'
      : 'Transcript voice sample',
    capturedAt: sample.created_at,
  };
}

function countEligibleVoiceSamples(profileId: string | null): number {
  if (!profileId) return 0;
  const row = stmts().countEligibleVoiceSamples.get({
    voice_profile_id: profileId,
    ...eligibleVoiceSampleQueryBounds,
  }) as { count: number };
  if (!Number.isSafeInteger(row.count) || row.count < 0) {
    throw new VoiceFinalizationPersistenceContractError(
      'Eligible voice-sample census is invalid',
    );
  }
  return row.count;
}

function listEligibleVoiceSamples(
  profileId: string | null,
  offset: number,
  limit: number,
): EligibleVoiceAnchor[] {
  if (!profileId || limit <= 0) return [];
  const rows = stmts().listEligibleVoiceSamplesPage.all({
    voice_profile_id: profileId,
    offset,
    limit,
    ...eligibleVoiceSampleQueryBounds,
  });
  return rows.map(rowToEligibleVoiceAnchor);
}

function intakeEligibleAnchors(
  intake: CurrentBrandIntakeRevision | null,
): EligibleVoiceAnchor[] {
  if (!intake) return [];
  return intake.payload.authenticSamples.map(sample => ({
    selector: {
      kind: 'brand_intake_sample',
      intakeRevisionId: intake.id,
      intakeRevision: intake.revision,
      sampleId: sample.id,
    },
    content: sample.content,
    context: sample.context,
    sourceLabel: sample.sourceRef.label ?? 'Brand intake authentic sample',
    capturedAt: sample.sourceRef.capturedAt,
  }));
}

function fullReadiness(
  profile: BrandVoiceProfileSummary | null,
  snapshot: FinalizedVoiceSnapshot | null,
): BrandVoiceReadiness {
  if (!profile) {
    if (snapshot) {
      throw new VoiceFinalizationPersistenceContractError(
        'Stored voice finalization has no owning voice profile',
      );
    }
    return {
      state: 'missing',
      blockingReasons: ['No voice profile exists for this workspace.'],
    };
  }
  if (!snapshot) {
    return {
      state: 'missing',
      blockingReasons: [profile.status === 'calibrated'
        ? 'Legacy calibrated voice has no verified finalization snapshot.'
        : 'Brand voice has not been finalized.'],
    };
  }
  if (snapshot.profileRevision === profile.revision) {
    assertFinalizedProfileParity(profile, snapshot);
    return finalizedReadiness(snapshot);
  }
  return {
    state: 'stale',
    snapshot: snapshotRef(snapshot),
    blockingReasons: ['The voice profile changed after its latest finalization.'],
  };
}

export function getBrandVoiceReadiness(workspaceId: string): GetBrandVoiceResult {
  return coherentAuthorityRead(() => {
    if (!stmts().workspaceExists.get(workspaceId)) {
      throw new VoiceFinalizationNotFoundError('Workspace not found');
    }
    const profileRow = getProfileReadRow(workspaceId);
    const profile = profileRow ? rowToProfileSummary(profileRow) : null;
    const snapshot = latestSnapshot(workspaceId);
    const intake = getCurrentStoredBrandIntakeRevision(workspaceId)?.revision ?? null;
    const voiceAnchorCount = countEligibleVoiceSamples(profile?.id ?? null);
    const voiceAnchors = listEligibleVoiceSamples(
      profile?.id ?? null,
      0,
      voiceAnchorCount,
    );
    return {
      profile,
      readiness: fullReadiness(profile, snapshot),
      eligibleAnchors: [...voiceAnchors, ...intakeEligibleAnchors(intake)],
      latestSnapshot: snapshot,
    };
  });
}

function readAuthoritySummary(
  workspaceId: string,
): GetBrandVoiceAuthoritySummaryResult & {
  fullProfile: BrandVoiceProfileSummary | null;
  fullReadiness: BrandVoiceReadiness;
} {
  if (!stmts().workspaceExists.get(workspaceId)) {
    throw new VoiceFinalizationNotFoundError('Workspace not found');
  }
  const profileRow = getProfileReadRow(workspaceId);
  const fullProfile = profileRow ? rowToProfileSummary(profileRow) : null;
  const authoritySnapshot = latestSnapshotSummary(workspaceId);
  const snapshot = authoritySnapshot?.summary ?? null;
  return {
    profile: fullProfile
      ? { id: fullProfile.id, revision: fullProfile.revision, status: fullProfile.status }
      : null,
    fullProfile,
    readiness: summarizedReadiness(fullProfile, authoritySnapshot),
    fullReadiness: referenceReadiness(fullProfile, authoritySnapshot),
    latestSnapshot: snapshot,
  };
}

function coherentAuthorityRead<T>(read: () => T): T {
  return db.inTransaction ? read() : db.transaction(read).deferred();
}

export function getBrandVoiceAuthoritySummary(
  workspaceId: string,
): GetBrandVoiceAuthoritySummaryResult {
  return coherentAuthorityRead(() => {
    const {
      fullProfile: _fullProfile,
      fullReadiness: _fullReadiness,
      ...summary
    } = readAuthoritySummary(workspaceId);
    return summary;
  });
}

function anchorPageSize(limit: number | undefined): number {
  const resolved = limit ?? VOICE_FINALIZATION_LIMITS.defaultEligibleAnchorPageSize;
  if (
    !Number.isInteger(resolved)
    || resolved < 1
    || resolved > VOICE_FINALIZATION_LIMITS.maxEligibleAnchorPageSize
  ) {
    throw new VoiceFinalizationReadCursorError();
  }
  return resolved;
}

function assertCursorState(
  cursor: BrandVoiceAnchorCursorPayload,
  profile: BrandVoiceProfileSummary | null,
  intake: CurrentBrandIntakeRevision | null,
): void {
  if (
    cursor.profileId !== (profile?.id ?? null)
    || cursor.profileRevision !== (profile?.revision ?? null)
    || cursor.intakeRevisionId !== (intake?.id ?? null)
    || cursor.intakeRevision !== (intake?.revision ?? null)
  ) {
    throw new VoiceFinalizationReadConflictError();
  }
}

export function getBrandVoicePage(
  request: GetBrandVoicePageRequest,
): GetBrandVoicePageResult {
  return coherentAuthorityRead(() => {
    const authority = readAuthoritySummary(request.workspaceId);
    const profile = authority.fullProfile;
    const intake = getCurrentStoredBrandIntakeRevision(request.workspaceId)?.revision ?? null;
    const limit = anchorPageSize(request.anchorLimit);
    const cursor = request.anchorCursor
      ? decodeBrandVoiceAnchorCursor(request.anchorCursor, request.workspaceId)
      : null;
    if (cursor) assertCursorState(cursor, profile, intake);

    const offset = cursor?.offset ?? 0;
    const voiceCount = countEligibleVoiceSamples(profile?.id ?? null);
    const intakeAnchors = intakeEligibleAnchors(intake);
    const total = voiceCount + intakeAnchors.length;
    if (offset > total) throw new VoiceFinalizationReadCursorError();

    const voiceOffset = Math.min(offset, voiceCount);
    const voiceLimit = Math.min(limit, Math.max(voiceCount - voiceOffset, 0));
    const voiceItems = listEligibleVoiceSamples(profile?.id ?? null, voiceOffset, voiceLimit);
    const intakeOffset = Math.max(offset - voiceCount, 0);
    const intakeLimit = Math.max(limit - voiceItems.length, 0);
    const items = [
      ...voiceItems,
      ...intakeAnchors.slice(intakeOffset, intakeOffset + intakeLimit),
    ];
    const nextOffset = Math.min(offset + limit, total);
    const hasMore = nextOffset < total;
    const nextCursor = hasMore
      ? encodeBrandVoiceAnchorCursor({
          version: 1,
          kind: 'brand_voice_anchors',
          workspaceId: request.workspaceId,
          profileId: profile?.id ?? null,
          profileRevision: profile?.revision ?? null,
          intakeRevisionId: intake?.id ?? null,
          intakeRevision: intake?.revision ?? null,
          offset: nextOffset,
        })
      : null;

    return {
      profile,
      readiness: authority.readiness,
      eligibleAnchors: { items, nextCursor, hasMore },
      latestSnapshot: authority.latestSnapshot,
    };
  });
}

function finalizationInput(
  request: FinalizeBrandVoiceRequest | CreateVoiceFinalizationAuthorizationRequest,
): VoiceProfileFinalizationInput {
  return {
    expectedProfileRevision: request.expectedProfileRevision,
    voiceDNA: request.voiceDNA,
    guardrails: request.guardrails,
    contextModifiers: request.contextModifiers,
    anchorSelectors: request.anchorSelectors,
    calibrationSelections: request.calibrationSelections,
    idempotencyKey: request.idempotencyKey,
  };
}

function parseFinalizeRequest(request: FinalizeBrandVoiceRequest): FinalizeBrandVoiceRequest {
  const parsed = finalizeBrandVoiceRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new VoiceFinalizationPreconditionError(
      parsed.error.issues[0]?.message ?? 'Voice finalization command is invalid',
    );
  }
  return parsed.data as FinalizeBrandVoiceRequest;
}

function assertDirectOperatorFinalization(request: FinalizeBrandVoiceRequest): void {
  if (
    request.authorizationId !== undefined
    || request.executionActor.actorType !== 'operator'
    || request.executionActor.actorId !== request.finalizedBy.actorId
    || (request.executionActor.actorLabel ?? null) !== (request.finalizedBy.actorLabel ?? null)
  ) {
    // Delegated execution is intentionally reachable only through
    // consumeVoiceFinalizationAuthorization(), which resolves the exact
    // operator-approved command and consumes its bearer token atomically.
    throw new VoiceFinalizationAuthorizationError();
  }
}

function parseAuthorizationRequest(
  request: CreateVoiceFinalizationAuthorizationRequest,
): CreateVoiceFinalizationAuthorizationRequest {
  const parsed = createVoiceFinalizationAuthorizationRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new VoiceFinalizationPreconditionError(
      parsed.error.issues[0]?.message ?? 'Voice finalization authorization command is invalid',
    );
  }
  return parsed.data as CreateVoiceFinalizationAuthorizationRequest;
}

function requireProfile(workspaceId: string): VoiceProfileRow {
  if (!stmts().workspaceExists.get(workspaceId)) {
    throw new VoiceFinalizationNotFoundError('Workspace not found');
  }
  const profile = getProfileRow(workspaceId);
  if (!profile) throw new VoiceFinalizationNotFoundError();
  profileStatus(profile.status);
  return profile;
}

function assertExpectedRevision(profile: VoiceProfileRow, expected: number): void {
  if (profile.revision !== expected) {
    throw new VoiceFinalizationConflictError(expected, profile.revision);
  }
}

function assertLegalFinalizationPath(
  profile: VoiceProfileRow,
  latest: FinalizedVoiceSnapshot | null,
): void {
  const status = profileStatus(profile.status);
  if (latest?.profileRevision === profile.revision) {
    throw new VoiceFinalizationPreconditionError(
      'Brand voice is already finalized at the current profile revision.',
    );
  }

  try {
    if (status === 'draft') {
      validateTransition('voice_profile', VOICE_PROFILE_TRANSITIONS, 'draft', 'calibrating');
      validateTransition('voice_profile', VOICE_PROFILE_TRANSITIONS, 'calibrating', 'calibrated');
      return;
    }
    if (status === 'calibrating') {
      validateTransition('voice_profile', VOICE_PROFILE_TRANSITIONS, 'calibrating', 'calibrated');
      return;
    }
    if (status === 'calibrated' && !latest) {
      // Compatibility-only legacy rows may be truthfully finalized once without
      // inventing a prior operator, anchor, or immutable snapshot.
      return;
    }
  } catch (error) {
    if (!(error instanceof InvalidTransitionError)) throw error;
    // Normalize only a known illegal transition to the public domain error.
  }
  throw new VoiceFinalizationPreconditionError(
    'The voice profile must be reopened for calibration before it can be finalized again.',
  );
}

function asVoiceSampleContext(value: string | null): VoiceSampleContext {
  if (value === null) return 'body';
  if (
    value === 'headline'
    || value === 'body'
    || value === 'cta'
    || value === 'about'
    || value === 'service'
    || value === 'social'
    || value === 'seo'
  ) return value;
  throw new VoiceFinalizationPreconditionError('Selected voice sample has an invalid context.');
}

function resolveAnchors(
  request: FinalizeBrandVoiceRequest,
  profile: VoiceProfileRow,
  selectedAt: string,
): [FinalizedVoiceAnchorSnapshot, ...FinalizedVoiceAnchorSnapshot[]] {
  const anchors = request.anchorSelectors.map(selector => {
    if (selector.kind === 'voice_sample') {
      const row = stmts().getVoiceSample.get(
        request.workspaceId,
        profile.id,
        selector.voiceSampleId,
      ) as VoiceSampleAnchorRow | undefined;
      const sample = row ? parseEligibleVoiceSampleRow(row) : null;
      if (!sample) {
        throw new VoiceFinalizationPreconditionError(
          `Voice sample ${selector.voiceSampleId} is missing, cross-workspace, generated, or outside the eligible-anchor contract.`,
        );
      }
      const source = sample.source as AuthenticVoiceSampleSource;
      const anchor: FinalizedVoiceAnchorSnapshot = {
        selector,
        content: sample.content,
        context: asVoiceSampleContext(sample.context_tag),
        evidenceRef: {
          sourceType: 'voice_sample',
          sourceId: sample.id,
          voiceSampleSource: source,
          capturedAt: sample.created_at,
          selectedBy: request.finalizedBy,
          selectedAt,
        },
      };
      const parsed = finalizedVoiceAnchorSnapshotSchema.safeParse(anchor);
      if (!parsed.success) {
        throw new VoiceFinalizationPreconditionError(
          `Voice sample ${selector.voiceSampleId} cannot satisfy the finalization contract.`,
        );
      }
      return parsed.data;
    }

    const stored = getStoredBrandIntakeRevisionById(
      request.workspaceId,
      selector.intakeRevisionId,
    );
    if (!stored || stored.revision.revision !== selector.intakeRevision) {
      throw new VoiceFinalizationPreconditionError(
        `Brand intake revision ${selector.intakeRevisionId} was not found at revision ${selector.intakeRevision}.`,
      );
    }
    const sample = stored.revision.payload.authenticSamples.find(
      candidate => candidate.id === selector.sampleId,
    );
    if (!sample) {
      throw new VoiceFinalizationPreconditionError(
        `Brand intake sample ${selector.sampleId} was not found in the addressed revision.`,
      );
    }
    const anchor: FinalizedVoiceAnchorSnapshot = {
      selector,
      content: sample.content,
      context: sample.context,
      evidenceRef: {
        sourceType: 'brand_intake',
        sourceId: stored.revision.id,
        sourceRevision: stored.revision.revision,
        fieldPath: `authenticSamples.${sample.id}`,
        capturedAt: stored.revision.createdAt,
        selectedBy: request.finalizedBy,
        selectedAt,
      },
    };
    const parsed = finalizedVoiceAnchorSnapshotSchema.safeParse(anchor);
    if (!parsed.success) {
      throw new VoiceFinalizationPreconditionError(
        `Brand intake sample ${selector.sampleId} cannot satisfy the finalization contract.`,
      );
    }
    return parsed.data;
  });

  if (anchors.length === 0) {
    throw new VoiceFinalizationPreconditionError('At least one authentic voice anchor is required.');
  }
  return anchors as [FinalizedVoiceAnchorSnapshot, ...FinalizedVoiceAnchorSnapshot[]];
}

function resolveCalibrationSelections(
  request: FinalizeBrandVoiceRequest,
  profile: VoiceProfileRow,
): VoiceCalibrationSelectionSnapshot[] {
  const sessionCache = new Map<string, {
    row: CalibrationSessionRow;
    variations: z.infer<typeof storedCalibrationVariationSchema>[];
  }>();
  return request.calibrationSelections.map(selection => {
    let session = sessionCache.get(selection.sessionId);
    if (!session) {
      const row = stmts().getCalibrationSession.get({
        workspace_id: request.workspaceId,
        voice_profile_id: profile.id,
        session_id: selection.sessionId,
        max_variation_json_bytes: VOICE_FINALIZATION_LIMITS.maxSnapshotJsonBytes,
      }) as CalibrationSessionRow | undefined;
      if (!row) {
        throw new VoiceFinalizationPreconditionError(
          `Calibration session ${selection.sessionId} is missing or cross-workspace.`,
        );
      }
      if (
        !Number.isSafeInteger(row.variation_json_bytes)
        || row.variation_json_bytes < 0
        || row.variation_json_bytes > VOICE_FINALIZATION_LIMITS.maxSnapshotJsonBytes
        || row.variations_json === null
        || (row.variation_count !== null
          && row.variation_count > VOICE_FINALIZATION_LIMITS.maxCalibrationSelections)
      ) {
        throw new VoiceFinalizationPreconditionError(
          `Calibration session ${selection.sessionId} exceeds the bounded finalization contract.`,
        );
      }
      const variations = parseJsonSafeArray(
        row.variations_json,
        storedCalibrationVariationSchema,
        {
          workspaceId: request.workspaceId,
          table: 'voice_calibration_sessions',
          field: 'variations_json',
        },
      );
      if (
        row.variation_json_type !== 'array'
        || row.variation_count === null
        || variations.length !== row.variation_count
      ) {
        throw new VoiceFinalizationPersistenceContractError(
          `Calibration session ${selection.sessionId} contains invalid stored variations.`,
        );
      }
      session = { row, variations };
      sessionCache.set(selection.sessionId, session);
    }
    const { row, variations } = session;
    const variation = variations[selection.variationIndex];
    if (!variation || !variation.text.trim() || !row.prompt_type.trim()) {
      throw new VoiceFinalizationPreconditionError(
        `Calibration selection ${selection.sessionId}:${selection.variationIndex} does not address a durable variation.`,
      );
    }
    const parsed = voiceCalibrationSelectionSnapshotSchema.safeParse({
      ...selection,
      promptType: row.prompt_type,
      variationText: variation.text,
    });
    if (!parsed.success) {
      throw new VoiceFinalizationPreconditionError(
        `Calibration selection ${selection.sessionId}:${selection.variationIndex} cannot satisfy the finalization contract.`,
      );
    }
    return parsed.data;
  });
}

function assertResolvedSnapshotArrays(
  anchors: FinalizedVoiceAnchorSnapshot[],
  calibrationSelections: VoiceCalibrationSelectionSnapshot[],
): void {
  const anchorResult = finalizedVoiceAnchorsSnapshotSchema.safeParse(anchors);
  const calibrationResult = voiceCalibrationSelectionsSnapshotSchema.safeParse(
    calibrationSelections,
  );
  if (!anchorResult.success || !calibrationResult.success) {
    throw new VoiceFinalizationPreconditionError(
      'Resolved voice anchors or calibration evidence exceed the immutable snapshot contract.',
    );
  }
}

function mutationFingerprint(
  workspaceId: string,
  profileId: string,
  input: VoiceProfileFinalizationInput,
  finalizedBy: FinalizeBrandVoiceRequest['finalizedBy'],
): string {
  return canonicalFingerprint({ workspaceId, profileId, input, finalizedBy });
}

function replayResult(
  row: VoiceFinalizationRow,
  expectedMutationFingerprint: string,
): FinalizeBrandVoiceResult {
  if (row.mutation_fingerprint !== expectedMutationFingerprint) {
    throw new VoiceFinalizationIdempotencyConflictError(row.idempotency_key);
  }
  const snapshot = rowToSnapshot(row);
  const authority = readAuthoritySummary(row.workspace_id);
  return {
    snapshot,
    readiness: authority.fullReadiness,
    profileRevision: snapshot.profileRevision,
    created: false,
    replayed: true,
  };
}

function finalizeInTransaction(request: FinalizeBrandVoiceRequest): FinalizeBrandVoiceResult {
  const profile = requireProfile(request.workspaceId);
  const input = finalizationInput(request);
  const commandFingerprint = mutationFingerprint(
    request.workspaceId,
    profile.id,
    input,
    request.finalizedBy,
  );
  const prior = stmts().finalizationByIdempotencyKey.get(
    request.workspaceId,
    request.idempotencyKey,
  ) as VoiceFinalizationRow | undefined;
  if (prior) return replayResult(prior, commandFingerprint);

  assertExpectedRevision(profile, request.expectedProfileRevision);
  const latest = latestSnapshot(request.workspaceId);
  assertLegalFinalizationPath(profile, latest);

  const now = new Date().toISOString();
  const anchors = resolveAnchors(request, profile, now);
  const calibrationSelections = resolveCalibrationSelections(request, profile);
  assertResolvedSnapshotArrays(anchors, calibrationSelections);
  const { version: voiceVersion } = stmts().nextVoiceVersion.get(profile.id) as {
    version: number;
  };
  const profileRevision = profile.revision + 1;
  const id = `vpf_${randomUUID()}`;
  const snapshotWithoutFingerprint = {
    id,
    workspaceId: request.workspaceId,
    voiceProfileId: profile.id,
    voiceVersion,
    profileRevision,
    voiceDNA: request.voiceDNA,
    guardrails: request.guardrails,
    contextModifiers: request.contextModifiers,
    anchors,
    calibrationSelections,
    finalizedBy: request.finalizedBy,
    executionActor: request.executionActor,
    finalizedAt: now,
    createdAt: now,
    anchorEvidenceRefs: anchors.map(anchor => anchor.evidenceRef),
  };
  const fingerprint = canonicalFingerprint(
    snapshotFingerprintPayload(snapshotWithoutFingerprint),
  );
  const parsedSnapshot = finalizedVoiceSnapshotSchema.safeParse({
    ...snapshotWithoutFingerprint,
    fingerprint,
  });
  if (!parsedSnapshot.success) {
    throw new VoiceFinalizationPreconditionError(
      'The resolved brand voice cannot satisfy the immutable snapshot contract.',
    );
  }
  const snapshot = parsedSnapshot.data as FinalizedVoiceSnapshot;

  const updated = stmts().updateProfileForFinalization.run({
    id: profile.id,
    workspace_id: request.workspaceId,
    expected_revision: request.expectedProfileRevision,
    voice_dna_json: JSON.stringify(request.voiceDNA),
    guardrails_json: JSON.stringify(request.guardrails),
    context_modifiers_json: JSON.stringify(request.contextModifiers),
    updated_at: now,
  });
  if (updated.changes !== 1) {
    const current = getProfileRow(request.workspaceId);
    if (!current) throw new VoiceFinalizationNotFoundError();
    throw new VoiceFinalizationConflictError(
      request.expectedProfileRevision,
      current.revision,
    );
  }

  stmts().insertFinalization.run({
    id,
    schema_version: VOICE_FINALIZATION_SCHEMA_VERSIONS.snapshot,
    workspace_id: request.workspaceId,
    voice_profile_id: profile.id,
    voice_version: voiceVersion,
    profile_revision: profileRevision,
    voice_dna_json: JSON.stringify(snapshot.voiceDNA),
    guardrails_json: JSON.stringify(snapshot.guardrails),
    context_modifiers_json: JSON.stringify(snapshot.contextModifiers),
    anchors_json: JSON.stringify(snapshot.anchors),
    calibration_selections_json: JSON.stringify(snapshot.calibrationSelections),
    finalized_by_json: JSON.stringify(snapshot.finalizedBy),
    execution_actor_json: JSON.stringify(snapshot.executionActor),
    fingerprint,
    mutation_fingerprint: commandFingerprint,
    idempotency_key: request.idempotencyKey,
    authorization_id: request.authorizationId ?? null,
    finalized_at: now,
    created_at: now,
  });

  return {
    snapshot,
    readiness: finalizedReadiness(snapshot),
    profileRevision,
    created: true,
    replayed: false,
  };
}

export function finalizeBrandVoice(
  request: FinalizeBrandVoiceRequest,
): FinalizeBrandVoiceResult {
  const parsed = parseFinalizeRequest(request);
  assertDirectOperatorFinalization(parsed);
  return db.transaction(() => finalizeInTransaction(parsed)).immediate();
}

interface ValidatedVoiceAuthorizationEnvelope {
  ref: VoiceFinalizationAuthorizationRef;
  executionActor: ConsumeVoiceFinalizationAuthorizationRequest['executionActor'] | null;
}

function authorizationEnvelope(
  row: VoiceAuthorizationRow,
): ValidatedVoiceAuthorizationEnvelope {
  const authorizedBy = parseRequiredJson(
    row.authorized_by_json,
    generationOperatorAttributionSchema,
    row,
    'authorized_by_json',
  );
  const parsed = voiceFinalizationAuthorizationRefSchema.safeParse({
    authorizationId: row.id,
    workspaceId: row.workspace_id,
    voiceProfileId: row.voice_profile_id,
    expectedProfileRevision: row.expected_profile_revision,
    authorizedBy,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    finalizationId: row.finalization_id,
  });
  if (!parsed.success) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice finalization authorization ${row.id} violates its contract`,
    );
  }
  const issuedAtMs = Date.parse(parsed.data.issuedAt);
  const expiresAtMs = Date.parse(parsed.data.expiresAt);
  const consumedAtMs = parsed.data.consumedAt === null
    ? null
    : Date.parse(parsed.data.consumedAt);
  if (
    !Number.isFinite(issuedAtMs)
    || !Number.isFinite(expiresAtMs)
    || (consumedAtMs !== null && !Number.isFinite(consumedAtMs))
    || (consumedAtMs !== null && consumedAtMs < issuedAtMs)
    || (consumedAtMs !== null && consumedAtMs >= expiresAtMs)
    || issuedAtMs >= expiresAtMs
    || expiresAtMs - issuedAtMs > VOICE_FINALIZATION_LIMITS.authorizationTtlSeconds * 1_000
  ) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice finalization authorization ${row.id} has an invalid time window`,
    );
  }
  let executionActor: ConsumeVoiceFinalizationAuthorizationRequest['executionActor'] | null = null;
  if (row.execution_actor_json !== null) {
    const storedActor = parseJsonSafe(
      row.execution_actor_json,
      voiceFinalizationExecutionAttributionSchema,
      null,
      {
        workspaceId: row.workspace_id,
        table: 'voice_finalization_authorizations',
        field: 'execution_actor_json',
      },
    );
    if (storedActor === null || storedActor.actorType !== 'mcp') {
      throw new VoiceFinalizationPersistenceContractError(
        `Stored voice finalization authorization ${row.id} has invalid MCP execution provenance`,
      );
    }
    executionActor = {
      actorType: 'mcp',
      actorId: storedActor.actorId,
      actorLabel: storedActor.actorLabel,
    };
  }
  const consumedTuple = [
    parsed.data.consumedAt,
    parsed.data.finalizationId,
    executionActor,
  ];
  const populated = consumedTuple.filter(value => value !== null).length;
  if (populated !== 0 && populated !== consumedTuple.length) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice finalization authorization ${row.id} has a partial consumption tuple`,
    );
  }
  return { ref: parsed.data, executionActor };
}

function snapshotFinalizationInputV1(
  row: VoiceFinalizationRow,
  snapshot: FinalizedVoiceSnapshot,
): VoiceProfileFinalizationInput {
  const candidate = {
    expectedProfileRevision: snapshot.profileRevision - 1,
    voiceDNA: snapshot.voiceDNA,
    guardrails: snapshot.guardrails,
    contextModifiers: snapshot.contextModifiers,
    anchorSelectors: snapshot.anchors.map(anchor => anchor.selector),
    calibrationSelections: snapshot.calibrationSelections.map(selection => {
      const {
        promptType: _promptType,
        variationText: _variationText,
        ...commandSelection
      } = selection;
      void _promptType;
      void _variationText;
      return commandSelection;
    }),
    idempotencyKey: row.idempotency_key,
  };
  const parsed = voiceProfileFinalizationStructuralInputV1Schema.safeParse(candidate);
  if (!parsed.success) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice finalization ${row.id} cannot reconstruct its version 1 command`,
    );
  }
  return parsed.data as VoiceProfileFinalizationInput;
}

function assertSnapshotAuthorizationBinding(
  row: VoiceFinalizationRow,
  snapshot: FinalizedVoiceSnapshot,
): void {
  const persistenceError = () => new VoiceFinalizationPersistenceContractError(
    `Stored voice finalization ${row.id} has invalid execution authorization provenance`,
  );
  const snapshotInput = snapshotFinalizationInputV1(row, snapshot);
  const snapshotMutationFingerprint = mutationFingerprint(
    row.workspace_id,
    row.voice_profile_id,
    snapshotInput,
    snapshot.finalizedBy,
  );
  if (
    !/^[0-9a-f]{64}$/.test(row.mutation_fingerprint)
    || row.mutation_fingerprint !== snapshotMutationFingerprint
  ) {
    throw persistenceError();
  }

  if (snapshot.executionActor.actorType === 'operator') {
    if (
      row.authorization_id !== null
      || canonicalFingerprint(snapshot.executionActor)
        !== canonicalFingerprint(snapshot.finalizedBy)
    ) {
      throw persistenceError();
    }
    return;
  }

  if (row.authorization_id === null) throw persistenceError();
  const authorizationRow = stmts().authorizationById.get(
    row.workspace_id,
    row.authorization_id,
  ) as VoiceAuthorizationRow | undefined;
  if (!authorizationRow) throw persistenceError();
  const authorization = authorizationEnvelope(authorizationRow);
  const storedCommand = parseStoredAuthorizationCommand(authorizationRow);
  if (
    authorization.ref.workspaceId !== row.workspace_id
    || authorization.ref.voiceProfileId !== row.voice_profile_id
    || authorization.ref.expectedProfileRevision + 1 !== row.profile_revision
    || authorization.ref.consumedAt === null
    || authorization.ref.finalizationId !== row.id
    || authorizationRow.mutation_fingerprint !== row.mutation_fingerprint
    || authorizationRow.mutation_fingerprint !== snapshotMutationFingerprint
    || canonicalFingerprint(storedCommand.input) !== canonicalFingerprint(snapshotInput)
    || canonicalFingerprint(storedCommand.authorizedBy)
      !== canonicalFingerprint(snapshot.finalizedBy)
    || canonicalFingerprint(authorization.ref.authorizedBy)
      !== canonicalFingerprint(snapshot.finalizedBy)
    || authorization.executionActor === null
    || canonicalFingerprint(authorization.executionActor)
      !== canonicalFingerprint(snapshot.executionActor)
  ) {
    throw persistenceError();
  }
}

function authorizationRef(row: VoiceAuthorizationRow): VoiceFinalizationAuthorizationRef {
  return authorizationEnvelope(row).ref;
}

export function createVoiceFinalizationAuthorization(
  request: CreateVoiceFinalizationAuthorizationRequest,
): CreateVoiceFinalizationAuthorizationResult {
  const parsed = parseAuthorizationRequest(request);
  return db.transaction(() => {
    const profile = requireProfile(parsed.workspaceId);
    assertExpectedRevision(profile, parsed.expectedProfileRevision);
    assertLegalFinalizationPath(profile, latestSnapshot(parsed.workspaceId));

    // Resolve every durable reference before minting a bearer secret. A later
    // sample mutation increments the profile revision, so consume then fails CAS.
    const validationRequest: FinalizeBrandVoiceRequest = {
      ...parsed,
      finalizedBy: parsed.authorizedBy,
      executionActor: parsed.authorizedBy,
    };
    const resolvedAnchors = resolveAnchors(
      validationRequest,
      profile,
      new Date().toISOString(),
    );
    const resolvedSelections = resolveCalibrationSelections(validationRequest, profile);
    assertResolvedSnapshotArrays(resolvedAnchors, resolvedSelections);

    const authorizationToken = randomBytes(32).toString('base64url');
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + VOICE_FINALIZATION_LIMITS.authorizationTtlSeconds * 1_000,
    );
    const id = `vfa_${randomUUID()}`;
    const input = finalizationInput(parsed);
    const commandFingerprint = mutationFingerprint(
      parsed.workspaceId,
      profile.id,
      input,
      parsed.authorizedBy,
    );
    stmts().insertAuthorization.run({
      id,
      request_schema_version: VOICE_FINALIZATION_SCHEMA_VERSIONS.authorizationRequest,
      token_hash: tokenHash(authorizationToken),
      workspace_id: parsed.workspaceId,
      voice_profile_id: profile.id,
      expected_profile_revision: parsed.expectedProfileRevision,
      request_json: JSON.stringify(input),
      mutation_fingerprint: commandFingerprint,
      authorized_by_json: JSON.stringify(parsed.authorizedBy),
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
    const row = stmts().authorizationByToken.get(
      parsed.workspaceId,
      tokenHash(authorizationToken),
    ) as VoiceAuthorizationRow | undefined;
    if (!row) {
      throw new VoiceFinalizationAuthorizationError();
    }
    return { authorization: authorizationRef(row), authorizationToken };
  }).immediate();
}

function parseStoredAuthorizationCommand(row: VoiceAuthorizationRow): {
  input: VoiceProfileFinalizationInput;
  authorizedBy: CreateVoiceFinalizationAuthorizationRequest['authorizedBy'];
} {
  let input: VoiceProfileFinalizationInput;
  switch (row.request_schema_version) {
    case VOICE_FINALIZATION_SCHEMA_VERSIONS.authorizationRequest:
      input = parseRequiredJson(
        row.request_json,
        voiceProfileFinalizationInputV1Schema,
        row,
        'request_json',
      );
      break;
    default:
      throw new VoiceFinalizationPersistenceContractError(
        `Stored voice finalization authorization ${row.id} has an unsupported request schema version`,
      );
  }
  const authorizedBy = parseJsonSafe(
    row.authorized_by_json,
    generationOperatorAttributionSchema,
    null,
    {
      workspaceId: row.workspace_id,
      table: 'voice_finalization_authorizations',
      field: 'authorized_by_json',
    },
  );
  if (!authorizedBy || input.expectedProfileRevision !== row.expected_profile_revision) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice finalization authorization ${row.id} is invalid`,
    );
  }
  const storedInput = input as VoiceProfileFinalizationInput;
  const expectedFingerprint = mutationFingerprint(
    row.workspace_id,
    row.voice_profile_id,
    storedInput,
    authorizedBy,
  );
  if (expectedFingerprint !== row.mutation_fingerprint) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice finalization authorization ${row.id} has a stale or corrupt fingerprint`,
    );
  }
  return { input: storedInput, authorizedBy };
}

export function consumeVoiceFinalizationAuthorization(
  request: ConsumeVoiceFinalizationAuthorizationRequest,
): FinalizeBrandVoiceResult {
  if (
    typeof request.workspaceId !== 'string'
    || request.workspaceId.trim() !== request.workspaceId
    || request.workspaceId.length < 1
    || request.workspaceId.length > VOICE_FINALIZATION_LIMITS.maxIdLength
    || typeof request.authorizationToken !== 'string'
    || request.authorizationToken.trim() !== request.authorizationToken
    || request.authorizationToken.length < 1
    || request.authorizationToken.length > VOICE_FINALIZATION_LIMITS.maxAuthorizationTokenLength
  ) {
    throw new VoiceFinalizationAuthorizationError();
  }
  const executionActor = voiceFinalizationExecutionAttributionSchema.safeParse(
    request.executionActor,
  );
  if (!executionActor.success || executionActor.data.actorType !== 'mcp') {
    throw new VoiceFinalizationAuthorizationError();
  }
  const digest = tokenHash(request.authorizationToken);

  return db.transaction(() => {
    const row = stmts().authorizationByToken.get(
      request.workspaceId,
      digest,
    ) as VoiceAuthorizationRow | undefined;
    if (!row) throw new VoiceFinalizationAuthorizationError();
    const envelope = authorizationEnvelope(row);
    const authorization = envelope.ref;

    // Versioned frozen request codecs keep a committed result exactly replayable
    // after expiry and across future command-schema changes without trusting a
    // corrupt or ambiguously parsed authorization payload.
    if (row.consumed_at !== null || row.finalization_id !== null) {
      parseStoredAuthorizationCommand(row);
      if (!row.consumed_at || !row.finalization_id) {
        throw new VoiceFinalizationPersistenceContractError(
          `Stored voice finalization authorization ${row.id} has inconsistent consumption state`,
        );
      }
      if (
        envelope.executionActor === null
        || canonicalFingerprint(envelope.executionActor)
          !== canonicalFingerprint(executionActor.data)
      ) {
        throw new VoiceFinalizationAuthorizationError();
      }
      const finalization = stmts().finalizationById.get(
        request.workspaceId,
        row.finalization_id,
      ) as VoiceFinalizationRow | undefined;
      if (!finalization) {
        throw new VoiceFinalizationPersistenceContractError(
          `Stored voice finalization authorization ${row.id} has no linked finalization`,
        );
      }
      if (
        finalization.workspace_id !== row.workspace_id
        || finalization.voice_profile_id !== row.voice_profile_id
        || finalization.profile_revision !== row.expected_profile_revision + 1
      ) {
        throw new VoiceFinalizationPersistenceContractError(
          `Stored voice finalization authorization ${row.id} has an invalid result linkage`,
        );
      }
      const replay = replayResult(finalization, row.mutation_fingerprint);
      if (
        canonicalFingerprint(replay.snapshot.finalizedBy)
          !== canonicalFingerprint(authorization.authorizedBy)
        || (
          finalization.authorization_id === row.id
          && (
            replay.snapshot.executionActor.actorType !== 'mcp'
            || canonicalFingerprint(replay.snapshot.executionActor)
              !== canonicalFingerprint(envelope.executionActor)
          )
        )
      ) {
        throw new VoiceFinalizationPersistenceContractError(
          `Stored voice finalization authorization ${row.id} has invalid delegated provenance`,
        );
      }
      return replay;
    }
    const nowMs = Date.now();
    if (
      Date.parse(authorization.issuedAt) > nowMs
      || Date.parse(authorization.expiresAt) <= nowMs
    ) {
      throw new VoiceFinalizationAuthorizationError();
    }

    const { input, authorizedBy } = parseStoredAuthorizationCommand(row);

    const result = finalizeInTransaction({
      ...input,
      workspaceId: row.workspace_id,
      finalizedBy: authorizedBy,
      executionActor: executionActor.data,
      authorizationId: row.id,
    });
    const consumedAt = new Date(nowMs).toISOString();
    const consumed = stmts().consumeAuthorization.run({
      id: row.id,
      workspace_id: row.workspace_id,
      consumed_at: consumedAt,
      finalization_id: result.snapshot.id,
      execution_actor_json: JSON.stringify(executionActor.data),
    });
    if (consumed.changes !== 1) {
      throw new VoiceFinalizationAuthorizationError();
    }
    return result;
  }).immediate();
}
