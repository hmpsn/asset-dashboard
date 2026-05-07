import { describe, expect, it } from 'vitest';
import type { SeoEditorPage } from '../../src/components/editor/seoEditorTypes';
import {
  buildSeoEditsFromPages,
  getSeoDraftKey,
  readCachedExpandedPages,
  readCachedSeoBulkAnalyzeJobId,
  readCachedSeoBulkRewriteJobId,
  readCachedSeoEdits,
  readCachedSeoVariations,
} from '../../src/components/editor/seoEditorPersistence';

function createReader(data: Record<string, string>): { getItem: (key: string) => string | null } {
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
  };
}

describe('seoEditorPersistence cached state readers', () => {
  it('marks edits cache as restored only when parsed object is non-empty', () => {
    const siteId = 'site-1';
    const withData = readCachedSeoEdits(
      siteId,
      createReader({
        'seo-editor-edits-site-1': JSON.stringify({ p1: { seoTitle: 'T', seoDescription: 'D', dirty: true } }),
      }),
    );
    const emptyData = readCachedSeoEdits(
      siteId,
      createReader({
        'seo-editor-edits-site-1': JSON.stringify({}),
      }),
    );

    expect(withData.restoredFromCache).toBe(true);
    expect(Object.keys(withData.edits)).toEqual(['p1']);
    expect(emptyData.restoredFromCache).toBe(false);
    expect(emptyData.edits).toEqual({});
  });

  it('returns parsed expanded IDs and ignores non-array payloads', () => {
    const expanded = readCachedExpandedPages(
      'site-2',
      createReader({
        'seo-editor-expanded-site-2': JSON.stringify(['p1', 'p2']),
      }),
    );
    const invalid = readCachedExpandedPages(
      'site-2',
      createReader({
        'seo-editor-expanded-site-2': JSON.stringify({ nope: true }),
      }),
    );

    expect(Array.from(expanded)).toEqual(['p1', 'p2']);
    expect(Array.from(invalid)).toEqual([]);
  });

  it('returns variation records and falls back to empty object when payload is invalid', () => {
    const variations = readCachedSeoVariations(
      'site-3',
      createReader({
        'seo-editor-vars-site-3': JSON.stringify({ p1: { field: 'title', options: ['A'] } }),
      }),
    );
    const invalid = readCachedSeoVariations(
      'site-3',
      createReader({
        'seo-editor-vars-site-3': '[]',
      }),
    );

    expect(variations.p1?.field).toBe('title');
    expect(invalid).toEqual({});
  });

  it('reads workspace bulk job IDs from dedicated keys', () => {
    const storage = createReader({
      'seo-bulk-analyze-job-ws-1': 'analyze-job-1',
      'seo-bulk-rewrite-job-ws-1': 'rewrite-job-1',
    });

    expect(readCachedSeoBulkAnalyzeJobId('ws-1', storage)).toBe('analyze-job-1');
    expect(readCachedSeoBulkRewriteJobId('ws-1', storage)).toBe('rewrite-job-1');
    expect(readCachedSeoBulkAnalyzeJobId(undefined, storage)).toBeNull();
    expect(readCachedSeoBulkRewriteJobId(undefined, storage)).toBeNull();
  });
});

describe('seoEditorPersistence draft hydration', () => {
  const pages: SeoEditorPage[] = [
    {
      id: 'p1',
      title: 'Home',
      slug: '/',
      source: 'static',
      seo: { title: 'Current title', description: 'Current desc' },
    },
    {
      id: 'p2',
      title: 'About',
      slug: '/about',
      source: 'static',
      seo: { title: 'About title', description: 'About desc' },
    },
  ];

  it('hydrates draft values into edits map and marks edited pages dirty', () => {
    const storage = createReader({
      [getSeoDraftKey('ws-1', 'p1')]: JSON.stringify({
        seoTitle: 'Draft title',
        seoDescription: null,
      }),
    });
    const editMap = buildSeoEditsFromPages(pages, 'ws-1', storage);

    expect(editMap.p1).toEqual({
      seoTitle: 'Draft title',
      seoDescription: 'Current desc',
      dirty: true,
    });
    expect(editMap.p2).toEqual({
      seoTitle: 'About title',
      seoDescription: 'About desc',
      dirty: false,
    });
  });

  it('keeps legacy undefined workspace draft key shape', () => {
    expect(getSeoDraftKey(undefined, 'p9')).toBe('seo-draft-undefined-p9');
  });
});
