/**
 * Integration tests for the insights queue, resolve, diagnostics, llms-txt freshness,
 * and competitor-schema endpoints.
 *
 * Covers:
 *  - GET /api/insights/:workspaceId/queue — empty workspace, seeded insights, workspace isolation
 *  - PUT /api/insights/:workspaceId/:insightId/resolve — transitions, validation, broadcast, 404
 *  - GET /api/workspaces/:workspaceId/diagnostics — feature-flag gate, empty workspace
 *  - GET /api/workspaces/:workspaceId/diagnostics/by-insight/:insightId — returns null gracefully
 *  - GET /api/workspaces/:workspaceId/diagnostics/:reportId — 404 for unknown, isolation
 *  - GET /api/llms-txt/:workspaceId/freshness — returns 200 with lastGeneratedAt field
 *  - GET /api/competitor-schema/:workspaceId — returns 200 with competitors/comparisons arrays
 *
 * Uses the inline vi.mock + dynamic-import server pattern (port 0, dynamic).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

// ─── Broadcast mock ───────────────────────────────────────────────────────────
// Must be vi.hoisted so the state object is initialised before the mock factory.

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({ sendEmail: vi.fn() }));

// ─── Imports (after mock registration) ───────────────────────────────────────

import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';
import { upsertInsight } from '../../server/analytics-insights-store.js';
import { completeDiagnosticReport, createDiagnosticReport } from '../../server/diagnostic-store.js';
import db from '../../server/db/index.js';
import { signClientSession } from '../../server/middleware.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type { ClientDiagnosticSummary, DiagnosticContext, DiagnosticReport } from '../../shared/types/diagnostics.js';

// ─── Server bootstrap ─────────────────────────────────────────────────────────

let baseUrl = '';
let server: http.Server | undefined;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

function clientApi(path: string, workspaceId: string): Promise<Response> {
  return api(path, {
    headers: {
      Cookie: `client_session_${workspaceId}=${signClientSession(workspaceId)}`,
    },
  });
}

function putJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Workspace IDs ────────────────────────────────────────────────────────────

let wsId = '';
let otherWsId = '';

const diagnosticContext: DiagnosticContext = {
  anomaly: {
    type: 'traffic_drop',
    severity: 'critical',
    metric: 'clicks',
    currentValue: 100,
    expectedValue: 500,
    deviationPercent: -80,
    firstDetected: '2026-06-01T00:00:00.000Z',
  },
  positionHistory: [],
  queryBreakdown: [],
  redirectProbe: { chain: [], finalStatus: 200, canonical: null, isSoftFourOhFour: false },
  internalLinks: { count: 4, siteMedian: 8, topLinkingPages: ['/'], deficit: 4 },
  backlinks: { totalBacklinks: 10, referringDomains: 3, topDomains: [], recentlyLost: 0 },
  siteBaselines: { avgInternalLinks: 8, medianPosition: 12, totalBacklinks: 10 },
  recentActivity: [],
  concurrentAnomalies: [],
  existingInsights: [],
  periodComparison: {
    current: { clicks: 100, impressions: 1000, ctr: 10, position: 8 },
    previous: { clicks: 500, impressions: 2000, ctr: 25, position: 4 },
    changePercent: { clicks: -80, impressions: -50, ctr: -60, position: 100 },
  },
  unavailableSources: [],
};

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Insights Queue Diagnostics Test');
  wsId = ws.id;
  const other = createWorkspace('Insights Queue Isolation Other');
  otherWsId = other.id;

}, 25_000);

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  // Clean up insights for both workspaces
  db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(otherWsId);
  // Clean up diagnostic reports
  db.prepare('DELETE FROM diagnostic_reports WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM diagnostic_reports WHERE workspace_id = ?').run(otherWsId);
  deleteWorkspace(wsId);
  deleteWorkspace(otherWsId);
  await stopTestServer();
});

// ─── Seed helper ──────────────────────────────────────────────────────────────

function seedCriticalInsight(workspaceId: string): AnalyticsInsight {
  return upsertInsight({
    workspaceId,
    pageId: `/test-page-${Date.now()}`,
    insightType: 'page_health',
    data: {
      score: 30,
      trend: 'declining',
      clicks: 50,
      impressions: 1000,
      position: 18,
      ctr: 0.05,
      pageviews: 120,
      bounceRate: 0.72,
      avgEngagementTime: 25,
    },
    severity: 'critical',
    impactScore: 75,
    domain: 'search',
  });
}

function seedWarningInsight(workspaceId: string): AnalyticsInsight {
  return upsertInsight({
    workspaceId,
    pageId: `/warning-page-${Date.now()}`,
    insightType: 'ranking_opportunity',
    data: {
      query: 'test keyword',
      currentPosition: 12,
      impressions: 5000,
      estimatedTrafficGain: 300,
      pageUrl: '/test-page',
    },
    severity: 'warning',
    impactScore: 60,
    domain: 'search',
  });
}

// ─── Insights Queue: GET ──────────────────────────────────────────────────────

describe('GET /api/insights/:workspaceId/queue', () => {
  it('returns 200 with empty items array for a fresh workspace', async () => {
    const fresh = createWorkspace('Insights Queue Fresh');
    try {
      const res = await api(`/api/insights/${fresh.id}/queue`);
      expect(res.status).toBe(200);
      const body = await res.json() as { items: AnalyticsInsight[] };
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items).toHaveLength(0);
    } finally {
      deleteWorkspace(fresh.id);
    }
  });

  it('returns 200 with seeded critical insights in the queue', async () => {
    const insight = seedCriticalInsight(wsId);
    const res = await api(`/api/insights/${wsId}/queue`);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: AnalyticsInsight[] };
    expect(Array.isArray(body.items)).toBe(true);
    const found = body.items.find(i => i.id === insight.id);
    expect(found).toBeDefined();
  });

  it('returns only unresolved insights (critical + warning severity only)', async () => {
    // Seed a positive-severity insight — it should NOT appear in the queue
    upsertInsight({
      workspaceId: wsId,
      pageId: '/positive-page',
      insightType: 'page_health',
      data: {
        score: 90,
        trend: 'improving',
        clicks: 500,
        impressions: 8000,
        position: 3,
        ctr: 0.08,
        pageviews: 600,
        bounceRate: 0.3,
        avgEngagementTime: 90,
      },
      severity: 'positive',
      impactScore: 20,
      domain: 'cross',
    });

    const res = await api(`/api/insights/${wsId}/queue`);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: AnalyticsInsight[] };
    // All returned insights must be critical or warning
    for (const item of body.items) {
      expect(['critical', 'warning']).toContain(item.severity);
    }
  });

  it('returns insights with expected fields (id, workspaceId, insightType, severity)', async () => {
    const insight = seedWarningInsight(wsId);
    const res = await api(`/api/insights/${wsId}/queue`);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: AnalyticsInsight[] };
    const found = body.items.find(i => i.id === insight.id);
    expect(found).toBeDefined();
    expect(found).toMatchObject({
      id: insight.id,
      workspaceId: wsId,
      insightType: 'ranking_opportunity',
      severity: 'warning',
    });
  });

  it('does not return insights from another workspace', async () => {
    const otherInsight = seedCriticalInsight(otherWsId);
    const res = await api(`/api/insights/${wsId}/queue`);
    expect(res.status).toBe(200);
    const body = await res.json() as { items: AnalyticsInsight[] };
    const leaked = body.items.find(i => i.id === otherInsight.id);
    expect(leaked).toBeUndefined();
  });
});

// ─── Insights Resolve: PUT ────────────────────────────────────────────────────

describe('PUT /api/insights/:workspaceId/:insightId/resolve', () => {
  it('marks insight as in_progress and returns updated insight', async () => {
    const insight = seedCriticalInsight(wsId);
    const res = await putJson(`/api/insights/${wsId}/${insight.id}/resolve`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AnalyticsInsight;
    expect(body.id).toBe(insight.id);
    expect(body.resolutionStatus).toBe('in_progress');
  });

  it('marks insight as resolved and returns updated insight', async () => {
    const insight = seedCriticalInsight(wsId);
    const res = await putJson(`/api/insights/${wsId}/${insight.id}/resolve`, {
      status: 'resolved',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AnalyticsInsight;
    expect(body.resolutionStatus).toBe('resolved');
    expect(body.resolvedAt).toBeTruthy();
  });

  it('accepts an optional note with the resolve status', async () => {
    const insight = seedCriticalInsight(wsId);
    const res = await putJson(`/api/insights/${wsId}/${insight.id}/resolve`, {
      status: 'resolved',
      note: 'Fixed the meta description',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as AnalyticsInsight;
    expect(body.resolutionNote).toBe('Fixed the meta description');
  });

  it('broadcasts INSIGHT_RESOLVED with insightId and status after resolution', async () => {
    const insight = seedCriticalInsight(wsId);
    broadcastState.calls = [];

    const res = await putJson(`/api/insights/${wsId}/${insight.id}/resolve`, {
      status: 'resolved',
    });
    expect(res.status).toBe(200);

    const resolvedBroadcasts = broadcastState.calls.filter(
      c => c.event === WS_EVENTS.INSIGHT_RESOLVED,
    );
    expect(resolvedBroadcasts).toHaveLength(1);
    expect(resolvedBroadcasts[0]).toMatchObject({
      workspaceId: wsId,
      event: WS_EVENTS.INSIGHT_RESOLVED,
      payload: { insightId: insight.id, status: 'resolved' },
    });
  });

  it('returns 400 for an invalid status value', async () => {
    const insight = seedCriticalInsight(wsId);
    const res = await putJson(`/api/insights/${wsId}/${insight.id}/resolve`, {
      status: 'bogus_status',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown insightId', async () => {
    const res = await putJson(`/api/insights/${wsId}/ins_does_not_exist_xyz/resolve`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Insight not found');
  });

  it('returns 404 when resolving an insight from another workspace', async () => {
    const otherInsight = seedCriticalInsight(otherWsId);
    // Attempt resolution using wsId (not the owning workspace)
    const res = await putJson(`/api/insights/${wsId}/${otherInsight.id}/resolve`, {
      status: 'resolved',
    });
    expect(res.status).toBe(404);
  });

  it('resolved insight no longer appears in the unresolved queue', async () => {
    const insight = seedCriticalInsight(wsId);

    // Verify it appears in queue before resolve
    const before = await api(`/api/insights/${wsId}/queue`);
    const beforeBody = await before.json() as { items: AnalyticsInsight[] };
    expect(beforeBody.items.find(i => i.id === insight.id)).toBeDefined();

    // Resolve it
    await putJson(`/api/insights/${wsId}/${insight.id}/resolve`, { status: 'resolved' });

    // Should no longer appear in queue
    const after = await api(`/api/insights/${wsId}/queue`);
    const afterBody = await after.json() as { items: AnalyticsInsight[] };
    expect(afterBody.items.find(i => i.id === insight.id)).toBeUndefined();
  });
});

// ─── Diagnostics: list ────────────────────────────────────────────────────────

describe('GET /api/workspaces/:workspaceId/diagnostics', () => {
  it('returns 200 with empty reports array for a fresh workspace', async () => {
    const fresh = createWorkspace('Diagnostics Fresh WS');
    try {
      const res = await api(`/api/workspaces/${fresh.id}/diagnostics`);
      expect(res.status).toBe(200);
      const body = await res.json() as { reports: DiagnosticReport[] };
      expect(Array.isArray(body.reports)).toBe(true);
      expect(body.reports).toHaveLength(0);
    } finally {
      db.prepare('DELETE FROM diagnostic_reports WHERE workspace_id = ?').run(fresh.id);
      deleteWorkspace(fresh.id);
    }
  });

  it('returns 200 with seeded diagnostic report', async () => {
    const insight = seedCriticalInsight(wsId);
    const report = createDiagnosticReport(wsId, insight.id, 'traffic_drop', ['/affected-page']);

    const res = await api(`/api/workspaces/${wsId}/diagnostics`);
    expect(res.status).toBe(200);
    const body = await res.json() as { reports: DiagnosticReport[] };
    expect(Array.isArray(body.reports)).toBe(true);
    const found = body.reports.find(r => r.id === report.id);
    expect(found).toBeDefined();
    expect(found?.workspaceId).toBe(wsId);
  });

  it('reports have expected fields (id, workspaceId, status, anomalyType)', async () => {
    const insight = seedWarningInsight(wsId);
    const report = createDiagnosticReport(wsId, insight.id, 'ranking_drop', ['/page-a', '/page-b']);

    const res = await api(`/api/workspaces/${wsId}/diagnostics`);
    expect(res.status).toBe(200);
    const body = await res.json() as { reports: DiagnosticReport[] };
    const found = body.reports.find(r => r.id === report.id);
    expect(found).toMatchObject({
      id: report.id,
      workspaceId: wsId,
      status: 'running',
      anomalyType: 'ranking_drop',
    });
  });

  it('does not return reports from another workspace', async () => {
    const otherInsight = seedCriticalInsight(otherWsId);
    const otherReport = createDiagnosticReport(otherWsId, otherInsight.id, 'traffic_spike', []);

    const res = await api(`/api/workspaces/${wsId}/diagnostics`);
    expect(res.status).toBe(200);
    const body = await res.json() as { reports: DiagnosticReport[] };
    const leaked = body.reports.find(r => r.id === otherReport.id);
    expect(leaked).toBeUndefined();
  });
});

// ─── Client diagnostics: safe projection ─────────────────────────────────────

describe('GET /api/public/diagnostics/:workspaceId', () => {
  it('returns only completed client-safe diagnostic summaries', async () => {
    const insight = seedCriticalInsight(wsId);
    const completed = createDiagnosticReport(wsId, insight.id, 'traffic_drop', ['/pricing']);
    completeDiagnosticReport(completed.id, {
      diagnosticContext,
      rootCauses: [
        { rank: 1, title: 'Ranking loss', confidence: 'high', explanation: 'Admin detail', evidence: ['raw GSC evidence'] },
      ],
      remediationActions: [
        { priority: 'P1', title: 'Refresh pricing page', description: 'Admin detail', effort: 'medium', impact: 'high', owner: 'content', pageUrls: ['/pricing'] },
      ],
      adminReport: 'Admin-only markdown',
      clientSummary: 'Traffic dropped because the pricing page lost visibility.',
    });

    const running = createDiagnosticReport(wsId, insight.id, 'ranking_drop', ['/blog']);
    const otherInsight = seedCriticalInsight(otherWsId);
    const otherReport = createDiagnosticReport(otherWsId, otherInsight.id, 'traffic_drop', ['/other']);
    completeDiagnosticReport(otherReport.id, {
      diagnosticContext,
      rootCauses: [{ rank: 1, title: 'Other workspace cause', confidence: 'high', explanation: 'No leak', evidence: ['secret'] }],
      remediationActions: [{ priority: 'P1', title: 'Other workspace action', description: 'No leak', effort: 'low', impact: 'high', owner: 'seo' }],
      adminReport: 'Other admin report',
      clientSummary: 'Other workspace summary',
    });

    const res = await clientApi(`/api/public/diagnostics/${wsId}`, wsId);
    expect(res.status).toBe(200);
    const body = await res.json() as { reports: ClientDiagnosticSummary[] };

    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]).toMatchObject({
      id: completed.id,
      anomalyType: 'traffic_drop',
      affectedPages: ['/pricing'],
      clientSummary: 'Traffic dropped because the pricing page lost visibility.',
      rootCauses: [{ rank: 1, title: 'Ranking loss', confidence: 'high' }],
      remediationActions: [{ priority: 'P1', title: 'Refresh pricing page' }],
    });
    expect(body.reports.find(report => report.id === running.id)).toBeUndefined();
    expect(body.reports.find(report => report.id === otherReport.id)).toBeUndefined();
    expect(body.reports[0]).not.toHaveProperty('adminReport');
    expect(body.reports[0]).not.toHaveProperty('diagnosticContext');
    expect(body.reports[0].rootCauses[0]).not.toHaveProperty('evidence');
    expect(body.reports[0].rootCauses[0]).not.toHaveProperty('explanation');
  });

  it('returns an empty list when no completed client summaries exist', async () => {
    const fresh = createWorkspace('Client Diagnostics Empty WS');
    try {
      const insight = seedCriticalInsight(fresh.id);
      createDiagnosticReport(fresh.id, insight.id, 'traffic_drop', ['/pending']);

      const res = await clientApi(`/api/public/diagnostics/${fresh.id}`, fresh.id);
      expect(res.status).toBe(200);
      const body = await res.json() as { reports: ClientDiagnosticSummary[] };
      expect(body.reports).toEqual([]);
    } finally {
      db.prepare('DELETE FROM diagnostic_reports WHERE workspace_id = ?').run(fresh.id);
      db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(fresh.id);
      deleteWorkspace(fresh.id);
    }
  });

  it('requires a valid client portal session for the requested workspace', async () => {
    const unauthenticated = await api(`/api/public/diagnostics/${wsId}`);
    expect(unauthenticated.status).toBe(401);

    const wrongWorkspaceSession = await clientApi(`/api/public/diagnostics/${wsId}`, otherWsId);
    expect(wrongWorkspaceSession.status).toBe(401);
  });

  it('returns 403 when the client portal is disabled', async () => {
    const disabled = createWorkspace('Client Diagnostics Disabled Portal WS');
    updateWorkspace(disabled.id, { clientPortalEnabled: false });

    try {
      const res = await clientApi(`/api/public/diagnostics/${disabled.id}`, disabled.id);
      expect(res.status).toBe(403);
    } finally {
      db.prepare('DELETE FROM diagnostic_reports WHERE workspace_id = ?').run(disabled.id);
      db.prepare('DELETE FROM analytics_insights WHERE workspace_id = ?').run(disabled.id);
      deleteWorkspace(disabled.id);
    }
  });
});

// ─── Diagnostics: by-insight ──────────────────────────────────────────────────

describe('GET /api/workspaces/:workspaceId/diagnostics/by-insight/:insightId', () => {
  it('returns 200 with report: null when no report exists for the insight', async () => {
    const insight = seedWarningInsight(wsId);
    const res = await api(`/api/workspaces/${wsId}/diagnostics/by-insight/${insight.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { report: DiagnosticReport | null };
    // No report seeded for this particular insight
    expect(body).toHaveProperty('report');
  });

  it('returns 200 with the matching report when one exists', async () => {
    const insight = seedCriticalInsight(wsId);
    const report = createDiagnosticReport(wsId, insight.id, 'ctr_collapse', ['/landing']);

    const res = await api(`/api/workspaces/${wsId}/diagnostics/by-insight/${insight.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { report: DiagnosticReport | null };
    expect(body.report).not.toBeNull();
    expect(body.report?.id).toBe(report.id);
    expect(body.report?.insightId).toBe(insight.id);
  });
});

// ─── Diagnostics: by-reportId ─────────────────────────────────────────────────

describe('GET /api/workspaces/:workspaceId/diagnostics/:reportId', () => {
  it('returns 404 for an unknown report ID', async () => {
    const res = await api(`/api/workspaces/${wsId}/diagnostics/report_does_not_exist`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Report not found');
  });

  it('returns 200 with the full report when it belongs to this workspace', async () => {
    const insight = seedCriticalInsight(wsId);
    const report = createDiagnosticReport(wsId, insight.id, 'index_coverage_drop', ['/about']);

    const res = await api(`/api/workspaces/${wsId}/diagnostics/${report.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { report: DiagnosticReport };
    expect(body.report.id).toBe(report.id);
    expect(body.report.workspaceId).toBe(wsId);
  });

  it('returns 404 when the report belongs to another workspace (isolation)', async () => {
    const otherInsight = seedCriticalInsight(otherWsId);
    const otherReport = createDiagnosticReport(otherWsId, otherInsight.id, 'traffic_drop', []);

    // Try to fetch it using wsId
    const res = await api(`/api/workspaces/${wsId}/diagnostics/${otherReport.id}`);
    expect(res.status).toBe(404);
  });
});

// ─── LLMs.txt: freshness ─────────────────────────────────────────────────────

describe('GET /api/llms-txt/:workspaceId/freshness', () => {
  it('returns 200 with a lastGeneratedAt field (null when never generated)', async () => {
    const fresh = createWorkspace('LLMs Txt Freshness Test');
    try {
      const res = await api(`/api/llms-txt/${fresh.id}/freshness`);
      expect(res.status).toBe(200);
      const body = await res.json() as { lastGeneratedAt: string | null };
      expect(body).toHaveProperty('lastGeneratedAt');
      // Fresh workspace: null (never generated)
      expect(body.lastGeneratedAt).toBeNull();
    } finally {
      deleteWorkspace(fresh.id);
    }
  });

  it('returns 200 for the main workspace with correct shape', async () => {
    const res = await api(`/api/llms-txt/${wsId}/freshness`);
    expect(res.status).toBe(200);
    const body = await res.json() as { lastGeneratedAt: string | null };
    expect(body).toHaveProperty('lastGeneratedAt');
  });

  it('does not 500 when workspace has no Webflow configuration', async () => {
    // wsId was created without webflowSiteId — freshness should still work
    const res = await api(`/api/llms-txt/${wsId}/freshness`);
    expect([200]).toContain(res.status);
  });
});

// ─── Competitor Schema ────────────────────────────────────────────────────────

describe('GET /api/competitor-schema/:workspaceId', () => {
  it('returns 200 with competitors and comparisons arrays for workspace with no competitor domains', async () => {
    // wsId has no competitorDomains set — should return empty arrays
    const res = await api(`/api/competitor-schema/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { competitors: unknown[]; comparisons: unknown[] };
    expect(Array.isArray(body.competitors)).toBe(true);
    expect(Array.isArray(body.comparisons)).toBe(true);
    expect(body.competitors).toHaveLength(0);
    expect(body.comparisons).toHaveLength(0);
  });

  it('returns 404 when workspace does not exist', async () => {
    const res = await api('/api/competitor-schema/ws_does_not_exist_xyz');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Workspace not found');
  });

  it('does not 500 for a fresh workspace with no data', async () => {
    const fresh = createWorkspace('Competitor Schema Fresh');
    try {
      const res = await api(`/api/competitor-schema/${fresh.id}`);
      expect([200]).toContain(res.status);
    } finally {
      deleteWorkspace(fresh.id);
    }
  });
});
