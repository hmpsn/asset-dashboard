import { normalizePageUrl } from '../../helpers.js';
import { toPageSlug as toPageSlugShared, cannibalizationUrlSetKey as cannibalizationUrlSetKeyShared } from '../../../shared/page-address-utils.js';
import { isActiveRec, isCuratedForClient } from '../../../shared/recommendation-predicates.js';
import type { ContentGap, QuickWin } from '../../workspaces.js';
import type { OpportunityScore, Recommendation, RecommendationSet, RecPriority, RecType } from '../../../shared/types/recommendations.js';

export interface TrafficMap {
  [path: string]: { clicks: number; impressions: number; sessions: number; pageviews: number };
}

/** Issue-type-specific recovery rates for traffic estimation.
 * `perRec` is a user-facing percent range shown in estimatedGain text.
 * `summary` is the decimal multiplier applied to trafficAtRisk for the aggregate summary.
 * @internal exported for unit testing
 */
export interface RecoveryRate { perRec: string; summary: number }

const DEFAULT_RECOVERY: RecoveryRate = { perRec: '5-15%', summary: 0.12 };

const RECOVERY_RATES: Record<string, RecoveryRate> = {
  // High-impact content issues
  'title':                { perRec: '10-25%', summary: 0.18 },
  'meta-description':     { perRec: '5-15%',  summary: 0.10 },
  'h1':                   { perRec: '8-20%',  summary: 0.14 },
  'content-length':       { perRec: '10-30%', summary: 0.20 },
  'duplicate-title':      { perRec: '10-20%', summary: 0.15 },
  'duplicate-description':{ perRec: '5-10%',  summary: 0.08 },
  // Technical issues
  'canonical':            { perRec: '15-30%', summary: 0.22 },
  'indexability':         { perRec: '20-50%', summary: 0.35 },
  'robots':               { perRec: '15-40%', summary: 0.28 },
  'redirect-chains':      { perRec: '5-15%',  summary: 0.10 },
  'redirects':            { perRec: '10-25%', summary: 0.18 },
  'sitemap':              { perRec: '5-10%',  summary: 0.08 },
  'robots-txt':           { perRec: '5-15%',  summary: 0.10 },
  'response-time':        { perRec: '5-15%',  summary: 0.10 },
  'ssl':                  { perRec: '10-20%', summary: 0.15 },
  // Performance issues
  'cwv':                  { perRec: '5-15%',  summary: 0.10 },
  'cwv-lcp':              { perRec: '5-15%',  summary: 0.10 },
  'cwv-cls':              { perRec: '3-10%',  summary: 0.07 },
  'cwv-tbt':              { perRec: '3-10%',  summary: 0.07 },
  'render-blocking':      { perRec: '3-8%',   summary: 0.05 },
  // Low-impact issues
  'og-tags':              { perRec: '1-3%',   summary: 0.02 },
  'og-image':             { perRec: '1-3%',   summary: 0.02 },
  'img-alt':              { perRec: '2-5%',   summary: 0.03 },
  'structured-data':      { perRec: '5-15%',  summary: 0.10 },
  // Internal linking
  'internal-links':       { perRec: '5-15%',  summary: 0.10 },
  'link-text':            { perRec: '3-8%',   summary: 0.05 },
  'orphan-pages':         { perRec: '10-25%', summary: 0.18 },
};

export function getRecoveryRate(checkName: string): RecoveryRate {
  return RECOVERY_RATES[checkName] || DEFAULT_RECOVERY;
}

// ─── SEO Gen-Quality P4 · one gain basis (Contract 3) ───────────────────────
//
// The legacy `estimatedGain` strings are static per-check constants (getRecoveryRate),
// identical for every workspace/page, while ranking reads the OV value — a live
// client-facing incoherence. The canonical gain string is derived from the SAME OV figure
// (predictedEmv, the horizon-projected EMV that also feeds the served tier and
// content_gaps.opportunity_score), so the client's stated gain, the queue order, and the
// upsell badge all share ONE basis.
//
// CLIENT-SAFE FORM = NON-DOLLARIZED (owner constraint: clients never see a raw $/wk). We
// render an outcome-oriented RELATIVE-MAGNITUDE phrase, NOT a dollar figure. The public
// route additionally sanitizes any dollar exposure (stripEmvFromPublicRecs) as defense-
// in-depth, and the public-read test asserts no dollarized estimatedGain ever leaks.
//
// Bands map the horizon EMV proxy to a magnitude word. Owner-tunable (documented in the
// guardrail doc + PR); deliberately coarse so the proxy's imprecision is never overstated.
const OV_GAIN_BANDS = { high: 600, medium: 150, low: 1 } as const;

/** Non-dollarized, client-safe gain string derived from the OV horizon EMV proxy.
 *  Same basis as the served tier + content_gaps.opportunity_score (Contract 3). Returns
 *  null when no OV is attached (caller keeps the legacy string). @internal exported for testing */
export function buildOvGainString(opportunity: OpportunityScore | undefined): string | null {
  if (!opportunity) return null;
  const emv = opportunity.predictedEmv;
  if (!Number.isFinite(emv) || emv <= 0) {
    return 'Modest but real opportunity to recover organic visibility';
  }
  if (emv >= OV_GAIN_BANDS.high) {
    return 'High-value opportunity — among the strongest expected organic gains on the site right now';
  }
  if (emv >= OV_GAIN_BANDS.medium) {
    return 'Solid opportunity — meaningful expected organic gain relative to your other actions';
  }
  return 'Worthwhile opportunity — a steady expected organic gain once addressed';
}

