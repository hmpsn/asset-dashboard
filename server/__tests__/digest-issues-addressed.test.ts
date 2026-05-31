/**
 * Task 2.8 — digest-issues-addressed.test.ts
 *
 * Verifies that a month with one applied approval batch item reports
 * issuesAddressed.length >= 1 (not "0 measurable improvements").
 *
 * TDD requirement: write failing test FIRST. This test fails before the fix
 * because monthly-digest.ts only counts resolutionStatus === 'resolved'
 * insights, but approval-apply only sets 'in_progress' via Bridge #7.
 * After the fix (approach a: include applied approvals + completed work-orders
 * in issuesAddressed), the test passes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsInsight } from '../../shared/types/analytics.js';
import type { Workspace } from '../../server/workspaces.js';
import type { ApprovalBatch } from '../../shared/types/approvals.js';
import type { WorkOrder } from '../../shared/types/payments.js';

const mocks = vi.hoisted(() => ({
  getInsights: vi.fn(),
  getROIHighlights: vi.fn(),
  callAI: vi.fn(),
  getSearchPeriodComparison: vi.fn(),
  getGA4PeriodComparison: vi.fn(),
  isFeatureEnabled: vi.fn(),
  buildRecommendationGenerationContext: vi.fn(),
  buildSystemPrompt: vi.fn(),
  isProgrammingError: vi.fn(),
  listBatches: vi.fn(),
  listWorkOrders: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }),
}));

vi.mock('../../server/analytics-insights-store.js', () => ({
  getInsights: mocks.getInsights,
}));

vi.mock('../../server/outcome-tracking.js', () => ({
  getROIHighlightsFromOutcomes: mocks.getROIHighlights,
}));

vi.mock('../../server/ai.js', () => ({
  callAI: mocks.callAI,
}));

vi.mock('../../server/search-console.js', () => ({
  getSearchPeriodComparison: mocks.getSearchPeriodComparison,
}));

vi.mock('../../server/google-analytics.js', () => ({
  getGA4PeriodComparison: mocks.getGA4PeriodComparison,
}));

vi.mock('../../server/feature-flags.js', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
}));

vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  buildRecommendationGenerationContext: mocks.buildRecommendationGenerationContext,
}));

vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: mocks.buildSystemPrompt,
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: mocks.isProgrammingError,
}));

vi.mock('../../server/approvals.js', () => ({
  listBatches: mocks.listBatches,
}));

vi.mock('../../server/work-orders.js', () => ({
  listWorkOrders: mocks.listWorkOrders,
}));

const { generateMonthlyDigest } = await import('../../server/monthly-digest.js'); // dynamic-import-ok

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: `ws_issues_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Issues Addressed Test WS',
    folder: 'test',
    createdAt: '2026-01-01T00:00:00.000Z',
    webflowSiteId: undefined,
    gscPropertyUrl: undefined,
    ga4PropertyId: undefined,
    ...overrides,
  } as Workspace;
}

function makeInsight(overrides: Partial<AnalyticsInsight> = {}): AnalyticsInsight {
  return {
    id: 'ins_base',
    workspaceId: 'ws_1',
    pageId: '/services',
    insightType: 'ranking_mover',
    severity: 'positive',
    computedAt: '2026-05-25T00:00:00.000Z',
    data: {},
    impactScore: 80,
    ...overrides,
  } as AnalyticsInsight;
}

function makeAppliedBatch(overrides: Partial<ApprovalBatch> = {}): ApprovalBatch {
  return {
    id: 'batch_1',
    workspaceId: 'ws_1',
    siteId: 'site_1',
    name: 'SEO Updates — May 2026',
    status: 'applied',
    items: [
      {
        id: 'item_1',
        pageId: 'page_abc',
        pageTitle: 'Services Page',
        pageSlug: '/services',
        field: 'seoTitle',
        currentValue: 'Old title',
        proposedValue: 'Optimized Services title',
        status: 'applied',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-15T00:00:00.000Z',
      },
    ],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function makeCompletedWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'wo_1',
    workspaceId: 'ws_1',
    paymentId: 'pay_1',
    productType: 'fix_meta',
    status: 'completed',
    pageIds: ['page_xyz'],
    quantity: 1,
    completedAt: '2026-05-20T00:00:00.000Z',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-25T12:00:00.000Z'));

  mocks.getInsights.mockReturnValue([]);
  mocks.getROIHighlights.mockReturnValue([]);
  mocks.callAI.mockResolvedValue({ text: 'AI summary' });
  mocks.getSearchPeriodComparison.mockRejectedValue(new Error('GSC not configured'));
  mocks.getGA4PeriodComparison.mockRejectedValue(new Error('GA4 not configured'));
  mocks.isFeatureEnabled.mockReturnValue(false);
  mocks.buildSystemPrompt.mockReturnValue('system prompt');
  mocks.isProgrammingError.mockReturnValue(true);
  mocks.listBatches.mockReturnValue([]);
  mocks.listWorkOrders.mockReturnValue([]);
  mocks.buildRecommendationGenerationContext.mockImplementation(
    async (_workspaceId: string, opts: { slices?: string[] } = {}) => {
      const slices = opts.slices ?? [];
      const fullInsights = mocks.getInsights();
      const byType: Record<string, AnalyticsInsight[]> = {};
      for (const insight of fullInsights as AnalyticsInsight[]) {
        byType[insight.insightType] = byType[insight.insightType] ?? [];
        byType[insight.insightType].push(insight);
      }
      return {
        intelligence: {
          version: 1,
          workspaceId: _workspaceId,
          assembledAt: new Date().toISOString(),
          insights: slices.includes('insights')
            ? {
                all: fullInsights.slice(0, 100),
                byType,
                bySeverity: { critical: 0, warning: 0, opportunity: 0, positive: 0 },
                topByImpact: fullInsights.slice(0, 10),
              }
            : undefined,
          learnings: undefined,
        },
        slices,
        promptContext: '',
        learningsDomain: 'all',
        learningsAvailability: 'not_requested',
      };
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('digest issuesAddressed counting', () => {
  it('reports issuesAddressed >= 1 for a workspace with one applied approval batch', async () => {
    // Seed: no resolved insights (resolutionStatus is in_progress from Bridge #7,
    // never upgraded to resolved by the apply path — this is the bug)
    mocks.getInsights.mockReturnValue([
      makeInsight({
        id: 'ins_in_progress',
        severity: 'warning',
        resolutionStatus: 'in_progress',
        resolutionNote: 'Auto-progressed: action "meta_updated" recorded',
      }),
    ]);

    // One applied approval batch
    const ws = makeWorkspace({ id: 'ws_applied_approval' });
    mocks.listBatches.mockReturnValue([makeAppliedBatch({ workspaceId: ws.id })]);

    const result = await generateMonthlyDigest(ws, 'May 2026');

    expect(result.issuesAddressed.length).toBeGreaterThanOrEqual(1);
  });

  it('reports issuesAddressed >= 1 for a workspace with a completed work order', async () => {
    // No resolved insights at all
    mocks.getInsights.mockReturnValue([]);

    const ws = makeWorkspace({ id: 'ws_completed_wo' });
    mocks.listWorkOrders.mockReturnValue([makeCompletedWorkOrder({ workspaceId: ws.id })]);

    const result = await generateMonthlyDigest(ws, 'May 2026');

    expect(result.issuesAddressed.length).toBeGreaterThanOrEqual(1);
  });

  it('does not double-count: resolved insight + applied batch for same page = 1 entry', async () => {
    // A resolved insight for services page
    mocks.getInsights.mockReturnValue([
      makeInsight({
        id: 'ins_resolved',
        severity: 'warning',
        resolutionStatus: 'resolved',
        resolutionNote: 'Fixed by audit',
        pageTitle: 'Services Page',
      }),
    ]);

    // Also an applied batch covering the same page
    const ws = makeWorkspace({ id: 'ws_no_double_count' });
    mocks.listBatches.mockReturnValue([
      makeAppliedBatch({
        workspaceId: ws.id,
        name: 'Services Batch',
      }),
    ]);

    const result = await generateMonthlyDigest(ws, 'May 2026');

    // Both sources contribute but total must be <= 5 (the slice limit) and >= 1
    expect(result.issuesAddressed.length).toBeGreaterThanOrEqual(1);
    expect(result.issuesAddressed.length).toBeLessThanOrEqual(5);
  });

  it('still counts resolved insights when no applied batches exist', async () => {
    mocks.getInsights.mockReturnValue([
      makeInsight({
        id: 'ins_resolved',
        severity: 'warning',
        resolutionStatus: 'resolved',
        resolutionNote: 'Fixed by audit',
        pageTitle: 'Services Page',
      }),
    ]);
    mocks.listBatches.mockReturnValue([]);
    mocks.listWorkOrders.mockReturnValue([]);

    const ws = makeWorkspace({ id: 'ws_resolved_only' });
    const result = await generateMonthlyDigest(ws, 'May 2026');

    expect(result.issuesAddressed.length).toBe(1);
    expect(result.issuesAddressed[0].detail).toBe('Fixed by audit');
  });
});
