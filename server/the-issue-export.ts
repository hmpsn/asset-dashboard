/**
 * The Issue (Client) P1b — one-pager export-data assembler (Lane A, A3).
 *
 * assembleOnePagerExport builds the forwardable one-pager DATA payload (OnePagerExportPayload) from
 * computeROI().outcomeVerdict + the segment exportProfile + curated client-safe top-moves. This is
 * structured DATA only — the print-from-browser HTML is rendered separately (renderOnePagerHTML in
 * server/the-issue-one-pager-html.ts). There is NO PDF library (DR-4); the client browser prints.
 *
 * D7: the payload carries NO PII. `leads` is left undefined here — NamedLeadView[] attaches only on
 * the authed surface (the route in server/routes/the-issue-export.ts, via toNamedLeadView).
 *
 * Honest degradation: returns null when no verdict is established (flag OFF, outcomeValue unset, or no
 * GA4 snapshot) — inherits computeROI()'s flag/outcomeValue gating. Never fabricates a number.
 */
import { getWorkspace, resolveSegmentProfile } from './workspaces.js';
import { computeROI } from './roi.js';
import { loadRecommendations, isCuratedForClient } from './recommendations.js';
import type { FormSubmission } from '../shared/types/form-submission.js';
import type { NamedLeadView, OnePagerExportPayload } from '../shared/types/the-issue.js';
import type { OutcomeProvenance } from '../shared/types/outcome-tracking.js';
import { formatOutcomeMoney } from '../shared/format-money.js';

const DEFAULT_EXPORT_PROFILE = 'board_one_pager' as const;

/**
 * Shared lockstep mapper: FormSubmission → NamedLeadView. Used by the admin route (A5) and the
 * client own-leads route (A6) so a field drop fails one mapper, not silently across two routes.
 * leadMessage is admin-internal and deliberately omitted from the list view (DR-3 / Name Reconciliation).
 */
export function toNamedLeadView(s: FormSubmission): NamedLeadView {
  return {
    id: s.id,
    formName: s.formName,
    leadName: s.leadName,
    leadEmail: s.leadEmail,
    outcomeType: s.outcomeType,
    submittedAt: s.submittedAt,
  };
}

/** Provenance-aware honesty line (the methodology footer). */
function methodologyLineFor(provenance: OutcomeProvenance): string {
  switch (provenance) {
    case 'measured_action':
      return 'Counts are website-native measured outcomes captured from your forms and tracked events.';
    case 'actual_reconciled':
      return 'Counts are reconciled against your call-tracking and CRM closed-won records.';
    case 'estimate_ga4':
    default:
      return 'Counts are estimated from GA4 key events; named-lead capture sharpens this as it accrues.';
  }
}

/**
 * Assemble the one-pager export DATA payload for a workspace, or null when no verdict is established.
 */
export function assembleOnePagerExport(workspaceId: string): OnePagerExportPayload | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;

  const roi = computeROI(workspaceId);
  if (!roi || !roi.outcomeVerdict) return null;
  const verdict = roi.outcomeVerdict;

  const seg = resolveSegmentProfile(ws);
  const exportProfile = seg.exportProfile ?? DEFAULT_EXPORT_PROFILE;
  const outcomeNoun = seg.outcomeNounPlural;

  const estimatedValue = verdict.estimatedValue;
  const monthlyRetainer = verdict.monthlyRetainer;
  const valueVsRetainerRatio =
    monthlyRetainer && monthlyRetainer > 0 ? estimatedValue / monthlyRetainer : null;

  // Curated, client-safe top moves — title + estimatedGain ONLY (never opportunity.value / EMV).
  const recSet = loadRecommendations(workspaceId);
  const topMoves = (recSet?.recommendations ?? [])
    .filter(isCuratedForClient)
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 3)
    .map((r) => ({ title: r.title, estimatedGain: r.estimatedGain }));

  // Gate D: band the dollar UNLESS actual_reconciled (estimate_ga4 + measured_action are count ×
  // estimated rate). The `~$` already conveys approximation, so the sentence drops the `≈` hedge;
  // reconciled is exact with no hedge. Single-source banding via shared/format-money.ts.
  const estimatedValueLabel = formatOutcomeMoney(estimatedValue, verdict.provenance);

  const verdictSentence = monthlyRetainer
    ? `${verdict.outcomeCount} ${outcomeNoun} = ${estimatedValueLabel} in value vs. a $${monthlyRetainer.toLocaleString('en-US')} retainer`
    : `${verdict.outcomeCount} ${outcomeNoun} = ${estimatedValueLabel} in value`;

  return {
    exportProfile,
    workspaceName: ws.name,
    outcomeNoun,
    verdictSentence,
    estimatedValue,
    estimatedValueLabel,
    monthlyRetainer,
    adSpendEquivalent: roi.adSpendEquivalent,
    valueVsRetainerRatio,
    outcomeCount: verdict.outcomeCount,
    outcomeUnitLabel: verdict.outcomeUnitLabel,
    outcomeCountSinceStart: verdict.baselineDeltaCount,
    baselineCapturedAt: verdict.baseline.baselineCapturedAt,
    outcomeTypeBreakdown: verdict.outcomeTypeBreakdown ?? [],
    topMoves,
    methodologyLine: methodologyLineFor(verdict.provenance),
    provenance: verdict.provenance,
    // NO PII — leads attach at the route on the authed surface only.
    generatedAt: new Date().toISOString(),
  };
}
