/**
 * Unit tests for server/page-edit-states.ts — extracted CRUD functions.
 *
 * These tests use the shared test SQLite database (runMigrations fires in
 * global-setup.ts; FK enforcement is disabled in db-setup.ts so we can
 * insert rows with ad-hoc workspace IDs that don't exist in the workspaces
 * table — we do insert a workspace row via getById for updatePageState).
 */
import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import {
  updatePageState,
  getPageState,
  getAllPageStates,
  clearPageStatesByStatus,
  clearPageState,
} from '../../server/page-edit-states.js';

// ── Test-scoped workspace IDs (prefixed to avoid collisions) ─────────────────

const WS_BASE = 'pes-test-' + Date.now();

/** Insert a minimal workspace row so updatePageState's getById check passes. */
function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Test WS', 'test-folder', new Date().toISOString());
}

function wsId(suffix: string) {
  return `${WS_BASE}-${suffix}`;
}

afterAll(() => {
  db.prepare(`DELETE FROM page_edit_states WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

// ── updatePageState ──────────────────────────────────────────────────────────

describe('updatePageState', () => {
  it('creates a new page state and returns it', () => {
    const ws = wsId('create');
    seedWorkspace(ws);

    const result = updatePageState(ws, 'page-1', { status: 'issue-detected', slug: '/home' });

    expect(result).not.toBeNull();
    expect(result!.pageId).toBe('page-1');
    expect(result!.status).toBe('issue-detected');
    expect(result!.slug).toBe('/home');
    expect(result!.updatedAt).toBeDefined();
  });

  it('returns null for unknown workspace', () => {
    const result = updatePageState('ws-does-not-exist-999', 'page-x', { status: 'clean' });
    expect(result).toBeNull();
  });

  it('merges updates onto existing state', () => {
    const ws = wsId('merge');
    seedWorkspace(ws);

    updatePageState(ws, 'page-merge', { status: 'issue-detected', slug: '/about' });
    const result = updatePageState(ws, 'page-merge', { status: 'fix-proposed' });

    expect(result!.status).toBe('fix-proposed');
    expect(result!.slug).toBe('/about'); // preserved from first write
  });

  it('does not downgrade status (in-review → fix-proposed is blocked by STATUS_PRIORITY)', () => {
    const ws = wsId('nodown');
    seedWorkspace(ws);

    updatePageState(ws, 'page-nd', { status: 'in-review' });
    // Attempting to downgrade to 'fix-proposed' (lower priority) should be blocked
    const result = updatePageState(ws, 'page-nd', { status: 'fix-proposed' });

    expect(result!.status).toBe('in-review');
  });

  it('allows explicit downgrade to clean', () => {
    const ws = wsId('downclean');
    seedWorkspace(ws);

    updatePageState(ws, 'page-dc', { status: 'approved' });
    const result = updatePageState(ws, 'page-dc', { status: 'clean' });

    expect(result!.status).toBe('clean');
  });

  it('stores and retrieves auditIssues JSON array', () => {
    const ws = wsId('issues');
    seedWorkspace(ws);

    const result = updatePageState(ws, 'page-issues', {
      status: 'issue-detected',
      auditIssues: ['missing_title', 'thin_content'],
    });

    expect(result!.auditIssues).toEqual(['missing_title', 'thin_content']);
  });

  it('stores approvalBatchId', () => {
    const ws = wsId('batch');
    seedWorkspace(ws);

    const result = updatePageState(ws, 'page-batch', {
      status: 'in-review',
      approvalBatchId: 'batch-abc',
    });

    expect(result!.approvalBatchId).toBe('batch-abc');
  });
});

// ── getPageState ─────────────────────────────────────────────────────────────

describe('getPageState', () => {
  it('returns undefined for unknown workspace+page combination', () => {
    const result = getPageState('ws-unknown-pes', 'page-unknown');
    expect(result).toBeUndefined();
  });

  it('returns the correct state after it has been written', () => {
    const ws = wsId('get');
    seedWorkspace(ws);

    updatePageState(ws, 'page-get', { status: 'fix-proposed', slug: '/services' });
    const result = getPageState(ws, 'page-get');

    expect(result).toBeDefined();
    expect(result!.pageId).toBe('page-get');
    expect(result!.status).toBe('fix-proposed');
    expect(result!.slug).toBe('/services');
  });

  it('returns undefined for a page in a different workspace', () => {
    const ws1 = wsId('get-ws1');
    const ws2 = wsId('get-ws2');
    seedWorkspace(ws1);
    seedWorkspace(ws2);

    updatePageState(ws1, 'shared-page', { status: 'approved' });

    const result = getPageState(ws2, 'shared-page');
    expect(result).toBeUndefined();
  });
});

// ── getAllPageStates ──────────────────────────────────────────────────────────

describe('getAllPageStates', () => {
  it('returns empty object when workspace has no states', () => {
    const result = getAllPageStates('ws-no-states-pes-' + Date.now());
    expect(result).toEqual({});
  });

  it('returns all states keyed by pageId', () => {
    const ws = wsId('all');
    seedWorkspace(ws);

    updatePageState(ws, 'page-a', { status: 'clean' });
    updatePageState(ws, 'page-b', { status: 'issue-detected' });
    updatePageState(ws, 'page-c', { status: 'approved' });

    const result = getAllPageStates(ws);

    expect(Object.keys(result)).toHaveLength(3);
    expect(result['page-a'].status).toBe('clean');
    expect(result['page-b'].status).toBe('issue-detected');
    expect(result['page-c'].status).toBe('approved');
  });

  it('does not return states from other workspaces', () => {
    const ws1 = wsId('all-ws1');
    const ws2 = wsId('all-ws2');
    seedWorkspace(ws1);
    seedWorkspace(ws2);

    updatePageState(ws1, 'page-exclusive', { status: 'live' });

    const result = getAllPageStates(ws2);
    expect(result['page-exclusive']).toBeUndefined();
  });
});

// ── clearPageStatesByStatus ───────────────────────────────────────────────────

describe('clearPageStatesByStatus', () => {
  it('returns 0 for unknown workspace', () => {
    const count = clearPageStatesByStatus('ws-nonexistent-pes', 'clean');
    expect(count).toBe(0);
  });

  it('deletes only rows matching the given status', () => {
    const ws = wsId('clr-status');
    seedWorkspace(ws);

    updatePageState(ws, 'page-clean-1', { status: 'clean' });
    updatePageState(ws, 'page-clean-2', { status: 'clean' });
    updatePageState(ws, 'page-issue', { status: 'issue-detected' });

    const deleted = clearPageStatesByStatus(ws, 'clean');

    expect(deleted).toBe(2);

    const remaining = getAllPageStates(ws);
    expect(Object.keys(remaining)).toHaveLength(1);
    expect(remaining['page-issue']).toBeDefined();
  });

  it('clears all states when status is "all"', () => {
    const ws = wsId('clr-all');
    seedWorkspace(ws);

    updatePageState(ws, 'page-x', { status: 'clean' });
    updatePageState(ws, 'page-y', { status: 'approved' });
    updatePageState(ws, 'page-z', { status: 'issue-detected' });

    const deleted = clearPageStatesByStatus(ws, 'all');

    expect(deleted).toBe(3);
    expect(getAllPageStates(ws)).toEqual({});
  });

  it('returns 0 when no rows match the status', () => {
    const ws = wsId('clr-none');
    seedWorkspace(ws);

    updatePageState(ws, 'page-q', { status: 'live' });

    const deleted = clearPageStatesByStatus(ws, 'rejected');
    expect(deleted).toBe(0);

    // Original row is untouched
    expect(getPageState(ws, 'page-q')).toBeDefined();
  });
});

// ── clearPageState ────────────────────────────────────────────────────────────

describe('clearPageState', () => {
  it('returns false for unknown workspace', () => {
    const result = clearPageState('ws-nonexistent-pes', 'page-zzz');
    expect(result).toBe(false);
  });

  it('deletes the specific page state and returns true', () => {
    const ws = wsId('clr-page');
    seedWorkspace(ws);

    updatePageState(ws, 'page-del', { status: 'approved' });
    updatePageState(ws, 'page-keep', { status: 'clean' });

    const result = clearPageState(ws, 'page-del');

    expect(result).toBe(true);
    expect(getPageState(ws, 'page-del')).toBeUndefined();
    expect(getPageState(ws, 'page-keep')).toBeDefined();
  });

  it('returns true even when the page does not exist (workspace is valid)', () => {
    const ws = wsId('clr-nopage');
    seedWorkspace(ws);

    // page never written — still returns true because workspace exists
    const result = clearPageState(ws, 'page-never-written');
    expect(result).toBe(true);
  });
});
