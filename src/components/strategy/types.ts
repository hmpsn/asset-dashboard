import type { MetricsSource } from '../../../shared/types/keywords.js';
import type { AdminKeywordFeedbackListRow } from '../../../shared/types/keyword-feedback';
import type { CannibalizationItem } from '../../../shared/types/workspace';
import type { ActiveStrategyKeyword } from '../../../shared/types/strategy-keyword-set';

/** Page→keyword mapping row as rendered by the Strategy page. Moved verbatim from KeywordStrategy.tsx. */
export interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
  currentPosition?: number;
  /** Prior average position from the previous enrichment — drives the v2 Rankings-tab movements. */
  previousPosition?: number;
  impressions?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  metricsSource?: MetricsSource;
  validated?: boolean;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

/** Derived metrics computed from a strategy + feedback rows. Pure function of inputs. */
export interface StrategyMetrics {
  pageMap: PageKeywordMap[];
  filteredPageMap: PageKeywordMap[];
  ranked: PageKeywordMap[];
  avgPos: number;
  totalImpressions: number;
  totalClicks: number;
  top3: PageKeywordMap[];
  top10: PageKeywordMap[];
  top20: PageKeywordMap[];
  beyond20: PageKeywordMap[];
  notRankingCount: number;
  lowHangingFruit: PageKeywordMap[];
  intentCounts: Record<string, number>;
  /** Position movements vs each page's previousPosition (v2 Rankings tab). */
  movements: { improved: number; declined: number; new: number; lost: number };
  declinedFeedback: AdminKeywordFeedbackListRow[];
  requestedFeedback: AdminKeywordFeedbackListRow[];
  approvedFeedback: AdminKeywordFeedbackListRow[];
  feedbackNewerThanStrategy: boolean;
  /** True if ANY page in the UNFILTERED pageMap has a currentPosition. Wire StrategyHowItWorks.hasAnyRanking from this — NOT `ranked.length > 0` (ranked is volume-filtered). */
  hasAnyRanking: boolean;
  /** True if ANY page in the UNFILTERED pageMap has volume > 0. Wire StrategyStalenessNudges.hasVolumeValidation from this — NOT a filteredPageMap check. */
  hasVolumeValidation: boolean;
}

/** Minimum monthly search volume to display a strategy card. Below this is noise. */
export const VOLUME_THRESHOLD = 10;

export type SeoDataMode = 'none' | 'quick' | 'full';

/** A Quick Win as stored on the strategy blob (structurally identical to the inline type in QuickWins.tsx). */
export interface StrategyQuickWin {
  pagePath: string;
  action: string;
  estimatedImpact: string;
  rationale: string;
  roiScore?: number;
}

/**
 * One actionable row in the Act band's OpportunitiesList. Discriminated by `kind`:
 * - 'quick_win'   → an AI-suggested page action (from strategy.quickWins)
 * - 'low_hanging' → a page ranking #4–20 with impressions (from metrics.lowHangingFruit)
 * Both carry a pagePath so a per-row Fix CTA can deep-link into Page Intelligence.
 */
export type OpportunityRow =
  | { kind: 'quick_win'; pagePath: string; action: string; estimatedImpact: string; rationale: string; roiScore?: number }
  | {
      kind: 'low_hanging';
      pagePath: string;
      pageTitle: string;
      primaryKeyword: string;
      currentPosition?: number;
      impressions?: number;
      clicks?: number;
      volume?: number;
    };

// ── Leaf component prop contracts (pre-committed; leaves import from here) ──

export interface StrategyHeaderActionsProps {
  isRealStrategy: boolean;
  generating: boolean;
  localSyncApplies: boolean;
  localNeedsRefresh: boolean;
  refreshPending: boolean;
  onIncremental: () => void;
  onFullRefresh: () => void;
  onGenerate: () => void;
}

export interface StrategyFeedbackNudgeProps {
  requestedCount: number;
  declinedCount: number;
}

export interface ClientKeywordFeedbackProps {
  rows: AdminKeywordFeedbackListRow[];
  requested: AdminKeywordFeedbackListRow[];
  declined: AdminKeywordFeedbackListRow[];
  approved: AdminKeywordFeedbackListRow[];
  addPending: boolean;
  addError: string | null;
  onAdd: (keyword: string) => void;
  onDismissError: () => void;
  /**
   * When false, the "Requested by client" triage block is suppressed (declined-only log).
   * Used by the decision-bands layout, which hoists requested keywords into <RequestedKeywordTriage>
   * in the Decide band. Defaults to true so the legacy (flag-off) combined card is unchanged.
   */
  showRequested?: boolean;
}

export interface DecisionQueueProps {
  workspaceId: string;
}

/** Act band: merged Quick Wins + Low-Hanging Fruit with per-row Fix CTAs. */
export interface OpportunitiesListProps {
  quickWins: StrategyQuickWin[];
  lowHangingFruit: PageKeywordMap[];
  workspaceId: string;
}

/** Act band: top decaying pages (content_decay) with Refresh-brief / Review-page CTAs. */
export interface DecayingPagesCardProps {
  workspaceId: string;
}

/** Act band: queries that lost visibility (lost_visibility insight) with a recovery CTA. */
export interface LostQueryRecoveryCardProps {
  workspaceId: string;
}

