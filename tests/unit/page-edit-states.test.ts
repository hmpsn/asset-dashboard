/**
 * Wave 25 — Unit tests for server/page-edit-states.ts
 *
 * Focuses on STATUS_PRIORITY-driven downgrade-prevention logic, metadata
 * field mapping, and the "all" status sentinel for clearPageStatesByStatus.
 *
 * Complements tests/server/page-edit-states.test.ts which exercises the full
 * DB integration path. These tests use the real SQLite test DB (via db-setup.ts)
 * since page-edit-states.ts uses eager prepare() calls at module load time.
 */
import { describe, it, expect, afterAll } from 'vitest';
import db from '../../server/db/index.js';
import {
  updatePageState,
  getPageState,
  getAllPageStates,
  clearPageState,
  clearPageStatesByStatus,
} from '../../server/page-edit-states.js';
import type { PageEditStatus } from '../../shared/types/workspace.js';

// ── Test workspace helpers ─────────────────────────────────────────────────────

const WS_BASE = 'pes-unit-' + Date.now();

function seedWorkspace(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, folder, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, 'Unit Test WS', 'unit-folder', new Date().toISOString());
}

function wsId(suffix: string) {
  return `${WS_BASE}-${suffix}`;
}

afterAll(() => {
  db.prepare(`DELETE FROM page_edit_states WHERE workspace_id LIKE ?`).run(`${WS_BASE}%`);
  db.prepare(`DELETE FROM workspaces WHERE id LIKE ?`).run(`${WS_BASE}%`);
});

// ── STATUS_PRIORITY — downgrade prevention matrix ─────────────────────────────

describe('STATUS_PRIORITY — downgrade prevention', () => {
  /**
   * The priority order is: clean(0) < issue-detected(1) < fix-proposed(2)
   * < in-review(3) < approved(4) = rejected(4) < live(5).
   * Any attempt to set a lower-priority status (except 'clean' or 'rejected')
   * must be silently ignored and the existing status preserved.
   */

  it('blocks downgrade from approved to fix-proposed', () => {
    const ws = wsId('prio-approved-to-fix');
    seedWorkspace(ws);
    updatePageState(ws, 'p1', { status: 'approved' });
    const result = updatePageState(ws, 'p1', { status: 'fix-proposed' });
    expect(result!.status).toBe('approved');
  });

  it('blocks downgrade from in-review to issue-detected', () => {
    const ws = wsId('prio-review-to-issue');
    seedWorkspace(ws);
    updatePageState(ws, 'p1', { status: 'in-review' });
    const result = updatePageState(ws, 'p1', { status: 'issue-detected' });
    expect(result!.status).toBe('in-review');
  });

  it('blocks downgrade from live to in-review', () => {
    const ws = wsId('prio-live-to-review');
    seedWorkspace(ws);
    updatePageState(ws, 'p1', { status: 'live' });
    const result = updatePageState(ws, 'p1', { status: 'in-review' });
    expect(result!.status).toBe('live');
  });

  it('allows upgrade from issue-detected to in-review', () => {
    const ws = wsId('prio-upgrade');
    seedWorkspace(ws);
    updatePageState(ws, 'p1', { status: 'issue-detected' });
    const result = updatePageState(ws, 'p1', { status: 'in-review' });
    expect(result!.status).toBe('in-review');
  });

  it('always allows setting status to "clean" regardless of current status', () => {
    const ws = wsId('prio-to-clean');
    seedWorkspace(ws);
    // Set a high-priority status first
    updatePageState(ws, 'p1', { status: 'live' });
    const result = updatePageState(ws, 'p1', { status: 'clean' });
    expect(result!.status).toBe('clean');
  });

  it('always allows setting status to "rejected" regardless of current status', () => {
    const ws = wsId('prio-to-rejected');
    seedWorkspace(ws);
    updatePageState(ws, 'p1', { status: 'live' });
    const result = updatePageState(ws, 'p1', { status: 'rejected' });
    expect(result!.status).toBe('rejected');
  });

  it('merges non-status fields even when status downgrade is blocked', () => {
    const ws = wsId('prio-merge-fields');
    seedWorkspace(ws);
    updatePageState(ws, 'p1', { status: 'in-review', slug: '/original' });
    // Attempt downgrade but with a new slug
    const result = updatePageState(ws, 'p1', { status: 'fix-proposed', slug: '/updated' });
    // Status stays at in-review but slug is updated
    expect(result!.status).toBe('in-review');
    expect(result!.slug).toBe('/updated');
  });
});

// ── Field mapping & serialization ─────────────────────────────────────────────

describe('field mapping', () => {
  it('serializes and deserializes fields JSON array correctly', () => {
    const ws = wsId('fields-array');
    seedWorkspace(ws);
    updatePageState(ws, 'p1', {
      status: 'fix-proposed',
      fields: ['meta_title', 'meta_description', 'h1'],
    });
    const result = getPageState(ws, 'p1');
    expect(result!.fields).toEqual(['meta_title', 'meta_description', 'h1']);
  });

  it('persists source, workOrderId, and rejectionNote correctly', () => {
    const ws = wsId('metadata-fields');
    seedWorkspace(ws);
    updatePageState(ws, 'p1', {
      status: 'rejected',
      source: 'approval',
      workOrderId: 'wo-123',
      rejectionNote: 'Not aligned with brand voice',
      updatedBy: 'admin',
    });
    const result = getPageState(ws, 'p1');
    expect(result!.source).toBe('approval');
    expect(result!.workOrderId).toBe('wo-123');
    expect(result!.rejectionNote).toBe('Not aligned with brand voice');
    expect(result!.updatedBy).toBe('admin');
  });

  it('sets undefined for optional fields that were not provided', () => {
    const ws = wsId('optional-fields');
    seedWorkspace(ws);
    updatePageState(ws, 'p1', { status: 'clean' });
    const result = getPageState(ws, 'p1');
    expect(result!.auditIssues).toBeUndefined();
    expect(result!.fields).toBeUndefined();
    expect(result!.approvalBatchId).toBeUndefined();
    expect(result!.rejectionNote).toBeUndefined();
  });
});

// ── getAllPageStates — all-status sentinel ────────────────────────────────────

describe('clearPageStatesByStatus — all sentinel', () => {
  it('clears all statuses when "all" is passed', () => {
    const ws = wsId('clr-all-unit');
    seedWorkspace(ws);

    const statuses: PageEditStatus[] = ['clean', 'issue-detected', 'fix-proposed', 'in-review'];
    for (let i = 0; i < statuses.length; i++) {
      // We need to insert each in a separate page to avoid status upgrade conflicts
      updatePageState(ws, `page-${i}`, { status: statuses[i] });
    }

    const deleted = clearPageStatesByStatus(ws, 'all');
    expect(deleted).toBe(statuses.length);
    expect(getAllPageStates(ws)).toEqual({});
  });

  it('removes only the targeted page in clearPageState', () => {
    const ws = wsId('clr-single');
    seedWorkspace(ws);
    updatePageState(ws, 'target', { status: 'clean' });
    updatePageState(ws, 'sibling', { status: 'approved' });

    clearPageState(ws, 'target');

    expect(getPageState(ws, 'target')).toBeUndefined();
    expect(getPageState(ws, 'sibling')).toBeDefined();
  });
});
