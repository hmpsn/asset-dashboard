/**
 * A1.5 — `disabled` availability switch propagation (in-process intelligence path).
 *
 * Verifies the administrative learnings kill-switch makes
 * `LearningsSlice.availability === 'disabled'` reachable end-to-end and that it
 * propagates through `buildContentGenerationContext().learningsAvailability`, the
 * read path consumers obey (per the LearningsSlice.availability contract).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { buildContentGenerationContext } from '../../server/intelligence/generation-context-builders.js';
import { assembleLearnings } from '../../server/intelligence/learnings-slice.js';
import { setLearningsDisabled, isLearningsDisabled } from '../../server/workspace-learnings.js';

const WS_ID = 'a1-learnings-disabled-ws';

describe('A1.5 disabled learnings propagation', () => {
  beforeEach(() => {
    db.prepare(`
      INSERT OR REPLACE INTO workspaces (id, name, folder, created_at)
      VALUES (?, ?, ?, ?)
    `).run(WS_ID, 'A1 Disabled WS', 'a1-disabled', new Date().toISOString());
    setLearningsDisabled(WS_ID, false);
  });

  afterEach(() => {
    setLearningsDisabled(WS_ID, false);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(WS_ID);
  });

  it('isLearningsDisabled reflects the administrative toggle', () => {
    expect(isLearningsDisabled(WS_ID)).toBe(false);
    setLearningsDisabled(WS_ID, true);
    expect(isLearningsDisabled(WS_ID)).toBe(true);
    setLearningsDisabled(WS_ID, false);
    expect(isLearningsDisabled(WS_ID)).toBe(false);
  });

  it('assembleLearnings reports availability:disabled when administratively disabled', async () => {
    setLearningsDisabled(WS_ID, true);
    const slice = await assembleLearnings(WS_ID);
    expect(slice.availability).toBe('disabled');
    expect(slice.summary).toBeNull();
  });

  it('disabled propagates through buildContentGenerationContext.learningsAvailability', async () => {
    setLearningsDisabled(WS_ID, true);
    const ctx = await buildContentGenerationContext(WS_ID, { slices: ['learnings'] });
    expect(ctx.learningsAvailability).toBe('disabled');
  });

  it('a non-disabled workspace with no outcomes degrades to no_data (not disabled)', async () => {
    // Fresh, never-disabled workspace id so this assertion is isolated from any
    // disable toggled by an earlier test in this file. (Under the vitest ESM loader
    // the slice's dynamic-import module instance does not always observe a static
    // setLearningsDisabled reset; in node/tsx production there is a single instance.
    // A pristine id sidesteps the harness artifact without masking real behavior.)
    const freshWs = 'a1-learnings-nodata-ws';
    db.prepare(`
      INSERT OR REPLACE INTO workspaces (id, name, folder, created_at)
      VALUES (?, ?, ?, ?)
    `).run(freshWs, 'A1 NoData WS', 'a1-nodata', new Date().toISOString());
    try {
      const ctx = await buildContentGenerationContext(freshWs, { slices: ['learnings'] });
      expect(ctx.learningsAvailability).toBe('no_data');
    } finally {
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(freshWs);
    }
  });
});
