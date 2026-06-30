/**
 * IssueHeader — page chrome for "The Issue" admin cockpit (Phase 1 integration).
 *
 * Composes:
 *   - PageHeader (title + freshness subtitle + actions slot)
 *   - A "Send issue" PRIMARY action that fires the EXISTING atomic bulk-send route
 *     (POST /api/recommendations/:ws/bulk, action:'send') — the orchestrator wires the
 *     `useRecBulkMutation` hook and passes `onSendIssue` + `isSending` in. No new endpoint.
 *   - The existing StrategyConfigPanel mounted as page chrome, ABOVE the interior tabs
 *     (resolves walkthrough [1] — config is page chrome, not a tab-buried section).
 *
 * Presentational by design: the orchestrator owns all data/mutations and injects them as
 * props, so this component re-uses the cockpit's already-wired bulk-send hook rather than
 * inventing a parallel send path.
 *
 * Tokens: src/tokens.css only. Typography: .t-* utilities. UI primitives only (Button /
 * PageHeader) — no hand-rolled native controls. Color law: teal=action (Send issue). No purple.
 * Only mounts under the strategy-the-issue flag — byte-identical OFF.
 *
 * Phase 2: preview-as-client returns once TheIssueClientPage exists (the toggle had no client
 * preview surface to switch to in Phase 1, so it was removed as a dead control).
 */
import type { ReactNode } from 'react';
import { Target, Send } from 'lucide-react';
import { PageHeader, Icon, Button } from '../../ui';
import { StrategyConfigPanel, type StrategyConfigPanelProps } from '../StrategyConfigPanel';

export interface IssueHeaderProps {
  /** Freshness subtitle (e.g. "Generated 12 Jun · 48 pages mapped"). */
  subtitle: string;
  /**
   * Fires the existing atomic bulk-send route. The orchestrator binds this to
   * useRecBulkMutation({ action: 'send', recIds: [...] }) — DO NOT add a new endpoint here.
   */
  onSendIssue: () => void;
  /** True while the bulk send is in flight (disables + spins the Send issue button). */
  isSending: boolean;
  /** Disable Send issue when there are no curated/active moves to send. */
  canSend: boolean;
  /**
   * Config-panel props (the existing StrategyConfigPanel) mounted as page chrome below the
   * header. Forwarded verbatim from the orchestrator's StrategySettings wiring.
   */
  configPanelProps: StrategyConfigPanelProps;
  /**
   * Blocker 5 live counter (the ONE canonical send surface). N = staged (sendableRecIds.length),
   * M = already with client (curated set via the shared isCuratedForClient predicate). Both derive
   * from the orchestrator's single rec set, so numerator and denominator share a source. Shown
   * beside the Send-issue button; M=curatedCount also drives the all-curated disabled reason.
   */
  stagedCount: number;
  curatedCount: number;
  /**
   * The strategy Generate/Regenerate control cluster (StrategyHeaderActions), forwarded
   * verbatim from the orchestrator. "The Issue" suppresses the base PageHeader (which used
   * to host it), so it is rendered here beside Send issue — regenerate the strategy on the
   * left, send it on the right. Omitted (renders nothing) in states with no generate action.
   */
  regenerateActions?: ReactNode;
}

export function IssueHeader({
  subtitle,
  onSendIssue,
  isSending,
  canSend,
  configPanelProps,
  stagedCount,
  curatedCount,
  regenerateActions,
}: IssueHeaderProps) {
  // Inline visible disabled reason (NOT a tooltip) — a11y: wired to the button via aria-describedby.
  // staged===0 with nothing curated yet vs everything-curated produce different copy.
  const disabledReason = canSend
    ? null
    : curatedCount > 0
      ? 'Everything curated is already with your client.'
      : 'Stage moves below to send.';

  return (
    <div className="space-y-6">
      <PageHeader
        title="The Issue"
        subtitle={subtitle}
        icon={<Icon as={Target} size="lg" className="text-accent-brand" />}
        actions={
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-3 flex-wrap justify-end">
              {/* Strategy generate/regenerate cluster — restored here because "The Issue"
                  suppresses the base PageHeader that used to host it. */}
              {regenerateActions}
              {/* Live counter beside the single commit button (numerator/denominator share a source). */}
              <span className="t-caption-sm text-[var(--brand-text-muted)] tabular-nums whitespace-nowrap">
                {stagedCount} staged · {curatedCount} already with client
              </span>
              <Button
                variant="primary"
                size="md"
                icon={Send}
                loading={isSending}
                disabled={!canSend}
                aria-disabled={!canSend}
                aria-describedby={disabledReason ? 'send-issue-disabled-reason' : undefined}
                onClick={onSendIssue}
              >
                Send issue
              </Button>
            </div>
            {disabledReason && (
              <span
                id="send-issue-disabled-reason"
                className="t-caption-sm text-[var(--brand-text-muted)]"
              >
                {disabledReason}
              </span>
            )}
          </div>
        }
      />

      {/* Config as page chrome — ABOVE the interior tabs (walkthrough [1]). */}
      <StrategyConfigPanel {...configPanelProps} />
    </div>
  );
}
