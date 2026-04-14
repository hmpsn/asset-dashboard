/**
 * Integration tests for the deep-diagnostic job type.
 *
 * Tests:
 * - Validation: missing params → 400
 * - Feature flag gate: not enabled → 403
 * - Insight not found → 404
 * - Success: job + report created, response has jobId + reportId
 *
 * NOTE: Feature flags are toggled via the HTTP admin API (not direct module import)
 * so the server's module-level cache is properly invalidated.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { upsertAnomalyDigestInsight, upsertInsight } from '../../server/analytics-insights-store.js';
import { getReportForInsight } from '../../server/diagnostic-store.js';

const ctx = createTestContext(13261);
const { api, postJson } = ctx;

let testWsId = '';
let anomalyInsightId = '';
let nonAnomalyInsightId = '';

async function setFlag(enabled: boolean | null) {
  await api('/api/admin/feature-flags/deep-diagnostics', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Deep Diagnostic Jobs Test');
  testWsId = ws.id;

  // Create an anomaly digest insight to use in tests
  const insight = upsertAnomalyDigestInsight({
    workspaceId: testWsId,
    anomalyType: 'traffic_drop',
    metric: 'clicks',
    data: {
      anomalyType: 'traffic_drop',
      metric: 'clicks',
      severity: 'critical',
      currentValue: 100,
      expectedValue: 500,
      deviationPercent: -80,
      firstDetected: new Date().toISOString(),
      durationDays: 7,
    },
    severity: 'critical',
    domain: 'seo',
    impactScore: 85,
  });
  anomalyInsightId = insight.id;

  // Create a non-anomaly insight (ranking_opportunity) to test type validation
  const nonAnomaly = upsertInsight({
    workspaceId: testWsId,
    pageId: '/blog/test',
    insightType: 'ranking_opportunity',
    data: { query: 'test query', currentPosition: 8, impressions: 500, estimatedTrafficGain: 100, pageUrl: '/blog/test' },
    severity: 'opportunity',
    domain: 'search',
  });
  nonAnomalyInsightId = nonAnomaly.id;
}, 25_000);

afterAll(async () => {
  await setFlag(null); // restore default
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

describe('deep-diagnostic job — validation', () => {
  it('GET /api/feature-flags shows deep-diagnostics key', async () => {
    const res = await api('/api/feature-flags');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect('deep-diagnostics' in body).toBe(true);
  });

  it('POST /api/jobs with deep-diagnostic but missing params returns 400', async () => {
    const res = await postJson('/api/jobs', { type: 'deep-diagnostic', params: {} });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('workspaceId and insightId required');
  });

  it('POST /api/jobs with deep-diagnostic when feature disabled returns 403', async () => {
    await setFlag(false);
    const res = await postJson('/api/jobs', {
      type: 'deep-diagnostic',
      params: { workspaceId: testWsId, insightId: anomalyInsightId },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Deep diagnostics feature not enabled');
  });

  it('POST /api/jobs with deep-diagnostic and unknown insightId returns 404', async () => {
    await setFlag(true);
    const res = await postJson('/api/jobs', {
      type: 'deep-diagnostic',
      params: { workspaceId: testWsId, insightId: 'ins_nonexistent' },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Anomaly insight not found');
  });

  it('POST /api/jobs with deep-diagnostic and non-anomaly insightId returns 400', async () => {
    await setFlag(true);
    const res = await postJson('/api/jobs', {
      type: 'deep-diagnostic',
      params: { workspaceId: testWsId, insightId: nonAnomalyInsightId },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Insight must be of type anomaly_digest');
  });
});

describe('deep-diagnostic job — success', () => {
  it('POST /api/jobs with valid deep-diagnostic params creates job and report row', async () => {
    await setFlag(true);

    const res = await postJson('/api/jobs', {
      type: 'deep-diagnostic',
      params: { workspaceId: testWsId, insightId: anomalyInsightId },
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.jobId).toBeDefined();
    expect(body.reportId).toBeDefined();
    expect(typeof body.jobId).toBe('string');
    expect(typeof body.reportId).toBe('string');

    // Verify a diagnostic report row was created in the store
    const report = getReportForInsight(testWsId, anomalyInsightId);
    expect(report).not.toBeNull();
    expect(report!.id).toBe(body.reportId);
    expect(report!.workspaceId).toBe(testWsId);
    expect(['running', 'pending', 'completed', 'failed']).toContain(report!.status);

    // Wait for the background runDiagnostic to reach a terminal state so its DB
    // writes complete before other test files run — prevents concurrent-write
    // interference with parallel integration tests.
    for (let i = 0; i < 50; i++) {
      const r = getReportForInsight(testWsId, anomalyInsightId);
      if (r?.status === 'completed' || r?.status === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, 10_000); // extend timeout to allow runDiagnostic to finish
});

describe('deep-diagnostic job — cross-workspace isolation', () => {
  it('POST /api/jobs with insightId from workspace A using workspace B ID returns 404', async () => {
    await setFlag(true);
    // anomalyInsightId belongs to testWsId — sending it with a different workspaceId must 404
    const secondWs = createWorkspace('Cross-Workspace Isolation Test');
    try {
      const res = await postJson('/api/jobs', {
        type: 'deep-diagnostic',
        params: { workspaceId: secondWs.id, insightId: anomalyInsightId },
      });
      expect(res.status).toBe(404);
    } finally {
      deleteWorkspace(secondWs.id);
    }
  });
});
