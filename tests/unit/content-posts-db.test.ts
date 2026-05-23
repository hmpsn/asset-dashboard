/**
 * Unit tests for server/content-posts-db.ts
 *
 * Part 1 — pure functions: monthKeys (UTC boundary math, padding, year rollover)
 * Part 2 — DB-backed: getPublishedPostCountsByMonth, getContentVelocityTrend,
 *           updatePostField (state-machine guards), snapshotPostVersion, revertToVersion
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import {
  monthKeys,
  getPublishedPostCountsByMonth,
  getContentVelocityTrend,
  savePost,
  getPost,
  updatePostField,
  snapshotPostVersion,
  listPostVersions,
  revertToVersion,
} from '../../server/content-posts-db.js';
import type { GeneratedPost } from '../../shared/types/content.ts';
import { InvalidTransitionError } from '../../server/state-machines.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePost(
  id: string,
  workspaceId: string,
  publishedAt: string | null,
  status: GeneratedPost['status'] = 'approved',
): GeneratedPost {
  return {
    id,
    workspaceId,
    briefId: 'brief-1',
    targetKeyword: 'test keyword',
    title: 'Test Post',
    metaDescription: 'Test description',
    introduction: '<p>Intro</p>',
    sections: [],
    conclusion: '<p>Conclusion</p>',
    seoTitle: undefined,
    seoMetaDescription: undefined,
    totalWordCount: 500,
    targetWordCount: 600,
    status,
    unificationStatus: undefined,
    unificationNote: undefined,
    webflowItemId: undefined,
    webflowCollectionId: undefined,
    publishedAt: publishedAt ?? undefined,
    publishedSlug: publishedAt ? '/test-post' : undefined,
    reviewChecklist: undefined,
    voiceScore: undefined,
    voiceFeedback: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Save a post including publishedAt. Because the INSERT path omits published_at,
 * we insert first (without publishedAt) then immediately update to set it.
 */
function savePublishedPost(workspaceId: string, id: string, publishedAt: string, status: GeneratedPost['status'] = 'approved'): void {
  const draft = makePost(id, workspaceId, null, status);
  savePost(workspaceId, draft);
  // Now update with publishedAt via the UPDATE path
  const withPublish = { ...draft, publishedAt, publishedSlug: '/test-post', updatedAt: new Date().toISOString() };
  savePost(workspaceId, withPublish);
}

// ─── Part 1: monthKeys (pure) ─────────────────────────────────────────────────

