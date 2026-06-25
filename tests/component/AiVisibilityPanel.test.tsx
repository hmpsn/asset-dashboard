import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiVisibilityPanel } from '../../src/components/strategy/AiVisibilityPanel';
import type { AiVisibilityReadResponse } from '../../src/api/seo';

// Flag-CI gotcha: AiVisibilityPanel renders <FeatureFlag flag="ai-visibility"> for the refresh
// button, which calls useFeatureFlag — mock it so no QueryClientProvider / network is needed. ON
// here so the refresh trigger renders when data is present.
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => true,
}));

const refreshMutate = vi.fn();
let aiVisibilityData: AiVisibilityReadResponse | undefined;

vi.mock('../../src/hooks/admin/useAiVisibility', () => ({
  useAiVisibility: () => ({ data: aiVisibilityData }),
  useAiVisibilityRefresh: () => ({ mutate: refreshMutate, isPending: false, error: null }),
}));

beforeEach(() => {
  aiVisibilityData = undefined;
  refreshMutate.mockClear();
});

afterEach(() => cleanup());

describe('AiVisibilityPanel', () => {
  it('renders share-of-voice, mention volume, competitor, trend, and wires the refresh button', () => {
    aiVisibilityData = {
      latest: {
        workspaceId: 'ws-1',
        snapshotDate: '2026-06-24',
        platform: 'chat_gpt',
        domain: 'squareup.com',
        mentions: 2704,
        aiSearchVolume: 58439,
        shareOfVoice: 0.55,
        competitors: [{ name: 'Stripe', mentions: 14 }],
        sourceDomains: [{ domain: 'squareup.com', mentions: 1031 }],
        fetchedAt: '2026-06-24T00:00:00.000Z',
      },
      trend: [
        { date: '2026-06-01', mentions: 2100, shareOfVoice: 0.48 },
        { date: '2026-06-24', mentions: 2704, shareOfVoice: 0.55 },
      ],
      competitors: [{ name: 'Stripe', mentions: 14 }],
      sourceDomains: [{ domain: 'squareup.com', mentions: 1031 }],
    };

    render(<AiVisibilityPanel workspaceId="ws-1" />);

    // Share-of-voice headline: 0.55 → 55% score (emerald/amber/red via scoreColorClass).
    expect(screen.getByText('55%')).toBeTruthy();
    expect(screen.getByText(/share of voice in AI answers/)).toBeTruthy();
    // Mention volume (blue data tone).
    expect(screen.getByText('2,704')).toBeTruthy();
    expect(screen.getByText(/Mentions in AI answers/)).toBeTruthy();
    // Competitor share-of-voice breakdown.
    expect(screen.getByText('Stripe')).toBeTruthy();
    expect(screen.getByText('14')).toBeTruthy();
    // Source-domain AEO targets.
    expect(screen.getByText('squareup.com')).toBeTruthy();
    // Trend (2 snapshots → +604 since first).
    expect(screen.getByText(/Mention volume over time/)).toBeTruthy();
    expect(screen.getByText(/\+604 mentions since first snapshot/)).toBeTruthy();
    // Flag-gated refresh trigger present + wired.
    const refreshBtn = screen.getByRole('button', { name: /Refresh AI visibility/ });
    fireEvent.click(refreshBtn);
    expect(refreshMutate).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when there is no latest snapshot', () => {
    aiVisibilityData = { latest: null, trend: [], competitors: [], sourceDomains: [] };
    const { container } = render(<AiVisibilityPanel workspaceId="ws-1" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/AI visibility/)).toBeNull();
  });
});
