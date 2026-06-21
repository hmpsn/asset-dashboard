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
import { getFormCaptureStatus } from './form-submissions.js';
import { getStrategyPovHash } from './strategy-pov-store.js';
import type { SetupReadinessState } from '../shared/types/the-issue.js';

/**
 * Assemble the admin setup-readiness rollup for a workspace, or null when the workspace is missing.
 */
export function assembleSetupReadiness(workspaceId: string): SetupReadinessState | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;

  const ga4Connected = !!ws.ga4PropertyId;
  const valueSet = !!ws.outcomeValue;
  const basisOfValue = ws.outcomeValue?.basis ?? null;

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

  // POV existence — cheap hash read (no full POV materialization).
  const povDrafted = getStrategyPovHash(ws.id) !== null;

  const requiredGates = [
    ga4Connected,
    valueSet,
    segmentConfirmed,
    eventsPinned,
    eventsTyped,
    webflowConnected,
    povDrafted,
  ];
  const openGapCount = requiredGates.filter((cleared) => !cleared).length;

  return {
    ga4Connected,
    valueSet,
    basisOfValue,
    segmentConfirmed,
    eventsPinned,
    eventsTyped,
    webflowConnected,
    conversionTrackingConfirmedAt,
    lastLeadAt,
    povDrafted,
    openGapCount,
  };
}
