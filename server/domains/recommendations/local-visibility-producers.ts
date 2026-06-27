import crypto from 'crypto';

import { getLatestBusinessListings } from '../../business-listings-store.js';
import { deriveGbpCompletenessScore } from '../../listing-rating.js';
import {
  buildLocalSeoKeywordVisibilitySummaryByKey,
  getLocalSeoCompetitorBrands,
  getLocalSeoReadModel,
  getLocalSeoServiceGaps,
  listLocalSeoMarkets,
} from '../../local-seo.js';
import { createLogger } from '../../logger.js';
import { getTrackedKeywords } from '../../rank-tracking.js';
import { computeOpportunityValue } from '../../scoring/opportunity-value.js';
import { maxBoostForPages } from '../../scoring/opportunity-timing.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import type { Recommendation } from '../../../shared/types/recommendations.js';
import { LOCAL_SEO_VISIBILITY_POSTURE } from '../../../shared/types/local-seo.js';
import {
  RecSource,
  deriveCanonicalRecommendationFields,
} from './rules.js';
import type { CtrOpportunityProducerContext } from './producer-contexts.js';

const log = createLogger('recommendations');

export interface LocalVisibilityRecommendationProducerContext extends CtrOpportunityProducerContext {
  localGbpEnabled: boolean;
}

