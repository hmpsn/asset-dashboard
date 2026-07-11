import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation';
import { WS_EVENTS } from '../../src/lib/wsEvents';

const WS_ID = 'ws-registry';

describe('wsInvalidation registry', () => {
  it('maps CONTENT_UPDATED to the existing admin + client content refresh set', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.CONTENT_UPDATED, WS_ID, undefined, 'admin');

    expect(keys).toContainEqual(queryKeys.admin.briefs(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.posts(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.contentPipeline(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.roi(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.roi(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.contentRequests(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.contentPlan(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('maps STRATEGY_UPDATED for the client dashboard to strategy, page-keywords, and intelligence', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.STRATEGY_UPDATED, WS_ID, undefined, 'client-dashboard');

    expect(keys).toEqual([
      queryKeys.client.strategy(WS_ID),
      queryKeys.client.pageKeywords(WS_ID),
      queryKeys.client.intelligence(WS_ID),
    ]);
  });

  it('maps STRATEGY_UPDATED for admin to refresh the backlink profile and competitor intel (Phase 4 invalidation gap)', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.STRATEGY_UPDATED, WS_ID, undefined, 'admin');

    // A strategy regen / competitor-domains save broadcasts STRATEGY_UPDATED; the Reference-band
    // Authority & Backlinks view must refetch both data sources.
    expect(keys).toContainEqual(queryKeys.admin.backlinkProfile(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.competitorIntelAll(WS_ID));
    // existing strategy keys still present
    expect(keys).toContainEqual(queryKeys.admin.keywordStrategy(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.strategyDiff(WS_ID));
  });

  it('maps RANK_TRACKING_UPDATED for the client dashboard to ranking and keyword readers', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.RANK_TRACKING_UPDATED, WS_ID, undefined, 'client-dashboard');

    expect(keys).toEqual([
      queryKeys.client.rankHistory(WS_ID),
      queryKeys.client.latestRanks(WS_ID),
      queryKeys.client.strategy(WS_ID),
      queryKeys.client.pageKeywords(WS_ID),
    ]);
  });

  it('maps CONTENT_SUBSCRIPTION_UPDATED for the client dashboard to the subscription reader', () => {
    const keys = getWorkspaceInvalidationKeys(
      WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED,
      WS_ID,
      undefined,
      'client-dashboard',
    );

    expect(keys).toEqual([queryKeys.client.contentSubscription(WS_ID)]);
  });

  it('maps BRIEF_UPDATED for the client dashboard to content, inbox, and intelligence readers', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.BRIEF_UPDATED, WS_ID, undefined, 'client-dashboard');

    expect(keys).toEqual([
      queryKeys.client.contentRequests(WS_ID),
      queryKeys.client.contentPlan(WS_ID),
      queryKeys.client.unifiedInbox(WS_ID),
      queryKeys.client.intelligence(WS_ID),
    ]);
  });

  it('maps SCHEMA_SNAPSHOT_UPDATED for the client dashboard to both schema plan and snapshot readers', () => {
    const keys = getWorkspaceInvalidationKeys(
      WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED,
      WS_ID,
      undefined,
      'client-dashboard',
    );

    expect(keys).toEqual([
      queryKeys.client.schemaPlan(WS_ID),
      queryKeys.client.schemaSnapshot(WS_ID),
    ]);
  });

  it('maps outcome refresh events for the client dashboard without speculative fanout', () => {
    expect(
      getWorkspaceInvalidationKeys(WS_EVENTS.OUTCOME_ACTION_RECORDED, WS_ID, undefined, 'client-dashboard'),
    ).toEqual([
      queryKeys.client.outcomeSummary(WS_ID),
      queryKeys.client.intelligence(WS_ID),
    ]);

    expect(
      getWorkspaceInvalidationKeys(WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED, WS_ID, undefined, 'client-dashboard'),
    ).toEqual([
      queryKeys.client.intelligence(WS_ID),
      queryKeys.client.monthlyDigest(WS_ID),
    ]);
  });

  it('maps DELIVERABLE_UPDATED for the admin deliverables pane', () => {
    const keys = getWorkspaceInvalidationKeys(
      WS_EVENTS.DELIVERABLE_UPDATED,
      WS_ID,
      undefined,
      'admin-deliverables',
    );

    expect(keys).toEqual([queryKeys.admin.workspaceDeliverables(WS_ID)]);
  });

  it('maps COPY_SECTION_UPDATED for the client copy review surface', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.COPY_SECTION_UPDATED, WS_ID, undefined, 'client-copy-review');

    expect(keys).toEqual([
      queryKeys.client.copyEntries(WS_ID),
      queryKeys.client.copyEntriesCount(WS_ID),
      queryKeys.client.copySectionsAll(WS_ID),
    ]);
  });

  it('maps deliverable spine events to the unified inbox cache', () => {
    const keys = getWorkspaceInvalidationKeys(WS_EVENTS.DELIVERABLE_UPDATED, WS_ID, undefined, 'client-unified-inbox');

    expect(keys).toEqual([queryKeys.client.unifiedInbox(WS_ID)]);
  });

  it('maps WORK_ORDER_COMMENT to the thread-specific unified inbox refresh when an order id is present', () => {
    const keys = getWorkspaceInvalidationKeys(
      WS_EVENTS.WORK_ORDER_COMMENT,
      WS_ID,
      { id: 'order-7' },
      'client-unified-inbox',
    );

    expect(keys).toEqual([
      queryKeys.client.workOrderComments(WS_ID, 'order-7'),
      queryKeys.client.unifiedInbox(WS_ID),
    ]);
  });

  it('falls back to the comments prefix when WORK_ORDER_COMMENT has no order id', () => {
    const keys = getWorkspaceInvalidationKeys(
      WS_EVENTS.WORK_ORDER_COMMENT,
      WS_ID,
      undefined,
      'client-unified-inbox',
    );

    expect(keys).toEqual([
      queryKeys.client.workOrderCommentsAll(WS_ID),
      queryKeys.client.unifiedInbox(WS_ID),
    ]);
  });

  it('maps SCHEMA_PLAN_UPDATED for admin with both site-wide and workspace-scoped schema keys', () => {
    const keys = getWorkspaceInvalidationKeys(
      WS_EVENTS.SCHEMA_PLAN_UPDATED,
      WS_ID,
      { siteId: 'site-22' },
      'admin',
    );

    expect(keys).toContainEqual(queryKeys.admin.schemaPlan('site-22'));
    expect(keys).toContainEqual(queryKeys.admin.schemaPlan('site-22', WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.schemaGraphValidation('site-22'));
    expect(keys).toContainEqual(queryKeys.admin.schemaGraphValidation('site-22', WS_ID));
    expect(keys).toContainEqual(queryKeys.client.schemaPlan(WS_ID));
  });
});
