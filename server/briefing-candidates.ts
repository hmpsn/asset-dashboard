// server/briefing-candidates.ts
import { getInsights } from './analytics-insights-store.js';
import { loadRecommendations } from './recommendations.js';
import { getSchedule } from './scheduled-audits.js';
import { getWorkspace } from './workspaces.js';
import { getActionsByWorkspace, getOutcomesForAction } from './outcome-tracking.js';
import { computeROI } from './roi.js';
import { createLogger } from './logger.js';
import type {
  BriefingCategory,
  BriefingMetric,
  ExplorePage,
  BriefingDrillIn,
  BriefingSourceRef,
} from '../shared/types/briefing.js';
import type { ContentGap } from '../shared/types/workspace.js';

const log = createLogger('briefing-candidates');

const MAX_AGE_DAYS: Record<BriefingCategory, number> = {
  win: 8,
  risk: 14,
  opportunity: 14,
  competitive: 8,
  period_change: 8,
};

/**
 * Decay time-constant (τ) per category, in days. Used in `decay()` as
 * `Math.exp(-ageDays / DECAY_TAU_DAYS[category])`. At ageDays = τ the score
 * decays to ~0.368 (1/e), NOT 0.5 — this is exponential decay parameterized by
 * its time-constant, not its half-life. (For reference: half-life = τ × ln 2 ≈
 * τ × 0.693, so τ=7 days corresponds to a half-life of ~4.85 days.)
 */
const DECAY_TAU_DAYS: Record<BriefingCategory, number> = {
  win: 7,
  risk: 10,
  opportunity: 10,
  competitive: 7,
  period_change: 7,
};

const ACTIONABILITY: Record<BriefingCategory, number> = {
  risk: 1.5,
  opportunity: 1.2,
  win: 1.0,
  period_change: 0.9,
  competitive: 0.85,
};

export interface Candidate {
  id: string;
  category: BriefingCategory;
  /** 0-100 */
  impact: number;
  /** Source record id for traceability */
  referenceId: string;
  referenceType: BriefingSourceRef['type'];
  /** ms epoch — basis for recency decay */
  occurredAt: number;
  title: string;
  description: string;
  drillIn: BriefingDrillIn;
  metrics: BriefingMetric[];
}

export interface ScoredCandidate extends Candidate {
  score: number;
}

const DEFAULT_DRILL: Record<BriefingCategory, ExplorePage> = {
  win: 'performance',
  risk: 'health',
  opportunity: 'strategy',
  competitive: 'strategy',
  period_change: 'performance',
};

function ageDays(ms: number): number {
  return Math.max(0, (Date.now() - ms) / 86400_000);
}

function decay(category: BriefingCategory, ageD: number): number {
  return Math.exp(-ageD / DECAY_TAU_DAYS[category]);
}

export function scoreCandidates(cs: Candidate[]): ScoredCandidate[] {
  return cs
    .map((c) => ({
      ...c,
      score: c.impact * decay(c.category, ageDays(c.occurredAt)) * ACTIONABILITY[c.category],
    }))
    .sort((a, b) => b.score - a.score);
}

export function topNByMateriality(cs: Candidate[], n = 10): ScoredCandidate[] {
  return scoreCandidates(cs).slice(0, n);
}

// --- Collectors --------------------------------------------------------------

export function collectInsightCandidates(workspaceId: string): Candidate[] {
  const all = getInsights(workspaceId);
  const out: Candidate[] = [];
  for (const i of all) {
    if (i.resolutionStatus === 'resolved') continue;
    const occurredAt = new Date(i.computedAt).getTime();
    if (Number.isNaN(occurredAt)) continue;

    let category: BriefingCategory;
    if (i.severity === 'positive') category = 'win';
    else if (i.insightType === 'competitor_alert' || i.insightType === 'competitor_gap') category = 'competitive';
    else if (
      i.insightType === 'content_decay' ||
      i.insightType === 'cannibalization' ||
      i.insightType === 'audit_finding' ||
      i.insightType === 'site_health' ||
      i.insightType === 'page_health'
    ) category = 'risk';
    else if (
      i.insightType === 'ranking_opportunity' ||
      i.insightType === 'ctr_opportunity' ||
      i.insightType === 'serp_opportunity' ||
      i.insightType === 'keyword_cluster' ||
      i.insightType === 'emerging_keyword'
    ) category = 'opportunity';
    else if (
      i.insightType === 'ranking_mover' ||
      i.insightType === 'anomaly_digest' ||
      i.insightType === 'freshness_alert'
    ) category = 'period_change';
    else continue; // skip admin-only types like strategy_alignment, conversion_attribution

    if (ageDays(occurredAt) > MAX_AGE_DAYS[category]) continue;

    out.push({
      id: `ins-${i.id}`,
      category,
      impact: typeof i.impactScore === 'number' ? i.impactScore : 40,
      referenceId: i.id,
      referenceType: 'analytics_insight',
      occurredAt,
      title: i.pageTitle ?? i.insightType,
      description: typeof i.data === 'object' && i.data !== null && 'summary' in i.data
        ? String((i.data as { summary?: unknown }).summary ?? '')
        : '',
      drillIn: { page: DEFAULT_DRILL[category] },
      metrics: [],
    });
  }
  return out;
}

