-- B2: durable, restart-safe brand foundation and deliverable generation ledger.
-- Generated output stops at human review; this migration adds no publish/send path.

CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_identity_id_workspace
  ON brand_identity_deliverables(id, workspace_id);

CREATE TABLE brand_generation_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(schema_version) = 'integer' AND schema_version = 1
  ),
  workspace_id TEXT NOT NULL,
  intake_revision_id TEXT NOT NULL,
  intake_revision INTEGER NOT NULL CHECK (
    typeof(intake_revision) = 'integer' AND intake_revision >= 1
  ),
  intake_fingerprint TEXT NOT NULL CHECK (
    length(intake_fingerprint) = 64
    AND intake_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  selection_json TEXT NOT NULL CHECK (
    length(CAST(selection_json AS BLOB)) <= 8192
    AND json_valid(selection_json)
    AND json_type(selection_json) = 'object'
  ),
  dispatch_targets_json TEXT NOT NULL -- json-array-column-ok: bounded immutable/current dispatch target tuple; never filtered in SQL
  CHECK (
    length(CAST(dispatch_targets_json AS BLOB)) <= 8192
    AND json_valid(dispatch_targets_json)
    AND json_type(dispatch_targets_json) = 'array'
    AND json_array_length(dispatch_targets_json) BETWEEN 1 AND 18
  ),
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'awaiting_review', 'completed',
    'completed_with_errors', 'blocked', 'conflict', 'cancelled', 'failed'
  )),
  stage TEXT NOT NULL CHECK (stage IN (
    'preflight', 'voice_foundation_generation', 'awaiting_voice_review',
    'awaiting_voice_finalization', 'dependent_generation',
    'deterministic_audit', 'model_audit', 'revision',
    'awaiting_operator_review', 'complete'
  )),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  selection_fingerprint TEXT NOT NULL CHECK (
    length(selection_fingerprint) = 64
    AND selection_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  effective_input_fingerprint TEXT NOT NULL CHECK (
    length(effective_input_fingerprint) = 64
    AND effective_input_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  voice_snapshot_json TEXT CHECK (
    voice_snapshot_json IS NULL OR (
      length(CAST(voice_snapshot_json AS BLOB)) <= 524288
      AND json_valid(voice_snapshot_json)
      AND json_type(voice_snapshot_json) = 'object'
    )
  ),
  current_job_id TEXT CHECK (
    current_job_id IS NULL OR length(current_job_id) BETWEEN 1 AND 200
  ),

  selected_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(selected_count) = 'integer' AND selected_count >= 0),
  queued_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(queued_count) = 'integer' AND queued_count >= 0),
  running_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(running_count) = 'integer' AND running_count >= 0),
  ready_for_human_review_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(ready_for_human_review_count) = 'integer' AND ready_for_human_review_count >= 0),
  needs_attention_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(needs_attention_count) = 'integer' AND needs_attention_count >= 0),
  blocked_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(blocked_count) = 'integer' AND blocked_count >= 0),
  conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(conflict_count) = 'integer' AND conflict_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(failed_count) = 'integer' AND failed_count >= 0),
  cancelled_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(cancelled_count) = 'integer' AND cancelled_count >= 0),
  approved_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(approved_count) = 'integer' AND approved_count >= 0),
  changes_requested_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(changes_requested_count) = 'integer' AND changes_requested_count >= 0),

  estimated_provider_calls INTEGER NOT NULL CHECK (typeof(estimated_provider_calls) = 'integer' AND estimated_provider_calls >= 0),
  estimated_input_tokens INTEGER NOT NULL CHECK (typeof(estimated_input_tokens) = 'integer' AND estimated_input_tokens >= 0),
  estimated_output_tokens INTEGER NOT NULL CHECK (typeof(estimated_output_tokens) = 'integer' AND estimated_output_tokens >= 0),
  estimated_cost_microusd INTEGER NOT NULL CHECK (typeof(estimated_cost_microusd) = 'integer' AND estimated_cost_microusd >= 0),
  max_provider_calls INTEGER NOT NULL CHECK (typeof(max_provider_calls) = 'integer' AND max_provider_calls BETWEEN 1 AND 114),
  max_input_tokens INTEGER NOT NULL CHECK (typeof(max_input_tokens) = 'integer' AND max_input_tokens BETWEEN 1 AND 4000000),
  max_output_tokens INTEGER NOT NULL CHECK (typeof(max_output_tokens) = 'integer' AND max_output_tokens BETWEEN 1 AND 250000),
  max_cost_microusd INTEGER NOT NULL CHECK (typeof(max_cost_microusd) = 'integer' AND max_cost_microusd BETWEEN 1 AND 100000000),
  max_concurrency INTEGER NOT NULL CHECK (typeof(max_concurrency) = 'integer' AND max_concurrency BETWEEN 1 AND 3),
  reserved_provider_calls INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_provider_calls) = 'integer' AND reserved_provider_calls >= 0),
  reserved_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_input_tokens) = 'integer' AND reserved_input_tokens >= 0),
  reserved_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_output_tokens) = 'integer' AND reserved_output_tokens >= 0),
  reserved_cost_microusd INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_cost_microusd) = 'integer' AND reserved_cost_microusd >= 0),

  created_by_json TEXT NOT NULL CHECK (
    length(CAST(created_by_json AS BLOB)) <= 4096
    AND json_valid(created_by_json)
    AND json_type(created_by_json) = 'object'
  ),
  mcp_execution_context_json TEXT CHECK (
    mcp_execution_context_json IS NULL OR (
      length(CAST(mcp_execution_context_json AS BLOB)) <= 8192
      AND json_valid(mcp_execution_context_json)
      AND json_type(mcp_execution_context_json) = 'object'
    )
  ),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
  completed_at TEXT,

  CHECK (reserved_provider_calls <= max_provider_calls),
  CHECK (reserved_input_tokens <= max_input_tokens),
  CHECK (reserved_output_tokens <= max_output_tokens),
  CHECK (reserved_cost_microusd <= max_cost_microusd),
  CHECK (estimated_provider_calls <= max_provider_calls),
  CHECK (estimated_input_tokens <= max_input_tokens),
  CHECK (estimated_output_tokens <= max_output_tokens),
  CHECK (estimated_cost_microusd <= max_cost_microusd),
  UNIQUE (workspace_id, intake_revision_id, idempotency_key),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (intake_revision_id, workspace_id)
    REFERENCES brand_intake_revisions(id, workspace_id)
);

