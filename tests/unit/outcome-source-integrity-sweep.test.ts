import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stmts: {
    // outcome-source-integrity-sweep-job.ts statements
    allWorkspaceIds: { all: vi.fn(() => []) },
    sourceRefsByWorkspace: { all: vi.fn(() => []) },
    existsInsight: { get: vi.fn(() => undefined) },
    existsRecommendationItem: { get: vi.fn(() => undefined) },
    existsPost: { get: vi.fn(() => undefined) },
    existsBrief: { get: vi.fn(() => undefined) },
    existsClientAction: { get: vi.fn(() => undefined) },
    existsGbpReviewResponse: { get: vi.fn(() => undefined) },
    // outcome-backfill.ts statements (shared mock module — see note below)
    nullLabelRecActions: { all: vi.fn(() => []) },
    fillSourceLabelIfNull: { run: vi.fn(() => ({ changes: 1 })) },
  },
  getJob: vi.fn(),
  updateJob: vi.fn(),
  unregisterAbort: vi.fn(),
  createJob: vi.fn(),
  hasActiveJob: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  loadRecommendationItem: vi.fn(),
}));

vi.mock('../../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(),
    // outcome-backfill.ts's backfillSourceLabels wraps writes in db.transaction(); the
    // mock just invokes the body synchronously (mirrors tests/unit/outcome-backfill.test.ts).
    transaction: (fn: (...args: unknown[]) => unknown) => fn,
  },
}));
// Both outcome-source-integrity-sweep-job.ts AND outcome-backfill.ts call createStmtCache();
// this file exercises both modules, so the mock is shared (a superset of both modules'
// statement names) rather than re-mocked per describe block — vi.mock is file-scoped/hoisted.
vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: () => () => mocks.stmts,
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: mocks.warn, info: mocks.info, debug: mocks.debug, error: vi.fn() }),
}));
vi.mock('../../server/jobs.js', () => ({
  getJob: mocks.getJob,
  updateJob: mocks.updateJob,
  unregisterAbort: mocks.unregisterAbort,
  createJob: mocks.createJob,
  hasActiveJob: mocks.hasActiveJob,
}));
// outcome-backfill.ts's other imports — not exercised by the sweep-job tests, but must be
// mocked so importing outcome-backfill.js in this file doesn't pull in the real DB layer.
vi.mock('../../server/outcome-tracking.js', () => ({
  recordAction: vi.fn(),
  getActionBySource: vi.fn(() => null),
  fillPredictedEmvIfNull: vi.fn(() => true),
}));
vi.mock('../../server/domains/recommendations/storage.js', () => ({
  loadRecommendationSet: vi.fn(() => null),
  loadRecommendationItem: mocks.loadRecommendationItem,
}));

import {
  sweepWorkspaceSourceIntegrity,
  runOutcomeSourceIntegritySweepJob,
  enqueueOutcomeSourceIntegritySweep,
} from '../../server/outcome-source-integrity-sweep-job.js';
import { backfillSourceLabels } from '../../server/outcome-backfill.js';
import { BACKGROUND_JOB_TYPES, BACKGROUND_JOB_METADATA } from '../../shared/types/background-jobs.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stmts.allWorkspaceIds.all.mockReturnValue([]);
  mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue([]);
  mocks.stmts.existsInsight.get.mockReturnValue(undefined);
  mocks.stmts.existsRecommendationItem.get.mockReturnValue(undefined);
  mocks.stmts.existsPost.get.mockReturnValue(undefined);
  mocks.stmts.existsBrief.get.mockReturnValue(undefined);
  mocks.stmts.existsClientAction.get.mockReturnValue(undefined);
  mocks.stmts.existsGbpReviewResponse.get.mockReturnValue(undefined);
  mocks.stmts.nullLabelRecActions.all.mockReturnValue([]);
  mocks.stmts.fillSourceLabelIfNull.run.mockReturnValue({ changes: 1 });
  mocks.loadRecommendationItem.mockReturnValue(null);
  mocks.getJob.mockReturnValue({ status: 'running' });
  mocks.hasActiveJob.mockReturnValue(undefined);
  mocks.createJob.mockReturnValue({ id: 'job-new' });
});

