/**
 * The Issue — Phase 5 four-jobs lenses (Lane D unit coverage).
 *
 * `buildIssueLenses(workspaceId)` projects the already-curated Issue rec set into two ADMIN
 * read-projections (spec §9):
 *   - Job #4 keyword targets: curated `keyword_gap` + `topic_cluster` recs.
 *   - Job #3 content work-orders: curated `content` + `content_refresh` recs, joined to their
 *     content_topic_requests row for a production stage.
 *
 * Curated-set filter: a rec is in a lens iff `(isActiveRec(r) || isCuratedForClient(r))` — not
 * struck, not declined; covers active + sent/approved/discussing.
 *
 * These cases seed recs (saveRecommendations) + content_topic_requests (direct SQL, so terminal
 * statuses like delivered/published/declined that createContentRequest's initialStatus can't reach
 * are exercisable) and assert the projection shape, the curated-set filter, deepLinkKeyword
 * resolution, the request join (requestId/stage/hasBrief/hasPost), `sent`, and that
 * `contentRequestStageOf` maps EVERY ContentTopicRequest status (fail-closed on a new status).
 */
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';

import { buildIssueLenses, contentRequestStageOf } from '../../server/strategy-issue-lenses.js';
import { saveRecommendations, computeRecommendationSummary } from '../../server/recommendations.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';
import type { Recommendation, RecPriority, RecStatus, RecType } from '../../shared/types/recommendations.js';
import type { ContentTopicRequest } from '../../shared/types/content.js';
import type { ContentWorkOrderStage } from '../../shared/types/strategy-issue-lenses.js';

let wsId = '';

