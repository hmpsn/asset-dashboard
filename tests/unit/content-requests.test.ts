import { beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  addComment,
  createContentRequest,
  deleteContentRequest,
  getContentRequest,
  listContentRequests,
  updateContentRequest,
} from '../../server/content-requests.js';

const WS_ID = `ws_content_requests_${Date.now()}`;
const OTHER_WS_ID = `ws_content_requests_other_${Date.now()}`;

function cleanupWorkspace(workspaceId: string): void {
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_posts WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(workspaceId);
}

function seedLinkedArtifacts(
  requestId: string,
  options: { linkToRequest?: boolean } = {},
): { briefId: string; postId: string } {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const briefId = `brief_request_revision_${suffix}`;
  const postId = `post_request_revision_${suffix}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_briefs (
      id, workspace_id, target_keyword, secondary_keywords, suggested_title,
      suggested_meta_desc, outline, word_count_target, intent, audience,
      competitor_insights, internal_link_suggestions, created_at
    ) VALUES (?, ?, 'request safety', '[]', 'Request safety', 'Meta', '[]', 500,
      'informational', 'operators', '', '[]', ?)
  `).run(briefId, WS_ID, now);
  db.prepare(`
    INSERT INTO content_posts (
      id, workspace_id, brief_id, target_keyword, title, meta_description,
      introduction, sections, conclusion, total_word_count, target_word_count,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, 'request safety', 'Request safety', 'Meta', '', '[]', '',
      0, 500, 'draft', ?, ?)
  `).run(postId, WS_ID, briefId, now, now);
  if (options.linkToRequest !== false) {
    db.prepare(`
      UPDATE content_topic_requests
      SET brief_id = ?, post_id = ?
      WHERE id = ? AND workspace_id = ?
    `).run(briefId, postId, requestId, WS_ID);
  }
  return { briefId, postId };
}

function artifactRevisions(briefId: string, postId: string): { brief: number; post: number } {
  const brief = db.prepare('SELECT generation_revision AS revision FROM content_briefs WHERE id = ? AND workspace_id = ?')
    .get(briefId, WS_ID) as { revision: number };
  const post = db.prepare('SELECT generation_revision AS revision FROM content_posts WHERE id = ? AND workspace_id = ?')
    .get(postId, WS_ID) as { revision: number };
  return { brief: brief.revision, post: post.revision };
}

function createRequest(overrides: Partial<Parameters<typeof createContentRequest>[1]> = {}) {
  return createContentRequest(WS_ID, {
    topic: 'Build a better SEO reporting page',
    targetKeyword: `seo reporting ${Date.now()} ${Math.random()}`,
    intent: 'commercial',
    priority: 'high',
    rationale: 'Important conversion page gap',
    clientNote: 'Client wants this soon',
    source: 'client',
    serviceType: 'brief_only',
    pageType: 'service',
    targetPageId: 'page_123',
    targetPageSlug: '/services/reporting',
    dedupe: false,
    ...overrides,
  });
}

beforeEach(() => {
  cleanupWorkspace(WS_ID);
  cleanupWorkspace(OTHER_WS_ID);
});

