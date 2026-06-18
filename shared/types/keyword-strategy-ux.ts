import type {
  TrackedKeywordAuthorityPosture,
  TrackedKeywordSource,
  TrackedKeywordStatus,
} from './rank-tracking.js';
import type { LocalStrategySyncStatus } from './local-seo.js';
import type { OutcomeReadback } from './outcome-tracking.js';

export type KeywordStrategyUxSurface = 'admin' | 'client';

export type KeywordStrategyExplanationRole =
  | 'site_keyword'
  | 'page_keyword'
  | 'content_gap'
  | 'competitor_gap';

export type KeywordStrategyNextActionType =
  | 'generate_brief'
  | 'optimize_page'
  | 'track_keyword'
  | 'watch'
  | 'review_evidence';

export interface KeywordStrategyNextAction {
  type: KeywordStrategyNextActionType;
  label: string;
  detail: string;
  keyword?: string;
  pagePath?: string;
  targetTab?: string;
}

export interface KeywordStrategyTrackingState {
  status: TrackedKeywordStatus | 'not_tracked';
  source?: TrackedKeywordSource;
  pagePath?: string;
  pageTitle?: string;
  replacedBy?: string;
  deprecatedAt?: string;
  baselinePosition?: number;
  baselineClicks?: number;
  baselineImpressions?: number;
}

export interface KeywordStrategyExplanation {
  keyword: string;
  normalizedKeyword: string;
  role: KeywordStrategyExplanationRole;
  surfaceLabel: string;
  sourceEvidence: string[];
  reasons: string[];
  fitSignals: string[];
  feedbackStatus?: 'approved' | 'declined' | 'requested';
  authorityPosture?: TrackedKeywordAuthorityPosture;
  tracking?: KeywordStrategyTrackingState;
  pagePath?: string;
  pageTitle?: string;
  opportunityScore?: number;
  rawEvidenceOnly?: boolean;
  nextAction: KeywordStrategyNextAction;
  /**
   * Plain-language reasons explaining the keyword's value score (Task 2.3).
   * Populated server-side in buildKeywordStrategyUxPayload when the
   * keyword-value-scoring flag is ON. Absent when the flag is OFF or the
   * keyword has no value signal (signal gate fails).
   * Safe for all tiers (no $ amounts).
   */
  valueReasons?: string[];
  /**
   * Realized monthly dollar value of the keyword: clicks × cpc (Task 3.3).
   * Computed server-side via the single keywordDollarValue helper (one $
   * definition, identical to roi.ts trafficValue). Absent when cpc is unknown.
   * Growth+ gated like ROIDashboard's realized $.
   */
  currentMonthly?: number;
  /**
   * Upside monthly dollar value if the keyword moved up (Task 3.3): impressions ×
   * CTR uplift × cpc, from the same keywordDollarValue helper. Absent when no cpc.
   */
  upsideMonthly?: number;
  /**
   * W5.1: read-back outcome verdict for this keyword's tracked action — the latest
   * conclusive measurement (baseline→current position + verdict). Populated
   * server-side in buildKeywordStrategyUxPayload by joining the keyword's
   * (pagePath, keyword) tracked action to its scored outcome. Absent when the
   * keyword has no scored action yet. Position numbers are honest (lower=better);
   * `direction` is pre-computed — never re-infer improvement from raw positions.
   */
  outcome?: OutcomeReadback;
}

export interface KeywordStrategyRefreshSummary {
  previousGeneratedAt?: string;
  currentGeneratedAt?: string;
  added: number;
  retained: number;
  reassigned: number;
  deprecated: number;
  replaced: number;
  preserved: number;
  skipped: number;
  newContentGaps: number;
  resolvedContentGaps: number;
}

/**
 * Strategy v2 Orient-zone metrics — the top-line "where the site sits" glance.
 * Computed server-side on the admin GET (`/api/webflow/keyword-strategy/:id`) AND the public client
 * read (`/api/public/seo-strategy/:id`, Phase 6a) — the visibility score depends on the CTR-decay curve
 * and the deltas require the prior strategy_history snapshot. The metric is client-safe by construction:
 * its only inputs are per-page {position, volume}; there is NO emv / opportunity.value / per-keyword $.
 * Each stat pairs a current value with a delta vs the previous strategy generation
 * (null when there is no prior snapshot). `avgPositionDelta` is signed
 * (current − prior); negative means improved (a lower position is better).
 */
export interface OrientMetrics {
  visibilityScore: number;
  visibilityScoreDelta: number | null;
  clicks: number;
  clicksDelta: number | null;
  impressions: number;
  impressionsDelta: number | null;
  rankedKeywords: number;
  rankedKeywordsDelta: number | null;
  avgPosition: number;
  avgPositionDelta: number | null;
}

export interface KeywordStrategyUxPayload {
  refreshSummary?: KeywordStrategyRefreshSummary;
  explanations: KeywordStrategyExplanation[];
  rawEvidenceNote?: string;
  /**
   * Bidirectional sync status between local SEO visibility data and the
   * keyword strategy. Present on admin GET /api/webflow/keyword-strategy/:id
   * in both the real branch (strategy blob) and the shell branch
   * (page_keywords only). Absent on client-facing reads.
   */
  localSync?: LocalStrategySyncStatus;
  /**
   * Strategy v2 Orient-zone metrics. Present on the admin GET and the public client read (Phase 6a)
   * whenever assembled strategy data exists (pages and/or a strategy blob). Client-safe — see OrientMetrics.
   */
  orient?: OrientMetrics;
}

export interface KeywordStrategyKeywordChange {
  pagePath: string;
  oldKeyword: string;
  newKeyword: string;
}

export interface KeywordStrategyDiff {
  previousGeneratedAt: string;
  currentGeneratedAt: string;
  newKeywords: string[];
  lostKeywords: string[];
  newGaps: string[];
  resolvedGaps: string[];
  keywordChanges: KeywordStrategyKeywordChange[];
  prevSiteKeywordCount: number;
  currSiteKeywordCount: number;
  summary?: KeywordStrategyRefreshSummary;
  explanations?: KeywordStrategyExplanation[];
  rawEvidenceNote?: string;
}
