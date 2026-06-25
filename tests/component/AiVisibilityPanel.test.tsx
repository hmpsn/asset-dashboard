import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AiVisibilityPanel } from '../../src/components/strategy/AiVisibilityPanel';
import type { AiVisibilityReadResponse } from '../../src/api/seo';

// Flag-CI gotcha: AiVisibilityPanel renders <FeatureFlag flag="ai-visibility"> for the refresh
// button AND reads useFeatureFlag directly to decide whether to show the bootstrap (empty) card —
// mock it so no QueryClientProvider / network is needed. `flagEnabled` is mutable so a test can
// flip the flag off; the factory reads it at call time. Defaults ON (reset in beforeEach).
let flagEnabled = true;
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => flagEnabled,
}));

const refreshMutate = vi.fn();
let aiVisibilityData: AiVisibilityReadResponse | undefined;

vi.mock('../../src/hooks/admin/useAiVisibility', () => ({
  useAiVisibility: () => ({ data: aiVisibilityData }),
  useAiVisibilityRefresh: () => ({ mutate: refreshMutate, isPending: false, error: null }),
}));

beforeEach(() => {
  aiVisibilityData = undefined;
  flagEnabled = true;
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
    expect(screen.getByText(/share of voice vs co-mentioned brands/)).toBeTruthy();
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

  it('renders the bootstrap refresh button (not nothing) when the flag is ON but no snapshot yet', () => {
    // Chicken-and-egg guard: with the flag on and no snapshot, the panel must still surface the
    // "Refresh AI visibility" trigger so the very first refresh can be kicked off from the UI.
    aiVisibilityData = { latest: null, trend: [], competitors: [], sourceDomains: [] };
    render(<AiVisibilityPanel workspaceId="ws-1" />);
    expect(screen.getByText(/No AI-visibility data yet/)).toBeTruthy();
    const refreshBtn = screen.getByRole('button', { name: /Refresh AI visibility/ });
    fireEvent.click(refreshBtn);
    expect(refreshMutate).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the flag is OFF and there is no snapshot', () => {
    flagEnabled = false;
    aiVisibilityData = { latest: null, trend: [], competitors: [], sourceDomains: [] };
    const { container } = render(<AiVisibilityPanel workspaceId="ws-1" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/AI visibility/)).toBeNull();
    expect(screen.queryByText(/No AI-visibility data yet/)).toBeNull();
  });

  it('shows "not measured" (not a 0%) when share-of-voice is undefined but mentions exist', () => {
    aiVisibilityData = {
      latest: {
        workspaceId: 'ws-1', snapshotDate: '2026-06-24', platform: 'chat_gpt', domain: 'acme.com',
        mentions: 2704, aiSearchVolume: 58439, shareOfVoice: undefined,
        competitors: [{ name: 'Stripe', mentions: 14 }], sourceDomains: [], fetchedAt: '2026-06-24T00:00:00.000Z',
      },
      trend: [], competitors: [{ name: 'Stripe', mentions: 14 }], sourceDomains: [],
    };
    render(<AiVisibilityPanel workspaceId="ws-1" />);
    expect(screen.getByText('2,704')).toBeTruthy(); // mention volume still shows
    expect(screen.getByText(/not measured/)).toBeTruthy(); // share-of-voice shows "not measured"
    expect(screen.queryByText('0%')).toBeNull(); // NEVER a misleading red 0%
  });
});
