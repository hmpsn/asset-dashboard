import { describe, expect, it } from 'vitest';
import type { SeoEditState, SeoEditorPage } from '../../src/components/editor/seoEditorTypes';
import {
  buildBulkRewriteRequestPages,
  buildBulkSeoUpdate,
  buildPatternApplyPayload,
  buildPatternPreviewItems,
} from '../../src/components/editor/seoEditorBulkHelpers';

const staticPage: SeoEditorPage = {
  id: 'page-services',
  title: 'Services',
  slug: 'services',
  publishedPath: '/services',
  source: 'static',
  seo: { title: 'Old Title', description: 'Old Description' },
};

const fallbackPage: SeoEditorPage = {
  id: 'page-about',
  title: 'About',
  slug: 'about',
  publishedPath: '/about',
  source: 'static',
  seo: { title: 'About Title', description: 'About Description' },
};

describe('seoEditorBulkHelpers pattern preview + payloads', () => {
  it('builds pattern preview from edit values and truncates to field max length', () => {
    const edits: Record<string, SeoEditState> = {
      [staticPage.id]: {
        seoTitle: 'Current Edit Title',
        seoDescription: 'Current Edit Description',
        dirty: true,
      },
    };

    const preview = buildPatternPreviewItems(
      [staticPage.id],
      [staticPage],
      edits,
      {
        field: 'title',
        action: 'append',
        text: 'X'.repeat(80),
      },
    );

    expect(preview).toHaveLength(1);
    expect(preview[0].oldValue).toBe('Current Edit Title');
    expect(preview[0].newValue.length).toBeLessThanOrEqual(60);
  });

  it('skips ids without both page and edit to preserve existing preview behavior', () => {
    const edits: Record<string, SeoEditState> = {};
    const preview = buildPatternPreviewItems(
      ['missing', staticPage.id],
      [staticPage],
      edits,
      { field: 'description', action: 'prepend', text: 'Prefix' },
    );

    expect(preview).toHaveLength(0);
  });

  it('builds pattern apply payload with safe fallbacks for missing page entries', () => {
    const payload = buildPatternApplyPayload(
      [
        { pageId: staticPage.id, oldValue: 'Old', newValue: 'New' },
        { pageId: 'missing', oldValue: 'Missing Old', newValue: 'Missing New' },
      ],
      [staticPage],
    );

    expect(payload).toEqual([
      { pageId: staticPage.id, title: 'Services', slug: 'services', publishedPath: '/services', currentValue: 'Old' },
      { pageId: 'missing', title: '', slug: undefined, publishedPath: undefined, currentValue: 'Missing Old' },
    ]);
  });
});

describe('seoEditorBulkHelpers rewrite request + seo update payloads', () => {
  it('builds bulk rewrite request pages from edits with page SEO fallback', () => {
    const edits: Record<string, SeoEditState> = {
      [staticPage.id]: { seoTitle: 'Edited Title', seoDescription: 'Edited Description', dirty: true },
    };

    const pagesPayload = buildBulkRewriteRequestPages(
      [staticPage.id, fallbackPage.id],
      [staticPage, fallbackPage],
      edits,
    );

    expect(pagesPayload[0]).toMatchObject({
      pageId: staticPage.id,
      title: 'Services',
      currentSeoTitle: 'Edited Title',
      currentDescription: 'Edited Description',
    });
    expect(pagesPayload[1]).toMatchObject({
      pageId: fallbackPage.id,
      currentSeoTitle: 'About Title',
      currentDescription: 'About Description',
    });
  });

  it('builds title update payload with description fallback from edits/page SEO', () => {
    const update = buildBulkSeoUpdate('title', 'New Title', fallbackPage, {
      seoTitle: 'Draft Title',
      seoDescription: 'Draft Description',
      dirty: true,
    });

    expect(update).toEqual({
      seo: { title: 'New Title', description: 'Draft Description' },
      openGraph: { title: 'New Title', description: 'Draft Description' },
    });
  });

  it('builds description update payload with title fallback from page SEO when edit missing', () => {
    const update = buildBulkSeoUpdate('description', 'New Description', fallbackPage, undefined);

    expect(update).toEqual({
      seo: { title: 'About Title', description: 'New Description' },
      openGraph: { title: 'About Title', description: 'New Description' },
    });
  });
});
