-- M0: durable, revision-safe foundation for matrix structural resolution.
-- No AI/job execution is registered by this migration.

ALTER TABLE content_matrices
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  );

ALTER TABLE content_templates
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  );

-- Version 0 is the explicit legacy sentinel; new templates use the current
-- positive contract version and negative versions are never valid.
ALTER TABLE content_templates
  ADD COLUMN generation_contract_version INTEGER CHECK (
    generation_contract_version IS NULL OR (
      typeof(generation_contract_version) = 'integer'
      AND generation_contract_version >= 0
    )
  );

-- One deterministic legacy-template upgrade is currently supported. These
-- internal fields make an accepted MCP mutation safely replayable without
-- exposing idempotency/audit data on the public ContentTemplate contract.
ALTER TABLE content_templates
  ADD COLUMN generation_upgrade_fingerprint TEXT CHECK (
    generation_upgrade_fingerprint IS NULL
    OR length(generation_upgrade_fingerprint) = 64
  );

ALTER TABLE content_templates
  ADD COLUMN generation_upgrade_idempotency_key TEXT;

ALTER TABLE content_templates
  ADD COLUMN generation_upgrade_source_revision INTEGER CHECK (
    generation_upgrade_source_revision IS NULL OR (
      typeof(generation_upgrade_source_revision) = 'integer'
      AND generation_upgrade_source_revision >= 0
    )
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
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  idempotency_key TEXT NOT NULL,
  selection_fingerprint TEXT NOT NULL,
  job_id TEXT,
  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(selected_count) = 'integer' AND selected_count >= 0
  ),
  queued_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(queued_count) = 'integer' AND queued_count >= 0
  ),
  running_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(running_count) = 'integer' AND running_count >= 0
  ),
  ready_for_human_review_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(ready_for_human_review_count) = 'integer'
    AND ready_for_human_review_count >= 0
  ),
  needs_attention_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(needs_attention_count) = 'integer' AND needs_attention_count >= 0
  ),
  blocked_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(blocked_count) = 'integer' AND blocked_count >= 0
  ),
  conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(conflict_count) = 'integer' AND conflict_count >= 0
  ),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(failed_count) = 'integer' AND failed_count >= 0
  ),
  cancelled_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(cancelled_count) = 'integer' AND cancelled_count >= 0
  ),
  created_by TEXT NOT NULL,
  mcp_execution_context TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (workspace_id, matrix_id, idempotency_key),
  UNIQUE (id, workspace_id),
  UNIQUE (id, workspace_id, matrix_id),
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
  matrix_revision INTEGER NOT NULL CHECK (
    typeof(matrix_revision) = 'integer' AND matrix_revision >= 0
  ),
  template_revision INTEGER NOT NULL CHECK (
    typeof(template_revision) = 'integer' AND template_revision >= 0
  ),
  cell_revision INTEGER NOT NULL CHECK (
    typeof(cell_revision) = 'integer' AND cell_revision >= 0
  ),
  structural_fingerprint TEXT NOT NULL,
  preview_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'preflighting', 'preflighted', 'generating_brief',
    'generating_post', 'auditing_deterministic', 'auditing_model',
    'revising', 'ready_for_human_review', 'needs_attention',
    'blocked_missing_evidence', 'conflict', 'cancelled', 'failed'
  )),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  structural_target TEXT,
  preview_target TEXT,
  brief_id TEXT,
  post_id TEXT,
  audit_report TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(attempt_count) = 'integer' AND attempt_count >= 0
  ),
  automatic_revision_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(automatic_revision_count) = 'integer'
    AND automatic_revision_count IN (0, 1)
  ),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (run_id, cell_id),
  FOREIGN KEY (run_id, workspace_id, matrix_id)
    REFERENCES content_matrix_generation_runs(id, workspace_id, matrix_id) ON DELETE CASCADE
);

CREATE INDEX idx_content_matrix_generation_items_run_status
  ON content_matrix_generation_items(run_id, status, created_at, id);
CREATE INDEX idx_content_matrix_generation_items_source
  ON content_matrix_generation_items(workspace_id, matrix_id, cell_id, created_at DESC);

CREATE TABLE content_matrix_generation_attempts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (
    typeof(attempt_number) = 'integer' AND attempt_number >= 1
  ),
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
  matrix_revision INTEGER NOT NULL CHECK (
    typeof(matrix_revision) = 'integer' AND matrix_revision >= 0
  ),
  template_revision INTEGER NOT NULL CHECK (
    typeof(template_revision) = 'integer' AND template_revision >= 0
  ),
  cell_revision INTEGER NOT NULL CHECK (
    typeof(cell_revision) = 'integer' AND cell_revision >= 0
  ),
  value TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  resolved_by TEXT NOT NULL,
  expected_artifact_revisions TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  supersedes_id TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(is_current) = 'integer' AND is_current IN (0, 1)
  ),
  created_at TEXT NOT NULL,
  superseded_at TEXT,
  UNIQUE (workspace_id, matrix_id, cell_id, idempotency_key),
  UNIQUE (id, workspace_id, matrix_id, cell_id, requirement_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (
    supersedes_id, workspace_id, matrix_id, cell_id, requirement_id
  ) REFERENCES content_matrix_cell_evidence(
    id, workspace_id, matrix_id, cell_id, requirement_id
  )
);

CREATE UNIQUE INDEX idx_content_matrix_cell_evidence_current
  ON content_matrix_cell_evidence(workspace_id, matrix_id, cell_id, requirement_id)
  WHERE is_current = 1;
CREATE INDEX idx_content_matrix_cell_evidence_history
  ON content_matrix_cell_evidence(workspace_id, matrix_id, cell_id, requirement_id, created_at DESC, id);
