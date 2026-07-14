/**
 * Unit tests for server/activity-log.ts — activity CRUD, filtering, broadcast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  addActivity,
  addActivityOnce,
  getClientActivitySummary,
  listActivity,
  listClientActivity,
  initActivityBroadcast,
  pruneActivityLogRetention,
} from '../../server/activity-log.js';
import {
  getMcpToolExecutionContext,
  runWithMcpToolExecutionContext,
} from '../../server/mcp/tool-execution-context.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { McpToolExecutionContext } from '../../shared/types/mcp-runtime.js';

function workspaceMcpContext(
  workspaceId: string,
  overrides: Partial<Pick<McpToolExecutionContext, 'requestId' | 'toolName'>> = {},
): McpToolExecutionContext {
  return {
    requestId: overrides.requestId ?? 'req-activity-attribution',
    toolName: overrides.toolName ?? 'update_workspace',
    targetWorkspaceId: workspaceId,
    caller: {
      kind: 'workspace_key',
      scope: workspaceId,
      workspaceId,
      keyId: 'mcp_key_activity_test',
      keyLabel: 'Activity attribution key',
    },
  };
}

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

  it('persists an outbox activity exactly once while rebroadcasting a retry', () => {
    const workspaceId = `ws_activity_once_${Date.now()}`;
    const broadcastFn = vi.fn();
    initActivityBroadcast(broadcastFn);
    const input = {
      effectKey: 'accepted:brand-command-1',
      workspaceId,
      type: 'brand_generation_started' as const,
      title: 'Started grounded brand generation',
      metadata: { runId: 'brand-run-1' },
      actor: { id: 'operator-1', name: 'Operator' },
      createdAt: '2026-07-14T12:00:00.000Z',
    };

    const first = addActivityOnce(input);
    const replay = addActivityOnce(input);

    expect(replay).toEqual(first);
    expect(listActivity(workspaceId)).toEqual([first]);
    expect(broadcastFn).toHaveBeenCalledTimes(2);
    expect(() => addActivityOnce({ ...input, title: 'Different binding' }))
      .toThrow(/different activity inputs/i);

    db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(workspaceId);
    initActivityBroadcast(() => {});
  });

  it('broadcasts the complete client-safe entry for a client-visible activity', () => {
    const broadcastFn = vi.fn();
    initActivityBroadcast(broadcastFn);

    const entry = addActivity(
      'ws_broadcast',
      'audit_completed',
      'Audit completed',
      'Reviewed five pages',
      { pages: 5 },
      { id: 'operator-visible-id', name: 'Visible Operator' },
    );

    expect(broadcastFn).toHaveBeenCalledWith('ws_broadcast', WS_EVENTS.ACTIVITY_NEW, entry);

    // Reset broadcast to avoid affecting other tests
    initActivityBroadcast(() => {});
  });

  it('durably merges MCP caller attribution without clobbering existing metadata', () => {
    const workspaceId = `ws_mcp_activity_${Date.now()}`;
    const context = {
      requestId: 'req-activity-attribution',
      toolName: 'update_workspace',
      targetWorkspaceId: workspaceId,
      caller: {
        kind: 'workspace_key' as const,
        scope: workspaceId,
        workspaceId,
        keyId: 'mcp_key_activity_test',
        keyLabel: 'Activity attribution key',
      },
    };

    const entry = runWithMcpToolExecutionContext(context, () => addActivity(
      workspaceId,
      'seo_updated',
      'MCP changed SEO settings',
      undefined,
      { source: 'mcp-chat', updatedFields: ['title'] },
    ));

    expect(entry.metadata).toEqual({
      source: 'mcp-chat',
      updatedFields: ['title'],
      mcpCaller: context,
    });

    context.requestId = 'tampered-request';
    context.caller.keyLabel = 'Tampered label';

    expect(Object.isFrozen(entry.metadata?.mcpCaller)).toBe(true);
    expect(Object.isFrozen(
      (entry.metadata?.mcpCaller as McpToolExecutionContext | undefined)?.caller,
    )).toBe(true);
    expect(listActivity(workspaceId)[0]?.metadata).toEqual({
      source: 'mcp-chat',
      updatedFields: ['title'],
      mcpCaller: {
        requestId: 'req-activity-attribution',
        toolName: 'update_workspace',
        targetWorkspaceId: workspaceId,
        caller: {
          kind: 'workspace_key',
          scope: workspaceId,
          workspaceId,
          keyId: 'mcp_key_activity_test',
          keyLabel: 'Activity attribution key',
        },
      },
    });
  });

  it('strips MCP caller attribution from workspace broadcasts', () => {
    const workspaceId = `ws_mcp_broadcast_${Date.now()}`;
    const broadcastFn = vi.fn();
    initActivityBroadcast(broadcastFn);

    const entry = runWithMcpToolExecutionContext(workspaceMcpContext(workspaceId), () => addActivity(
      workspaceId,
      'seo_updated',
      'MCP changed SEO settings',
      undefined,
      { source: 'mcp-chat' },
    ));

    expect(entry.metadata).toHaveProperty('mcpCaller');
    expect(broadcastFn).toHaveBeenCalledWith(
      workspaceId,
      WS_EVENTS.ACTIVITY_NEW,
      expect.objectContaining({
        id: entry.id,
        metadata: { source: 'mcp-chat' },
      }),
    );
    expect(JSON.stringify(broadcastFn.mock.calls)).not.toContain('mcp_key_activity_test');

    initActivityBroadcast(() => {});
  });

  it.each([
    ['mcp_key_created', 'MCP API key created'],
    ['mcp_key_revoked', 'MCP API key revoked'],
  ] as const)('emits only an opaque invalidation for %s on shared workspace broadcasts', (type, title) => {
    const workspaceId = `ws_mcp_key_broadcast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const broadcastFn = vi.fn();
    initActivityBroadcast(broadcastFn);

    const entry = addActivity(
      workspaceId,
      type,
      `${title}: Private automation label`,
      'Private operator context',
      { keyId: 'mcp_key_private_id', label: 'Private automation label' },
      { id: 'operator-private-id', name: 'Private Operator' },
    );

    expect(entry.metadata).toEqual({
      keyId: 'mcp_key_private_id',
      label: 'Private automation label',
    });
    expect(broadcastFn).toHaveBeenCalledWith(
      workspaceId,
      WS_EVENTS.ACTIVITY_NEW,
      {},
    );
    const stored = listActivity(workspaceId)[0];
    expect(stored).toMatchObject({
      id: entry.id,
      type,
      title: `${title}: Private automation label`,
      description: 'Private operator context',
      metadata: { keyId: 'mcp_key_private_id', label: 'Private automation label' },
      actorId: 'operator-private-id',
      actorName: 'Private Operator',
    });
    expect(JSON.stringify(broadcastFn.mock.calls)).not.toMatch(
      /mcp_key_created|mcp_key_revoked|act_|mcp_key_private_id|Private automation label|Private operator context|Private Operator|operator-private-id/,
    );

    initActivityBroadcast(() => {});
  });

  it('emits only an opaque invalidation for operator-only voice finalization activity', () => {
    const workspaceId = `ws_voice_finalization_broadcast_${Date.now()}`;
    const broadcastFn = vi.fn();
    initActivityBroadcast(broadcastFn);

    const entry = addActivity(
      workspaceId,
      'voice_calibrated',
      'Brand voice finalized by Private Operator',
      'Private finalization rationale',
      {
        finalizationId: 'voice_finalization_private_id',
        authorizationId: 'voice_authorization_private_id',
        operatorEmail: 'private-operator@example.com',
      },
      { id: 'operator-private-id', name: 'Private Operator' },
    );

    expect(broadcastFn).toHaveBeenCalledWith(
      workspaceId,
      WS_EVENTS.ACTIVITY_NEW,
      {},
    );
    expect(JSON.stringify(broadcastFn.mock.calls)).not.toMatch(
      /voice_calibrated|act_|Brand voice finalized|Private finalization rationale|voice_finalization_private_id|voice_authorization_private_id|private-operator@example\.com|Private Operator|operator-private-id/,
    );

    // The full audit record remains durable and available to the admin read path.
    expect(listActivity(workspaceId)[0]).toMatchObject({
      id: entry.id,
      type: 'voice_calibrated',
      title: 'Brand voice finalized by Private Operator',
      description: 'Private finalization rationale',
      metadata: {
        finalizationId: 'voice_finalization_private_id',
        authorizationId: 'voice_authorization_private_id',
        operatorEmail: 'private-operator@example.com',
      },
      actorId: 'operator-private-id',
      actorName: 'Private Operator',
    });

    initActivityBroadcast(() => {});
  });

  it('isolates concurrent MCP execution contexts and snapshots their identity', async () => {
    const firstInput = workspaceMcpContext('ws_mcp_concurrent_a', {
      requestId: 'req-concurrent-a',
      toolName: 'update_workspace',
    });
    const secondInput = workspaceMcpContext('ws_mcp_concurrent_b', {
      requestId: 'req-concurrent-b',
      toolName: 'get_workspace_overview',
    });

    const [first, second] = await Promise.all([
      runWithMcpToolExecutionContext(firstInput, async () => {
        await Promise.resolve();
        return getMcpToolExecutionContext();
      }),
      runWithMcpToolExecutionContext(secondInput, async () => {
        await Promise.resolve();
        return getMcpToolExecutionContext();
      }),
    ]);

    expect(first?.requestId).toBe('req-concurrent-a');
    expect(second?.requestId).toBe('req-concurrent-b');
    expect(first).not.toBe(firstInput);
    expect(first?.caller).not.toBe(firstInput.caller);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.caller)).toBe(true);
    expect(getMcpToolExecutionContext()).toBeUndefined();
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

  it('strips MCP caller attribution while the admin activity read retains it', () => {
    const workspaceId = `ws_client_mcp_privacy_${Date.now()}`;
    const context = workspaceMcpContext(workspaceId);

    runWithMcpToolExecutionContext(context, () => addActivity(
      workspaceId,
      'seo_updated',
      'MCP changed SEO settings',
      undefined,
      { source: 'mcp-chat' },
    ));

    expect(listActivity(workspaceId)[0]?.metadata).toEqual({
      source: 'mcp-chat',
      mcpCaller: context,
    });
    expect(listClientActivity(workspaceId)[0]?.metadata).toEqual({ source: 'mcp-chat' });
    expect(JSON.stringify(listClientActivity(workspaceId))).not.toContain('mcp_key_activity_test');
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