/** Resolve the gain string for a rec. Canonical callers pass `true`; tests still exercise
 *  the historical fallback contract by passing `false`. @internal exported for testing */
export function resolveEstimatedGain(
  legacyGain: string,
  opportunity: OpportunityScore | undefined,
  useGenQual: boolean,
): string {
  if (!useGenQual) return legacyGain;
  return buildOvGainString(opportunity) ?? legacyGain;
}

// ─── Recommendation source keys ────────────────────────────────────
// Every rec carries a `source` string that uniquely identifies the
// underlying signal. The merge logic relies on these strings being:
//   (a) stable across runs for the same logical issue, so status carries
//       over, and
//   (b) distinct per-page for per-page categories, so fixing one page
//       doesn't auto-resolve another.
// Centralizing construction here prevents future code from accidentally
// sharing a source key across unrelated issues (the #1 cause of the
// "auto-resolved too eagerly" reviewer flag).

/** Top-level category of a recommendation source. The category prefix
 * determines how the merge logic matches the rec against its previous run.
 * Keep this union in lockstep with `REC_SOURCE_CATEGORIES` below.
 */
export type RecSourceCategory =
  | 'audit'
  | 'strategy'
  | 'decay'
  | 'insight:ctr_opportunity'
  | 'insight:freshness_alert'
  | 'diagnostic'
  | 'keyword_gap'
  | 'topic_cluster'
  | 'cannibalization'
  | 'local_visibility'
  | 'local_service_gap'
  // Strategy redesign P4 (signal-fold): IntelligenceSignals folded into the cockpit as
  // real recs minted at generation time. The source category is keyed off the originating
  // insightId (signal:<insightId>) so a signal already minted as a rec carries over
  // status/lifecycle across regen and resolving one signal never auto-resolves another.
  | 'signal';

const REC_SOURCE_CATEGORIES: RecSourceCategory[] = [
  'audit',
  'strategy',
  'decay',
  'insight:ctr_opportunity',
  'insight:freshness_alert',
  'diagnostic',
  'keyword_gap',
  'topic_cluster',
  'cannibalization',
  'local_visibility',
  'local_service_gap',
  'signal',
];

/** Returns the category prefix for a given source string, or `null` when
 * the source doesn't match a known category (defensive — should never
 * happen in practice but prevents a rogue source string from bypassing
 * the auto-resolve safety check).
 */
export function getRecSourceCategory(source: string): RecSourceCategory | null {
  for (const category of REC_SOURCE_CATEGORIES) {
    if (source === category || source.startsWith(`${category}:`)) return category;
  }
  return null;
}

/** Typed builders for rec source strings. Every source in `generateRecommendations`
 * MUST flow through one of these so the category prefix and scoping are
 * impossible to get wrong. Adding a new category is a deliberate, four-line
 * change: add to the union, the array, the builder, and the caller.
 */
export const RecSource = {
  audit:                  (check: string): string => `audit:${check}`,
  auditSiteWide:          (check: string): string => `audit:site-wide:${check}`,
  strategyContentGap:     (): string => 'strategy:content-gap',
  strategyQuickWin:       (): string => 'strategy:quick-win',
  strategyRankingOpp:     (): string => 'strategy:ranking-opportunity',
  strategyIntentMismatch: (pageSlug: string): string => `strategy:intent-mismatch:${pageSlug}`,
  decay:                  (pageSlug: string): string => `decay:${pageSlug}`,
  ctrOpportunity:         (pageSlug: string): string => `insight:ctr_opportunity:${pageSlug}`,
  freshnessAlert:         (pageSlug: string): string => `insight:freshness_alert:${pageSlug}`,
  diagnostic:             (reportId: string, actionIdx: number, actionTitle: string): string =>
    `diagnostic:${reportId}:${actionIdx}:${actionTitle.slice(0, 20)}`,
  // ── SEO Gen-Quality P5 · first-class orphan-subsystem recs ──
  // Each key is stable per logical issue (keyword / cluster topic / cannibalization URL-set)
  // so status carries over between runs and one fix doesn't auto-resolve another. These
  // categories are NOT `strategy:`-prefixed, so buildMergeKey keys on the source alone.
  keywordGap:             (keyword: string): string => `keyword_gap:${keyword}`,
  topicCluster:           (topic: string): string => `topic_cluster:${topic}`,
  cannibalization:        (urlSetKey: string): string => `cannibalization:${urlSetKey}`,
  // ── SEO Gen-Quality P7.1 · first-class local-visibility recs ──
  // localVisibility keys on a market+keyword (not-visible) or market identity (competitor
  // brand); localServiceGap keys on the taxonomy serviceId. Stable per logical issue so
  // status carries over and one fix doesn't auto-resolve another. Not `strategy:`-prefixed,
  // so buildMergeKey keys on the source alone.
  localVisibility:        (marketKey: string): string => `local_visibility:${marketKey}`,
  localServiceGap:        (serviceId: string): string => `local_service_gap:${serviceId}`,
  // ── Strategy redesign P4 · signal-fold ──
  // Keyed off the originating insightId so the minted rec dedups against itself across
  // regen (buildMergeKey returns this source unchanged — it is not `strategy:`-prefixed).
  signal:                 (insightId: string): string => `signal:${insightId}`,
};

/** Infer page type from slug path.
 * @internal exported for unit testing
 */