describe('content-requests store', () => {
  it('creates, retrieves, lists, and deletes a request', () => {
    expect(listContentRequests(WS_ID)).toEqual([]);

    const request = createRequest({ targetKeyword: 'technical seo audit' });

    expect(request.status).toBe('requested');
    expect(request.source).toBe('client');
    expect(request.pageType).toBe('service');
    expect(request.targetPageSlug).toBe('/services/reporting');

    expect(getContentRequest(WS_ID, request.id)?.targetKeyword).toBe('technical seo audit');
    expect(getContentRequest(OTHER_WS_ID, request.id)).toBeUndefined();
    expect(listContentRequests(WS_ID).map(item => item.id)).toEqual([request.id]);

    expect(deleteContentRequest(WS_ID, request.id)).toBe(true);
    expect(getContentRequest(WS_ID, request.id)).toBeUndefined();
    expect(deleteContentRequest(WS_ID, request.id)).toBe(false);
  });

  it('dedupes active keyword requests but allows a new one after decline', () => {
    const first = createRequest({ targetKeyword: 'duplicate keyword', dedupe: true });
    const deduped = createRequest({ targetKeyword: 'duplicate keyword', topic: 'Different topic', dedupe: true });

    expect(deduped.id).toBe(first.id);
    expect(deduped.topic).toBe('Build a better SEO reporting page');

    updateContentRequest(WS_ID, first.id, { status: 'declined', declineReason: 'Not a priority' });
    const replacement = createRequest({ targetKeyword: 'duplicate keyword', topic: 'Replacement topic', dedupe: true });

    expect(replacement.id).not.toBe(first.id);
    expect(replacement.topic).toBe('Replacement topic');
  });

  it('updates only provided fields and preserves omitted values', () => {
    const request = createRequest({ targetKeyword: 'partial update keyword' });

    const updated = updateContentRequest(WS_ID, request.id, {
      status: 'brief_generated',
      briefId: 'brief_123',
      internalNote: 'Ready for review',
      deliveryNotes: undefined,
    });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('brief_generated');
    expect(updated!.briefId).toBe('brief_123');
    expect(updated!.internalNote).toBe('Ready for review');
    expect(updated!.clientNote).toBe('Client wants this soon');
    expect(updated!.deliveryNotes).toBeUndefined();
    expect(updated!.updatedAt >= request.updatedAt).toBe(true);
  });

  it('updates the client-facing note and preserves true no-op authority', () => {
    const request = createRequest({ targetKeyword: 'client note update' });

    const updated = updateContentRequest(WS_ID, request.id, {
      clientNote: 'Review the client-visible positioning note.',
    });

    expect(updated?.clientNote).toBe('Review the client-visible positioning note.');
    expect(updated?.internalNote).toBeUndefined();
    expect(getContentRequest(WS_ID, request.id)?.clientNote)
      .toBe('Review the client-visible positioning note.');

    const unchanged = updateContentRequest(WS_ID, request.id, {
      clientNote: 'Review the client-visible positioning note.',
    });
    expect(unchanged?.updatedAt).toBe(updated?.updatedAt);
  });

  it('advances the request authority token even when wall time is behind it', () => {
    const request = createRequest({ targetKeyword: 'monotonic request authority' });
    const futureUpdatedAt = '2099-01-01T00:00:00.000Z';
    db.prepare(`
      UPDATE content_topic_requests
      SET updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `).run(futureUpdatedAt, request.id, WS_ID);

    const updated = updateContentRequest(WS_ID, request.id, { status: 'brief_generated' });
    expect(updated?.updatedAt).toBe('2099-01-01T00:00:00.001Z');

    const commented = addComment(WS_ID, request.id, 'client', 'A newer authority decision.');
    expect(commented?.updatedAt).toBe('2099-01-01T00:00:00.002Z');
  });

  it('guards invalid status transitions and missing rows', () => {
    const request = createRequest();
    updateContentRequest(WS_ID, request.id, { status: 'published' });

    expect(() => updateContentRequest(WS_ID, request.id, { status: 'requested' })).toThrow(
      /Invalid content_request transition/,
    );
    expect(updateContentRequest(WS_ID, 'missing_request', { status: 'approved' })).toBeNull();
  });

  it('appends comments without losing existing request fields', () => {
    const request = createRequest({ targetKeyword: 'commented keyword' });

    const withClientComment = addComment(WS_ID, request.id, 'client', 'Can we emphasize reporting clarity?');
    const withTeamComment = addComment(WS_ID, request.id, 'team', 'Added to next draft.');

    expect(withClientComment?.comments).toHaveLength(1);
    expect(withTeamComment?.comments).toHaveLength(2);
    expect(withTeamComment?.comments?.map(comment => comment.author)).toEqual(['client', 'team']);
    expect(withTeamComment?.targetPageId).toBe('page_123');
    expect(addComment(WS_ID, 'missing_request', 'team', 'Nope')).toBeNull();
  });

  it('bumps linked artifact revisions once per request mutation and not for no-ops', () => {
    const request = createRequest({ targetKeyword: 'linked revision safety' });
    const { briefId, postId } = seedLinkedArtifacts(request.id);

    updateContentRequest(WS_ID, request.id, { status: 'brief_generated' });
    expect(artifactRevisions(briefId, postId)).toEqual({ brief: 1, post: 1 });

    updateContentRequest(WS_ID, request.id, { status: 'brief_generated' });
    expect(artifactRevisions(briefId, postId)).toEqual({ brief: 1, post: 1 });

    addComment(WS_ID, request.id, 'client', 'Please emphasize the implementation details.');
    expect(artifactRevisions(briefId, postId)).toEqual({ brief: 2, post: 2 });

    expect(deleteContentRequest(WS_ID, request.id)).toBe(true);
    expect(artifactRevisions(briefId, postId)).toEqual({ brief: 3, post: 3 });
  });

  it('does not stale a newly linked generated artifact during request finalization', () => {
    const request = createRequest({ targetKeyword: 'fresh generation link safety' });
    const { briefId, postId } = seedLinkedArtifacts(request.id, { linkToRequest: false });

    updateContentRequest(WS_ID, request.id, {
      status: 'brief_generated',
      briefId,
      postId,
    });
    expect(artifactRevisions(briefId, postId)).toEqual({ brief: 0, post: 0 });

    updateContentRequest(WS_ID, request.id, { status: 'in_progress' });
    expect(artifactRevisions(briefId, postId)).toEqual({ brief: 1, post: 1 });
  });

  it('conditionally bumps a newly linked review target in the request transaction', () => {
    const request = createRequest({ targetKeyword: 'atomic review target link' });
    const { briefId, postId } = seedLinkedArtifacts(request.id, { linkToRequest: false });

    const updated = updateContentRequest(
      WS_ID,
      request.id,
      { status: 'brief_generated', briefId },
      {
        linkedArtifactAuthority: {
          artifactType: 'content_brief',
          artifactId: briefId,
          expectedRevision: 0,
        },
      },
    );

    expect(updated?.briefId).toBe(briefId);
    expect(artifactRevisions(briefId, postId)).toEqual({ brief: 1, post: 0 });
  });

  it('rolls back a new review link when its expected artifact revision is stale', () => {
    const request = createRequest({ targetKeyword: 'stale review target link' });
    const { briefId, postId } = seedLinkedArtifacts(request.id, { linkToRequest: false });

    expect(() => updateContentRequest(
      WS_ID,
      request.id,
      { status: 'brief_generated', briefId },
      {
        linkedArtifactAuthority: {
          artifactType: 'content_brief',
          artifactId: briefId,
          expectedRevision: 99,
        },
      },
    )).toThrow('changed while generation was running');

    expect(getContentRequest(WS_ID, request.id)).toMatchObject({
      status: 'requested',
      briefId: undefined,
    });
    expect(artifactRevisions(briefId, postId)).toEqual({ brief: 0, post: 0 });
  });

  it('rolls back the request transition when a linked revision bump fails', () => {
    const request = createRequest({ targetKeyword: 'atomic linked revision safety' });
    const { briefId, postId } = seedLinkedArtifacts(request.id);
    db.exec(`
      CREATE TEMP TRIGGER fail_content_post_revision_bump
      BEFORE UPDATE OF generation_revision ON content_posts
      BEGIN
        SELECT RAISE(ABORT, 'forced linked revision failure');
      END
    `);
    try {
      expect(() => updateContentRequest(WS_ID, request.id, { status: 'brief_generated' }))
        .toThrow('forced linked revision failure');
      expect(getContentRequest(WS_ID, request.id)?.status).toBe('requested');
      expect(artifactRevisions(briefId, postId)).toEqual({ brief: 0, post: 0 });
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fail_content_post_revision_bump');
    }
  });
});