export function collectRecommendationCandidates(workspaceId: string): Candidate[] {
  const set = loadRecommendations(workspaceId);
  if (!set?.recommendations) return [];
  const out: Candidate[] = [];
  for (const r of set.recommendations) {
    if (r.status !== 'pending') continue;
    const occurredAt = new Date(r.updatedAt || r.createdAt).getTime();
    if (Number.isNaN(occurredAt)) continue;

    const category: BriefingCategory = r.priority === 'fix_now' ? 'risk' : 'opportunity';
    if (ageDays(occurredAt) > MAX_AGE_DAYS[category]) continue;

    out.push({
      id: `rec-${r.id}`,
      category,
      impact: typeof r.impactScore === 'number'
        ? r.impactScore
        : (r.impact === 'high' ? 70 : r.impact === 'medium' ? 50 : 30),
      referenceId: r.id,
      referenceType: 'recommendation',
      occurredAt,
      title: r.title,
      description: r.description ?? '',
      drillIn: { page: category === 'risk' ? 'health' : 'strategy' },
      metrics: [],
    });
  }
  return out;
}

export function collectAuditDeltaCandidates(workspaceId: string): Candidate[] {
  const sched = getSchedule(workspaceId);
  if (!sched?.lastRunAt || sched.lastScore == null) return [];
  const occurredAt = new Date(sched.lastRunAt).getTime();
  if (Number.isNaN(occurredAt)) return [];
  if (ageDays(occurredAt) > MAX_AGE_DAYS.period_change) return [];
  return [{
    id: `audit-${workspaceId}-${sched.lastRunAt}`,
    category: 'period_change',
    impact: Math.min(100, Math.max(20, sched.lastScore)),
    referenceId: workspaceId,
    referenceType: 'audit_delta',
    occurredAt,
    title: `Site health audit completed`,
    description: `Latest audit score: ${sched.lastScore}/100`,
    drillIn: { page: 'health' },
    metrics: [{ value: `${sched.lastScore}`, label: 'site health' }],
  }];
}

/**
 * Collect content gap candidates from `workspace.keywordStrategy.contentGaps[]`.
 *
 * These are keywords with measurable search demand (per SEMrush/DataForSEO) where
 * the workspace has no existing page targeting the term. They drive the
 * "Recommended for You" section and one of the highest-margin upsell flows in
 * the platform (per-brief content generation pricing). Phase 2.5a wires them
 * into the briefing candidate pool for the first time — they were previously
 * only surfaced 3+ clicks deep on the Strategy tab.
 *
 * Materiality:
 *   - `impact` is sourced from `gap.opportunityScore` (server-computed at
 *     strategy generation time; admin's <ContentGaps> sorts by it). When
 *     `opportunityScore` is absent (older strategies pre-dating the field),
 *     fall back to a deterministic mix of volume + difficulty so the gap
 *     still gets a score.
 *   - `category: 'opportunity'` — gaps are uniformly opportunities (not
 *     wins or risks). The actionability multiplier handles ranking among
 *     other opportunities.
 *
 * Source ref type is 'recommendation' since gaps are a recommendation-class
 * signal (not an analytics_insight, not an audit_delta). The id encodes the
 * target keyword for traceability.
 */
export function collectContentGapCandidates(workspaceId: string): Candidate[] {
  const ws = getWorkspace(workspaceId);
  const gaps = ws?.keywordStrategy?.contentGaps;
  if (!gaps || gaps.length === 0) return [];

  const now = Date.now();
  const out: Candidate[] = [];
  for (const gap of gaps) {
    if (!gap.targetKeyword) continue; // skip malformed entries
    const impact = gap.opportunityScore ?? deriveOpportunityScore(gap);
    if (impact <= 0) continue;
    out.push({
      id: `gap-${gap.targetKeyword}`,
      category: 'opportunity',
      impact,
      referenceId: gap.targetKeyword,
      referenceType: 'recommendation',
      occurredAt: now, // gaps don't carry per-row timestamps; treat as fresh
      title: gap.topic ?? gap.targetKeyword,
      description: gap.rationale ?? '',
      drillIn: { page: 'strategy', queryParams: { gap: gap.targetKeyword } },
      metrics: [],
    });
  }
  return out;
}

