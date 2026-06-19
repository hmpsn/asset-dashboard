// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { SiteTargetKeywords } from '../../../src/components/strategy/SiteTargetKeywords';
import type { ActiveStrategyKeyword } from '../../../shared/types/strategy-keyword-set';

function kw(keyword: string, overrides: Partial<ActiveStrategyKeyword> = {}): ActiveStrategyKeyword {
  return {
    id: 1,
    workspaceId: 'ws-1',
    keyword,
    source: 'manual_add',
    keptAt: null,
    removedAt: null,
    slotOrder: 0,
    createdAt: '2026-06-19T00:00:00.000Z',
    ...overrides,
  };
}

const BASE_PROPS = {
  workspaceId: 'ws-1',
  siteKeywords: ['seo tools', 'web analytics'],
  trackedKeywords: new Set<string>(),
  trackingPending: new Set<string>(),
  trackingErrors: new Map<string, string>(),
  onTrack: vi.fn(),
};

function renderComponent(props: Partial<React.ComponentProps<typeof SiteTargetKeywords>> = {}) {
  return render(
    <MemoryRouter>
      <SiteTargetKeywords {...BASE_PROPS} {...props} />
    </MemoryRouter>,
  );
}

describe('SiteTargetKeywords — managed-set mutation controls (Lane D)', () => {
  it('flag-OFF: renders display-only view with no mutation controls', () => {
    renderComponent({
      managedSetEnabled: false,
      managedKeywordSet: undefined,
    });
    expect(screen.queryByPlaceholderText('Add keyword to set…')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add keyword to managed set')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Add to set')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Remove from set')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Keep in set')).not.toBeInTheDocument();
  });

  it('flag-OFF with managedKeywordSet: shows In Set badge (Lane C display state) but NO mutations', () => {
    renderComponent({
      managedSetEnabled: false,
      managedKeywordSet: [kw('seo tools')],
    });
    expect(screen.getByText('In Set')).toBeInTheDocument();
    // Mutation controls must NOT appear when flag is OFF
    expect(screen.queryByPlaceholderText('Add keyword to set…')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Remove from set')).not.toBeInTheDocument();
  });

  it('flag-ON: shows search-and-add input and per-row mutation controls', () => {
    renderComponent({
      managedSetEnabled: true,
      managedKeywordSet: [kw('seo tools')],
    });
    expect(screen.getByPlaceholderText('Add keyword to set…')).toBeInTheDocument();
    // In-set keyword gets remove + keep buttons
    expect(screen.getByTitle('Remove from set')).toBeInTheDocument();
    expect(screen.getByTitle('Keep in set')).toBeInTheDocument();
    // Candidate keyword gets "Add to set" button
    expect(screen.getByTitle('Add to set')).toBeInTheDocument();
  });

  it('flag-ON: calls onRemoveFromSet when "Remove from set" is clicked', () => {
    const onRemoveFromSet = vi.fn();
    renderComponent({
      managedSetEnabled: true,
      managedKeywordSet: [kw('seo tools')],
      onRemoveFromSet,
    });
    fireEvent.click(screen.getByTitle('Remove from set'));
    expect(onRemoveFromSet).toHaveBeenCalledWith('seo tools');
  });

  it('flag-ON: calls onKeepInSet when "Keep in set" is clicked', () => {
    const onKeepInSet = vi.fn();
    renderComponent({
      managedSetEnabled: true,
      managedKeywordSet: [kw('seo tools')],
      onKeepInSet,
    });
    fireEvent.click(screen.getByTitle('Keep in set'));
    expect(onKeepInSet).toHaveBeenCalledWith('seo tools');
  });

  it('flag-ON: calls onAddToSet with manual_add from per-row "Add to set" button (candidate)', () => {
    const onAddToSet = vi.fn();
    renderComponent({
      managedSetEnabled: true,
      // Only 'seo tools' is in set; 'web analytics' is a candidate
      managedKeywordSet: [kw('seo tools')],
      onAddToSet,
    });
    // There is exactly one "Add to set" for the candidate keyword
    fireEvent.click(screen.getByTitle('Add to set'));
    expect(onAddToSet).toHaveBeenCalledWith('web analytics', 'manual_add');
  });

  it('flag-ON: calls onAddToSet with manual_add from search-and-add input on Enter', () => {
    const onAddToSet = vi.fn();
    // Empty managedKeywordSet so there are no per-row "Add to set" buttons to collide with
    renderComponent({ managedSetEnabled: true, managedKeywordSet: [], onAddToSet });
    const input = screen.getByPlaceholderText('Add keyword to set…');
    fireEvent.change(input, { target: { value: 'new keyword' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onAddToSet).toHaveBeenCalledWith('new keyword', 'manual_add');
  });

  it('flag-ON: calls onAddToSet from search-and-add "Add" button click', () => {
    const onAddToSet = vi.fn();
    // Empty managedKeywordSet so there are no per-row "Add to set" buttons to collide with
    renderComponent({ managedSetEnabled: true, managedKeywordSet: [], onAddToSet });
    const input = screen.getByPlaceholderText('Add keyword to set…');
    fireEvent.change(input, { target: { value: 'new keyword' } });
    // The search-and-add "Add" button has a specific aria-label
    fireEvent.click(screen.getByRole('button', { name: 'Add keyword' }));
    expect(onAddToSet).toHaveBeenCalledWith('new keyword', 'manual_add');
  });

  it('flag-ON: shows error when adding empty string via search input', () => {
    // Empty managedKeywordSet so there are no per-row "Add to set" buttons
    renderComponent({ managedSetEnabled: true, managedKeywordSet: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add keyword' }));
    expect(screen.getByText('Enter a keyword to add.')).toBeInTheDocument();
  });

  it('flag-ON: shows "Added from opportunities" annotation for regen_computed source', () => {
    renderComponent({
      managedSetEnabled: true,
      managedKeywordSet: [kw('seo tools', { source: 'regen_computed' })],
    });
    expect(screen.getByText('Added from opportunities')).toBeInTheDocument();
  });

  it('flag-ON: does NOT show "Added from opportunities" for manual_add or client_request', () => {
    renderComponent({
      managedSetEnabled: true,
      managedKeywordSet: [kw('seo tools', { source: 'manual_add' })],
    });
    expect(screen.queryByText('Added from opportunities')).not.toBeInTheDocument();
  });
});
