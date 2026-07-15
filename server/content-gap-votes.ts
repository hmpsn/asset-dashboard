/**
 * Content-gap vote compatibility service.
 *
 * Unicode-safe v2 decisions are authoritative. The legacy table remains a
 * deterministic rollback projection, while pre-K3b rows are archived before
 * that projection is first rebuilt so no unrecoverable payload is discarded.
 */

import { keywordIdentityKeys } from '../shared/keyword-normalization.js';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

export type ContentGapVoteValue = 'up' | 'down';

export interface ContentGapVoteRow {
  keyword: string;
  vote: ContentGapVoteValue;
  votedBy: string | null;
  updatedAt: string;
  keywordV2?: string;
  keywordV1?: string;
  writeOrder?: number;
}

export interface ContentGapVoteMutationResult {
  row: ContentGapVoteRow;
  changed: boolean;
}

interface V2Row {
  keyword_v2: string;
  raw_keyword: string;
  keyword_v1: string;
  vote: string;
  voted_by: string | null;
  updated_at: string;
  write_order: number;
}

interface LegacyRow {
  keyword: string;
  vote: string;
  voted_by: string | null;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  listV2: db.prepare<[string]>(`
    SELECT keyword_v2, raw_keyword, keyword_v1, vote, voted_by, updated_at, write_order
      FROM content_gap_votes_v2_compat
     WHERE workspace_id = ?
     ORDER BY write_order DESC, updated_at DESC, raw_keyword COLLATE BINARY ASC
  `),
  listLegacyArchive: db.prepare<[string]>(`
    SELECT keyword_v1 AS keyword, vote, voted_by, updated_at
      FROM content_gap_votes_v1_legacy_aliases
     WHERE workspace_id = ?
  `),
  listUnmarkedLegacy: db.prepare<[string]>(`
    SELECT v.keyword, v.vote, v.voted_by, v.updated_at
      FROM content_gap_votes v
      LEFT JOIN content_gap_votes_v1_projection_keys p
        ON p.workspace_id = v.workspace_id AND p.keyword_v1 = v.keyword
     WHERE v.workspace_id = ? AND p.keyword_v1 IS NULL
  `),
  getV2: db.prepare<[string, string]>(`
    SELECT keyword_v2, raw_keyword, keyword_v1, vote, voted_by, updated_at, write_order
      FROM content_gap_votes_v2_compat
     WHERE workspace_id = ? AND keyword_v2 = ?
  `),
  getLegacyMain: db.prepare<[string, string]>(`
    SELECT id, keyword, vote, voted_by, updated_at
      FROM content_gap_votes WHERE workspace_id = ? AND keyword = ?
  `),
  getProjectionMarker: db.prepare<[string, string]>(`
    SELECT keyword_v1 FROM content_gap_votes_v1_projection_keys
     WHERE workspace_id = ? AND keyword_v1 = ?
  `),
  nextWriteOrder: db.prepare<[string]>(`
    SELECT COALESCE(MAX(write_order), 0) + 1 AS next_order
      FROM content_gap_votes_v2_compat WHERE workspace_id = ?
  `),
  upsertV2: db.prepare(`
    INSERT INTO content_gap_votes_v2_compat (
      workspace_id, keyword_v2, raw_keyword, keyword_v1, vote, voted_by, updated_at, write_order
    ) VALUES (
      @workspace_id, @keyword_v2, @raw_keyword, @keyword_v1, @vote, @voted_by, @updated_at, @write_order
    )
    ON CONFLICT(workspace_id, keyword_v2) DO UPDATE SET
      raw_keyword = excluded.raw_keyword,
      keyword_v1 = excluded.keyword_v1,
      vote = excluded.vote,
      voted_by = excluded.voted_by,
      updated_at = excluded.updated_at,
      write_order = excluded.write_order
  `),
  upsertAlias: db.prepare(`
    INSERT INTO content_gap_vote_v2_aliases (
      workspace_id, keyword_v2, keyword_v1, raw_keyword, first_seen_at, last_seen_at
    ) VALUES (@workspace_id, @keyword_v2, @keyword_v1, @raw_keyword, @now, @now)
    ON CONFLICT(workspace_id, keyword_v2, raw_keyword) DO UPDATE SET
      keyword_v1 = excluded.keyword_v1,
      last_seen_at = excluded.last_seen_at
  `),
  archiveLegacy: db.prepare(`
    INSERT OR IGNORE INTO content_gap_votes_v1_legacy_aliases (
      workspace_id, keyword_v1, legacy_id, vote, voted_by, updated_at, archived_at
    ) VALUES (
      @workspace_id, @keyword_v1, @legacy_id, @vote, @voted_by, @updated_at, @archived_at
    )
  `),
  markProjection: db.prepare(`
    INSERT OR IGNORE INTO content_gap_votes_v1_projection_keys (
      workspace_id, keyword_v1, projected_at
    ) VALUES (@workspace_id, @keyword_v1, @projected_at)
  `),
  projectionWinner: db.prepare<[string, string]>(`
    SELECT keyword_v2, raw_keyword, keyword_v1, vote, voted_by, updated_at, write_order
      FROM content_gap_votes_v2_compat
     WHERE workspace_id = ? AND keyword_v1 = ?
     ORDER BY write_order DESC, updated_at DESC, raw_keyword COLLATE BINARY ASC
     LIMIT 1
  `),
  v1KeysForV2: db.prepare<[string, string, string, string]>(`
    SELECT keyword_v1
      FROM content_gap_votes_v2_compat
     WHERE workspace_id = ? AND keyword_v2 = ? AND keyword_v1 <> ''
    UNION
    SELECT keyword_v1
      FROM content_gap_vote_v2_aliases
     WHERE workspace_id = ? AND keyword_v2 = ? AND keyword_v1 <> ''
  `),
  upsertProjection: db.prepare(`
    INSERT INTO content_gap_votes (workspace_id, keyword, vote, voted_by, updated_at)
    VALUES (@workspace_id, @keyword, @vote, @voted_by, @updated_at)
    ON CONFLICT(workspace_id, keyword) DO UPDATE SET
      vote = excluded.vote,
      voted_by = excluded.voted_by,
      updated_at = excluded.updated_at
  `),
  deleteProjection: db.prepare<[string, string]>(`
    DELETE FROM content_gap_votes WHERE workspace_id = ? AND keyword = ?
  `),
  deleteV2: db.prepare<[string, string]>(`
    DELETE FROM content_gap_votes_v2_compat WHERE workspace_id = ? AND keyword_v2 = ?
  `),
  deleteLegacyArchive: db.prepare<[string, string]>(`
    DELETE FROM content_gap_votes_v1_legacy_aliases WHERE workspace_id = ? AND keyword_v1 = ?
  `),
  deleteUnmarkedLegacy: db.prepare<[string, string]>(`
    DELETE FROM content_gap_votes
     WHERE workspace_id = ? AND keyword = ?
       AND NOT EXISTS (
         SELECT 1 FROM content_gap_votes_v1_projection_keys p
          WHERE p.workspace_id = content_gap_votes.workspace_id
            AND p.keyword_v1 = content_gap_votes.keyword
       )
  `),
}));

