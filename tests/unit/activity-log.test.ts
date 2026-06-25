/**
 * Unit tests for server/activity-log.ts — activity CRUD, filtering, broadcast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  addActivity,
  getClientActivitySummary,
  listActivity,
  listClientActivity,
  initActivityBroadcast,
  pruneActivityLogRetention,
} from '../../server/activity-log.js';

// ── addActivity ──

describe('addActivity', () => {
  beforeEach(() => {
    db.prepare("DELETE FROM activity_log WHERE workspace_id LIKE 'ws_retention_%'").run();
  });

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

  it('does not globally prune quiet workspaces when unrelated workspaces write activity', () => {
    const quietWsId = `ws_retention_quiet_${Date.now()}`;
    const noisyWsId = `ws_retention_noisy_${Date.now()}`;

    for (let i = 0; i < 500; i++) {
      addActivity(quietWsId, 'note', `Quiet ${i}`);
    }
    for (let i = 0; i < 10; i++) {
      addActivity(noisyWsId, 'note', `Noisy ${i}`);
    }

    expect(listActivity(quietWsId, 1000)).toHaveLength(500);
    expect(listActivity(noisyWsId, 1000)).toHaveLength(10);
  });

  it('prunes retention per workspace when the scheduled retention sweep runs', () => {
    const busyWsId = `ws_retention_busy_${Date.now()}`;
    const quietWsId = `ws_retention_quiet_${Date.now()}`;

    for (let i = 0; i < 510; i++) {
      addActivity(busyWsId, 'note', `Busy ${i}`);
    }
    for (let i = 0; i < 10; i++) {
      addActivity(quietWsId, 'note', `Quiet ${i}`);
    }

    expect(pruneActivityLogRetention()).toBe(10);
    expect(listActivity(busyWsId, 1000)).toHaveLength(500);
    expect(listActivity(quietWsId, 1000)).toHaveLength(10);
  });
});

// ── listActivity ──

describe('listActivity', () => {
  it('returns activities for a specific workspace', () => {
    const wsId = 'ws_list_' + Date.now();
    addActivity(wsId, 'note', 'Note 1');
    addActivity(wsId, 'note', 'Note 2');

    const activities = listActivity(wsId);
    expect(activities.length > 0 && activities.every(a => a.workspaceId === wsId)).toBe(true);
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

// ── getClientActivitySummary ──

describe('getClientActivitySummary', () => {
  it('counts client-originated portal activity and excludes admin send events', () => {
    const wsId = 'ws_client_summary_' + Date.now();
    addActivity(wsId, 'client_action_sent', 'Admin sent action to client');
    addActivity(wsId, 'portal_session', 'Client opened portal');
    addActivity(wsId, 'post_client_edit', 'Client edited post');

    const summary = getClientActivitySummary(wsId);

    expect(summary).toEqual({
      distinctDays: 1,
      lastActive: expect.any(String),
    });
  });

  it('returns null when a workspace only has admin-originated client send activity', () => {
    const wsId = 'ws_admin_send_only_' + Date.now();
    addActivity(wsId, 'client_action_sent', 'Admin sent action to client');

    expect(getClientActivitySummary(wsId)).toBeNull();
  });
});
