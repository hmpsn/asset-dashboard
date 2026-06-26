import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import { LOCAL_SEO_POSTURE } from '../../../shared/types/local-seo.js';
import type { ConversionAttributionData } from '../../../shared/types/analytics.js';
import type { RecSourceCategory } from './rules.js';
import type { RecType, Recommendation, RecommendationSet } from '../../../shared/types/recommendations.ts';
import { getAuditTrafficForWorkspace } from '../../audit-traffic.js';
import { getInsights } from '../../analytics-insights-store.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { buildRecommendationGenerationContext } from '../../intelligence/generation-context-builders.js';
import { getDeclinedKeywords } from '../../keyword-feedback.js';
import { getLocalSeoPosture } from '../../local-seo.js';
import { createLogger } from '../../logger.js';
import { getEffortPriorDays } from '../../outcome-emv-calibration.js';
import { getOrCreateWorkspaceWeights } from '../../opportunity-weights.js';
import { listPageKeywords } from '../../page-keywords.js';
import { getLatestSnapshot } from '../../reports.js';
import type { AuditSnapshot } from '../../reports.js';
import { buildCtrCurve, type GscKeywordObservation } from '../../scoring/ctr-curve.js';
import { computeOvCalibration } from '../../scoring/ov-calibration.js';
import { computeTimingBoosts } from '../../scoring/opportunity-timing.js';
import { getConfiguredProvider } from '../../seo-data-provider.js';
import { workspaceProviderGeo } from '../../seo-target-geo.js';
import { resolveOvAuthorityStrength } from '../../workspace-authority.js';
import { getWorkspace } from '../../workspaces.js';
import type { Workspace } from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import { finalizeRecommendations } from './finalization.js';
import {
  appendAuditRecommendations,
  appendContentDecayRecommendations,
  appendCtrOpportunityRecommendations,
  appendDiagnosticRecommendations,
  appendFreshnessRecommendations,
  appendLocalVisibilityRecommendations,
  appendStrategyRecommendations,
} from './generation-producers.js';
import { recommendationOutcomeActionType } from './outcome-action-type.js';
import { getTrafficScore, toPageSlug } from './rules.js';
import { loadRecommendations, saveRecommendations } from './status-service.js';

const log = createLogger('recommendations');

/** Resolves a workspace's domain-authority bucket once per rec-generation cycle.
 *
 * Returns an 80/50/20 bucket based on the provider's organic-keyword count, or
 * `0` when the domain is unknown, the provider is unconfigured, the call
 * throws, or the provider returns no data. `0` signals "authority unknown" to
 * the KD classifier — callers fall back to the classification-free impact
 * score, not a zero multiplier.
 *
 * API-credit note: the underlying `provider.getDomainOverview` call is cached
 * at the provider layer (SQLite with TTL in the active SEO provider). First
 * call per domain per TTL window costs provider credits;
 * subsequent calls within the window cost 0. Isolating the call in this helper
 * means there is exactly one call site per rec-gen cycle, regardless of how
 * many individual recs consult `domainStrength`.
 */
async function resolveDomainStrength(ws: Workspace, workspaceId: string): Promise<number> {
  if (!ws.liveDomain) return 0;
  try {
    const provider = getConfiguredProvider(ws.seoDataProvider);
    if (!provider) return 0;
    const geo = workspaceProviderGeo(workspaceId);
    const overview = await provider.getDomainOverview(ws.liveDomain, workspaceId, undefined, geo.locationCode, geo.languageCode);
    if (!overview) return 0;
    if (overview.organicKeywords >= 1000) return 80;
    if (overview.organicKeywords >= 100)  return 50;
    return 20;
  } catch { // catch-ok: non-critical — failure degrades to "authority unknown" and the KD classifier treats 0 as unknown
    return 0;
  }
}