/**
 * Fallback opportunity-score computation for gaps missing the server-computed
 * `opportunityScore` field. Mirrors the admin <ContentGaps> sort ordering's
 * spirit: prefer high-volume, low-difficulty terms; small bonus for non-zero
 * impressions (proves real demand from the workspace's existing audience).
 *
 * Returns 0-100. Templates downstream cite the score as part of their
 * narrative when it materially drives the headline.
 */
function deriveOpportunityScore(gap: ContentGap): number {
  const vol = gap.volume ?? 0;
  if (vol <= 0) return 0;
  // Map volume to 0-60 (log scale: 100 → 20, 1000 → 40, 10k → 60)
  const volScore = Math.min(60, Math.log10(vol + 1) * 15);
  // Difficulty penalty: KD 0 → +30, KD 100 → 0
  const kdScore = gap.difficulty != null ? Math.max(0, 30 - 0.3 * gap.difficulty) : 15;
  // Impressions bonus: workspace already getting any impressions = +10
  const imprScore = (gap.impressions ?? 0) > 0 ? 10 : 0;
  return Math.round(volScore + kdScore + imprScore);
}

// ── Phase 2.5c: weCalledIt + milestone_attribution candidate collectors ──
//
// Both produce Candidate rows with distinct id prefixes (`wci-` / `milestone-`)
// that the cron's dispatch loop routes through dedicated templates rather
// than the analytics_insights INSIGHT_DISPATCHERS map. This keeps the
// candidate shape uniform without forcing both data sources through the
// `analytics_insights` table — neither is persisted there today.

/** Window for "the win is recent" guard — spec §6 says last 14 days. */
const WECALLEDIT_RECENT_DAYS = 14;

/** Recency cap for milestone_attribution — only fire on briefs delivered within 90d. */
const MILESTONE_RECENT_DAYS = 90;

/**
 * Surface tracked_actions whose MOST RECENT outcome is `strong_win` AND
 * the win was measured within the last 14 days. The cron's dispatch loop
 * routes these to `buildStoryFromWeCalledIt` via the `wci-` id prefix.
 *
 * Sources read: tracked_actions, action_outcomes (via getOutcomesForAction).
 */
export function collectWeCalledItCandidates(workspaceId: string): Candidate[] {
  const actions = getActionsByWorkspace(workspaceId);
  const out: Candidate[] = [];
  for (const action of actions) {
    const outcomes = getOutcomesForAction(action.id);
    if (outcomes.length === 0) continue;
    // Pick the latest outcome by measuredAt — the cron emits one story per
    // action, anchored on the most recent outcome reading.
    const latest = outcomes.reduce(
      (acc, o) => (Date.parse(o.measuredAt) > Date.parse(acc.measuredAt) ? o : acc),
      outcomes[0],
    );
    if (latest.score !== 'strong_win') continue;
    const measuredMs = Date.parse(latest.measuredAt);
    if (!Number.isFinite(measuredMs)) continue;
    if (ageDays(measuredMs) > WECALLEDIT_RECENT_DAYS) continue;

    out.push({
      id: `wci-${action.id}`,
      category: 'win',
      // weCalledIt is a TRUST PLAY — high baseline impact. The cron's
      // hero promotion respects leadEligible (template sets true).
      impact: 80,
      referenceId: action.id,
      // Closest fit in the existing union — there's no `tracked_action` source
      // type. The cron routes by id-prefix, not by referenceType, so this is
      // effectively a label rather than a dispatch key.
      referenceType: 'analytics_insight',
      occurredAt: measuredMs,
      title: action.targetKeyword
        ? `Prediction landed: "${action.targetKeyword}"`
        : `Prediction landed: ${action.pageUrl ?? action.id}`,
      description: '',
      drillIn: { page: 'performance', queryParams: action.pageUrl ? { page: action.pageUrl } : undefined },
      metrics: [],
    });
  }
  return out;
}

