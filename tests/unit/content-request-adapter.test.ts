import { describe, it, expect } from 'vitest';
import { getAdapter } from '../../server/domains/inbox/deliverable-adapters/types.js';
// Importing the barrel self-registers the PR-1e content_request adapter (+ the others).
import '../../server/domains/inbox/deliverable-adapters/index.js';
import type { ProjectedContentRequestPayload } from '../../server/domains/inbox/deliverable-adapters/content-request.js';
import type {
  ContentTopicRequest,
  ContentRequestComment,
} from '../../shared/types/content.js';
import type { ContentRequestStatus } from '../../server/state-machines.js';

const WS = 'content-request-adapter-test';
const REQ = 'ctr-1';

// ── Fixtures ──

const COMMENT_CLIENT: ContentRequestComment = {
  id: 'cmt-1',
  author: 'client',
  content: 'Please tighten the intro.',
  createdAt: '2026-05-30T11:30:00.000Z',
};
const COMMENT_TEAM: ContentRequestComment = {
  id: 'cmt-2',
  author: 'team',
  content: 'Updated — take another look.',
  createdAt: '2026-05-30T12:00:00.000Z',
};

function makeRequest(over: Partial<ContentTopicRequest> = {}): ContentTopicRequest {
  return {
    id: REQ,
    workspaceId: WS,
    topic: 'Best running shoes for flat feet',
    targetKeyword: 'running shoes flat feet',
    intent: 'commercial',
    priority: 'high',
    rationale: 'High-volume gap with buyer intent.',
    status: 'client_review',
    briefId: 'brief-1',
    postId: undefined,
    serviceType: 'brief_only',
    pageType: 'blog',
    upgradedAt: undefined,
    deliveryUrl: undefined,
    comments: [COMMENT_CLIENT, COMMENT_TEAM],
    requestedAt: '2026-05-30T10:00:00.000Z',
    updatedAt: '2026-05-30T12:00:00.000Z',
    ...over,
  };
}

// ── Registration ──

describe('content_request adapter — registration', () => {
  it('is registered via the barrel as a projected review type with apply disabled', () => {
    const adapter = getAdapter('content_request');
    expect(adapter.type).toBe('content_request');
    // content_request's terminal side-effects live in the source path — no unified auto-apply.
    expect(adapter.appliesOnApprove).toBeFalsy();
    // PROJECTED type — it implements projectFromSource (the real path for content_request).
    expect(typeof adapter.projectFromSource).toBe('function');
  });
});

// ── projectFromSource: the real path ──

