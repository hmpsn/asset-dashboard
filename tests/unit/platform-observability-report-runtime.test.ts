import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockGetExternalApiTelemetry: vi.fn(),
  mockGetOperationTraces: vi.fn(),
  mockGetSlowRouteTelemetry: vi.fn(),
  mockGetTokenUsage: vi.fn(),
}));

vi.mock('../../server/db/index.js', () => ({
  default: { prepare: h.mockPrepare },
}));

vi.mock('../../server/platform-observability.js', () => ({
  getExternalApiTelemetry: h.mockGetExternalApiTelemetry,
  getOperationTraces: h.mockGetOperationTraces,
  getSlowRouteTelemetry: h.mockGetSlowRouteTelemetry,
}));

vi.mock('../../server/openai-helpers.js', () => ({
  getTokenUsage: h.mockGetTokenUsage,
}));

import { buildWorkspaceObservabilityReport } from '../../server/platform-observability-report.js';

describe('buildWorkspaceObservabilityReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const lastSuccessByType: Record<string, string> = {
      'seo-audit': '2026-05-20T10:00:00.000Z',
      'keyword-strategy': '2026-05-21T10:00:00.000Z',
      'schema-generator': '2026-05-22T10:00:00.000Z',
      'page-analysis': '2026-05-23T10:00:00.000Z',
    };

    h.mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes("status IN ('error', 'cancelled')")) {
        return {
          all: vi.fn(() => [
            {
              id: 'job-1',
              type: 'seo-audit',
              status: 'error',
              created_at: '2026-05-24T10:00:00.000Z',
              updated_at: '2026-05-24T10:02:00.000Z',
              error: 'timeout',
              message: null,
            },
            {
              id: 'job-2',
              type: 'schema-generator',
              status: 'cancelled',
              created_at: '2026-05-24T11:00:00.000Z',
              updated_at: '2026-05-24T11:01:00.000Z',
              error: null,
              message: 'user cancelled',
            },
          ]),
        };
      }

      if (sql.includes('AND type = ?')) {
        return {
          get: vi.fn((_workspaceId: string, type: string) => {
            const updated_at = lastSuccessByType[type];
            return updated_at ? { updated_at } : undefined;
          }),
        };
      }

      if (sql.includes('FROM audit_schedules')) {
        return {
          get: vi.fn(() => ({ last_run_at: '2026-05-24T07:00:00.000Z' })),
        };
      }

      if (sql.includes('FROM workspace_metrics_snapshots')) {
        return {
          get: vi.fn(() => ({ computed_at: Date.parse('2026-05-24T08:30:00.000Z') })),
        };
      }

      return {
        all: vi.fn(() => []),
        get: vi.fn(() => undefined),
      };
    });

    h.mockGetExternalApiTelemetry.mockReturnValue([
      { provider: 'semrush', endpoint: '/v1/a', status: 'success', timestamp: '2026-05-23T00:00:00.000Z', durationMs: 120, workspaceId: 'ws-1' },
      { provider: 'semrush', endpoint: '/v1/b', status: 'error', timestamp: '2026-05-23T01:00:00.000Z', durationMs: 300, workspaceId: 'ws-1' },
      { provider: 'dataforseo', endpoint: '/v3/x', status: 'success', timestamp: '2026-05-23T02:00:00.000Z', durationMs: 90, workspaceId: 'ws-1' },
    ]);

    h.mockGetOperationTraces.mockReturnValue(Array.from({ length: 95 }, (_, i) => ({
      source: 'http',
      operation: `GET /api/r/${i}`,
      status: i % 2 === 0 ? 'success' : 'warning',
      timestamp: new Date(Date.parse('2026-05-24T00:00:00.000Z') + i * 1000).toISOString(),
      workspaceId: 'ws-1',
      durationMs: 50 + i,
      message: i % 3 === 0 ? 'ok' : undefined,
    })));

    h.mockGetSlowRouteTelemetry.mockReturnValue([
      { method: 'GET', path: '/api/alpha', statusCode: 200, durationMs: 100, timestamp: '2026-05-23T00:00:00.000Z', workspaceId: 'ws-1' },
      { method: 'GET', path: '/api/alpha', statusCode: 200, durationMs: 400, timestamp: '2026-05-23T01:00:00.000Z', workspaceId: 'ws-1' },
      { method: 'POST', path: '/api/beta', statusCode: 500, durationMs: 250, timestamp: '2026-05-23T02:00:00.000Z', workspaceId: 'ws-1' },
    ]);

    h.mockGetTokenUsage.mockReturnValue({
      entries: [
        {
          feature: 'content-brief',
          model: 'gpt-5.4-mini',
          promptTokens: 1000,
          completionTokens: 700,
          totalTokens: 1700,
          durationMs: 1500,
          timestamp: '2026-05-24T00:00:00.000Z',
        },
        {
          feature: 'content-brief',
          model: 'gpt-5.4-mini',
          promptTokens: 500,
          completionTokens: 300,
          totalTokens: 800,
          durationMs: 1000,
          timestamp: '2026-05-24T00:02:00.000Z',
        },
        {
          feature: 'schema-generator',
          model: 'gpt-5.4',
          promptTokens: 800,
          completionTokens: 400,
          totalTokens: 1200,
          durationMs: 1900,
          timestamp: '2026-05-24T00:03:00.000Z',
        },
      ],
      totalTokens: 3700,
      estimatedCost: 0,
    });
  });

  it('builds aggregate observability report with grouped failure, API, AI, and route metrics', () => {
    const report = buildWorkspaceObservabilityReport('ws-1', {
      since: '2026-05-20T00:00:00.000Z',
      days: 10,
    });

    expect(report.workspaceId).toBe('ws-1');
    expect(report.window.since).toBe('2026-05-20T00:00:00.000Z');
    expect(report.window.days).toBe(10);

    expect(report.failedJobs).toHaveLength(2);
    expect(report.failedJobs[0]?.durationMs).toBe(120000);
    expect(report.failedJobs[1]?.status).toBe('cancelled');

    const semrush = report.externalApiFailureRates.find(r => r.provider === 'semrush');
    expect(semrush).toBeDefined();
    expect(semrush?.totalCalls).toBe(2);
    expect(semrush?.failedCalls).toBe(1);
    expect(semrush?.successRatePct).toBe(50);
    expect(semrush?.avgLatencyMs).toBe(210);
    expect(semrush?.p95LatencyMs).toBe(300);

    expect(report.aiByFeature).toHaveLength(2);
    expect(report.aiByFeature[0]?.feature).toBe('schema-generator');
    expect(report.aiByFeature[0]?.calls).toBe(1);
    expect(report.aiByFeature[1]?.feature).toBe('content-brief');
    expect(report.aiByFeature[1]?.calls).toBe(2);

    expect(report.slowRoutes).toHaveLength(2);
    const alpha = report.slowRoutes.find(r => r.routeKey === 'GET /api/alpha');
    expect(alpha?.calls).toBe(2);
    expect(alpha?.avgDurationMs).toBe(250);
    expect(alpha?.p95DurationMs).toBe(400);
    expect(alpha?.worstDurationMs).toBe(400);

    expect(report.operationTraces).toHaveLength(80);
    expect(report.operationTraces[0]?.operation).toBe('GET /api/r/94');

    const dataforseoSync = report.criticalSyncs.find(s => s.key === 'dataforseo');
    expect(dataforseoSync?.detail).toBe('0/1 failures in window');
    const metricsSync = report.criticalSyncs.find(s => s.key === 'metrics-snapshot');
    expect(metricsSync?.lastSuccessAt).toBe('2026-05-24T08:30:00.000Z');
  });

  it('uses default window when since is omitted and handles sparse/no telemetry fallbacks', () => {
    h.mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes("status IN ('error', 'cancelled')")) {
        return { all: vi.fn(() => []) };
      }
      if (sql.includes('AND type = ?')) {
        return { get: vi.fn(() => undefined) };
      }
      if (sql.includes('FROM audit_schedules')) {
        return { get: vi.fn(() => ({ last_run_at: null })) };
      }
      if (sql.includes('FROM workspace_metrics_snapshots')) {
        return { get: vi.fn(() => ({ computed_at: Number.NaN })) };
      }
      return { all: vi.fn(() => []), get: vi.fn(() => undefined) };
    });

    h.mockGetExternalApiTelemetry.mockReturnValue([]);
    h.mockGetOperationTraces.mockReturnValue([]);
    h.mockGetSlowRouteTelemetry.mockReturnValue([]);
    h.mockGetTokenUsage.mockReturnValue({ entries: [], totalTokens: 0, estimatedCost: 0 });

    const report = buildWorkspaceObservabilityReport('ws-2');

    expect(report.window.days).toBe(14);
    expect(typeof report.window.since).toBe('string');
    expect(report.window.since).not.toHaveLength(0);

    expect(report.failedJobs).toEqual([]);
    expect(report.externalApiFailureRates).toEqual([]);
    expect(report.aiByFeature).toEqual([]);
    expect(report.slowRoutes).toEqual([]);
    expect(report.operationTraces).toEqual([]);

    const dataforseoSync = report.criticalSyncs.find(s => s.key === 'dataforseo');
    expect(dataforseoSync?.detail).toBe('No telemetry in selected window');

    const metricsSync = report.criticalSyncs.find(s => s.key === 'metrics-snapshot');
    expect(metricsSync?.lastSuccessAt).toBeNull();
  });
});
