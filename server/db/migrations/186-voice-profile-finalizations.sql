-- B1: optimistic voice-profile revisions plus immutable, authentically anchored
-- finalization history. Legacy calibrated rows intentionally receive no
-- fabricated finalization record because their anchors/operator are unknown.

ALTER TABLE voice_profiles
  ADD revision INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(revision) = 'integer' AND revision >= 1);

CREATE UNIQUE INDEX idx_voice_profiles_id_workspace
  ON voice_profiles(id, workspace_id);

CREATE TABLE voice_profile_finalizations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(schema_version) = 'integer' AND schema_version >= 1
  ),
  workspace_id TEXT NOT NULL,
  voice_profile_id TEXT NOT NULL,
  voice_version INTEGER NOT NULL CHECK (
    typeof(voice_version) = 'integer' AND voice_version >= 1
  ),
  profile_revision INTEGER NOT NULL CHECK (
    typeof(profile_revision) = 'integer' AND profile_revision >= 2
  ),
  voice_dna_json TEXT NOT NULL CHECK (
    length(CAST(voice_dna_json AS BLOB)) <= 131072
    AND json_valid(voice_dna_json)
    AND json_type(voice_dna_json) = 'object'
  ),
  guardrails_json TEXT NOT NULL CHECK (
    length(CAST(guardrails_json AS BLOB)) <= 131072
    AND json_valid(guardrails_json)
    AND json_type(guardrails_json) = 'object'
  ),
  context_modifiers_json TEXT NOT NULL CHECK (
    length(CAST(context_modifiers_json AS BLOB)) <= 131072
    AND json_valid(context_modifiers_json)
    AND json_type(context_modifiers_json) = 'array'
  ),
  anchors_json TEXT NOT NULL -- json-array-column-ok: bounded immutable authority snapshot; never filtered/sorted in SQL
  CHECK (
    length(CAST(anchors_json AS BLOB)) <= 524288
    AND json_valid(anchors_json)
    AND json_type(anchors_json) = 'array'
    AND json_array_length(anchors_json) BETWEEN 1 AND 25
  ),
  calibration_selections_json TEXT NOT NULL DEFAULT '[]' -- json-array-column-ok: bounded immutable review evidence; never filtered/sorted in SQL
  CHECK (
    length(CAST(calibration_selections_json AS BLOB)) <= 524288
    AND json_valid(calibration_selections_json)
    AND json_type(calibration_selections_json) = 'array'
    AND json_array_length(calibration_selections_json) <= 100
  ),
  finalized_by_json TEXT NOT NULL CHECK (
    length(CAST(finalized_by_json AS BLOB)) <= 4096
    AND json_valid(finalized_by_json)
    AND json_type(finalized_by_json) = 'object'
    AND json_type(finalized_by_json, '$.actorType') IS 'text'
    AND json_extract(finalized_by_json, '$.actorType') = 'operator'
    AND json_type(finalized_by_json, '$.actorId') IS 'text'
    AND length(json_extract(finalized_by_json, '$.actorId')) BETWEEN 1 AND 128
    AND json_extract(finalized_by_json, '$.actorId')
      = trim(
        json_extract(finalized_by_json, '$.actorId'),
        ' ' || char(9) || char(10) || char(11) || char(12) || char(13)
      )
    AND (
      json_type(finalized_by_json, '$.actorLabel') IS NULL
      OR (
        json_type(finalized_by_json, '$.actorLabel') IS 'text'
        AND length(json_extract(finalized_by_json, '$.actorLabel')) BETWEEN 1 AND 200
        AND json_extract(finalized_by_json, '$.actorLabel')
          = trim(
            json_extract(finalized_by_json, '$.actorLabel'),
            ' ' || char(9) || char(10) || char(11) || char(12) || char(13)
          )
      )
    )
    AND json_remove(
      finalized_by_json,
      '$.actorType', '$.actorId', '$.actorLabel'
    ) = '{}'
  ),
  execution_actor_json TEXT NOT NULL CHECK (
    length(CAST(execution_actor_json AS BLOB)) <= 4096
    AND json_valid(execution_actor_json)
    AND json_type(execution_actor_json) = 'object'
    AND json_type(execution_actor_json, '$.actorType') IS 'text'
    AND json_extract(execution_actor_json, '$.actorType') IN ('operator', 'mcp')
    AND json_type(execution_actor_json, '$.actorId') IS 'text'
    AND length(json_extract(execution_actor_json, '$.actorId')) BETWEEN 1 AND 128
    AND json_extract(execution_actor_json, '$.actorId')
      = trim(
        json_extract(execution_actor_json, '$.actorId'),
        ' ' || char(9) || char(10) || char(11) || char(12) || char(13)
      )
    AND (
      json_type(execution_actor_json, '$.actorLabel') IS NULL
      OR (
        json_type(execution_actor_json, '$.actorLabel') IS 'text'
        AND length(json_extract(execution_actor_json, '$.actorLabel')) BETWEEN 1 AND 200
        AND json_extract(execution_actor_json, '$.actorLabel')
          = trim(
            json_extract(execution_actor_json, '$.actorLabel'),
            ' ' || char(9) || char(10) || char(11) || char(12) || char(13)
          )
      )
    )
    AND json_remove(
      execution_actor_json,
      '$.actorType', '$.actorId', '$.actorLabel'
    ) = '{}'
  ),
  fingerprint TEXT NOT NULL CHECK (
    length(fingerprint) = 64
    AND fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  mutation_fingerprint TEXT NOT NULL CHECK (
    length(mutation_fingerprint) = 64
    AND mutation_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 1 AND 128
  ),
  authorization_id TEXT,
  finalized_at TEXT NOT NULL CHECK (length(finalized_at) > 0),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),

  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (voice_profile_id, voice_version),
  UNIQUE (workspace_id, id),
  UNIQUE (authorization_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (voice_profile_id, workspace_id)
    REFERENCES voice_profiles(id, workspace_id) ON DELETE CASCADE,
  CHECK (
    (
      json_extract(execution_actor_json, '$.actorType') = 'operator'
      AND authorization_id IS NULL
    )
    OR (
      json_extract(execution_actor_json, '$.actorType') = 'mcp'
      AND authorization_id IS NOT NULL
    )
  )
);

