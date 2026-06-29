CREATE TABLE IF NOT EXISTS google_business_review_responses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  google_location_id TEXT NOT NULL REFERENCES google_business_locations(id) ON DELETE CASCADE,
  client_location_id TEXT REFERENCES client_locations(id) ON DELETE SET NULL,
  review_resource_name TEXT NOT NULL REFERENCES google_business_reviews(review_resource_name) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',
  draft_text TEXT NOT NULL,
  edited_text TEXT,
  sent_deliverable_id TEXT REFERENCES client_deliverable(id) ON DELETE SET NULL,
  approved_at TEXT,
  approved_by_type TEXT,
  approved_by_id TEXT,
  published_at TEXT,
  google_reply_update_time TEXT,
  publish_job_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, review_resource_name)
);

CREATE INDEX IF NOT EXISTS idx_google_business_review_responses_workspace
  ON google_business_review_responses(workspace_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_google_business_review_responses_review
  ON google_business_review_responses(review_resource_name);

CREATE TABLE IF NOT EXISTS google_business_review_response_events (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES google_business_review_responses(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_business_review_response_events_response
  ON google_business_review_response_events(response_id, created_at);

CREATE TABLE IF NOT EXISTS google_business_review_reply_publish_attempts (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES google_business_review_responses(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  provider_status INTEGER,
  provider_kind TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_google_business_review_reply_publish_attempts_response
  ON google_business_review_reply_publish_attempts(response_id, started_at);
