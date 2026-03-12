/**
 * Unit tests for server/activity-log.ts — activity CRUD, filtering, broadcast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  addActivity,
  listActivity,
  listClientActivity,
  deleteActivity,
  initActivityBroadcast,
} from '../../server/activity-log.js';

// ── addActivity ──

describe('addActivity', () => {
  it('returns an activity entry with correct fields', () => {
    const entry = addActivity('ws_act_1', 'audit_completed', 'Audit done', 'Full audit', { pages: 5 });

    expect(entry.id).toMatch(/^act_/);
    expect(entry.workspaceId).toBe('ws_act_1');
    expect(entry.type).toBe('audit_completed');
    expect(entry.title).toBe('Audit done');
    expect(entry.description).toBe('Full audit');
    expect(entry.metadata).toEqual({ pages: 5 });
    expect(entry.createdAt).toBeDefined();
  });

  it('includes actor information when provided', () => {
    const entry = addActivity('ws_act_2', 'seo_updated', 'SEO update', undefined, undefined, { id: 'usr_1', name: 'John' });

    expect(entry.actorId).toBe('usr_1');
    expect(entry.actorName).toBe('John');
  });

  it('calls broadcast function when registered', () => {
    const broadcastFn = vi.fn();
    initActivityBroadcast(broadcastFn);

    const entry = addActivity('ws_broadcast', 'note', 'Test broadcast');

    expect(broadcastFn).toHaveBeenCalledWith('ws_broadcast', 'activity:new', entry);

    // Reset broadcast to avoid affecting other tests
    initActivityBroadcast(() => {});
  });
});

// ── listActivity ──

describe('listActivity', () => {
  it('returns activities for a specific workspace', () => {
    const wsId = 'ws_list_' + Date.now();
    addActivity(wsId, 'note', 'Note 1');
    addActivity(wsId, 'note', 'Note 2');

    const activities = listActivity(wsId);
    expect(activities.length).toBeGreaterThanOrEqual(2);
    expect(activities.every(a => a.workspaceId === wsId)).toBe(true);
  });

  it('returns activities in reverse chronological order', () => {
    const wsId = 'ws_order_' + Date.now();
    addActivity(wsId, 'note', 'First');
    addActivity(wsId, 'note', 'Second');

    const activities = listActivity(wsId);
    expect(activities[0].title).toBe('Second');
    expect(activities[1].title).toBe('First');
  });

  it('respects limit parameter', () => {
    const wsId = 'ws_limit_' + Date.now();
    for (let i = 0; i < 5; i++) {
      addActivity(wsId, 'note', `Note ${i}`);
    }

    const limited = listActivity(wsId, 2);
    expect(limited).toHaveLength(2);
  });

  it('returns all workspace activities when no workspaceId', () => {
    const all = listActivity(undefined, 1000);
    expect(all.length).toBeGreaterThan(0);
  });
});

// ── listClientActivity ──

describe('listClientActivity', () => {
  it('only returns client-visible activity types', () => {
    const wsId = 'ws_client_vis_' + Date.now();
    addActivity(wsId, 'audit_completed', 'Audit done');    // visible
    addActivity(wsId, 'anomaly_detected', 'Anomaly found');  // NOT visible
    addActivity(wsId, 'seo_updated', 'SEO updated');         // visible
    addActivity(wsId, 'chat_session', 'Chat started');       // NOT visible

    const clientActivities = listClientActivity(wsId);
    const types = clientActivities.map(a => a.type);

    // Should contain visible types
    expect(types).toContain('audit_completed');
    expect(types).toContain('seo_updated');
    // Should NOT contain internal types
    expect(types).not.toContain('anomaly_detected');
    expect(types).not.toContain('chat_session');
  });
});

// ── deleteActivity ──

describe('deleteActivity', () => {
  it('deletes an activity by id', () => {
    const entry = addActivity('ws_del_' + Date.now(), 'note', 'To delete');
    expect(deleteActivity(entry.id)).toBe(true);
  });

  it('returns false for non-existent id', () => {
    expect(deleteActivity('act_nonexistent_999')).toBe(false);
  });
});