export async function generateRecommendations(workspaceId: string): Promise<RecommendationSet> {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error('Workspace not found');

  const now = new Date().toISOString();
  const recs: Recommendation[] = [];
  // Opportunity Value scoring is canonical. Local recommendation minting remains
  // posture-gated so non-local workspaces keep the existing non-local source set.
  const localPosture = getLocalSeoPosture(ws.id);
  const useLocalGenQual = localPosture === LOCAL_SEO_POSTURE.LOCAL || localPosture === LOCAL_SEO_POSTURE.HYBRID;
  const tier = ws.tier || 'free';
  const assignedTo: 'team' | 'client' = tier === 'premium' ? 'team' : 'client';

  // Track categories whose data fetch failed this run so the merge logic can
  // skip auto-resolving existing recs in those categories. Without this guard,
  // a transient provider/store failure would silently mark every rec in the
  // affected category as "completed" — the recurring "auto-resolved too
  // eagerly" reviewer flag. Adding a category here requires the corresponding
  // try/catch below to call `failedCategories.add(...)` on the catch path.
  const failedCategories = new Set<RecSourceCategory>();

  // ── Fetch data sources ──
  const audit: AuditSnapshot | null = ws.webflowSiteId ? getLatestSnapshot(ws.webflowSiteId) : null;
  const traffic = await getAuditTrafficForWorkspace(ws);
  const strategy = ws.keywordStrategy;
  const recommendationContext = await buildRecommendationGenerationContext(workspaceId, {
    // `clientSignals` carries the authority-resolved `effectiveBusinessPriorities`
    // (client store + admin store reconciled — see business-priorities-source.ts).
    // We consume it through the shared builder rather than a hand-rolled read so
    // intent stays sourced from the one blessed representation (CLAUDE.md
    // "AI/recommendation generation consumers must use shared intelligence context builders").
    // `contentPipeline` (D2, audit #11) carries `inFlightTargetKeywords` — the
    // comparison-keyed brief/post keywords used to suppress content-gap recs the
    // pipeline is already producing.
    slices: ['seoContext', 'clientSignals', 'learnings', 'contentPipeline'],
    verbosity: 'standard',
    tokenBudget: 800,
    enrichWithBacklinks: true,
  }).catch(err => {
    log.warn({ err, workspaceId }, 'Recommendation context unavailable — continuing without backlinks and business-priority tie-breakers');
    return null;
  });
  const backlinkProfile = recommendationContext?.intelligence.seoContext?.backlinkProfile;
  // Resolved business priorities (client-entered first, admin-set as supplement).
  // Used only as a within-tier ranking tiebreaker below — never to change tiers.
  const effectiveBusinessPriorities = recommendationContext?.intelligence.clientSignals?.effectiveBusinessPriorities ?? [];
  const outcomeLearnings = recommendationContext?.intelligence.learnings ?? null;
  // D2 (audit #11): keywords the content pipeline is already producing (briefs +
  // non-error posts), comparison-keyed at slice-assembly time. Suppression fails OPEN:
  // when the slice/context is unavailable this set is empty and gaps mint as before —
  // the safe direction (an extra rec, never a false resolution).
  const inFlightContentKeywords = new Set(
    recommendationContext?.intelligence.contentPipeline?.inFlightTargetKeywords ?? [],
  );

  // Fetch domain strength once per rec-gen cycle (cached at provider layer; see resolveDomainStrength).
  // It now feeds recommendation copy/context only (KD notes / authority framing), while
  // the canonical score itself comes solely from computeOpportunityValue().
  const domainStrength = await resolveDomainStrength(ws, workspaceId);

  // ── PR5 · Spine C — self-calibrating OV inputs (OV path ONLY, dark/shadow). ──
  // Resolved ONCE per rec-gen cycle and threaded into every computeOpportunityValue
  // call so the attached `opportunity` object uses better, self-correcting signals:
  //   • ovAuthority   — REAL referring-domains authority (not the organic-keyword proxy)
  //   • ovCalibration — per-workspace realized-$ multiplier (1.0 identity until enabled+outcomes)
  //   • ovWeights     — per-workspace calibrated display weights (platform defaults today)
  // None of these touch the legacy impactScore; they only improve the shadow OV value.
  const ovWeights = getOrCreateWorkspaceWeights(workspaceId);
  const ovCalibration = computeOvCalibration(workspaceId);
  // Reuse the backlinkProfile already resolved above via the cached/rate-limited
  // intelligence SEO-context path (enrichWithBacklinks) — no duplicate API call.
  const ovAuthority = resolveOvAuthorityStrength(workspaceId, backlinkProfile);

  // ── SEO Decision Engine P2 · effort priors ──
  // Replace the per-branch DEFAULT_EFFORT_DAYS guess with the workspace's MEASURED
  // median time-to-complete per action type (getEffortPriorDays), resolved ONCE per
  // cycle. Absent (no prior, or < MIN_EFFORT_SAMPLES) → null → the scorer falls back
  // to DEFAULT_EFFORT_DAYS[branch], byte-identical to today. Inert until outcomes accrue.
  const ovEffortPriors = getEffortPriorDays(workspaceId);
  const effortDaysFor = (type: RecType, source: string): number | null =>
    ovEffortPriors[recommendationOutcomeActionType(type, source)] ?? null;

  // ── PR7 · Spine B — decaying Timing boosts (OV path). ──
  // Resolved ONCE per rec-gen cycle: Map<pageSlug, decaying boost> aggregated from the
  // active opportunity-event ledger. When the ledger is empty this is an EMPTY map
  // → maxBoostForPages() is 0 → timingBoost 0 → timing multiplier 1.
  const nowDate = new Date(now);
  const timingBoosts = computeTimingBoosts(workspaceId, nowDate);

  // Build a per-workspace position→CTR curve once from the workspace's own GSC
  // observations (the `gscKeywords` persisted on page_keywords). Falls back to the
  // documented industry curve when there is too little signal. Best-effort: only
  // feeds the Opportunity Value scorer (shadow until the flag flips); a failure
  // degrades to the industry fallback and never blocks rec generation.
  let ovCtrCurve: Record<number, number> | null = null;
  try {
    const gscObservations: GscKeywordObservation[] = [];
    for (const pk of listPageKeywords(workspaceId)) {
      if (!pk.gscKeywords) continue;
      for (const g of pk.gscKeywords) gscObservations.push(g);
    }
    ovCtrCurve = buildCtrCurve(gscObservations).curve;
  } catch (err) {
    log.warn({ err, workspaceId }, 'CTR curve build failed for Opportunity Value — using industry fallback');
  }

  // Build conversion rate map: slug → conversionRate (%)
  // pageId for conversion_attribution insights is the landing page URL (e.g. "/plumbing")
  const conversionMap = new Map<string, number>();
  try {
    for (const insight of getInsights(workspaceId, 'conversion_attribution')) {
      const data = insight.data as ConversionAttributionData;
      if (data?.conversionRate != null && insight.pageId) {
        const slug = toPageSlug(insight.pageId);
        conversionMap.set(slug, data.conversionRate);
      }
    }
  } catch (err) {
    log.warn({ err }, 'Conversion attribution insights unavailable — skipping CVR boost');
  }

  // Compute max traffic score for normalization
  let maxTrafficScore = 1;
  if (audit) {
    for (const page of audit.audit.pages) {
      const ts = getTrafficScore(traffic, page.slug, conversionMap.get(page.slug));
      if (ts > maxTrafficScore) maxTrafficScore = ts;
    }
  }

  const producerContext = {
    workspaceId,
    now,
    assignedTo,
    effortDaysFor,
    authorityStrength: ovAuthority ?? null,
    timingBoosts,
    opportunityOptions: { calibration: ovCalibration, weights: ovWeights },
  };

  // ── 1. Audit-based recommendations ──
  if (audit) {
    appendAuditRecommendations(recs, {
      ...producerContext,
      audit,
      traffic,
      conversionMap,
    });
  }

  // ── 2. Strategy-based recommendations ──
  // Load declined keywords so we can skip suggestions the client has rejected (2C).
  // The set is also reused by the signal-fold tail below.
  const declinedKeywords = new Set(
    getDeclinedKeywords(workspaceId).map(k => keywordComparisonKey(k)).filter(Boolean)
  );

  if (strategy) {
    appendStrategyRecommendations(recs, {
      ...producerContext,
      failedCategories,
      traffic,
      declinedKeywords,
      inFlightContentKeywords,
      domainStrength,
      backlinkProfile,
      ctrCurve: ovCtrCurve,
    });
  }

  // ── 2c. First-class local-visibility recs (posture-gated). ──
  // The local stage owns provider/snapshot reads and its FM-2 failed-category guards;
  // this service keeps only the canonical local/non-local posture gate.
  if (useLocalGenQual) {
    appendLocalVisibilityRecommendations(recs, {
      ...producerContext,
      failedCategories,
      ctrCurve: ovCtrCurve,
      localGbpEnabled: isFeatureEnabled('local-gbp', ws.id),
    });
  }

  // ── 3. Content decay recommendations ──
  appendContentDecayRecommendations(recs, {
    ...producerContext,
    failedCategories,
  });

  // ── 4. CTR opportunity recommendations ──────────────────────────────────────
  appendCtrOpportunityRecommendations(recs, {
    ...producerContext,
    failedCategories,
    ctrCurve: ovCtrCurve,
  });

  // ── 5. Diagnostic remediation recommendations ───────────────────────────────
  appendDiagnosticRecommendations(recs, {
    ...producerContext,
    failedCategories,
  });

  // ── 6. Content freshness recommendations ────────────────────────────────────
  // Must run BEFORE the merge block so status carry-over, auto-resolution,
  // and deduplication apply equally to freshness recs.
  appendFreshnessRecommendations(recs, {
    ...producerContext,
    failedCategories,
  });

  // ── Build slug→pageId map from audit for resolving affectedPages ──
  const slugToPageId = new Map<string, string>();
  if (audit) {
    for (const page of audit.audit.pages) {
      const slug = page.slug.replace(/^\//, '');
      slugToPageId.set(slug, page.pageId);
      // Also store with leading slash for lookups
      slugToPageId.set(`/${slug}`, page.pageId); // page-slug-url-ok — legacy lookup key, not a new persisted path
    }
  }

  const { set, autoResolved, autoResolvedPageStateIds } = finalizeRecommendations(recs, {
    workspaceId,
    workspaceName: ws.name,
    workspaceBusinessContext: ws.keywordStrategy?.businessContext,
    now,
    assignedTo,
    existing: loadRecommendations(workspaceId),
    failedCategories,
    inFlightContentKeywords,
    slugToPageId,
    effectiveBusinessPriorities,
    outcomeLearnings,
    intelligence: recommendationContext?.intelligence ?? null,
    actionTypeForRecommendation: recommendationOutcomeActionType,
  });

  saveRecommendations(set);
  invalidateIntelligenceCache(workspaceId);
  const summary = set.summary;
  log.info(`Generated ${recs.length} recommendations for ${workspaceId}: ${summary.fixNow} fix-now, ${summary.fixSoon} fix-soon, ${summary.fixLater} fix-later, ${summary.ongoing} ongoing${autoResolved > 0 ? `, ${autoResolved} auto-resolved` : ''}`);

  if (autoResolvedPageStateIds.length > 0) {
    broadcastToWorkspace(workspaceId, WS_EVENTS.PAGE_STATE_UPDATED, {
      pageIds: autoResolvedPageStateIds,
      source: 'recommendation',
    });
  }
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { count: recs.length });

  return set;
}
