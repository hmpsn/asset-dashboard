// shared/types/briefing.ts

export type BriefingCategory = 'win' | 'risk' | 'opportunity' | 'competitive' | 'period_change';

export type BriefingDraftStatus = 'draft' | 'approved' | 'published' | 'skipped';

/** Constrained subset of ClientTab — only Explore-drawer destinations are valid drill-in targets. */
export type ExplorePage =
  | 'performance'
  | 'health'
  | 'strategy'
  | 'content-plan'
  | 'schema-review'
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
}

/** Client-visible summary embedded in ClientSignalsSlice */
export interface BriefingSummary {
  weekOf: string;
  publishedAt: number | null;
  storyCount: number;
  hasHero: boolean;
}

/** Wire shape returned from /api/public/briefing/:wsId */
export interface PublishedBriefingResponse {
  weekOf: string;
  publishedAt: number;
  stories: BriefingStory[];
}
