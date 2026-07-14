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
    length(CAST(evidence_resolutions_json AS BLOB)) <= 1048576
    AND json_valid(evidence_resolutions_json)
    AND json_type(evidence_resolutions_json) = 'array'
  ),
  projection_state_json TEXT NOT NULL DEFAULT '{"preservedCompetitorDomains":[],"intakeOwnedCompetitorDomains":[]}' CHECK (
    length(projection_state_json) <= 131072
    AND json_valid(projection_state_json)
    AND json_type(projection_state_json) = 'object'
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
  CHECK (
    (revision = 1 AND supersedes_revision_id IS NULL)
    OR (revision > 1 AND supersedes_revision_id IS NOT NULL)
  ),
  UNIQUE (workspace_id, revision),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes_revision_id, workspace_id)
    REFERENCES brand_intake_revisions(id, workspace_id)
);

-- A revision may have at most one successor. Reverse supersession is computed
-- from this edge so predecessor rows remain immutable.
CREATE UNIQUE INDEX idx_brand_intake_revision_root
  ON brand_intake_revisions(workspace_id)
  WHERE supersedes_revision_id IS NULL;

CREATE UNIQUE INDEX idx_brand_intake_revision_successor
  ON brand_intake_revisions(workspace_id, supersedes_revision_id)
  WHERE supersedes_revision_id IS NOT NULL;

CREATE UNIQUE INDEX idx_brand_intake_revision_idempotency
  ON brand_intake_revisions(workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_brand_intake_revision_latest
  ON brand_intake_revisions(workspace_id, revision DESC, id);

-- The immutable lineage must be contiguous. The FK proves the predecessor
-- exists; this trigger proves it is exactly the immediately prior revision.
CREATE TRIGGER brand_intake_revision_contiguous_insert
BEFORE INSERT ON brand_intake_revisions
WHEN NEW.revision > 1
  AND NOT EXISTS (
    SELECT 1
    FROM brand_intake_revisions predecessor
    WHERE predecessor.workspace_id = NEW.workspace_id
      AND predecessor.id = NEW.supersedes_revision_id
      AND predecessor.revision = NEW.revision - 1
  )
BEGIN
  SELECT RAISE(ABORT, 'brand intake predecessor must be the immediately prior revision');
END;

CREATE TRIGGER brand_intake_revision_immutable_update
BEFORE UPDATE ON brand_intake_revisions
BEGIN
  SELECT RAISE(ABORT, 'brand intake revisions are immutable');
END;

-- Direct history deletion is forbidden. During ON DELETE CASCADE the parent
-- workspace row is already absent, so workspace deletion can still clean up.
CREATE TRIGGER brand_intake_revision_immutable_delete
BEFORE DELETE ON brand_intake_revisions
WHEN EXISTS (
  SELECT 1 FROM workspaces WHERE id = OLD.workspace_id
)
BEGIN
  SELECT RAISE(ABORT, 'brand intake revisions are immutable');
END;
