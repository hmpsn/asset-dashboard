-- M0: durable, revision-safe foundation for matrix structural resolution.
-- No AI/job execution is registered by this migration.

ALTER TABLE content_matrices
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

ALTER TABLE content_templates
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

ALTER TABLE content_templates
  ADD COLUMN generation_contract_version INTEGER CHECK (
    generation_contract_version IS NULL OR generation_contract_version >= 1
  );

CREATE TABLE content_matrix_generation_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  matrix_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'awaiting_review', 'completed',
    'completed_with_errors', 'blocked', 'conflict', 'cancelled', 'failed'
  )),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  idempotency_key TEXT NOT NULL,
  selection_fingerprint TEXT NOT NULL,
  job_id TEXT,
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  queued_count INTEGER NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  running_count INTEGER NOT NULL DEFAULT 0 CHECK (running_count >= 0),
  ready_for_human_review_count INTEGER NOT NULL DEFAULT 0 CHECK (ready_for_human_review_count >= 0),
  needs_attention_count INTEGER NOT NULL DEFAULT 0 CHECK (needs_attention_count >= 0),
  blocked_count INTEGER NOT NULL DEFAULT 0 CHECK (blocked_count >= 0),
  conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  cancelled_count INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_count >= 0),
  created_by TEXT NOT NULL,
  mcp_execution_context TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (workspace_id, matrix_id, idempotency_key),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_content_matrix_generation_runs_workspace_updated
  ON content_matrix_generation_runs(workspace_id, updated_at DESC, id);
CREATE INDEX idx_content_matrix_generation_runs_matrix_updated
  ON content_matrix_generation_runs(workspace_id, matrix_id, updated_at DESC, id);
CREATE INDEX idx_content_matrix_generation_runs_job
  ON content_matrix_generation_runs(job_id) WHERE job_id IS NOT NULL;

CREATE TABLE content_matrix_generation_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  matrix_id TEXT NOT NULL,
  cell_id TEXT NOT NULL,
  matrix_revision INTEGER NOT NULL CHECK (matrix_revision >= 0),
  template_revision INTEGER NOT NULL CHECK (template_revision >= 0),
  cell_revision INTEGER NOT NULL CHECK (cell_revision >= 0),
  structural_fingerprint TEXT NOT NULL,
  preview_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'preflighting', 'preflighted', 'generating_brief',
    'generating_post', 'auditing_deterministic', 'auditing_model',
    'revising', 'ready_for_human_review', 'needs_attention',
    'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'
  )),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  structural_target TEXT,
  preview_target TEXT,
  brief_id TEXT,
  post_id TEXT,
  audit_report TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  automatic_revision_count INTEGER NOT NULL DEFAULT 0 CHECK (automatic_revision_count IN (0, 1)),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (run_id, cell_id),
  FOREIGN KEY (run_id, workspace_id)
    REFERENCES content_matrix_generation_runs(id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX idx_content_matrix_generation_items_run_status
  ON content_matrix_generation_items(run_id, status, created_at, id);
CREATE INDEX idx_content_matrix_generation_items_source
  ON content_matrix_generation_items(workspace_id, matrix_id, cell_id, created_at DESC);

CREATE TABLE content_matrix_generation_attempts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  stage TEXT NOT NULL CHECK (stage IN (
    'preflight', 'brief_generation', 'post_generation',
    'deterministic_audit', 'model_audit', 'revision'
  )),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  effective_input_fingerprint TEXT NOT NULL,
  provenance TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (item_id, stage, attempt_number),
  FOREIGN KEY (item_id) REFERENCES content_matrix_generation_items(id) ON DELETE CASCADE
);

CREATE INDEX idx_content_matrix_generation_attempts_item_started
  ON content_matrix_generation_attempts(item_id, started_at, id);

CREATE TABLE content_matrix_cell_evidence (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  matrix_id TEXT NOT NULL,
  cell_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  matrix_revision INTEGER NOT NULL CHECK (matrix_revision >= 0),
  template_revision INTEGER NOT NULL CHECK (template_revision >= 0),
  cell_revision INTEGER NOT NULL CHECK (cell_revision >= 0),
  value TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  resolved_by TEXT NOT NULL,
  expected_artifact_revisions TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  supersedes_id TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  superseded_at TEXT,
  UNIQUE (workspace_id, matrix_id, cell_id, idempotency_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (supersedes_id) REFERENCES content_matrix_cell_evidence(id)
);

CREATE UNIQUE INDEX idx_content_matrix_cell_evidence_current
  ON content_matrix_cell_evidence(workspace_id, matrix_id, cell_id, requirement_id)
  WHERE is_current = 1;
CREATE INDEX idx_content_matrix_cell_evidence_history
  ON content_matrix_cell_evidence(workspace_id, matrix_id, cell_id, requirement_id, created_at DESC, id);
