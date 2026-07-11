import { describe, expect, it } from 'vitest';
import { queryKeys } from '../../src/lib/queryKeys.js';
import { getWorkspaceInvalidationKeys } from '../../src/lib/wsInvalidation.js';
import { WS_EVENTS } from '../../src/lib/wsEvents.js';

const WS_ID = 'ws-test-1';

function adminKeys(eventName: typeof WS_EVENTS[keyof typeof WS_EVENTS], data?: unknown) {
  return getWorkspaceInvalidationKeys(eventName, WS_ID, data, 'admin');
}

describe('useWsInvalidation registry parity (pure)', () => {
  it('APPROVAL_UPDATE invalidates both client and admin approval keys plus workspaceHome', () => {
    const keys = adminKeys(WS_EVENTS.APPROVAL_UPDATE);

    expect(keys).toContainEqual(queryKeys.client.approvals(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.approvals(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.cmsEditorAll());
    expect(keys).toContainEqual(queryKeys.admin.workspaceHome(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.notifications());
  });

  it('APPROVAL_APPLIED adds seoEditorAll invalidation on top of APPROVAL_UPDATE keys', () => {
    const keys = adminKeys(WS_EVENTS.APPROVAL_APPLIED);

    expect(keys).toContainEqual(queryKeys.admin.seoEditorAll());
    expect(keys).toContainEqual(queryKeys.admin.cmsEditorAll());
    expect(keys).toContainEqual(queryKeys.admin.approvals(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.approvals(WS_ID));
  });

  it('CONTENT_UPDATED invalidates the existing admin and client content paths', () => {
    const keys = adminKeys(WS_EVENTS.CONTENT_UPDATED);

    expect(keys).toContainEqual(queryKeys.admin.briefs(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.posts(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.roi(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.roi(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.contentRequests(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.contentPlan(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('AUDIT_COMPLETE refreshes both shared and client audit keys and the workspace overview', () => {
    const keys = adminKeys(WS_EVENTS.AUDIT_COMPLETE);

    expect(keys).toContainEqual(queryKeys.shared.auditSummary(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.auditSummary(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.auditDetail(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.auditAll());
    expect(keys).toContainEqual(queryKeys.admin.workspaceOverview());
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });

  it('WORKSPACE_UPDATED fans out to admin and client billing/analytics readers', () => {
    const keys = adminKeys(WS_EVENTS.WORKSPACE_UPDATED);

    expect(keys).toContainEqual(queryKeys.admin.workspaceHome(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.workspaceDetail(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.ga4All(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.gscAny());
    expect(keys).toContainEqual(queryKeys.client.ga4All(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.gscAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.clientInsights(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.latestRanks(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.monthlyDigest(WS_ID));
  });

  it('OUTCOME_SCORED invalidates admin and client outcome paths including timeline and top-wins', () => {
    const keys = adminKeys(WS_EVENTS.OUTCOME_SCORED);

    expect(keys).toContainEqual(queryKeys.admin.outcomeActions(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.outcomeScorecard(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.outcomeTimeline(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.outcomeTopWins(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.outcomeLearnings(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.outcomeSummary(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.outcomeWins(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.intelligence(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.contentPerformanceAll(WS_ID));
  });

  it('CONTENT_PUBLISHED invalidates content performance even when its surface is not mounted', () => {
    const keys = adminKeys(WS_EVENTS.CONTENT_PUBLISHED);

    expect(keys).toContainEqual(queryKeys.admin.posts(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.contentPipeline(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.contentPerformanceAll(WS_ID));
  });

  it('OUTCOME_LEARNINGS_UPDATED refreshes learnings and both intelligence roots', () => {
    const keys = adminKeys(WS_EVENTS.OUTCOME_LEARNINGS_UPDATED);

    expect(keys).toContainEqual(queryKeys.admin.outcomeActions(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.outcomeTimeline(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.outcomeLearnings(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('VOICE_PROFILE_UPDATED refreshes the profile and both admin intelligence roots', () => {
    const keys = adminKeys(WS_EVENTS.VOICE_PROFILE_UPDATED);

    expect(keys).toContainEqual(queryKeys.admin.voiceProfile(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligence(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.monthlyDigest(WS_ID));
  });

  it('OUTCOME_EXTERNAL_DETECTED refreshes outcome readers and the monthly digest', () => {
    const keys = adminKeys(WS_EVENTS.OUTCOME_EXTERNAL_DETECTED);

    expect(keys).toContainEqual(queryKeys.admin.outcomeActions(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.outcomeWins(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.monthlyDigest(WS_ID));
    expect(keys).not.toContainEqual(queryKeys.admin.outcomeScorecard(WS_ID));
  });

  it('CLIENT_SIGNAL_CREATED refreshes both clientSignals and the notification bell', () => {
    const keys = adminKeys(WS_EVENTS.CLIENT_SIGNAL_CREATED);

    expect(keys).toContainEqual(queryKeys.admin.clientSignals(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.notifications());
  });

  it('CONTENT_REQUEST_UPDATE also refreshes the notification bell', () => {
    const keys = adminKeys(WS_EVENTS.CONTENT_REQUEST_UPDATE);

    expect(keys).toContainEqual(queryKeys.client.contentRequests(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.notifications());
  });

  it('DIAGNOSTIC_COMPLETE uses insightFeed key (not the old admin-insights literal)', () => {
    const keys = adminKeys(WS_EVENTS.DIAGNOSTIC_COMPLETE);

    expect(keys).toContainEqual(queryKeys.admin.insightFeed(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.diagnostics(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.diagnosticForInsightAll(WS_ID));
    expect(keys).not.toContainEqual(['admin-insights', WS_ID]);
  });

  it('SCHEMA_CMS_MAPPING_UPDATED extracts siteId from payload data object', () => {
    const keys = adminKeys(WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED, { siteId: 'site-42' });

    expect(keys).toEqual([queryKeys.admin.schemaCmsFieldMappings('site-42')]);
  });

  it('SCHEMA_CMS_MAPPING_UPDATED does nothing when siteId is missing from payload', () => {
    expect(adminKeys(WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED, {})).toHaveLength(0);
    expect(adminKeys(WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED)).toHaveLength(0);
    expect(adminKeys(WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED, null)).toHaveLength(0);
  });

  it('SCHEMA_PLAN_UPDATED invalidates both bare and workspace-scoped plan keys plus graph validation', () => {
    const keys = adminKeys(WS_EVENTS.SCHEMA_PLAN_UPDATED, { siteId: 'site-99' });

    expect(keys).toContainEqual(queryKeys.admin.schemaPlan('site-99'));
    expect(keys).toContainEqual(queryKeys.admin.schemaPlan('site-99', WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.schemaGraphValidation('site-99'));
    expect(keys).toContainEqual(queryKeys.admin.schemaGraphValidation('site-99', WS_ID));
    expect(keys).toContainEqual(queryKeys.client.schemaPlan(WS_ID));
  });

  it('SCHEMA_SNAPSHOT_UPDATED invalidates both workspace-scoped and bare snapshot keys', () => {
    const keys = adminKeys(WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED, { siteId: 'site-99' });

    expect(keys).toContainEqual(queryKeys.admin.schemaSnapshot('site-99'));
    expect(keys).toContainEqual(queryKeys.admin.schemaSnapshot('site-99', WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.schemaGraphValidation('site-99'));
    expect(keys).toContainEqual(queryKeys.admin.schemaGraphValidation('site-99', WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });

  it('BULK_OPERATION_COMPLETE invalidates seoSuggestions only for bulk rewrites', () => {
    expect(adminKeys(WS_EVENTS.BULK_OPERATION_COMPLETE, { operation: 'bulk-rewrite' }))
      .toContainEqual(queryKeys.admin.seoSuggestions(WS_ID));
    expect(adminKeys(WS_EVENTS.BULK_OPERATION_COMPLETE, { operation: 'bulk-analyze' }))
      .not.toContainEqual(queryKeys.admin.seoSuggestions(WS_ID));
  });

  it('POST_UPDATED invalidates per-post key when postId present in payload', () => {
    const keys = adminKeys(WS_EVENTS.POST_UPDATED, { postId: 'post-7' });

    expect(keys).toContainEqual(queryKeys.admin.posts(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.post(WS_ID, 'post-7'));
    expect(keys).toContainEqual(queryKeys.admin.contentPipeline(WS_ID));
  });

  it('POST_UPDATED skips per-post key when postId is absent', () => {
    const keys = adminKeys(WS_EVENTS.POST_UPDATED, {});

    expect(keys).toContainEqual(queryKeys.admin.posts(WS_ID));
    const perPostKeys = keys.filter((key) => Array.isArray(key) && key[0] === 'admin-post' && key.length === 3);
    expect(perPostKeys).toHaveLength(0);
  });

  it('STRATEGY_UPDATED fans out to admin rank-tracking and client strategy/intelligence paths', () => {
    const keys = adminKeys(WS_EVENTS.STRATEGY_UPDATED);

    expect(keys).toContainEqual(queryKeys.admin.keywordStrategy(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.rankTrackingKeywords(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.strategy(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.strategyGuidance(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.pageKeywords(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.keywordFeedback(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('BRIEFING_PUBLISHED invalidates both admin drafts and client briefing', () => {
    const keys = adminKeys(WS_EVENTS.BRIEFING_PUBLISHED);

    expect(keys).toContainEqual(queryKeys.admin.briefingDrafts(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.briefing(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('SUGGESTED_BRIEF_UPDATED refreshes suggested briefs, content pipeline, and intelligence', () => {
    const keys = adminKeys(WS_EVENTS.SUGGESTED_BRIEF_UPDATED);

    expect(keys).toContainEqual(queryKeys.admin.aiSuggestedBriefs(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.contentPipeline(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.workspaceHome(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });

  it('COPY_SECTION_UPDATED refreshes copy review plus canonical content pipeline intelligence', () => {
    const keys = adminKeys(WS_EVENTS.COPY_SECTION_UPDATED);

    expect(keys).toContainEqual(queryKeys.admin.copySectionsAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.copyStatusAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.contentPipeline(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });

  it('COPY_BATCH_COMPLETE refreshes batch, copy sections, content pipeline, and intelligence', () => {
    const keys = adminKeys(WS_EVENTS.COPY_BATCH_COMPLETE);

    expect(keys).toContainEqual(queryKeys.admin.copyBatchAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.copySectionsAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.contentPipeline(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });

  it('RECOMMENDATIONS_UPDATED refreshes shared recommendations and operational intelligence', () => {
    const keys = adminKeys(WS_EVENTS.RECOMMENDATIONS_UPDATED);

    expect(keys).toContainEqual(queryKeys.shared.recommendations(WS_ID));
    expect(keys).toContainEqual(queryKeys.shared.pageEditStates(WS_ID, false));
    expect(keys).toContainEqual(queryKeys.shared.pageEditStates(WS_ID, true));
    expect(keys).toContainEqual(queryKeys.admin.workspaceHome(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('INTELLIGENCE_CACHE_UPDATED refreshes admin and client intelligence query roots', () => {
    const keys = adminKeys(WS_EVENTS.INTELLIGENCE_CACHE_UPDATED);

    expect(keys).toContainEqual(queryKeys.admin.intelligence(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
    expect(keys).toContainEqual(queryKeys.client.intelligence(WS_ID));
  });

  it('BRIEFING_GENERATED only invalidates admin drafts (not client briefing)', () => {
    const keys = adminKeys(WS_EVENTS.BRIEFING_GENERATED);

    expect(keys).toContainEqual(queryKeys.admin.briefingDrafts(WS_ID));
    expect(keys).not.toContainEqual(queryKeys.client.briefing(WS_ID));
  });

  it('DIAGNOSTIC_FAILED does not invalidate the insight feed (only diagnostics keys)', () => {
    const keys = adminKeys(WS_EVENTS.DIAGNOSTIC_FAILED);

    expect(keys).toContainEqual(queryKeys.admin.diagnostics(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.diagnosticForInsightAll(WS_ID));
    expect(keys).not.toContainEqual(queryKeys.admin.insightFeed(WS_ID));
  });

  it('LOCAL_SEO_UPDATED invalidates keywordStrategy and local SEO readers', () => {
    const keys = adminKeys(WS_EVENTS.LOCAL_SEO_UPDATED);

    expect(keys).toContainEqual(queryKeys.admin.keywordStrategy(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.localSeo(WS_ID));
    expect(keys).toContainEqual(queryKeys.admin.intelligenceAll(WS_ID));
  });
});
