import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SiteTargetKeywords } from '../../../src/components/strategy/SiteTargetKeywords';
import { keywordTrackingKey } from '../../../src/lib/keywordTracking';

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
