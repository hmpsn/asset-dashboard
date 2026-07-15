import type {
  ContentBrief,
  ContentTopicRequest,
  GeneratedPost,
  PublicContentPost,
  PublicContentTopicRequest,
} from '../../../shared/types/content.js';

export type PublicContentBrief = Omit<
  ContentBrief,
  'sourceEvidence' | 'generationRevision' | 'generationProvenance'
>;

export type ExportedContentBrief = Omit<
  ContentBrief,
  'generationRevision' | 'generationProvenance'
>;

const BRIEF_VISIBLE_STATUSES = new Set<ContentTopicRequest['status']>([
  'client_review',
  'approved',
  'changes_requested',
  'in_progress',
  'delivered',
  'published',
]);

const POST_VISIBLE_STATUSES = new Set<ContentTopicRequest['status']>([
  'post_review',
  'delivered',
  'published',
]);

/** Preserve the established public GET visibility rules for every response. */
export function toPublicContentTopicRequest(
  request: ContentTopicRequest,
): PublicContentTopicRequest {
  const deliveryVisible = request.status === 'delivered' || request.status === 'published';
  const postVisible = POST_VISIBLE_STATUSES.has(request.status)
    || (request.status === 'changes_requested' && request.serviceType === 'full_post');
  return {
    id: request.id,
    topic: request.topic,
    targetKeyword: request.targetKeyword,
    intent: request.intent,
    priority: request.priority,
    status: request.status,
    source: request.source,
    serviceType: request.serviceType ?? 'brief_only',
    pageType: request.pageType ?? 'blog',
    upgradedAt: request.upgradedAt,
    comments: request.comments ?? [],
    requestedAt: request.requestedAt,
    updatedAt: request.updatedAt,
    deliveryUrl: deliveryVisible ? request.deliveryUrl : undefined,
    deliveryNotes: deliveryVisible ? request.deliveryNotes : undefined,
    briefId: BRIEF_VISIBLE_STATUSES.has(request.status) ? request.briefId : undefined,
    postId: postVisible ? request.postId : undefined,
    clientFeedback: request.clientFeedback,
  };
}

/** Explicit client projection; generation authority and raw evidence remain server-internal. */
export function toPublicContentBrief(brief: ContentBrief): PublicContentBrief {
  const {
    sourceEvidence: _sourceEvidence,
    generationRevision: _generationRevision,
    generationProvenance: _generationProvenance,
    ...publicBrief
  } = brief;
  return publicBrief;
}

/** Explicit client projection; QA diagnostics and generation authority remain server-internal. */
export function toPublicContentPost(post: GeneratedPost): PublicContentPost {
  const {
    aiReview: _aiReview,
    generationDiagnostics: _generationDiagnostics,
    generationRevision: _generationRevision,
    generationProvenance: _generationProvenance,
    plannedPublishAt: _plannedPublishAt,
    ...publicPost
  } = post;
  return publicPost;
}

/** Download projection; exports must not become an internal provenance exfiltration path. */
export function toExportedContentBrief(brief: ContentBrief): ExportedContentBrief {
  const {
    generationRevision: _generationRevision,
    generationProvenance: _generationProvenance,
    ...exportedBrief
  } = brief;
  return exportedBrief;
}
