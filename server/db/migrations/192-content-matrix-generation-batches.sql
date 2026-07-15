-- M3: extend the existing matrix run/item ledger for bounded parent batches.
-- Retry commands are normalized so durable idempotency does not grow run JSON.

ALTER TABLE content_matrix_generation_runs
  ADD COLUMN accepted_budget TEXT;

ALTER TABLE content_matrix_generation_runs
  ADD COLUMN set_audit_report TEXT;

ALTER TABLE content_matrix_generation_items
  ADD COLUMN approval_evidence TEXT;

CREATE TABLE content_matrix_generation_retry_commands (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  request_payload TEXT NOT NULL,
  job_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, run_id, idempotency_key),
  UNIQUE (job_id),
  FOREIGN KEY (run_id, workspace_id)
    REFERENCES content_matrix_generation_runs(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX idx_content_matrix_generation_retry_commands_run_created
  ON content_matrix_generation_retry_commands(workspace_id, run_id, created_at, id);
