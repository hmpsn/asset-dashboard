/**
 * The Issue (Client) P1b — admin setup-readiness assembler (Lane A, A2).
 *
 * assembleSetupReadiness reads the per-workspace config signals into a PII-FREE ✓/⚠ gate rollup
 * that earns a trustworthy outcome verdict. Each gate maps to a one-click gap-fix surface in the
 * admin cockpit (Lane B). Pure read-only — no DB writes, no broadcast, no AI.
 *
 * Bounded context: analytics-intelligence / The Issue (sibling to server/the-issue-outcome.ts).
 *
 * D7: the rollup is counts + booleans + timestamps only. Lead identity (leadName/leadEmail/
 * leadMessage) is NEVER read into or serialized out of this shape — `lastLeadAt` is freshness only,
 * sourced from the count/freshness helper (getFormCaptureStatus), never from a PII row read.
 */
import { getWorkspace, resolveSegmentProfile } from './workspaces.js';
import { getFormCaptureStatus, countFormSubmissions } from './form-submissions.js';
import { getStrategyPovHash } from './strategy-pov-store.js';
import { loadGa4SnapshotHistory } from './ga4-snapshots.js';
import { selectOutcomeProvenance } from './the-issue-outcome.js';
import type { SetupReadinessState } from '../shared/types/the-issue.js';
import type { OutcomeProvenance } from '../shared/types/outcome-tracking.js';

/** Server-side mirror of the readout's basis label (IssueSetupReadiness.basisLabelFor) — keeps the
 *  pre-formatted outcomeValueLabel in lockstep with how the value/basis row reads. */
function basisLabelFor(basis: SetupReadinessState['basisOfValue']): string {
  switch (basis) {
    case 'client_provided': return 'Client provided';
    case 'agency_estimate': return 'Agency estimate';
    case 'ai_enriched': return 'AI enriched';
    default: return 'Set';
  }
}

/**
 * Assemble the admin setup-readiness rollup for a workspace, or null when the workspace is missing.
 */
export function assembleSetupReadiness(workspaceId: string): SetupReadinessState | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;

  const ga4Connected = !!ws.ga4PropertyId;
  const valueSet = !!ws.outcomeValue;
  const basisOfValue = ws.outcomeValue?.basis ?? null;
  // Pre-formatted value/basis line — the single resolved representation the cockpit renders verbatim
  // (matches ConversionTrackingReadout's `${currency} ${value} / ${unit} · ${basis}` exactly). Not PII.
  const outcomeValueLabel = ws.outcomeValue
    ? `${ws.outcomeValue.currency} ${ws.outcomeValue.valuePerOutcome.toLocaleString()} / ${ws.outcomeValue.unitLabel} · ${basisLabelFor(ws.outcomeValue.basis)}`
    : null;

  const pinned = (ws.eventConfig ?? []).filter((c) => c.pinned);
  const eventsPinned = pinned.length > 0;
  const eventsTyped = pinned.some((c) => !!c.outcomeType);

  const webflowConnected = (ws.webflowFormSources?.length ?? 0) > 0;
  const conversionTrackingConfirmedAt = ws.conversionTrackingConfirmedAt ?? null;

  // Freshness only — getFormCaptureStatus returns { count, lastSubmissionAt }, never PII.
  const lastLeadAt = getFormCaptureStatus(ws.id).lastSubmissionAt;

  // Segment is confirmed when the deterministic local/multi axis fires (≥1 location → the resolved
  // segment is local_smb/multi_location) OR an admin explicitly confirmed the non-local 3-way via
  // segmentConfig. resolveSegmentProfile owns the location read (do not re-implement it inline).
  const resolved = resolveSegmentProfile(ws);
  const deterministicSegment = resolved.segment === 'local_smb' || resolved.segment === 'multi_location';
  const segmentConfirmed = !!ws.segmentConfig || deterministicSegment;
  // Human-readable resolved segment (PII-free enum) — the cockpit renders this instead of a hardcoded "—".
  const segmentLabel = resolved.segment.replace(/_/g, ' ');

  // POV existence — cheap hash read (no full POV materialization).
  const povDrafted = getStrategyPovHash(ws.id) !== null;

  // Resolved provenance — the provenance the CLIENT number resolves to. Mirror computeROI's period
  // window (roi.ts: 30 days ending at the latest snapshot) and call the SAME selectOutcomeProvenance,
  // WITHOUT calling computeROI (which writes a snapshot; this assembler is pure-read). estimate_ga4
  // when no snapshot exists (computeROI hydrates no verdict then either), so admin pill == client number.
  let resolvedProvenance: OutcomeProvenance = 'estimate_ga4';
  const history = loadGa4SnapshotHistory(ws.id);
  const latest = history.length > 0 ? history[history.length - 1] : null;
  if (latest) {
    const periodEnd = latest.capturedAt.slice(0, 10);
    const periodStartMs = new Date(latest.capturedAt).getTime() - 30 * 24 * 60 * 60 * 1000;
    const periodFormCount = countFormSubmissions(ws.id, {
      startDate: new Date(periodStartMs).toISOString().slice(0, 10),
      endDate: periodEnd,
    });
    resolvedProvenance = selectOutcomeProvenance(ws, periodFormCount);
  }

  // One gate PER visible checklist step (IssueSetupReadiness renders 6 steps). The pin+type pair is a
  // SINGLE gate (the "pin & type" step), so "N steps left" matches the rendered rows — counting
  // eventsPinned and eventsTyped separately would over-count by 1 whenever events are unconfigured.
  const eventsConfigured = eventsPinned && eventsTyped;
  const requiredGates = [
    ga4Connected,
    valueSet,
    segmentConfirmed,
    eventsConfigured,
    webflowConnected,
    povDrafted,
  ];
  const openGapCount = requiredGates.filter((cleared) => !cleared).length;

  return {
    ga4Connected,
    valueSet,
    basisOfValue,
    outcomeValueLabel,
    segmentConfirmed,
    segmentLabel,
    eventsPinned,
    eventsTyped,
    webflowConnected,
    conversionTrackingConfirmedAt,
    lastLeadAt,
    povDrafted,
    resolvedProvenance,
    openGapCount,
  };
}