function toVote(value: string): ContentGapVoteValue {
  return value === 'down' ? 'down' : 'up';
}

function fromV2(row: V2Row): ContentGapVoteRow {
  return {
    keyword: row.raw_keyword,
    vote: toVote(row.vote),
    votedBy: row.voted_by,
    updatedAt: row.updated_at,
    keywordV2: row.keyword_v2,
    keywordV1: row.keyword_v1,
    writeOrder: row.write_order,
  };
}

function fromLegacy(row: LegacyRow): ContentGapVoteRow {
  return {
    keyword: row.keyword,
    vote: toVote(row.vote),
    votedBy: row.voted_by,
    updatedAt: row.updated_at,
  };
}

function ensureProjectionArchive(workspaceId: string, keywordV1: string, now: string): void {
  if (!keywordV1 || stmts().getProjectionMarker.get(workspaceId, keywordV1)) return;
  const legacy = stmts().getLegacyMain.get(workspaceId, keywordV1) as (LegacyRow & { id: number }) | undefined;
  if (legacy) {
    stmts().archiveLegacy.run({
      workspace_id: workspaceId,
      keyword_v1: keywordV1,
      legacy_id: legacy.id,
      vote: legacy.vote,
      voted_by: legacy.voted_by,
      updated_at: legacy.updated_at,
      archived_at: now,
    });
  }
  stmts().markProjection.run({ workspace_id: workspaceId, keyword_v1: keywordV1, projected_at: now });
}

function rebuildProjection(workspaceId: string, keywordV1: string, now: string): void {
  if (!keywordV1) return;
  ensureProjectionArchive(workspaceId, keywordV1, now);
  const winner = stmts().projectionWinner.get(workspaceId, keywordV1) as V2Row | undefined;
  if (!winner) {
    stmts().deleteProjection.run(workspaceId, keywordV1);
    return;
  }
  stmts().upsertProjection.run({
    workspace_id: workspaceId,
    keyword: keywordV1,
    vote: winner.vote,
    voted_by: winner.voted_by,
    updated_at: winner.updated_at,
  });
}

