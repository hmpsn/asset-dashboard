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
}

export function IssueHeader({
  subtitle,
  onSendIssue,
  isSending,
  canSend,
  configPanelProps,
}: IssueHeaderProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="The Issue"
        subtitle={subtitle}
        icon={<Icon as={Target} size="lg" className="text-accent-brand" />}
        actions={
          <Button
            variant="primary"
            size="md"
            icon={Send}
            loading={isSending}
            disabled={!canSend}
            onClick={onSendIssue}
          >
            Send issue
          </Button>
        }
      />

      {/* Config as page chrome — ABOVE the interior tabs (walkthrough [1]). */}
      <StrategyConfigPanel {...configPanelProps} />
    </div>
  );
}
