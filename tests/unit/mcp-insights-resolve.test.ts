/**
 * DB-backed tests for the resolve_insight / bulk_resolve_insights MCP tools
 * (MCP audit P0 — close the stateless analytics loop).
 *
 * Exercises the real resolveInsight store path against a seeded SQLite workspace
 * while spying on the side-effect modules (activity, broadcast, and the shared
 * outcome-tracking helper) to assert the data-flow contract:
 *   - resolve → status persisted (+ resolved_at + resolution_source='mcp-chat'),
 *     outcome helper called (resolved only), activity + broadcast fired
 *   - in_progress → status persisted, NO outcome recorded, activity + broadcast still fire
 *   - bulk → per-id resolve, one activity + one broadcast, not-found ids reported
 *   - missing / cross-workspace id → "not found", no write, no side effects
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

const h = vi.hoisted(() => ({
  addActivity: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  recordInsightResolutionOutcome: vi.fn(),
}));
vi.mock('../../server/activity-log.js', () => ({ addActivity: h.addActivity }));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: h.broadcastToWorkspace }));
vi.mock('../../server/outcome-tracking.js', () => ({ recordInsightResolutionOutcome: h.recordInsightResolutionOutcome }));
vi.mock('../../server/ws-events.js', () => ({ WS_EVENTS: { INSIGHT_RESOLVED: 'insight:resolved' } }));

import { handleInsightTool } from '../../server/mcp/tools/insights.js';
import { upsertInsight, getInsightById } from '../../server/analytics-insights-store.js';
import { seedWorkspace, seedTwoWorkspaces } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

const pageHealthData = { score: 60, trend: 'declining' as const, signals: [] };

function makeInsight(workspaceId: string, pageId: string): string {
  return upsertInsight({
    workspaceId,
    pageId,
    insightType: 'page_health',
    data: pageHealthData,
    severity: 'warning',
  }).id;
}

function rawResolution(id: string): { resolution_status: string | null; resolved_at: string | null; resolution_source: string | null } | undefined {
  return db
    .prepare('SELECT resolution_status, resolved_at, resolution_source FROM analytics_insights WHERE id = ?')
    .get(id) as { resolution_status: string | null; resolved_at: string | null; resolution_source: string | null } | undefined;
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? 'null');
}

describe('resolve_insight / bulk_resolve_insights MCP tools', () => {
  let ws: SeededFullWorkspace;
  beforeEach(() => {
    vi.clearAllMocks();
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
  });
  afterEach(() => { ws?.cleanup(); });

  it('resolves an insight: persists status + source, records outcome, fires activity + broadcast', async () => {
    const id = makeInsight(ws.workspaceId, '/a');

    const result = await handleInsightTool('resolve_insight', {
      workspaceId: ws.workspaceId,
      insightId: id,
      status: 'resolved',
      note: 'handled it',
    });

    expect(result.isError).toBeFalsy();
    expect(parse(result)).toMatchObject({ id, resolutionStatus: 'resolved' });

    const row = rawResolution(id);
    expect(row?.resolution_status).toBe('resolved');
    expect(row?.resolved_at).toBeTruthy();
    expect(row?.resolution_source).toBe('mcp-chat');

    expect(h.recordInsightResolutionOutcome).toHaveBeenCalledTimes(1);
    expect(h.recordInsightResolutionOutcome).toHaveBeenCalledWith(ws.workspaceId, expect.objectContaining({ id }));
    expect(h.addActivity).toHaveBeenCalledWith(
      ws.workspaceId, 'insight_resolved', expect.stringContaining('resolved'), undefined,
      expect.objectContaining({ source: 'mcp-chat', insightId: id }),
    );
    expect(h.broadcastToWorkspace).toHaveBeenCalledWith(ws.workspaceId, 'insight:resolved', { insightId: id, status: 'resolved' });
  });

  it('in_progress persists status but records NO outcome (resolved-only)', async () => {
    const id = makeInsight(ws.workspaceId, '/b');

    const result = await handleInsightTool('resolve_insight', {
      workspaceId: ws.workspaceId, insightId: id, status: 'in_progress',
    });

    expect(result.isError).toBeFalsy();
    expect(getInsightById(id, ws.workspaceId)?.resolutionStatus).toBe('in_progress');
    expect(h.recordInsightResolutionOutcome).not.toHaveBeenCalled();
    // activity + broadcast still fire (work-in-progress is a meaningful state change)
    expect(h.addActivity).toHaveBeenCalledTimes(1);
    expect(h.broadcastToWorkspace).toHaveBeenCalledTimes(1);
  });

  it('returns not found for an unknown insight id (no side effects)', async () => {
    const result = await handleInsightTool('resolve_insight', {
      workspaceId: ws.workspaceId, insightId: 'ins_missing', status: 'resolved',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
    expect(h.addActivity).not.toHaveBeenCalled();
    expect(h.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(h.recordInsightResolutionOutcome).not.toHaveBeenCalled();
  });

  it('isolates across workspaces: cannot resolve workspace A insight via workspace B', () => {
    const { wsA, wsB, cleanup } = seedTwoWorkspaces();
    try {
      const id = makeInsight(wsA.workspaceId, '/a');
      return handleInsightTool('resolve_insight', {
        workspaceId: wsB.workspaceId, insightId: id, status: 'resolved',
      }).then(result => {
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('not found');
        expect(rawResolution(id)?.resolution_status).toBeNull();
        expect(h.broadcastToWorkspace).not.toHaveBeenCalled();
      });
    } finally {
      cleanup();
    }
  });

  it('bulk-resolves multiple insights and reports not-found ids, with one activity + broadcast', async () => {
    const id1 = makeInsight(ws.workspaceId, '/p1');
    const id2 = makeInsight(ws.workspaceId, '/p2');

    const result = await handleInsightTool('bulk_resolve_insights', {
      workspaceId: ws.workspaceId,
      insightIds: [id1, id2, 'ins_missing'],
      status: 'resolved',
    });

    expect(result.isError).toBeFalsy();
    const payload = parse(result);
    expect(payload.updatedCount).toBe(2);
    expect(payload.updated).toEqual(expect.arrayContaining([id1, id2]));
    expect(payload.notFound).toEqual(['ins_missing']);

    expect(rawResolution(id1)?.resolution_status).toBe('resolved');
    expect(rawResolution(id2)?.resolution_status).toBe('resolved');
    expect(h.recordInsightResolutionOutcome).toHaveBeenCalledTimes(2);
    // A single batched activity + broadcast, not one per item.
    expect(h.addActivity).toHaveBeenCalledTimes(1);
    expect(h.broadcastToWorkspace).toHaveBeenCalledTimes(1);
    expect(h.broadcastToWorkspace).toHaveBeenCalledWith(ws.workspaceId, 'insight:resolved', { insightIds: [id1, id2], status: 'resolved' });
  });

  it('bulk in_progress updates statuses with one activity/broadcast and records NO outcomes', async () => {
    const id1 = makeInsight(ws.workspaceId, '/q1');
    const id2 = makeInsight(ws.workspaceId, '/q2');

    const result = await handleInsightTool('bulk_resolve_insights', {
      workspaceId: ws.workspaceId,
      insightIds: [id1, id2],
      status: 'in_progress',
    });

    expect(result.isError).toBeFalsy();
    expect(parse(result).updatedCount).toBe(2);
    expect(rawResolution(id1)?.resolution_status).toBe('in_progress');
    expect(rawResolution(id2)?.resolution_status).toBe('in_progress');
    // in_progress is not a resolution → no outcome baselines recorded
    expect(h.recordInsightResolutionOutcome).not.toHaveBeenCalled();
    // still a single batched activity + broadcast for the status change
    expect(h.addActivity).toHaveBeenCalledTimes(1);
    expect(h.broadcastToWorkspace).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid args (missing insightId)', async () => {
    const result = await handleInsightTool('resolve_insight', { workspaceId: ws.workspaceId, status: 'resolved' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Validation failed');
  });

  // R3-PR2: the resolution_status transition guard must never crash a bulk batch.
  it('bulk payload carries a `rejected` field for skip-and-report and stays empty for idempotent re-resolve', async () => {
    const id1 = makeInsight(ws.workspaceId, '/r1');
    // First resolve id1.
    await handleInsightTool('bulk_resolve_insights', { workspaceId: ws.workspaceId, insightIds: [id1], status: 'resolved' });
    vi.clearAllMocks();
    // Re-resolving an already-resolved insight in a batch is an idempotent no-op
    // (resolved → resolved is handled at the call site) — it must NOT throw and must
    // NOT land in `rejected` (that field is reserved for genuine InvalidTransitionError).
    const id2 = makeInsight(ws.workspaceId, '/r2');
    const result = await handleInsightTool('bulk_resolve_insights', {
      workspaceId: ws.workspaceId, insightIds: [id1, id2, 'ins_missing'], status: 'resolved',
    });
    expect(result.isError).toBeFalsy();
    const payload = parse(result);
    expect(payload.updated).toEqual(expect.arrayContaining([id1, id2]));
    expect(payload.notFound).toEqual(['ins_missing']);
    expect(payload.rejected).toEqual([]); // idempotent re-resolve is NOT a rejection
  });
});
