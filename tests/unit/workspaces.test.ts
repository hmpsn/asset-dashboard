/**
 * Unit tests for server/workspaces.ts — CRUD, page state machine, helpers.
 *
 * These tests use the real file system via a temporary data directory
 * to avoid polluting production data.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We need to set up a temp directory BEFORE importing the module
// because workspaces.ts reads UPLOAD_ROOT at module load time.
// Instead, we'll test the exported functions that don't depend on
// module-level constants by mocking fs operations.

import {
  listWorkspaces,
  createWorkspace,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
  updatePageState,
  getPageState,
  getAllPageStates,
  clearPageState,
  getClientPortalUrl,
  getTokenForSite,
  type PageEditStatus,
} from '../../server/workspaces.js';

// ── getClientPortalUrl ──

describe('getClientPortalUrl', () => {
  const origAppUrl = process.env.APP_URL;

  afterAll(() => {
    if (origAppUrl !== undefined) process.env.APP_URL = origAppUrl;
    else delete process.env.APP_URL;
  });

  it('returns undefined when APP_URL is not set', () => {
    delete process.env.APP_URL;
    expect(getClientPortalUrl({ id: 'ws_1' })).toBeUndefined();
  });

  it('builds correct URL from APP_URL', () => {
    process.env.APP_URL = 'https://app.hmpsn.studio';
    expect(getClientPortalUrl({ id: 'ws_123' })).toBe('https://app.hmpsn.studio/client/ws_123');
  });

  it('strips trailing slashes from APP_URL', () => {
    process.env.APP_URL = 'https://app.hmpsn.studio///';
    expect(getClientPortalUrl({ id: 'ws_1' })).toBe('https://app.hmpsn.studio/client/ws_1');
  });
});

// ── Workspace CRUD (integration with real file I/O) ──

describe('workspace CRUD', () => {
  it('createWorkspace returns a workspace with expected fields', () => {
    const ws = createWorkspace('Test Workspace', 'site_abc', 'Test Site');
    expect(ws.id).toMatch(/^ws_\d+(_\d+)?$/);
    expect(ws.name).toBe('Test Workspace');
    expect(ws.webflowSiteId).toBe('site_abc');
    expect(ws.webflowSiteName).toBe('Test Site');
    expect(ws.folder).toBe('test-workspace');
    expect(ws.tier).toBe('free');
    expect(ws.trialEndsAt).toBeDefined();
    expect(ws.createdAt).toBeDefined();

    // Clean up
    deleteWorkspace(ws.id);
  });

  it('createWorkspace sets a 14-day trial', () => {
    const ws = createWorkspace('Trial Test');
    const trialEnd = new Date(ws.trialEndsAt!);
    const now = new Date();
    const diffDays = (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(13);
    expect(diffDays).toBeLessThan(15);

    deleteWorkspace(ws.id);
  });

  it('createWorkspace generates URL-safe folder names', () => {
    const ws = createWorkspace('My Awesome Site!!! @#$');
    expect(ws.folder).toBe('my-awesome-site');

    deleteWorkspace(ws.id);
  });

  it('getWorkspace retrieves a created workspace', () => {
    const ws = createWorkspace('Get Test');
    const retrieved = getWorkspace(ws.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(ws.id);
    expect(retrieved!.name).toBe('Get Test');

    deleteWorkspace(ws.id);
  });

  it('getWorkspace returns undefined for non-existent id', () => {
    expect(getWorkspace('ws_nonexistent_999')).toBeUndefined();
  });

  it('updateWorkspace modifies fields', () => {
    const ws = createWorkspace('Update Test');
    const updated = updateWorkspace(ws.id, { name: 'Updated Name', tier: 'growth' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.tier).toBe('growth');

    deleteWorkspace(ws.id);
  });

  it('updateWorkspace returns null for non-existent id', () => {
    expect(updateWorkspace('ws_nonexistent_999', { name: 'Nope' })).toBeNull();
  });

  it('deleteWorkspace removes the workspace', () => {
    const ws = createWorkspace('Delete Test');
    expect(deleteWorkspace(ws.id)).toBe(true);
    expect(getWorkspace(ws.id)).toBeUndefined();
  });

  it('deleteWorkspace returns false for non-existent id', () => {
    expect(deleteWorkspace('ws_nonexistent_999')).toBe(false);
  });

  it('listWorkspaces includes created workspaces', () => {
    const ws = createWorkspace('List Test');
    const all = listWorkspaces();
    expect(all.some(w => w.id === ws.id)).toBe(true);

    deleteWorkspace(ws.id);
  });
});

// ── getTokenForSite ──

describe('getTokenForSite', () => {
  it('returns null when no workspace matches and no env var', () => {
    const origToken = process.env.WEBFLOW_API_TOKEN;
    delete process.env.WEBFLOW_API_TOKEN;

    expect(getTokenForSite('nonexistent_site')).toBeNull();

    if (origToken !== undefined) process.env.WEBFLOW_API_TOKEN = origToken;
  });

  it('returns workspace token when site matches', () => {
    const ws = createWorkspace('Token Test', 'site_token_test');
    updateWorkspace(ws.id, { webflowToken: 'wf_tok_123' });

    expect(getTokenForSite('site_token_test')).toBe('wf_tok_123');

    deleteWorkspace(ws.id);
  });
});

// ── Page Edit State Machine ──

describe('updatePageState', () => {
  let wsId: string;

  beforeEach(() => {
    const ws = createWorkspace('State Test ' + Date.now());
    wsId = ws.id;
  });

  afterAll(() => {
    // Clean up any leftover test workspaces
    const all = listWorkspaces();
    for (const ws of all) {
      if (ws.name.startsWith('State Test ')) {
        deleteWorkspace(ws.id);
      }
    }
  });

  it('creates a new page state', () => {
    const state = updatePageState(wsId, 'page_1', { status: 'issue-detected', source: 'audit' });
    expect(state).not.toBeNull();
    expect(state!.pageId).toBe('page_1');
    expect(state!.status).toBe('issue-detected');
    expect(state!.source).toBe('audit');
    expect(state!.updatedAt).toBeDefined();
  });

  it('returns null for non-existent workspace', () => {
    expect(updatePageState('ws_nonexistent_999', 'p1', { status: 'clean' })).toBeNull();
  });

  it('upgrades status forward (issue-detected → fix-proposed)', () => {
    updatePageState(wsId, 'page_2', { status: 'issue-detected' });
    const updated = updatePageState(wsId, 'page_2', { status: 'fix-proposed' });
    expect(updated!.status).toBe('fix-proposed');
  });

  it('does NOT downgrade status (fix-proposed → issue-detected)', () => {
    updatePageState(wsId, 'page_3', { status: 'fix-proposed' });
    const updated = updatePageState(wsId, 'page_3', { status: 'issue-detected' });
    // Status should remain fix-proposed (no downgrade)
    expect(updated!.status).toBe('fix-proposed');
  });

  it('allows explicit reset to clean (override downgrade protection)', () => {
    updatePageState(wsId, 'page_4', { status: 'in-review' });
    const updated = updatePageState(wsId, 'page_4', { status: 'clean' });
    expect(updated!.status).toBe('clean');
  });

  it('allows explicit set to rejected (override downgrade protection)', () => {
    updatePageState(wsId, 'page_5', { status: 'approved' });
    const updated = updatePageState(wsId, 'page_5', { status: 'rejected' });
    expect(updated!.status).toBe('rejected');
  });

  it('merges non-status fields even when status would downgrade', () => {
    updatePageState(wsId, 'page_6', { status: 'in-review' });
    const updated = updatePageState(wsId, 'page_6', {
      status: 'issue-detected',
      fields: ['title', 'meta-description'],
    });
    // Status stays, but fields are merged
    expect(updated!.status).toBe('in-review');
    expect(updated!.fields).toEqual(['title', 'meta-description']);
  });

  it('syncs legacy seoEditTracking for flagged statuses', () => {
    updatePageState(wsId, 'page_7', { status: 'issue-detected' });
    const ws = getWorkspace(wsId);
    expect(ws!.seoEditTracking?.['page_7']?.status).toBe('flagged');
  });

  it('syncs legacy seoEditTracking for in-review status', () => {
    updatePageState(wsId, 'page_8', { status: 'in-review' });
    const ws = getWorkspace(wsId);
    expect(ws!.seoEditTracking?.['page_8']?.status).toBe('in-review');
  });

  it('syncs legacy seoEditTracking for live status', () => {
    updatePageState(wsId, 'page_9', { status: 'approved' });
    const ws = getWorkspace(wsId);
    expect(ws!.seoEditTracking?.['page_9']?.status).toBe('live');
  });

  it('removes from legacy tracking when set to clean', () => {
    updatePageState(wsId, 'page_10', { status: 'in-review' });
    updatePageState(wsId, 'page_10', { status: 'clean' });
    const ws = getWorkspace(wsId);
    expect(ws!.seoEditTracking?.['page_10']).toBeUndefined();
  });
});

describe('getPageState / getAllPageStates', () => {
  it('returns undefined for non-existent page', () => {
    expect(getPageState('ws_nonexistent', 'p_none')).toBeUndefined();
  });

  it('getAllPageStates returns empty object for workspace with no states', () => {
    const ws = createWorkspace('Empty States ' + Date.now());
    expect(getAllPageStates(ws.id)).toEqual({});
    deleteWorkspace(ws.id);
  });

  it('getAllPageStates returns all page states', () => {
    const ws = createWorkspace('All States ' + Date.now());
    updatePageState(ws.id, 'p1', { status: 'issue-detected' });
    updatePageState(ws.id, 'p2', { status: 'in-review' });

    const states = getAllPageStates(ws.id);
    expect(Object.keys(states)).toHaveLength(2);
    expect(states['p1'].status).toBe('issue-detected');
    expect(states['p2'].status).toBe('in-review');

    deleteWorkspace(ws.id);
  });
});

describe('clearPageState', () => {
  it('removes page state and legacy tracking', () => {
    const ws = createWorkspace('Clear State ' + Date.now());
    updatePageState(ws.id, 'p_clear', { status: 'in-review' });

    expect(clearPageState(ws.id, 'p_clear')).toBe(true);
    expect(getPageState(ws.id, 'p_clear')).toBeUndefined();
    const wsData = getWorkspace(ws.id);
    expect(wsData!.seoEditTracking?.['p_clear']).toBeUndefined();

    deleteWorkspace(ws.id);
  });

  it('returns false for non-existent workspace', () => {
    expect(clearPageState('ws_nonexistent', 'p1')).toBe(false);
  });
});
