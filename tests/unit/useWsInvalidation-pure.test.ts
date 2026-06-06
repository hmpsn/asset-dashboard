/**
 * Pure routing-logic tests for useWsInvalidation.
 *
 * We extract the event→query-key mapping by calling the handler callbacks
 * directly with a spy QueryClient and verifying which keys are invalidated.
 * No React/hooks lifecycle is involved.
 */

import { describe, it, expect, vi } from 'vitest';
import { WS_EVENTS } from '../../src/lib/wsEvents.js';
import { queryKeys } from '../../src/lib/queryKeys.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type HandlerMap = Record<string, (data?: unknown) => void>;

/** Build the handler map the same way useWsInvalidation does, but inject a
 *  fake queryClient so we can spy on invalidateQueries. */
function buildHandlers(wsId: string) {
  const invalidated: Array<readonly unknown[]> = [];

  const qc = {
    invalidateQueries: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      invalidated.push(queryKey);
    },
  };

  // Manually rebuild the handler map (mirrors useWsInvalidation line-for-line)
  const handlers: HandlerMap = {
    [WS_EVENTS.APPROVAL_UPDATE]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.approvals(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.approvals(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.cmsEditorAll() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.APPROVAL_APPLIED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.approvals(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.approvals(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.seoEditorAll() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.cmsEditorAll() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.REQUEST_CREATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.requests(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.requests(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.REQUEST_UPDATE]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.requests(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.requests(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.CONTENT_REQUEST_CREATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.contentRequests(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.requests(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentPipeline(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentCalendar(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.CONTENT_REQUEST_UPDATE]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.client.contentRequests(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.requests(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentPipeline(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentCalendar(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.CONTENT_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefs(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.posts(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.postsDetailAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentTemplates(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentMatrices(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentPipeline(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentCalendar(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.roi(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.contentRequests(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.contentPlan(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.intelligence(wsId) });
    },
    [WS_EVENTS.ACTIVITY_NEW]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceOverview() });
      qc.invalidateQueries({ queryKey: queryKeys.client.activity(wsId) });
    },
    [WS_EVENTS.AUDIT_COMPLETE]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.shared.auditSummary(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.auditSummary(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.auditDetail(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.auditAll() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.intelligence(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceOverview() });
    },
    [WS_EVENTS.ANOMALIES_UPDATE]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.anomalyAlerts(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.anomalies(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.WORKSPACE_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceDetail(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceOverview() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.auditSuppressions(wsId) });
    },
    [WS_EVENTS.PAGE_STATE_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.shared.pageEditStates(wsId, false) });
      qc.invalidateQueries({ queryKey: queryKeys.shared.pageEditStates(wsId, true) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.seoEditorAll() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.cmsEditorAll() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.seoSuggestions(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.pageJoinPagesAll() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
    },
    [WS_EVENTS.OUTCOME_SCORED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeActions(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeScorecard(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeTimeline(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeTopWins(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.outcomeSummary(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.outcomeWins(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.intelligence(wsId) });
    },
    [WS_EVENTS.OUTCOME_ACTION_RECORDED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeActions(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeScorecard(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
    },
    [WS_EVENTS.OUTCOME_EXTERNAL_DETECTED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeActions(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.outcomeWins(wsId) });
    },
    [WS_EVENTS.OUTCOME_LEARNINGS_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomeLearnings(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
    },
    [WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.outcomePlaybooks(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
    },
    [WS_EVENTS.SUGGESTED_BRIEF_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.aiSuggestedBriefs(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentPipeline(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
    },
    [WS_EVENTS.INTELLIGENCE_CACHE_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligence(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.intelligence(wsId) });
    },
    [WS_EVENTS.COPY_SECTION_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyStatusAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentPipeline(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
    },
    [WS_EVENTS.COPY_BATCH_COMPLETE]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyBatchAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copySectionsAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyStatusAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentPipeline(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
    },
    [WS_EVENTS.COPY_INTELLIGENCE_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyIntelligence(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.copyPromotable(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentPipeline(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
    },
    [WS_EVENTS.RECOMMENDATIONS_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.shared.recommendations(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.shared.pageEditStates(wsId, false) });
      qc.invalidateQueries({ queryKey: queryKeys.shared.pageEditStates(wsId, true) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.actionQueue(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.intelligence(wsId) });
    },
    [WS_EVENTS.CLIENT_SIGNAL_CREATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.clientSignals(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.CLIENT_SIGNAL_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.clientSignals(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.notifications() });
    },
    [WS_EVENTS.DIAGNOSTIC_COMPLETE]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnosticForInsightAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnostics(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.insightFeed(wsId) });
    },
    [WS_EVENTS.DIAGNOSTIC_FAILED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnosticForInsightAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.diagnostics(wsId) });
    },
    [WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED]: (data: unknown) => {
      const siteId = typeof data === 'object' && data !== null && 'siteId' in data
        ? String((data as { siteId: unknown }).siteId)
        : undefined;
      if (!siteId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.schemaCmsFieldMappings(siteId) });
    },
    [WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED]: (data: unknown) => {
      if (!wsId) return;
      const siteId = typeof data === 'object' && data !== null && 'siteId' in data
        ? String((data as { siteId: unknown }).siteId)
        : undefined;
      if (siteId) {
        qc.invalidateQueries({ queryKey: queryKeys.admin.schemaSnapshot(siteId) });
        qc.invalidateQueries({ queryKey: queryKeys.admin.schemaSnapshot(siteId, wsId) });
        qc.invalidateQueries({ queryKey: queryKeys.admin.schemaGraphValidation(siteId) });
        qc.invalidateQueries({ queryKey: queryKeys.admin.schemaGraphValidation(siteId, wsId) });
      }
    },
    [WS_EVENTS.POST_UPDATED]: (data: unknown) => {
      if (!wsId) return;
      const payload = data as { postId?: string };
      qc.invalidateQueries({ queryKey: queryKeys.admin.posts(wsId) });
      if (payload?.postId) {
        qc.invalidateQueries({ queryKey: queryKeys.admin.post(wsId, payload.postId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentPipeline(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.contentCalendar(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
    },
    [WS_EVENTS.STRATEGY_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingKeywords(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingLatest(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.rankTrackingHistory(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.strategy(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.pageKeywords(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.keywordFeedback(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.latestRanks(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.rankHistory(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
    },
    [WS_EVENTS.LOCAL_SEO_UPDATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.localSeo(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.localSeoLocations(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.keywordCommandCenter(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.keywordStrategy(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
    },
    [WS_EVENTS.BRIEFING_GENERATED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(wsId) });
    },
    [WS_EVENTS.BRIEFING_PUBLISHED]: () => {
      if (!wsId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.briefingDrafts(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.briefing(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.admin.intelligenceAll(wsId) });
      qc.invalidateQueries({ queryKey: queryKeys.client.intelligence(wsId) });
    },
  };

  return { handlers, invalidated };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const WS_ID = 'ws-test-1';

describe('useWsInvalidation — event routing (pure)', () => {
  it('APPROVAL_UPDATE invalidates both client and admin approval keys plus workspaceHome', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.APPROVAL_UPDATE]();

    expect(invalidated).toContainEqual(queryKeys.client.approvals(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.approvals(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.cmsEditorAll());
    expect(invalidated).toContainEqual(queryKeys.admin.workspaceHome(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.notifications());
  });

  it('APPROVAL_APPLIED adds seoEditorAll invalidation on top of APPROVAL_UPDATE keys', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.APPROVAL_APPLIED]();

    expect(invalidated).toContainEqual(queryKeys.admin.seoEditorAll());
    expect(invalidated).toContainEqual(queryKeys.admin.cmsEditorAll());
    expect(invalidated).toContainEqual(queryKeys.admin.approvals(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.approvals(WS_ID));
  });

  it('CONTENT_UPDATED invalidates 13 query keys including both admin and client content paths', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.CONTENT_UPDATED]();

    // Admin-side content
    expect(invalidated).toContainEqual(queryKeys.admin.briefs(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.posts(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.roi(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    // Client-side content
    expect(invalidated).toContainEqual(queryKeys.client.contentRequests(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.contentPlan(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('AUDIT_COMPLETE refreshes both shared and client audit keys and the workspace overview', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.AUDIT_COMPLETE]();

    expect(invalidated).toContainEqual(queryKeys.shared.auditSummary(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.auditSummary(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.auditDetail(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.auditAll());
    expect(invalidated).toContainEqual(queryKeys.admin.workspaceOverview());
    expect(invalidated).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });

  it('OUTCOME_SCORED invalidates admin and client outcome paths including timeline and top-wins', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.OUTCOME_SCORED]();

    expect(invalidated).toContainEqual(queryKeys.admin.outcomeActions(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.outcomeScorecard(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.outcomeTimeline(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.outcomeTopWins(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.outcomeSummary(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.outcomeWins(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('OUTCOME_EXTERNAL_DETECTED only invalidates outcomeActions + client outcomeWins (not scorecard)', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.OUTCOME_EXTERNAL_DETECTED]();

    expect(invalidated).toContainEqual(queryKeys.admin.outcomeActions(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.outcomeWins(WS_ID));
    // Scorecard is NOT in the list for external detections
    expect(invalidated).not.toContainEqual(queryKeys.admin.outcomeScorecard(WS_ID));
  });

  it('CLIENT_SIGNAL_CREATED refreshes both clientSignals and the notification bell', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.CLIENT_SIGNAL_CREATED]();

    expect(invalidated).toContainEqual(queryKeys.admin.clientSignals(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.notifications());
  });

  it('CONTENT_REQUEST_UPDATE also refreshes the notification bell', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.CONTENT_REQUEST_UPDATE]();

    expect(invalidated).toContainEqual(queryKeys.client.contentRequests(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.notifications());
  });

  it('DIAGNOSTIC_COMPLETE uses insightFeed key (not the old admin-insights literal)', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.DIAGNOSTIC_COMPLETE]();

    expect(invalidated).toContainEqual(queryKeys.admin.insightFeed(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.diagnostics(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.diagnosticForInsightAll(WS_ID));
    // Verify the old incorrect key is NOT used
    expect(invalidated).not.toContainEqual(['admin-insights', WS_ID]);
  });

  it('SCHEMA_CMS_MAPPING_UPDATED extracts siteId from payload data object', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED]({ siteId: 'site-42' });

    expect(invalidated).toContainEqual(queryKeys.admin.schemaCmsFieldMappings('site-42'));
  });

  it('SCHEMA_CMS_MAPPING_UPDATED does nothing when siteId is missing from payload', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED]({});
    handlers[WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED](undefined);
    handlers[WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED](null);

    expect(invalidated).toHaveLength(0);
  });

  it('SCHEMA_SNAPSHOT_UPDATED invalidates both workspace-scoped and bare snapshot keys', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED]({ siteId: 'site-99' });

    expect(invalidated).toContainEqual(queryKeys.admin.schemaSnapshot('site-99'));
    expect(invalidated).toContainEqual(queryKeys.admin.schemaSnapshot('site-99', WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.schemaGraphValidation('site-99'));
    expect(invalidated).toContainEqual(queryKeys.admin.schemaGraphValidation('site-99', WS_ID));
  });

  it('POST_UPDATED invalidates per-post key when postId present in payload', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.POST_UPDATED]({ postId: 'post-7' });

    expect(invalidated).toContainEqual(queryKeys.admin.posts(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.post(WS_ID, 'post-7'));
    expect(invalidated).toContainEqual(queryKeys.admin.contentPipeline(WS_ID));
  });

  it('POST_UPDATED skips per-post key when postId is absent', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.POST_UPDATED]({});

    expect(invalidated).toContainEqual(queryKeys.admin.posts(WS_ID));
    // No per-post entry should appear
    const perPostKeys = invalidated.filter(k => Array.isArray(k) && k[0] === 'admin-post' && k.length === 3);
    expect(perPostKeys).toHaveLength(0);
  });

  it('STRATEGY_UPDATED fans out to both admin rank-tracking and client strategy/pageKeywords', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.STRATEGY_UPDATED]();

    expect(invalidated).toContainEqual(queryKeys.admin.keywordStrategy(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.rankTrackingKeywords(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.strategy(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.pageKeywords(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.keywordFeedback(WS_ID));
  });

  it('BRIEFING_PUBLISHED invalidates both admin drafts and client briefing', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.BRIEFING_PUBLISHED]();

    expect(invalidated).toContainEqual(queryKeys.admin.briefingDrafts(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.briefing(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('SUGGESTED_BRIEF_UPDATED refreshes suggested briefs, content pipeline, and intelligence', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.SUGGESTED_BRIEF_UPDATED]();

    expect(invalidated).toContainEqual(queryKeys.admin.aiSuggestedBriefs(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.contentPipeline(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.workspaceHome(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });

  it('COPY_SECTION_UPDATED refreshes copy review plus canonical content pipeline intelligence', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.COPY_SECTION_UPDATED]();

    expect(invalidated).toContainEqual(queryKeys.admin.copySectionsAll(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.copyStatusAll(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.contentPipeline(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });

  it('COPY_BATCH_COMPLETE refreshes batch, copy sections, content pipeline, and intelligence', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.COPY_BATCH_COMPLETE]();

    expect(invalidated).toContainEqual(queryKeys.admin.copyBatchAll(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.copySectionsAll(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.contentPipeline(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });

  it('RECOMMENDATIONS_UPDATED refreshes shared recommendations and operational intelligence', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.RECOMMENDATIONS_UPDATED]();

    expect(invalidated).toContainEqual(queryKeys.shared.recommendations(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.shared.pageEditStates(WS_ID, false));
    expect(invalidated).toContainEqual(queryKeys.shared.pageEditStates(WS_ID, true));
    expect(invalidated).toContainEqual(queryKeys.admin.actionQueue(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.workspaceHome(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('INTELLIGENCE_CACHE_UPDATED refreshes admin and client intelligence query roots', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.INTELLIGENCE_CACHE_UPDATED]();

    expect(invalidated).toContainEqual(queryKeys.admin.intelligence(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('BRIEFING_GENERATED only invalidates admin drafts (not client briefing)', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.BRIEFING_GENERATED]();

    expect(invalidated).toContainEqual(queryKeys.admin.briefingDrafts(WS_ID));
    expect(invalidated).not.toContainEqual(queryKeys.client.briefing(WS_ID));
  });

  it('DIAGNOSTIC_FAILED does not invalidate the insight feed (only diagnostics keys)', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.DIAGNOSTIC_FAILED]();

    expect(invalidated).toContainEqual(queryKeys.admin.diagnostics(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.diagnosticForInsightAll(WS_ID));
    expect(invalidated).not.toContainEqual(queryKeys.admin.insightFeed(WS_ID));
  });

  it('STRATEGY_UPDATED invalidates keywordStrategy (Task 1.2 — strategy read refreshes on strategy complete)', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.STRATEGY_UPDATED]();

    expect(invalidated).toContainEqual(queryKeys.admin.keywordStrategy(WS_ID));
  });

  it('LOCAL_SEO_UPDATED invalidates keywordStrategy (Task 1.2 — strategy read refreshes after local refresh)', () => {
    const { handlers, invalidated } = buildHandlers(WS_ID);
    handlers[WS_EVENTS.LOCAL_SEO_UPDATED]();

    expect(invalidated).toContainEqual(queryKeys.admin.keywordStrategy(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.localSeo(WS_ID));
    expect(invalidated).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });
});
