// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Recommendation } from '../../../shared/types/recommendations';

const state = vi.hoisted(() => ({ recs: [] as Recommendation[], isLoading: false, isError: false }));
const refetch = vi.hoisted(() => vi.fn());

vi.mock('../../../src/hooks/admin/useAdminRecommendations', () => ({
  useAdminRecommendationSet: () => ({
    data: { recommendations: state.recs }, isLoading: state.isLoading, isError: state.isError, refetch,
  }),
}));

import { ActQueue } from '../../../src/components/strategy/ActQueue';

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'r1', workspaceId: 'ws1', type: 'content', priority: 'fix_now', status: 'pending',
    title: 'Write a guide', insight: 'gap', description: 'desc', affectedPages: [],
    trafficAtRisk: 0, impressionsAtRisk: 0, impactScore: 50, targetKeyword: 'kw',
    opportunity: { value: 80, emvPerWeek: 100, components: [], confidence: 0.7 },
    ...over,
  } as Recommendation;
}

const renderQueue = () => render(<MemoryRouter><ActQueue workspaceId="ws1" /></MemoryRouter>);

describe('ActQueue', () => {
  beforeEach(() => { state.recs = []; state.isLoading = false; state.isError = false; refetch.mockClear(); });

  it('shows an empty state when there are no active recommendations', () => {
    renderQueue();
    expect(screen.getByText('No actions right now')).toBeInTheDocument();
  });

  it('renders the queue with filter chips + counts', () => {
    state.recs = [
      rec({ id: 'a', type: 'content', title: 'Content rec', opportunity: { value: 90, emvPerWeek: 10, components: [], confidence: 0.5 } }),
      rec({ id: 'b', type: 'technical', title: 'Technical rec', opportunity: { value: 40, emvPerWeek: 5, components: [], confidence: 0.5 } }),
    ];
    renderQueue();
    expect(screen.getByText('What to do next')).toBeInTheDocument();
    expect(screen.getByText('Content rec')).toBeInTheDocument();
    expect(screen.getByText('Technical rec')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Content 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Technical 1' })).toBeInTheDocument();
  });

  it('filters the queue when a category chip is clicked', () => {
    state.recs = [
      rec({ id: 'a', type: 'content', title: 'Content rec' }),
      rec({ id: 'b', type: 'technical', title: 'Technical rec' }),
    ];
    renderQueue();
    fireEvent.click(screen.getByRole('button', { name: 'Technical 1' }));
    expect(screen.queryByText('Content rec')).not.toBeInTheDocument();
    expect(screen.getByText('Technical rec')).toBeInTheDocument();
  });

  it('excludes dismissed and completed recommendations', () => {
    state.recs = [
      rec({ id: 'a', title: 'Active rec', status: 'pending' }),
      rec({ id: 'b', title: 'Done rec', status: 'completed' }),
      rec({ id: 'c', title: 'Dismissed rec', status: 'dismissed' }),
    ];
    renderQueue();
    expect(screen.getByText('Active rec')).toBeInTheDocument();
    expect(screen.queryByText('Done rec')).not.toBeInTheDocument();
    expect(screen.queryByText('Dismissed rec')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All 1' })).toBeInTheDocument();
  });

  it('shows the per-filter empty message when a category has no matches', () => {
    state.recs = [rec({ id: 'a', type: 'content', title: 'Content rec' })];
    renderQueue();
    fireEvent.click(screen.getByRole('button', { name: 'Technical 0' }));
    expect(screen.getByText('No technical actions.')).toBeInTheDocument();
    expect(screen.queryByText('Content rec')).not.toBeInTheDocument();
  });

  it('renders the loading branch (not the empty state) while fetching', () => {
    state.isLoading = true;
    renderQueue();
    expect(screen.getByText('What to do next')).toBeInTheDocument();
    expect(screen.queryByText('No actions right now')).not.toBeInTheDocument();
  });

  it('shows an error state with a working retry on fetch failure', () => {
    state.isError = true;
    renderQueue();
    expect(screen.getByText(/Couldn.t load recommendations/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
