/**
 * The Issue — Phase 5 four-jobs lens projections.
 *
 * Two ADMIN read-projections of the already-curated Issue rec set (spec §9). Pure projections
 * over loadRecommendations + listContentRequests — no new source of truth, no writes, no
 * broadcasts. The admin cockpit renders the rows and constructs the deep-links; this module only
 * shapes the data.
 *
 *   - Job #4 keyword targets: curated keyword_gap + topic_cluster recs, each carrying the term
 *     used to seed the Keyword Hub `?q=` deep-link.
 *   - Job #3 content work-orders: curated content + content_refresh recs, joined (by
 *     recommendationId) to their content_topic_requests row for a production stage.
 *
 * Curated-set filter: a rec is in a lens iff (isActiveRec(r) || isCuratedForClient(r)) — i.e. not
 * struck, not declined; covers active + sent/approved/discussing.
 */
import type {
  KeywordTargetRow,
  ContentWorkOrderRow,
  ContentWorkOrderStage,
  IssueLensesResponse,
} from '../shared/types/strategy-issue-lenses.js';
import type { Recommendation, RecPriority } from '../shared/types/recommendations.js';
import type { ContentTopicRequest } from '../shared/types/content.js';
import { loadRecommendations, isActiveRec, isCuratedForClient } from './recommendations.js';
import { listContentRequests } from './content-requests.js';

/**
 * Map a content_topic_request status to a {@link ContentWorkOrderStage}. Pure and EXHAUSTIVE over
 * the content-request status enum: a `never` default makes adding a status to the union a compile
 * error until it is mapped here. `null`/`undefined` (no linked request) → `not_started`.
 */
export function contentRequestStageOf(
  status: ContentTopicRequest['status'] | null | undefined,
): ContentWorkOrderStage {
  if (!status) return 'not_started';
  switch (status) {
    case 'pending_payment':
    case 'requested':
    case 'brief_generated':
      return 'queued';
    case 'in_progress':
      return 'in_progress';
    case 'client_review':
    case 'post_review':
      return 'awaiting_client';
    case 'changes_requested':
      return 'changes_requested';
    case 'approved':
      return 'approved';
    case 'delivered':
    case 'published':
      return 'completed';
    case 'declined':
      return 'declined';
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return 'not_started';
    }
  }
}

// ── Sort orders ──────────────────────────────────────────────────────────────

/** Priority rank: fix_now > fix_soon > fix_later > ongoing (lower number sorts first). */
const PRIORITY_RANK: Record<RecPriority, number> = {
  fix_now: 0,
  fix_soon: 1,
  fix_later: 2,
  ongoing: 3,
};

/** Stage-urgency order for content work-orders: rows the operator must act on or move forward come
 *  first; terminal/parked stages sink. changes_requested + awaiting_client are the operator's live
 *  queue, then in-flight work, then the not-yet-started backlog, then settled/dead rows. */
const STAGE_URGENCY: Record<ContentWorkOrderStage, number> = {
  changes_requested: 0,
  awaiting_client: 1,
  in_progress: 2,
  approved: 3,
  queued: 4,
  not_started: 5,
  completed: 6,
  declined: 7,
};

/** Topic for a topic_cluster rec, extracted from its `topic_cluster:<topic>` source. */
function topicFromSource(source: string): string | null {
  const prefix = 'topic_cluster:';
  if (source.startsWith(prefix)) {
    const topic = source.slice(prefix.length);
    return topic.length > 0 ? topic : null;
  }
  return null;
}

/** Keyword embedded in a `keyword_gap:<keyword>` source, when present. */
function keywordFromGapSource(source: string): string | null {
  const prefix = 'keyword_gap:';
  if (source.startsWith(prefix)) {
    const kw = source.slice(prefix.length);
    return kw.length > 0 ? kw : null;
  }
  return null;
}