function makeRec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: `rec_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: wsId,
    priority: 'fix_soon' as RecPriority,
    type: 'keyword_gap' as RecType,
    title: 'Generic move',
    description: 'Do the thing.',
    insight: 'Why it matters.',
    impact: 'medium',
    effort: 'low',
    impactScore: 50,
    source: 'keyword_gap:plumbing repair',
    affectedPages: [],
    trafficAtRisk: 100,
    impressionsAtRisk: 1000,
    estimatedGain: '5-15%',
    actionType: 'manual',
    status: 'pending' as RecStatus,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Persist a rec list under the test workspace. */
function seedRecs(recs: Recommendation[]): void {
  saveRecommendations({
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: recs,
    summary: computeRecommendationSummary(recs),
  });
}

/** Direct content_topic_requests insert — accepts ANY status (including terminal ones the
 *  createContentRequest initialStatus union forbids). Only the columns buildIssueLenses reads
 *  (status, brief_id, post_id, recommendation_id) plus the NOT-NULL columns are set. */
function seedRequest(opts: {
  id: string;
  recommendationId?: string | null;
  status: ContentTopicRequest['status'];
  briefId?: string | null;
  postId?: string | null;
  /** Override updated_at to exercise the most-recently-updated tiebreak on a shared recommendationId. */
  updatedAt?: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO content_topic_requests
      (id, workspace_id, topic, target_keyword, intent, priority, rationale, status,
       brief_id, post_id, recommendation_id, comments, requested_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.id, wsId, 'Topic', 'kw', 'informational', 'medium', 'because', opts.status,
    opts.briefId ?? null, opts.postId ?? null, opts.recommendationId ?? null, '[]', now, opts.updatedAt ?? now,
  );
}

beforeAll(() => {
  wsId = createWorkspace('Issue Lenses Unit WS').id;
});

afterEach(() => {
  db.prepare('DELETE FROM recommendation_sets WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
});

afterAll(() => {
  deleteWorkspace(wsId);
});

describe('buildIssueLenses — workspaceId + empty', () => {
  it('echoes the workspaceId and returns empty arrays when no recs exist', () => {
    const lenses = buildIssueLenses(wsId);
    expect(lenses.workspaceId).toBe(wsId);
    expect(lenses.keywordTargets).toEqual([]);
    expect(lenses.contentWorkOrders).toEqual([]);
  });
});

describe('buildIssueLenses — keyword targets (job #4)', () => {
  it('includes only curated/in-play keyword_gap + topic_cluster recs', () => {
    seedRecs([
      // In-play keyword_gap (active — clientStatus 'curated' ⇒ isActiveRec true, not yet sent).
      makeRec({ id: 'kg-active', type: 'keyword_gap', clientStatus: 'curated', source: 'keyword_gap:roof repair', targetKeyword: 'roof repair' }),
      // In-play topic_cluster (sent ⇒ curated-for-client).
      makeRec({ id: 'tc-sent', type: 'topic_cluster', clientStatus: 'sent', source: 'topic_cluster:gutter guides' }),
      // A non-lens type (content) must NOT appear in keywordTargets.
      makeRec({ id: 'content-x', type: 'content', clientStatus: 'curated', source: 'strategy:content-gap', title: 'Write X', targetKeyword: 'x' }),
      // A technical rec — neither lens type.
      makeRec({ id: 'tech-x', type: 'technical', clientStatus: 'curated', source: 'audit:title' }),
    ]);
    const { keywordTargets } = buildIssueLenses(wsId);
    const ids = keywordTargets.map(r => r.recId).sort();
    // Exact-id assertion proves the type filter: only the keyword_gap + topic_cluster recs survive,
    // and the content/technical recs are absent. The exact-set assertions below are length-guarded
    // by construction (a missing/extra id fails toEqual), so no vacuous all-match check is used.
    expect(ids).toEqual(['kg-active', 'tc-sent']);
    expect(keywordTargets.map(r => r.type).sort()).toEqual(['keyword_gap', 'topic_cluster']);
  });

  it('excludes a struck or declined keyword_gap (neither active nor curated)', () => {
    seedRecs([
      makeRec({ id: 'kg-keep', type: 'keyword_gap', clientStatus: 'curated', source: 'keyword_gap:keep me', targetKeyword: 'keep me' }),
      // struck ⇒ isActiveRec false AND isCuratedForClient false ⇒ excluded.
      makeRec({ id: 'kg-struck', type: 'keyword_gap', lifecycle: 'struck', source: 'keyword_gap:struck', targetKeyword: 'struck' }),
      // declined ⇒ isActiveRec false (clientStatus declined) AND isCuratedForClient false ⇒ excluded.
      makeRec({ id: 'kg-declined', type: 'keyword_gap', clientStatus: 'declined', source: 'keyword_gap:declined', targetKeyword: 'declined' }),
    ]);
    const ids = buildIssueLenses(wsId).keywordTargets.map(r => r.recId);
    expect(ids).toEqual(['kg-keep']);
  });

  it('resolves deepLinkKeyword + label: keyword_gap from targetKeyword, topic_cluster from source, null when neither', () => {
    seedRecs([
      makeRec({ id: 'kg-tk', type: 'keyword_gap', clientStatus: 'curated', source: 'keyword_gap:fallback kw', targetKeyword: 'drain cleaning' }),
      makeRec({ id: 'tc-src', type: 'topic_cluster', clientStatus: 'curated', source: 'topic_cluster:winter prep', targetKeyword: undefined }),
      // keyword_gap with NO targetKeyword and an unparseable source ⇒ deepLinkKeyword null.
      makeRec({ id: 'kg-null', type: 'keyword_gap', clientStatus: 'curated', source: 'keyword_gap:', targetKeyword: undefined }),
    ]);
    const byId = new Map(buildIssueLenses(wsId).keywordTargets.map(r => [r.recId, r]));

    const kgTk = byId.get('kg-tk')!;
    expect(kgTk.deepLinkKeyword).toBe('drain cleaning');
    expect(kgTk.label).toBe('drain cleaning');

    const tcSrc = byId.get('tc-src')!;
    // topic_cluster has no targetKeyword — the topic is parsed from source after 'topic_cluster:'.
    expect(tcSrc.deepLinkKeyword).toBe('winter prep');
    expect(tcSrc.label).toBe('winter prep');

    const kgNull = byId.get('kg-null')!;
    expect(kgNull.deepLinkKeyword).toBeNull();
  });

  it('sets sent=true for a sent/approved/discussing rec and sent=false for a merely-curated rec', () => {
    seedRecs([
      makeRec({ id: 'kg-sent', type: 'keyword_gap', clientStatus: 'sent', source: 'keyword_gap:a', targetKeyword: 'a' }),
      makeRec({ id: 'kg-approved', type: 'keyword_gap', clientStatus: 'approved', source: 'keyword_gap:b', targetKeyword: 'b' }),
      makeRec({ id: 'kg-discussing', type: 'keyword_gap', clientStatus: 'discussing', source: 'keyword_gap:c', targetKeyword: 'c' }),
      makeRec({ id: 'kg-curated', type: 'keyword_gap', clientStatus: 'curated', source: 'keyword_gap:d', targetKeyword: 'd' }),
    ]);
    const byId = new Map(buildIssueLenses(wsId).keywordTargets.map(r => [r.recId, r]));
    expect(byId.get('kg-sent')!.sent).toBe(true);
    expect(byId.get('kg-approved')!.sent).toBe(true);
    expect(byId.get('kg-discussing')!.sent).toBe(true);
    // curated = operator picked but NOT yet in front of the client ⇒ not "sent".
    expect(byId.get('kg-curated')!.sent).toBe(false);
  });
});

describe('buildIssueLenses — content work-orders (job #3)', () => {
  it('includes only content + content_refresh recs', () => {
    seedRecs([
      makeRec({ id: 'wo-content', type: 'content', clientStatus: 'curated', source: 'strategy:content-gap', title: 'Write A', targetKeyword: 'a' }),
      makeRec({ id: 'wo-refresh', type: 'content_refresh', clientStatus: 'sent', source: 'decay:b', title: 'Refresh B' }),
      // keyword_gap belongs to the OTHER lens — never a work-order.
      makeRec({ id: 'kg-x', type: 'keyword_gap', clientStatus: 'curated', source: 'keyword_gap:x', targetKeyword: 'x' }),
    ]);
    const ids = buildIssueLenses(wsId).contentWorkOrders.map(r => r.recId).sort();
    expect(ids).toEqual(['wo-content', 'wo-refresh']);
  });

  it('joins a rec to its content_topic_request by recommendationId: requestId + stage + hasBrief/hasPost', () => {
    seedRecs([
      makeRec({ id: 'wo-joined', type: 'content', clientStatus: 'curated', source: 'strategy:content-gap', title: 'Joined', targetKeyword: 'j' }),
    ]);
    seedRequest({ id: 'creq-joined', recommendationId: 'wo-joined', status: 'in_progress', briefId: 'brief-1', postId: 'post-1' });

    const [row] = buildIssueLenses(wsId).contentWorkOrders;
    expect(row.recId).toBe('wo-joined');
    expect(row.requestId).toBe('creq-joined');
    expect(row.stage).toBe('in_progress');
    expect(row.hasBrief).toBe(true);
    expect(row.hasPost).toBe(true);
  });

  it('joins by recommendationId — a request pointing at a DIFFERENT rec is NOT attached', () => {
    seedRecs([
      makeRec({ id: 'wo-target', type: 'content', clientStatus: 'curated', source: 'strategy:content-gap', title: 'Target', targetKeyword: 't' }),
    ]);
    // Decoy: a request in the SAME workspace whose recommendationId points elsewhere. A regressed
    // "free workspace join" would wrongly attach it; the keyed join must leave wo-target unjoined.
    seedRequest({ id: 'creq-decoy', recommendationId: 'some-other-rec', status: 'in_progress', briefId: 'b', postId: 'p' });

    const [row] = buildIssueLenses(wsId).contentWorkOrders;
    expect(row.recId).toBe('wo-target');
    expect(row.requestId).toBeNull();      // NOT 'creq-decoy'
    expect(row.stage).toBe('not_started');
    expect(row.hasBrief).toBe(false);
    expect(row.hasPost).toBe(false);
  });

  it('on a shared recommendationId, keeps the most-recently-updated request', () => {
    seedRecs([
      makeRec({ id: 'wo-multi', type: 'content', clientStatus: 'curated', source: 'strategy:content-gap', title: 'Multi', targetKeyword: 'm' }),
    ]);
    // Two requests share recommendationId 'wo-multi'; the newer updated_at must win.
    seedRequest({ id: 'creq-old', recommendationId: 'wo-multi', status: 'requested', updatedAt: '2026-06-01T00:00:00.000Z' });
    seedRequest({ id: 'creq-new', recommendationId: 'wo-multi', status: 'in_progress', briefId: 'brief-new', updatedAt: '2026-06-15T00:00:00.000Z' });

    const [row] = buildIssueLenses(wsId).contentWorkOrders;
    expect(row.requestId).toBe('creq-new'); // newer wins, not 'creq-old'
    expect(row.stage).toBe('in_progress');
    expect(row.hasBrief).toBe(true);
  });

  it('hasBrief/hasPost reflect the absence of brief_id/post_id', () => {
    seedRecs([
      makeRec({ id: 'wo-queued', type: 'content', clientStatus: 'curated', source: 'strategy:content-gap', title: 'Queued', targetKeyword: 'q' }),
    ]);
    seedRequest({ id: 'creq-queued', recommendationId: 'wo-queued', status: 'requested', briefId: null, postId: null });

    const [row] = buildIssueLenses(wsId).contentWorkOrders;
    expect(row.requestId).toBe('creq-queued');
    expect(row.stage).toBe('queued');
    expect(row.hasBrief).toBe(false);
    expect(row.hasPost).toBe(false);
  });

  it('a content rec with NO linked request → stage not_started, requestId null', () => {
    seedRecs([
      makeRec({ id: 'wo-orphan', type: 'content', clientStatus: 'sent', source: 'strategy:content-gap', title: 'Orphan', targetKeyword: 'o' }),
    ]);
    // No content_topic_request links to wo-orphan.
    const [row] = buildIssueLenses(wsId).contentWorkOrders;
    expect(row.recId).toBe('wo-orphan');
    expect(row.requestId).toBeNull();
    expect(row.stage).toBe('not_started');
    expect(row.hasBrief).toBe(false);
    expect(row.hasPost).toBe(false);
  });

  it('excludes struck/declined content recs from the work-order lens', () => {
    seedRecs([
      makeRec({ id: 'wo-keep', type: 'content', clientStatus: 'curated', source: 'strategy:content-gap', title: 'Keep', targetKeyword: 'k' }),
      makeRec({ id: 'wo-struck', type: 'content', lifecycle: 'struck', source: 'strategy:content-gap', title: 'Struck', targetKeyword: 's' }),
      makeRec({ id: 'wo-declined', type: 'content_refresh', clientStatus: 'declined', source: 'decay:d', title: 'Declined' }),
    ]);
    const ids = buildIssueLenses(wsId).contentWorkOrders.map(r => r.recId);
    expect(ids).toEqual(['wo-keep']);
  });
});

describe('contentRequestStageOf — exhaustive status mapping', () => {
  // Table-driven over EVERY ContentTopicRequest['status'] value (shared/types/content.ts).
  // A new status that falls through would surface here, fail-closed.
  const cases: Array<[ContentTopicRequest['status'], ContentWorkOrderStage]> = [
    ['pending_payment', 'queued'],
    ['requested', 'queued'],
    ['brief_generated', 'queued'],
    ['in_progress', 'in_progress'],
    ['client_review', 'awaiting_client'],
    ['post_review', 'awaiting_client'],
    ['changes_requested', 'changes_requested'],
    ['approved', 'approved'],
    ['delivered', 'completed'],
    ['published', 'completed'],
    ['declined', 'declined'],
  ];

  it.each(cases)('maps status %s → stage %s', (status, expected) => {
    expect(contentRequestStageOf(status)).toBe(expected);
  });

  it('maps no request (null / undefined) → not_started', () => {
    expect(contentRequestStageOf(null)).toBe('not_started');
    expect(contentRequestStageOf(undefined)).toBe('not_started');
  });
});
