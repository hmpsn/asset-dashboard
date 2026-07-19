import { describe, expect, it } from 'vitest';
import type { ContentBrief, ContentTopicRequest, GeneratedPost } from '../../shared/types/content.js';
import {
  toExportedContentBrief,
  toPublicContentBrief,
  toPublicContentPost,
  toPublicContentTopicRequest,
} from '../../server/domains/content/public-projections.js';

const provenance = {
  runId: 'run_1',
  operation: 'content-brief-generate',
  provider: 'openai' as const,
  model: 'gpt-5.6-terra',
  inputFingerprint: 'a'.repeat(64),
  startedAt: '2026-07-13T10:00:00.000Z',
  completedAt: '2026-07-13T10:00:01.000Z',
};

function brief(): ContentBrief {
  return {
    id: 'brief_1',
    workspaceId: 'ws_1',
    targetKeyword: 'safe generation',
    secondaryKeywords: [],
    suggestedTitle: 'Safe generation',
    suggestedMetaDesc: 'A safe brief',
    outline: [],
    wordCountTarget: 800,
    intent: 'informational',
    audience: 'operators',
    competitorInsights: [],
    internalLinkSuggestions: [],
    sourceEvidence: {
      capturedAt: '2026-07-13T09:59:00.000Z',
      serpResults: [{
        position: 1,
        title: 'Private source',
        url: 'https://example.com',
        snippet: 'private evidence',
      }],
    },
    generationRevision: 4,
    generationProvenance: provenance,
    createdAt: '2026-07-13T10:00:00.000Z',
  };
}

function post(): GeneratedPost {
  return {
    id: 'post_1',
    workspaceId: 'ws_1',
    briefId: 'brief_1',
    targetKeyword: 'safe generation',
    title: 'Safe generation',
    metaDescription: 'A safe post',
    introduction: '<p>Intro</p>',
    sections: [],
    conclusion: '<p>Conclusion</p>',
    totalWordCount: 2,
    targetWordCount: 800,
    status: 'draft',
    aiReview: {
      review: {
        factual_accuracy: { pass: true, reason: 'private QA' },
        brand_voice: { pass: true, reason: 'private QA' },
        internal_links: { pass: true, reason: 'private QA' },
        no_hallucinations: { pass: true, reason: 'private QA' },
        meta_optimized: { pass: true, reason: 'private QA' },
        word_count_target: { pass: true, reason: 'private QA' },
      },
      reviewedAt: '2026-07-13T10:00:01.000Z',
    },
    generationDiagnostics: [{
      stage: 'introduction',
      code: 'provider_error',
      message: 'private diagnostic',
      occurredAt: '2026-07-13T10:00:00.500Z',
    }],
    generationRevision: 7,
    generationProvenance: { ...provenance, operation: 'content-post-section' },
    plannedPublishAt: '2026-07-20T12:00:00.000Z',
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:00:01.000Z',
  };
}

function topicRequest(
  overrides: Partial<ContentTopicRequest> = {},
): ContentTopicRequest {
  return {
    id: 'request_1',
    workspaceId: 'ws_private',
    topic: 'Public request projection',
    targetKeyword: 'public request projection',
    intent: 'commercial',
    priority: 'high',
    rationale: 'operator-only strategic rationale',
    status: 'requested',
    briefId: 'brief_private',
    postId: 'post_private',
    clientNote: 'client input retained internally',
    internalNote: 'operator-only note sentinel',
    declineReason: 'operator-visible decline reason',
    clientFeedback: 'Public review feedback',
    source: 'strategy',
    serviceType: 'full_post',
    pageType: 'service',
    upgradedAt: '2026-07-13T10:00:00.000Z',
    deliveryUrl: 'https://example.test/private-delivery',
    deliveryNotes: 'Delivery details',
    targetPageId: 'page_private',
    targetPageSlug: '/private-target',
    recommendationId: 'recommendation_private',
    strategyCardContext: { rationale: 'private strategy context', volume: 400 },
    comments: [{
      id: 'comment_1',
      author: 'team',
      content: 'Visible review comment',
      createdAt: '2026-07-13T10:00:00.000Z',
    }],
    requestedAt: '2026-07-13T09:00:00.000Z',
    updatedAt: '2026-07-13T10:00:00.000Z',
    ...overrides,
  };
}

describe('content public projections', () => {
  it('removes evidence and generation authority from public briefs', () => {
    const projected = toPublicContentBrief(brief());
    expect(projected).not.toHaveProperty('sourceEvidence');
    expect(projected).not.toHaveProperty('generationRevision');
    expect(projected).not.toHaveProperty('generationProvenance');
    expect(projected).not.toHaveProperty('plannedPublishAt');
  });

  it('removes QA and generation authority from public posts', () => {
    const projected = toPublicContentPost(post());
    expect(projected).not.toHaveProperty('aiReview');
    expect(projected).not.toHaveProperty('generationDiagnostics');
    expect(projected).not.toHaveProperty('generationRevision');
    expect(projected).not.toHaveProperty('generationProvenance');
  });

  it('uses an explicit request projection that omits workspace and operator-only fields', () => {
    const projected = toPublicContentTopicRequest(topicRequest());

    expect(projected).toEqual({
      id: 'request_1',
      topic: 'Public request projection',
      targetKeyword: 'public request projection',
      intent: 'commercial',
      priority: 'high',
      status: 'requested',
      source: 'strategy',
      serviceType: 'full_post',
      pageType: 'service',
      upgradedAt: '2026-07-13T10:00:00.000Z',
      comments: [{
        id: 'comment_1',
        author: 'team',
        content: 'Visible review comment',
        createdAt: '2026-07-13T10:00:00.000Z',
      }],
      requestedAt: '2026-07-13T09:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
      deliveryUrl: undefined,
      deliveryNotes: undefined,
      briefId: undefined,
      postId: undefined,
      clientFeedback: 'Public review feedback',
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /ws_private|operator-only|page_private|private-target|recommendation_private|private strategy context/,
    );
  });

  it('preserves the established status-gated request artifact visibility', () => {
    expect(toPublicContentTopicRequest(topicRequest({ status: 'client_review' }))).toMatchObject({
      briefId: 'brief_private',
    });
    expect(toPublicContentTopicRequest(topicRequest({ status: 'post_review' }))).toMatchObject({
      postId: 'post_private',
    });
    expect(toPublicContentTopicRequest(topicRequest({ status: 'changes_requested' }))).toMatchObject({
      briefId: 'brief_private',
      postId: 'post_private',
    });
    expect(toPublicContentTopicRequest(topicRequest({ status: 'delivered' }))).toMatchObject({
      briefId: 'brief_private',
      postId: 'post_private',
      deliveryUrl: 'https://example.test/private-delivery',
      deliveryNotes: 'Delivery details',
    });
  });

  it('keeps evidence available to admin exports but removes generation authority', () => {
    const projected = toExportedContentBrief(brief());
    expect(projected.sourceEvidence?.serpResults).toHaveLength(1);
    expect(projected).not.toHaveProperty('generationRevision');
    expect(projected).not.toHaveProperty('generationProvenance');
  });
});
