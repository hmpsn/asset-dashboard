import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listActivity } from '../../server/activity-log.js';
import { setBroadcast } from '../../server/broadcast.js';
import { applyKeywordCommandCenterBulkAction } from '../../server/keyword-command-center.js';
import { addTrackedKeyword, getTrackedKeywords, updateTrackedKeywords } from '../../server/rank-tracking.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { keywordComparisonKey } from '../../shared/keyword-normalization.js';
import { KEYWORD_COMMAND_CENTER_ACTIONS } from '../../shared/types/keyword-command-center.js';
import { TRACKED_KEYWORD_SOURCE, TRACKED_KEYWORD_STATUS } from '../../shared/types/rank-tracking.js';
import { WS_EVENTS } from '../../server/ws-events.js';

describe('applyKeywordCommandCenterBulkAction', () => {
  const cleanupWorkspaceIds = new Set<string>();

  beforeEach(() => {
    setBroadcast(vi.fn(), vi.fn());
  });

  afterEach(() => {
    for (const id of cleanupWorkspaceIds) deleteWorkspace(id);
    cleanupWorkspaceIds.clear();
  });

  it('applies pause_tracking to eligible keywords and counts protected keywords as skipped', () => {
    const ws = createWorkspace('Bulk Pause Test');
    cleanupWorkspaceIds.add(ws.id);
    addTrackedKeyword(ws.id, 'plumber austin', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });
    addTrackedKeyword(ws.id, 'plumber dallas', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });
    addTrackedKeyword(ws.id, 'protected term', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    const result = applyKeywordCommandCenterBulkAction(ws.id, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keywords: ['plumber austin', 'plumber dallas', 'protected term'],
    });

    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.items.find(item => item.keyword === 'protected term')?.status).toBe('skipped_protected');

    const tracked = getTrackedKeywords(ws.id, { includeInactive: true });
    expect(tracked.find(item => item.query === 'plumber austin')?.status).toBe(TRACKED_KEYWORD_STATUS.PAUSED);
    expect(tracked.find(item => item.query === 'plumber dallas')?.status).toBe(TRACKED_KEYWORD_STATUS.PAUSED);
    expect(tracked.find(item => item.query === 'protected term')?.status).toBe(TRACKED_KEYWORD_STATUS.ACTIVE);
  });

  it('force=true overrides protection checks', () => {
    const ws = createWorkspace('Bulk Force Test');
    cleanupWorkspaceIds.add(ws.id);
    addTrackedKeyword(ws.id, 'protected term', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    const result = applyKeywordCommandCenterBulkAction(ws.id, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keywords: ['protected term'],
      force: true,
    });

    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(getTrackedKeywords(ws.id, { includeInactive: true }).find(item => item.query === 'protected term')?.status).toBe(TRACKED_KEYWORD_STATUS.PAUSED);
  });

  it('deduplicates canonical keyword variants before applying the action', () => {
    const ws = createWorkspace('Bulk Dedupe Test');
    cleanupWorkspaceIds.add(ws.id);
    addTrackedKeyword(ws.id, 'Emergency Dentist - Near-Me', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });

    const result = applyKeywordCommandCenterBulkAction(ws.id, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keywords: ['Emergency Dentist - Near-Me', 'emergency dentist near me'],
      force: true,
    });

    expect(result.applied).toBe(1);
    expect(result.items.map(item => keywordComparisonKey(item.keyword))).toEqual(['emergency dentist near me']);
  });

  it('issues exactly one rank-tracking broadcast for the whole batch', () => {
    const wsBroadcast = vi.fn();
    setBroadcast(vi.fn(), wsBroadcast);
    const ws = createWorkspace('Bulk Broadcast Test');
    cleanupWorkspaceIds.add(ws.id);
    addTrackedKeyword(ws.id, 'kw a', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });
    addTrackedKeyword(ws.id, 'kw b', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });
    addTrackedKeyword(ws.id, 'kw c', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });

    applyKeywordCommandCenterBulkAction(ws.id, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keywords: ['kw a', 'kw b', 'kw c'],
    });

    const rankBroadcasts = wsBroadcast.mock.calls.filter(call => call[1] === WS_EVENTS.RANK_TRACKING_UPDATED);
    expect(rankBroadcasts).toHaveLength(1);
  });

  it('records exactly one summary activity entry for the batch', () => {
    const ws = createWorkspace('Bulk Activity Test');
    cleanupWorkspaceIds.add(ws.id);
    addTrackedKeyword(ws.id, 'one', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });
    addTrackedKeyword(ws.id, 'two', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });

    const beforeCount = listActivity(ws.id).length;
    applyKeywordCommandCenterBulkAction(ws.id, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keywords: ['one', 'two'],
    });

    expect(listActivity(ws.id).length - beforeCount).toBe(1);
  });

  it('does not log activity or broadcast when every keyword is skipped', () => {
    const wsBroadcast = vi.fn();
    setBroadcast(vi.fn(), wsBroadcast);
    const ws = createWorkspace('Bulk All Skipped Test');
    cleanupWorkspaceIds.add(ws.id);
    addTrackedKeyword(ws.id, 'manual keyword', { source: TRACKED_KEYWORD_SOURCE.MANUAL });

    const beforeCount = listActivity(ws.id).length;
    const result = applyKeywordCommandCenterBulkAction(ws.id, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keywords: ['manual keyword'],
    });

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(listActivity(ws.id).length - beforeCount).toBe(0);
    expect(wsBroadcast.mock.calls.filter(call => call[1] === WS_EVENTS.RANK_TRACKING_UPDATED)).toHaveLength(0);
  });

  it('routes a bulk item with an illegal lifecycle state to status:error (not skipped)', () => {
    const ws = createWorkspace('Bulk Illegal State Test');
    cleanupWorkspaceIds.add(ws.id);
    addTrackedKeyword(ws.id, 'ok kw', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });
    addTrackedKeyword(ws.id, 'already retired', { source: TRACKED_KEYWORD_SOURCE.RECOMMENDATION });
    // Force the second keyword into a state from which RETIRE is illegal (deprecated → deprecated).
    updateTrackedKeywords(ws.id, keywords =>
      keywords.map(k => (k.query === 'already retired' ? { ...k, status: TRACKED_KEYWORD_STATUS.DEPRECATED } : k)),
    );

    const result = applyKeywordCommandCenterBulkAction(ws.id, {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE,
      keywords: ['ok kw', 'already retired'],
    });

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(0);
    const illegal = result.items.find(item => item.keyword === 'already retired');
    expect(illegal?.status).toBe('error');
    expect(illegal?.error).toContain('Invalid tracked_keyword transition');
  });

  it('throws Workspace not found when workspaceId is unknown', () => {
    expect(() => applyKeywordCommandCenterBulkAction('ws_nonexistent', {
      action: KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING,
      keywords: ['kw'],
    })).toThrow('Workspace not found');
  });
});