export function inferPageType(slug: string): 'blog' | 'service' | 'landing' | 'product' | 'other' {
  const s = slug.toLowerCase();
  if (/(?:^|\/)(?:blog|articles?|news|posts?|guides?)/.test(s)) return 'blog';
  if (/(?:^|\/)(?:services?|solutions?|offerings?)/.test(s)) return 'service';
  if (/(?:^|\/)(?:products?|shop|store)/.test(s)) return 'product';
  if (/(?:^|\/)(?:landing|lp[-_])/.test(s)) return 'landing';
  return 'other';
}

/** Detect search intent mismatch between page type and targeted keyword intent.
 * @internal exported for unit testing
 */
export function isIntentMismatch(pageType: string, searchIntent: string): { mismatch: boolean; reason: string } {
  if ((pageType === 'service' || pageType === 'product') && searchIntent === 'informational') {
    return { mismatch: true, reason: `This ${pageType} page targets an informational keyword — consider creating a blog post for the informational query and retargeting this page to a commercial/transactional keyword.` };
  }
  if (pageType === 'blog' && searchIntent === 'transactional') {
    return { mismatch: true, reason: `This blog post targets a transactional keyword — consider creating a dedicated service/product page for this keyword instead.` };
  }
  return { mismatch: false, reason: '' };
}

/** Strategy v3 (spec §6.3) — copy the client-facing lifecycle axis from each matched
 *  old rec onto its freshly-minted counterpart during regen. Keyed by buildMergeKey so a
 *  re-detected issue keeps its sent/throttled/struck state (the trust-critical carry-over —
 *  a sent rec must NOT reset to 'system' on the next regen). Copies for EVERY matched oldRec
 *  regardless of RecStatus (the pre-v3 merge only ran on in_progress/completed/dismissed). */
export function applyLifecycleCarryOver(newRecs: Recommendation[], oldRecs: Recommendation[]): void {
  const oldByKey = new Map<string, Recommendation>();
  for (const oldRec of oldRecs) oldByKey.set(buildMergeKey(oldRec), oldRec);
  for (const newRec of newRecs) {
    const oldRec = oldByKey.get(buildMergeKey(newRec));
    if (!oldRec) continue;
    // Continuity: keep the old id + createdAt so the frontend + sentAt lineage stay stable.
    newRec.id = oldRec.id;
    newRec.createdAt = oldRec.createdAt;
    // Copy the full client-facing lifecycle axis (only when present — absent stays absent so
    // a never-curated rec is byte-identical).
    if (oldRec.clientStatus !== undefined) newRec.clientStatus = oldRec.clientStatus;
    if (oldRec.lifecycle !== undefined) newRec.lifecycle = oldRec.lifecycle;
    if (oldRec.throttledUntil !== undefined) newRec.throttledUntil = oldRec.throttledUntil;
    if (oldRec.sentAt !== undefined) newRec.sentAt = oldRec.sentAt;
    if (oldRec.autoSent !== undefined) newRec.autoSent = oldRec.autoSent;
    if (oldRec.struckAt !== undefined) newRec.struckAt = oldRec.struckAt;
    if (oldRec.cascade !== undefined) newRec.cascade = oldRec.cascade;
    if (oldRec.sendChannel !== undefined) newRec.sendChannel = oldRec.sendChannel;
  }
}

/** Strategy v3 (spec §6.5) — recs the client has SEEN (clientStatus sent/discussing/approved) OR that
 *  the operator has explicitly parked (lifecycle struck/throttled) must be exempt from the destructive
 *  auto-resolve → 'completed' sweep. A sent rec swept to completed would read to the client as "✓ done";
 *  a struck/throttled rec swept to completed breaks strike/throttle reversibility (unstrike restores
 *  lifecycle but NOT status → a permanently-dead, "done"-reading rec). When such a rec's condition is
 *  genuinely fixed, a SEPARATE positive-terminal transition handles it (P2/P3); the sweep just skips it
 *  here, and the regen loop RETAINS it as-is when its source vanishes. declined is NOT exempt — the
 *  client said no, so it can resolve normally. */
export function isExemptFromAutoResolve(rec: Recommendation): boolean {
  return rec.clientStatus === 'sent' || rec.clientStatus === 'discussing' || rec.clientStatus === 'approved'
    || rec.lifecycle === 'struck' || rec.lifecycle === 'throttled';
}

// isActiveRec + isCuratedForClient moved to shared/recommendation-predicates.ts (the SINGLE source,
// shared with the client so the admin send counter and the projection key off ONE implementation).
// Imported at the top of this file (local binding for internal callers) and re-exported here so every
// existing server importer is unchanged. The `discussing`-overlap red-line lives with the impl there.
export { isActiveRec, isCuratedForClient };

/**
 * Compute the RecommendationSet summary from a rec list. Shared by the full
 * regen (generateRecommendations) and the in-place resolver
 * (resolveRecommendationsForChange) so client-facing headline numbers never
 * drift from the rendered active list.
 */