describe('monthKeys — pure UTC calendar math', () => {
  it('returns 3 consecutive months ending at now', () => {
    const result = monthKeys(new Date('2026-03-15T12:00:00Z'), 3);
    expect(result).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('crosses year boundary correctly (Jan goes back to Nov/Dec)', () => {
    const result = monthKeys(new Date('2026-01-15T12:00:00Z'), 3);
    expect(result).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('handles December end month correctly', () => {
    const result = monthKeys(new Date('2026-12-01T12:00:00Z'), 3);
    expect(result).toEqual(['2026-10', '2026-11', '2026-12']);
  });

  it('returns exactly 1 entry for months=1', () => {
    const result = monthKeys(new Date('2026-03-15T12:00:00Z'), 1);
    expect(result).toEqual(['2026-03']);
  });

  it('returns exactly 6 entries, spanning back 5 months', () => {
    const result = monthKeys(new Date('2026-03-15T12:00:00Z'), 6);
    expect(result).toHaveLength(6);
    expect(result[0]).toBe('2025-10');
    expect(result[5]).toBe('2026-03');
  });

  it('always returns exactly `months` entries', () => {
    for (const n of [1, 3, 6, 12]) {
      expect(monthKeys(new Date('2026-06-15T00:00:00Z'), n)).toHaveLength(n);
    }
  });

  it('all entries are 7-character YYYY-MM strings', () => {
    const result = monthKeys(new Date('2026-11-30T00:00:00Z'), 12);
    for (const key of result) {
      expect(key).toMatch(/^\d{4}-\d{2}$/);
      expect(key).toHaveLength(7);
    }
  });

  it('December is represented as 12, not a decimal or incorrect value', () => {
    const result = monthKeys(new Date('2025-12-31T23:59:59Z'), 1);
    expect(result).toEqual(['2025-12']);
  });

  it('month is zero-padded (January is 01, not 1)', () => {
    const result = monthKeys(new Date('2026-01-01T12:00:00Z'), 1);
    expect(result[0]).toBe('2026-01');
    expect(result[0]).not.toBe('2026-1');
  });

  it('September is padded as 09', () => {
    const result = monthKeys(new Date('2026-09-15T00:00:00Z'), 1);
    expect(result[0]).toBe('2026-09');
  });

  it('uses UTC months — midnight UTC-5 date does not shift to previous month', () => {
    // 2026-01-01T05:00:00Z is 2026-01-01 in UTC but 2025-12-31 in UTC-5
    const result = monthKeys(new Date('2026-01-01T05:00:00Z'), 1);
    expect(result[0]).toBe('2026-01');
  });

  it('year rollover: 6 months back from February spans prior year', () => {
    const result = monthKeys(new Date('2026-02-15T00:00:00Z'), 6);
    expect(result[0]).toBe('2025-09');
    expect(result[5]).toBe('2026-02');
  });

  it('last entry always matches the "now" month', () => {
    const dates = [
      new Date('2026-01-31T23:59:59Z'),
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-12-15T00:00:00Z'),
    ];
    for (const d of dates) {
      const keys = monthKeys(d, 4);
      const expected = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      expect(keys[keys.length - 1]).toBe(expected);
    }
  });

  it('entries are in ascending order', () => {
    const result = monthKeys(new Date('2026-06-15T00:00:00Z'), 12);
    for (let i = 1; i < result.length; i++) {
      expect(result[i] > result[i - 1]).toBe(true);
    }
  });

  it('no duplicates even when spanning multiple years', () => {
    const result = monthKeys(new Date('2027-01-15T00:00:00Z'), 24);
    const unique = new Set(result);
    expect(unique.size).toBe(24);
  });
});

// ─── Part 2: DB-backed tests ──────────────────────────────────────────────────

describe('getPublishedPostCountsByMonth', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });
  afterAll(() => {
    ws?.cleanup();
  });

  it('returns all-zeros when workspace has no posts', () => {
    const counts = getPublishedPostCountsByMonth(ws.workspaceId, 6, new Date('2026-03-15T00:00:00Z'));
    expect(counts).toHaveLength(6);
    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every(c => c.published === 0)).toBe(true); // every-ok: length guard above
  });

  it('zero-pads months with no posts in them', () => {
    const counts = getPublishedPostCountsByMonth(ws.workspaceId, 3, new Date('2026-03-15T00:00:00Z'));
    const keys = counts.map(c => c.month);
    expect(keys).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('counts a post published in the window correctly', () => {
    const id = randomUUID();
    savePublishedPost(ws.workspaceId, id, '2026-01-10T00:00:00Z');

    const counts = getPublishedPostCountsByMonth(ws.workspaceId, 3, new Date('2026-03-15T00:00:00Z'));
    const jan = counts.find(c => c.month === '2026-01');
    expect(jan?.published).toBe(1);
  });

  it('does not include posts published before the window', () => {
    const id = randomUUID();
    savePublishedPost(ws.workspaceId, id, '2024-01-01T00:00:00Z');

    const counts = getPublishedPostCountsByMonth(ws.workspaceId, 3, new Date('2026-03-15T00:00:00Z'));
    const total = counts.reduce((sum, c) => sum + c.published, 0);
    // only the 2026-01 post from the previous test should show
    expect(total).toBeGreaterThanOrEqual(1);
    const oldKey = counts.find(c => c.month === '2024-01');
    expect(oldKey).toBeUndefined();
  });

  it('months outside the window are not present in the result', () => {
    const counts = getPublishedPostCountsByMonth(ws.workspaceId, 3, new Date('2026-03-15T00:00:00Z'));
    expect(counts.find(c => c.month === '2025-12')).toBeUndefined();
  });

  it('sums multiple posts published in the same month', () => {
    const wsMulti = seedWorkspace();
    try {
      for (let i = 0; i < 3; i++) {
        savePublishedPost(wsMulti.workspaceId, randomUUID(), '2026-02-14T00:00:00Z');
      }
      const counts = getPublishedPostCountsByMonth(wsMulti.workspaceId, 3, new Date('2026-03-15T00:00:00Z'));
      const feb = counts.find(c => c.month === '2026-02');
      expect(feb?.published).toBe(3);
    } finally {
      wsMulti.cleanup();
    }
  });

  it('the `now` parameter controls which month is "current"', () => {
    const wsNow = seedWorkspace();
    try {
      // Publish a post in 2025-06
      savePublishedPost(wsNow.workspaceId, randomUUID(), '2025-06-10T00:00:00Z');

      // With now=2025-06-30, this should appear as the current month
      const counts = getPublishedPostCountsByMonth(wsNow.workspaceId, 3, new Date('2025-06-30T00:00:00Z'));
      const jun = counts.find(c => c.month === '2025-06');
      expect(jun?.published).toBeGreaterThanOrEqual(1);
      expect(counts[counts.length - 1].month).toBe('2025-06');
    } finally {
      wsNow.cleanup();
    }
  });

  it('default months=6 returns 6 entries', () => {
    const counts = getPublishedPostCountsByMonth(ws.workspaceId);
    expect(counts).toHaveLength(6);
  });

  it('result months are in ascending order', () => {
    const counts = getPublishedPostCountsByMonth(ws.workspaceId, 6, new Date('2026-06-15T00:00:00Z'));
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i].month > counts[i - 1].month).toBe(true);
    }
  });

  it('unpublished posts (null publishedAt) are not counted', () => {
    const wsUnpub = seedWorkspace();
    try {
      savePost(wsUnpub.workspaceId, makePost(randomUUID(), wsUnpub.workspaceId, null, 'draft'));
      const counts = getPublishedPostCountsByMonth(wsUnpub.workspaceId, 3, new Date('2026-03-15T00:00:00Z'));
      expect(counts.length).toBeGreaterThan(0);
      expect(counts.every(c => c.published === 0)).toBe(true); // every-ok: length guard above
    } finally {
      wsUnpub.cleanup();
    }
  });
});

