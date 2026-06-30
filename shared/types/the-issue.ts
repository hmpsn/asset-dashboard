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
  /** Pre-formatted outcome value/basis line (e.g. "USD 800 / new patient · Agency estimate"), or null
   *  when no value is set. The single resolved representation (CLAUDE.md authority-layered-fields) — the
   *  cockpit renders it verbatim instead of reconstructing money from a count/zero stub. Not PII (the
   *  agency's own per-outcome value config, admin-only payload). */
  outcomeValueLabel: string | null;
  segmentConfirmed: boolean;        // admin-confirmed segmentConfig OR deterministic local/multi
  /** Resolved client segment, human-readable (e.g. "b2b saas"). PII-free enum, not identity data. */
  segmentLabel: string;
  eventsPinned: boolean;            // ≥1 pinned eventConfig entry
  eventsTyped: boolean;             // ≥1 pinned event carrying an outcomeType
  webflowConnected: boolean;        // ≥1 webflowFormSources mapping
  conversionTrackingConfirmedAt: string | null;
  lastLeadAt: string | null;        // freshness of captured leads (count-only freshness, no PII)
  povDrafted: boolean;              // Strategy POV exists for the workspace
  /** The provenance the CLIENT number resolves to — computed via the SAME selectOutcomeProvenance +
   *  30-day window path computeROI uses, so the admin Measured/Estimate pill never disagrees with the
   *  client's actual number. NOT a count heuristic. */
  resolvedProvenance: OutcomeProvenance;
  /** Count of gates not yet cleared (drives the admin "N steps left" affordance). One gate PER visible
   *  checklist step (the pin+type pair is a SINGLE gate) so the headline matches the rendered rows. */
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
  outcomeNoun: string;              // resolved segment plural noun
  verdictSentence: string;          // pre-templated dollar verdict (client never re-derives)
  estimatedValue: number;
  /** Provenance-resolved money string (banded `~$` for estimate_ga4/measured_action, exact `$` for
   *  actual_reconciled). The renderer prints this verbatim — gate D. Never re-format estimatedValue
   *  downstream. */
  estimatedValueLabel: string;
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

/**
 * P1c — weekly email return-hook digest. Assembled server-side by the weekly cron; consolidates the
 * three "worth returning for" signals into ONE email. Each section is null when it has no content;
 * `hasContent` is the send gate (the cron sends ONLY when at least one section is non-null). The
 * recipient is the client's OWN contact (workspace.clientEmail), so lead names (their own customers)
 * are intentionally present here — distinct from the PII-free public ROI/count path (D7).
 */
export interface ReturnHookLeadSection {
  count: number;            // leads captured in the 7-day window
  recentNames: string[];    // up to 3 most-recent lead display names (leadName ?? leadEmail ?? '—')
  outcomeNoun: string;      // resolved segment plural noun ("new patients" | "qualified leads" | …)
}
export interface ReturnHookMoneySection {
  estimatedValue: number;       // verdict.estimatedValue (measured_action only)
  sinceStartDelta: number | null; // verdict.baselineDeltaCount — the "since we started" frame
  outcomeNoun: string;          // segment plural noun (self-contained section framing)
}
export interface ReturnHookDecisionSection {
  pendingCount: number;     // client actions + approval batches still awaiting the client
}
export interface ReturnHookDigest {
  workspaceId: string;
  leads: ReturnHookLeadSection | null;
  money: ReturnHookMoneySection | null;
  decision: ReturnHookDecisionSection | null;
  /** true when ≥1 section is non-null — the cron only sends (and only stamps the week) when true. */
  hasContent: boolean;
}