export function computeRecommendationSummary(recs: Recommendation[]): RecommendationSet['summary'] {
  const activeRecs = recs.filter(r => isActiveRec(r));
  const actionableRecs = activeRecs.filter(r => r.priority === 'fix_now' || r.priority === 'fix_soon');
  const opportunityValue = (rec: Recommendation) => rec.opportunity?.value ?? rec.impactScore;

  // recs are already sorted by sortRecommendations (tier → impactScore → intent
  // alignment) before computeRecommendationSummary is called, so activeRecs[0]
  // is the true highest-ranked active recommendation.
  const topRec = activeRecs.length > 0 ? activeRecs[0] : null;
  const topRecommendationId = topRec?.id ?? null;
  const topOpportunityRationale = topRec ? buildTopOpportunityRationale(topRec) : undefined;
  const totalOpportunityValue = activeRecs.reduce((s, r) => s + opportunityValue(r), 0);
  const actionableOpportunityValue = actionableRecs.reduce((s, r) => s + opportunityValue(r), 0);

  return {
    fixNow: activeRecs.filter(r => r.priority === 'fix_now').length,
    fixSoon: activeRecs.filter(r => r.priority === 'fix_soon').length,
    fixLater: activeRecs.filter(r => r.priority === 'fix_later').length,
    ongoing: activeRecs.filter(r => r.priority === 'ongoing').length,
    totalImpactScore: totalOpportunityValue,
    trafficAtRisk: activeRecs.reduce((s, r) => s + r.trafficAtRisk, 0),
    totalOpportunityValue,
    actionableOpportunityValue,
    ...(topRec ? { topOpportunityValue: opportunityValue(topRec) } : {}),
    topRecommendationId,
    ...(topOpportunityRationale ? { topOpportunityRationale } : {}),
  };
}

/** Render a one-line, CLIENT-SAFE rationale for the #1 recommendation from its
 *  opportunity.components (top 2 contributors' evidence). Contains NO dollar
 *  figure (emvPerWeek/roiPerEffortDay are admin/AI-only per owner decision).
 *  Returns undefined for legacy recs with no opportunity — additive and safe. */
function buildTopOpportunityRationale(rec: Recommendation): string | undefined {
  const components = rec.opportunity?.components;
  if (!components || components.length === 0) return undefined;
  const top = [...components]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2)
    .map(c => c.evidence.trim())
    .filter(Boolean);
  if (top.length === 0) return undefined;
  return top.join('; ');
}

// ─── Business-intent ranking ──────────────────────────────────────
//
// Recs whose topic matches a stated business priority (the authority-resolved
// `effectiveBusinessPriorities` — client store + admin store reconciled in
// business-priorities-source.ts) get a ranking boost. The boost is deliberately
// bounded to a *within-tier tiebreaker*: it can reorder two recs that share the
// same priority tier AND the same impactScore, but it can never move a rec
// across tiers (fix_now > fix_soon > …) or beat a higher impactScore in the same
// tier. This keeps the ranking explainable — tier and traffic-driven impact stay
// the dominant signals; intent only settles ties the engine would otherwise
// break arbitrarily.

/** Generic tokens that carry no business-intent signal — matching on these alone
 * would make almost every rec "aligned", defeating the purpose. Kept small and
 * SEO/priority-domain specific so genuinely distinctive topic words still match.
 * Min token length is 3 so short but distinctive terms ('spa', 'law') still match,
 * while structural/page-type nouns in this set prevent false positives.
 * @internal exported for unit testing */
export const INTENT_STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'with', 'our', 'your', 'more', 'get', 'getting', 'grow',
  'growth', 'increase', 'improve', 'improving', 'boost', 'win', 'winning', 'page',
  'pages', 'site', 'website', 'seo', 'add', 'fix', 'fixing', 'new', 'better',
  'overall', 'experience', 'revenue', 'leads', 'lead', 'jobs', 'job', 'sales',
  'traffic', 'rankings', 'ranking', 'from', 'into', 'this', 'that', 'them',
  // Structural/page-type nouns — matching on these alone produces false positives
  // because nearly every rec touches some kind of "services page" or "product page".
  'services', 'products', 'product', 'about', 'contact', 'home', 'homepage',
  'blog', 'content', 'schema', 'metadata', 'title', 'description', 'meta',
]);

/** Tokenise a free-text string into lowercased, de-noised intent words.
 * Strips a leading `[category]` prefix (client priorities are stored as
 * `[category] text`), splits on non-alphanumerics, drops short/stopword tokens.
 */
function intentTokens(text: string): Set<string> {
  const withoutCategory = text.replace(/^\s*\[[^\]]*\]\s*/, '');
  const tokens = withoutCategory
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !INTENT_STOPWORDS.has(t));
  return new Set(tokens);
}

/** True when a recommendation's topic (its title + affectedPages slugs) shares a
 * meaningful (non-stopword) token with any stated business priority.
 *
 * Intentionally conservative: matches on distinctive nouns (e.g. "plumbing",
 * "roofing", "emergency") so a priority like "Grow plumbing services revenue"
 * aligns with a rec touching the plumbing pages, but a generic priority like
 * "Improve the overall site experience" aligns with nothing in particular.
 * @internal exported for unit testing */
export function isRecIntentAligned(
  rec: Pick<Recommendation, 'title' | 'affectedPages'>,
  effectiveBusinessPriorities: string[],
): boolean {
  if (!effectiveBusinessPriorities.length) return false;
  const recTokens = intentTokens([rec.title, ...rec.affectedPages].join(' '));
  if (recTokens.size === 0) return false;
  for (const priority of effectiveBusinessPriorities) {
    for (const token of intentTokens(priority)) {
      if (recTokens.has(token)) return true;
    }
  }
  return false;
}