describe('getContentVelocityTrend', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });
  afterAll(() => {
    ws?.cleanup();
  });

  it('returns trendPct=null when there are no previous 3 months (previousThreeMonthAvg = 0)', () => {
    const trend = getContentVelocityTrend(ws.workspaceId, 6, new Date('2026-06-15T00:00:00Z'));
    // With no posts, previousThreeMonthAvg = 0, so trendPct must be null
    expect(trend.trendPct).toBeNull();
  });

  it('monthly array has exactly `months` entries', () => {
    const trend = getContentVelocityTrend(ws.workspaceId, 6, new Date('2026-06-15T00:00:00Z'));
    expect(trend.monthly).toHaveLength(6);
  });

  it('currentMonthPublished reflects the last month in the window', () => {
    const wsV = seedWorkspace();
    try {
      savePublishedPost(wsV.workspaceId, randomUUID(), '2026-03-10T00:00:00Z');
      savePublishedPost(wsV.workspaceId, randomUUID(), '2026-03-20T00:00:00Z');

      const trend = getContentVelocityTrend(wsV.workspaceId, 6, new Date('2026-03-31T00:00:00Z'));
      expect(trend.currentMonthPublished).toBe(2);
    } finally {
      wsV.cleanup();
    }
  });

  it('trailingThreeMonthAvg is rounded to 1 decimal', () => {
    const wsV2 = seedWorkspace();
    try {
      // 1 post in each of the last 3 months: avg = 1.0
      for (const month of ['2026-01', '2026-02', '2026-03']) {
        savePublishedPost(wsV2.workspaceId, randomUUID(), `${month}-10T00:00:00Z`);
      }
      const trend = getContentVelocityTrend(wsV2.workspaceId, 6, new Date('2026-03-31T00:00:00Z'));
      expect(trend.trailingThreeMonthAvg).toBe(1.0);
    } finally {
      wsV2.cleanup();
    }
  });

  it('trendPct is positive when trailing avg > previous avg', () => {
    const wsPos = seedWorkspace();
    try {
      const now = new Date('2026-06-30T00:00:00Z');
      // Previous 3 months (Jan/Feb/Mar): 1 post each
      for (const month of ['2026-01', '2026-02', '2026-03']) {
        savePublishedPost(wsPos.workspaceId, randomUUID(), `${month}-10T00:00:00Z`);
      }
      // Trailing 3 months (Apr/May/Jun): 3 posts each
      for (const month of ['2026-04', '2026-05', '2026-06']) {
        for (let i = 0; i < 3; i++) {
          savePublishedPost(wsPos.workspaceId, randomUUID(), `${month}-0${i + 1}T00:00:00Z`);
        }
      }
      const trend = getContentVelocityTrend(wsPos.workspaceId, 6, now);
      expect(trend.trendPct).not.toBeNull();
      expect(trend.trendPct!).toBeGreaterThan(0);
    } finally {
      wsPos.cleanup();
    }
  });

  it('trendPct is negative when trailing avg < previous avg', () => {
    const wsNeg = seedWorkspace();
    try {
      const now = new Date('2026-06-30T00:00:00Z');
      // Previous 3 months: 3 posts each
      for (const month of ['2026-01', '2026-02', '2026-03']) {
        for (let i = 0; i < 3; i++) {
          savePublishedPost(wsNeg.workspaceId, randomUUID(), `${month}-0${i + 1}T00:00:00Z`);
        }
      }
      // Trailing 3 months: 1 post each
      for (const month of ['2026-04', '2026-05', '2026-06']) {
        savePublishedPost(wsNeg.workspaceId, randomUUID(), `${month}-10T00:00:00Z`);
      }
      const trend = getContentVelocityTrend(wsNeg.workspaceId, 6, now);
      expect(trend.trendPct).not.toBeNull();
      expect(trend.trendPct!).toBeLessThan(0);
    } finally {
      wsNeg.cleanup();
    }
  });

  it('previousThreeMonthAvg is rounded to 1 decimal', () => {
    const wsR = seedWorkspace();
    try {
      // 1 post in each of the previous 3 months: avg = 1.0
      for (const month of ['2026-01', '2026-02', '2026-03']) {
        savePublishedPost(wsR.workspaceId, randomUUID(), `${month}-10T00:00:00Z`);
      }
      const trend = getContentVelocityTrend(wsR.workspaceId, 6, new Date('2026-06-30T00:00:00Z'));
      expect(trend.previousThreeMonthAvg).toBe(1.0);
    } finally {
      wsR.cleanup();
    }
  });
});