/** Act band: keyword-cannibalization triage queue with per-duplicate Fix-in-Editor CTAs. */
export interface CannibalizationTriageProps {
  entries: CannibalizationItem[];
  workspaceId: string;
}

export interface RequestedKeywordTriageProps {
  requested: AdminKeywordFeedbackListRow[];
  addPending: boolean;
  addError: string | null;
  onAdd: (keyword: string) => void;
  onDismissError: () => void;
}

export interface StrategySettingsProps {
  workspaceId: string;
  isAuxLoading: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  seoDataAvailable: boolean;
  seoDataMode: SeoDataMode;
  setSeoDataMode: (m: SeoDataMode) => void;
  maxPages: number;
  setMaxPages: (n: number) => void;
  competitors: string;
  setCompetitors: (v: string) => void;
  businessContext: string;
  setBusinessContext: (v: string) => void;
  contextOpen: boolean;
  setContextOpen: (v: boolean) => void;
  discoveringCompetitors: boolean;
  discoverError: string | null;
  onDiscoverCompetitors: () => void;
}

export interface StrategyStalenessNudgesProps {
  /** Source from StrategyMetrics.hasVolumeValidation (unfiltered pageMap.some(volume>0)). The unvalidated warning renders when this is FALSE. */
  hasVolumeValidation: boolean;
  localSyncApplies: boolean;
  strategyStaleVsLocal: boolean;
  lastLocalRefreshAt: string | null | undefined;
  lastStrategyGeneratedAt: string | null | undefined;
  dismissedRefreshAt: string | null;
  onDismiss: () => void;
  onGenerate: () => void;
}

export interface RankingDistributionProps {
  filteredPageMap: PageKeywordMap[];
  ranked: PageKeywordMap[];
  top3: PageKeywordMap[];
  top10: PageKeywordMap[];
  top20: PageKeywordMap[];
  beyond20: PageKeywordMap[];
  notRankingCount: number;
  intentCounts: Record<string, number>;
  /**
   * When provided (Reference band, Phase 4c), the striking-distance (11–20) legend row becomes a
   * deep-link to the Keyword Hub's striking_distance view — the one position band with a real Hub
   * filter destination. Omitted in legacy → static legend, byte-identical.
   */
  workspaceId?: string;
  navigate?: (path: string) => void;
}

export interface SiteTargetKeywordsProps {
  workspaceId: string;
  siteKeywords: string[];
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
  trackedKeywords: Set<string>;
  trackingPending: Set<string>;
  trackingErrors: Map<string, string>;
  onTrack: (kw: string) => void;
  /** When provided, caps the list at N items with a "Show N more / Show less" toggle.
   *  When absent/undefined, renders the full list — byte-identical to the previous behavior. */
  maxVisible?: number;
  /**
   * P3 Lane C — managed-set display state for each keyword row.
   * When provided, each row is annotated with one of three visual states:
   *   In Set    → teal dot + "In Set" badge (removedAt is null, row exists)
   *   Removed   → zinc/muted styling (removedAt is non-null — row exists but was removed)
   *   Candidate → no annotation (keyword not in the managed set at all)
   *
   * Pass the full activeKeywordSet array from useStrategyKeywordSet (Lane D).
   * When absent/undefined, behavior is byte-identical to the pre-P3 display (no states shown).
   * DISPLAY ONLY — mutation controls are Lane D's exclusive concern.
   */
  managedKeywordSet?: ActiveStrategyKeyword[];
}

export interface KeywordOpportunitiesProps {
  opportunities: string[];
  /**
   * When provided (Reference band, Phase 4b), each opportunity row gets an "Explore in Hub" deep-link
   * so the analyst can research the (freeform, AI-suggested) phrase in the Keyword Hub. Omitted in the
   * legacy layout → no per-row affordance, byte-identical.
   */
  workspaceId?: string;
  navigate?: (path: string) => void;
  /** When provided, caps the list at N items with a "Show N more / Show less" toggle.
   *  When absent/undefined, renders the full list — byte-identical to the previous behavior. */
  maxVisible?: number;
  /**
   * P3 Lane C — when true, each opportunity row shows an "Interested in this one?" inline confirm
   * that routes through the rec-lifecycle send path (recommendations.send) for the keyword_gap rec
   * minted at regen. Send UX is only rendered when workspaceId is also provided.
   * When absent/false, behavior is byte-identical to the pre-P3 display.
   */
  enableSend?: boolean;
  /**
   * P3/Lane D seam — called after a successful send with the keyword string (rec.targetKeyword ?? opp).
   * Lane D wires this to addStrategyKeyword so "interested→yes→send" also adds the keyword to the managed
   * set. Lane C (KeywordOpportunities) owns no add hook — the callback is the seam.
   */
  onAddToStrategySet?: (keyword: string) => void;
}

export interface StrategyHowItWorksProps {
  /** Source from `strategy?.seoDataMode` (the SAVED strategy mode) — NOT the settings-form `seoDataMode` (editable state). */
  displayedSeoDataMode?: string;
  /** Source from StrategyMetrics.hasAnyRanking (unfiltered pageMap.some(currentPosition)). The GSC tip renders when this is FALSE. */
  hasAnyRanking: boolean;
}
