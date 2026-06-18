-- 138-rec-discussion.sql
-- Strategy v3 (spec §6.7) — the Discuss substrate. Recs are NOT deliverables, so a
-- discussion is NOT a client_action thread (forbidden by D2) and NOT the single client_note
-- column. This is a minimal append-only thread keyed to a rec id within a workspace.
-- recId is the in-blob Recommendation.id (recommendation_sets is a JSON blob — no FK target),
-- so NO foreign key; workspace_id scopes every read/write/delete.
-- DB column + mapper lockstep: ships with RecDiscussionRow + rowToRecDiscussion + the writer
-- in server/rec-discussion.ts (Phase 2 Lane A). Not on a public-portal serialization list
-- directly — the client reads discussion via the authenticated curated read.
CREATE TABLE IF NOT EXISTS rec_discussion (
  id           TEXT NOT NULL PRIMARY KEY,
  rec_id       TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author       TEXT NOT NULL,            -- 'client' | 'strategist' (display role, not a user id)
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_discussion_ws_rec ON rec_discussion(workspace_id, rec_id, created_at);