// ─── updatePostField ──────────────────────────────────────────────────────────

describe('updatePostField', () => {
  let ws: SeededFullWorkspace;
  let postId: string;

  beforeAll(() => {
    ws = seedWorkspace();
  });
  afterAll(() => {
    ws?.cleanup();
  });

  beforeEach(() => {
    postId = randomUUID();
    savePost(ws.workspaceId, makePost(postId, ws.workspaceId, null, 'draft'));
  });

  it('returns null for a non-existent post', () => {
    const result = updatePostField(ws.workspaceId, 'non-existent-post-id', { title: 'New Title' });
    expect(result).toBeNull();
  });

  it('valid transition draft→review succeeds and returns updated post', () => {
    const result = updatePostField(ws.workspaceId, postId, { status: 'review' });
    expect(result).not.toBeNull();
    expect(result!.status).toBe('review');
  });

  it('invalid transition draft→approved throws InvalidTransitionError', () => {
    expect(() => {
      updatePostField(ws.workspaceId, postId, { status: 'approved' });
    }).toThrow(InvalidTransitionError);
  });

  it('invalid transition error message includes entity name and states', () => {
    try {
      updatePostField(ws.workspaceId, postId, { status: 'approved' });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const e = err as InvalidTransitionError;
      expect(e.from).toBe('draft');
      expect(e.to).toBe('approved');
    }
  });

  it('update without status change does not throw', () => {
    const result = updatePostField(ws.workspaceId, postId, { title: 'Updated Title' });
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Updated Title');
  });

  it('non-status field updates are persisted to DB', () => {
    updatePostField(ws.workspaceId, postId, { title: 'Persisted Title', totalWordCount: 999 });
    const reloaded = getPost(ws.workspaceId, postId);
    expect(reloaded?.title).toBe('Persisted Title');
    expect(reloaded?.totalWordCount).toBe(999);
  });

  it('updatedAt is bumped after update', () => {
    const before = getPost(ws.workspaceId, postId)!.updatedAt;
    // Small delay to ensure timestamp differs
    const result = updatePostField(ws.workspaceId, postId, { title: 'Changed' });
    expect(result!.updatedAt >= before).toBe(true);
  });

  it('review→draft is valid (send back for edits)', () => {
    // First advance to review
    updatePostField(ws.workspaceId, postId, { status: 'review' });
    // Then send back to draft
    const result = updatePostField(ws.workspaceId, postId, { status: 'draft' });
    expect(result!.status).toBe('draft');
  });

  it('review→approved is valid', () => {
    updatePostField(ws.workspaceId, postId, { status: 'review' });
    const result = updatePostField(ws.workspaceId, postId, { status: 'approved' });
    expect(result!.status).toBe('approved');
  });

  it('approved is terminal — approved→review throws InvalidTransitionError', () => {
    updatePostField(ws.workspaceId, postId, { status: 'review' });
    updatePostField(ws.workspaceId, postId, { status: 'approved' });
    expect(() => {
      updatePostField(ws.workspaceId, postId, { status: 'review' });
    }).toThrow(InvalidTransitionError);
  });
});

