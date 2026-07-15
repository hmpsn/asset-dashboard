import { describe, expect, it } from 'vitest';

import type { GeneratedPost } from '../../shared/types/content.js';
import {
  countPostsByStatus,
  filterAndSortPosts,
} from '../../src/hooks/admin/useAdminPostWorkflow.js';

function makePost(id: string, overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    id,
    workspaceId: 'ws-1',
    briefId: `brief-${id}`,
    targetKeyword: `keyword ${id}`,
    title: `Post ${id}`,
    metaDescription: 'meta',
    introduction: '<p>intro</p>',
    sections: [],
    conclusion: '<p>done</p>',
    totalWordCount: 100,
    targetWordCount: 800,
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('admin post workflow helpers', () => {
  it('counts posts by workflow status', () => {
    const counts = countPostsByStatus([
      makePost('1', { status: 'draft' }),
      makePost('2', { status: 'review' }),
      makePost('3', { status: 'approved' }),
      makePost('4', { status: 'error' }),
      makePost('5', { status: 'generating' }),
      makePost('6', { status: 'draft' }),
      makePost('7', { status: 'needs_attention' }),
    ]);

    expect(counts).toEqual({
      all: 7,
      generating: 1,
      needs_attention: 1,
      error: 1,
      draft: 2,
      review: 1,
      approved: 1,
    });
  });

  it('filters by status and case-insensitive title/keyword search', () => {
    const posts = [
      makePost('1', { title: 'Dental Implant Guide', targetKeyword: 'implants', status: 'draft' }),
      makePost('2', { title: 'Whitening Landing Page', targetKeyword: 'cosmetic dentist', status: 'review' }),
      makePost('3', { title: 'Emergency Dentist', targetKeyword: 'urgent care', status: 'draft' }),
    ];

    expect(filterAndSortPosts(posts, {
      search: 'DENTIST',
      statusFilter: 'draft',
      sortField: 'title',
      sortAsc: true,
    }).map(post => post.id)).toEqual(['3']);
  });

  it('preserves existing sort directions for date, title, status, and words', () => {
    const posts = [
      makePost('old-approved-short', {
        title: 'Alpha',
        status: 'approved',
        totalWordCount: 300,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      makePost('new-draft-long', {
        title: 'Zulu',
        status: 'draft',
        totalWordCount: 900,
        createdAt: '2026-02-01T00:00:00.000Z',
      }),
      makePost('mid-review-mid', {
        title: 'Middle',
        status: 'review',
        totalWordCount: 600,
        createdAt: '2026-01-15T00:00:00.000Z',
      }),
    ];

    expect(filterAndSortPosts(posts, { search: '', statusFilter: 'all', sortField: 'date', sortAsc: false }).map(post => post.id))
      .toEqual(['old-approved-short', 'mid-review-mid', 'new-draft-long']);
    expect(filterAndSortPosts(posts, { search: '', statusFilter: 'all', sortField: 'title', sortAsc: true }).map(post => post.id))
      .toEqual(['old-approved-short', 'mid-review-mid', 'new-draft-long']);
    expect(filterAndSortPosts(posts, { search: '', statusFilter: 'all', sortField: 'status', sortAsc: true }).map(post => post.id))
      .toEqual(['new-draft-long', 'mid-review-mid', 'old-approved-short']);
    expect(filterAndSortPosts(posts, { search: '', statusFilter: 'all', sortField: 'words', sortAsc: false }).map(post => post.id))
      .toEqual(['new-draft-long', 'mid-review-mid', 'old-approved-short']);
  });
});