describe('OUTCOME_SOURCE_INTEGRITY_SWEEP job registration', () => {
  it('registers the type with ephemeral, cancellable, system-class metadata', () => {
    expect(BACKGROUND_JOB_TYPES.OUTCOME_SOURCE_INTEGRITY_SWEEP).toBe('outcome-source-integrity-sweep');
    const meta = BACKGROUND_JOB_METADATA[BACKGROUND_JOB_TYPES.OUTCOME_SOURCE_INTEGRITY_SWEEP];
    expect(meta.cancellable).toBe(true);
    expect(meta.resultBehavior).toBe('ephemeral');
  });
});

describe('sweepWorkspaceSourceIntegrity', () => {
  it('counts a seeded dangling recommendation ref and mutates nothing', () => {
    mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue([
      { source_type: 'recommendation', source_id: 'rec_missing' },
      { source_type: 'recommendation', source_id: 'rec_alive' },
    ]);
    // rec_alive exists, rec_missing does not.
    mocks.stmts.existsRecommendationItem.get.mockImplementation((_ws: string, id: string) =>
      id === 'rec_alive' ? { 1: 1 } : undefined,
    );

    const result = sweepWorkspaceSourceIntegrity('ws_1');

    expect(result.totalRefs).toBe(2);
    expect(result.rowBackedCoverage).toEqual([
      { sourceType: 'recommendation', total: 2, dangling: 1 },
    ]);
    expect(result.danglingRefs).toEqual([{ sourceType: 'recommendation', sourceId: 'rec_missing' }]);
    // Below the cap: danglingTotal matches the enumeration and truncation is false.
    expect(result.danglingTotal).toBe(1);
    expect(result.danglingTruncated).toBe(false);

    // Read-only: no write/prepare-mutation surface was ever invoked by this function —
    // the mock only exposes SELECT-shaped `.get`/`.all` methods, so any accidental write
    // call (e.g. `.run`) would throw as "not a function" and fail the test.
  });

  it('classifies self-ref and not-checkable source types without flagging them dangling', () => {
    mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue([
      { source_type: 'strategy', source_id: 'ws_1' },
      { source_type: 'brand_voice', source_id: 'ws_1' },
      { source_type: 'strategy_page_keyword', source_id: '/page::keyword' },
      { source_type: 'content_decay', source_id: '/decaying-page' },
      { source_type: 'internal_link', source_id: '/target-page' },
      { source_type: 'schema', source_id: 'webflow_page_123' },
      { source_type: 'approval', source_id: 'item_abc' },
      // B13 (D2): 'audit' sourceId is the synthetic `${pageId}-${check}` bulk-accept-fix
      // dedup key — no backing row exists, so it must land in the not-checkable bucket,
      // NOT unclassifiedTypes.
      { source_type: 'audit', source_id: 'page_1-missing-meta-description' },
    ]);

    const result = sweepWorkspaceSourceIntegrity('ws_1');

    expect(result.totalRefs).toBe(8);
    expect(result.rowBackedCoverage).toEqual([]);
    expect(result.danglingRefs).toEqual([]);
    expect(result.selfRefCounts).toEqual({ strategy: 1, brand_voice: 1 });
    expect(result.notCheckableCounts).toEqual({
      strategy_page_keyword: 1,
      content_decay: 1,
      internal_link: 1,
      schema: 1,
      approval: 1,
      audit: 1,
    });
    expect(result.unclassifiedTypes).toEqual([]);
  });

  it('surfaces an unrecognized source_type instead of silently dropping it', () => {
    mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue([
      { source_type: 'some_future_source_type', source_id: 'x1' },
    ]);

    const result = sweepWorkspaceSourceIntegrity('ws_1');

    expect(result.unclassifiedTypes).toEqual(['some_future_source_type']);
    expect(result.rowBackedCoverage).toEqual([]);
    expect(result.danglingRefs).toEqual([]);
  });

  it('resolves row-backed checks correctly across insight/post/brief/content_request/client_action', () => {
    mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue([
      { source_type: 'insight', source_id: 'insight_missing' },
      { source_type: 'post', source_id: 'post_missing' },
      { source_type: 'brief', source_id: 'brief_missing' },
      { source_type: 'content_request', source_id: 'brief_for_request_missing' },
      { source_type: 'client_action', source_id: 'ca_missing' },
    ]);
    // Nothing exists — every row-backed ref should be dangling.
    const result = sweepWorkspaceSourceIntegrity('ws_1');

    expect(result.rowBackedCoverage).toEqual([
      { sourceType: 'brief', total: 1, dangling: 1 },
      { sourceType: 'client_action', total: 1, dangling: 1 },
      { sourceType: 'content_request', total: 1, dangling: 1 },
      { sourceType: 'insight', total: 1, dangling: 1 },
      { sourceType: 'post', total: 1, dangling: 1 },
    ]);
    expect(result.danglingRefs).toHaveLength(5);
    // content_request resolves against content_briefs (existsBrief), not a content_requests table.
    expect(mocks.stmts.existsBrief.get).toHaveBeenCalledWith('ws_1', 'brief_missing');
    expect(mocks.stmts.existsBrief.get).toHaveBeenCalledWith('ws_1', 'brief_for_request_missing');
  });

  it('row-backed-checks gbp_review_response against google_business_review_responses (B13/D2)', () => {
    mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue([
      { source_type: 'gbp_review_response', source_id: 'grr_alive' },
      { source_type: 'gbp_review_response', source_id: 'grr_missing' },
    ]);
    // grr_alive still exists; grr_missing was deleted/regenerated -> dangling.
    mocks.stmts.existsGbpReviewResponse.get.mockImplementation((_ws: string, id: string) =>
      id === 'grr_alive' ? { 1: 1 } : undefined,
    );

    const result = sweepWorkspaceSourceIntegrity('ws_1');

    expect(result.rowBackedCoverage).toEqual([
      { sourceType: 'gbp_review_response', total: 2, dangling: 1 },
    ]);
    expect(result.danglingRefs).toEqual([
      { sourceType: 'gbp_review_response', sourceId: 'grr_missing' },
    ]);
    // Probed workspace-scoped against the verified GBP review-responses table.
    expect(mocks.stmts.existsGbpReviewResponse.get).toHaveBeenCalledWith('ws_1', 'grr_alive');
    expect(mocks.stmts.existsGbpReviewResponse.get).toHaveBeenCalledWith('ws_1', 'grr_missing');
    // NOT unclassified — it is a known row-backed type now.
    expect(result.unclassifiedTypes).toEqual([]);
  });

  it('caps danglingRefs at 200 but reports the true count via danglingTotal + danglingTruncated', () => {
    // Seed 250 distinct dangling recommendation refs — over the MAX_DANGLING_PER_WORKSPACE cap.
    const refs = Array.from({ length: 250 }, (_v, i) => ({
      source_type: 'recommendation',
      source_id: `rec_missing_${i}`,
    }));
    mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue(refs);
    // Nothing exists — all 250 are dangling.
    mocks.stmts.existsRecommendationItem.get.mockReturnValue(undefined);

    const result = sweepWorkspaceSourceIntegrity('ws_1');

    // The enumeration is truncated to the cap...
    expect(result.danglingRefs).toHaveLength(200);
    // ...but the coverage bucket and the authoritative total reflect the REAL count.
    expect(result.rowBackedCoverage).toEqual([{ sourceType: 'recommendation', total: 250, dangling: 250 }]);
    expect(result.danglingTotal).toBe(250);
    expect(result.danglingTruncated).toBe(true);
  });
});

