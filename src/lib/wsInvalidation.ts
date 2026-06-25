import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { invalidateMany, type QueryInvalidationKey } from './queryInvalidation';
import { WS_EVENTS, type WsEventName } from './wsEvents';

export type WorkspaceInvalidationScope =
  | 'admin'
  | 'admin-deliverables'
  | 'client-dashboard'
  | 'client-unified-inbox'
  | 'client-copy-review';

const NO_KEYS: readonly QueryInvalidationKey[] = [];

function readStringField(data: unknown, field: string): string | undefined {
  return typeof data === 'object' && data !== null && field in data
    ? String((data as Record<string, unknown>)[field])
    : undefined;
}

function contentPipelineKeys(workspaceId: string): readonly QueryInvalidationKey[] {
  return [
    queryKeys.admin.contentPipeline(workspaceId),
    queryKeys.admin.contentCalendar(workspaceId),
    queryKeys.admin.workspaceHome(workspaceId),
    queryKeys.admin.intelligenceAll(workspaceId),
  ] as const;
}

function contentSubscriptionKeys(workspaceId: string): readonly QueryInvalidationKey[] {
  return [
    ...contentPipelineKeys(workspaceId),
    queryKeys.admin.roi(workspaceId),
    queryKeys.client.roi(workspaceId),
  ] as const;
}

function strategyMutationKeys(workspaceId: string): readonly QueryInvalidationKey[] {
  return [
    queryKeys.admin.keywordStrategy(workspaceId),
    queryKeys.admin.strategyDiff(workspaceId),
    queryKeys.admin.backlinkProfile(workspaceId),
    queryKeys.admin.competitorIntelAll(workspaceId),
    queryKeys.admin.keywordFeedback(workspaceId),
    queryKeys.admin.keywordCommandCenter(workspaceId),
    queryKeys.admin.rankTrackingKeywords(workspaceId),
    queryKeys.admin.rankTrackingLatest(workspaceId),
    queryKeys.admin.rankTrackingHistory(workspaceId),
    queryKeys.admin.roi(workspaceId),
    queryKeys.client.roi(workspaceId),
    queryKeys.client.strategy(workspaceId),
    queryKeys.client.strategyGuidance(workspaceId),
    queryKeys.client.pageKeywords(workspaceId),
    queryKeys.client.keywordFeedback(workspaceId),
    queryKeys.client.latestRanks(workspaceId),
    queryKeys.client.rankHistory(workspaceId),
    queryKeys.admin.intelligenceAll(workspaceId),
    queryKeys.client.intelligence(workspaceId),
  ] as const;
}

function rankTrackingMutationKeys(workspaceId: string): readonly QueryInvalidationKey[] {
  return [
    queryKeys.admin.rankTrackingKeywords(workspaceId),
    queryKeys.admin.keywordCommandCenter(workspaceId),
    queryKeys.admin.rankTrackingLatest(workspaceId),
    queryKeys.admin.rankTrackingHistory(workspaceId),
    queryKeys.admin.workspaceHome(workspaceId),
    queryKeys.client.latestRanks(workspaceId),
    queryKeys.client.rankHistory(workspaceId),
    queryKeys.admin.keywordStrategy(workspaceId),
    queryKeys.client.strategy(workspaceId),
    queryKeys.client.strategyGuidance(workspaceId),
    queryKeys.client.pageKeywords(workspaceId),
    queryKeys.admin.intelligenceAll(workspaceId),
    queryKeys.admin.localSeo(workspaceId),
  ] as const;
}

function clientInsightKeys(workspaceId: string): readonly QueryInvalidationKey[] {
  return [
    queryKeys.client.clientInsights(workspaceId),
    queryKeys.client.intelligence(workspaceId),
  ] as const;
}

