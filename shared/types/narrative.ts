import type { InsightType, InsightSeverity, InsightDomain } from './analytics.js';
import type { Attribution } from './outcome-tracking.js';

/** Client-facing insight — reframed from admin language to outcome language */
export interface ClientInsight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  domain: InsightDomain;
  headline: string;       // "We detected a ranking change on your AI Tools page"
  narrative: string;      // "Your page moved from position 4 to 11. We're working on a recovery plan."
  impact?: string;        // "Estimated ~2,400 fewer monthly visits"
  actionTaken?: string;   // "Brief created to address this" or null
  impactScore: number;
}

/** Whether the current UTC operational month has evidence worth summarizing. */
export type MonthlyDigestAvailability = 'ready' | 'no_data';

/** Monthly performance digest for client dashboard. Always the current UTC operational month. */
export interface MonthlyDigestData {
  availability: MonthlyDigestAvailability;
  month: string;             // "March 2026"
  period: { start: string; end: string };
  summary: string;           // AI-generated when evidence exists; deterministic honest copy for no_data/fallback
  wins: DigestItem[];
  issuesAddressed: DigestItem[];
  metrics: {
    /** Already a percentage delta (e.g., 12.5 for +12.5%). Do NOT multiply by 100. */
    clicksChange: number;
    /** Already a percentage delta (e.g., -5.0 for -5.0%). Do NOT multiply by 100. */
    impressionsChange: number;
    /** Positive = improved (lower avg position). */
    avgPositionChange: number;
    pagesOptimized: number;
  };
  roiHighlights: ROIHighlight[];
}

export interface DigestItem {
  title: string;
  detail: string;
  insightId?: string;
}

export interface ROIHighlight {
  pageTitle: string;
  pageUrl: string;
  action: string;            // "Content refresh" / "SEO fix applied"
  result: string;            // "Position improved from 8 to 3"
  /** Net click change after measurement window. May be 0 if unmeasured yet. */
  clicksGained: number;
  /** Dollar value attributed to this outcome (clicks_delta × CPC). Null when CPC unavailable. */
  attributedValue: number | null;
  /**
   * Honest execution authority for client framing. The live outcome producer always sets this;
   * optional only for the deprecated pre-outcome attribution reader, which must stay neutral.
   */
  attribution?: Exclude<Attribution, 'not_acted_on'>;
}
