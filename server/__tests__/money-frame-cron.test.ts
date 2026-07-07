import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ROIData } from '../roi.js';

const mocks = vi.hoisted(() => ({
  computeROI: vi.fn(),
  getROIHighlightsFromOutcomes: vi.fn(),
  assembleSetupReadiness: vi.fn(),
  isFeatureEnabled: vi.fn(),
  listWorkspaces: vi.fn(),
  saveAdminMoneyFrame: vi.fn(),
  clearAdminMoneyFrame: vi.fn(),
}));

vi.mock('../roi.js', () => ({
  computeROI: mocks.computeROI,
}));

vi.mock('../outcome-tracking.js', () => ({
  getROIHighlightsFromOutcomes: mocks.getROIHighlightsFromOutcomes,
}));

vi.mock('../the-issue-readiness.js', () => ({
  assembleSetupReadiness: mocks.assembleSetupReadiness,
}));

vi.mock('../feature-flags.js', () => ({
  isFeatureEnabled: mocks.isFeatureEnabled,
}));

vi.mock('../workspaces.js', () => ({
  listWorkspaces: mocks.listWorkspaces,
}));

vi.mock('../money-frame-store.js', () => ({
  saveAdminMoneyFrame: mocks.saveAdminMoneyFrame,
  clearAdminMoneyFrame: mocks.clearAdminMoneyFrame,
}));

import {
  assembleAdminMoneyFrame,
  runAdminMoneyFramePrecomputeForWorkspace,
} from '../money-frame-cron.js';

function roi(overrides: Partial<ROIData> = {}): ROIData {
  return {
    organicTrafficValue: 0,
    adSpendEquivalent: 0,
    growthPercent: null,
    revenueAtStake: 1280.5,
    pageBreakdown: [],
    totalClicks: 0,
    totalImpressions: 0,
    avgCPC: 0,
    trackedPages: 0,
    contentROI: null,
    contentItems: [],
    computedAt: '2026-07-06T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isFeatureEnabled.mockReturnValue(true);
  mocks.listWorkspaces.mockReturnValue([]);
});

describe('assembleAdminMoneyFrame', () => {
  it('reuses ROIData.revenueAtStake, sums recovered attributed values, and uses read-time provenance', () => {
    mocks.computeROI.mockReturnValue(roi({ revenueAtStake: 9876.54 }));
    mocks.getROIHighlightsFromOutcomes.mockReturnValue([
      { attributedValue: 120.25 },
      { attributedValue: null },
      { attributedValue: 30.755 },
    ]);
    mocks.assembleSetupReadiness.mockReturnValue({ resolvedProvenance: 'measured_action' });

    const frame = assembleAdminMoneyFrame('ws-money', {
      now: new Date('2026-07-06T12:34:56.000Z'),
    });

    expect(frame).toEqual({
      valueAtStake: 9876.54,
      recoveredSoFar: 151.01,
      provenance: 'measured_action',
      precomputedAt: '2026-07-06T12:34:56.000Z',
    });
    expect(mocks.computeROI).toHaveBeenCalledWith('ws-money');
    expect(mocks.getROIHighlightsFromOutcomes).toHaveBeenCalledWith('ws-money', 10_000);
  });

  it('returns null when the recovered outcome read fails', () => {
    mocks.computeROI.mockReturnValue(roi());
    mocks.getROIHighlightsFromOutcomes.mockImplementation(() => {
      throw new Error('outcomes unavailable');
    });

    expect(assembleAdminMoneyFrame('ws-failure')).toBeNull();
  });
});

describe('runAdminMoneyFramePrecomputeForWorkspace', () => {
  it('clears the persisted frame and does not save when assembly cannot read outcomes', () => {
    mocks.computeROI.mockReturnValue(roi());
    mocks.getROIHighlightsFromOutcomes.mockImplementation(() => {
      throw new Error('outcomes unavailable');
    });

    const result = runAdminMoneyFramePrecomputeForWorkspace('ws-failure');

    expect(result).toEqual({ status: 'skipped', reason: 'no frame' });
    expect(mocks.saveAdminMoneyFrame).not.toHaveBeenCalled();
    expect(mocks.clearAdminMoneyFrame).toHaveBeenCalledWith('ws-failure');
  });
});
