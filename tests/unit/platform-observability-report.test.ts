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
    expect(p95([100])).toBe(100);
  });

  it('returns the 95th-percentile value for a two-element array', () => {
    expect(p95([10, 20])).toBe(20);
  });

  it('returns the correct index for a 20-element array', () => {
    const arr = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(p95(arr)).toBe(19);
  });

  it('does not depend on input order (uses an internal sort)', () => {
    expect(p95([5, 1, 3, 2, 4])).toBe(5);
  });

  it('does not mutate the original array', () => {
    const arr = [30, 10, 20];
    p95(arr);
    expect(arr).toEqual([30, 10, 20]);
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
    expect(avg([1, 2])).toBe(2);
  });

  it('rounds 1.25 down to 1 for [1, 1, 1, 2]', () => {
    expect(avg([1, 1, 1, 2])).toBe(1);
  });
});

// ── estimateAiCostUsd ──────────────────────────────────────────────────────

describe('estimateAiCostUsd', () => {
  it('uses gpt-5.5 rates for "gpt-5.5-turbo"', () => {
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 500, model: 'gpt-5.5-turbo' });
    expect(result).toBeCloseTo(0.02, 8);
  });

  it('uses gpt-5.4-mini rates (NOT gpt-5.4) for "gpt-5.4-mini"', () => {
    const miniResult = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-5.4-mini' });
    const genericResult = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-5.4' });
    expect(miniResult).toBeCloseTo(0.00525, 8);
    expect(miniResult).not.toBeCloseTo(genericResult, 3);
  });

  it('uses generic gpt-4.1 rates for exact "gpt-4.1"', () => {
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'gpt-4.1' });
    expect(result).toBeCloseTo(0.01, 8);
  });

  it('treats versioned gpt-4.1-mini model names as mini pricing (regression)', () => {
    const result = estimateAiCostUsd({
      promptTokens: 1000,
      completionTokens: 1000,
      model: 'gpt-4.1-mini-2025-04-14',
    });

    expect(result).toBeCloseTo(0.002, 8);
  });

  it('treats versioned gpt-4.1-nano model names as nano pricing (regression)', () => {
    const result = estimateAiCostUsd({
      promptTokens: 1000,
      completionTokens: 1000,
      model: 'gpt-4.1-nano-2025-04-14',
    });

    expect(result).toBeCloseTo(0.0005, 8);
  });

  it('uses the default (gpt-5.4-mini) rates for unknown models', () => {
    const result = estimateAiCostUsd({ promptTokens: 1000, completionTokens: 1000, model: 'unknown-model-123' });
    expect(result).toBeCloseTo(0.00525, 8);
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

  it('shows empty-row placeholders for no data buckets', () => {
    const md = formatWorkspaceObservabilityReportMarkdown(makeEmptyReport());
    expect(md).toContain('| none | - | - | - | - |');
    expect(md).toContain('| none | 0 | 0 | 100 | - | - | - | - |');
    expect(md).toContain('| none | 0 | 0 | 0 | - | - | - |');
    expect(md).toContain('| none | 0 | - | - | - | - |');
  });

  it('escapes pipe characters in route keys and operation messages', () => {
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
    report.operationTraces = [
      {
        source: 'http',
        operation: 'GET /foo|bar',
        status: 'warning',
        timestamp: '2026-05-24T00:00:00.000Z',
        durationMs: 123,
        message: 'downstream|timeout',
      },
    ];

    const md = formatWorkspaceObservabilityReportMarkdown(report);
    expect(md).toContain('GET /api/ws/:id\\|extra');
    expect(md).toContain('GET /foo\\|bar');
    expect(md).toContain('downstream\\|timeout');
  });

  it('ends with a newline', () => {
    const md = formatWorkspaceObservabilityReportMarkdown(makeEmptyReport());
    expect(md.endsWith('\n')).toBe(true);
  });
});
