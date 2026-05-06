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
});
