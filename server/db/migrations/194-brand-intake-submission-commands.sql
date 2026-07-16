-- Durable idempotency for MCP/operator brand-intake submissions without
-- weakening the immutable revision table's submission/evidence constraint.

CREATE TABLE brand_intake_submission_commands (
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  mutation_fingerprint TEXT NOT NULL CHECK (
    length(mutation_fingerprint) = 64
    AND mutation_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  intake_revision_id TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  PRIMARY KEY (workspace_id, idempotency_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (intake_revision_id, workspace_id)
    REFERENCES brand_intake_revisions(id, workspace_id)
);

CREATE INDEX idx_brand_intake_submission_command_revision
  ON brand_intake_submission_commands(workspace_id, intake_revision_id);
