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
  workspace_id TEXT NOT NULL,
  voice_profile_id TEXT NOT NULL,
  voice_version INTEGER NOT NULL CHECK (
    typeof(voice_version) = 'integer' AND voice_version >= 1
  ),
  profile_revision INTEGER NOT NULL CHECK (
    typeof(profile_revision) = 'integer' AND profile_revision >= 1
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
    AND json_extract(finalized_by_json, '$.actorType') = 'operator'
  ),
  execution_actor_json TEXT NOT NULL CHECK (
    length(CAST(execution_actor_json AS BLOB)) <= 4096
    AND json_valid(execution_actor_json)
    AND json_type(execution_actor_json) = 'object'
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
    REFERENCES voice_profiles(id, workspace_id) ON DELETE CASCADE
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
    AND json_extract(authorized_by_json, '$.actorType') = 'operator'
  ),
  issued_at TEXT NOT NULL CHECK (length(issued_at) > 0),
  expires_at TEXT NOT NULL CHECK (length(expires_at) > 0),
  consumed_at TEXT,
  finalization_id TEXT UNIQUE,

  UNIQUE (id, workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (voice_profile_id, workspace_id)
    REFERENCES voice_profiles(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (finalization_id, workspace_id)
    REFERENCES voice_profile_finalizations(id, workspace_id),
  CHECK (
    (consumed_at IS NULL AND finalization_id IS NULL)
    OR (consumed_at IS NOT NULL AND finalization_id IS NOT NULL)
  )
);

CREATE INDEX idx_voice_finalization_authorizations_lookup
  ON voice_finalization_authorizations(workspace_id, token_hash);

CREATE INDEX idx_voice_finalization_authorizations_expiry
  ON voice_finalization_authorizations(expires_at);

-- The approved command and operator may never change. A single transition may
-- only fill the consumption pair; replay reads the already-consumed row.
CREATE TRIGGER voice_finalization_authorizations_bound_update
BEFORE UPDATE ON voice_finalization_authorizations
WHEN NEW.id != OLD.id
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
BEGIN
  SELECT RAISE(ABORT, 'voice finalization authorization is immutable or already consumed');
END;
