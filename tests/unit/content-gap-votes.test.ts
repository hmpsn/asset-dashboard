import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import {
  clearContentGapVote,
  listContentGapVoteSignals,
  listContentGapVotes,
  setContentGapVote,
} from '../../server/content-gap-votes.js';

const WORKSPACE_ID = `test-content-gap-votes-v2-${process.pid}`;

beforeAll(() => {
  db.prepare(`
    INSERT INTO workspaces (id, name, folder, tier, created_at)
    VALUES (?, 'Content gap vote identity test', 'content-gap-vote-identity-test', 'free', datetime('now'))
  `).run(WORKSPACE_ID);
});

beforeEach(() => {
  db.prepare('DELETE FROM content_gap_vote_v2_aliases WHERE workspace_id = ?').run(WORKSPACE_ID);
  db.prepare('DELETE FROM content_gap_votes_v2_compat WHERE workspace_id = ?').run(WORKSPACE_ID);
  db.prepare('DELETE FROM content_gap_votes_v1_legacy_aliases WHERE workspace_id = ?').run(WORKSPACE_ID);
  db.prepare('DELETE FROM content_gap_votes_v1_projection_keys WHERE workspace_id = ?').run(WORKSPACE_ID);
  db.prepare('DELETE FROM content_gap_votes WHERE workspace_id = ?').run(WORKSPACE_ID);
});

afterAll(() => {
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(WORKSPACE_ID);
});

describe('content-gap vote v2 compatibility', () => {
  it('keeps C and C# as separate decisions while projecting a deterministic v1 winner', () => {
    setContentGapVote(WORKSPACE_ID, 'C', 'down', 'client@example.com');
    setContentGapVote(WORKSPACE_ID, 'C#', 'up', 'client@example.com');

    expect(listContentGapVotes(WORKSPACE_ID).map(row => [row.keyword, row.vote])).toEqual([
      ['C#', 'up'],
      ['C', 'down'],
    ]);
    expect(db.prepare(
      'SELECT vote FROM content_gap_votes WHERE workspace_id = ? AND keyword = ?',
    ).get(WORKSPACE_ID, 'c')).toEqual(expect.objectContaining({ vote: 'up' }));

    expect(clearContentGapVote(WORKSPACE_ID, 'C#')).toBe(true);
    expect(listContentGapVotes(WORKSPACE_ID).map(row => row.keyword)).toEqual(['C']);
    expect(db.prepare(
      'SELECT vote FROM content_gap_votes WHERE workspace_id = ? AND keyword = ?',
    ).get(WORKSPACE_ID, 'c')).toEqual(expect.objectContaining({ vote: 'down' }));
  });

  it('archives an unrecoverable legacy payload before rebuilding its projection', () => {
    db.prepare(`
      INSERT INTO content_gap_votes (workspace_id, keyword, vote, voted_by, updated_at)
      VALUES (?, ?, 'down', 'legacy@example.com', '2025-01-01T00:00:00.000Z')
    `).run(WORKSPACE_ID, 'c');

    setContentGapVote(WORKSPACE_ID, 'C#', 'up', 'new@example.com');

    expect(listContentGapVotes(WORKSPACE_ID).map(row => [row.keyword, row.vote])).toEqual([
      ['C#', 'up'],
      ['c', 'down'],
    ]);
    expect(db.prepare(`
      SELECT vote, voted_by FROM content_gap_votes_v1_legacy_aliases
       WHERE workspace_id = ? AND keyword_v1 = ?
    `).get(WORKSPACE_ID, 'c')).toEqual(expect.objectContaining({
      vote: 'down',
      voted_by: 'legacy@example.com',
    }));
  });

  it('does not append a same-display legacy alias over an authoritative v2 decision', () => {
    db.prepare(`
      INSERT INTO content_gap_votes (workspace_id, keyword, vote, voted_by, updated_at)
      VALUES (?, 'c', 'down', 'legacy@example.com', '2025-01-01T00:00:00.000Z')
    `).run(WORKSPACE_ID);

    const result = setContentGapVote(WORKSPACE_ID, 'c', 'up', 'new@example.com');

    expect(result.changed).toBe(true);
    expect(listContentGapVotes(WORKSPACE_ID)).toEqual([
      expect.objectContaining({ keyword: 'c', vote: 'up' }),
    ]);
    expect(listContentGapVoteSignals(WORKSPACE_ID)).toEqual([{ topic: 'c', votes: 1 }]);
    expect(db.prepare(`
      SELECT vote FROM content_gap_votes_v1_legacy_aliases
      WHERE workspace_id = ? AND keyword_v1 = 'c'
    `).get(WORKSPACE_ID)).toEqual({ vote: 'down' });
  });

  it('reports an identical vote write as unchanged', () => {
    expect(setContentGapVote(WORKSPACE_ID, 'same vote', 'up', 'client@example.com').changed).toBe(true);
    const before = db.prepare(`
      SELECT write_order, updated_at FROM content_gap_votes_v2_compat
      WHERE workspace_id = ?
    `).get(WORKSPACE_ID);

    expect(setContentGapVote(WORKSPACE_ID, 'same vote', 'up', 'client@example.com').changed).toBe(false);
    expect(db.prepare(`
      SELECT write_order, updated_at FROM content_gap_votes_v2_compat
      WHERE workspace_id = ?
    `).get(WORKSPACE_ID)).toEqual(before);
  });

  it('rebuilds every retained v1 alias projection when a v2-equivalent raw spelling changes', () => {
    setContentGapVote(WORKSPACE_ID, 'C#', 'up', null);
    setContentGapVote(WORKSPACE_ID, 'Ｃ#', 'down', null);

    expect(listContentGapVotes(WORKSPACE_ID)).toEqual([
      expect.objectContaining({ keyword: 'Ｃ#', vote: 'down' }),
    ]);
    expect(db.prepare(
      'SELECT vote FROM content_gap_votes WHERE workspace_id = ? AND keyword = ?',
    ).get(WORKSPACE_ID, 'c')).toBeUndefined();
    expect(clearContentGapVote(WORKSPACE_ID, 'Ｃ#')).toBe(true);
    expect(listContentGapVotes(WORKSPACE_ID)).toEqual([]);
  });

  it('stores v2-only non-Latin identities without creating a blank v1 projection', () => {
    setContentGapVote(WORKSPACE_ID, '東京', 'up', null);

    expect(listContentGapVotes(WORKSPACE_ID)).toEqual([
      expect.objectContaining({ keyword: '東京', vote: 'up' }),
    ]);
    expect(db.prepare(
      'SELECT COUNT(*) AS count FROM content_gap_votes WHERE workspace_id = ?',
    ).get(WORKSPACE_ID)).toEqual({ count: 0 });
    expect(listContentGapVoteSignals(WORKSPACE_ID)).toEqual([{ topic: '東京', votes: 1 }]);
  });
});