// ─── snapshotPostVersion ──────────────────────────────────────────────────────

describe('snapshotPostVersion', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });
  afterAll(() => {
    ws?.cleanup();
  });

  it('creates a version with versionNumber=1 for first snapshot', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    savePost(ws.workspaceId, post);

    const version = snapshotPostVersion(post, 'manual_edit', 'test detail');
    expect(version.versionNumber).toBe(1);
  });

  it('second snapshot gets versionNumber=2', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    savePost(ws.workspaceId, post);

    snapshotPostVersion(post, 'manual_edit');
    const v2 = snapshotPostVersion(post, 'regenerate_section');
    expect(v2.versionNumber).toBe(2);
  });

  it('version fields match the post fields', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    post.title = 'Snapshot Title';
    post.totalWordCount = 777;
    savePost(ws.workspaceId, post);

    const version = snapshotPostVersion(post, 'manual_edit');
    expect(version.title).toBe('Snapshot Title');
    expect(version.totalWordCount).toBe(777);
    expect(version.postId).toBe(postId);
    expect(version.workspaceId).toBe(ws.workspaceId);
  });

  it('trigger and triggerDetail are stored correctly', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    savePost(ws.workspaceId, post);

    const version = snapshotPostVersion(post, 'regenerate_section', 'section-2');
    expect(version.trigger).toBe('regenerate_section');
    expect(version.triggerDetail).toBe('section-2');
  });

  it('triggerDetail is undefined when not provided', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    savePost(ws.workspaceId, post);

    const version = snapshotPostVersion(post, 'manual_edit');
    expect(version.triggerDetail).toBeUndefined();
  });

  it('version appears in listPostVersions', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    savePost(ws.workspaceId, post);

    snapshotPostVersion(post, 'manual_edit', 'detail-A');
    const versions = listPostVersions(ws.workspaceId, postId);
    expect(versions).toHaveLength(1);
    expect(versions[0].triggerDetail).toBe('detail-A');
  });

  it('listPostVersions returns versions in descending versionNumber order', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    savePost(ws.workspaceId, post);

    snapshotPostVersion(post, 'manual_edit');
    snapshotPostVersion(post, 'regenerate_section');
    snapshotPostVersion(post, 'unification');

    const versions = listPostVersions(ws.workspaceId, postId);
    expect(versions).toHaveLength(3);
    expect(versions[0].versionNumber).toBe(3);
    expect(versions[2].versionNumber).toBe(1);
  });
});

// ─── revertToVersion ──────────────────────────────────────────────────────────

