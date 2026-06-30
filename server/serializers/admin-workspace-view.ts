import type { Workspace, AdminWorkspaceView } from '../../shared/types/workspace.js';
import { computeEffectiveTier, resolveSegmentProfile } from '../workspaces.js';
import { computeTrialState } from '../billing/trial-state.js';

const DENIED_KEYS: ReadonlySet<string> = new Set([
  'webflowToken',
  'clientPassword',
  'stripeCustomerId',
  'stripeSubscriptionId',
]);

export function toAdminWorkspaceView(ws: Workspace, nowMs = Date.now()): AdminWorkspaceView {
  const effectiveTier = computeEffectiveTier(ws, nowMs);
  const trialState = computeTrialState(ws, nowMs);

  return {
    id: ws.id,
    name: ws.name,
    webflowSiteId: ws.webflowSiteId,
    webflowSiteName: ws.webflowSiteName,
    gscPropertyUrl: ws.gscPropertyUrl,
    ga4PropertyId: ws.ga4PropertyId,
    clientEmail: ws.clientEmail,
    liveDomain: ws.liveDomain,
    eventConfig: ws.eventConfig,
    eventGroups: ws.eventGroups,
    keywordStrategy: ws.keywordStrategy,
    competitorDomains: ws.competitorDomains,
    competitorLastFetchedAt: ws.competitorLastFetchedAt,
    competitorDomainsAtLastFetch: ws.competitorDomainsAtLastFetch,
    personas: ws.personas,
    clientPortalEnabled: ws.clientPortalEnabled,
    seoClientView: ws.seoClientView,
    analyticsClientView: ws.analyticsClientView,
    siteIntelligenceClientView: ws.siteIntelligenceClientView,
    siteHasSearch: ws.siteHasSearch,
    autoReports: ws.autoReports,
    autoReportFrequency: ws.autoReportFrequency,
    brandVoice: ws.brandVoice,
    knowledgeBase: ws.knowledgeBase,
    rewritePlaybook: ws.rewritePlaybook,
    brandLogoUrl: ws.brandLogoUrl,
    brandAccentColor: ws.brandAccentColor,
    tier: ws.tier,
    trialEndsAt: ws.trialEndsAt,
    billingMode: ws.billingMode,
    onboardingEnabled: ws.onboardingEnabled,
    onboardingCompleted: ws.onboardingCompleted,
    portalContacts: ws.portalContacts,
    auditSuppressions: ws.auditSuppressions,
    pageEditStates: ws.pageEditStates,
    publishTarget: ws.publishTarget,
    contentPricing: ws.contentPricing,
    seoDataProvider: ws.seoDataProvider,
    businessProfile: ws.businessProfile,
    businessPriorities: ws.businessPriorities,
    customPromptNotes: ws.customPromptNotes,
    scoringConfig: ws.scoringConfig,
    intelligenceProfile: ws.intelligenceProfile,
    // The Issue (Client) P0 — admin-edited outcome value + segment override. Explicit-field-list
    // lockstep: the type carries these (AdminWorkspaceView) but the body must list them too, or the
    // admin Outcome Value / segment subsections silently never read back the persisted value.
    outcomeValue: ws.outcomeValue,
    segmentConfig: ws.segmentConfig,
    // SEO Decision Engine P4 — admin-set national/international SERP target geo. Same
    // explicit-field-list lockstep as outcomeValue above: the type carries it but the body
    // must list it too, or the BusinessFootprint geo editor silently never reads back the
    // persisted value.
    targetGeo: ws.targetGeo,
    // The Issue (Client) P1a — admin reads back the persisted Webflow form-source mapping +
    // setup-confirmation timestamp (same explicit-field-list lockstep as outcomeValue above). The
    // signing secret is denied (see DENIED_KEYS) and intentionally absent here.
    webflowFormSources: ws.webflowFormSources,
    conversionTrackingConfirmedAt: ws.conversionTrackingConfirmedAt,
    // Pre-resolved segment profile (authority-layered): the admin segment UI reads
    // segmentProfile.segment to seed the override + gate the local/multi read-only axis. Without
    // this the UI always falls through to the b2b_saas default and the local-axis guard never fires.
    segmentProfile: resolveSegmentProfile(ws),
    autoPublishBriefings: ws.autoPublishBriefings,
    autoPublishAfterHours: ws.autoPublishAfterHours,
    lastBriefingRunWeekOf: ws.lastBriefingRunWeekOf,
    folder: ws.folder,
    createdAt: ws.createdAt,
    hasPassword: !!ws.clientPassword,
    isTrial: trialState.isTrial,
    trialDaysRemaining: trialState.trialDaysRemaining,
    effectiveTier,
  };
}

export { DENIED_KEYS as ADMIN_VIEW_DENIED_KEYS };
