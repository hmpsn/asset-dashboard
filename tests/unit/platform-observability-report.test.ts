/**
 * Unit tests for pure functions in server/platform-observability-report.ts
 * Goal: bug-finding coverage for p95, avg, estimateAiCostUsd, and
 * formatWorkspaceObservabilityReportMarkdown.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/db/index.js', () => ({
  default: { prepare: vi.fn(() => ({ all: vi.fn(() => []), get: vi.fn(() => undefined) })) },
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../server/platform-observability.js', () => ({
  getOperationTraces: vi.fn(() => []),
  getExternalApiTelemetry: vi.fn(() => []),
  getSlowRouteTelemetry: vi.fn(() => []),
}));

vi.mock('../../server/openai-helpers.js', () => ({
  getTokenUsage: vi.fn(() => ({ entries: [], totalTokens: 0, estimatedCost: 0 })),
}));

import {
  p95,
  avg,
  estimateAiCostUsd,
  formatWorkspaceObservabilityReportMarkdown,
} from '../../server/platform-observability-report.js';
import type { WorkspaceObservabilityReport } from '../../shared/types/platform-observability.js';

// ── helpers ────────────────────────────────────────────────────────────────

function makeEmptyReport(workspaceId = 'ws-1'): WorkspaceObservabilityReport {
  return {
    generatedBy: 'server/platform-observability-report.ts',
    generatedAt: '2026-05-24T00:00:00.000Z',
    workspaceId,
    window: {
      since: '2026-05-17T00:00:00.000Z',
      until: '2026-05-24T00:00:00.000Z',
      days: 7,
    },
    failedJobs: [],
    operationTraces: [],
    externalApiFailureRates: [],
    aiByFeature: [],
    slowRoutes: [],
    criticalSyncs: [],
  };
}

// ── p95 ────────────────────────────────────────────────────────────────────

describe('p95', () => {
  it('returns null for an empty array', () => {
    expect(p95([])).toBeNull();
  });

  it('returns the single value for a one-element array', () => {
    // ceil(1 * 0.95) = ceil(0.95) = 1, idx = 1-1 = 0 → sorted[0] = 100
    expect(p95([100])).toBe(100);
  });

  it('returns the 95th-percentile value for a two-element array', () => {
    // ceil(2 * 0.95) = ceil(1.9) = 2, idx = 2-1 = 1 → sorted[1] = 20
    expect(p95([10, 20])).toBe(20);
  });

  it('returns the correct index for a 20-element array', () => {
    // sorted = [1, 2, ..., 20], ceil(20 * 0.95) = ceil(19) = 19, idx = 18 → value = 19
    const arr = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(p95(arr)).toBe(19);
  });

  it('does not depend on input order (uses an internal sort)', () => {
    // sorted = [1,2,3,4,5], ceil(5*0.95) = ceil(4.75) = 5, idx = 4 → value = 5
    expect(p95([5, 1, 3, 2, 4])).toBe(5);
  });

  it('does not mutate the original array', () => {
    const arr = [30, 10, 20];
    p95(arr);
    expect(arr).toEqual([30, 10, 20]);
  });

  it('handles near-constant distribution: p95 of [1,1,1,1,2] returns 2', () => {
    // sorted = [1,1,1,1,2], ceil(5*0.95) = 5, idx = 4 → value = 2
    expect(p95([1, 1, 1, 1, 2])).toBe(2);
  });

  it('never returns a value greater than the max in the array', () => {
    const values = [5, 3, 8, 2, 7];
    const result = p95(values);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThanOrEqual(Math.max(...values));
  });
});

// ── avg ────────────────────────────────────────────────────────────────────

describe('avg', () => {
  it('returns null for an empty array', () => {
    expect(avg([])).toBeNull();
  });

  it('returns the single value unchanged', () => {
    expect(avg([100])).toBe(100);
  });

  it('returns the integer mean for [1, 3]', () => {
    expect(avg([1, 3])).toBe(2);
  });

  it('rounds 1.5 up to 2 (Math.round behaviour for [1, 2])', () => {
    // (1+2)/2 = 1.5 → Math.round(1.5) = 2
    expect(avg([1, 2])).toBe(2);
  });

  it('rounds 1.25 down to 1 for [1, 1, 1, 2]', () => {
    // (1+1+1+2)/4 = 1.25 → Math.round(1.25) = 1
    expect(avg([1, 1, 1, 2])).toBe(1);
  });

  it('handles zero correctly', () => {
    expect(avg([0])).toBe(0);
  });

  it('returns the exact mean for [1000, 2000, 3000]', () => {
    expect(avg([1000, 2000, 3000])).toBe(2000);
  });
});

// ── estimateAiCostUsd ──────────────────────────────────────────────────────

describe('estimateAiCostUsd', () => {
  it('uses gpt-5.5 rates for "gpt-5.5-turbo"', () => {
    // 1000 * 0.000005 + 500 * 0.00003 = 0.005 + 0.015 = 0.02
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 500, model: 'gpt-5.5-turbo' });
    expect(result).toBeCloseTo(0.02, 8);
  });

  it('uses gpt-5.4-nano rates (NOT gpt-5.4) for "gpt-5.4-nano"', () => {
    const nanoResult = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-5.4-nano' });
    const genericResult = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-5.4' });
    // nano: 1000*0.0000002 + 1000*0.00000125 = 0.0002 + 0.00125 = 0.00145
    // generic 5.4: 1000*0.0000025 + 1000*0.000015 = 0.0025 + 0.015 = 0.0175
    expect(nanoResult).toBeCloseTo(0.00145, 8);
    expect(nanoResult).not.toBeCloseTo(genericResult, 3);
  });

  it('uses gpt-5.4-mini rates (NOT gpt-5.4) for "gpt-5.4-mini"', () => {
    const miniResult = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-5.4-mini' });
    const genericResult = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-5.4' });
    // mini: 1000*0.00000075 + 1000*0.0000045 = 0.00075 + 0.0045 = 0.00525
    expect(miniResult).toBeCloseTo(0.00525, 8);
    expect(miniResult).not.toBeCloseTo(genericResult, 3);
  });

  it('uses generic gpt-5.4 rates for "gpt-5.4"', () => {
    // 1000*0.0000025 + 1000*0.000015 = 0.0025 + 0.015 = 0.0175
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-5.4' });
    expect(result).toBeCloseTo(0.0175, 8);
  });

  it('uses gpt-4.1-nano exact-match rates (NOT gpt-4.1 startsWith) for "gpt-4.1-nano"', () => {
    const nanoResult = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-4.1-nano' });
    const genericResult = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-4.1' });
    // nano: 1000*0.0000001 + 1000*0.0000004 = 0.0001 + 0.0004 = 0.0005
    expect(nanoResult).toBeCloseTo(0.0005, 8);
    expect(nanoResult).not.toBeCloseTo(genericResult, 3);
  });

  it('uses gpt-4.1-mini exact-match rates (NOT gpt-4.1 startsWith) for "gpt-4.1-mini"', () => {
    const miniResult = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-4.1-mini' });
    const genericResult = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-4.1' });
    // mini: 1000*0.0000004 + 1000*0.0000016 = 0.0004 + 0.0016 = 0.002
    expect(miniResult).toBeCloseTo(0.002, 8);
    expect(miniResult).not.toBeCloseTo(genericResult, 3);
  });

  it('uses generic gpt-4.1 rates for exact "gpt-4.1"', () => {
    // 1000*0.000002 + 1000*0.000008 = 0.002 + 0.008 = 0.01
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-4.1' });
    expect(result).toBeCloseTo(0.01, 8);
  });

  it('uses generic gpt-4.1 rates for "gpt-4.1-turbo" (startsWith gpt-4.1, NOT nano/mini exact)', () => {
    // 1000*0.000002 + 1000*0.000008 = 0.01
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-4.1-turbo' });
    expect(result).toBeCloseTo(0.01, 8);
  });

  it('uses claude-sonnet-4 rates for "claude-sonnet-4-6"', () => {
    // 1000*0.000003 + 1000*0.000015 = 0.003 + 0.015 = 0.018
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'claude-sonnet-4-6' });
    expect(result).toBeCloseTo(0.018, 8);
  });

  it('uses claude-haiku-4-5 rates for "claude-haiku-4-5-20251001"', () => {
    // 1000*0.000001 + 1000*0.000005 = 0.001 + 0.005 = 0.006
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'claude-haiku-4-5-20251001' });
    expect(result).toBeCloseTo(0.006, 8);
  });

  it('uses claude-3-5-sonnet rates for "claude-3-5-sonnet-20241022"', () => {
    // 1000*0.000003 + 1000*0.000015 = 0.018
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'claude-3-5-sonnet-20241022' });
    expect(result).toBeCloseTo(0.018, 8);
  });

  it('uses claude-3-5-haiku rates for "claude-3-5-haiku-20241022"', () => {
    // 1000*0.0000008 + 1000*0.000004 = 0.0008 + 0.004 = 0.0048
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'claude-3-5-haiku-20241022' });
    expect(result).toBeCloseTo(0.0048, 8);
  });

  it('uses the default (gpt-5.4-mini) rates for unknown models', () => {
    // 1000*0.00000075 + 1000*0.0000045 = 0.00075 + 0.0045 = 0.00525
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'unknown-model-123' });
    expect(result).toBeCloseTo(0.00525, 8);
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateAiCostUsd({ promptTokens: 0, completionTokens: 0, model: 'gpt-5.5-turbo' })).toBe(0);
  });

  // ── ordering bug guards ──────────────────────────────────────────────────

  it('gpt-5.4-mini does NOT match the gpt-5.4 branch (ordering guard)', () => {
    const mini54 = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 0, model: 'gpt-5.4-mini' });
    const gen54 = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 0, model: 'gpt-5.4' });
    // mini prompt rate: 0.00000075 ≠ generic 5.4 prompt rate: 0.0000025
    expect(mini54).toBeCloseTo(1000 * 0.00000075, 12);
    expect(gen54).toBeCloseTo(1000 * 0.0000025, 12);
    expect(mini54).not.toBeCloseTo(gen54, 5);
  });

  it('gpt-4.1-nano exact match does NOT match gpt-4.1 startsWith branch (ordering guard)', () => {
    const nano = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 0, model: 'gpt-4.1-nano' });
    const gen = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 0, model: 'gpt-4.1' });
    // nano prompt rate: 0.0000001 ≠ generic 4.1 prompt rate: 0.000002
    expect(nano).toBeCloseTo(1000 * 0.0000001, 12);
    expect(gen).toBeCloseTo(1000 * 0.000002, 12);
    expect(nano).not.toBeCloseTo(gen, 5);
  });
});

// ── formatWorkspaceObservabilityReportMarkdown ─────────────────────────────

describe('formatWorkspaceObservabilityReportMarkdown', () => {
  it('contains the main h1 header', () => {
    const md = formatWorkspaceObservabilityReportMarkdown(makeEmptyReport());
    expect(md).toContain('# Workspace Observability Report');
  });

  it('contains the workspaceId', () => {
    const md = formatWorkspaceObservabilityReportMarkdown(makeEmptyReport('ws-abc-123'));
    expect(md).toContain('ws-abc-123');
  });

  it('shows empty-row placeholder for failedJobs when none exist', () => {
    const md = formatWorkspaceObservabilityReportMarkdown(makeEmptyReport());
    expect(md).toContain('| none | - | - | - | - |');
  });

  it('shows empty-row placeholder for externalApiFailureRates when none exist', () => {
    const md = formatWorkspaceObservabilityReportMarkdown(makeEmptyReport());
    expect(md).toContain('| none | 0 | 0 | 100 | - | - | - | - |');
  });

  it('shows empty-row placeholder for aiByFeature when none exist', () => {
    const md = formatWorkspaceObservabilityReportMarkdown(makeEmptyReport());
    expect(md).toContain('| none | 0 | 0 | 0 | - | - | - |');
  });

  it('shows empty-row placeholder for slowRoutes when none exist', () => {
    const md = formatWorkspaceObservabilityReportMarkdown(makeEmptyReport());
    expect(md).toContain('| none | 0 | - | - | - | - |');
  });

  it('includes a failed job type in the output when failedJobs is non-empty', () => {
    const report = makeEmptyReport();
    report.failedJobs = [
      {
        id: 'job-1',
        type: 'keyword-strategy',
        status: 'error',
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:05:00.000Z',
        durationMs: 300000,
      },
    ];
    const md = formatWorkspaceObservabilityReportMarkdown(report);
    expect(md).toContain('keyword-strategy');
  });

  it('escapes pipe characters in route keys', () => {
    const report = makeEmptyReport();
    report.slowRoutes = [
      {
        routeKey: 'GET /api/ws/:id|extra',
        calls: 1,
        avgDurationMs: 500,
        p95DurationMs: 800,
        worstDurationMs: 1000,
        lastSeenAt: '2026-05-24T00:00:00.000Z',
      },
    ];
    const md = formatWorkspaceObservabilityReportMarkdown(report);
    expect(md).toContain('\\|');
  });

  it('ends with a newline', () => {
    const md = formatWorkspaceObservabilityReportMarkdown(makeEmptyReport());
    expect(md.endsWith('\n')).toBe(true);
  });
});
