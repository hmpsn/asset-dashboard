/**
 * The Issue — Phase 5 four-jobs lens contracts.
 *
 * Two ADMIN read-projections of the already-curated Issue rec set (spec §9):
 *   - Job #4 keyword targets: curated keyword_gap + topic_cluster recs, deep-linked into the
 *     Keyword Hub.
 *   - Job #3 content work-orders: curated content + content_refresh recs, joined to their
 *     content_topic_requests for a production stage, deep-linked into the content pipeline.
 *
 * Pure projections — no new source of truth. The server builds these from loadRecommendations +
 * listContentRequests; the admin cockpit renders them and constructs the deep-links. Shared by
 * server/strategy-issue-lenses.ts + the admin lens components + the contract tests.
 */
import type { RecPriority } from './recommendations.js';

/** One curated keyword/topic target (job #4). */
export interface KeywordTargetRow {
  recId: string;
  type: 'keyword_gap' | 'topic_cluster';
  /** The keyword (keyword_gap) or topic (topic_cluster) — the operator-legible target label. */
  label: string;
  /** Term used to seed the Keyword Hub `?q=` deep-link; null when neither targetKeyword nor a
   *  parseable source term resolves (the row then renders without a deep-link). */
  deepLinkKeyword: string | null;
  clientStatus: string;
  priority: RecPriority;
  /** isCuratedForClient — already in front of the client (vs merely active/proposable). */
  sent: boolean;
}

/** Production stage of a content work-order, derived from its linked content_topic_request status. */
export type ContentWorkOrderStage =
  | 'not_started'      // no linked content request yet (the operator hasn't acted/created one)
  | 'queued'           // request exists, work not started (pending_payment | requested | brief_generated)
  | 'in_progress'      // post being written
  | 'awaiting_client'  // client_review | post_review
  | 'changes_requested'
  | 'approved'
  | 'completed'        // delivered | published
  | 'declined';

/** One curated content move as a work-order (job #3). */
export interface ContentWorkOrderRow {
  recId: string;
  type: 'content' | 'content_refresh';
  title: string;
  clientStatus: string;
  priority: RecPriority;
  sent: boolean;
  /** The linked content_topic_request id (by recommendationId), or null when none exists. */
  requestId: string | null;
  stage: ContentWorkOrderStage;
  hasBrief: boolean;
  hasPost: boolean;
}

/** GET /api/workspaces/:workspaceId/issue-lenses response. */
export interface IssueLensesResponse {
  workspaceId: string;
  keywordTargets: KeywordTargetRow[];
  contentWorkOrders: ContentWorkOrderRow[];
}