describe('content_request adapter — projectFromSource (the projected read path)', () => {
  it('produces a faithful ClientDeliverable from a content request', () => {
    const adapter = getAdapter('content_request');
    const request = makeRequest({
      status: 'changes_requested',
      briefId: 'brief-1',
      postId: 'post-1',
      serviceType: 'full_post',
      deliveryUrl: 'https://example.com/post',
      upgradedAt: '2026-05-29T09:00:00.000Z',
      comments: [COMMENT_CLIENT, COMMENT_TEAM],
    });

    const deliverable = adapter.projectFromSource!(request);

    // identity + classification
    expect(deliverable.type).toBe('content_request');
    expect(deliverable.kind).toBe('review');
    expect(deliverable.workspaceId).toBe(WS);
    expect(deliverable.externalRef).toBe(REQ);
    expect(deliverable.id).toBe(`content_request:${REQ}`);
    expect(deliverable.sourceRef).toBe(`content_request:${REQ}`);
    expect(deliverable.source).toBe('content_request');

    const payload = deliverable.payload as unknown as ProjectedContentRequestPayload;
    expect(payload.family).toBe('content_request');
    // FKs preserved (no fallback)
    expect(payload.briefId).toBe('brief-1');
    expect(payload.postId).toBe('post-1');
    // brief-vs-post discriminators
    expect(payload.serviceType).toBe('full_post');
    expect(payload.hasBrief).toBe(true);
    expect(payload.hasPost).toBe(true);
    expect(payload.pageType).toBe('blog');
    // deliveryUrl + upgradedAt preserved (no fallback)
    expect(payload.deliveryUrl).toBe('https://example.com/post');
    expect(payload.upgradedAt).toBe('2026-05-29T09:00:00.000Z');
    // the FULL comment thread carried verbatim (no truncation, no fallback)
    expect(payload.comments).toEqual([COMMENT_CLIENT, COMMENT_TEAM]);
    expect(payload.comments).toHaveLength(2);
  });

  it('ALWAYS carries the raw contentRequestStatus in payload (production state never lost)', () => {
    const adapter = getAdapter('content_request');
    // An INTERNAL state that folds to draft must still surface its raw production state.
    const deliverable = adapter.projectFromSource!(makeRequest({ status: 'in_progress' }));
    expect(deliverable.status).toBe('draft'); // canonical
    const payload = deliverable.payload as unknown as ProjectedContentRequestPayload;
    expect(payload.contentRequestStatus).toBe('in_progress'); // raw production state carried
  });

  it('carries the raw status even for a TERMINAL delivered/published request', () => {
    const adapter = getAdapter('content_request');
    const delivered = adapter.projectFromSource!(makeRequest({ status: 'delivered' }));
    expect(delivered.status).toBe('applied');
    expect(
      (delivered.payload as unknown as ProjectedContentRequestPayload).contentRequestStatus,
    ).toBe('delivered');

    const published = adapter.projectFromSource!(makeRequest({ status: 'published' }));
    expect(published.status).toBe('applied');
    expect(
      (published.payload as unknown as ProjectedContentRequestPayload).contentRequestStatus,
    ).toBe('published');
  });

  it('keeps null FKs/deliveryUrl/upgradedAt when absent (not coerced to a string)', () => {
    const adapter = getAdapter('content_request');
    const deliverable = adapter.projectFromSource!(
      makeRequest({ briefId: undefined, postId: undefined, deliveryUrl: undefined, upgradedAt: undefined }),
    );
    const payload = deliverable.payload as unknown as ProjectedContentRequestPayload;
    expect(payload.briefId).toBeNull();
    expect(payload.postId).toBeNull();
    expect(payload.deliveryUrl).toBeNull();
    expect(payload.upgradedAt).toBeNull();
    expect(payload.hasBrief).toBe(false);
    expect(payload.hasPost).toBe(false);
  });

  it('preserves an EMPTY comment thread (does not invent comments)', () => {
    const adapter = getAdapter('content_request');
    const deliverable = adapter.projectFromSource!(makeRequest({ comments: [] }));
    const payload = deliverable.payload as unknown as ProjectedContentRequestPayload;
    expect(payload.comments).toEqual([]);
  });

  it('preserves a comment thread when the optional field is absent (defaults to [])', () => {
    const adapter = getAdapter('content_request');
    const deliverable = adapter.projectFromSource!(makeRequest({ comments: undefined }));
    const payload = deliverable.payload as unknown as ProjectedContentRequestPayload;
    expect(payload.comments).toEqual([]);
  });

  it('carries generatedAt = requestedAt and updatedAt from the source (not "now")', () => {
    const adapter = getAdapter('content_request');
    const deliverable = adapter.projectFromSource!(
      makeRequest({ requestedAt: '2026-05-30T10:00:00.000Z', updatedAt: '2026-05-31T12:00:00.000Z' }),
    );
    expect(deliverable.generatedAt).toBe('2026-05-30T10:00:00.000Z');
    expect(deliverable.createdAt).toBe('2026-05-30T10:00:00.000Z');
    expect(deliverable.updatedAt).toBe('2026-05-31T12:00:00.000Z');
  });

  it('renders the post-review title when a post exists, brief-review title otherwise', () => {
    const adapter = getAdapter('content_request');
    const brief = adapter.projectFromSource!(makeRequest({ postId: undefined }));
    expect(brief.title).toContain('Brief Review');
    const post = adapter.projectFromSource!(makeRequest({ postId: 'post-1' }));
    expect(post.title).toContain('Post Review');
  });
});

// ── status mapping: ALL 11 states of the pipeline ──

