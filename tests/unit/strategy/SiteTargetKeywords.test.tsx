import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SiteTargetKeywords } from '../../../src/components/strategy/SiteTargetKeywords';
import { keywordTrackingKey } from '../../../src/lib/keywordTracking';
import type { ActiveStrategyKeyword } from '../../../shared/types/strategy-keyword-set';

function renderComponent(props: Partial<Parameters<typeof SiteTargetKeywords>[0]> = {}) {
  const defaults = {
    workspaceId: 'ws-123',
    siteKeywords: ['react hooks', 'typescript'],
    siteKeywordMetrics: undefined,
    trackedKeywords: new Set<string>(),
    trackingPending: new Set<string>(),
    trackingErrors: new Map<string, string>(),
    onTrack: vi.fn(),
  };
  return render(
    <MemoryRouter>
      <SiteTargetKeywords {...defaults} {...props} />
    </MemoryRouter>
  );
}

describe('SiteTargetKeywords', () => {
  it('renders each site keyword as a Badge', () => {
    renderComponent({ siteKeywords: ['react hooks', 'typescript'] });
    expect(screen.getByText('react hooks')).toBeInTheDocument();
    expect(screen.getByText('typescript')).toBeInTheDocument();
  });

  it('calls onTrack with keyword when Track IconButton is clicked', () => {
    const onTrack = vi.fn();
    renderComponent({ siteKeywords: ['react hooks', 'typescript'], onTrack });
    // Both keywords render Track buttons — click the first one
    const trackButtons = screen.getAllByTitle('Track');
    fireEvent.click(trackButtons[0]);
    expect(onTrack).toHaveBeenCalledWith('react hooks');
  });

  it('shows Tracking state when keyword key is in trackedKeywords', () => {
    const kw = 'react hooks';
    const trackedKeywords = new Set([keywordTrackingKey(kw)]);
    renderComponent({ siteKeywords: [kw, 'typescript'], trackedKeywords });
    expect(screen.getByTitle('Tracking')).toBeInTheDocument();
  });

  it('shows Adding... state when keyword key is in trackingPending', () => {
    const kw = 'react hooks';
    const trackingPending = new Set([keywordTrackingKey(kw)]);
    renderComponent({ siteKeywords: [kw], trackingPending });
    expect(screen.getByTitle('Adding...')).toBeInTheDocument();
  });

  it('renders volume and difficulty metrics when provided', () => {
    renderComponent({
      siteKeywords: ['react hooks'],
      siteKeywordMetrics: [{ keyword: 'react hooks', volume: 5000, difficulty: 45 }],
    });
    expect(screen.getByText('5,000/mo')).toBeInTheDocument();
    expect(screen.getByText('KD 45%')).toBeInTheDocument();
  });

  it('renders track error when trackingErrors has an entry for the keyword', () => {
    const kw = 'react hooks';
    const trackingErrors = new Map([[keywordTrackingKey(kw), 'Failed to track keyword']]);
    renderComponent({ siteKeywords: [kw], trackingErrors });
    expect(screen.getByText('Failed to track keyword')).toBeInTheDocument();
  });

  it('renders a View in Hub button for each keyword', () => {
    renderComponent({ siteKeywords: ['react hooks', 'typescript'] });
    const hubButtons = screen.getAllByTitle('View in Hub');
    expect(hubButtons).toHaveLength(2);
  });
});

// ── P3 Lane C: managed-set visual states ─────────────────────────

function makeActiveKw(keyword: string): ActiveStrategyKeyword {
  return {
    id: 1,
    workspaceId: 'ws-123',
    keyword,
    source: 'regen_computed',
    keptAt: null,
    removedAt: null, // ActiveStrategyKeyword requires removedAt === null
    slotOrder: 0,
    createdAt: '2026-06-19T00:00:00Z',
  };
}

describe('SiteTargetKeywords — managed-set visual states (P3 Lane C)', () => {
  it('shows "In Set" badge + teal dot for keywords present in managedKeywordSet', () => {
    renderComponent({
      siteKeywords: ['react hooks'],
      managedKeywordSet: [makeActiveKw('react hooks')],
    });
    expect(screen.getByText('In Set')).toBeInTheDocument();
    expect(screen.getByTestId('managed-set-dot')).toBeInTheDocument();
  });

  it('does NOT show "In Set" badge for keywords absent from managedKeywordSet', () => {
    renderComponent({
      siteKeywords: ['react hooks', 'typescript'],
      managedKeywordSet: [makeActiveKw('typescript')],
    });
    // "In Set" only for typescript
    const inSetBadges = screen.getAllByText('In Set');
    expect(inSetBadges).toHaveLength(1);
  });

  it('shows no managed-set annotation (Candidate state) when managedKeywordSet is undefined (legacy parity)', () => {
    renderComponent({ siteKeywords: ['react hooks'] });
    expect(screen.queryByText('In Set')).not.toBeInTheDocument();
    expect(screen.queryByText('Removed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('managed-set-dot')).not.toBeInTheDocument();
  });

  it('matches keywords case-insensitively (normalized comparison)', () => {
    // Keywords stored as lowercase-trimmed in the DB; props may come in mixed case
    renderComponent({
      siteKeywords: ['React Hooks'],
      managedKeywordSet: [makeActiveKw('react hooks')],
    });
    expect(screen.getByText('In Set')).toBeInTheDocument();
  });

  it('Candidate state — keyword NOT in managedKeywordSet renders WITHOUT "In Set" badge', () => {
    // "react hooks" is in the set; "typescript" is not — it should render as Candidate (no badge)
    renderComponent({
      siteKeywords: ['react hooks', 'typescript'],
      managedKeywordSet: [makeActiveKw('react hooks')],
    });
    // Only "react hooks" should have the "In Set" badge
    const inSetBadges = screen.getAllByText('In Set');
    expect(inSetBadges).toHaveLength(1);
    // "typescript" must not have any managed-set annotation
    const allBadges = screen.queryAllByText('Removed');
    expect(allBadges).toHaveLength(0);
    // The teal dot (aria-hidden, data-testid) should appear exactly once (for react hooks only)
    const dots = screen.getAllByTestId('managed-set-dot');
    expect(dots).toHaveLength(1);
  });
});
