-- The Issue (Client) P1a: Webflow-native named-lead capture. One row per Webflow form submission.
-- PII (lead_name/email/message) is admin-only and NEVER serialized into the public ROI payload.
-- UNIQUE(workspace_id, submission_id) makes webhook re-delivery idempotent (no double counts).
CREATE TABLE IF NOT EXISTS form_submissions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  form_id       TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  form_name     TEXT NOT NULL,
  lead_name     TEXT,
  lead_email    TEXT,
  lead_message  TEXT,
  event_name    TEXT NOT NULL DEFAULT 'form_submit',
  outcome_type  TEXT NOT NULL DEFAULT 'form_fill',
  submitted_at  TEXT NOT NULL,
  captured_at   TEXT NOT NULL,
  UNIQUE (workspace_id, submission_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_ws_submitted ON form_submissions(workspace_id, submitted_at);