/** Canonical recommendation ranking. Sorts `recs` in place:
 *   1. priority tier (fix_now > fix_soon > fix_later > ongoing) — PRIMARY
 *   2. rank score override, then impactScore (highest first) — SECONDARY
 *   3. business-intent alignment (aligned first) — within-tier TIEBREAKER only
 *
 * Because intent is the LAST comparator, an intent-aligned rec can only outrank
 * another rec that is otherwise equal (same tier, same rank score). A higher
 * tier or a higher rank score always wins regardless of intent. Rank score
 * overrides are ephemeral; they do not change the persisted/public impactScore.
 * @internal exported for unit testing */
export function sortRecommendations(
  recs: Recommendation[],
  effectiveBusinessPriorities: string[],
  options: { rankScores?: Map<string, number> } = {},
): void {
  const priorityOrder: Record<RecPriority, number> = { fix_now: 0, fix_soon: 1, fix_later: 2, ongoing: 3 };
  // Memoise alignment so we don't re-tokenise per comparison.
  const aligned = new Map<string, boolean>();
  const isAligned = (rec: Recommendation): boolean => {
    let v = aligned.get(rec.id);
    if (v === undefined) {
      v = isRecIntentAligned(rec, effectiveBusinessPriorities);
      aligned.set(rec.id, v);
    }
    return v;
  };
  recs.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    const scoreA = options.rankScores?.get(a.id) ?? a.impactScore;
    const scoreB = options.rankScores?.get(b.id) ?? b.impactScore;
    const scoreDiff = scoreB - scoreA;
    if (scoreDiff !== 0) return scoreDiff;
    // Equal tier and impact — let stated business intent break the tie.
    return Number(isAligned(b)) - Number(isAligned(a));
  });
}

// ─── Scoring Helpers ──────────────────────────────────────────────

/** Critical SEO checks that warrant "Fix Now" when on high-traffic pages */
const CRITICAL_CHECKS = new Set([
  'title', 'meta-description', 'canonical', 'h1', 'robots',
  'duplicate-title', 'mixed-content', 'ssl', 'robots-txt',
  'redirect-chains', 'redirects',
  'aeo-author', 'aeo-answer-first', 'aeo-trust-pages',
]);

export function isCriticalCheck(check: string): boolean {
  return CRITICAL_CHECKS.has(check);
}

/** Extract the audit check name from a rec `source` string (`audit:title`,
 *  `audit:site-wide:canonical` → `title` / `canonical`). Returns '' for non-audit
 *  sources. Mirrors the checkName extraction in computeRecommendationSummary so the
 *  two stay in lockstep. */
function checkNameFromSource(source: string | undefined): string {
  if (!source) return '';
  if (source.startsWith('audit:site-wide:')) return source.replace('audit:site-wide:', '');
  if (source.startsWith('audit:')) return source.replace('audit:', '');
  return '';
}

// ─── SEO Gen-Quality P4 · OV-derived priority tier (Contract 2) ─────────────
//
// The served priority TIER is derived from the OV value (which is a normalized read of the
// EMV/ROI economic quantity) via the bands below, EXCEPT genuine CRITICAL_CHECKS which keep
// `fix_now` (a broken canonical/robots is urgent regardless of modelled EMV).
//
// ⚠️ OWNER-TUNABLE THRESHOLDS (NOT approved for a per-workspace flip in this PR).
// The bands map the 0..100 OV `value` to a tier. They are deliberately conservative
// defaults; the owner approves the final thresholds AND the canary cohort before any
// per-workspace flip. Documented in docs/rules/seo-generation-quality.md (Contract 2)
// and the PR body. `value` is the OV-pipeline output of normalizeToScore(roiPerEffortDay),
// itself downstream of emvPerWeek — so the tier shares the one OV/EMV basis (Contract 3).
const OV_TIER_BANDS = {
  /** value ≥ this → fix_now (top-of-queue economic opportunity). */
  fixNow: 70,
  /** value ≥ this → fix_soon. */
  fixSoon: 45,
  /** value ≥ this → fix_later; below → ongoing. */
  fixLater: 20,
} as const;

/** Derive the served priority tier from a rec's OV value. CRITICAL_CHECKS short-circuit
 *  to `fix_now`. Pure: same rec → same tier. @internal exported for unit testing */
export function deriveOvTier(rec: Pick<Recommendation, 'priority' | 'source' | 'opportunity'>): RecPriority {
  // Genuine critical audit checks stay urgent regardless of modelled EMV.
  if (isCriticalCheck(checkNameFromSource(rec.source))) return 'fix_now';
  // No OV attached (legacy rec) → keep the existing tier untouched.
  const value = rec.opportunity?.value;
  if (value == null) return rec.priority;
  if (value >= OV_TIER_BANDS.fixNow) return 'fix_now';
  if (value >= OV_TIER_BANDS.fixSoon) return 'fix_soon';
  if (value >= OV_TIER_BANDS.fixLater) return 'fix_later';
  return 'ongoing';
}

export function deriveCanonicalRecommendationFields(
  source: string,
  opportunity: OpportunityScore,
): Pick<Recommendation, 'impactScore' | 'priority'> {
  return {
    impactScore: opportunity.value,
    priority: deriveOvTier({ priority: 'ongoing', source, opportunity }),
  };
}

export function getTrafficScore(traffic: TrafficMap, slug: string, conversionRate?: number): number {
  const pagePath = normalizePageUrl(slug);
  const t = traffic[pagePath] || traffic[slug];
  if (!t) return 0;
  const base = t.clicks * 2 + t.impressions * 0.1 + t.pageviews;
  const convMultiplier = conversionRate && conversionRate > 2
    ? Math.min(1.5, 1 + conversionRate / 20)
    : 1;
  return base * convMultiplier;
}

