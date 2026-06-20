// shared/types/the-issue.ts — client-facing verdict/outcome/baseline payload contracts (P0).
//
// These ride the public ROI payload (GET /api/public/roi) and the public workspace view.
// Every number is server-assembled; the client never re-derives the verdict sentence.
import type { OutcomeProvenance } from './outcome-tracking.js';
export type { OutcomeProvenance } from './outcome-tracking.js';

export interface IssueVerdict {
  outcomeNoun: string;            // per-segment, e.g. 'new patients' | 'qualified leads'
  current: number;                // current-period outcome value (count or dollars)
  baseline: number | null;        // same metric at workspace.createdAt; null until baseline exists
  priorPeriod: number | null;     // previous comparable period; null when unavailable
  unit: 'count' | 'dollars';
  sentence: string;               // plain-English, pre-templated server-side
  provenance: OutcomeProvenance;  // 'estimate_ga4' (P0) | 'actual_reconciled' (P1)
}

export interface IssueOutcomeCount {
  units: {
    label: string;                // 'calls' | 'form fills' | 'demos' | …
    current: number;
    baseline: number | null;
    priorPeriod: number | null;
    eventName?: string;           // GA4 key-event backing this unit (P0)
  }[];
  provenance: OutcomeProvenance;
  namedRecordsAvailable: boolean; // false at P0 → render the honest upsell affordance
}

/**
 * Workspace/engagement-start-anchored baseline. Intentionally distinct from the per-action
 * `BaselineSnapshot` in outcome-tracking.ts (which is anchored to `action.created_at`).
 * Do not conflate.
 */
export interface OutcomeBaseline {
  engagementStart: string;            // workspace.createdAt — fixed, never shifts
  baselineConversions: number | null; // earliest snapshot at/after engagementStart; null until enough history
  baselineCapturedAt: string | null;  // ISO of the snapshot used, for "vs. Jan" labeling + audit
  state: 'establishing' | 'ready';
}

/**
 * Backing table: ga4_conversion_snapshots (Task A4).
 * @remarks `rate` is already a percentage (e.g. 6.3 for 6.3%). Do NOT multiply by 100.
 */
export interface Ga4ConversionSnapshot {
  workspaceId: string;
  capturedAt: string;            // ISO; daily cron stamp
  totalConversions: number;
  totalUsers: number;
  byEvent: { eventName: string; conversions: number; users: number; rate: number }[];
}
