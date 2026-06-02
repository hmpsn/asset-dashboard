-- 111-client-deliverable.sql
-- Unified client-deliverable spine (replaces the 5 bespoke send-to-client artifacts
-- for the physically-migrated types; copy_section + content_request are PROJECTED).
-- Dark until the unified-deliverables-* flags flip per type. See
-- docs/designs/2026-06-01-unified-send-to-client-design.md §4.1.
--
-- Lockstep (CLAUDE.md DB column + mapper): migration 111 + row interface +
-- rowToDeliverable + upsertDeliverable + getDeliverable/listDeliverables + Zod
-- payload schema, all in server/client-deliverables.ts.
--
-- Workspace-delete cascade is wired HERE (not in 019-cascade-workspace-delete.sql,
-- which is not re-run — audit §B.3). workspace_id is a FK to workspaces(id) ON DELETE
-- CASCADE (the same pattern 019 applies to every other workspace-scoped table), so
-- deleting a workspace removes its deliverables; the 112 child-table FK then removes
-- their items. Foreign keys are ON (WAL mode).
CREATE TABLE IF NOT EXISTS client_deliverable (
  id                    TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_ref          TEXT,            -- site_id for schema_plan; null otherwise
  type                  TEXT NOT NULL,
  kind                  TEXT NOT NULL,   -- decision|batch|review|notification|order
  status                TEXT NOT NULL,
  title                 TEXT NOT NULL,
  summary               TEXT,
  payload               TEXT NOT NULL,   -- typed JSON, discriminated by `type`
  note                  TEXT,
  client_response_note  TEXT,
  parent_deliverable_id TEXT,            -- self-FK (schema_plan → its schema-item batch)
  sent_at               TEXT,            -- staleness clock
  decided_at            TEXT,
  due_at                TEXT,
  applied_at            TEXT,
  generated_at          TEXT,            -- producer version stamp
  source                TEXT,
  source_ref            TEXT,            -- stable dedup key (per-type, design §4.5)
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cd_ws_status_sent ON client_deliverable(workspace_id, status, sent_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cd_ws_type_sourceref
  ON client_deliverable(workspace_id, type, source_ref) WHERE source_ref IS NOT NULL;
