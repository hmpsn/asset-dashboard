/**
 * Integration tests for outcomes GET endpoints (read paths).
 *
 * Tests all GET routes from server/routes/outcomes.ts using a fresh workspace
 * (no recorded actions) to verify shape, defaults, and 404 guard behavior.
 *
 * flows and interactions with recorded data.
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';
const UNKNOWN = 'ws_outcomes_unknown_99';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Outcomes Read WS 13632').id;
}, 60_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ── Overview (multi-workspace, no workspace param) ─────────────────────────────

describe('GET /api/outcomes/overview', () => {
  it('returns 200 with an array', async () => {
    const res = await api('/api/outcomes/overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('each overview entry has expected shape', async () => {
    const res = await api('/api/outcomes/overview');
    const body = await res.json();
    // Our workspace was just created; it must appear in the overview
    const entry = body.find((e: { workspaceId: string }) => e.workspaceId === wsId);
    expect(entry).toBeDefined();
    expect(typeof entry.workspaceName).toBe('string');
    expect(typeof entry.winRate).toBe('number');
    expect(typeof entry.activeActions).toBe('number');
    expect(typeof entry.scoredLast30d).toBe('number');
    expect(typeof entry.attentionNeeded).toBe('boolean');
    // trend must be one of the valid LearningsTrend values
    expect(['improving', 'stable', 'declining']).toContain(entry.trend);
    // fresh workspace — topWin should be null
    expect(entry.topWin).toBeNull();
  });

  it('fresh workspace overview has zero win rate and no attention reason', async () => {
    const res = await api('/api/outcomes/overview');
    const body = await res.json();
    const entry = body.find((e: { workspaceId: string }) => e.workspaceId === wsId);
    expect(entry).toBeDefined();
    expect(entry.winRate).toBe(0);
    expect(entry.activeActions).toBe(0);
    expect(entry.scoredLast30d).toBe(0);
    expect(entry.attentionNeeded).toBe(false);
    expect(entry.attentionReason).toBeUndefined();
  });
});

// ── Scorecard ─────────────────────────────────────────────────────────────────

describe('GET /api/outcomes/:workspaceId/scorecard', () => {
  it('returns 200 with scorecard object', async () => {
    const res = await api(`/api/outcomes/${wsId}/scorecard`);
    expect(res.status).toBe(200);
    const sc = await res.json();
    expect(typeof sc).toBe('object');
    expect(sc).not.toBeNull();
  });

  it('fresh workspace scorecard has all expected fields', async () => {
    const res = await api(`/api/outcomes/${wsId}/scorecard`);
    const sc = await res.json();
    expect(typeof sc.overallWinRate).toBe('number');
    expect(typeof sc.strongWinRate).toBe('number');
    expect(typeof sc.totalTracked).toBe('number');
    expect(typeof sc.totalScored).toBe('number');
    expect(typeof sc.pendingMeasurement).toBe('number');
    expect(Array.isArray(sc.byCategory)).toBe(true);
    expect(['improving', 'stable', 'declining']).toContain(sc.trend);
  });

  it('fresh workspace scorecard shows zero counts', async () => {
    const res = await api(`/api/outcomes/${wsId}/scorecard`);
    const sc = await res.json();
    expect(sc.overallWinRate).toBe(0);
    expect(sc.strongWinRate).toBe(0);
    expect(sc.totalTracked).toBe(0);
    expect(sc.totalScored).toBe(0);
    expect(sc.pendingMeasurement).toBe(0);
    expect(sc.byCategory).toHaveLength(0);
    expect(sc.trend).toBe('stable');
  });

  it('unknown workspaceId returns 200 with zero totals (workspace access passes through in admin mode)', async () => {
    const res = await api(`/api/outcomes/${UNKNOWN}/scorecard`);
    expect(res.status).toBe(200);
    const sc = await res.json();
    // No actions for unknown workspace — all zeros
    expect(sc.totalTracked).toBe(0);
    expect(sc.overallWinRate).toBe(0);
  });
});

// ── Top Wins ──────────────────────────────────────────────────────────────────

describe('GET /api/outcomes/:workspaceId/top-wins', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/outcomes/${wsId}/top-wins`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('fresh workspace top-wins returns empty array', async () => {
    const res = await api(`/api/outcomes/${wsId}/top-wins`);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it('unknown workspaceId returns 200 with empty array (admin mode passthrough)', async () => {
    const res = await api(`/api/outcomes/${UNKNOWN}/top-wins`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

// ── Timeline ─────────────────────────────────────────────────────────────────

describe('GET /api/outcomes/:workspaceId/timeline', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/outcomes/${wsId}/timeline`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('fresh workspace timeline returns empty array', async () => {
    const res = await api(`/api/outcomes/${wsId}/timeline`);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it('unknown workspaceId returns 200 with empty array (admin mode passthrough)', async () => {
    const res = await api(`/api/outcomes/${UNKNOWN}/timeline`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

// ── Learnings ─────────────────────────────────────────────────────────────────

describe('GET /api/outcomes/:workspaceId/learnings', () => {
  it('returns 200', async () => {
    const res = await api(`/api/outcomes/${wsId}/learnings`);
    expect(res.status).toBe(200);
  });

  it('fresh workspace learnings returns null (no scored outcomes)', async () => {
    const res = await api(`/api/outcomes/${wsId}/learnings`);
    const body = await res.json();
    // No scored outcomes → learnings is null
    expect(body).toBeNull();
  });

  it('unknown workspaceId returns 200 with null (admin mode passthrough)', async () => {
    const res = await api(`/api/outcomes/${UNKNOWN}/learnings`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

// ── Actions list ──────────────────────────────────────────────────────────────

describe('GET /api/outcomes/:workspaceId/actions', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/outcomes/${wsId}/actions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('fresh workspace actions list is empty', async () => {
    const res = await api(`/api/outcomes/${wsId}/actions`);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it('unknown workspaceId returns 200 with empty array (admin mode passthrough)', async () => {
    const res = await api(`/api/outcomes/${UNKNOWN}/actions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

// ── Playbooks ─────────────────────────────────────────────────────────────────

describe('GET /api/outcomes/:workspaceId/playbooks', () => {
  it('returns 200 with an array', async () => {
    const res = await api(`/api/outcomes/${wsId}/playbooks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('fresh workspace playbooks list is empty', async () => {
    const res = await api(`/api/outcomes/${wsId}/playbooks`);
    const body = await res.json();
    expect(body).toHaveLength(0);
  });

  it('unknown workspaceId returns 200 with empty array (admin mode passthrough)', async () => {
    const res = await api(`/api/outcomes/${UNKNOWN}/playbooks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});

// ── Diagnostics ───────────────────────────────────────────────────────────────

describe('GET /api/outcomes/:workspaceId/diagnostics', () => {
  it('returns 200 with an object', async () => {
    const res = await api(`/api/outcomes/${wsId}/diagnostics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });

  it('diagnostics has expected top-level fields', async () => {
    const res = await api(`/api/outcomes/${wsId}/diagnostics`);
    const diag = await res.json();
    expect(diag.workspaceId).toBe(wsId);
    expect(typeof diag.featureEnabled).toBe('boolean');
    expect(diag.featureEnabled).toBe(true);
    expect(diag.tableCounts).toBeDefined();
    expect(diag.scoreCounts).toBeDefined();
    expect(diag.anomalies).toBeDefined();
    expect(diag.anomalySummary).toBeDefined();
  });

  it('fresh workspace diagnostics shows zero table counts', async () => {
    const res = await api(`/api/outcomes/${wsId}/diagnostics`);
    const diag = await res.json();
    expect(diag.tableCounts.trackedActions).toBe(0);
    expect(diag.tableCounts.scored).toBe(0);
    expect(diag.tableCounts.pending).toBe(0);
    expect(diag.tableCounts.playbooks).toBe(0);
    expect(diag.tableCounts.learnings).toBe(0);
  });

  it('fresh workspace diagnostics shows empty anomaly arrays', async () => {
    const res = await api(`/api/outcomes/${wsId}/diagnostics`);
    const diag = await res.json();
    expect(Array.isArray(diag.anomalies.emptyBaselines)).toBe(true);
    expect(Array.isArray(diag.anomalies.relativeUrls)).toBe(true);
    expect(Array.isArray(diag.anomalies.overdueScoring)).toBe(true);
    expect(Array.isArray(diag.anomalies.orphanedOutcomes)).toBe(true);
    expect(diag.anomalies.emptyBaselines).toHaveLength(0);
    expect(diag.anomalies.relativeUrls).toHaveLength(0);
    expect(diag.anomalies.overdueScoring).toHaveLength(0);
    expect(diag.anomalies.orphanedOutcomes).toHaveLength(0);
    // All anomaly summary counts should be 0
    expect(diag.anomalySummary.emptyBaselines).toBe(0);
    expect(diag.anomalySummary.relativeUrls).toBe(0);
    expect(diag.anomalySummary.overdueScoring).toBe(0);
    expect(diag.anomalySummary.orphanedOutcomes).toBe(0);
  });

  it('unknown workspaceId returns 200 with zero counts (admin mode passthrough)', async () => {
    const res = await api(`/api/outcomes/${UNKNOWN}/diagnostics`);
    expect(res.status).toBe(200);
    const diag = await res.json();
    expect(diag.workspaceId).toBe(UNKNOWN);
    expect(diag.tableCounts.trackedActions).toBe(0);
  });
});
