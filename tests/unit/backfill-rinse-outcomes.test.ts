import { describe, it, expect } from 'vitest';
import { toRecordActionBody, buildPageUrl } from '../../scripts/backfill-rinse-outcomes';
import type { GeneratedPost } from '../../shared/types/content';

// Minimal GeneratedPost fixture — the mapper only reads id/title/publishedAt/publishedSlug/
// targetKeyword, so the other required fields are inert filler.
function makePost(overrides: Partial<GeneratedPost>): GeneratedPost {
  return {
    id: 'post-1',
    workspaceId: 'ws-1',
    briefId: 'brief-1',
    targetKeyword: 'kw',
    title: 'A Title',
    metaDescription: '',
    introduction: '',
    sections: [],
    conclusion: '',
    totalWordCount: 0,
    targetWordCount: 0,
    status: 'approved',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as GeneratedPost;
}

describe('backfill-rinse-outcomes mapper', () => {
  it('maps a published post to a platform_executed content_published action with a source snapshot', () => {
    const post = makePost({
      id: 'p9',
      title: 'How to choose a plumber',
      publishedAt: '2026-05-01T00:00:00Z',
      publishedSlug: 'blog/choose-a-plumber',
      targetKeyword: 'local plumber',
    });
    const body = toRecordActionBody(post, 'https://rinse.example');
    expect(body).not.toBeNull();
    expect(body?.actionType).toBe('content_published');
    expect(body?.sourceType).toBe('manual-backfill');
    expect(body?.sourceId).toBe('manual-backfill:p9'); // deterministic → idempotent re-runs
    expect(body?.attribution).toBe('platform_executed'); // the agency did this work
    expect(body?.pageUrl).toBe('https://rinse.example/blog/choose-a-plumber');
    expect(body?.targetKeyword).toBe('local plumber');
    expect(body?.baselineSnapshot).toEqual({});
    expect(body?.source?.label).toBe('How to choose a plumber');
    expect(body?.source?.snapshot).toEqual({
      title: 'How to choose a plumber',
      type: 'manual-backfill',
      page: 'https://rinse.example/blog/choose-a-plumber',
    });
  });

  it('skips an unpublished post (no publishedAt)', () => {
    expect(toRecordActionBody(makePost({ publishedAt: undefined }), 'https://x.com')).toBeNull();
  });

  it('skips a published post with no title — never fabricate one (FM-2)', () => {
    expect(toRecordActionBody(makePost({ title: '   ', publishedAt: '2026-01-01T00:00:00Z' }), 'https://x.com')).toBeNull();
  });

  it('buildPageUrl handles domain+slug, absolute slug, and missing slug', () => {
    expect(buildPageUrl('https://x.com/', 'blog/a')).toBe('https://x.com/blog/a');
    expect(buildPageUrl('https://x.com', '/blog/a')).toBe('https://x.com/blog/a');
    expect(buildPageUrl('https://x.com', 'https://cdn.other/a')).toBe('https://cdn.other/a');
    expect(buildPageUrl('https://x.com', undefined)).toBe('https://x.com');
  });
});
