import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

import db from '../../db/index.js';
import { parseJsonSafe, parseJsonSafeArray } from '../../db/json-validation.js';
import { createStmtCache } from '../../db/stmt-cache.js';
import { getStoredBrandIntakeRevisionById, getCurrentStoredBrandIntakeRevision } from './intake/repository.js';
import { getVoiceProfile } from '../../voice-profile-read-model.js';
import {
  InvalidTransitionError,
  VOICE_PROFILE_TRANSITIONS,
  validateTransition,
} from '../../state-machines.js';
import {
  AUTHENTIC_VOICE_SAMPLE_SOURCES,
  type AuthenticVoiceSampleSource,
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
  EligibleVoiceAnchor,
  FinalizeBrandVoiceRequest,
  FinalizeBrandVoiceResult,
  FinalizedVoiceAnchorSnapshot,
  FinalizedVoiceSnapshot,
  GetBrandVoiceResult,
  VoiceCalibrationSelectionSnapshot,
  VoiceProfileFinalizationInput,
  VoiceFinalizationAuthorizationRef,
  ConsumeVoiceFinalizationAuthorizationRequest,
} from '../../../shared/types/voice-finalization.js';
import { VOICE_FINALIZATION_LIMITS } from '../../../shared/types/voice-finalization.js';
import {
  createVoiceFinalizationAuthorizationRequestSchema,
  finalizeBrandVoiceRequestSchema,
  finalizedVoiceAnchorSnapshotSchema,
  finalizedVoiceSnapshotSchema,
  generationOperatorAttributionSchema,
  generationResolverAttributionSchema,
  voiceCalibrationSelectionSnapshotSchema,
  voiceDNASchema,
  voiceGuardrailsSchema,
  voiceProfileFinalizationInputSchema,
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

interface VoiceProfileRow {
  id: string;
  workspace_id: string;
  status: string;
  revision: number;
}

interface VoiceSampleAnchorRow {
  id: string;
  content: string;
  context_tag: string | null;
  source: string | null;
  created_at: string;
}

interface CalibrationSessionRow {
  id: string;
  prompt_type: string;
  variations_json: string;
  variation_json_type: string | null;
  variation_count: number | null;
}

interface VoiceFinalizationRow {
  id: string;
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
}

const FINALIZATION_SELECT = `
  SELECT
    id, workspace_id, voice_profile_id, voice_version, profile_revision,
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
  getVoiceSample: db.prepare(`
    SELECT sample.id, sample.content, sample.context_tag, sample.source, sample.created_at
    FROM voice_samples sample
    JOIN voice_profiles profile ON profile.id = sample.voice_profile_id
    WHERE profile.workspace_id = ?
      AND profile.id = ?
      AND sample.id = ?
    LIMIT 1
  `),
  getCalibrationSession: db.prepare(`
    SELECT
      session.id,
      session.prompt_type,
      session.variations_json,
      CASE WHEN json_valid(session.variations_json)
        THEN json_type(session.variations_json) ELSE NULL END AS variation_json_type,
      CASE WHEN json_valid(session.variations_json)
        THEN json_array_length(session.variations_json) ELSE NULL END AS variation_count
    FROM voice_calibration_sessions session
    JOIN voice_profiles profile ON profile.id = session.voice_profile_id
    WHERE profile.workspace_id = ?
      AND profile.id = ?
      AND session.id = ?
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
      id, workspace_id, voice_profile_id, voice_version, profile_revision,
      voice_dna_json, guardrails_json, context_modifiers_json, anchors_json,
      calibration_selections_json, finalized_by_json, execution_actor_json,
      fingerprint, mutation_fingerprint, idempotency_key, authorization_id,
      finalized_at, created_at
    ) VALUES (
      @id, @workspace_id, @voice_profile_id, @voice_version, @profile_revision,
      @voice_dna_json, @guardrails_json, @context_modifiers_json, @anchors_json,
      @calibration_selections_json, @finalized_by_json, @execution_actor_json,
      @fingerprint, @mutation_fingerprint, @idempotency_key, @authorization_id,
      @finalized_at, @created_at
    )
  `),
  insertAuthorization: db.prepare(`
    INSERT INTO voice_finalization_authorizations (
      id, token_hash, workspace_id, voice_profile_id,
      expected_profile_revision, request_json, mutation_fingerprint,
      authorized_by_json, issued_at, expires_at, consumed_at, finalization_id
    ) VALUES (
      @id, @token_hash, @workspace_id, @voice_profile_id,
      @expected_profile_revision, @request_json, @mutation_fingerprint,
      @authorized_by_json, @issued_at, @expires_at, NULL, NULL
    )
  `),
  authorizationByToken: db.prepare(`
    SELECT *
    FROM voice_finalization_authorizations
    WHERE workspace_id = ? AND token_hash = ?
    LIMIT 1
  `),
  consumeAuthorization: db.prepare(`
    UPDATE voice_finalization_authorizations
    SET consumed_at = @consumed_at, finalization_id = @finalization_id
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

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const storedCalibrationVariationSchema = z.object({
  text: z.string(),
}).passthrough();

function parseRequiredJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  row: VoiceFinalizationRow | VoiceAuthorizationRow,
  field: string,
): T {
  const parsed = parseJsonSafe(raw, schema, null, {
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

function evidenceIdentity(
  evidenceRef: FinalizedVoiceAnchorSnapshot['evidenceRef'],
): unknown {
  const {
    capturedAt: _capturedAt,
    selectedAt: _selectedAt,
    selectedBy: _selectedBy,
    ...identity
  } = evidenceRef;
  return identity;
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
      evidenceRef: evidenceIdentity(anchor.evidenceRef),
    })),
    calibrationSelections: snapshot.calibrationSelections,
  };
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
    generationResolverAttributionSchema,
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
  const parsed = finalizedVoiceSnapshotSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new VoiceFinalizationPersistenceContractError(
      `Stored voice finalization ${row.id} violates the snapshot contract`,
    );
  }
  return parsed.data as FinalizedVoiceSnapshot;
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

function latestSnapshot(workspaceId: string): FinalizedVoiceSnapshot | null {
  const row = stmts().latestFinalization.get(workspaceId) as VoiceFinalizationRow | undefined;
  return row ? rowToSnapshot(row) : null;
}

function eligibleAnchors(workspaceId: string): EligibleVoiceAnchor[] {
  const profile = getVoiceProfile(workspaceId);
  const anchors: EligibleVoiceAnchor[] = [];
  if (profile) {
    for (const sample of profile.samples) {
      if (!sample.source || !AUTHENTIC_VOICE_SAMPLE_SOURCES.includes(
        sample.source as AuthenticVoiceSampleSource,
      )) continue;
      anchors.push({
        selector: { kind: 'voice_sample', voiceSampleId: sample.id },
        content: sample.content,
        context: sample.contextTag ?? 'body',
        sourceLabel: sample.source === 'manual'
          ? 'Operator-entered voice sample'
          : 'Transcript voice sample',
        capturedAt: sample.createdAt,
      });
    }
  }

  const intake = getCurrentStoredBrandIntakeRevision(workspaceId)?.revision ?? null;
  if (intake) {
    for (const sample of intake.payload.authenticSamples) {
      anchors.push({
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
      });
    }
  }
  return anchors;
}