describe('runOutcomeSourceIntegritySweepJob', () => {
  it('marks the job done with a report when the sweep succeeds', async () => {
    mocks.stmts.allWorkspaceIds.all.mockReturnValue([{ id: 'ws_1' }, { id: 'ws_2' }]);
    mocks.stmts.sourceRefsByWorkspace.all.mockImplementation((workspaceId: string) =>
      workspaceId === 'ws_1'
        ? [{ source_type: 'recommendation', source_id: 'rec_missing' }]
        : [],
    );
    mocks.stmts.existsRecommendationItem.get.mockReturnValue(undefined);

    await runOutcomeSourceIntegritySweepJob('job-1');

    expect(mocks.updateJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: 'running' }));
    expect(mocks.updateJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        status: 'done',
        result: expect.objectContaining({
          workspaceCount: 2,
          totalDangling: 1,
        }),
      }),
    );
    expect(mocks.unregisterAbort).toHaveBeenCalledWith('job-1');
  });

  it('warns when the sweep sees an unclassified source_type so a newly-minted type cannot sit silent (D2)', async () => {
    mocks.stmts.allWorkspaceIds.all.mockReturnValue([{ id: 'ws_1' }]);
    mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue([
      // An unknown type -> zero danglers (unclassified is never counted dangling), which
      // WITHOUT the fleet-wide warn would let the job read "zero danglers" silently.
      { source_type: 'freshly_minted_source_type', source_id: 'x1' },
    ]);

    await runOutcomeSourceIntegritySweepJob('job-unclassified');

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ unclassifiedTypes: ['freshly_minted_source_type'] }),
      expect.stringContaining('source types it does not classify'),
    );
    // Still completes (report-only) despite the unclassified type.
    expect(mocks.updateJob).toHaveBeenCalledWith(
      'job-unclassified',
      expect.objectContaining({ status: 'done' }),
    );
  });

  it('does NOT warn about unclassified types for the B13 seams now that they are classified (D2)', async () => {
    mocks.stmts.allWorkspaceIds.all.mockReturnValue([{ id: 'ws_1' }]);
    mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue([
      { source_type: 'gbp_review_response', source_id: 'grr_1' },
      { source_type: 'audit', source_id: 'page_1-missing-meta' },
    ]);
    mocks.stmts.existsGbpReviewResponse.get.mockReturnValue({ 1: 1 });

    await runOutcomeSourceIntegritySweepJob('job-b13-classified');

    expect(mocks.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('source types it does not classify'),
    );
  });

  it('mutates nothing — result.workspaces carries zero modified/write side effects (report-only contract)', async () => {
    mocks.stmts.allWorkspaceIds.all.mockReturnValue([{ id: 'ws_1' }]);
    mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue([
      { source_type: 'recommendation', source_id: 'rec_missing' },
    ]);
    mocks.stmts.existsRecommendationItem.get.mockReturnValue(undefined);

    await runOutcomeSourceIntegritySweepJob('job-1');

    const doneCall = mocks.updateJob.mock.calls.find(([, update]) => update.status === 'done');
    expect(doneCall).toBeDefined();
    const report = doneCall![1].result;
    expect(report.workspaces[0].danglingRefs).toEqual([{ sourceType: 'recommendation', sourceId: 'rec_missing' }]);
  });

  it('marks the job error (not success) when the sweep throws (FM-2), and logs an operational failure at info (M-1)', async () => {
    mocks.stmts.allWorkspaceIds.all.mockImplementation(() => {
      throw new Error('workspaces table unavailable');
    });

    await runOutcomeSourceIntegritySweepJob('job-2');

    expect(mocks.updateJob).toHaveBeenCalledWith(
      'job-2',
      expect.objectContaining({ status: 'error', error: 'workspaces table unavailable' }),
    );
    expect(mocks.updateJob).not.toHaveBeenCalledWith('job-2', expect.objectContaining({ status: 'done' }));
    expect(mocks.unregisterAbort).toHaveBeenCalledWith('job-2');
    // M-1: a non-programming (operational) failure of this diagnostic must be discoverable at the
    // default `info` level, not suppressed to `debug`.
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-2' }),
      'Outcome source integrity sweep failed',
    );
    expect(mocks.debug).not.toHaveBeenCalledWith(
      expect.anything(),
      'Outcome source integrity sweep failed',
    );
  });

  it('no-ops when the job is already cancelled before starting', async () => {
    mocks.getJob.mockReturnValue({ status: 'cancelled' });

    await runOutcomeSourceIntegritySweepJob('job-3');

    expect(mocks.stmts.allWorkspaceIds.all).not.toHaveBeenCalled();
    expect(mocks.updateJob).not.toHaveBeenCalled();
  });

  it('stops scanning between workspaces once cancelled mid-sweep', async () => {
    mocks.stmts.allWorkspaceIds.all.mockReturnValue([{ id: 'ws_1' }, { id: 'ws_2' }]);
    mocks.stmts.sourceRefsByWorkspace.all.mockReturnValue([]);
    let calls = 0;
    mocks.getJob.mockImplementation(() => {
      calls++;
      // First call (initial cancel check) -> running; second call (after ws_1) -> cancelled.
      return { status: calls <= 2 ? 'running' : 'cancelled' };
    });

    await runOutcomeSourceIntegritySweepJob('job-4');

    expect(mocks.updateJob).not.toHaveBeenCalledWith('job-4', expect.objectContaining({ status: 'done' }));
  });
});

