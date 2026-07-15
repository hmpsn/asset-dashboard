/**
 * D1 — archive-twin-indexes.test.ts
 *
 * Migration 164 first created idx_tracked_actions_archive_workspace and
 * idx_action_outcomes_archive_action on the rebuilt archive twins. Migrations 165 / 169
 * then RENAMED those twins aside (`_r6_old` / `_r9_old`) — which carries the ORIGINAL
 * index NAMES onto the renamed-aside copies — and recreated the live twins. Their trailing
 * `CREATE INDEX IF NOT EXISTS <original name>` silently no-opped (the name was already
 * taken by the renamed-aside table), leaving the live twins UNINDEXED.
 *
 * Migration 172 restores the indexes under fresh `_v2` names (migration 167's pattern for
 * this exact rename-carries-the-index-name hazard). This test asserts, via PRAGMA
 * index_list against the live migrated DB, that each rebuilt twin now carries a usable
 * index on its lookup column.
 */

import { describe, it, expect } from 'vitest';
import db from '../../server/db/index.js';

interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string;
}

function indexNames(table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as IndexListRow[]).map(r => r.name);
}

function indexedColumns(indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info(${indexName})`).all() as IndexInfoRow[]).map(r => r.name);
}

describe('archive twin indexes restored under _v2 names (migration 172 / D1)', () => {
  it('tracked_actions_archive is indexed on workspace_id via the _v2 name', () => {
    const names = indexNames('tracked_actions_archive');
    expect(names).toContain('idx_tracked_actions_archive_workspace_v2');
    expect(indexedColumns('idx_tracked_actions_archive_workspace_v2')).toEqual(['workspace_id']);
  });

  it('action_outcomes_archive is indexed on action_id via the _v2 name', () => {
    const names = indexNames('action_outcomes_archive');
    expect(names).toContain('idx_action_outcomes_archive_action_v2');
    expect(indexedColumns('idx_action_outcomes_archive_action_v2')).toEqual(['action_id']);
  });

  it('the live twins carry a usable index on their lookup column (not zero indexes)', () => {
    // The regression this closes: after 165/169 the live twins had NO index on their
    // lookup column at all. Assert at least one index covers workspace_id / action_id.
    const trackedIndexed = indexNames('tracked_actions_archive').some(
      name => indexedColumns(name).includes('workspace_id'),
    );
    const outcomesIndexed = indexNames('action_outcomes_archive').some(
      name => indexedColumns(name).includes('action_id'),
    );
    expect(trackedIndexed).toBe(true);
    expect(outcomesIndexed).toBe(true);
  });
});
