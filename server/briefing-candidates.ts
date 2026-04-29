// server/briefing-candidates.ts
import { getInsights } from './analytics-insights-store.js';
import { loadRecommendations } from './recommendations.js';
import { getSchedule } from './scheduled-audits.js';
import { createLogger } from './logger.js';
import type {
  BriefingCategory,
  BriefingMetric,
  ExplorePage,
  BriefingDrillIn,
  BriefingSourceRef,
} from '../shared/types/briefing.js';

const log = createLogger('briefing-candidates');

const MAX_AGE_DAYS: Record<BriefingCategory, number> = {
  win: 8,
  risk: 14,
  opportunity: 14,
  competitive: 8,
  period_change: 8,
};

const HALF_LIFE_DAYS: Record<BriefingCategory, number> = {
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
  return Math.exp(-ageD / HALF_LIFE_DAYS[category]);
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
 * Collects candidates from all three sources. Each source is wrapped
 * independently so a failure in one (e.g. a corrupted analytics_insights row)
 * doesn't drop candidates from the other two — the caller gets a true partial
 * result rather than silent total failure.
 */
export function collectAllCandidates(workspaceId: string): Candidate[] {
  const out: Candidate[] = [];
  for (const [name, fn] of [
    ['insights', collectInsightCandidates],
    ['recommendations', collectRecommendationCandidates],
    ['audit_delta', collectAuditDeltaCandidates],
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