export function appendLocalVisibilityRecommendations(
  recs: Recommendation[],
  ctx: LocalVisibilityRecommendationProducerContext,
): void {
  const {
    assignedTo,
    authorityStrength,
    ctrCurve,
    failedCategories,
    now,
    opportunityOptions,
    timingBoosts,
    workspaceId,
  } = ctx;

  // Read the admin LocalSeoVisibilityPanel's read-model ONCE for dedupe-vs-panel. The panel
  // renders `competitorBrands` + `serviceGaps`; when it is actively surfacing an item to the
  // admin we cross-link rather than mint a duplicate client rec. A panel read failure degrades
  // to "no panel coverage" (mint recs) — the safe direction (a missed dedupe shows a linkable
  // duplicate; a false dedupe would hide a real opportunity).
  let panelServiceGapIds = new Set<string>();
  let panelCompetitorTitles = new Set<string>();
  let panelActive = false;
  try {
    const panel = getLocalSeoReadModel(workspaceId, true);
    // The panel renders competitor brands + service gaps only in an active-data report state
    // (has_data / ready_no_data) — matching LocalSeoVisibilityPanel's render predicate. When the
    // panel is dark (needs_market / non_local / feature_disabled) the local recs are the only
    // surface, so we do NOT dedupe.
    panelActive = panel?.report.setupState === 'has_data' || panel?.report.setupState === 'ready_no_data';
    if (panelActive && panel) {
      panelServiceGapIds = new Set(panel.serviceGaps.map(g => g.serviceId));
      panelCompetitorTitles = new Set(panel.competitorBrands.map(c => c.title.toLowerCase().trim()));
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'Local SEO panel read-model unavailable for dedupe — minting local recs without cross-link');
  }

  // Build a volume map from the tracked-keyword pool so B1 can synthesize OV from a service's
  // starterKeywords when one is already tracked with provider volume; else it falls back like
  // P5's topic_cluster (composite-only, no provider volume).
  const localVolumeByKeyword = new Map<string, number>();
  try {
    for (const k of getTrackedKeywords(workspaceId)) {
      if (typeof k.volume === 'number' && k.volume > 0) {
        localVolumeByKeyword.set(keywordComparisonKey(k.query), k.volume);
      }
    }
  } catch (err) {
    log.debug({ err, workspaceId }, 'Tracked keyword pool unavailable for local OV synthesis — using composite fallback');
  }

  // ── B1. Local service gap → local_service_gap rec. ──
  // A service in the workspace's industry taxonomy has no active tracking keyword. There is no
  // native volume, so we synthesize OV: look the starterKeywords up in the tracked pool for
  // real volume (content_gap-grade demand), else fall back to a grounded composite proxy like
  // topic_cluster (opportunityScore-only).
  try {
    const serviceGaps = getLocalSeoServiceGaps(workspaceId);
    const activeMarkets = listLocalSeoMarkets(workspaceId).filter(m => m.status === 'active');
    const primaryMarketLabel = (activeMarkets[0] ?? listLocalSeoMarkets(workspaceId)[0])?.label;
    const marketPhrase = primaryMarketLabel ? `in ${primaryMarketLabel}` : 'in your market';
    for (const gap of serviceGaps) {
      // Dedupe-vs-panel: the setup drawer already nudges this service gap to the admin.
      // Adding the whole category to failedCategories on a successful dedupe-skip intentionally
      // protects EVERY local_service_gap rec from auto-resolve this run (the FM-2 safe direction,
      // mirroring P5 cannibalization) — a genuinely-resolved sibling lingers at most one extra
      // cycle, which is safe; the alternative (false auto-resolve) is not.
      if (panelActive && panelServiceGapIds.has(gap.serviceId)) {
        failedCategories.add('local_service_gap');
        continue;
      }
      // This starterKeyword→tracked-pool volume lookup rarely yields a positive volume: gap
      // services by definition have no tracked queries, so their starterKeywords are almost
      // never already in the tracked pool. The `opportunityScore:60` composite fallback below
      // normally drives B1's OV — don't treat this volume branch as load-bearing.
      const pooledVolume = gap.starterKeywords
        .map(kw => localVolumeByKeyword.get(keywordComparisonKey(kw)) ?? 0)
        .reduce((max, v) => Math.max(max, v), 0);
      const opportunityScore = 60; // grounded composite proxy for an untargeted local service
      const source = RecSource.localServiceGap(gap.serviceId);
      const opportunity = computeOpportunityValue({
        branch: 'local',
        effortDays: ctx.effortDaysFor('local_service_gap', source),
        volume: pooledVolume > 0 ? pooledVolume : null,
        opportunityScore: pooledVolume > 0 ? null : opportunityScore,
        intent: 'commercial',
        authorityStrength: authorityStrength,
        ctrCurve: ctrCurve,
        timingBoost: maxBoostForPages(timingBoosts, []),
      }, opportunityOptions);
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      const starterPreview = gap.starterKeywords.slice(0, 3).join(', ');
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: 'local_service_gap',
        title: `You're not targeting ${gap.serviceLabel} ${marketPhrase}`,
        description: `You're not targeting ${gap.serviceLabel} locally yet — you have no tracking keywords for it. A focused page plus local-intent terms${starterPreview ? ` (e.g. ${starterPreview})` : ''} captures local demand you're currently missing.`,
        insight: `Local customers search by service and city. When you don't target a service you actually offer, competitors capture those local searches by default. Claiming ${gap.serviceLabel} ${marketPhrase} puts you in front of ready-to-buy local intent.`,
        impact: pooledVolume > 200 ? 'high' : 'medium',
        effort: 'medium',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [],
        trafficAtRisk: 0,
        impressionsAtRisk: 0,
        estimatedGain: `Targeting ${gap.serviceLabel} ${marketPhrase} opens up local searches you currently capture none of`,
        actionType: 'content_creation',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (err) {
    failedCategories.add('local_service_gap');
    log.warn({ err, workspaceId }, 'Local service gaps unavailable for recommendations');
  }

  // ── B2. Competitor brand → local_visibility rec. ──
  // A competitor repeatedly appears in the local pack for markets where the client is ABSENT
  // (winsAgainstClient = pack appeared, client not found — the ranking signal). Surface the
  // worst offender so the client knows who is eating their local share.
  try {
    const competitors = getLocalSeoCompetitorBrands(workspaceId);
    for (const comp of competitors) {
      if (comp.winsAgainstClient <= 0) continue; // only those that beat the client in the pack
      const marketKey = keywordComparisonKey(comp.title);
      // Dedupe-vs-panel: the RepeatCompetitorList already surfaces this brand to the admin.
      // Adding the whole category to failedCategories on a successful dedupe-skip intentionally
      // protects EVERY local_visibility rec from auto-resolve this run (the FM-2 safe direction,
      // mirroring P5 cannibalization) — a genuinely-resolved sibling lingers at most one extra
      // cycle, which is safe; the alternative (false auto-resolve) is not.
      if (panelActive && panelCompetitorTitles.has(comp.title.toLowerCase().trim())) {
        failedCategories.add('local_visibility');
        continue;
      }
      const marketList = comp.markets.slice(0, 3).join(', ');
      const source = RecSource.localVisibility(marketKey);
      const opportunity = computeOpportunityValue({
        branch: 'local',
        effortDays: ctx.effortDaysFor('local_visibility', source),
        intent: 'transactional',
        localVisibilitySignal: Math.min(1, comp.winsAgainstClient / 5),
        authorityStrength: authorityStrength,
        ctrCurve: ctrCurve,
        timingBoost: maxBoostForPages(timingBoosts, []),
      }, opportunityOptions);
      const scoring = deriveCanonicalRecommendationFields(source, opportunity);
      recs.push({
        id: `rec_${crypto.randomBytes(6).toString('hex')}`,
        workspaceId,
        priority: scoring.priority,
        type: 'local_visibility',
        title: `${comp.title} keeps winning the local pack you're absent from`,
        description: `${comp.title} appeared in the local pack ${comp.totalAppearances} time${comp.totalAppearances === 1 ? '' : 's'}${marketList ? ` across ${marketList}` : ''}, and in ${comp.winsAgainstClient} of those your business wasn't showing at all. Each time, that local customer saw them instead of you.`,
        insight: `When a competitor consistently shows in the local pack and you don't, you're invisible for exactly the searches that drive local calls and visits. Getting into the pack for these markets is the highest-leverage local move you can make.`,
        impact: comp.winsAgainstClient > 3 ? 'high' : 'medium',
        effort: 'high',
        impactScore: scoring.impactScore,
        opportunity,
        source,
        affectedPages: [],
        trafficAtRisk: 0,
        impressionsAtRisk: 0,
        estimatedGain: `Appearing in the local pack where ${comp.title} currently wins puts you in front of nearby ready-to-act customers`,
        actionType: 'manual',
        status: 'pending',
        assignedTo,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (err) {
    failedCategories.add('local_visibility');
    log.warn({ err, workspaceId }, 'Local competitor brands unavailable for recommendations');
  }

  // ── B3. Not-visible / local-pack-present / possible-match local pack → local_visibility rec. ──
  // For each checked local-intent keyword whose derived posture is not_visible, local_pack_present,
  // or possible_match in a market, the client isn't (confidently) in the pack. Mint one rec per
  // market+keyword. Keyed on the market id so status carries over and one market's fix doesn't
  // auto-resolve another.
  //
  // The three not-visible-class postures (see `postureFromSummaryRow` / `localSeoKeywordVisibilityFromSnapshot`):
  //   - NOT_VISIBLE        — no pack and no match (or a pack we couldn't confirm).
  //   - LOCAL_PACK_PRESENT — a pack DEFINITELY showed and the business was not even a possible match.
  //                          This is the STRONGEST "absent from a present pack" signal, so it takes
  //                          the strong/not-visible copy variant (possible=false), NOT the softer
  //                          possible-match one. The report's `notVisibleCount` and the admin panel's
  //                          "Not Found" StatCard already fold LOCAL_PACK_PRESENT into NOT_VISIBLE
  //                          (server/local-seo.ts:buildLocalSeoReportSummary) — including it here makes
  //                          the B3 rec count reconcile with that panel/report "not found" count.
  //   - POSSIBLE_MATCH     — a maybe-match showed; softer copy variant (possible=true).
  try {
    const summaries = buildLocalSeoKeywordVisibilitySummaryByKey(workspaceId);
    for (const summary of summaries.values()) {
      for (const entry of summary.markets) {
        if (
          entry.posture !== LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE
          && entry.posture !== LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT
          && entry.posture !== LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH
        ) continue;
        const marketKey = `${entry.marketId}:${entry.normalizedKeyword}`;
        // LOCAL_PACK_PRESENT is a not-visible-class signal → strong (possible=false) variant.
        const possible = entry.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH;
        const source = RecSource.localVisibility(marketKey);
        const opportunity = computeOpportunityValue({
          branch: 'local',
          effortDays: ctx.effortDaysFor('local_visibility', source),
          intent: 'transactional',
          // A not_visible posture is a present, high-intent local miss → max urgency; a
          // possible_match is partially covered → lower urgency.
          localVisibilitySignal: possible ? 0.4 : 1,
          authorityStrength: authorityStrength,
          ctrCurve: ctrCurve,
          timingBoost: maxBoostForPages(timingBoosts, []),
        }, opportunityOptions);
        const scoring = deriveCanonicalRecommendationFields(source, opportunity);
        recs.push({
          id: `rec_${crypto.randomBytes(6).toString('hex')}`,
          workspaceId,
          priority: scoring.priority,
          type: 'local_visibility',
          title: possible
            ? `You might be in the local pack for "${entry.keyword}" in ${entry.marketLabel} — but it's not confirmed`
            : `You're not showing in the local pack for "${entry.keyword}" in ${entry.marketLabel}`,
          description: possible
            ? `A local result that could be your business appeared for "${entry.keyword}" in ${entry.marketLabel}, but the match isn't verified. Confirming and strengthening your local presence here turns a maybe into a reliable local-pack spot.`
            : `When someone in ${entry.marketLabel} searches "${entry.keyword}", a local pack shows — but your business isn't in it. Those are nearby customers actively looking for what you offer, going to competitors instead.`,
          insight: possible
            ? `A "possible match" means the local signals aren't strong enough to be sure it's you. Tightening your local profile, citations, and on-page location signals for ${entry.marketLabel} makes your presence unambiguous.`
            : `The local pack is the top of local search results. Not appearing there for a relevant local term means missing the customers most likely to call or visit. This is a direct, addressable local-visibility gap.`,
          impact: possible ? 'medium' : 'high',
          effort: 'high',
          impactScore: scoring.impactScore,
          opportunity,
          source,
          affectedPages: [],
          trafficAtRisk: 0,
          impressionsAtRisk: 0,
          estimatedGain: possible
            ? `Confirming your local presence for "${entry.keyword}" in ${entry.marketLabel} locks in a local-pack spot`
            : `Getting into the local pack for "${entry.keyword}" in ${entry.marketLabel} reaches nearby customers ready to act`,
          actionType: 'manual',
          status: 'pending',
          assignedTo,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  } catch (err) {
    failedCategories.add('local_visibility');
    log.warn({ err, workspaceId }, 'Local keyword visibility unavailable for recommendations');
  }

  // ── B4. GBP + reviews → local_visibility rec (P7, behind the `local-gbp` flag). ──
  // From the `business_listing_snapshots` time series (the client's OWN listing(s) + local
  // competitors), surface two actionable gaps per owned location:
  //   • Review gap — the client trails the top-review competitor in the same market by enough
  //     review COUNT or star RATING that customers comparing the two pick the competitor.
  //   • GBP completeness — the client's Google Business Profile is unclaimed or thin (missing
  //     photos / attributes / category), so it underperforms in the local pack regardless of rank.
  // Both reuse the `local_visibility` RecType (NO new insight type / RecType). Keyed on the
  // owned listing's location/market/place id so status carries across runs and one location's
  // fix doesn't auto-resolve another's. Recompute completeness from the stored snapshot (the
  // derived score is not persisted).
  if (ctx.localGbpEnabled) {
    // Gap thresholds — a rec only fires when the gap is material enough to act on.
    const REVIEW_COUNT_GAP_MIN = 10; // trail the leader by ≥10 reviews
    const STAR_GAP_MIN = 0.3;        // OR trail by ≥0.3 stars
    const GBP_COMPLETENESS_MIN = 60; // a profile under 60/100 is materially incomplete
    try {
      const listings = getLatestBusinessListings(workspaceId);
      const ownedListings = listings.filter(l => l.isOwned === true);
      const competitors = listings.filter(l => l.isOwned !== true);
      for (const owned of ownedListings) {
        const key = owned.locationId ?? owned.marketId ?? owned.placeId;
        // Top competitor by review count within the SAME market (fall back to market-less if the
        // owned listing has no market id — still a same-workspace local competitor comparison).
        const sameMarketCompetitors = owned.marketId
          ? competitors.filter(c => c.marketId === owned.marketId)
          : competitors;
        // Only competitors with a REAL review count anchor a review gap — a competitor with no
        // review data isn't evidence the client is behind (review #3 from the P7 scaled review).
        const topCompetitor = sameMarketCompetitors
          .filter(c => c.reviewCount != null)
          .reduce<typeof sameMarketCompetitors[number] | undefined>(
            (best, c) => ((c.reviewCount ?? 0) > (best?.reviewCount ?? -1) ? c : best),
            undefined,
          );

        // ── Review-gap rec ──
        if (topCompetitor) {
          const reviewCountGap = (topCompetitor.reviewCount ?? 0) - (owned.reviewCount ?? 0);
          const ratingGap = (topCompetitor.rating ?? 0) - (owned.rating ?? 0);
          if (reviewCountGap >= REVIEW_COUNT_GAP_MIN || ratingGap >= STAR_GAP_MIN) {
            const source = RecSource.localVisibility(`review_gap:${key}`);
            const opportunity = computeOpportunityValue({
              branch: 'local',
              effortDays: ctx.effortDaysFor('local_visibility', source),
              intent: 'commercial',
              localVisibilitySignal: Math.min(1, reviewCountGap / 50),
              authorityStrength: authorityStrength,
              ctrCurve: ctrCurve,
              timingBoost: maxBoostForPages(timingBoosts, []),
            }, opportunityOptions);
            const scoring = deriveCanonicalRecommendationFields(source, opportunity);
            recs.push({
              id: `rec_${crypto.randomBytes(6).toString('hex')}`,
              workspaceId,
              priority: scoring.priority,
              type: 'local_visibility',
              title: `Close the review gap: ${owned.reviewCount ?? 0} reviews / ${owned.rating ?? 0}★ vs ${topCompetitor.title ?? 'a competitor'} ${topCompetitor.reviewCount ?? 0} / ${topCompetitor.rating ?? 0}★`,
              description: `${topCompetitor.title ?? 'A local competitor'} has ${topCompetitor.reviewCount ?? 0} reviews at ${topCompetitor.rating ?? 0}★ while you have ${owned.reviewCount ?? 0} at ${owned.rating ?? 0}★. When nearby customers compare you side by side in the local pack, the higher review count and rating wins the click and the call.`,
              insight: `Review count and star rating are among the strongest local-pack ranking and conversion signals. A consistent gap means you lose ready-to-act local customers at the comparison step even when you rank. Closing it with a steady review-generation cadence is direct, compounding local leverage.`,
              impact: reviewCountGap >= REVIEW_COUNT_GAP_MIN * 2 ? 'high' : 'medium',
              effort: 'medium',
              impactScore: scoring.impactScore,
              opportunity,
              source,
              affectedPages: [],
              trafficAtRisk: 0,
              impressionsAtRisk: 0,
              estimatedGain: `Closing the review gap with ${topCompetitor.title ?? 'the local leader'} makes you the obvious choice for nearby customers comparing options`,
              actionType: 'manual',
              status: 'pending',
              assignedTo,
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        // ── GBP-completeness rec ──
        const completeness = deriveGbpCompletenessScore({
          claimed: owned.claimed,
          totalPhotos: owned.totalPhotos,
          attributeCount: owned.attributes.length,
          category: owned.category,
        });
        // Profile RICHNESS gap (photos / attributes / category / website). NOTE: claim status is
        // intentionally NOT a trigger — business_listings_search defaults to is_claimed=true, so
        // unclaimed owners aren't even returned and `claimed` is never reliably false (P7 scaled
        // review). The rec frames profile completeness, not claim status.
        if (completeness < GBP_COMPLETENESS_MIN) {
          const source = RecSource.localVisibility(`gbp_completeness:${key}`);
          const opportunity = computeOpportunityValue({
            branch: 'local',
            effortDays: ctx.effortDaysFor('local_visibility', source),
            intent: 'transactional',
            localVisibilitySignal: (100 - completeness) / 100,
            authorityStrength: authorityStrength,
            ctrCurve: ctrCurve,
            timingBoost: maxBoostForPages(timingBoosts, []),
          }, opportunityOptions);
          const scoring = deriveCanonicalRecommendationFields(source, opportunity);
          recs.push({
            id: `rec_${crypto.randomBytes(6).toString('hex')}`,
            workspaceId,
            priority: scoring.priority,
            type: 'local_visibility',
            title: `Complete your Google Business Profile (completeness ${completeness}/100)`,
            description: `Your Google Business Profile scores ${completeness}/100 on completeness — it's missing signals like photos, attributes, or a category that Google uses to rank and display you in the local pack. Filling these in lifts both your ranking and how compelling your listing looks.`,
            insight: `A complete Google Business Profile is the foundation of local-pack visibility. Profiles with photos, accurate categories, and filled-in attributes rank higher and convert better than thin ones — this is addressable groundwork that compounds with every other local effort.`,
            impact: 'medium',
            effort: 'low',
            impactScore: scoring.impactScore,
            opportunity,
            source,
            affectedPages: [],
            trafficAtRisk: 0,
            impressionsAtRisk: 0,
            estimatedGain: `Completing your Google Business Profile lifts your local-pack ranking and makes your listing more compelling to nearby searchers`,
            actionType: 'manual',
            status: 'pending',
            assignedTo,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    } catch (err) {
      failedCategories.add('local_visibility');
      log.warn({ err, workspaceId }, 'GBP + reviews listings unavailable for recommendations');
    }
  }
}
