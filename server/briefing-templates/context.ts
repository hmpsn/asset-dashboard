/**
 * Shared context passed to deterministic briefing-story templates.
 *
 * Keep this as a leaf contract so individual templates do not import the
 * briefing template barrel that registers them.
 */
export interface TemplateContext {
  workspaceId: string;
  tier: 'free' | 'growth' | 'premium';
  /**
   * Workspace's weighted-avg CPC from `computeROI()`. Used by the
   * content-gap template's data receipt to render a dollar-equivalent
   * footnote. Optional when ROI has not been computed for the workspace yet.
   */
  avgCPC?: number;
  /**
   * Pre-computed pulse data the cron has on hand. Templates use these to query
   * `findBestWeekSince` and append "best week since X" anchor phrases.
   */
  pulseMetrics?: {
    totalClicks?: number;
    totalImpressions?: number;
    avgPosition?: number;
    auditScore?: number;
    organicTrafficValue?: number;
  };
}