describe('revertToVersion', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace();
  });
  afterAll(() => {
    ws?.cleanup();
  });

  it('returns null if the post does not exist', () => {
    // Create a post in a different workspace so the version exists but the post won't be found
    const otherWs = seedWorkspace();
    try {
      const postId = randomUUID();
      const post = makePost(postId, otherWs.workspaceId, null, 'draft');
      savePost(otherWs.workspaceId, post);
      const version = snapshotPostVersion(post, 'manual_edit');

      // Try to revert in the wrong workspace
      const result = revertToVersion(ws.workspaceId, postId, version.id);
      expect(result).toBeNull();
    } finally {
      otherWs.cleanup();
    }
  });

  it('returns null if the version ID does not exist', () => {
    const postId = randomUUID();
    savePost(ws.workspaceId, makePost(postId, ws.workspaceId, null, 'draft'));

    const result = revertToVersion(ws.workspaceId, postId, 'non-existent-version-id');
    expect(result).toBeNull();
  });

  it('returns null for a cross-post version ID (version belongs to a different post)', () => {
    // Create two posts in the same workspace
    const postAId = randomUUID();
    const postBId = randomUUID();

    const postA = makePost(postAId, ws.workspaceId, null, 'draft');
    const postB = makePost(postBId, ws.workspaceId, null, 'draft');
    savePost(ws.workspaceId, postA);
    savePost(ws.workspaceId, postB);

    // Snapshot postA to create a version
    const versionOfA = snapshotPostVersion(postA, 'manual_edit', 'post-a-snapshot');

    // Attempt to apply postA's version to postB — must be rejected
    const result = revertToVersion(ws.workspaceId, postBId, versionOfA.id);
    expect(result).toBeNull();
  });

  it('successfully reverts post fields to the version snapshot', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    post.title = 'Original Title';
    post.totalWordCount = 100;
    savePost(ws.workspaceId, post);

    // Snapshot the original state
    const version = snapshotPostVersion(post, 'manual_edit', 'original');

    // Update the post
    updatePostField(ws.workspaceId, postId, { title: 'Mutated Title', totalWordCount: 999 });

    // Revert to the snapshot
    const reverted = revertToVersion(ws.workspaceId, postId, version.id);
    expect(reverted).not.toBeNull();
    expect(reverted!.title).toBe('Original Title');
    expect(reverted!.totalWordCount).toBe(100);
  });

  it('post fields in DB match version after revert', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    post.title = 'DB Check Title';
    savePost(ws.workspaceId, post);

    const version = snapshotPostVersion(post, 'manual_edit');
    updatePostField(ws.workspaceId, postId, { title: 'Modified in DB' });
    revertToVersion(ws.workspaceId, postId, version.id);

    const fromDb = getPost(ws.workspaceId, postId);
    expect(fromDb!.title).toBe('DB Check Title');
  });

  it('snapshots current state before reverting (version count increases by 1)', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    savePost(ws.workspaceId, post);

    const version1 = snapshotPostVersion(post, 'manual_edit');

    const beforeCount = listPostVersions(ws.workspaceId, postId).length;
    revertToVersion(ws.workspaceId, postId, version1.id);
    const afterCount = listPostVersions(ws.workspaceId, postId).length;

    expect(afterCount).toBe(beforeCount + 1);
  });

  it('the pre-revert snapshot uses trigger=manual_edit', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    post.title = 'For Trigger Test';
    savePost(ws.workspaceId, post);

    const v1 = snapshotPostVersion(post, 'manual_edit');
    revertToVersion(ws.workspaceId, postId, v1.id);

    // The newest version (versionNumber = highest) is the pre-revert snapshot
    const versions = listPostVersions(ws.workspaceId, postId);
    const newest = versions[0]; // listPostVersions returns DESC
    expect(newest.trigger).toBe('manual_edit');
    expect(newest.triggerDetail).toContain('revert_to_v');
  });

  it('triggerDetail of the pre-revert snapshot references the target version number', () => {
    const postId = randomUUID();
    const post = makePost(postId, ws.workspaceId, null, 'draft');
    savePost(ws.workspaceId, post);

    const v1 = snapshotPostVersion(post, 'manual_edit');
    // v1 has versionNumber=1
    revertToVersion(ws.workspaceId, postId, v1.id);

    const versions = listPostVersions(ws.workspaceId, postId);
    const newest = versions[0];
    expect(newest.triggerDetail).toBe('revert_to_v1');
  });

  it('cross-workspace version rejection: version from workspace B cannot revert post in workspace A', () => {
    const wsB = seedWorkspace();
    try {
      const postAId = randomUUID();
      const postBId = randomUUID();

      savePost(ws.workspaceId, makePost(postAId, ws.workspaceId, null, 'draft'));
      const postB = makePost(postBId, wsB.workspaceId, null, 'draft');
      savePost(wsB.workspaceId, postB);

      // Create a version for post in workspace B
      const versionB = snapshotPostVersion(postB, 'manual_edit');

      // Try to use workspace B's version on workspace A's post
      // getPostVersion scopes by workspaceId, so versionB won't be found under ws.workspaceId
      const result = revertToVersion(ws.workspaceId, postAId, versionB.id);
      expect(result).toBeNull();
    } finally {
      wsB.cleanup();
    }
  });
});