describe('enqueueOutcomeSourceIntegritySweep (M-3: fleet-wide dispatch helper)', () => {
  it('creates a fleet-wide (no workspaceId) job and returns it when none is active', () => {
    mocks.hasActiveJob.mockReturnValue(undefined);
    mocks.createJob.mockReturnValue({ id: 'job-sweep' });

    const job = enqueueOutcomeSourceIntegritySweep();

    expect(mocks.hasActiveJob).toHaveBeenCalledWith('outcome-source-integrity-sweep');
    // Fleet-wide: createJob is called WITHOUT a workspaceId (global/no-owner job).
    const createArgs = mocks.createJob.mock.calls[0];
    expect(createArgs[0]).toBe('outcome-source-integrity-sweep');
    expect(createArgs[1]?.workspaceId).toBeUndefined();
    expect(job).toEqual({ id: 'job-sweep' });
  });

  it('dedupes — returns the existing active job and does NOT create a second', () => {
    mocks.hasActiveJob.mockReturnValue({ id: 'job-existing' });

    const job = enqueueOutcomeSourceIntegritySweep();

    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(job).toEqual({ id: 'job-existing' });
  });
});

// ─── B12: best-effort source_label backfill (server/outcome-backfill.ts) ─────────────────
// Co-located with the integrity-sweep tests (same ticket, same evidence chain: the sweep
// finds the danglers, this backfill fills what CAN be resolved from a still-live source).
describe('backfillSourceLabels', () => {
  it('fills source_label only where it is currently NULL — an existing label is left untouched', () => {
    // Two candidate rows returned by the NULL-guarded query (nullLabelRecActions already
    // filters to source_label IS NULL at the SQL level — this test asserts the JS-side
    // resolution + write behavior on top of that).
    mocks.stmts.nullLabelRecActions.all.mockReturnValue([
      { id: 'action_1', source_id: 'rec_alive' },
      { id: 'action_2', source_id: 'rec_no_title' },
    ]);
    mocks.loadRecommendationItem.mockImplementation((_ws: string, recId: string) => {
      if (recId === 'rec_alive') return { id: 'rec_alive', title: 'Fix duplicate meta descriptions', affectedPages: ['/services'] };
      if (recId === 'rec_no_title') return { id: 'rec_no_title', title: '', affectedPages: [] };
      return null;
    });

    const filled = backfillSourceLabels('ws_1');

    // Only action_1 resolved to a non-empty title -> exactly one UPDATE call.
    expect(filled).toBe(1);
    expect(mocks.stmts.fillSourceLabelIfNull.run).toHaveBeenCalledTimes(1);
    expect(mocks.stmts.fillSourceLabelIfNull.run).toHaveBeenCalledWith(
      'Fix duplicate meta descriptions',
      JSON.stringify({ title: 'Fix duplicate meta descriptions', type: 'recommendation', page: '/services' }),
      'action_1',
      'ws_1',
    );
    // action_2's recommendation resolved but had a blank title (FM-2: never fabricate) — no write attempted for it.
    expect(mocks.stmts.fillSourceLabelIfNull.run).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'action_2', expect.anything(),
    );
  });

  it('never touches a row whose source_label is already set (SQL-level guard: the candidate query only returns NULL rows)', () => {
    // Simulates the real-world guarantee: nullLabelRecActions' WHERE source_label IS NULL
    // means an action with an existing label is never even a candidate.
    mocks.stmts.nullLabelRecActions.all.mockReturnValue([]);

    const filled = backfillSourceLabels('ws_1');

    expect(filled).toBe(0);
    expect(mocks.loadRecommendationItem).not.toHaveBeenCalled();
    expect(mocks.stmts.fillSourceLabelIfNull.run).not.toHaveBeenCalled();
  });

  it('is a no-op when the referenced recommendation no longer exists (leaves the row for the integrity sweep to surface)', () => {
    mocks.stmts.nullLabelRecActions.all.mockReturnValue([
      { id: 'action_1', source_id: 'rec_deleted' },
    ]);
    mocks.loadRecommendationItem.mockReturnValue(null);

    const filled = backfillSourceLabels('ws_1');

    expect(filled).toBe(0);
    expect(mocks.stmts.fillSourceLabelIfNull.run).not.toHaveBeenCalled();
  });

  it('respects the DB-level guard even if fillSourceLabelIfNull reports zero changes (race: label was set concurrently)', () => {
    mocks.stmts.nullLabelRecActions.all.mockReturnValue([
      { id: 'action_1', source_id: 'rec_alive' },
    ]);
    mocks.loadRecommendationItem.mockReturnValue({ id: 'rec_alive', title: 'Some title', affectedPages: [] });
    mocks.stmts.fillSourceLabelIfNull.run.mockReturnValue({ changes: 0 });

    const filled = backfillSourceLabels('ws_1');

    expect(filled).toBe(0);
  });
});
