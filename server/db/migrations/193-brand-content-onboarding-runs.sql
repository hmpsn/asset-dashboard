-- O1: one durable coordinator over existing brand/review/matrix lifecycles.
-- Child runs remain authoritative in their existing normalized stores.

CREATE TABLE brand_content_onboarding_runs (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 128),
  workspace_id TEXT NOT NULL,
  intake_revision_id TEXT NOT NULL,
  intake_revision INTEGER NOT NULL CHECK (
    typeof(intake_revision) = 'integer' AND intake_revision >= 1
  ),
  intake_fingerprint TEXT NOT NULL CHECK (
    length(intake_fingerprint) = 64
    AND intake_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN (
    'intake_ready',
    'brand_generating',
    'awaiting_voice_review',
    'awaiting_voice_finalization',
    'brand_generating_dependents',
    'awaiting_operator_review',
    'awaiting_client_review',
    'awaiting_content_authorization',
    'content_generating',
    'awaiting_content_review',
    'ready_to_publish',
    'needs_attention',
    'cancelled',
    'failed'
  )),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  ),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  input_fingerprint TEXT NOT NULL CHECK (
    length(input_fingerprint) = 64
    AND input_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  matrix_selection_json TEXT NOT NULL CHECK (
    length(CAST(matrix_selection_json AS BLOB)) <= 1048576
    AND json_valid(matrix_selection_json)
    AND json_type(matrix_selection_json) = 'array'
    AND json_array_length(matrix_selection_json) BETWEEN 1 AND 25
  ),
  finalized_voice_json TEXT CHECK (
    finalized_voice_json IS NULL OR (
      length(CAST(finalized_voice_json AS BLOB)) <= 131072
      AND json_valid(finalized_voice_json)
      AND json_type(finalized_voice_json) = 'object'
    )
  ),
  approved_identity_json TEXT NOT NULL DEFAULT '[]' CHECK ( -- json-array-column-ok: bounded immutable full-brand-suite authority snapshot read atomically with its coordinator
    length(CAST(approved_identity_json AS BLOB)) <= 131072
    AND json_valid(approved_identity_json)
    AND json_type(approved_identity_json) = 'array'
  ),
  children_json TEXT NOT NULL CHECK (
    length(CAST(children_json AS BLOB)) <= 1048576
    AND json_valid(children_json)
    AND json_type(children_json) = 'object'
  ),
  current_gate TEXT CHECK (
    current_gate IS NULL OR current_gate IN (
      'intake_accepted',
      'voice_reviewed',
      'voice_finalized',
      'operator_brand_reviewed',
      'client_brand_reviewed',
      'content_authorized',
      'all_pages_approved',
      'publish_preconditions_passed'
    )
  ),
  gate_evidence_json TEXT NOT NULL DEFAULT '[]' CHECK ( -- json-array-column-ok: fixed eight-gate audit trail is append-only and always read with its single coordinator
    length(CAST(gate_evidence_json AS BLOB)) <= 1048576
    AND json_valid(gate_evidence_json)
    AND json_type(gate_evidence_json) = 'array'
  ),
  attention_resume_status TEXT CHECK (
    attention_resume_status IS NULL OR attention_resume_status IN (
      'brand_generating',
      'awaiting_voice_review',
      'awaiting_voice_finalization',
      'brand_generating_dependents',
      'awaiting_operator_review',
      'awaiting_client_review',
      'awaiting_content_authorization',
      'content_generating',
      'awaiting_content_review'
    )
  ),
  created_by_json TEXT NOT NULL CHECK (
    length(CAST(created_by_json AS BLOB)) <= 4096
    AND json_valid(created_by_json)
    AND json_type(created_by_json) = 'object'
  ),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
  completed_at TEXT,
  UNIQUE (id, workspace_id),
  UNIQUE (workspace_id, intake_revision_id, idempotency_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (intake_revision_id, workspace_id)
    REFERENCES brand_intake_revisions(id, workspace_id)
);

CREATE INDEX idx_brand_content_onboarding_workspace_updated
  ON brand_content_onboarding_runs(workspace_id, updated_at DESC, id);

CREATE INDEX idx_brand_content_onboarding_recovery
  ON brand_content_onboarding_runs(status, updated_at, id)
  WHERE status IN ('brand_generating', 'brand_generating_dependents', 'content_generating');

-- Every accepted transition command remains replayable after later gates advance.
CREATE TABLE brand_content_onboarding_commands (
  run_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64
    AND request_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  result_revision INTEGER NOT NULL CHECK (
    typeof(result_revision) = 'integer' AND result_revision >= 1
  ),
  result_status TEXT NOT NULL CHECK (result_status IN (
    'intake_ready',
    'brand_generating',
    'awaiting_voice_review',
    'awaiting_voice_finalization',
    'brand_generating_dependents',
    'awaiting_operator_review',
    'awaiting_client_review',
    'awaiting_content_authorization',
    'content_generating',
    'awaiting_content_review',
    'ready_to_publish',
    'needs_attention',
    'cancelled',
    'failed'
  )),
  paid_job_id TEXT CHECK (
    paid_job_id IS NULL OR length(paid_job_id) BETWEEN 1 AND 128
  ),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  PRIMARY KEY (run_id, idempotency_key),
  FOREIGN KEY (run_id, workspace_id)
    REFERENCES brand_content_onboarding_runs(id, workspace_id) ON DELETE CASCADE
);
