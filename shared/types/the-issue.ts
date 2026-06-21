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

/**
 * Website-native high-intent action categories (P1a). 'other' is the honest fallback for any
 * pinned event the admin has not mapped to a known type — never silently dropped.
 */
export type OutcomeType =
  | 'form_fill' | 'call' | 'booking' | 'email' | 'directions' | 'chat' | 'other';

export interface OutcomeTypeBreakdown {
  outcomeType: OutcomeType;
  label: string;
  current: number;
  baseline: number | null;
  priorPeriod: number | null;
}

export interface IssueOutcomeCount {
  units: {
    label: string;                // 'calls' | 'form fills' | 'demos' | …
    current: number;
    baseline: number | null;
    priorPeriod: number | null;
    eventName?: string;           // GA4 key-event backing this unit (P0)
    outcomeType?: OutcomeType;    // P1a: which website action this unit measures
  }[];
  /** P1a: typed rollup ("23 form fills + 41 calls"). Empty when no events carry an outcomeType. */
  byType: OutcomeTypeBreakdown[];
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

/**
 * P1b — admin setup-readiness rollup. Each signal is a ✓/⚠ gate the operator must clear to
 * produce a trustworthy outcome verdict. PII-FREE: counts + booleans + timestamps only (D7).
 * Backed by assembleSetupReadiness (server/the-issue-readiness.ts). Rides the ADMIN
 * conversion-tracking-status endpoint (requireWorkspaceAccess), never the public payload.
 */
export interface SetupReadinessState {
  ga4Connected: boolean;            // workspace.ga4PropertyId present
  valueSet: boolean;                // workspace.outcomeValue present
  basisOfValue: 'client_provided' | 'agency_estimate' | 'ai_enriched' | null;
  segmentConfirmed: boolean;        // admin-confirmed segmentConfig OR deterministic local/multi
  eventsPinned: boolean;            // ≥1 pinned eventConfig entry
  eventsTyped: boolean;             // ≥1 pinned event carrying an outcomeType
  webflowConnected: boolean;        // ≥1 webflowFormSources mapping
  conversionTrackingConfirmedAt: string | null;
  lastLeadAt: string | null;        // freshness of captured leads (count-only freshness, no PII)
  povDrafted: boolean;              // Strategy POV exists for the workspace
  /** Count of gates not yet cleared (drives the admin "N steps left" affordance). */
  openGapCount: number;
}

/**
 * P1b — named-lead view. Admin reads (requireWorkspaceAccess) and the client's OWN-leads read
 * (requireAuthenticatedClientPortalAuth) BOTH return this shape — the guard, not the shape,
 * enforces the boundary. NEVER public/unauthed (D7). leadMessage stays admin-internal (omitted).
 */
export interface NamedLeadView {
  id: string;
  formName: string;
  leadName: string | null;
  leadEmail: string | null;
  outcomeType: OutcomeType;
  submittedAt: string;
}

/**
 * P1b — the forwardable one-pager export payload (the "zero-edit board summary"). Assembled
 * server-side from computeROI().outcomeVerdict + curated top-moves + the segment exportProfile.
 * Carries NO PII (lead names ride the separate NamedLeadView reads, embedded by the renderer
 * only on the authed surface). NEVER on the public unauthed payload (D7).
 */
export interface OnePagerExportPayload {
  exportProfile: 'sms_recap' | 'board_one_pager' | 'partner_summary' | 'owner_portfolio';
  workspaceName: string;
  brandLogoUrl: string | null;
  outcomeNoun: string;              // resolved segment plural noun
  verdictSentence: string;          // pre-templated dollar verdict (client never re-derives)
  estimatedValue: number;
  monthlyRetainer: number | null;
  adSpendEquivalent: number;        // from ROIData.adSpendEquivalent
  valueVsRetainerRatio: number | null; // estimatedValue / monthlyRetainer, null when no retainer
  outcomeCount: number;
  outcomeUnitLabel: string;
  outcomeCountSinceStart: number | null; // baselineDeltaCount — the "since we started" frame
  baselineCapturedAt: string | null;
  outcomeTypeBreakdown: OutcomeTypeBreakdown[];
  topMoves: { title: string; estimatedGain: string }[]; // curated, client-safe (NO EMV/value)
  methodologyLine: string;          // provenance-aware honesty line
  provenance: OutcomeProvenance;
  /** Present ONLY when the renderer is fed leads on the authed surface; PII is the client's own. */
  leads?: NamedLeadView[];
  generatedAt: string;              // ISO
}