CREATE INDEX idx_brand_generation_runs_workspace_updated
  ON brand_generation_runs(workspace_id, updated_at DESC, id);
CREATE INDEX idx_brand_generation_runs_job
  ON brand_generation_runs(current_job_id) WHERE current_job_id IS NOT NULL;

CREATE TABLE brand_generation_items (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(schema_version) = 'integer' AND schema_version = 1
  ),
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN (
    'voice_foundation', 'mission', 'vision', 'values', 'tagline',
    'elevator_pitch', 'archetypes', 'personality_traits',
    'voice_guidelines', 'tone_examples', 'messaging_pillars',
    'differentiators', 'positioning_matrix', 'brand_story', 'personas',
    'customer_journey', 'objection_handling', 'emotional_triggers', 'naming'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'preflighting', 'generating', 'auditing_deterministic',
    'auditing_model', 'revising', 'ready_for_human_review', 'approved',
    'changes_requested', 'needs_attention', 'blocked_missing_evidence',
    'conflict', 'cancelled', 'failed'
  )),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  input_snapshot_json TEXT CHECK (
    input_snapshot_json IS NULL OR (
      length(CAST(input_snapshot_json AS BLOB)) <= 524288
      AND json_valid(input_snapshot_json)
      AND json_type(input_snapshot_json) = 'object'
    )
  ),
  foundation_draft_json TEXT CHECK (
    foundation_draft_json IS NULL OR (
      length(CAST(foundation_draft_json AS BLOB)) <= 131072
      AND json_valid(foundation_draft_json)
      AND json_type(foundation_draft_json) = 'object'
    )
  ),
  content TEXT CHECK (
    content IS NULL OR length(CAST(content AS BLOB)) <= 65536
  ),
  claims_json TEXT NOT NULL DEFAULT '[]' -- json-array-column-ok: bounded per-item generated claim snapshot
  CHECK (json_valid(claims_json) AND json_type(claims_json) = 'array' AND length(CAST(claims_json AS BLOB)) <= 524288),
  requirements_json TEXT NOT NULL DEFAULT '[]' -- json-array-column-ok: bounded per-item evidence requirement snapshot
  CHECK (json_valid(requirements_json) AND json_type(requirements_json) = 'array' AND length(CAST(requirements_json AS BLOB)) <= 524288),
  placeholders_json TEXT NOT NULL DEFAULT '[]' -- json-array-column-ok: bounded per-item placeholder projection snapshot
  CHECK (json_valid(placeholders_json) AND json_type(placeholders_json) = 'array' AND length(CAST(placeholders_json AS BLOB)) <= 131072),
  audit_report_json TEXT CHECK (
    audit_report_json IS NULL OR (
      json_valid(audit_report_json) AND json_type(audit_report_json) = 'object'
      AND length(CAST(audit_report_json AS BLOB)) <= 524288
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(attempt_count) = 'integer' AND attempt_count >= 0
  ),
  automatic_revision_count INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(automatic_revision_count) = 'integer'
    AND automatic_revision_count IN (0, 1)
  ),
  effective_input_fingerprint TEXT CHECK (
    effective_input_fingerprint IS NULL OR (
      length(effective_input_fingerprint) = 64
      AND effective_input_fingerprint NOT GLOB '*[^0-9a-f]*'
    )
  ),
  provenance_json TEXT CHECK (
    provenance_json IS NULL OR (
      json_valid(provenance_json) AND json_type(provenance_json) = 'object'
      AND length(CAST(provenance_json AS BLOB)) <= 524288
    )
  ),
  error_json TEXT CHECK (
    error_json IS NULL OR (
      json_valid(error_json) AND json_type(error_json) = 'object'
      AND length(CAST(error_json AS BLOB)) <= 524288
    )
  ),
  artifact_expectation_json TEXT CHECK (
    artifact_expectation_json IS NULL OR (
      json_valid(artifact_expectation_json) AND json_type(artifact_expectation_json) = 'object'
      AND length(CAST(artifact_expectation_json AS BLOB)) <= 65536
    )
  ),
  committed_deliverable_id TEXT,
  committed_deliverable_version INTEGER CHECK (
    committed_deliverable_version IS NULL OR (
      typeof(committed_deliverable_version) = 'integer'
      AND committed_deliverable_version >= 1
    )
  ),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
  completed_at TEXT,

  CHECK (
    (target = 'voice_foundation' AND content IS NULL AND artifact_expectation_json IS NULL
      AND committed_deliverable_id IS NULL AND committed_deliverable_version IS NULL)
    OR
    (target <> 'voice_foundation' AND foundation_draft_json IS NULL
      AND artifact_expectation_json IS NOT NULL)
  ),
  CHECK (
    (committed_deliverable_id IS NULL AND committed_deliverable_version IS NULL)
    OR (committed_deliverable_id IS NOT NULL AND committed_deliverable_version IS NOT NULL)
  ),
  UNIQUE (run_id, target),
  UNIQUE (id, run_id),
  FOREIGN KEY (run_id, workspace_id)
    REFERENCES brand_generation_runs(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (committed_deliverable_id, workspace_id)
    REFERENCES brand_identity_deliverables(id, workspace_id)
);

