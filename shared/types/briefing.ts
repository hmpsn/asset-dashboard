// shared/types/briefing.ts

export type BriefingCategory = 'win' | 'risk' | 'opportunity' | 'competitive' | 'period_change';

export type BriefingDraftStatus = 'draft' | 'approved' | 'published' | 'skipped';

/** Constrained subset of ClientTab — only Explore-drawer destinations are valid drill-in targets. */
export type ExplorePage =
  | 'performance'
  | 'health'
  | 'strategy'
  | 'content-plan'
  | 'roi'
  | 'brand';

export interface BriefingMetric {
  /** Already-formatted value, e.g. "+12%", "2", "8.6K" */
  value: string;
  /** Short label, e.g. "traffic", "on page 1", "search volume" */
  label: string;
}

export interface BriefingDrillIn {
  page: ExplorePage;
  tab?: string;
  queryParams?: Record<string, string>;
}

/**
 * Traceability ref pointing to the underlying record that produced a story.
 *
 * NOTE: The original spec also lists 'prediction' (sourced from `weCalledIt` in
 * the outcome-tracking pipeline). That source was deliberately dropped during
 * planning — wins come exclusively from `analytics_insights` rows where
 * `severity === 'positive'`. See the pre-plan audit (correction #2) and the
 * user decision recorded in the plan's "User decisions" section. Do not add
 * 'prediction' back to this union without revisiting that decision.
 */
export interface BriefingSourceRef {
  type: 'analytics_insight' | 'recommendation' | 'audit_delta';
  id: string;
}

export interface BriefingStory {
  /** Stable identifier within the briefing (uuid) */
  id: string;
  category: BriefingCategory;
  /** Exactly one story per briefing has isHeadline=true */
  isHeadline: boolean;
  /** 5-12 words */
  headline: string;
  /** 1-3 sentences of editorial prose */
  narrative: string;
  /** 0-2 supporting metrics */
  metrics: BriefingMetric[];
  drillIn: BriefingDrillIn;
  /** Traceability — which source records produced this story */
  sourceRefs: BriefingSourceRef[];
  /**
   * Optional citation line rendered below metric badges in the
   * `<HeroStoryCard>`. Plain prose, references data sources +
   * comparisons (e.g. "Source: GSC last-28-day vs prior-28-day window.
   * Verified across 7 daily samples since Apr 14"). Added in Phase 2.5a
   * (deterministic story templates) — older briefings rendered without
   * this field. When present the hero card renders it; when absent no
   * receipt line is shown.
   */
  dataReceipt?: string;
  /**
   * Whether this story is eligible to be promoted to hero
   * (`isHeadline: true`). Default behavior: undefined === eligible.
   * Templates set this to `false` for story types that the spec marks
   * as Watch List only (`competitor_alert`, `page_health`,
   * `ctr_opportunity`, `freshness_alert`, `cannibalization`). The cron's
   * hero-promotion logic respects this field — a story with
   * `leadEligible: false` is NEVER flipped to `isHeadline: true`,
   * regardless of category or materiality rank. Phase 2.5a addition.
   */
  leadEligible?: boolean;
}

export interface BriefingDraft {
  id: string;
  workspaceId: string;
  weekOf: string;             // YYYY-MM-DD (Monday, UTC)
  status: BriefingDraftStatus;
  stories: BriefingStory[];
  sourceMetadata: BriefingSourceMetadata | null;
  adminNote: string | null;
  autoPublished: boolean;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
}

/** Admin-only telemetry, never serialized to client */
export interface BriefingSourceMetadata {
  candidateCount: number;
  model: string;
  provider: 'anthropic' | 'openai';
  generationMs: number;
  preflightDeferralCount?: number;
  /**
   * Phase 2.5e — Premium AI polish output. Persisted in source_metadata to
   * avoid a DB schema change. Read by the public-portal serializer to
   * surface `weeklyOpener` on `PublishedBriefingResponse`. The whole
   * sub-object is stripped from the public response except for the
   * `weeklyOpener` string.
   */
  aiPolish?: {
    /** Premium-only AI-generated "letter from the editor". Null/undefined when fail-soft skipped. */
    weeklyOpener?: string;
    /** Hero headline before the AI punch (for audit / observability). */
    originalHeroHeadline?: string;
    /** ms it took for the AI passes (combined). */
    aiMs?: number;
  };
}

/** Client-visible summary embedded in ClientSignalsSlice */
export interface BriefingSummary {
  weekOf: string;
  publishedAt: number | null;
  storyCount: number;
  hasHero: boolean;
}

/**
 * A subset of `ContentGap` (from `shared/types/workspace.ts`) — the fields
 * surfaced in the briefing's "Recommended for You" section. Computed at
 * serve-time from the workspace's current `keywordStrategy.contentGaps[]`,
 * NOT persisted on the briefing draft. Top N (sorted by `opportunityScore`)
 * are returned. The full ContentGap type is imported by name to avoid a
 * cross-module import cycle on the briefing endpoint hot path.
 *
 * Phase 2.5b addition.
 */
export interface BriefingRecommendation {
  topic: string;
  targetKeyword: string;
  intent: 'informational' | 'commercial' | 'transactional' | 'navigational';
  priority: 'high' | 'medium' | 'low';
  rationale: string;
  suggestedPageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';
  volume?: number;
  difficulty?: number;
  trendDirection?: 'rising' | 'declining' | 'stable';
  serpFeatures?: string[];
  impressions?: number;
  competitorProof?: string;
  questionKeywords?: string[];
  serpTargeting?: string[];
  opportunityScore?: number;
}

/** Wire shape returned from /api/public/briefing/:wsId */
export interface PublishedBriefingResponse {
  weekOf: string;
  publishedAt: number;
  stories: BriefingStory[];
  /**
   * Phase 2.5b — deterministic one-line summary computed at serve time from
   * the story composition + recommendation count. See server/briefing-summary.ts.
   * Optional so older clients/responses without it still parse cleanly.
   */
  issueSummary?: string;
  /**
   * Phase 2.5b — sequential issue counter. The Nth published briefing for the
   * workspace (1-indexed). Computed at serve time as `count(published)` ≤ this
   * one's `published_at`. Stable for a given briefing once published.
   */
  issueNumber?: number;
  /**
   * Phase 2.5b — top content-gap opportunities for "Recommended for You".
   * Pulled live from `keywordStrategy.contentGaps[]` (sorted by
   * `opportunityScore` desc, max 5). Live data — reflects current strategy
   * state, not a snapshot at briefing-publish time.
   */
  recommendations?: BriefingRecommendation[];
  /**
   * Phase 2.5e — Premium-only AI-generated "letter from the editor". One
   * concise sentence rendered above the dateline on premium briefings.
   * Optional — absent when the `client-briefing-v2-ai-polish` flag is off,
   * the workspace tier isn't premium, or the AI call failed (fail-soft).
   * Sourced from `sourceMetadata.aiPolish.weeklyOpener` and exposed here
   * (the rest of `aiPolish` stays admin-only).
   */
  weeklyOpener?: string;
}
