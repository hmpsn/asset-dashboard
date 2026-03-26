-- Persist user-selected page type hints per site+page so they survive across sessions
CREATE TABLE IF NOT EXISTS schema_page_types (
  site_id   TEXT NOT NULL,
  page_id   TEXT NOT NULL,
  page_type TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (site_id, page_id)
);
