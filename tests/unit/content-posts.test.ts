/**
 * Unit tests for server/content-posts.ts — post CRUD operations.
 *
 * Note: generatePost() and regenerateSection() require AI API keys
 * and are not tested here. This file tests the synchronous CRUD and
 * export operations.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../../server/data-dir.js';
import {
  listPosts,
  getPost,
  savePost,
  updatePostField,
  deletePost,
  exportPostMarkdown,
  exportPostHTML,
  type GeneratedPost,
  type PostSection,
} from '../../server/content-posts.js';

const POSTS_DIR = getDataDir('content-posts');

function cleanupWorkspace(workspaceId: string): void {
  const fp = path.join(POSTS_DIR, `${workspaceId}.json`);
  try { fs.unlinkSync(fp); } catch { /* skip */ }
}

function makeSection(index: number, heading: string): PostSection {
  return {
    index,
    heading,
    content: `<p>Content for ${heading}</p>`,
    wordCount: 150,
    targetWordCount: 200,
    keywords: ['test'],
    status: 'done',
  };
}

function makePost(id: string, workspaceId: string, overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    id,
    workspaceId,
    briefId: 'brief_1',
    targetKeyword: 'test keyword',
    title: 'Test Post Title',
    metaDescription: 'Test meta description',
    introduction: '<p>Test introduction paragraph.</p>',
    sections: [
      makeSection(0, 'First Section'),
      makeSection(1, 'Second Section'),
    ],
    conclusion: '<p>Test conclusion paragraph.</p>',
    totalWordCount: 500,
    targetWordCount: 1800,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── savePost / getPost ──

describe('savePost / getPost', () => {
  const wsId = 'ws_post_save_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('saves and retrieves a post', () => {
    const post = makePost('post_1', wsId);
    savePost(wsId, post);

    const fetched = getPost(wsId, 'post_1');
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe('post_1');
    expect(fetched!.title).toBe('Test Post Title');
    expect(fetched!.sections).toHaveLength(2);
  });

  it('updates an existing post on save', () => {
    const post = makePost('post_update', wsId);
    savePost(wsId, post);

    post.title = 'Updated Title';
    savePost(wsId, post);

    const fetched = getPost(wsId, 'post_update');
    expect(fetched!.title).toBe('Updated Title');
  });

  it('returns undefined for non-existent post', () => {
    expect(getPost(wsId, 'post_nonexistent')).toBeUndefined();
  });
});

// ── listPosts ──

describe('listPosts', () => {
  const wsId = 'ws_post_list_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('returns empty array for workspace with no posts', () => {
    expect(listPosts('ws_nonexistent_posts')).toEqual([]);
  });

  it('returns posts sorted by createdAt (newest first)', () => {
    savePost(wsId, makePost('post_old', wsId, { createdAt: '2024-01-01T00:00:00Z' }));
    savePost(wsId, makePost('post_new', wsId, { createdAt: '2024-06-01T00:00:00Z' }));

    const posts = listPosts(wsId);
    expect(posts).toHaveLength(2);
    expect(posts[0].id).toBe('post_new');
    expect(posts[1].id).toBe('post_old');
  });
});

// ── updatePostField ──

describe('updatePostField', () => {
  const wsId = 'ws_post_field_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('updates specific fields', () => {
    savePost(wsId, makePost('post_field', wsId));

    const updated = updatePostField(wsId, 'post_field', {
      title: 'New Title',
      status: 'review',
    });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('New Title');
    expect(updated!.status).toBe('review');
    expect(updated!.updatedAt).toBeDefined();
  });

  it('returns null for non-existent post', () => {
    expect(updatePostField(wsId, 'post_nonexistent', { title: 'X' })).toBeNull();
  });

  it('updates unification status', () => {
    savePost(wsId, makePost('post_unify', wsId));

    const updated = updatePostField(wsId, 'post_unify', {
      unificationStatus: 'success',
      unificationNote: 'Smoothed transitions',
    });

    expect(updated!.unificationStatus).toBe('success');
    expect(updated!.unificationNote).toBe('Smoothed transitions');
  });

  it('updates SEO meta fields', () => {
    savePost(wsId, makePost('post_seo', wsId));

    const updated = updatePostField(wsId, 'post_seo', {
      seoTitle: 'SEO Optimized Title | Brand',
      seoMetaDescription: 'Compelling meta description for search results.',
    });

    expect(updated!.seoTitle).toBe('SEO Optimized Title | Brand');
    expect(updated!.seoMetaDescription).toBe('Compelling meta description for search results.');
  });
});