CREATE INDEX idx_brand_generation_items_run_status
  ON brand_generation_items(run_id, status, created_at, id);
CREATE UNIQUE INDEX idx_brand_generation_items_committed_version
  ON brand_generation_items(committed_deliverable_id, committed_deliverable_version)
  WHERE committed_deliverable_id IS NOT NULL;

CREATE TABLE brand_generation_commands (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(schema_version) = 'integer' AND schema_version = 1
  ),
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  item_id TEXT,
  command_kind TEXT NOT NULL CHECK (command_kind IN ('start', 'resume', 'revision')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64
    AND request_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  request_snapshot_json TEXT NOT NULL CHECK (
    length(CAST(request_snapshot_json AS BLOB)) <= 524288
    AND json_valid(request_snapshot_json)
    AND json_type(request_snapshot_json) = 'object'
  ),
  expected_run_revision INTEGER CHECK (
    expected_run_revision IS NULL OR (
      typeof(expected_run_revision) = 'integer' AND expected_run_revision >= 0
    )
  ),
  expected_item_revision INTEGER CHECK (
    expected_item_revision IS NULL OR (
      typeof(expected_item_revision) = 'integer' AND expected_item_revision >= 0
    )
  ),
  expected_deliverable_version INTEGER CHECK (
    expected_deliverable_version IS NULL OR (
      typeof(expected_deliverable_version) = 'integer'
      AND expected_deliverable_version >= 1
    )
  ),
  prior_item_status TEXT CHECK (
    prior_item_status IS NULL OR prior_item_status IN (
      'ready_for_human_review', 'changes_requested'
    )
  ),
  job_id TEXT NOT NULL CHECK (length(job_id) BETWEEN 1 AND 200),
  result_json TEXT NOT NULL CHECK (
    length(CAST(result_json AS BLOB)) <= 65536
    AND json_valid(result_json)
    AND json_type(result_json) = 'object'
  ),
  actor_json TEXT NOT NULL CHECK (
    length(CAST(actor_json AS BLOB)) <= 4096
    AND json_valid(actor_json)
    AND json_type(actor_json) = 'object'
  ),
  mcp_execution_context_json TEXT CHECK (
    mcp_execution_context_json IS NULL OR (
      length(CAST(mcp_execution_context_json AS BLOB)) <= 8192
      AND json_valid(mcp_execution_context_json)
      AND json_type(mcp_execution_context_json) = 'object'
    )
  ),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),

  CHECK (
    (command_kind = 'start' AND item_id IS NULL
      AND expected_run_revision IS NULL AND expected_item_revision IS NULL
      AND expected_deliverable_version IS NULL AND prior_item_status IS NULL)
    OR
    (command_kind = 'resume' AND item_id IS NULL
      AND expected_run_revision IS NOT NULL AND expected_item_revision IS NULL
      AND expected_deliverable_version IS NULL AND prior_item_status IS NULL)
    OR
    (command_kind = 'revision' AND item_id IS NOT NULL
      AND expected_run_revision IS NOT NULL AND expected_item_revision IS NOT NULL
      AND expected_deliverable_version IS NOT NULL AND prior_item_status IS NOT NULL)
  ),
  UNIQUE (id, run_id),
  FOREIGN KEY (run_id, workspace_id)
    REFERENCES brand_generation_runs(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id, run_id)
    REFERENCES brand_generation_items(id, run_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_brand_generation_commands_run_idempotency
  ON brand_generation_commands(run_id, command_kind, idempotency_key)
  WHERE item_id IS NULL;
CREATE UNIQUE INDEX idx_brand_generation_commands_item_idempotency
  ON brand_generation_commands(item_id, command_kind, idempotency_key)
  WHERE item_id IS NOT NULL;
CREATE INDEX idx_brand_generation_commands_job
  ON brand_generation_commands(job_id);

CREATE TABLE brand_generation_attempts (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (
    typeof(schema_version) = 'integer' AND schema_version = 1
  ),
  item_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  command_id TEXT NOT NULL CHECK (length(command_id) BETWEEN 1 AND 200),
  attempt_number INTEGER NOT NULL CHECK (
    typeof(attempt_number) = 'integer' AND attempt_number >= 1
  ),
  stage TEXT NOT NULL CHECK (stage IN (
    'preflight', 'voice_foundation_generation', 'dependent_generation',
    'deterministic_audit', 'model_audit', 'revision'
  )),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  expected_run_revision INTEGER NOT NULL CHECK (
    typeof(expected_run_revision) = 'integer' AND expected_run_revision >= 0
  ),
  expected_item_revision INTEGER NOT NULL CHECK (
    typeof(expected_item_revision) = 'integer' AND expected_item_revision >= 0
  ),
  expected_deliverable_version INTEGER CHECK (
    expected_deliverable_version IS NULL OR (
      typeof(expected_deliverable_version) = 'integer'
      AND expected_deliverable_version >= 0
    )
  ),
  effective_input_fingerprint TEXT NOT NULL CHECK (
    length(effective_input_fingerprint) = 64
    AND effective_input_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  reserved_provider_calls INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_provider_calls) = 'integer' AND reserved_provider_calls >= 0),
  reserved_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_input_tokens) = 'integer' AND reserved_input_tokens >= 0),
  reserved_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_output_tokens) = 'integer' AND reserved_output_tokens >= 0),
  reserved_cost_microusd INTEGER NOT NULL DEFAULT 0 CHECK (typeof(reserved_cost_microusd) = 'integer' AND reserved_cost_microusd >= 0),
  output_snapshot_json TEXT CHECK (
    output_snapshot_json IS NULL OR (
      json_valid(output_snapshot_json) AND json_type(output_snapshot_json) = 'object'
      AND length(CAST(output_snapshot_json AS BLOB)) <= 524288
    )
  ),
  provenance_json TEXT CHECK (
    provenance_json IS NULL OR (
      json_valid(provenance_json) AND json_type(provenance_json) = 'object'
      AND length(CAST(provenance_json AS BLOB)) <= 524288
    )
  ),
  error_json TEXT CHECK (
    error_json IS NULL OR (
      json_valid(error_json) AND json_type(error_json) = 'object'
      AND length(CAST(error_json AS BLOB)) <= 524288
    )
  ),
  started_at TEXT NOT NULL CHECK (length(started_at) > 0),
  completed_at TEXT,
  CHECK (
    (status = 'running' AND output_snapshot_json IS NULL
      AND error_json IS NULL AND completed_at IS NULL)
    OR
    (status = 'completed' AND output_snapshot_json IS NOT NULL
      AND error_json IS NULL AND completed_at IS NOT NULL)
    OR
    (status = 'failed' AND output_snapshot_json IS NULL
      AND error_json IS NOT NULL AND completed_at IS NOT NULL)
    OR
    (status = 'cancelled' AND output_snapshot_json IS NULL
      AND completed_at IS NOT NULL)
  ),
  UNIQUE (item_id, stage, attempt_number),
  FOREIGN KEY (item_id, run_id)
    REFERENCES brand_generation_items(id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (command_id, run_id)
    REFERENCES brand_generation_commands(id, run_id) ON DELETE CASCADE
);

CREATE INDEX idx_brand_generation_attempts_item_started
  ON brand_generation_attempts(item_id, started_at, id);
CREATE INDEX idx_brand_generation_attempts_command
  ON brand_generation_attempts(command_id, started_at, id);
