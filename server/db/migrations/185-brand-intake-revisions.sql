-- B0: immutable, typed brand-intake revisions and version-safe evidence lineage.
-- Compatibility projection remains on workspaces; this table is the durable authority.

CREATE TABLE brand_intake_revisions (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  workspace_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (
    typeof(revision) = 'integer' AND revision >= 1
  ),
  schema_version INTEGER NOT NULL CHECK (
    typeof(schema_version) = 'integer' AND schema_version = 1
  ),
  payload_json TEXT NOT NULL CHECK (
    length(payload_json) <= 131072
    AND json_valid(payload_json)
    AND json_type(payload_json) = 'object'
  ),
  evidence_resolutions_json TEXT NOT NULL DEFAULT '[]' -- json-array-column-ok: bounded immutable per-revision evidence snapshot; never filtered or sorted in SQL
  CHECK (
    length(evidence_resolutions_json) <= 131072
    AND json_valid(evidence_resolutions_json)
    AND json_type(evidence_resolutions_json) = 'array'
  ),
  fingerprint TEXT NOT NULL CHECK (
    length(fingerprint) = 64
    AND fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  source TEXT NOT NULL CHECK (
    source IN ('client_portal', 'admin', 'mcp', 'migration')
  ),
  submitter_json TEXT NOT NULL CHECK (
    length(submitter_json) <= 4096
    AND json_valid(submitter_json)
    AND json_type(submitter_json) = 'object'
  ),
  mutation_kind TEXT NOT NULL CHECK (
    mutation_kind IN ('submission', 'evidence_resolution')
  ),
  mutation_fingerprint TEXT NOT NULL CHECK (
    length(mutation_fingerprint) = 64
    AND mutation_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  idempotency_key TEXT CHECK (
    idempotency_key IS NULL
    OR length(idempotency_key) BETWEEN 1 AND 128
  ),
  supersedes_revision_id TEXT,
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),

  CHECK (
    (mutation_kind = 'submission' AND idempotency_key IS NULL)
    OR (mutation_kind = 'evidence_resolution' AND idempotency_key IS NOT NULL)
  ),
  UNIQUE (workspace_id, revision),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes_revision_id, workspace_id)
    REFERENCES brand_intake_revisions(id, workspace_id)
);

-- A revision may have at most one successor. Reverse supersession is computed
-- from this edge so predecessor rows remain immutable.
CREATE UNIQUE INDEX idx_brand_intake_revision_successor
  ON brand_intake_revisions(workspace_id, supersedes_revision_id)
  WHERE supersedes_revision_id IS NOT NULL;

CREATE UNIQUE INDEX idx_brand_intake_revision_idempotency
  ON brand_intake_revisions(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_brand_intake_revision_latest
  ON brand_intake_revisions(workspace_id, revision DESC, id);