function schemaPlanKeys(workspaceId: string, data?: unknown): readonly QueryInvalidationKey[] {
  const siteId = readStringField(data, 'siteId');
  return siteId
    ? [
        queryKeys.admin.schemaPlan(siteId),
        queryKeys.admin.schemaPlan(siteId, workspaceId),
        queryKeys.admin.schemaGraphValidation(siteId),
        queryKeys.admin.schemaGraphValidation(siteId, workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.schemaPlan(workspaceId),
      ] as const
    : [
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.schemaPlan(workspaceId),
      ] as const;
}

function schemaSnapshotKeys(workspaceId: string, data?: unknown): readonly QueryInvalidationKey[] {
  const siteId = readStringField(data, 'siteId');
  return siteId
    ? [
        queryKeys.admin.schemaSnapshot(siteId),
        queryKeys.admin.schemaSnapshot(siteId, workspaceId),
        queryKeys.admin.schemaGraphValidation(siteId),
        queryKeys.admin.schemaGraphValidation(siteId, workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
      ] as const
    : [queryKeys.admin.intelligenceAll(workspaceId)] as const;
}

function adminInvalidationKeys(
  eventName: WsEventName,
  workspaceId: string,
  data?: unknown,
): readonly QueryInvalidationKey[] {
  switch (eventName) {
    case WS_EVENTS.APPROVAL_UPDATE:
      return [
        queryKeys.client.approvals(workspaceId),
        queryKeys.admin.approvals(workspaceId),
        queryKeys.admin.cmsEditorAll(),
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.notifications(),
      ] as const;
    case WS_EVENTS.APPROVAL_APPLIED:
      return [
        queryKeys.client.approvals(workspaceId),
        queryKeys.admin.approvals(workspaceId),
        queryKeys.admin.seoEditorAll(),
        queryKeys.admin.cmsEditorAll(),
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.notifications(),
      ] as const;
    case WS_EVENTS.REQUEST_CREATED:
    case WS_EVENTS.REQUEST_UPDATE:
      return [
        queryKeys.client.requests(workspaceId),
        queryKeys.admin.requests(workspaceId),
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.notifications(),
      ] as const;
    case WS_EVENTS.CONTENT_REQUEST_CREATED:
    case WS_EVENTS.CONTENT_REQUEST_UPDATE:
      return [
        queryKeys.client.contentRequests(workspaceId),
        queryKeys.admin.requests(workspaceId),
        queryKeys.admin.workspaceBadges(workspaceId),
        ...contentPipelineKeys(workspaceId),
        queryKeys.admin.notifications(),
      ] as const;
    case WS_EVENTS.BRIEF_UPDATED:
      return [
        queryKeys.admin.briefs(workspaceId),
        queryKeys.admin.contentPipeline(workspaceId),
        queryKeys.admin.workspaceHome(workspaceId),
      ] as const;
    case WS_EVENTS.CONTENT_UPDATED:
      return [
        queryKeys.admin.briefs(workspaceId),
        queryKeys.admin.posts(workspaceId),
        queryKeys.admin.postsDetailAll(workspaceId),
        queryKeys.admin.contentTemplates(workspaceId),
        queryKeys.admin.contentMatrices(workspaceId),
        ...contentPipelineKeys(workspaceId),
        queryKeys.admin.roi(workspaceId),
        queryKeys.client.roi(workspaceId),
        queryKeys.client.contentRequests(workspaceId),
        queryKeys.client.contentPlan(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.ACTIVITY_NEW:
      return [
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.workspaceOverview(),
        queryKeys.client.activity(workspaceId),
        queryKeys.client.workFeedActivity(workspaceId),
      ] as const;
    case WS_EVENTS.AUDIT_COMPLETE:
      return [
        queryKeys.shared.auditSummary(workspaceId),
        queryKeys.client.auditSummary(workspaceId),
        queryKeys.client.auditDetail(workspaceId),
        queryKeys.admin.auditAll(),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.intelligence(workspaceId),
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.workspaceOverview(),
      ] as const;
    case WS_EVENTS.ANOMALIES_UPDATE:
      return [
        queryKeys.admin.anomalyAlerts(workspaceId),
        queryKeys.client.anomalies(workspaceId),
        queryKeys.admin.notifications(),
        // Anomaly dismissal reverses boosts → feed ordering/contents change (2026-06-09 audit).
        queryKeys.admin.insightFeed(workspaceId),
      ] as const;
    case WS_EVENTS.WORKSPACE_UPDATED:
      return [
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.workspaceDetail(workspaceId),
        queryKeys.admin.workspaceOverview(),
        queryKeys.admin.auditSuppressions(workspaceId),
        queryKeys.admin.ga4All(workspaceId),
        queryKeys.admin.gscAny(),
        queryKeys.admin.auditTrafficAll(),
        queryKeys.admin.insightFeed(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.admin.rankTrackingLatest(workspaceId),
        queryKeys.admin.rankTrackingHistory(workspaceId),
        queryKeys.client.ga4All(workspaceId),
        queryKeys.client.gscAll(workspaceId),
        queryKeys.client.insights(workspaceId),
        queryKeys.client.clientInsights(workspaceId),
        queryKeys.client.intelligence(workspaceId),
        queryKeys.client.rankHistory(workspaceId),
        queryKeys.client.latestRanks(workspaceId),
        // The Issue (Client) P0 — a saved outcomeValue/segmentConfig changes the dollar verdict, so
        // the ROI caches (which now carry outcomeVerdict) must refresh on workspace update.
        queryKeys.admin.roi(workspaceId),
        queryKeys.client.roi(workspaceId),
      ] as const;
    case WS_EVENTS.PAGE_STATE_UPDATED:
      return [
        queryKeys.shared.pageEditStates(workspaceId, false),
        queryKeys.shared.pageEditStates(workspaceId, true),
        queryKeys.admin.seoEditorAll(),
        queryKeys.admin.cmsEditorAll(),
        queryKeys.admin.seoSuggestions(workspaceId),
        queryKeys.admin.pageJoinPagesAll(),
        queryKeys.admin.workspaceHome(workspaceId),
      ] as const;
    case WS_EVENTS.CONTENT_PUBLISHED:
      return [
        queryKeys.admin.posts(workspaceId),
        queryKeys.admin.postsDetailAll(workspaceId),
        ...contentPipelineKeys(workspaceId),
        queryKeys.admin.roi(workspaceId),
        queryKeys.client.roi(workspaceId),
      ] as const;
    case WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED:
    case WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED:
    case WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED:
      return contentSubscriptionKeys(workspaceId);
    case WS_EVENTS.COPY_SECTION_UPDATED:
      return [
        queryKeys.admin.copySectionsAll(workspaceId),
        queryKeys.admin.copyStatusAll(workspaceId),
        queryKeys.admin.contentPipeline(workspaceId),
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
      ] as const;
    case WS_EVENTS.DELIVERABLE_SENT:
    case WS_EVENTS.DELIVERABLE_UPDATED:
      return [queryKeys.admin.workspaceDeliverables(workspaceId)] as const;
    case WS_EVENTS.INSIGHT_RESOLVED:
      return [
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.clientInsights(workspaceId),
        queryKeys.client.intelligence(workspaceId),
        // The Connected Intelligence feed showed resolved items as open (2026-06-09 audit).
        queryKeys.admin.insightFeed(workspaceId),
      ] as const;
    case WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED:
      return [
        queryKeys.admin.intelligenceSignals(workspaceId),
        queryKeys.admin.aiSuggestedBriefs(workspaceId),
        queryKeys.admin.keywordCommandCenter(workspaceId),
      ] as const;
    case WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED: {
      const siteId = readStringField(data, 'siteId');
      return siteId ? [queryKeys.admin.schemaCmsFieldMappings(siteId)] as const : NO_KEYS;
    }
    case WS_EVENTS.SCHEMA_PLAN_UPDATED:
      return schemaPlanKeys(workspaceId, data);
    case WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED:
      return schemaSnapshotKeys(workspaceId, data);
    case WS_EVENTS.OUTCOME_ACTION_RECORDED:
      return [
        queryKeys.admin.outcomeActions(workspaceId),
        queryKeys.admin.outcomeScorecard(workspaceId),
        queryKeys.admin.outcomeTimeline(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.OUTCOME_SCORED:
      return [
        queryKeys.admin.outcomeActions(workspaceId),
        queryKeys.admin.outcomeScorecard(workspaceId),
        queryKeys.admin.outcomeTimeline(workspaceId),
        queryKeys.admin.outcomeTopWins(workspaceId),
        queryKeys.admin.outcomeLearnings(workspaceId),
        queryKeys.client.outcomeSummary(workspaceId),
        queryKeys.client.outcomeWins(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.intelligence(workspaceId),
        // W5.1: outcome read-back chips/badges live on these admin surfaces, so a
        // newly scored outcome must refresh them — the Strategy tab keyword rows,
        // the Keyword Hub (rows + detail drawer), and the Posts list badges.
        queryKeys.admin.keywordStrategy(workspaceId),
        queryKeys.admin.keywordCommandCenter(workspaceId),
        queryKeys.admin.posts(workspaceId),
      ] as const;
    case WS_EVENTS.OUTCOME_EXTERNAL_DETECTED:
      return [
        queryKeys.admin.outcomeActions(workspaceId),
        queryKeys.client.outcomeWins(workspaceId),
      ] as const;
    case WS_EVENTS.OUTCOME_LEARNINGS_UPDATED:
      return [
        queryKeys.admin.outcomeActions(workspaceId),
        queryKeys.admin.outcomeTimeline(workspaceId),
        queryKeys.admin.outcomeLearnings(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED:
      return [
        queryKeys.admin.outcomePlaybooks(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
      ] as const;
    case WS_EVENTS.FORM_CAPTURE_CONFIG_UPDATED:
      return [
        queryKeys.admin.conversionTrackingStatus(workspaceId),
        queryKeys.admin.roi(workspaceId),
        queryKeys.client.roi(workspaceId),
      ] as const;
    case WS_EVENTS.SUGGESTED_BRIEF_UPDATED:
      return [
        queryKeys.admin.aiSuggestedBriefs(workspaceId),
        queryKeys.admin.contentPipeline(workspaceId),
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
      ] as const;
    case WS_EVENTS.INSIGHT_BRIDGE_UPDATED:
      return [
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.clientInsights(workspaceId),
        // Bridge score adjustments change feed ordering (2026-06-09 audit).
        queryKeys.admin.insightFeed(workspaceId),
      ] as const;
    case WS_EVENTS.ANNOTATION_BRIDGE_CREATED:
      return [
        queryKeys.admin.analyticsAnnotations(workspaceId),
        queryKeys.client.annotations(workspaceId),
      ] as const;
    case WS_EVENTS.INTELLIGENCE_CACHE_UPDATED:
      return [
        queryKeys.admin.intelligence(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.CLIENT_SIGNAL_CREATED:
    case WS_EVENTS.CLIENT_SIGNAL_UPDATED:
      return [
        queryKeys.admin.clientSignals(workspaceId),
        queryKeys.admin.notifications(),
      ] as const;
    case WS_EVENTS.CLIENT_ACTION_UPDATE:
      return [
        queryKeys.client.clientActions(workspaceId),
        queryKeys.admin.clientActions(workspaceId),
        queryKeys.admin.intelligence(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.notifications(),
      ] as const;
    case WS_EVENTS.MEETING_BRIEF_GENERATED:
      return [queryKeys.admin.meetingBrief(workspaceId)] as const;
    case WS_EVENTS.COPY_METADATA_UPDATED:
      return [queryKeys.admin.copyMetadataAll(workspaceId)] as const;
    case WS_EVENTS.COPY_BATCH_PROGRESS:
      return [queryKeys.admin.copyBatchAll(workspaceId)] as const;
    case WS_EVENTS.COPY_BATCH_COMPLETE:
      return [
        queryKeys.admin.copyBatchAll(workspaceId),
        queryKeys.admin.copySectionsAll(workspaceId),
        queryKeys.admin.copyStatusAll(workspaceId),
        queryKeys.admin.contentPipeline(workspaceId),
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
      ] as const;
    case WS_EVENTS.COPY_INTELLIGENCE_UPDATED:
      return [
        queryKeys.admin.copyIntelligence(workspaceId),
        queryKeys.admin.copyPromotable(workspaceId),
        queryKeys.admin.contentPipeline(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
      ] as const;
    case WS_EVENTS.DIAGNOSTIC_COMPLETE:
      return [
        queryKeys.admin.diagnosticForInsightAll(workspaceId),
        queryKeys.admin.diagnostics(workspaceId),
        queryKeys.admin.insightFeed(workspaceId),
      ] as const;
    case WS_EVENTS.DIAGNOSTIC_FAILED:
      return [
        queryKeys.admin.diagnosticForInsightAll(workspaceId),
        queryKeys.admin.diagnostics(workspaceId),
      ] as const;
    case WS_EVENTS.BULK_OPERATION_COMPLETE:
      return readStringField(data, 'operation') === 'bulk-rewrite'
        ? [queryKeys.admin.seoSuggestions(workspaceId)] as const
        : NO_KEYS;
    case WS_EVENTS.RECOMMENDATIONS_UPDATED:
      return [
        queryKeys.shared.recommendations(workspaceId),
        queryKeys.admin.recommendations(workspaceId),
        queryKeys.shared.pageEditStates(workspaceId, false),
        queryKeys.shared.pageEditStates(workspaceId, true),
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED:
      return [
        queryKeys.admin.recDiscussion(workspaceId),
        queryKeys.client.curatedRecommendations(workspaceId),
      ] as const;
    case WS_EVENTS.STRATEGY_UPDATED:
      return strategyMutationKeys(workspaceId);
    case WS_EVENTS.RANK_TRACKING_UPDATED:
      return rankTrackingMutationKeys(workspaceId);
    case WS_EVENTS.SERP_SNAPSHOTS_REFRESHED:
      // P6 national-serp-tracking: a national SERP refresh upserted serp_snapshots →
      // re-pull the command center so the drawer's live-SERP / AI-Overview detail updates.
      return [queryKeys.admin.keywordCommandCenter(workspaceId)] as const;
    case WS_EVENTS.LOCAL_GBP_SNAPSHOTS_REFRESHED:
      // P7 local-gbp: a GBP/reviews refresh upserted business_listing_snapshots → re-pull the
      // GbpReviewsPanel's OWN query key (a distinct prefix; localSeo does NOT cascade to it),
      // plus the local-SEO panel + command center. Without localGbpReviews the panel only refreshes
      // from the triggering mutation — mid-job progress + other tabs would go stale (P7 review).
      return [
        queryKeys.admin.localGbpReviews(workspaceId),
        queryKeys.admin.localSeo(workspaceId),
        queryKeys.admin.keywordCommandCenter(workspaceId),
      ] as const;
    case WS_EVENTS.LLM_MENTIONS_SNAPSHOTS_REFRESHED:
      // P8 ai-visibility: a llm-mentions refresh upserted llm_mention_snapshots → re-pull the
      // AI-visibility KPI's OWN query key (distinct prefix; must be listed explicitly) + the
      // strategy/intelligence surfaces that carry the AI-visibility slice summary.
      return [
        queryKeys.admin.aiVisibility(workspaceId),
        queryKeys.admin.keywordStrategy(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
      ] as const;
    case WS_EVENTS.LOCAL_SEO_UPDATED:
      return [
        queryKeys.admin.localSeo(workspaceId),
        queryKeys.admin.localSeoLocations(workspaceId),
        queryKeys.admin.keywordCommandCenter(workspaceId),
        queryKeys.admin.keywordStrategy(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
      ] as const;
    case WS_EVENTS.EEAT_ASSETS_UPDATED:
      return [
        queryKeys.admin.eeatAssets(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.admin.keywordStrategy(workspaceId),
        queryKeys.admin.workspaceHome(workspaceId),
      ] as const;
    case WS_EVENTS.BRANDSCRIPT_UPDATED:
      return [queryKeys.admin.brandscripts(workspaceId)] as const;
    case WS_EVENTS.DISCOVERY_UPDATED:
      return [
        queryKeys.admin.discoverySources(workspaceId),
        queryKeys.admin.discoveryExtractionsAll(workspaceId),
      ] as const;
    case WS_EVENTS.VOICE_PROFILE_UPDATED:
      return [queryKeys.admin.voiceProfile(workspaceId)] as const;
    case WS_EVENTS.BRAND_IDENTITY_UPDATED:
      return [queryKeys.admin.brandIdentity(workspaceId)] as const;
    case WS_EVENTS.BLUEPRINT_UPDATED:
      return [
        queryKeys.admin.blueprints(workspaceId),
        queryKeys.admin.blueprintAll(workspaceId),
        queryKeys.admin.blueprintVersionsAll(workspaceId),
      ] as const;
    case WS_EVENTS.BLUEPRINT_GENERATED:
      return [queryKeys.admin.blueprints(workspaceId)] as const;
    case WS_EVENTS.COPY_EXPORT_COMPLETE:
      return [
        queryKeys.admin.copyStatusAll(workspaceId),
        queryKeys.admin.copySectionsAll(workspaceId),
      ] as const;
    case WS_EVENTS.POST_UPDATED: {
      const postId = readStringField(data, 'postId');
      return postId
        ? [
            queryKeys.admin.posts(workspaceId),
            queryKeys.admin.post(workspaceId, postId),
            queryKeys.admin.contentPipeline(workspaceId),
            queryKeys.admin.contentCalendar(workspaceId),
            queryKeys.admin.workspaceHome(workspaceId),
            queryKeys.admin.intelligenceAll(workspaceId),
          ] as const
        : [
            queryKeys.admin.posts(workspaceId),
            queryKeys.admin.contentPipeline(workspaceId),
            queryKeys.admin.contentCalendar(workspaceId),
            queryKeys.admin.workspaceHome(workspaceId),
            queryKeys.admin.intelligenceAll(workspaceId),
          ] as const;
    }
    case WS_EVENTS.BRIEFING_GENERATED:
      return [queryKeys.admin.briefingDrafts(workspaceId)] as const;
    case WS_EVENTS.BRIEFING_PUBLISHED:
      return [
        queryKeys.admin.briefingDrafts(workspaceId),
        queryKeys.client.briefing(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.WORK_ORDER_UPDATE:
      return [
        queryKeys.admin.contentPipeline(workspaceId),
        queryKeys.admin.intelligenceAll(workspaceId),
        queryKeys.admin.workspaceHome(workspaceId),
        queryKeys.admin.workOrders(workspaceId),
        queryKeys.client.workOrders(workspaceId),
        queryKeys.admin.notifications(),
      ] as const;
    case WS_EVENTS.WORK_ORDER_COMMENT: {
      const orderId = readStringField(data, 'id');
      return orderId
        ? [
            queryKeys.admin.workOrderComments(workspaceId, orderId),
            queryKeys.admin.workOrders(workspaceId),
          ] as const
        : [
            queryKeys.admin.workOrderCommentsAll(workspaceId),
            queryKeys.admin.workOrders(workspaceId),
          ] as const;
    }
    default:
      return NO_KEYS;
  }
}

function clientDashboardInvalidationKeys(
  eventName: WsEventName,
  workspaceId: string,
  data?: unknown,
): readonly QueryInvalidationKey[] {
  switch (eventName) {
    case WS_EVENTS.ACTIVITY_NEW:
      return [
        queryKeys.client.activity(workspaceId),
        queryKeys.client.workFeedActivity(workspaceId),
      ] as const;
    case WS_EVENTS.APPROVAL_UPDATE:
    case WS_EVENTS.APPROVAL_APPLIED:
      return [queryKeys.client.approvals(workspaceId)] as const;
    case WS_EVENTS.CLIENT_ACTION_UPDATE:
      return [queryKeys.client.clientActions(workspaceId)] as const;
    case WS_EVENTS.REQUEST_CREATED:
    case WS_EVENTS.REQUEST_UPDATE:
      return [queryKeys.client.requests(workspaceId)] as const;
    case WS_EVENTS.CONTENT_REQUEST_CREATED:
    case WS_EVENTS.CONTENT_REQUEST_UPDATE:
      return [queryKeys.client.contentRequests(workspaceId)] as const;
    case WS_EVENTS.BRIEF_UPDATED:
      return [
        queryKeys.client.contentRequests(workspaceId),
        queryKeys.client.contentPlan(workspaceId),
        queryKeys.client.unifiedInbox(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.CONTENT_UPDATED:
      return [
        queryKeys.client.contentRequests(workspaceId),
        queryKeys.client.contentPlan(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.CONTENT_SUBSCRIPTION_CREATED:
    case WS_EVENTS.CONTENT_SUBSCRIPTION_UPDATED:
    case WS_EVENTS.CONTENT_SUBSCRIPTION_RENEWED:
      return [queryKeys.client.contentSubscription(workspaceId)] as const;
    case WS_EVENTS.DELIVERABLE_SENT:
    case WS_EVENTS.DELIVERABLE_UPDATED:
      // strategy-the-issue (Phase 2): a rec→deliverable send / response surfaces in the
      // evergreen curated feed + the loop footer — refresh both halves of the loop.
      return [
        queryKeys.client.unifiedInbox(workspaceId),
        queryKeys.client.theIssue(workspaceId),
        queryKeys.client.recResponses(workspaceId),
      ] as const;
    case WS_EVENTS.COPY_SECTION_UPDATED:
      return [
        queryKeys.client.copyEntries(workspaceId),
        queryKeys.client.copyEntriesCount(workspaceId),
      ] as const;
    case WS_EVENTS.POST_UPDATED:
      return [queryKeys.client.postPreviewAll(workspaceId)] as const;
    case WS_EVENTS.AUDIT_COMPLETE:
      return [
        queryKeys.client.auditSummary(workspaceId),
        queryKeys.client.activity(workspaceId),
        queryKeys.client.workFeedActivity(workspaceId),
      ] as const;
    case WS_EVENTS.WORKSPACE_UPDATED:
      // client.roi carries the outcomeVerdict (The Issue P0), which depends on the workspace's
      // outcomeValue/segmentConfig — refresh it when those are saved.
      return [queryKeys.client.pricing(workspaceId), queryKeys.client.roi(workspaceId)] as const;
    case WS_EVENTS.FORM_CAPTURE_CONFIG_UPDATED:
      // client.roi carries the outcomeVerdict provenance label; saving tracked forms can flip it to
      // measured_action before the next capture poll.
      return [queryKeys.client.roi(workspaceId)] as const;
    case WS_EVENTS.PAGE_STATE_UPDATED:
      return [
        queryKeys.shared.pageEditStates(workspaceId, false),
        queryKeys.shared.pageEditStates(workspaceId, true),
        queryKeys.client.activity(workspaceId),
        queryKeys.client.workFeedActivity(workspaceId),
      ] as const;
    case WS_EVENTS.RECOMMENDATIONS_UPDATED:
      // strategy-the-issue (Phase 2): the curated feed + the loop-footer response summary
      // both derive from the rec set — refresh them alongside the shared raw read so a
      // greenlit/sent rec updates the client surface immediately (both-halves contract).
      return [
        queryKeys.shared.recommendations(workspaceId),
        queryKeys.client.theIssue(workspaceId),
        queryKeys.client.recResponses(workspaceId),
      ] as const;
    case WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED:
      // Client reads rec discussion via the curated read — refresh it on a discussion update
      // (both halves of the broadcast; the curated consumer lands in Phase 4).
      return [queryKeys.client.curatedRecommendations(workspaceId)] as const;
    case WS_EVENTS.BRIEFING_PUBLISHED:
      return [queryKeys.client.briefing(workspaceId)] as const;
    case WS_EVENTS.STRATEGY_UPDATED:
      return [
        queryKeys.client.strategy(workspaceId),
        queryKeys.client.pageKeywords(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.RANK_TRACKING_UPDATED:
      return [
        queryKeys.client.rankHistory(workspaceId),
        queryKeys.client.latestRanks(workspaceId),
        queryKeys.client.strategy(workspaceId),
        queryKeys.client.pageKeywords(workspaceId),
      ] as const;
    case WS_EVENTS.WORK_ORDER_UPDATE:
      return [queryKeys.client.workOrders(workspaceId)] as const;
    case WS_EVENTS.WORK_ORDER_COMMENT: {
      const orderId = readStringField(data, 'id');
      return orderId
        ? [
            queryKeys.client.workOrderComments(workspaceId, orderId),
            queryKeys.client.unifiedInbox(workspaceId),
          ] as const
        : [
            queryKeys.client.workOrderCommentsAll(workspaceId),
            queryKeys.client.unifiedInbox(workspaceId),
          ] as const;
    }
    case WS_EVENTS.OUTCOME_SCORED:
      return [
        queryKeys.client.outcomeSummary(workspaceId),
        queryKeys.client.outcomeWins(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.OUTCOME_EXTERNAL_DETECTED:
      return [queryKeys.client.outcomeWins(workspaceId)] as const;
    case WS_EVENTS.OUTCOME_ACTION_RECORDED:
      return [
        queryKeys.client.outcomeSummary(workspaceId),
        queryKeys.client.intelligence(workspaceId),
      ] as const;
    case WS_EVENTS.OUTCOME_LEARNINGS_UPDATED:
      return [queryKeys.client.intelligence(workspaceId)] as const;
    case WS_EVENTS.OUTCOME_PLAYBOOK_DISCOVERED:
      return [queryKeys.client.intelligence(workspaceId)] as const;
    case WS_EVENTS.INSIGHT_BRIDGE_UPDATED:
    case WS_EVENTS.INTELLIGENCE_CACHE_UPDATED:
    case WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED:
    // 2026-06-09 audit: the admin scope handled INSIGHT_RESOLVED and even listed client
    // keys — dead in a client session. The client portal needs its own mapping or the
    // digest shows resolved insights as open until refocus.
    case WS_EVENTS.INSIGHT_RESOLVED:
      return clientInsightKeys(workspaceId);
    case WS_EVENTS.CONTENT_PUBLISHED:
      // Manual publish (server/routes/content-publish.ts) broadcasts ONLY this event —
      // without a client mapping the post status, content plan, and ROI stay stale.
      return [
        queryKeys.client.contentPlan(workspaceId),
        queryKeys.client.roi(workspaceId),
        queryKeys.client.postPreviewAll(workspaceId),
        queryKeys.client.activity(workspaceId),
        queryKeys.client.workFeedActivity(workspaceId),
      ] as const;
    case WS_EVENTS.ANNOTATION_BRIDGE_CREATED:
      return [queryKeys.client.annotations(workspaceId)] as const;
    case WS_EVENTS.ANOMALIES_UPDATE:
      return [queryKeys.client.anomalies(workspaceId)] as const;
    case WS_EVENTS.SCHEMA_PLAN_SENT:
    case WS_EVENTS.SCHEMA_PLAN_UPDATED:
      return [queryKeys.client.schemaPlan(workspaceId)] as const;
    case WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED:
      return [
        queryKeys.client.schemaPlan(workspaceId),
        queryKeys.client.schemaSnapshot(workspaceId),
      ] as const;
    case WS_EVENTS.JOB_CREATED:
    case WS_EVENTS.JOB_UPDATED:
      return [queryKeys.client.jobs(workspaceId)] as const;
    default:
      return NO_KEYS;
  }
}

function adminDeliverablesInvalidationKeys(
  eventName: WsEventName,
  workspaceId: string,
): readonly QueryInvalidationKey[] {
  switch (eventName) {
    case WS_EVENTS.DELIVERABLE_SENT:
    case WS_EVENTS.DELIVERABLE_UPDATED:
      return [queryKeys.admin.workspaceDeliverables(workspaceId)] as const;
    default:
      return NO_KEYS;
  }
}

function clientUnifiedInboxInvalidationKeys(
  eventName: WsEventName,
  workspaceId: string,
  data?: unknown,
): readonly QueryInvalidationKey[] {
  switch (eventName) {
    case WS_EVENTS.DELIVERABLE_SENT:
    case WS_EVENTS.DELIVERABLE_UPDATED:
    case WS_EVENTS.COPY_SECTION_UPDATED:
    case WS_EVENTS.CONTENT_REQUEST_UPDATE:
    case WS_EVENTS.POST_UPDATED:
    case WS_EVENTS.WORK_ORDER_UPDATE:
      return [queryKeys.client.unifiedInbox(workspaceId)] as const;
    case WS_EVENTS.WORK_ORDER_COMMENT: {
      const orderId = readStringField(data, 'id');
      return orderId
        ? [
            queryKeys.client.workOrderComments(workspaceId, orderId),
            queryKeys.client.unifiedInbox(workspaceId),
          ] as const
        : [
            queryKeys.client.workOrderCommentsAll(workspaceId),
            queryKeys.client.unifiedInbox(workspaceId),
          ] as const;
    }
    default:
      return NO_KEYS;
  }
}

function clientCopyReviewInvalidationKeys(
  eventName: WsEventName,
  workspaceId: string,
): readonly QueryInvalidationKey[] {
  switch (eventName) {
    case WS_EVENTS.COPY_SECTION_UPDATED:
      return [
        queryKeys.client.copyEntries(workspaceId),
        queryKeys.client.copyEntriesCount(workspaceId),
        queryKeys.client.copySectionsAll(workspaceId),
      ] as const;
    default:
      return NO_KEYS;
  }
}

export function getWorkspaceInvalidationKeys(
  eventName: WsEventName,
  workspaceId: string | undefined,
  data: unknown,
  scope: WorkspaceInvalidationScope,
): readonly QueryInvalidationKey[] {
  if (!workspaceId) return NO_KEYS;

  switch (scope) {
    case 'admin':
      return adminInvalidationKeys(eventName, workspaceId, data);
    case 'admin-deliverables':
      return adminDeliverablesInvalidationKeys(eventName, workspaceId);
    case 'client-dashboard':
      return clientDashboardInvalidationKeys(eventName, workspaceId, data);
    case 'client-unified-inbox':
      return clientUnifiedInboxInvalidationKeys(eventName, workspaceId, data);
    case 'client-copy-review':
      return clientCopyReviewInvalidationKeys(eventName, workspaceId);
    default:
      return NO_KEYS;
  }
}

export function invalidateWorkspaceEventQueries(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  eventName: WsEventName,
  workspaceId: string | undefined,
  data: unknown,
  scope: WorkspaceInvalidationScope,
): void {
  invalidateMany(queryClient, getWorkspaceInvalidationKeys(eventName, workspaceId, data, scope));
}
