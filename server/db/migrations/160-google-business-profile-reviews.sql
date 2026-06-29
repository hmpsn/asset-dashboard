CREATE TABLE IF NOT EXISTS google_business_reviews (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  google_location_id TEXT NOT NULL REFERENCES google_business_locations(id) ON DELETE CASCADE,
  client_location_id TEXT REFERENCES client_locations(id) ON DELETE SET NULL,
  review_resource_name TEXT NOT NULL UNIQUE,
  review_id TEXT NOT NULL,
  star_rating TEXT NOT NULL,
  rating_value INTEGER,
  comment TEXT,
  reviewer_display_name TEXT,
  reviewer_is_anonymous INTEGER NOT NULL DEFAULT 0,
  create_time TEXT,
  update_time TEXT,
  reply_comment TEXT,
  reply_update_time TEXT,
  reply_state TEXT,
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_business_reviews_workspace
  ON google_business_reviews(workspace_id, update_time);

CREATE INDEX IF NOT EXISTS idx_google_business_reviews_location
  ON google_business_reviews(google_location_id, update_time);

CREATE INDEX IF NOT EXISTS idx_google_business_reviews_unanswered
  ON google_business_reviews(workspace_id, google_location_id, reply_comment);

CREATE TABLE IF NOT EXISTS google_business_review_sync_status (
  google_location_id TEXT PRIMARY KEY REFERENCES google_business_locations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_location_id TEXT REFERENCES client_locations(id) ON DELETE SET NULL,
  sync_status TEXT NOT NULL DEFAULT 'not_synced',
  average_rating REAL,
  total_review_count INTEGER,
  last_synced_at TEXT,
  last_error TEXT,
  next_page_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_business_review_sync_workspace
  ON google_business_review_sync_status(workspace_id, sync_status, updated_at);
