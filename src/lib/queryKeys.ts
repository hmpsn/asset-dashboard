/**
 * Centralized React Query key factory.
 *
 * ALL query keys across the platform must be defined here.
 * Using factory functions (not literals) ensures:
 *  - Typo-free key references everywhere
 *  - Hierarchical keys enable prefix-based invalidation
 *  - Type safety via `as const` return types
 *
 * Hierarchy convention:
 *  admin-ga4  → ['admin-ga4', wsId, metric, days]       prefix ['admin-ga4', wsId] invalidates all
 *  admin-gsc  → ['admin-gsc', siteId, url, metric, days] prefix ['admin-gsc', siteId] invalidates all
 *  client-ga4 → ['client-ga4', wsId, metric, days, dr]  prefix ['client-ga4', wsId] invalidates all
 *  client-search → ['client-search', wsId, metric, days, dr] similarly
 */

import type { AnalyticsDateRange } from '../../shared/types/analytics-contract.js';

export type DateRange = AnalyticsDateRange;

const adminContentPerformanceKey = (wsId: string) => ['admin-content-performance', wsId] as const;

export const queryKeys = {
  // ── Admin ─────────────────────────────────────────────────────────
  admin: {
    // GA4 — hierarchical, prefix ['admin-ga4', wsId] invalidates all metrics
    ga4: (wsId: string, metric: string, days: number) =>
      ['admin-ga4', wsId, metric, days] as const,
    ga4All: (wsId: string) => ['admin-ga4', wsId] as const,

    // GSC (admin) — hierarchical, prefix ['admin-gsc', siteId] invalidates all metrics
    gsc: (siteId: string, url: string, metric: string, days: number) =>
      ['admin-gsc', siteId, url, metric, days] as const,
    gscAll: (siteId: string) => ['admin-gsc', siteId] as const,
    gscAny: () => ['admin-gsc'] as const,

    // Content
    briefs: (wsId: string) => ['admin-briefs', wsId] as const,
    brief: (wsId: string, briefId: string) => ['admin-brief', wsId, briefId] as const,
    briefsDetailAll: (wsId: string) => ['admin-brief', wsId] as const,
    briefingDrafts: (wsId: string) => ['admin-briefing-drafts', wsId] as const,
    briefingDraft: (wsId: string, draftId: string) => ['admin-briefing-draft', wsId, draftId] as const,
    requests: (wsId: string) => ['admin-requests', wsId] as const,
    approvals: (wsId: string) => ['admin-approvals', wsId] as const,
    clientActions: (wsId: string) => ['admin-client-actions', wsId] as const,
    workOrders: (wsId: string) => ['admin-work-orders', wsId] as const,
    workOrderComments: (wsId: string, orderId: string) => ['admin-work-order-comments', wsId, orderId] as const,
    workOrderCommentsAll: (wsId: string) => ['admin-work-order-comments', wsId] as const,
    // Unified admin "Client Deliverables" pane (PR-2b) — GET /api/deliverables/:workspaceId
    workspaceDeliverables: (wsId: string) => ['admin-workspace-deliverables', wsId] as const,
    posts: (wsId: string) => ['admin-posts', wsId] as const,
    post: (wsId: string, postId: string) => ['admin-post', wsId, postId] as const,
    postsDetailAll: (wsId: string) => ['admin-post', wsId] as const,
    postVersions: (wsId: string, postId: string) => ['admin-post-versions', wsId, postId] as const,
    briefTemplateCrossref: (wsId: string, normalizedKeyword: string) =>
      ['admin-brief-template-crossref', wsId, normalizedKeyword] as const,
    publishTarget: (wsId: string) => ['publish-target', wsId] as const,
    contentCalendar: (wsId: string) => ['content-calendar', wsId] as const,
    contentPipeline: (wsId: string) => ['content-pipeline', wsId] as const,
    contentPerformanceAll: adminContentPerformanceKey,
    contentPerformance: (wsId: string, days: number) =>
      [...adminContentPerformanceKey(wsId), 'read', days] as const,
    contentPerformanceTrend: (wsId: string, itemId: string) =>
      [...adminContentPerformanceKey(wsId), 'trend', itemId] as const,
    contentTemplates: (wsId: string) => ['content-templates', wsId] as const,
    contentMatrices: (wsId: string) => ['content-matrices', wsId] as const,
    contentMatrixGenerationAll: (wsId: string) => ['content-matrix-generation', wsId] as const,
    contentMatrixGeneration: (wsId: string, runId: string) =>
      ['content-matrix-generation', wsId, runId] as const,
    roi: (wsId: string) => ['admin-roi', wsId] as const,
    // The Issue (Client) P1a — admin conversion-tracking verification readout (pinned/typed/
    // forms-connected/last-lead). Invalidated by form capture + form-source config broadcasts.
    conversionTrackingStatus: (wsId: string) => ['admin-conversion-tracking-status', wsId] as const,
    // The Issue (Client) P1b — admin paginated named-leads readout (PII; requireWorkspaceAccess).
    formSubmissions: (wsId: string) => ['admin-form-submissions', wsId] as const,

    // SEO / Audit
    auditAll: () => ['admin-audit'] as const,
    auditLatest: (siteId: string, wsId?: string) =>
      wsId ? ['admin-audit', 'latest', siteId, wsId] as const : ['admin-audit', 'latest', siteId] as const,
    auditHistory: (siteId: string, wsId?: string) =>
      wsId ? ['admin-audit', 'history', siteId, wsId] as const : ['admin-audit', 'history', siteId] as const,
    auditTraffic: (siteId: string) => ['admin-audit-traffic', siteId] as const,
    auditTrafficAll: () => ['admin-audit-traffic'] as const,
    auditSuppressions: (wsId: string) => ['admin-audit-suppressions', wsId] as const,
    auditSchedule: (wsId: string) => ['admin-audit-schedule', wsId] as const,
    schemaPlan: (siteId: string, wsId?: string) =>
      wsId ? ['admin-schema-plan', siteId, wsId] as const : ['admin-schema-plan', siteId] as const,
    schemaSnapshot: (siteId: string, wsId?: string) =>
      wsId ? ['admin-schema-snapshot', siteId, wsId] as const : ['admin-schema-snapshot', siteId] as const,
    schemaValidations: (siteId: string, wsId?: string) =>
      wsId ? ['admin-schema-validations', siteId, wsId] as const : ['admin-schema-validations', siteId] as const,
    schemaGraphValidation: (siteId: string, wsId?: string) =>
      wsId ? ['admin-schema-graph-validation', siteId, wsId] as const : ['admin-schema-graph-validation', siteId] as const,
    schemaCmsFieldMappings: (siteId: string, wsId?: string) =>
      wsId ? ['admin-schema-cms-field-mappings', siteId, wsId] as const : ['admin-schema-cms-field-mappings', siteId] as const,
    llmsTxtFreshness: (wsId: string) => ['admin-llms-txt-freshness', wsId] as const,
    llmsTxtResult: (wsId: string) => ['admin-llms-txt-result', wsId] as const,
    webflowPages: (siteId: string, wsId?: string) =>
      wsId ? ['admin-webflow-pages', siteId, wsId] as const : ['admin-webflow-pages', siteId] as const,
    webflowAssets: (siteId: string, wsId?: string) =>
      wsId ? ['admin-webflow-assets', siteId, wsId] as const : ['admin-webflow-assets', siteId] as const,
    assetAudit: (siteId: string, wsId?: string) =>
      wsId ? ['admin-asset-audit', siteId, wsId] as const : ['admin-asset-audit', siteId] as const,
    seoEditor: (siteId: string, wsId?: string) =>
      wsId ? ['seo-editor', siteId, wsId] as const : ['seo-editor', siteId] as const,
    seoEditorAll: () => ['seo-editor'] as const,
    seoSuggestions: (wsId: string) => ['seo-suggestions', wsId] as const,
    rewritePages: (wsId: string) => ['admin-rewrite-pages', wsId] as const,
    keywordStrategy: (wsId: string) => ['keyword-strategy', wsId] as const,
    strategyDiff: (wsId: string) => ['admin-strategy-diff', wsId] as const,
    /** Strategy redesign P2 pre-commit (consumed in P3) — the managed keyword working set
     *  (strategy_keyword_set). Invalidated by the STRATEGY_KEYWORD_SET_UPDATED handler. */
    strategyKeywordSet: (wsId: string) => ['admin-strategy-keyword-set', wsId] as const,
    contentDecay: (wsId: string) => ['admin-content-decay', wsId] as const,
    backlinkProfile: (wsId: string) => ['admin-backlink-profile', wsId] as const,
    keywordFeedback: (wsId: string) => ['admin-keyword-feedback', wsId] as const,
    keywordCommandCenter: (wsId: string) => ['admin-keyword-command-center', wsId] as const,
    /** One-shot first-paint transport. Deliberately outside the canonical KCC prefix so
     * mutations and workspace events refresh summary/rows/detail without replaying it. */
    keywordCommandCenterInitial: (wsId: string, query: unknown) => ['admin-keyword-command-center-initial', wsId, query] as const,
    /** In-flight /initial hydration guard. It deliberately lives under the canonical
     * KCC prefix so any mutation/event invalidation marks the request stale without
     * causing the isolated one-shot transport itself to replay. */
    keywordCommandCenterInitialGuard: (wsId: string) => ['admin-keyword-command-center', wsId, 'initial-guard'] as const,
    keywordCommandCenterSummary: (wsId: string) => ['admin-keyword-command-center', wsId, 'summary'] as const,
    keywordCommandCenterRows: (wsId: string, query: unknown) => ['admin-keyword-command-center', wsId, 'rows', query] as const,
    keywordCommandCenterGrouped: (wsId: string, query: unknown) => ['admin-keyword-command-center', wsId, 'grouped', query] as const,
    keywordCommandCenterDetail: (wsId: string, keyword: string) => ['admin-keyword-command-center', wsId, 'detail', keyword] as const,
    localSeo: (wsId: string) => ['admin-local-seo', wsId] as const,
    localSeoVariant: (wsId: string, includeSnapshots: boolean) =>
      ['admin-local-seo', wsId, includeSnapshots ? 'with-snapshots' : 'summary'] as const,
    localSeoLocations: (wsId: string) => ['admin-local-seo-locations', wsId] as const,
    localGbpReviews: (wsId: string) => ['admin-local-gbp-reviews', wsId] as const,
    gbpConnection: () => ['admin-gbp-connection'] as const,
    gbpAccounts: () => ['admin-gbp-accounts'] as const,
    gbpLocations: () => ['admin-gbp-locations'] as const,
    gbpWorkspaceMappings: (wsId: string) => ['admin-gbp-workspace-mappings', wsId] as const,
    gbpAuthenticatedReviews: (wsId: string) => ['admin-gbp-authenticated-reviews', wsId] as const,
    gbpReviewResponses: (wsId: string) => ['admin-gbp-review-responses', wsId] as const,
    aiVisibility: (wsId: string) => ['admin-ai-visibility', wsId] as const,
    eeatAssets: (wsId: string) => ['admin-eeat-assets', wsId] as const,
    rankTrackingKeywords: (wsId: string) => ['admin-rank-tracking-keywords', wsId] as const,
    rankTrackingLatest: (wsId: string) => ['admin-rank-tracking-latest', wsId] as const,
    rankTrackingHistory: (wsId: string) => ['admin-rank-tracking-history', wsId] as const,
    rankTrackingHistoryQueries: (wsId: string, queries: string[]) =>
      ['admin-rank-tracking-history', wsId, 'queries', ...[...queries].sort()] as const,
    rankTrackingRowHistory: (wsId: string, queries: string[]) =>
      ['admin-rank-tracking-history', wsId, 'rows', ...[...queries].sort()] as const,
    internalLinksSnapshot: (siteId: string, wsId?: string) =>
      wsId ? ['admin-internal-links-snapshot', siteId, wsId] as const : ['admin-internal-links-snapshot', siteId] as const,
    anomalyAlerts: (wsId: string) => ['anomaly-alerts', wsId] as const,
    competitorIntel: (wsId: string, competitorKey: string) =>
      ['admin-competitive-intel', wsId, competitorKey] as const,
    competitorIntelAll: (wsId: string) => ['admin-competitive-intel', wsId] as const,
    analyticsAnnotations: (wsId: string) => ['analytics-annotations', wsId] as const,
    insightFeed: (wsId: string) => ['admin-insight-feed', wsId] as const,
    intelligenceSignals: (wsId: string) => ['admin-intelligence-signals', wsId] as const,
    aiSuggestedBriefs: (wsId: string) => ['admin-ai-suggested-briefs', wsId] as const,
    strategyPov: (wsId: string) => ['admin-strategy-pov', wsId] as const,
    autoSendPolicy: (wsId: string) => ['admin-auto-send-policy', wsId] as const,
    issueLenses: (wsId: string) => ['admin-issue-lenses', wsId] as const,
    competitorAlerts: (wsId: string) => ['admin-competitor-alerts', wsId] as const,
    operatorOverrides: (wsId: string) => ['admin-operator-overrides', wsId] as const,
    recommendations: (wsId: string) => ['admin-recommendations', wsId] as const,
    /** Strategy v3 — discussion thread for a workspace's recs (admin cockpit Discuss filter). */
    recDiscussion: (wsId: string) => ['admin-rec-discussion', wsId] as const,

    // Brand Engine — Brandscripts
    brandscripts: (wsId: string) => ['admin-brandscripts', wsId] as const,
    brandscriptTemplates: () => ['admin-brandscript-templates'] as const,

    // Brand Engine — Voice & Identity
    brandIntake: (wsId: string) => ['admin-brand-intake', wsId] as const,
    voiceProfile: (wsId: string) => ['admin-voice-profile', wsId] as const,
    voiceReadiness: (wsId: string) => ['admin-voice-readiness', wsId] as const,
    brandIdentity: (wsId: string) => ['admin-brand-identity', wsId] as const,
    brandGenerationAll: (wsId: string) => ['admin-brand-generation', wsId] as const,
    brandGeneration: (wsId: string, runId: string) =>
      ['admin-brand-generation', wsId, runId] as const,

    // Brand Engine — Discovery
    discoverySources: (wsId: string) => ['admin-discovery-sources', wsId] as const,
    discoveryExtractions: (wsId: string, sourceId: string) => ['admin-discovery-extractions', wsId, sourceId] as const,
    discoveryExtractionsAll: (wsId: string) => ['admin-discovery-extractions', wsId] as const,

    // Brand Engine — Page Strategy
    blueprints: (wsId: string) => ['admin-blueprints', wsId] as const,
    blueprintAll: (wsId: string) => ['admin-blueprint', wsId] as const,
    blueprint: (wsId: string, blueprintId: string) => ['admin-blueprint', wsId, blueprintId] as const,
    blueprintVersionsAll: (wsId: string) => ['admin-blueprint-versions', wsId] as const,
    blueprintVersions: (wsId: string, blueprintId: string) => ['admin-blueprint-versions', wsId, blueprintId] as const,

    // Copy Pipeline
    copySections: (wsId: string, entryId: string) => ['admin-copy-sections', wsId, entryId] as const,
    copySectionsAll: (wsId: string) => ['admin-copy-sections', wsId] as const,
    copyStatus: (wsId: string, entryId: string) => ['admin-copy-status', wsId, entryId] as const,
    copyStatusAll: (wsId: string) => ['admin-copy-status', wsId] as const,
    copyMetadata: (wsId: string, entryId: string) => ['admin-copy-metadata', wsId, entryId] as const,
    copyMetadataAll: (wsId: string) => ['admin-copy-metadata', wsId] as const,
    copyIntelligence: (wsId: string) => ['admin-copy-intelligence', wsId] as const,
    copyPromotable: (wsId: string) => ['admin-copy-promotable', wsId] as const,
    copyBatch: (wsId: string, batchId: string) => ['admin-copy-batch', wsId, batchId] as const,
    copyBatchAll: (wsId: string) => ['admin-copy-batch', wsId] as const,

    // Page join
    pageJoinPagesAll: () => ['admin-page-join-pages'] as const,
    pageJoinPages: (siteId: string, wsId?: string) =>
      wsId ? ['admin-page-join-pages', siteId, wsId] as const : ['admin-page-join-pages', siteId] as const,

    // Diagnostics
    diagnostics: (wsId: string) => ['admin-diagnostics', wsId] as const,
    diagnosticDetail: (wsId: string, reportId: string) => ['admin-diagnostics', wsId, reportId] as const,
    diagnosticForInsight: (wsId: string, insightId: string) => ['admin-diagnostic-for-insight', wsId, insightId] as const,
    diagnosticForInsightAll: (wsId: string) => ['admin-diagnostic-for-insight', wsId] as const,

    // CMS
    cmsEditorAll: () => ['cms-editor'] as const,
    cmsEditor: (siteId: string, wsId?: string) => ['cms-editor', siteId, wsId] as const,
    cmsCollections: (siteId: string, wsId?: string) =>
      wsId ? ['cms-collections', siteId, wsId] as const : ['cms-collections', siteId] as const,
    cmsImages: (siteId: string, wsId?: string) =>
      wsId ? ['admin-cms-images', siteId, wsId] as const : ['admin-cms-images', siteId] as const,

    // Workspace / global
    workspaces: () => ['admin-workspaces'] as const,
    workspaceDetail: (wsId: string) => ['admin-workspace-detail', wsId] as const,
    integrationHealth: (wsId: string) => ['admin-integration-health', wsId] as const,
    workspaceBadges: (wsId: string) => ['admin-workspace-badges', wsId] as const,
    workspaceHome: (wsId: string) => ['admin-workspace-home', wsId] as const,
    workspaceOverview: () => ['admin-workspace-overview'] as const,
    cockpitPortfolio: () => ['admin-cockpit-portfolio'] as const,
    presence: () => ['admin-presence'] as const,
    globalOpsGoogleStatus: () => ['admin-global-ops-google-status'] as const,
    globalOpsGscSites: () => ['admin-global-ops-gsc-sites'] as const,
    globalOpsStorage: () => ['admin-global-ops-storage'] as const,
    globalOpsStudioConfig: () => ['admin-global-ops-studio-config'] as const,
    health: () => ['admin-health'] as const,
    queue: () => ['admin-queue'] as const,
    outcomeActions: (wsId: string) => ['admin-outcome-actions', wsId] as const,
    outcomeActionsFiltered: (wsId: string, type?: string, score?: string) =>
      ['admin-outcome-actions', wsId, type ?? '', score ?? ''] as const,
    outcomeAction: (wsId: string, actionId: string) => ['admin-outcome-actions', wsId, actionId] as const,
    outcomeScorecard: (wsId: string) => ['admin-outcome-scorecard', wsId] as const,
    // R9 (B15): admin-only coverage funnel (tracked/measured/reconciled). Never consumed by a
    // client-facing hook.
    outcomeCoverage: (wsId: string) => ['admin-outcome-coverage', wsId] as const,
    outcomeTimeline: (wsId: string) => ['admin-outcome-timeline', wsId] as const,
    outcomeLearnings: (wsId: string) => ['admin-outcome-learnings', wsId] as const,
    outcomePlaybooks: (wsId: string) => ['admin-outcome-playbooks', wsId] as const,
    outcomeTopWins: (wsId: string) => ['admin-outcome-top-wins', wsId] as const,
    outcomeOverview: () => ['admin-outcome-overview'] as const,
    outcomePortfolioRollup: () => ['admin-outcome-portfolio-rollup'] as const,

    // Intelligence
    intelligence: (wsId: string, slices?: readonly string[], pagePath?: string, learningsDomain?: string) =>
      ['admin-intelligence', wsId, pagePath ?? '', learningsDomain ?? 'all', ...(slices ? [...slices].sort() : [])] as const,
    intelligenceAll: (wsId: string) => ['admin-intelligence', wsId] as const,
    clientSignals: (wsId: string) => ['admin-client-signals', wsId] as const,
    // OV (Opportunity Value) divergence shadow-log — admin-only diagnostic.
    // GET /api/ov-divergence/:workspaceId
    ovDivergence: (wsId: string) => ['admin-ov-divergence', wsId] as const,
    notifications: () => ['admin-notifications'] as const,
    featureFlags: () => ['admin-feature-flags'] as const,
    // Per-workspace MCP API keys (admin global management surface in Settings).
    mcpApiKeys: () => ['admin-mcp-api-keys'] as const,
    // Per-workspace feature-flag overrides (canary control). Prefix
    // ['admin-workspace-feature-flags', wsId] invalidates that workspace's flags.
    workspaceFeatureFlags: (wsId: string) => ['admin-workspace-feature-flags', wsId] as const,
    roadmap: () => ['admin-roadmap'] as const,
  },

  // ── Client ────────────────────────────────────────────────────────
  client: {
    // GA4 — hierarchical, prefix ['client-ga4', wsId] invalidates all metrics
    ga4: (wsId: string, metric: string, days: number, dr?: DateRange) =>
      ['client-ga4', wsId, metric, days, dr] as const,
    ga4All: (wsId: string) => ['client-ga4', wsId] as const,

    // GSC (client) — hierarchical, prefix ['client-search', wsId] invalidates all metrics
    gsc: (wsId: string, metric: string, days: number, dr?: DateRange) =>
      ['client-search', wsId, metric, days, dr] as const,
    gscAll: (wsId: string) => ['client-search', wsId] as const,

    // Data
    activity: (wsId: string) => ['client-activity', wsId] as const,
    /** Strategy v3 — the curated, clientStatus='sent' recs the client actually sees (spec §7.2).
     *  DISTINCT from shared.recommendations (the raw read) — its own key so the curated overview
     *  invalidates independently and the byte-identical shared key is never disturbed. */
    curatedRecommendations: (wsId: string) => ['client-curated-recommendations', wsId] as const,
    /**
     * R2-B agency "work feed" activity. DISTINCT from `activity` above: the work
     * feed query (`useClientActivityFeed`) fetches a different shape
     * (`ClientActivityEntry[]` via `fetchClientActivityFeed`) than `useClientActivity`
     * (`ActivityLogItem[]` via `/api/public/activity`). Sharing one key would cause
     * last-resolver-wins cache corruption when both hooks mount. Both keys are
     * invalidated together on ACTIVITY_NEW (see wsInvalidation.ts).
     */
    workFeedActivity: (wsId: string) => ['client-work-feed-activity', wsId] as const,
    rankHistory: (wsId: string) => ['client-rank-history', wsId] as const,
    // A4 (audit #15): 180-day rank series for client-requested keywords (Strategy tab trend card).
    requestedKeywordTrend: (wsId: string, keywords: string[]) =>
      ['client-requested-keyword-trend', wsId, ...keywords] as const,
    /** Workspace-prefix key for invalidating every requestedKeywordTrend variant. */
    requestedKeywordTrendAll: (wsId: string) => ['client-requested-keyword-trend', wsId] as const,
    latestRanks: (wsId: string) => ['client-latest-ranks', wsId] as const,
    annotations: (wsId: string) => ['client-annotations', wsId] as const,
    anomalies: (wsId: string) => ['client-anomalies', wsId] as const,
    approvals: (wsId: string) => ['client-approvals', wsId] as const,
    clientActions: (wsId: string) => ['client-actions', wsId] as const,
    workOrders: (wsId: string) => ['client-work-orders', wsId] as const,
    workOrderComments: (wsId: string, orderId: string) => ['client-work-order-comments', wsId, orderId] as const,
    workOrderCommentsAll: (wsId: string) => ['client-work-order-comments', wsId] as const,
    requests: (wsId: string) => ['client-requests', wsId] as const,
    contentRequests: (wsId: string) => ['client-content-requests', wsId] as const,
    // Unified client inbox (PR-2a) — GET /api/public/deliverables/:workspaceId
    unifiedInbox: (wsId: string) => ['client-unified-inbox', wsId] as const,
    brandSummary: (wsId: string) => ['client-brand-summary', wsId] as const,
    auditSummary: (wsId: string) => ['client-audit-summary', wsId] as const,
    auditDetail: (wsId: string) => ['client-audit-detail', wsId] as const,
    schemaPlan: (wsId: string) => ['client-schema-plan', wsId] as const,
    schemaSnapshot: (wsId: string) => ['client-schema-snapshot', wsId] as const,
    strategy: (wsId: string) => ['client-strategy', wsId] as const,
    strategyGuidance: (wsId: string) => ['client-strategy-guidance', wsId] as const,
    roi: (wsId: string) => ['client-roi', wsId] as const,
    // The Issue (Client) P1b — the client's OWN captured leads (authed client-portal read).
    myLeads: (wsId: string) => ['client-my-leads', wsId] as const,
    keywordFeedback: (wsId: string) => ['client-keyword-feedback', wsId] as const,
    pricing: (wsId: string) => ['client-pricing', wsId] as const,
    contentSubscription: (wsId: string) => ['client-content-subscription', wsId] as const,
    contentPlan: (wsId: string) => ['client-content-plan', wsId] as const,
    trackedKeywords: (wsId: string) => ['client-tracked-keywords', wsId] as const,
    pageKeywords: (wsId: string) => ['client-page-keywords', wsId] as const,
    insights: (wsId: string) => ['client-insights', wsId] as const,
    clientInsights: (wsId: string) => ['client-narrative-insights', wsId] as const,
    briefing: (wsId: string) => ['client-briefing', wsId] as const,
    competitorGaps: (wsId: string) => ['client-competitor-gaps', wsId] as const,
    monthlyDigest: (wsId: string) => ['client-monthly-digest', wsId] as const,
    chatUsage: (wsId: string) => ['client-chat-usage', wsId] as const,
    outcomeSummary: (wsId: string) => ['client-outcome-summary', wsId] as const,
    outcomeWins: (wsId: string) => ['client-outcome-wins', wsId] as const,
    intelligence: (wsId: string) => ['client-intelligence', wsId] as const,
    diagnostics: (wsId: string) => ['client-diagnostics', wsId] as const,

    // Client Copy Review
    copyEntries: (wsId: string) => ['client-copy-entries', wsId] as const,
    /**
     * Lightweight count-only query for the Copy Review tab visibility gate in
     * InboxTab. Distinct from `copyEntries` so the count hook's resilient
     * `getSafe` fallback does NOT dedupe with the full ClientCopyReview
     * query (which uses `get()` and must surface errors to its error UI).
     */
    copyEntriesCount: (wsId: string) => ['client-copy-entries-count', wsId] as const,
    copySections: (wsId: string, entryId: string) => ['client-copy-sections', wsId, entryId] as const,
    copySectionsAll: (wsId: string) => ['client-copy-sections', wsId] as const,
    postPreviewAll: (wsId: string) => ['client', 'post-preview', wsId] as const,
    postPreview: (wsId: string, postId: string | undefined) => ['client', 'post-preview', wsId, postId] as const,
    /** Active background jobs visible to this workspace's client portal. */
    jobs: (wsId: string) => ['client-jobs', wsId] as const,
    /**
     * Phase 2 (strategy-the-issue) — the evergreen curated recommendation feed the
     * client sees on TheIssueClientPage. Reads the public `?clientStatus=sent` projection.
     * Distinct from `shared.recommendations` (raw read) and `curatedRecommendations`
     * (admin-projection v1) so each surface invalidates independently.
     * Invalidated by the RECOMMENDATIONS_UPDATED + DELIVERABLE_SENT WS handlers.
     */
    theIssue: (wsId: string) => ['client-the-issue', wsId] as const,
    /**
     * Phase 2 (strategy-the-issue) — pre-aggregated client response summary for the
     * loop footer ("you've greenlit N moves · 1 in discussion"). Reads a client-safe
     * projection of rec responses from the public route.
     * Invalidated alongside `theIssue` on RECOMMENDATIONS_UPDATED.
     */
    recResponses: (wsId: string) => ['client-rec-responses', wsId] as const,
  },

  // ── Shared (used by both admin and client contexts) ────────────────
  shared: {
    auditSummary: (wsId: string) => ['audit-summary', wsId] as const,
    recommendations: (wsId: string) => ['recommendations', wsId] as const,
    pageEditStates: (wsId: string, isPublic: boolean) =>
      ['page-edit-states', wsId, isPublic ? 'public' : 'admin'] as const,
    features: () => ['features'] as const,
    featureFlags: () => ['feature-flags'] as const,
  },
} as const;