CREATE INDEX idx_voice_profile_finalizations_latest
  ON voice_profile_finalizations(workspace_id, voice_version DESC, id);

CREATE TRIGGER voice_profile_finalizations_immutable_update
BEFORE UPDATE ON voice_profile_finalizations
BEGIN
  SELECT RAISE(ABORT, 'voice profile finalizations are immutable');
END;

-- Direct history deletion is forbidden while both owning rows still exist.
-- Parent workspace/profile cascades remain able to remove the history.
CREATE TRIGGER voice_profile_finalizations_immutable_delete
BEFORE DELETE ON voice_profile_finalizations
WHEN EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id)
 AND EXISTS (
   SELECT 1 FROM voice_profiles
   WHERE id = OLD.voice_profile_id AND workspace_id = OLD.workspace_id
 )
BEGIN
  SELECT RAISE(ABORT, 'voice profile finalizations are immutable');
END;

-- A human operator creates an exact, short-lived command authorization before
-- an MCP key may execute finalization. Only the token digest is retained.
CREATE TABLE voice_finalization_authorizations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  request_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(request_schema_version) = 'integer' AND request_schema_version >= 1
  ),
  token_hash TEXT NOT NULL UNIQUE CHECK (
    length(token_hash) = 64
    AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  workspace_id TEXT NOT NULL,
  voice_profile_id TEXT NOT NULL,
  expected_profile_revision INTEGER NOT NULL CHECK (
    typeof(expected_profile_revision) = 'integer'
    AND expected_profile_revision >= 1
  ),
  request_json TEXT NOT NULL CHECK (
    length(CAST(request_json AS BLOB)) <= 524288
    AND json_valid(request_json)
    AND json_type(request_json) = 'object'
  ),
  mutation_fingerprint TEXT NOT NULL CHECK (
    length(mutation_fingerprint) = 64
    AND mutation_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  authorized_by_json TEXT NOT NULL CHECK (
    length(CAST(authorized_by_json AS BLOB)) <= 4096
    AND json_valid(authorized_by_json)
    AND json_type(authorized_by_json) = 'object'
    AND json_type(authorized_by_json, '$.actorType') IS 'text'
    AND json_extract(authorized_by_json, '$.actorType') = 'operator'
    AND json_type(authorized_by_json, '$.actorId') IS 'text'
    AND length(json_extract(authorized_by_json, '$.actorId')) BETWEEN 1 AND 128
    AND json_extract(authorized_by_json, '$.actorId')
      = trim(
        json_extract(authorized_by_json, '$.actorId'),
        ' ' || char(9) || char(10) || char(11) || char(12) || char(13)
      )
    AND (
      json_type(authorized_by_json, '$.actorLabel') IS NULL
      OR (
        json_type(authorized_by_json, '$.actorLabel') IS 'text'
        AND length(json_extract(authorized_by_json, '$.actorLabel')) BETWEEN 1 AND 200
        AND json_extract(authorized_by_json, '$.actorLabel')
          = trim(
            json_extract(authorized_by_json, '$.actorLabel'),
            ' ' || char(9) || char(10) || char(11) || char(12) || char(13)
          )
      )
    )
    AND json_remove(
      authorized_by_json,
      '$.actorType', '$.actorId', '$.actorLabel'
    ) = '{}'
  ),
  issued_at TEXT NOT NULL CHECK (
    length(issued_at) > 0
    AND julianday(issued_at) IS NOT NULL
  ),
  expires_at TEXT NOT NULL CHECK (
    length(expires_at) > 0
    AND julianday(expires_at) IS NOT NULL
  ),
  consumed_at TEXT CHECK (
    consumed_at IS NULL
    OR (
      julianday(consumed_at) IS NOT NULL
      AND CAST(ROUND(julianday(consumed_at) * 86400000.0) AS INTEGER)
        >= CAST(ROUND(julianday(issued_at) * 86400000.0) AS INTEGER)
      AND CAST(ROUND(julianday(consumed_at) * 86400000.0) AS INTEGER)
        < CAST(ROUND(julianday(expires_at) * 86400000.0) AS INTEGER)
    )
  ),
  finalization_id TEXT,
  execution_actor_json TEXT CHECK (
    execution_actor_json IS NULL
    OR (
      length(CAST(execution_actor_json AS BLOB)) <= 4096
      AND json_valid(execution_actor_json)
      AND json_type(execution_actor_json) = 'object'
      AND json_type(execution_actor_json, '$.actorType') IS 'text'
      AND json_extract(execution_actor_json, '$.actorType') = 'mcp'
      AND json_type(execution_actor_json, '$.actorId') IS 'text'
      AND length(json_extract(execution_actor_json, '$.actorId')) BETWEEN 1 AND 128
      AND json_extract(execution_actor_json, '$.actorId')
        = trim(
          json_extract(execution_actor_json, '$.actorId'),
          ' ' || char(9) || char(10) || char(11) || char(12) || char(13)
        )
      AND (
        json_type(execution_actor_json, '$.actorLabel') IS NULL
        OR (
          json_type(execution_actor_json, '$.actorLabel') IS 'text'
          AND length(json_extract(execution_actor_json, '$.actorLabel')) BETWEEN 1 AND 200
          AND json_extract(execution_actor_json, '$.actorLabel')
            = trim(
              json_extract(execution_actor_json, '$.actorLabel'),
              ' ' || char(9) || char(10) || char(11) || char(12) || char(13)
            )
        )
      )
      AND json_remove(
        execution_actor_json,
        '$.actorType', '$.actorId', '$.actorLabel'
      ) = '{}'
    )
  ),

  UNIQUE (id, workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (voice_profile_id, workspace_id)
    REFERENCES voice_profiles(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (finalization_id, workspace_id)
    REFERENCES voice_profile_finalizations(id, workspace_id),
  -- Keep this 15-minute ceiling in lockstep with
  -- VOICE_FINALIZATION_LIMITS.authorizationTtlSeconds. Compare integer epoch
  -- milliseconds so Julian-day floating-point error cannot reject an exact TTL.
  CHECK (
    CAST(ROUND(julianday(expires_at) * 86400000.0) AS INTEGER)
      - CAST(ROUND(julianday(issued_at) * 86400000.0) AS INTEGER)
      BETWEEN 1 AND (15 * 60 * 1000)
  ),
  CHECK (
    (
      consumed_at IS NULL
      AND finalization_id IS NULL
      AND execution_actor_json IS NULL
    )
    OR (
      consumed_at IS NOT NULL
      AND finalization_id IS NOT NULL
      AND execution_actor_json IS NOT NULL
    )
  )
);

CREATE INDEX idx_voice_finalization_authorizations_lookup
  ON voice_finalization_authorizations(workspace_id, token_hash);

CREATE INDEX idx_voice_finalization_authorizations_expiry
  ON voice_finalization_authorizations(expires_at);

-- An MCP-created immutable authority must originate from the exact active
-- operator authorization. The service consumes/backlinks that authorization
-- later in the same transaction; authoritative reads independently require the
-- completed backlink before trusting the snapshot.
CREATE TRIGGER voice_profile_finalizations_authorization_guard
BEFORE INSERT ON voice_profile_finalizations
WHEN json_extract(NEW.execution_actor_json, '$.actorType') = 'mcp'
 AND NOT EXISTS (
   SELECT 1
   FROM voice_finalization_authorizations authorization
   WHERE authorization.id = NEW.authorization_id
     AND authorization.workspace_id = NEW.workspace_id
     AND authorization.voice_profile_id = NEW.voice_profile_id
     AND authorization.expected_profile_revision + 1 = NEW.profile_revision
     AND authorization.mutation_fingerprint = NEW.mutation_fingerprint
     AND json_extract(authorization.authorized_by_json, '$.actorId')
       = json_extract(NEW.finalized_by_json, '$.actorId')
     AND COALESCE(json_extract(authorization.authorized_by_json, '$.actorLabel'), '')
       = COALESCE(json_extract(NEW.finalized_by_json, '$.actorLabel'), '')
     AND authorization.consumed_at IS NULL
     AND authorization.finalization_id IS NULL
     AND authorization.execution_actor_json IS NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'MCP voice finalization requires its exact active operator authorization');
END;

-- The approved command and operator may never change. A single transition may
-- only fill the consumption tuple; replay reads the already-consumed row and
-- its durable MCP execution principal.
CREATE TRIGGER voice_finalization_authorizations_bound_update
BEFORE UPDATE ON voice_finalization_authorizations
WHEN NEW.id != OLD.id
  OR NEW.request_schema_version != OLD.request_schema_version
  OR NEW.token_hash != OLD.token_hash
  OR NEW.workspace_id != OLD.workspace_id
  OR NEW.voice_profile_id != OLD.voice_profile_id
  OR NEW.expected_profile_revision != OLD.expected_profile_revision
  OR NEW.request_json != OLD.request_json
  OR NEW.mutation_fingerprint != OLD.mutation_fingerprint
  OR NEW.authorized_by_json != OLD.authorized_by_json
  OR NEW.issued_at != OLD.issued_at
  OR NEW.expires_at != OLD.expires_at
  OR OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at IS NULL
  OR NEW.finalization_id IS NULL
  OR NEW.execution_actor_json IS NULL
BEGIN
  SELECT RAISE(ABORT, 'voice finalization authorization is immutable or already consumed');
END;

-- The consume transition may link either the authorization that created the
-- artifact or a later exact redundant authorization. In both cases the linked
-- immutable result must represent the same approved command and operator. When
-- this row is the artifact's origin authorization, its MCP executor must also
-- be the executor frozen on that artifact.
CREATE TRIGGER voice_finalization_authorizations_result_guard
BEFORE UPDATE ON voice_finalization_authorizations
WHEN OLD.consumed_at IS NULL
 AND NEW.consumed_at IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM voice_profile_finalizations finalization
   WHERE finalization.id = NEW.finalization_id
     AND finalization.workspace_id = OLD.workspace_id
     AND finalization.voice_profile_id = OLD.voice_profile_id
     AND finalization.profile_revision = OLD.expected_profile_revision + 1
     AND finalization.mutation_fingerprint = OLD.mutation_fingerprint
     AND json_extract(finalization.finalized_by_json, '$.actorId')
       = json_extract(OLD.authorized_by_json, '$.actorId')
     AND COALESCE(json_extract(finalization.finalized_by_json, '$.actorLabel'), '')
       = COALESCE(json_extract(OLD.authorized_by_json, '$.actorLabel'), '')
     AND (
       finalization.authorization_id IS NULL
       OR finalization.authorization_id != OLD.id
       OR (
         json_extract(finalization.execution_actor_json, '$.actorType') = 'mcp'
         AND json_extract(finalization.execution_actor_json, '$.actorId')
           = json_extract(NEW.execution_actor_json, '$.actorId')
         AND COALESCE(json_extract(finalization.execution_actor_json, '$.actorLabel'), '')
           = COALESCE(json_extract(NEW.execution_actor_json, '$.actorLabel'), '')
       )
     )
 )
BEGIN
  SELECT RAISE(ABORT, 'voice finalization authorization result does not match its approved command');
END;

-- A consumed authorization is immutable proof for exact-token replay and for
-- its finalization's authorization_id. Active authorizations must also survive
-- until expiry. Direct deletion is allowed only for expired, unconsumed rows;
-- parent workspace/profile cascades remain available.
CREATE TRIGGER voice_finalization_authorizations_guarded_delete
BEFORE DELETE ON voice_finalization_authorizations
WHEN EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id)
 AND EXISTS (
   SELECT 1 FROM voice_profiles
   WHERE id = OLD.voice_profile_id AND workspace_id = OLD.workspace_id
 )
 AND (
   OLD.consumed_at IS NOT NULL
   OR julianday(OLD.expires_at) >= julianday('now')
 )
BEGIN
  SELECT RAISE(ABORT, 'consumed or active voice finalization authorizations are immutable');
END;
