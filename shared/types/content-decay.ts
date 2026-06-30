/**
 * Content-decay shared contract. Single source of truth for the shape returned by
 * GET /api/content-decay/:workspaceId. The server analyzer (server/content-decay.ts) and the
 * frontend consumers (useContentDecay hook, DecayingPagesCard) import from here so the
 * frontend's previously-drifted local copies can't fall out of sync with the server again.
 */
export interface DecayingPage {
  page: string; // URL path; used as React key
  title?: string;
  currentClicks: number;
  previousClicks: number;
  clickDeclinePct: number;
  currentImpressions: number;
  previousImpressions: number;
  impressionChangePct: number;
  currentPosition: number;
  previousPosition: number;
  positionChange: number;
  severity: 'critical' | 'warning' | 'watch';
  refreshRecommendation?: string;
  isRepeatDecay?: boolean;
  priority?: string;
}

export interface DecayAnalysis {
  workspaceId: string;
  analyzedAt: string;
  totalPages: number;
  decayingPages: DecayingPage[];
  summary: {
    critical: number;
    warning: number;
    watch: number;
    totalDecaying: number;
    avgDeclinePct: number;
  };
}