/**
 * Surface delivered briefs that just crossed a clicks threshold (first /
 * fifty / hundred). The cron's dispatch loop routes these via the `milestone-`
 * id prefix to the milestone_attribution template, constructing a synthetic
 * AnalyticsInsight<'milestone_attribution'> from the action + ROI data.
 *
 * "Just crossed" is approximated by a tight band above the threshold
 * (current within 1.5× of threshold) so the same milestone doesn't fire
 * every week the page sits comfortably above the line. Fully accurate
 * crossing detection requires per-week persisted markers and is deferred.
 */
export function collectMilestoneAttributionCandidates(workspaceId: string): Candidate[] {
  const actions = getActionsByWorkspace(workspaceId).filter((a) => a.actionType === 'brief_created');
  if (actions.length === 0) return [];
  const roi = (() => {
    try { return computeROI(workspaceId); } catch { return null; }
  })();
  if (!roi || !Array.isArray(roi.contentItems) || roi.contentItems.length === 0) return [];

  const out: Candidate[] = [];
  for (const action of actions) {
    const occurredAt = Date.parse(action.createdAt);
    if (!Number.isFinite(occurredAt)) continue;
    const daysSinceDelivery = Math.floor((Date.now() - occurredAt) / 86400_000);
    if (daysSinceDelivery > MILESTONE_RECENT_DAYS) continue;
    if (!action.pageUrl) continue;

    // Match the action to its ROI content-item entry by sourceId
    // (content_request id) when possible, falling back to pageUrl.
    const item = roi.contentItems.find((ci) => {
      // contentItems carry a contentRequestId or similar — match best-effort.
      const ciAny = ci as { contentRequestId?: string; pageUrl?: string };
      if (action.sourceId && ciAny.contentRequestId === action.sourceId) return true;
      return ciAny.pageUrl === action.pageUrl;
    });
    if (!item) continue;
    const itemAny = item as { currentClicks?: number; trafficValue?: number; title?: string };
    const currentClicks = typeof itemAny.currentClicks === 'number' ? itemAny.currentClicks : 0;
    if (currentClicks < 1) continue;

    // Pick the highest threshold the page has crossed AND is "fresh" (in the
    // tight band above). Order matters: prefer the largest threshold so we
    // surface the most impressive milestone first.
    let threshold: 'hundred_clicks' | 'fifty_clicks' | 'first_clicks' | null = null;
    if (currentClicks >= 100 && currentClicks < 150) threshold = 'hundred_clicks';
    else if (currentClicks >= 50 && currentClicks < 75) threshold = 'fifty_clicks';
    else if (currentClicks >= 1 && currentClicks < 5) threshold = 'first_clicks';
    if (!threshold) continue;

    out.push({
      id: `milestone-${action.sourceId ?? action.id}`,
      category: 'win',
      impact: threshold === 'hundred_clicks' ? 85 : threshold === 'fifty_clicks' ? 70 : 55,
      referenceId: action.id,
      referenceType: 'analytics_insight',
      occurredAt: Date.now(),
      title: itemAny.title ? `Brief milestone: "${itemAny.title}"` : `Brief milestone: ${action.pageUrl}`,
      description: '',
      drillIn: { page: 'performance', queryParams: { page: action.pageUrl } },
      metrics: [],
    });
  }
  return out;
}

/**
 * Collects candidates from every source. Each source is wrapped
 * independently so a failure in one (e.g. a corrupted analytics_insights row)
 * doesn't drop candidates from the others — the caller gets a true partial
 * result rather than silent total failure.
 */
export function collectAllCandidates(workspaceId: string): Candidate[] {
  const out: Candidate[] = [];
  for (const [name, fn] of [
    ['insights', collectInsightCandidates],
    ['recommendations', collectRecommendationCandidates],
    ['audit_delta', collectAuditDeltaCandidates],
    ['content_gaps', collectContentGapCandidates],
    ['weCalledIt', collectWeCalledItCandidates],
    ['milestones', collectMilestoneAttributionCandidates],
  ] as const) {
    try {
      out.push(...fn(workspaceId));
    } catch (err) {
      log.error({ err, workspaceId, source: name }, 'briefing candidate collector failed; skipping source');
    }
  }
  return out;
}

/** Render a numbered candidate block for the AI prompt. */
export function formatCandidateBlock(scored: ScoredCandidate[]): string {
  return scored.map((c, idx) => (
    `${idx + 1}. [${c.category}] (${c.referenceType}:${c.referenceId}) impact=${c.impact} age=${ageDays(c.occurredAt).toFixed(1)}d score=${c.score.toFixed(1)}\n` +
    `   ${c.title}${c.description ? '\n   ' + c.description : ''}`
  )).join('\n');
}
