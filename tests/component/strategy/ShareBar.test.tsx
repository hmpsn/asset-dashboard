// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ShareBar reads only `{ data }` from useQuery — mock it directly for deterministic SOV rendering.
const state = vi.hoisted(() => ({ data: undefined as { domains: unknown[] } | undefined }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: state.data }) }));

import { ShareBar } from '../../../src/components/strategy/ShareBar';

function domain(domain: string, isOwn: boolean, organicTraffic: number | null) {
  return { domain, isOwn, overview: organicTraffic == null ? null : { organicTraffic } };
}

const props = { workspaceId: 'ws1', competitors: ['a.com', 'b.com'], seoDataAvailable: true };

describe('ShareBar', () => {
  beforeEach(() => { state.data = undefined; });

  it('renders share-of-voice percentages summing to ~100, with "you" highlighted', () => {
    state.data = { domains: [domain('you.com', true, 300), domain('a.com', false, 100), domain('b.com', false, 100)] };
    render(<ShareBar {...props} />);
    expect(screen.getByText('Share of voice')).toBeInTheDocument();
    expect(screen.getByText('you.com (you)')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();      // 300/500
    expect(screen.getAllByText('20%')).toHaveLength(2);        // 100/500 each
  });

  it('degrades gracefully — renders nothing when fewer than two domains have traffic data', () => {
    state.data = { domains: [domain('you.com', true, 300), domain('a.com', false, null)] };
    const { container } = render(<ShareBar {...props} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Share of voice')).not.toBeInTheDocument();
  });

  it('renders nothing when the OWN domain has no measurable traffic (avoids a misleading competitor-only chart)', () => {
    state.data = { domains: [domain('you.com', true, null), domain('a.com', false, 200), domain('b.com', false, 100)] };
    const { container } = render(<ShareBar {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('rounds each share independently — equal domains read 33% each (labels may sum to 99, bars stay proportional)', () => {
    state.data = { domains: [domain('you.com', true, 100), domain('a.com', false, 100), domain('b.com', false, 100)] };
    render(<ShareBar {...props} />);
    expect(screen.getByText('Share of voice')).toBeInTheDocument();
    expect(screen.getAllByText('33%')).toHaveLength(3);
  });

  it('renders nothing when there is no competitive data yet', () => {
    state.data = undefined;
    const { container } = render(<ShareBar {...props} />);
    expect(container).toBeEmptyDOMElement();
  });
});
