-- 112-client-deliverable-item.sql
-- Child items for kind='batch' (approval/SEO/schema-item family). Heterogeneous
-- client_action sub-items live in client_deliverable.payload JSON instead (design §4.1).
-- The typed columns (target_ref/collection_id/field/current_value/proposed_value/
-- client_value/applyable) serve the apply path — the audit_issue field map (fixes B1).
--
-- ON DELETE CASCADE: removing a parent deliverable (incl. via the migration-111
-- workspace-delete cascade) removes its items. Foreign keys are ON (WAL mode).
CREATE TABLE IF NOT EXISTS client_deliverable_item (
  id             TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL REFERENCES client_deliverable(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,
  target_ref     TEXT,            -- pageId / cms-collection-item id
  collection_id  TEXT,            -- Webflow collection
  field          TEXT,            -- the SPECIFIC target field (fixes B1)
  current_value  TEXT,
  proposed_value TEXT,
  client_value   TEXT,            -- client's edited value (apply reads this)
  client_note    TEXT,
  applyable      INTEGER NOT NULL DEFAULT 0,
  item_payload   TEXT,            -- typed JSON for heterogeneous per-item fields
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cdi_deliverable ON client_deliverable_item(deliverable_id);