export function listContentGapVotes(workspaceId: string): ContentGapVoteRow[] {
  const v2 = (stmts().listV2.all(workspaceId) as V2Row[]).map(fromV2);
  const representedDisplayKeys = new Set(v2.map(row => row.keyword));
  const archived = (stmts().listLegacyArchive.all(workspaceId) as LegacyRow[])
    .map(fromLegacy)
    .filter(row => !representedDisplayKeys.has(row.keyword));
  const archivedKeys = new Set(archived.map(row => row.keyword));
  const unmarked = (stmts().listUnmarkedLegacy.all(workspaceId) as LegacyRow[])
    .filter(row => !representedDisplayKeys.has(row.keyword) && !archivedKeys.has(row.keyword))
    .map(fromLegacy);
  return [...v2, ...archived, ...unmarked].sort((a, b) =>
    (b.writeOrder ?? 0) - (a.writeOrder ?? 0)
      || b.updatedAt.localeCompare(a.updatedAt)
      || (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0),
  );
}

export function setContentGapVote(
  workspaceId: string,
  keyword: string,
  vote: ContentGapVoteValue,
  votedBy: string | null,
): ContentGapVoteMutationResult {
  const rawKeyword = keyword.trim();
  const identity = keywordIdentityKeys(rawKeyword);
  if (!rawKeyword || !identity.v2) throw new Error('Keyword must have a non-empty v2 identity');

  return db.transaction(() => {
    const now = new Date().toISOString();
    const existing = stmts().getV2.get(workspaceId, identity.v2) as V2Row | undefined;
    if (
      existing
      && existing.raw_keyword === rawKeyword
      && existing.keyword_v1 === identity.v1
      && existing.vote === vote
      && existing.voted_by === votedBy
    ) {
      return { row: fromV2(existing), changed: false };
    }
    const next = stmts().nextWriteOrder.get(workspaceId) as { next_order: number };
    stmts().upsertV2.run({
      workspace_id: workspaceId,
      keyword_v2: identity.v2,
      raw_keyword: rawKeyword,
      keyword_v1: identity.v1,
      vote,
      voted_by: votedBy,
      updated_at: now,
      write_order: next.next_order,
    });
    stmts().upsertAlias.run({
      workspace_id: workspaceId,
      keyword_v2: identity.v2,
      keyword_v1: identity.v1,
      raw_keyword: rawKeyword,
      now,
    });
    const affectedV1Keys = (stmts().v1KeysForV2.all(
      workspaceId,
      identity.v2,
      workspaceId,
      identity.v2,
    ) as Array<{ keyword_v1: string }>).map(row => row.keyword_v1);
    for (const keywordV1 of affectedV1Keys) rebuildProjection(workspaceId, keywordV1, now);
    return {
      row: fromV2(stmts().getV2.get(workspaceId, identity.v2) as V2Row),
      changed: true,
    };
  }).immediate();
}

export function clearContentGapVote(workspaceId: string, keyword: string): boolean {
  const rawKeyword = keyword.trim();
  const identity = keywordIdentityKeys(rawKeyword);
  if (!identity.v2 && !identity.v1) return false;

  return db.transaction(() => {
    if (identity.v2) {
      const existing = stmts().getV2.get(workspaceId, identity.v2) as V2Row | undefined;
      if (existing) {
        const affectedV1Keys = (stmts().v1KeysForV2.all(
          workspaceId,
          identity.v2,
          workspaceId,
          identity.v2,
        ) as Array<{ keyword_v1: string }>).map(row => row.keyword_v1);
        const deleted = stmts().deleteV2.run(workspaceId, identity.v2).changes > 0;
        if (deleted) {
          const now = new Date().toISOString();
          for (const keywordV1 of affectedV1Keys) rebuildProjection(workspaceId, keywordV1, now);
        }
        return deleted;
      }
    }
    // Legacy rows have no recoverable raw identity. Only an exact historical
    // key may delete them; falling back from C# to lossy v1 `c` would erase a
    // potentially meaning-distinct legacy C decision.
    if (!identity.v1 || rawKeyword !== identity.v1) return false;
    const archiveDeleted = stmts().deleteLegacyArchive.run(workspaceId, identity.v1).changes > 0;
    const mainDeleted = stmts().deleteUnmarkedLegacy.run(workspaceId, identity.v1).changes > 0;
    return archiveDeleted || mainDeleted;
  }).immediate();
}

/** Preserves the existing intelligence meaning: one signal per resolved vote row. */
export function listContentGapVoteSignals(workspaceId: string): Array<{ topic: string; votes: number }> {
  return listContentGapVotes(workspaceId).map(row => ({ topic: row.keyword, votes: 1 }));
}
