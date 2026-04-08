export interface MeetingBriefRecommendation {
  action: string;
  rationale: string;
}

/** Shape returned by the AI (parsed from JSON response). */
export interface MeetingBriefAIOutput {
  situationSummary: string;
  wins: string[];
  attention: string[];
  recommendations: MeetingBriefRecommendation[];
  /** Null when no Site Blueprint exists for the workspace. */
  blueprintProgress: string | null;
}

/** At-a-Glance metrics assembled server-side from intelligence slices (never AI-generated). */
export interface MeetingBriefMetrics {
  /** Already a percentage (e.g., 83 for 83%). Do NOT multiply by 100. */
  siteHealthScore: number | null;
  openRankingOpportunities: number;
  contentInPipeline: number;
  /** Already a percentage (e.g., 72 for 72%). Do NOT multiply by 100. */
  overallWinRate: number | null;
  criticalIssues: number;
}

/** Full brief shape as stored in DB and returned to frontend. */
export interface MeetingBrief {
  workspaceId: string;
  generatedAt: string; // ISO timestamp
  situationSummary: string;
  wins: string[];
  attention: string[];
  recommendations: MeetingBriefRecommendation[];
  /** Null when no Site Blueprint exists. */
  blueprintProgress: string | null;
  /** Assembled from intelligence slices, not AI. */
  metrics: MeetingBriefMetrics;
}