describe('content_request adapter — status mapping (10-state pipeline → canonical)', () => {
  const adapter = getAdapter('content_request');

  // Full mapping table (M4). Includes the two emphasized in scope:
  //   post_review → awaiting_client, delivered/published → applied, internal → draft.
  const cases: Array<[ContentRequestStatus, string]> = [
    // client-facing
    ['client_review', 'awaiting_client'],
    ['post_review', 'awaiting_client'], // post review IS a client-facing review
    ['changes_requested', 'changes_requested'],
    ['approved', 'approved'],
    ['declined', 'declined'],
    // internal production/monetization → draft
    ['pending_payment', 'draft'],
    ['requested', 'draft'],
    ['brief_generated', 'draft'],
    ['in_progress', 'draft'],
    // terminal delivery → applied
    ['delivered', 'applied'],
    ['published', 'applied'],
  ];

  it('covers every state in CONTENT_REQUEST_TRANSITIONS (no state untested)', async () => {
    const { CONTENT_REQUEST_TRANSITIONS } = await import('../../server/state-machines.js');
    const machineStates = Object.keys(CONTENT_REQUEST_TRANSITIONS).sort();
    const testedStates = cases.map(([s]) => s).sort();
    expect(testedStates).toEqual(machineStates);
  });

  it.each(cases)('status %s maps to canonical %s', (status, expected) => {
    const deliverable = adapter.projectFromSource!(makeRequest({ status }));
    expect(deliverable.status).toBe(expected);
    // raw production state is ALWAYS carried alongside the canonical mapping.
    const payload = deliverable.payload as unknown as ProjectedContentRequestPayload;
    expect(payload.contentRequestStatus).toBe(status);
  });

  it('post_review maps to awaiting_client (post review IS a client-facing review)', () => {
    const deliverable = adapter.projectFromSource!(makeRequest({ status: 'post_review' }));
    expect(deliverable.status).toBe('awaiting_client');
  });

  it('decidedAt is set on approved/declined/changes_requested, null otherwise', () => {
    expect(adapter.projectFromSource!(makeRequest({ status: 'approved' })).decidedAt).not.toBeNull();
    expect(adapter.projectFromSource!(makeRequest({ status: 'declined' })).decidedAt).not.toBeNull();
    expect(
      adapter.projectFromSource!(makeRequest({ status: 'changes_requested' })).decidedAt,
    ).not.toBeNull();
    expect(adapter.projectFromSource!(makeRequest({ status: 'requested' })).decidedAt).toBeNull();
  });

  it('appliedAt is set on delivered/published (terminal), null otherwise', () => {
    expect(adapter.projectFromSource!(makeRequest({ status: 'delivered' })).appliedAt).not.toBeNull();
    expect(adapter.projectFromSource!(makeRequest({ status: 'published' })).appliedAt).not.toBeNull();
    expect(adapter.projectFromSource!(makeRequest({ status: 'approved' })).appliedAt).toBeNull();
  });
});

// ── sourceRef (stable per-request) ──

describe('content_request adapter — sourceRef (stable per-request)', () => {
  it('sourceRef → content_request:<id>', () => {
    expect(getAdapter('content_request').sourceRef(makeRequest())).toBe(`content_request:${REQ}`);
  });

  it('sourceRef is null when the request has no id', () => {
    expect(getAdapter('content_request').sourceRef(makeRequest({ id: '' }))).toBeNull();
  });

  it('sourceRef is STABLE across two projections of the same request (status changed)', () => {
    const adapter = getAdapter('content_request');
    const a = adapter.sourceRef(makeRequest({ status: 'client_review' }));
    const b = adapter.sourceRef(makeRequest({ status: 'approved' }));
    expect(a).toBe(b);
  });
});

// ── validateSendable ──

describe('content_request adapter — validateSendable', () => {
  const adapter = getAdapter('content_request');

  it('a request with a generated brief IS reviewable', () => {
    expect(adapter.validateSendable(makeRequest({ briefId: 'brief-1', postId: undefined }))).toEqual({
      ok: true,
    });
  });

  it('a request with a generated post IS reviewable', () => {
    expect(adapter.validateSendable(makeRequest({ briefId: undefined, postId: 'post-1' }))).toEqual({
      ok: true,
    });
  });

  it('rejects a request with no brief and no post (nothing to review yet)', () => {
    const res = adapter.validateSendable(makeRequest({ briefId: undefined, postId: undefined }));
    expect(res).toEqual({
      ok: false,
      reason: 'content request has no reviewable content (no brief or post generated yet)',
    });
  });
});

// ── buildPayload (interface completeness — not content_request's real send path) ──

describe('content_request adapter — buildPayload (interface completeness)', () => {
  it('builds a kind:review payload with NO child items (a brief/post is one review artifact)', () => {
    const built = getAdapter('content_request').buildPayload(makeRequest());
    expect(built.kind).toBe('review');
    expect(built.items).toBeUndefined();
    expect(built.externalRef).toBe(REQ);
    const payload = built.payload as unknown as ProjectedContentRequestPayload;
    expect(payload.family).toBe('content_request');
    expect(payload.comments).toHaveLength(2);
    // build + project share the builder — the raw status is carried both ways.
    expect(payload.contentRequestStatus).toBe('client_review');
  });
});

// ── apply disabled (D-apply) ──

describe('content_request adapter — apply stays disabled', () => {
  it('apply stub throws (post-delivery side-effects live in the source path)', async () => {
    const adapter = getAdapter('content_request');
    await expect(adapter.applyDeliverable!({} as never)).rejects.toThrow(
      /disabled|D-apply|source path/i,
    );
  });
});
