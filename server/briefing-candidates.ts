// server/briefing-candidates.ts
import { getInsights } from './analytics-insights-store.js';
import { loadRecommendations } from './recommendations.js';
import { getSchedule } from './scheduled-audits.js';
import { getWorkspace } from './workspaces.js';
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

/**
 * Collects candidates from all four sources. Each source is wrapped
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