export function getTrafficForSlug(traffic: TrafficMap, slug: string): { clicks: number; impressions: number } {
  const pagePath = normalizePageUrl(slug);
  const t = traffic[pagePath] || traffic[slug] || { clicks: 0, impressions: 0 };
  return { clicks: t.clicks, impressions: t.impressions };
}

/**
 * Normalise any URL or path value to a bare slug (no leading slash, no domain).
 * GSC and GA4 both store pages as absolute URLs (https://domain.com/path).
 * Decay analysis also stores absolute URLs in some code paths.
 * All other callers pass relative paths (/foo or foo) — those work unchanged.
 */
/** @internal exported for unit testing. Delegates to the canonical shared slug
 *  helper so the generator's `affectedPages` and the admin Strategy cards that
 *  match recs back to a page share ONE normalization (no leading-slash drift). */
export function toPageSlug(url: string): string {
  return toPageSlugShared(url);
}

/** SEO Gen-Quality P5 — stable, order-independent key for a cannibalization URL set. Now defined in
 *  shared/page-address-utils.ts (single source of truth for the generator AND the cannibalization
 *  read path's keeper-override lookup). Re-exported here for back-compat with existing importers and
 *  unit tests. @internal exported for unit testing */
export const cannibalizationUrlSetKey = cannibalizationUrlSetKeyShared;

// Source prefixes whose slug portion may have been stored as an absolute URL
// in recs generated before the toPageSlug normalisation was introduced.
// Every source prefix that embeds a page slug must appear here.
// If the slug computation for a prefix uses toPageSlug(), add it to this list
// so migrateSourceKey() can normalise old recs that pre-date the change.
const URL_SLUG_PREFIXES = ['insight:ctr_opportunity:', 'insight:freshness_alert:', 'decay:', 'strategy:intent-mismatch:'] as const;

/**
 * Migrate a stored source key that may embed a full URL slug to its normalised
 * form. Safe to call on already-normalised keys — returns them unchanged.
 * Used only during the merge phase to match old recs against new ones.
 *
 * Operates on the raw `source` field only — never on composite merge keys
 * (e.g. `strategy:foo::affectedPage`). For composite keys, use buildMergeKey,
 * which applies this function to the source portion and toPageSlug() to the
 * suffix portion separately.
 */
/** @internal exported for unit testing */
export function migrateSourceKey(source: string): string {
  for (const prefix of URL_SLUG_PREFIXES) {
    if (source.startsWith(prefix)) {
      const slug = source.slice(prefix.length);
      const normalized = toPageSlug(slug);
      return normalized !== slug ? `${prefix}${normalized}` : source;
    }
  }
  return source;
}

/**
 * Build the merge-lookup key for a rec. For strategy recs the key is a
 * composite of `source::affectedPages[0]` (or title); for all others it's just
 * the source. Both halves are normalised so old recs (pre-toPageSlug) and new
 * recs produce matching keys, preserving in_progress/dismissed status across
 * the one-time migration.
 */
/** @internal exported for unit testing */
export function buildMergeKey(rec: { source: string; affectedPages: string[]; title: string }): string {
  const source = migrateSourceKey(rec.source);
  if (!source.startsWith('strategy:')) return source;
  const page = rec.affectedPages[0] ? toPageSlug(rec.affectedPages[0]) : rec.title;
  return `${source}::${page}`;
}

/**
 * The Issue (operator-steering) — true for an operator-MINTED rec: an add-a-rec the operator
 * authored (`source: 'manual:<hex>'`) or a competitor-gap mint (`source: 'competitor:<keyword>'`).
 * These recs have NO producer in the merge phase, so their buildMergeKey is never in `newSources` —
 * without a retention branch they would auto-resolve to 'completed' on the very next regen. The
 * auto-resolve loop uses this to RETAIN them as-is when their source is absent (the operator owns
 * their lifecycle; only an explicit strike removes them).
 * @internal exported for unit testing
 */
export function isOperatorMintedRec(rec: { source: string }): boolean {
  return rec.source.startsWith('manual:') || rec.source.startsWith('competitor:');
}

/** Weight impact score based on page type (homepage/service pages matter more)
 * @internal exported for unit testing
 */
