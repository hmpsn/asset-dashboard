/**
 * Strategy v3 (spec §6.7) — the Discuss substrate (Phase 2 Lane A).
 *
 * Recs are NOT deliverables, so a discussion is NOT a client_action thread (forbidden by
 * D2) and NOT the single client_note column. This module is the append-only thread keyed to
 * a rec id within a workspace, backed by the rec_discussion table (migration 138).
 *
 * recId is the in-blob Recommendation.id (recommendation_sets is a JSON blob — no FK target),
 * so there is NO foreign key on rec_id; workspace_id scopes every read/write.
 *
 * Read by the cockpit Discuss filter (P2) and the client CuratedRecDiscussThread (P4) via the
 * RecDiscussionEntry contract (shared/types/recommendations.ts §6b).
 */
import { randomUUID } from 'node:crypto';

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type { RecDiscussionEntry } from '../shared/types/recommendations.js';

// ── SQLite row shape (migration 138) ──
interface RecDiscussionRow {
  id: string;
  rec_id: string;
  workspace_id: string;
  author: string;
  body: string;
  created_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO rec_discussion (id, rec_id, workspace_id, author, body, created_at)
         VALUES (@id, @rec_id, @workspace_id, @author, @body, @created_at)`,
  ),
  selectByRec: db.prepare(
    // Tiebreak on rowid (monotonic by insertion) so two entries written in the same
    // millisecond preserve insertion order — an opaque-id ASC tiebreak would not.
    `SELECT * FROM rec_discussion WHERE workspace_id = ? AND rec_id = ? ORDER BY created_at ASC, rowid ASC`,
  ),
}));

function rowToRecDiscussion(row: RecDiscussionRow): RecDiscussionEntry {
  return {
    id: row.id,
    recId: row.rec_id,
    workspaceId: row.workspace_id,
    author: row.author as RecDiscussionEntry['author'],
    body: row.body,
    createdAt: row.created_at,
  };
}

/** Read a rec's discussion thread (workspace + rec scoped), oldest first. */
export function listRecDiscussion(workspaceId: string, recId: string): RecDiscussionEntry[] {
  const rows = stmts().selectByRec.all(workspaceId, recId) as RecDiscussionRow[];
  return rows.map(rowToRecDiscussion);
}

/** Append one entry to a rec's discussion thread. `author` is a display role
 *  ('client' | 'strategist'), not a user id. */
export function addRecDiscussionEntry(
  workspaceId: string,
  recId: string,
  author: RecDiscussionEntry['author'],
  body: string,
): RecDiscussionEntry {
  const entry: RecDiscussionEntry = {
    id: `recd_${randomUUID()}`,
    recId,
    workspaceId,
    author,
    body,
    createdAt: new Date().toISOString(),
  };
  stmts().insert.run({
    id: entry.id,
    rec_id: entry.recId,
    workspace_id: entry.workspaceId,
    author: entry.author,
    body: entry.body,
    created_at: entry.createdAt,
  });
  return entry;
}
