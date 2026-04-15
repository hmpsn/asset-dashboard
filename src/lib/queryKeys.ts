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

export type DateRange = { startDate: string; endDate: string };

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

    // Content
    briefs: (wsId: string) => ['admin-briefs', wsId] as const,
    requests: (wsId: string) => ['admin-requests', wsId] as const,
    posts: (wsId: string) => ['admin-posts', wsId] as const,
    post: (wsId: string, postId: string) => ['admin-post', wsId, postId] as const,
    postVersions: (wsId: string, postId: string) => ['admin-post-versions', wsId, postId] as const,
    publishTarget: (wsId: string) => ['publish-target', wsId] as const,
    contentCalendar: (wsId: string) => ['content-calendar', wsId] as const,
    contentPipeline: (wsId: string) => ['content-pipeline', wsId] as const,
    roi: (wsId: string) => ['admin-roi', wsId] as const,

    // SEO / Audit
    auditAll: () => ['admin-audit'] as const,
    auditTraffic: (siteId: string) => ['admin-audit-traffic', siteId] as const,
    auditSuppressions: (wsId: string) => ['admin-audit-suppressions', wsId] as const,
    auditSchedule: (wsId: string) => ['admin-audit-schedule', wsId] as const,
    schemaSnapshot: (siteId: string) => ['admin-schema-snapshot', siteId] as const,
    schemaValidations: (siteId: string) => ['admin-schema-validations', siteId] as const,
    llmsTxtFreshness: (wsId: string) => ['admin-llms-txt-freshness', wsId] as const,
    webflowPages: (siteId: string) => ['admin-webflow-pages', siteId] as const,
    webflowAssets: (siteId: string) => ['admin-webflow-assets', siteId] as const,
    assetAudit: (siteId: string) => ['admin-asset-audit', siteId] as const,
    seoEditor: (siteId: string) => ['seo-editor', siteId] as const,
    seoSuggestions: (wsId: string) => ['seo-suggestions', wsId] as const,
    keywordStrategy: (wsId: string) => ['keyword-strategy', wsId] as const,
    anomalyAlerts: (wsId: string) => ['anomaly-alerts', wsId] as const,
    analyticsAnnotations: (wsId: string) => ['analytics-annotations', wsId] as const,
    insightFeed: (wsId: string) => ['admin-insight-feed', wsId] as const,
    intelligenceSignals: (wsId: string) => ['admin-intelligence-signals', wsId] as const,
    aiSuggestedBriefs: (wsId: string) => ['admin-ai-suggested-briefs', wsId] as const,
    actionQueue: (wsId: string) => ['admin-action-queue', wsId] as const,
    meetingBrief: (wsId: string) => ['admin-meeting-brief', wsId] as const,

    // Brand Engine — Brandscripts
    brandscripts: (wsId: string) => ['admin-brandscripts', wsId] as const,
    brandscriptTemplates: () => ['admin-brandscript-templates'] as const,

    // Brand Engine — Page Strategy
    blueprints: (wsId: string) => ['admin-blueprints', wsId] as const,
    blueprint: (wsId: string, blueprintId: string) => ['admin-blueprint', wsId, blueprintId] as const,
    blueprintVersions: (wsId: string, blueprintId: string) => ['admin-blueprint-versions', wsId, blueprintId] as const,

    // CMS
    cmsEditor: (siteId: string, wsId?: string) => ['cms-editor', siteId, wsId] as const,
    cmsCollections: (siteId: string) => ['cms-collections', siteId] as const,
    cmsImages: (siteId: string) => ['admin-cms-images', siteId] as const,

    // Workspace / global
    workspaces: () => ['admin-workspaces'] as const,
    workspaceDetail: (wsId: string) => ['admin-workspace-detail', wsId] as const,
    workspaceHome: (wsId: string) => ['admin-workspace-home', wsId] as const,
    workspaceOverview: () => ['admin-workspace-overview'] as const,
    health: () => ['admin-health'] as const,
    queue: () => ['admin-queue'] as const,
    outcomeActions: (wsId: string) => ['admin-outcome-actions', wsId] as const,
    outcomeScorecard: (wsId: string) => ['admin-outcome-scorecard', wsId] as const,
    outcomeTimeline: (wsId: string) => ['admin-outcome-timeline', wsId] as const,
    outcomeLearnings: (wsId: string) => ['admin-outcome-learnings', wsId] as const,
    outcomePlaybooks: (wsId: string) => ['admin-outcome-playbooks', wsId] as const,
    outcomeTopWins: (wsId: string) => ['admin-outcome-top-wins', wsId] as const,
    outcomeOverview: () => ['admin-outcome-overview'] as const,

    // Intelligence
    intelligence: (wsId: string, slices?: readonly string[], pagePath?: string, learningsDomain?: string) =>
      ['admin-intelligence', wsId, pagePath ?? '', learningsDomain ?? 'all', ...(slices ? [...slices].sort() : [])] as const,
    intelligenceAll: (wsId: string) => ['admin-intelligence', wsId] as const,
    clientSignals: (wsId: string) => ['admin-client-signals', wsId] as const,
    notifications: () => ['admin-notifications'] as const,
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
    rankHistory: (wsId: string) => ['client-rank-history', wsId] as const,
    latestRanks: (wsId: string) => ['client-latest-ranks', wsId] as const,
    annotations: (wsId: string) => ['client-annotations', wsId] as const,
    anomalies: (wsId: string) => ['client-anomalies', wsId] as const,
    approvals: (wsId: string) => ['client-approvals', wsId] as const,
    requests: (wsId: string) => ['client-requests', wsId] as const,
    contentRequests: (wsId: string) => ['client-content-requests', wsId] as const,
    auditSummary: (wsId: string) => ['client-audit-summary', wsId] as const,
    auditDetail: (wsId: string) => ['client-audit-detail', wsId] as const,
    strategy: (wsId: string) => ['client-strategy', wsId] as const,
    pricing: (wsId: string) => ['client-pricing', wsId] as const,
    contentPlan: (wsId: string) => ['client-content-plan', wsId] as const,
    insights: (wsId: string) => ['client-insights', wsId] as const,
    clientInsights: (wsId: string) => ['client-narrative-insights', wsId] as const,
    monthlyDigest: (wsId: string) => ['client-monthly-digest', wsId] as const,
    outcomeSummary: (wsId: string) => ['client-outcome-summary', wsId] as const,
    outcomeWins: (wsId: string) => ['client-outcome-wins', wsId] as const,
    intelligence: (wsId: string) => ['client-intelligence', wsId] as const,
  },

  // ── Shared (used by both admin and client contexts) ────────────────
  shared: {
    auditSummary: (wsId: string) => ['audit-summary', wsId] as const,
    recommendations: (wsId: string) => ['recommendations', wsId] as const,
    pageEditStates: (wsId: string, isPublic: boolean) =>
      ['page-edit-states', wsId, isPublic ? 'public' : 'admin'] as const,
  },
} as const;