function toKeywordTargetRow(rec: Recommendation): KeywordTargetRow | null {
  if (rec.type === 'keyword_gap') {
    const fromSource = keywordFromGapSource(rec.source);
    const label = rec.targetKeyword ?? fromSource ?? rec.title;
    const deepLinkKeyword = rec.targetKeyword ?? fromSource ?? null;
    return {
      recId: rec.id,
      type: 'keyword_gap',
      label,
      deepLinkKeyword,
      clientStatus: rec.clientStatus ?? 'system',
      priority: rec.priority,
      sent: isCuratedForClient(rec),
    };
  }
  if (rec.type === 'topic_cluster') {
    const topic = topicFromSource(rec.source);
    return {
      recId: rec.id,
      type: 'topic_cluster',
      label: topic ?? rec.title,
      deepLinkKeyword: topic ?? null,
      clientStatus: rec.clientStatus ?? 'system',
      priority: rec.priority,
      sent: isCuratedForClient(rec),
    };
  }
  return null;
}

/**
 * Build the two admin lens projections for a workspace. Read-only — never writes or broadcasts.
 * Returns empty arrays when no rec set exists.
 */
export function buildIssueLenses(workspaceId: string): IssueLensesResponse {
  const set = loadRecommendations(workspaceId);
  if (!set) {
    return { workspaceId, keywordTargets: [], contentWorkOrders: [] };
  }

  const now = Date.now();
  const inPlay = set.recommendations.filter(
    (r) => isActiveRec(r, now) || isCuratedForClient(r),
  );

  // impactScore by rec id — prebuilt so the sort tiebreakers are O(1) lookups, not O(n) scans
  // (a sort comparator calling Array.find per comparison is O(k log k · n)).
  const impactByRecId = new Map<string, number>(
    set.recommendations.map((r) => [r.id, r.impactScore ?? 0]),
  );
  const impactOf = (recId: string): number => impactByRecId.get(recId) ?? 0;

  // ── Job #4 — keyword targets ──────────────────────────────────────────────
  const keywordTargets: KeywordTargetRow[] = [];
  for (const rec of inPlay) {
    const row = toKeywordTargetRow(rec);
    if (row) keywordTargets.push(row);
  }
  // Sort: sent first, then priority rank, then impactScore desc.
  keywordTargets.sort((a, b) => {
    if (a.sent !== b.sent) return a.sent ? -1 : 1;
    const pDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pDiff !== 0) return pDiff;
    return impactOf(b.recId) - impactOf(a.recId);
  });

  // ── Job #3 — content work-orders ──────────────────────────────────────────
  // Join each content rec to its linked content_topic_request by recommendationId. When multiple
  // requests share a recommendationId, keep the most recently updated.
  const requestByRecId = new Map<string, ContentTopicRequest>();
  for (const req of listContentRequests(workspaceId)) {
    if (!req.recommendationId) continue;
    const existing = requestByRecId.get(req.recommendationId);
    if (!existing || req.updatedAt > existing.updatedAt) {
      requestByRecId.set(req.recommendationId, req);
    }
  }

  const contentWorkOrders: ContentWorkOrderRow[] = [];
  for (const rec of inPlay) {
    if (rec.type !== 'content' && rec.type !== 'content_refresh') continue;
    const req = requestByRecId.get(rec.id);
    contentWorkOrders.push({
      recId: rec.id,
      type: rec.type,
      title: rec.title,
      clientStatus: rec.clientStatus ?? 'system',
      priority: rec.priority,
      sent: isCuratedForClient(rec),
      requestId: req?.id ?? null,
      stage: contentRequestStageOf(req?.status),
      hasBrief: !!req?.briefId,
      hasPost: !!req?.postId,
    });
  }
  // Sort: by stage urgency, then priority rank, then impactScore desc.
  contentWorkOrders.sort((a, b) => {
    const sDiff = STAGE_URGENCY[a.stage] - STAGE_URGENCY[b.stage];
    if (sDiff !== 0) return sDiff;
    const pDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pDiff !== 0) return pDiff;
    return impactOf(b.recId) - impactOf(a.recId);
  });

  return { workspaceId, keywordTargets, contentWorkOrders };
}
