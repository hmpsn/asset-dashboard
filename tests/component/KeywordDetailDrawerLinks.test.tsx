/**
 * KeywordDetailDrawerLinks.test.tsx — Phase P4-T3.
 *
 * Wires the drawer's P2 "View in Strategy" back-link to navigate to
 * /seo-strategy, and retires the old "Rank Tracker" jump to /seo-ranks
 * (rank now lives in the in-drawer national-rank section).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { KeywordDetailDrawer } from '../../src/components/keyword-command-center/KeywordDetailDrawer';
import type {
  KeywordCommandCenterRow,
  KeywordCommandCenterStatus,
} from '../../shared/types/keyword-command-center';

const { navigateMock, featureFlagMock, getMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  featureFlagMock: vi.fn(),
  getMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...args),
}));

vi.mock('../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client')>();
  return { ...actual, get: (...args: unknown[]) => getMock(...args) };
});

function makeRow(overrides: Partial<KeywordCommandCenterRow> = {}): KeywordCommandCenterRow {
  return {
    keyword: 'cosmetic dentistry',
    normalizedKeyword: 'cosmetic dentistry',
    lifecycleStatus: 'tracked' as KeywordCommandCenterStatus,
    statusLabel: 'Tracked',
    sourceLabels: [],
    metrics: { volume: 1200, currentPosition: 6.3, ctr: 0.04, clicks: 88, impressions: 2200 },
    tracking: { status: 'active', source: 'manual' },
    nextActions: [],
    isProtected: false,
    ...overrides,
  };
}

function renderDrawer(row: KeywordCommandCenterRow | null, flagOn = true) {
  featureFlagMock.mockReturnValue(flagOn);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <KeywordDetailDrawer open row={row} workspaceId="ws-1" onAction={vi.fn()} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KeywordDetailDrawer — P4 link wiring', () => {
  beforeEach(() => { vi.clearAllMocks(); navigateMock.mockReset(); featureFlagMock.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('View in Strategy navigates to a /seo-strategy path', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'content_gap', sourceGapKey: 'gap:dental-implants' } }));
    const link = screen.getByTestId('view-in-strategy-link');
    fireEvent.click(link);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    const target = navigateMock.mock.calls[0][0] as string;
    expect(target.endsWith('/seo-strategy')).toBe(true);
  });

  it('no longer renders a control that navigates to /seo-ranks', () => {
    renderDrawer(makeRow({ tracking: { status: 'active', source: 'manual' } }));
    // The old "Rank Tracker" jump button is gone (rank lives in the in-drawer
    // national-rank section now).
    expect(screen.queryByRole('button', { name: /rank tracker/i })).toBeNull();
    // Clicking any present control must never navigate to seo-ranks.
    for (const btn of screen.queryAllByRole('button')) {
      fireEvent.click(btn);
    }
    for (const call of navigateMock.mock.calls) {
      const arg = call[0];
      if (typeof arg === 'string') expect(arg).not.toContain('seo-ranks');
    }
  });
});
