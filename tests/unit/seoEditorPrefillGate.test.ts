// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSeoEditorSessionState } from '../../src/components/editor/useSeoEditorSessionState';
import type { SeoEditorPage } from '../../src/components/editor/seoEditorTypes';
import type { FixContext } from '../../src/App';

// Isolate from sessionStorage-backed persistence so the test exercises only the prefill gate.
vi.mock('../../src/components/editor/seoEditorPersistence', () => ({
  readCachedSeoEdits: () => ({ edits: {}, restoredFromCache: false }),
  readCachedExpandedPages: () => new Set<string>(),
  readCachedSeoVariations: () => ({}),
  buildSeoEditsFromPages: () => ({}),
  persistCachedSeoEdits: vi.fn(),
  persistCachedExpandedPages: vi.fn(),
  persistCachedSeoVariations: vi.fn(),
}));

const page = (over: Partial<SeoEditorPage> = {}): SeoEditorPage =>
  ({ id: 'page-1', slug: '/blog/seo', publishedPath: '/blog/seo', ...over } as unknown as SeoEditorPage);

const render = (fixContext: FixContext | null, pages = [page()]) =>
  renderHook(() => useSeoEditorSessionState({ siteId: 's1', workspaceId: 'ws1', pages, fixContext }));

describe('useSeoEditorSessionState prefill gate (pageSlug-only)', () => {
  it('auto-expands the matched page from a pageSlug-only fixContext (no pageId)', () => {
    const { result } = render({ targetRoute: 'seo-editor', pageSlug: '/blog/seo', pageName: '/blog/seo' });
    expect(result.current.expanded.has('page-1')).toBe(true);
  });

  it('does not expand when the slug matches no page', () => {
    const { result } = render({ targetRoute: 'seo-editor', pageSlug: '/nope' });
    expect(result.current.expanded.size).toBe(0);
  });

  it('ignores fixContext for a different targetRoute', () => {
    const { result } = render({ targetRoute: 'page-intelligence', pageSlug: '/blog/seo' });
    expect(result.current.expanded.size).toBe(0);
  });

  it('re-fires for a NEW fixContext target within the same session (no remount)', () => {
    const pages = [
      page({ id: 'a', slug: '/a', publishedPath: '/a' }),
      page({ id: 'b', slug: '/b', publishedPath: '/b' }),
    ];
    const { result, rerender } = renderHook(
      ({ fc }: { fc: FixContext }) => useSeoEditorSessionState({ siteId: 's1', workspaceId: 'ws1', pages, fixContext: fc }),
      { initialProps: { fc: { targetRoute: 'seo-editor', pageSlug: '/a' } as FixContext } },
    );
    expect(result.current.expanded.has('a')).toBe(true);
    // A second "Fix in editor" for a different duplicate must expand it (the editor doesn't remount).
    rerender({ fc: { targetRoute: 'seo-editor', pageSlug: '/b' } });
    expect(result.current.expanded.has('b')).toBe(true);
  });
});