export function getBrandVoiceReadiness(workspaceId: string): GetBrandVoiceResult {
  if (!stmts().workspaceExists.get(workspaceId)) {
    throw new VoiceFinalizationNotFoundError('Workspace not found');
  }
  const profile = getVoiceProfile(workspaceId);
  if (!profile) {
    return {
      profile: null,
      readiness: {
        state: 'missing',
        blockingReasons: ['No voice profile exists for this workspace.'],
      },
      eligibleAnchors: eligibleAnchors(workspaceId),
      latestSnapshot: null,
    };
  }

  const snapshot = latestSnapshot(workspaceId);
  let readiness: BrandVoiceReadiness;
  if (!snapshot) {
    readiness = {
      state: 'missing',
      blockingReasons: [profile.status === 'calibrated'
        ? 'Legacy calibrated voice has no verified finalization snapshot.'
        : 'Brand voice has not been finalized.'],
    };
  } else if (snapshot.profileRevision === profile.revision) {
    readiness = finalizedReadiness(snapshot);
  } else {
    readiness = {
      state: 'stale',
      snapshot: snapshotRef(snapshot),
      blockingReasons: ['The voice profile changed after its latest finalization.'],
    };
  }

  return {
    profile: {
      id: profile.id,
      revision: profile.revision,
      status: profile.status,
      voiceDNA: profile.voiceDNA,
      guardrails: profile.guardrails,
      contextModifiers: profile.contextModifiers ?? [],
      updatedAt: profile.updatedAt,
    },
    readiness,
    eligibleAnchors: eligibleAnchors(workspaceId),
    latestSnapshot: snapshot,
  };
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
      if (!row || !row.source || !AUTHENTIC_VOICE_SAMPLE_SOURCES.includes(
        row.source as AuthenticVoiceSampleSource,
      )) {
        throw new VoiceFinalizationPreconditionError(
          `Voice sample ${selector.voiceSampleId} is missing, cross-workspace, or generated.`,
        );
      }
      const source = row.source as AuthenticVoiceSampleSource;
      const anchor: FinalizedVoiceAnchorSnapshot = {
        selector,
        content: row.content,
        context: asVoiceSampleContext(row.context_tag),
        evidenceRef: {
          sourceType: 'voice_sample',
          sourceId: row.id,
          voiceSampleSource: source,
          capturedAt: row.created_at,
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
  return request.calibrationSelections.map(selection => {
    const row = stmts().getCalibrationSession.get(
      request.workspaceId,
      profile.id,
      selection.sessionId,
    ) as CalibrationSessionRow | undefined;
    if (!row) {
      throw new VoiceFinalizationPreconditionError(
        `Calibration session ${selection.sessionId} is missing or cross-workspace.`,
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
    const variation = variations[selection.variationIndex];
    if (!variation || !variation.text.trim() || !row.prompt_type.trim()) {
      throw new VoiceFinalizationPreconditionError(
        `Calibration selection ${selection.sessionId}:${selection.variationIndex} does not address a durable variation.`,
      );
    }
    return voiceCalibrationSelectionSnapshotSchema.parse({
      ...selection,
      promptType: row.prompt_type,
      variationText: variation.text,
    });
  });
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
  return {
    snapshot,
    readiness: getBrandVoiceReadiness(row.workspace_id).readiness,
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
  const snapshot = finalizedVoiceSnapshotSchema.parse({
    ...snapshotWithoutFingerprint,
    fingerprint,
  }) as FinalizedVoiceSnapshot;

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
  return db.transaction(() => finalizeInTransaction(parsed)).immediate();
}

function authorizationRef(row: VoiceAuthorizationRow): VoiceFinalizationAuthorizationRef {
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
  return parsed.data;
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
    resolveAnchors(validationRequest, profile, new Date().toISOString());
    resolveCalibrationSelections(validationRequest, profile);

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
  const input = parseJsonSafe(
    row.request_json,
    voiceProfileFinalizationInputSchema,
    null,
    {
      workspaceId: row.workspace_id,
      table: 'voice_finalization_authorizations',
      field: 'request_json',
    },
  );
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
  if (!input || !authorizedBy || input.expectedProfileRevision !== row.expected_profile_revision) {
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
  const executionActor = generationResolverAttributionSchema.safeParse(request.executionActor);
  if (!executionActor.success) throw new VoiceFinalizationAuthorizationError();
  const digest = tokenHash(request.authorizationToken);

  return db.transaction(() => {
    const row = stmts().authorizationByToken.get(
      request.workspaceId,
      digest,
    ) as VoiceAuthorizationRow | undefined;
    if (!row) throw new VoiceFinalizationAuthorizationError();
    const { input, authorizedBy } = parseStoredAuthorizationCommand(row);

    // A committed result remains exactly replayable even after the short-lived
    // command token expires. Expiry only blocks an unconsumed authorization.
    if (row.consumed_at !== null || row.finalization_id !== null) {
      if (!row.consumed_at || !row.finalization_id) {
        throw new VoiceFinalizationPersistenceContractError(
          `Stored voice finalization authorization ${row.id} has inconsistent consumption state`,
        );
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
      return replayResult(finalization, row.mutation_fingerprint);
    }
    if (row.expires_at <= new Date().toISOString()) {
      throw new VoiceFinalizationAuthorizationError();
    }

    const result = finalizeInTransaction({
      ...input,
      workspaceId: row.workspace_id,
      finalizedBy: authorizedBy,
      executionActor: executionActor.data,
      authorizationId: row.id,
    });
    const consumedAt = new Date().toISOString();
    const consumed = stmts().consumeAuthorization.run({
      id: row.id,
      workspace_id: row.workspace_id,
      consumed_at: consumedAt,
      finalization_id: result.snapshot.id,
    });
    if (consumed.changes !== 1) {
      throw new VoiceFinalizationAuthorizationError();
    }
    return result;
  }).immediate();
}
