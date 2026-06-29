CREATE TABLE IF NOT EXISTS google_oauth_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'google',
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  expires_at INTEGER,
  scopes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'connected',
  connected_by TEXT,
  last_refresh_at TEXT,
  last_synced_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_oauth_connections_status
  ON google_oauth_connections(status, updated_at);

CREATE TABLE IF NOT EXISTS google_business_profile_oauth_states (
  nonce TEXT PRIMARY KEY,
  intent TEXT NOT NULL,
  workspace_id TEXT,
  return_to TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_business_profile_oauth_states_expires
  ON google_business_profile_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS google_business_accounts (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES google_oauth_connections(id) ON DELETE CASCADE,
  account_resource_name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  permission_level TEXT,
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_business_accounts_connection
  ON google_business_accounts(connection_id);

CREATE TABLE IF NOT EXISTS google_business_locations (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES google_oauth_connections(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES google_business_accounts(id) ON DELETE CASCADE,
  account_resource_name TEXT NOT NULL,
  location_resource_name TEXT NOT NULL UNIQUE,
  title TEXT,
  place_id TEXT,
  website_uri TEXT,
  phone_number TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  locality TEXT,
  administrative_area TEXT,
  postal_code TEXT,
  region_code TEXT,
  category_name TEXT,
  sync_status TEXT NOT NULL DEFAULT 'available',
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_business_locations_connection
  ON google_business_locations(connection_id);

CREATE INDEX IF NOT EXISTS idx_google_business_locations_account
  ON google_business_locations(account_id);

CREATE TABLE IF NOT EXISTS workspace_google_business_locations (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_location_id TEXT NOT NULL REFERENCES client_locations(id) ON DELETE CASCADE,
  google_location_id TEXT NOT NULL REFERENCES google_business_locations(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, client_location_id),
  UNIQUE (workspace_id, google_location_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_google_business_locations_google_location
  ON workspace_google_business_locations(google_location_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_google_business_locations_google_location_unique
  ON workspace_google_business_locations(google_location_id);
