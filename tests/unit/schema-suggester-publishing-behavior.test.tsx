// tests/unit/schema-suggester-publishing-behavior.test.tsx
//
// W2.3 behavioral tests for useSchemaSuggesterPublishingWorkflow:
//   Bug #2 — published Set seeds from page.lastPublishedAt on snapshot load
//            (Published badge + Retract survive reload; Publish All excludes live pages).
//   Bug #3 — clearManualEditForPage / clearAllManualEdits drop stale manual JSON edits
//            so a regenerated schema is authoritative.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useSchemaSuggesterPublishingWorkflow } from '../../src/components/schema/useSchemaSuggesterPublishingWorkflow';
import type { SchemaPageSuggestion } from '../../src/components/schema/schemaSuggesterTypes';

vi.mock('../../src/api/client', () => ({
  post: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  getOptional: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/api/schema', () => ({
  schema: { retract: vi.fn().mockResolvedValue({}) },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client }, children);
}

function makePage(overrides?: Partial<SchemaPageSuggestion>): SchemaPageSuggestion {
  return {
    pageId: 'p1',
    pageTitle: 'Home',
    slug: '/',
    url: 'https://example.com/',
    existingSchemas: [],
    suggestedSchemas: [{ type: 'WebPage', reason: 'r', priority: 'high', template: { '@type': 'WebPage' } }],
    ...overrides,
  };
}

describe('Bug #2 — published Set seeds from lastPublishedAt', () => {
  it('marks a page with lastPublishedAt as published on mount', async () => {
    const data = [makePage({ pageId: 'p1', lastPublishedAt: '2026-06-01T00:00:00.000Z' })];
    const { result } = renderHook(
      () => useSchemaSuggesterPublishingWorkflow({ siteId: 's', workspaceId: 'w', data, setData: vi.fn() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.published.has('p1')).toBe(true));
  });

  it('excludes lastPublishedAt pages from unpublishedCount (Publish All count)', async () => {
    const data = [
      makePage({ pageId: 'p1', lastPublishedAt: '2026-06-01T00:00:00.000Z' }),
      makePage({ pageId: 'p2', lastPublishedAt: null }),
    ];
    const { result } = renderHook(
      () => useSchemaSuggesterPublishingWorkflow({ siteId: 's', workspaceId: 'w', data, setData: vi.fn() }),
      { wrapper },
    );
    // Only p2 (never published) remains in the unpublished count.
    await waitFor(() => expect(result.current.unpublishedCount).toBe(1));
    expect(result.current.published.has('p1')).toBe(true);
    expect(result.current.published.has('p2')).toBe(false);
  });

  it('does not resurrect a page retracted in-session even if lastPublishedAt is still set', async () => {
    const data = [makePage({ pageId: 'p1', lastPublishedAt: '2026-06-01T00:00:00.000Z' })];
    const { result } = renderHook(
      () => useSchemaSuggesterPublishingWorkflow({ siteId: 's', workspaceId: 'w', data, setData: vi.fn() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.published.has('p1')).toBe(true));

    await act(async () => { await result.current.retractSchema('p1'); });

    expect(result.current.retractedPages.has('p1')).toBe(true);
    // The seeding effect must NOT re-add p1 from its stale lastPublishedAt.
    await waitFor(() => expect(result.current.published.has('p1')).toBe(false));
  });
});

describe('Bug #3 — clearing stale manual edits', () => {
  it('clearManualEditForPage removes the edited JSON so getEffectiveSchema returns the original', async () => {
    const original = { '@type': 'WebPage', name: 'Regenerated' };
    const data = [makePage({ pageId: 'p1' })];
    const { result } = renderHook(
      () => useSchemaSuggesterPublishingWorkflow({ siteId: 's', workspaceId: 'w', data, setData: vi.fn() }),
      { wrapper },
    );

    // Simulate a stale manual edit on p1.
    act(() => {
      result.current.handleSchemaJsonChange('p1', JSON.stringify({ '@type': 'WebPage', name: 'Stale Edit' }));
    });
    expect(result.current.getEffectiveSchema('p1', original)).toMatchObject({ name: 'Stale Edit' });

    act(() => { result.current.clearManualEditForPage('p1'); });

    // After clearing, the regenerated original wins.
    expect(result.current.editedSchemaJson['p1']).toBeUndefined();
    expect(result.current.getEffectiveSchema('p1', original)).toMatchObject({ name: 'Regenerated' });
  });

  it('clearAllManualEdits wipes every manual edit and parse error', () => {
    const data = [makePage({ pageId: 'p1' }), makePage({ pageId: 'p2', slug: 'about' })];
    const { result } = renderHook(
      () => useSchemaSuggesterPublishingWorkflow({ siteId: 's', workspaceId: 'w', data, setData: vi.fn() }),
      { wrapper },
    );

    act(() => {
      result.current.handleSchemaJsonChange('p1', '{ invalid json'); // sets a parse error
      result.current.handleSchemaJsonChange('p2', JSON.stringify({ '@type': 'AboutPage' }));
    });
    expect(Object.keys(result.current.editedSchemaJson).length).toBe(2);
    expect(result.current.schemaParseError['p1']).toBeDefined();

    act(() => { result.current.clearAllManualEdits(); });

    expect(Object.keys(result.current.editedSchemaJson).length).toBe(0);
    expect(Object.keys(result.current.schemaParseError).length).toBe(0);
  });
});
