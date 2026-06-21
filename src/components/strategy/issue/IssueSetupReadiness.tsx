/**
 * IssueSetupReadiness — The Issue (Client) P1b admin setup-readiness checklist (Lane B, consumes A4).
 *
 * The integrity guard that earns a trustworthy outcome verdict: a per-client ✓/⚠ rollup of the
 * SetupReadinessState signals (ga4Connected · valueSet · segmentConfirmed · eventsPinned ·
 * eventsTyped · webflowConnected · povDrafted), with an "N steps left" headline. Each open gap is a
 * ONE-CLICK deep-link to its fix surface (workspace-settings ?tab=connections|dashboard) honoring
 * the ?tab= two-halves contract (the WorkspaceSettings receiver reads `tab` from useSearchParams).
 *
 * In-product, not a static doc (DR-2). Re-mounts the reusable ConversionTrackingReadout (props-only)
 * for the integrity rows + provenance pill + the deep-linkable step list. No purple (admin AI only).
 */
import { useNavigate } from 'react-router-dom';
import { ConversionTrackingReadout, type ConversionSetupStep } from '../../settings/ConversionTrackingReadout';
import { adminPath } from '../../../routes';
import type { SetupReadinessState } from '../../../../shared/types/the-issue';
import type { ConversionTrackingStatus } from '../../../api/conversionTracking';

export interface IssueSetupReadinessProps {
  workspaceId: string;
  /** The PII-free ✓/⚠ rollup (server-assembled, A4). Carries the resolved segmentLabel, resolved
   *  provenance, and pre-formatted outcomeValueLabel — the cockpit renders these verbatim (no stubs). */
  readiness: SetupReadinessState;
  /** The admin conversion-tracking status (counts + freshness) — feeds the integrity rows. */
  status: ConversionTrackingStatus | undefined;
  /** Whether the underlying status query is still loading. */
  loading?: boolean;
}

export function IssueSetupReadiness({
  workspaceId,
  readiness,
  status,
  loading = false,
}: IssueSetupReadinessProps) {
  const navigate = useNavigate();
  // Deep-link target helpers — the ?tab= two-halves contract is satisfied by WorkspaceSettings,
  // which initializes its tab from useSearchParams('tab'). All ids below are valid SectionTab values.
  const goConnections = () => navigate(adminPath(workspaceId, 'workspace-settings') + '?tab=connections');
  const goDashboard = () => navigate(adminPath(workspaceId, 'workspace-settings') + '?tab=dashboard');

  // Build the deep-linkable steps from the readiness gates. An incomplete step carrying onClick
  // renders as a one-click deep-link button; a completed step renders as a static done-state row.
  // POV has no Settings surface (it's edited on this cockpit) → no onClick (operator is already here).
  const steps: ConversionSetupStep[] = [
    {
      id: 'ga4',
      label: 'Connect Google Analytics',
      description: 'Link a GA4 property so we can read the events behind the client’s number.',
      completed: readiness.ga4Connected,
      onClick: readiness.ga4Connected ? undefined : goConnections,
    },
    {
      id: 'value',
      label: 'Set the outcome value',
      description: 'Assign a dollar value per outcome so the verdict reads in money, not just counts.',
      completed: readiness.valueSet,
      onClick: readiness.valueSet ? undefined : goDashboard,
    },
    {
      id: 'segment',
      label: 'Confirm the client segment',
      description: 'Confirm the segment so the outcome noun and export framing match the business.',
      completed: readiness.segmentConfirmed,
      onClick: readiness.segmentConfirmed ? undefined : goDashboard,
    },
    {
      id: 'pin-type',
      label: 'Pin & type the key conversions',
      description: 'Pin the GA4 events that matter and map each to a lead type.',
      completed: readiness.eventsPinned && readiness.eventsTyped,
      onClick: readiness.eventsPinned && readiness.eventsTyped ? undefined : goDashboard,
    },
    {
      id: 'connect-webflow',
      label: 'Connect Webflow forms',
      description: 'Select which Webflow forms produce leads so capture turns the number measured.',
      completed: readiness.webflowConnected,
      onClick: readiness.webflowConnected ? undefined : goDashboard,
    },
    {
      id: 'draft-pov',
      label: 'Draft the strategy point of view',
      description: 'A drafted POV anchors the client narrative around the measured outcome.',
      completed: readiness.povDrafted,
      // No Settings surface — the POV editor lives on this cockpit; no deep-link.
    },
  ];

  return (
    // data-p1b-readiness — Lane D flag-OFF DOM-probe hook; this whole subtree is absent when the
    // measured-capture flag is OFF (gated at the cockpit mount), so the cockpit stays byte-identical.
    <div data-p1b-readiness className="space-y-2">
      {/* Open-gap headline — the "N steps left" affordance. Config chrome the operator sees first. */}
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          What earns this client a measured number
        </p>
        {readiness.openGapCount > 0 ? (
          <span className="t-caption-sm font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] badge-span-ok border bg-amber-500/10 text-amber-400 border-amber-500/20">
            {readiness.openGapCount} step{readiness.openGapCount === 1 ? '' : 's'} left
          </span>
        ) : (
          <span className="t-caption-sm font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] badge-span-ok border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
            Setup complete
          </span>
        )}
      </div>
      <ConversionTrackingReadout
        outcomeValue={null}
        outcomeValueLabel={readiness.outcomeValueLabel}
        segmentLabel={readiness.segmentLabel}
        pinnedCount={status?.pinnedCount ?? 0}
        typedCount={status?.typedCount ?? 0}
        formCaptureConnected={status?.formCaptureConnected ?? readiness.webflowConnected}
        lastSubmissionAt={status?.lastSubmissionAt ?? readiness.lastLeadAt}
        submissionCount={status?.submissionCount ?? 0}
        resolvedProvenance={readiness.resolvedProvenance}
        steps={steps}
        loading={loading}
      />
    </div>
  );
}
