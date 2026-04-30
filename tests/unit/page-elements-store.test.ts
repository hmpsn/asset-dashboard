import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  upsertPageElements,
  getPageElements,
  deletePageElements,
} from '../../server/page-elements-store.js';
import type { PageElementCatalog } from '../../shared/types/page-elements.js';

const sampleCatalog: PageElementCatalog = {
  extractedAt: '2026-04-29T00:00:00.000Z',
  sourcePublishedAt: '2026-04-29T00:00:00.000Z',
  headings: [{ level: 1, text: 'Hello' }],
  tables: [],
  images: [],
  videos: [{ provider: 'youtube', embedUrl: 'https://www.youtube.com/embed/abc' }],
  lists: [],
  testimonials: [],
  codeBlocks: [],
  citations: [],
  diagnostics: { aiClassificationCalls: 0, hitAiBudgetCap: false, rawCounts: { videos: 1 } },
};

describe('page-elements-store', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM page_elements WHERE workspace_id = ?').run('ws_test_pe_store');
  });

  it('upsertPageElements inserts a new row', () => {
    upsertPageElements('ws_test_pe_store', '/blog/foo', sampleCatalog);
    const row = getPageElements('ws_test_pe_store', '/blog/foo');
    expect(row).not.toBeNull();
    expect(row!.catalog.videos[0].embedUrl).toBe('https://www.youtube.com/embed/abc');
  });

  it('upsertPageElements replaces an existing row', () => {
    upsertPageElements('ws_test_pe_store', '/blog/foo', sampleCatalog);
    const updated: PageElementCatalog = { ...sampleCatalog, videos: [] };
    upsertPageElements('ws_test_pe_store', '/blog/foo', updated);
    const row = getPageElements('ws_test_pe_store', '/blog/foo');
    expect(row!.catalog.videos).toEqual([]);
  });

  it('getPageElements returns null for non-existent rows', () => {
    expect(getPageElements('ws_test_pe_store', '/no-such-page')).toBeNull();
  });

  it('deletePageElements only removes the targeted (workspace_id, page_path)', () => {
    upsertPageElements('ws_test_pe_store', '/blog/foo', sampleCatalog);
    upsertPageElements('ws_test_pe_store', '/blog/bar', sampleCatalog);
    deletePageElements('ws_test_pe_store', '/blog/foo');
    expect(getPageElements('ws_test_pe_store', '/blog/foo')).toBeNull();
    expect(getPageElements('ws_test_pe_store', '/blog/bar')).not.toBeNull();
  });

  it('getPageElements gracefully degrades on malformed catalog_json', () => {
    db.prepare(`
      INSERT INTO page_elements (workspace_id, page_path, catalog_json, source_published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('ws_test_pe_store', '/blog/malformed', '{not valid json', null, '2026-04-29T00:00:00.000Z', '2026-04-29T00:00:00.000Z');
    const row = getPageElements('ws_test_pe_store', '/blog/malformed');
    expect(row).not.toBeNull();
    expect(row!.catalog.videos).toEqual([]);
    expect(row!.catalog.headings).toEqual([]);
  });
});