export function pageImportanceMultiplier(slug: string): number {
  const s = slug.toLowerCase().replace(/^\//, '');
  if (s === '' || s === 'index' || s === 'home') return 1.5;
  if (/(?:^|\/)services?|solutions?|products?|pricing|packages/.test(s)) return 1.2;
  if (/(?:^|\/)thank[-_]?you|confirmation|success|members?|password|unsubscribe/.test(s)) return 0.8;
  return 1.0;
}

/** Map check name to recommendation type
 * @internal exported for unit testing
 */
export function checkToRecType(check: string, category?: string): RecType {
  const chk = check.toLowerCase();
  if (chk.startsWith('aeo-')) return 'aeo';
  if (chk.includes('meta') || chk.includes('title') || chk.includes('description')) return 'metadata';
  if (chk.includes('schema') || chk.includes('structured')) return 'schema';
  if (chk.includes('img-alt') || chk.includes('alt')) return 'accessibility';
  if (chk.includes('cwv') || chk.includes('performance') || chk.includes('speed')) return 'performance';
  if (category === 'content') return 'content';
  return 'technical';
}

/** D2 (audit #11): content-gap recs route into the EXISTING brief-purchase flow.
 * Brief product per suggested page type — productType values are real `ProductType`
 * members (shared/types/payments.ts) accepted by /api/stripe/cart-checkout, and prices
 * mirror PRODUCT_MAP in server/stripe.ts (the same hardcoded-mirror convention the other
 * mapToProduct cases follow, e.g. schema_page $39).
 */
const BRIEF_PRODUCT_BY_PAGE_TYPE: Record<NonNullable<ContentGap['suggestedPageType']>, { productType: string; productPrice: number }> = {
  blog:     { productType: 'brief_blog',     productPrice: 125 },
  landing:  { productType: 'brief_landing',  productPrice: 150 },
  service:  { productType: 'brief_service',  productPrice: 150 },
  location: { productType: 'brief_location', productPrice: 150 },
  product:  { productType: 'brief_product',  productPrice: 150 },
  pillar:   { productType: 'brief_pillar',   productPrice: 200 },
  resource: { productType: 'brief_resource', productPrice: 150 },
};

/** Map issue type to purchasable product
 * @internal exported for unit testing
 */
export function mapToProduct(
  recType: RecType,
  pageCount: number,
  pageType?: ContentGap['suggestedPageType'],
): { productType?: string; productPrice?: number } {
  switch (recType) {
    case 'metadata':
      return pageCount >= 10
        ? { productType: 'fix_meta_10', productPrice: 179 }
        : { productType: 'fix_meta', productPrice: 20 };
    case 'schema':
      return pageCount >= 10
        ? { productType: 'schema_10', productPrice: 299 }
        : { productType: 'schema_page', productPrice: 39 };
    case 'accessibility':
      return { productType: 'fix_alt', productPrice: 50 };
    // 'aeo' and 'content_refresh' deliberately fall through to the no-product
    // default: the values this used to return (aeo_site_review/aeo_page_review/
    // content_refresh/content_refresh_5) are NOT in the ProductType union or
    // PRODUCT_MAP, so the CTA they produced was unsellable — createCartCheckoutSession
    // throws "Unknown product type" on a phantom type before any Stripe session
    // exists. Restore a case here ONLY together with real PRODUCT_MAP entries
    // (displayName, price, Stripe env key, fulfillment) — the contract test in
    // tests/unit/recommendations-pure-logic.test.ts pins every returned
    // productType to isProductType (catalog membership).
    case 'content':
      // D2 (audit #11): brief-purchase product keyed by the gap's suggested page type.
      return BRIEF_PRODUCT_BY_PAGE_TYPE[pageType ?? 'blog'];
    default:
      return {};
  }
}

// ─── Insight Text Generators ──────────────────────────────────────

/** Infer the most appropriate schema type(s) from a list of page slugs
 * @internal exported for unit testing
 */
export function inferSchemaTypes(slugs: string[]): string {
  const types = new Set<string>();
  for (const slug of slugs) {
    const s = slug.toLowerCase();
    if (/(?:^|\/)blog|articles?|news|posts?|guides?|insights?/.test(s)) types.add('Article');
    if (/(?:^|\/)faq|frequently[-_]asked/.test(s)) types.add('FAQPage');
    if (/(?:^|\/)contact|reach[-_]us|get[-_]in[-_]touch/.test(s)) types.add('ContactPoint');
    if (/(?:^|\/)services?|solutions?|offerings?|what[-_]we[-_]do/.test(s)) types.add('Service');
    if (/(?:^|\/)products?|shop|store/.test(s)) types.add('Product');
    if (/(?:^|\/)about|team|our[-_]story|who[-_]we[-_]are/.test(s)) types.add('Organization');
    if (/(?:^|\/)review|testimonials?|case[-_]stud/.test(s)) types.add('Review');
  }
  if (types.size === 0) types.add('WebPage');
  return Array.from(types).join(', ');
}

export function auditInsight(
  check: string,
  _severity: string,
  affectedCount: number,
  trafficAtRisk: number,
  affectedSlugs?: string[],
): string {
  const chk = check.toLowerCase();
  const hasTraffic = trafficAtRisk > 0;
  const trafficStr = trafficAtRisk >= 1000
    ? `${(trafficAtRisk / 1000).toFixed(1)}k`
    : trafficAtRisk.toString();

  if (chk.includes('title')) {
    return hasTraffic
      ? `${affectedCount} pages with title issues are receiving ${trafficStr} organic clicks/mo. The title tag is the #1 factor in whether someone clicks your result in Google — fixing these will directly improve CTR.`
      : `${affectedCount} pages have title tag issues. This is the single most visible element in search results and directly controls click-through rates.`;
  }
  if (chk.includes('meta-description') || chk.includes('meta')) {
    return hasTraffic
      ? `${affectedCount} pages with metadata issues drive ${trafficStr} clicks/mo. Well-crafted meta descriptions can increase CTR by 5-10% — that's significant traffic you're leaving on the table.`
      : `${affectedCount} pages need metadata optimization. Google displays your meta description in search results — generic or missing descriptions mean lower click-through rates.`;
  }
  if (chk.includes('h1')) {
    return `${affectedCount} pages have H1 heading issues. The H1 is a strong ranking signal that tells Google what your page is about — missing or duplicate H1s confuse search engines.`;
  }
  if (chk.includes('canonical')) {
    return `${affectedCount} pages have canonical tag issues. Without proper canonicals, Google may see duplicate content and dilute your rankings across multiple URLs.`;
  }
  if ((chk.includes('structured') || chk.includes('schema')) && !chk.startsWith('aeo-')) {
    const schemaTypes = affectedSlugs && affectedSlugs.length > 0
      ? inferSchemaTypes(affectedSlugs)
      : null;
    const schemaHint = schemaTypes ? ` Recommended types for these pages: ${schemaTypes}.` : '';
    return hasTraffic
      ? `${affectedCount} pages getting ${trafficStr} clicks/mo lack structured data. Adding schema markup can unlock rich snippets (stars, FAQs, breadcrumbs) which typically boost CTR by 20-30%.${schemaHint}`
      : `${affectedCount} pages are missing structured data. Schema markup enables rich snippets in Google — the enhanced listings that stand out and get significantly more clicks.${schemaHint}`;
  }
  if (chk.includes('img-alt') || chk.includes('alt')) {
    return `${affectedCount} pages have images missing alt text. This affects both Google Image Search visibility and accessibility compliance — two quick wins from a single fix.`;
  }
  if (chk.includes('redirect')) {
    return `Redirect chains slow page loads and dilute link equity — each hop loses ~10-15% of the SEO value being passed through. Cleaning these up is a quick technical win.`;
  }
  if (chk.includes('ssl') || chk.includes('mixed-content')) {
    return `Security issues directly affect rankings — Google uses HTTPS as a ranking signal. Mixed content warnings also erode user trust and can trigger browser warnings.`;
  }
  if (chk.includes('og-tags') || chk.includes('og-image')) {
    return `${affectedCount} pages are missing Open Graph tags. When shared on social media, these pages won't display a proper preview — reducing click-through from social channels.`;
  }
  // AEO-specific insights
  if (chk === 'aeo-author') {
    return hasTraffic
      ? `${affectedCount} pages receiving ${trafficStr} clicks/mo lack author attribution. AI answer engines (ChatGPT, Perplexity, Google AI Overviews) strongly prefer citing content with named, credentialed authors — especially for health, finance, and legal topics.`
      : `${affectedCount} pages are missing author bylines or reviewer attribution. AI systems treat anonymous content as less trustworthy and are less likely to cite it in generated answers.`;
  }
  if (chk === 'aeo-date') {
    return hasTraffic
      ? `${affectedCount} pages with ${trafficStr} clicks/mo have no visible "last updated" date. AI systems deprioritize undated content because they can't verify freshness — adding dates is a quick trust signal.`
      : `${affectedCount} pages are missing visible dates. LLMs and AI answer engines use recency as a ranking signal — undated content gets deprioritized in AI-generated answers.`;
  }
  if (chk === 'aeo-answer-first') {
    return hasTraffic
      ? `${affectedCount} pages driving ${trafficStr} clicks/mo open with generic intros instead of direct answers. AI systems extract the first substantive paragraph as the cited snippet — burying the answer below fluff means you won't get cited.`
      : `${affectedCount} pages start with "Welcome to…" or similar generic intros instead of directly answering the search query. Restructuring to answer-first layout makes content extractable by LLM retrievers.`;
  }
  if (chk === 'aeo-faq-no-schema') {
    return `${affectedCount} pages have FAQ-style content but no FAQPage schema markup. This is a low-hanging win — adding FAQPage JSON-LD enables rich snippets in Google AND makes Q&A pairs directly extractable by AI answer engines.`;
  }
  if (chk === 'aeo-hidden-content') {
    return `${affectedCount} pages hide significant content behind accordions, tabs, or collapsed sections. LLMs typically read only what's visible in the initial HTML — critical information in hidden elements won't get cited.`;
  }
  if (chk === 'aeo-citations') {
    return hasTraffic
      ? `${affectedCount} pages receiving ${trafficStr} clicks/mo lack external citations to authoritative sources. AI systems prefer citing pages that themselves cite primary sources (.gov, .edu, journals, professional associations) — it's a chain-of-trust signal.`
      : `${affectedCount} pages have no outbound links to authoritative sources. Content without citations appears less credible to AI systems — adding references to journals, .gov, .edu, or industry associations increases citation likelihood.`;
  }
  if (chk === 'aeo-dark-patterns') {
    return `${affectedCount} pages contain aggressive popups, autoplay media, or interstitials. AI retrieval systems downrank pages with dark patterns because they signal low-quality user experience.`;
  }
  if (chk === 'aeo-trust-pages') {
    return `Your site is missing essential trust pages (/about, /contact). AI systems use the presence of trust pages as a site-level credibility signal — especially for YMYL (Your Money or Your Life) topics like health, finance, and legal.`;
  }
  if (chk.includes('cwv') || chk.includes('performance')) {
    return hasTraffic
      ? `Core Web Vitals issues on pages driving ${trafficStr} clicks/mo. Google uses page experience as a ranking factor — slow pages lose both rankings and visitors.`
      : `Core Web Vitals issues detected. Page speed is a direct Google ranking factor and impacts user experience — slow pages have higher bounce rates.`;
  }
  return `${affectedCount} page${affectedCount !== 1 ? 's' : ''} affected. Fixing this will improve your site's overall SEO health score and search engine compatibility.`;
}

export function strategyInsight(type: 'content_gap' | 'quick_win' | 'keyword_gap', item: ContentGap | QuickWin): string {
  if (type === 'quick_win') {
    const qw = item as QuickWin;
    return `Quick win on ${qw.pagePath}: ${qw.action}. ${qw.rationale}`;
  }
  if (type === 'content_gap') {
    const cg = item as ContentGap;
    return `Content opportunity: "${cg.topic}" targeting "${cg.targetKeyword}". ${cg.rationale}`;
  }
  return '';
}