// ── deletePost ──

describe('deletePost', () => {
  const wsId = 'ws_post_delete_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('removes a post', () => {
    savePost(wsId, makePost('post_del', wsId));
    expect(deletePost(wsId, 'post_del')).toBe(true);
    expect(getPost(wsId, 'post_del')).toBeUndefined();
  });

  it('returns false for non-existent post', () => {
    expect(deletePost(wsId, 'post_nonexistent')).toBe(false);
  });
});

// ── exportPostMarkdown ──

describe('exportPostMarkdown', () => {
  it('generates markdown with title and content', () => {
    const post = makePost('post_md', 'ws_export');
    const md = exportPostMarkdown(post);

    expect(md).toContain('# Test Post Title');
    expect(md).toContain('Test introduction paragraph.');
    expect(md).toContain('Content for First Section');
    expect(md).toContain('Content for Second Section');
    expect(md).toContain('Test conclusion paragraph.');
  });

  it('concatenates all sections in order', () => {
    const post = makePost('post_md_order', 'ws_export', {
      sections: [
        makeSection(0, 'Alpha'),
        makeSection(1, 'Beta'),
        makeSection(2, 'Gamma'),
      ],
    });
    const md = exportPostMarkdown(post);
    const alphaIdx = md.indexOf('Content for Alpha');
    const betaIdx = md.indexOf('Content for Beta');
    const gammaIdx = md.indexOf('Content for Gamma');
    expect(alphaIdx).toBeLessThan(betaIdx);
    expect(betaIdx).toBeLessThan(gammaIdx);
  });
});

// ── exportPostHTML ──

describe('exportPostHTML', () => {
  it('generates valid HTML document', () => {
    const post = makePost('post_html', 'ws_export');
    const html = exportPostHTML(post);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<h1>Test Post Title</h1>');
    expect(html).toContain('Test introduction paragraph.');
    expect(html).toContain('Content for First Section');
    expect(html).toContain('Content for Second Section');
    expect(html).toContain('Test conclusion paragraph.');
  });

  it('includes meta description and title tag', () => {
    const post = makePost('post_html_meta', 'ws_export', {
      seoTitle: 'SEO Title | Brand',
      seoMetaDescription: 'SEO meta description here.',
    });
    const html = exportPostHTML(post);

    expect(html).toContain('<title>SEO Title | Brand</title>');
    expect(html).toContain('content="SEO meta description here."');
  });

  it('includes word count and keyword in meta div', () => {
    const post = makePost('post_html_wc', 'ws_export');
    const html = exportPostHTML(post);

    expect(html).toContain('500 words');
    expect(html).toContain('test keyword');
  });
});

// ── PostSection statuses ──

describe('PostSection status handling', () => {
  const wsId = 'ws_post_status_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('preserves section statuses through save/load cycle', () => {
    const post = makePost('post_sect', wsId, {
      sections: [
        { ...makeSection(0, 'Done'), status: 'done' },
        { ...makeSection(1, 'Pending'), status: 'pending' },
        { ...makeSection(2, 'Error'), status: 'error', error: 'API timeout' },
      ],
    });

    savePost(wsId, post);
    const fetched = getPost(wsId, 'post_sect');

    expect(fetched!.sections[0].status).toBe('done');
    expect(fetched!.sections[1].status).toBe('pending');
    expect(fetched!.sections[2].status).toBe('error');
    expect(fetched!.sections[2].error).toBe('API timeout');
  });
});
