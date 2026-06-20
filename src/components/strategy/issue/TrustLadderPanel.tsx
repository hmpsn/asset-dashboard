/**
 * TrustLadderPanel — The Issue (Phase 4, Lane C)
 *
 * Operator-facing trust ladder for per-archetype auto-send. Lists the 2 auto-send-eligible
 * recommendation buckets (quick_win, technical). Each row exposes a teal Toggle (Law 1 —
 * teal=action) that stays DISABLED until the archetype is `earned` (3 consecutive weekly
 * cycles of manual sends). Until earned, a progress caption shows how many cycles remain;
 * once earned, the operator can flip auto-send on so the weekly cron sends that bucket's
 * active recs automatically.
 *
 * Brand-law compliance: teal=action toggle, no purple, no TierGate. Tokens from src/tokens.css.
 * Typography via .t-* utilities.
 */
import { ShieldCheck } from 'lucide-react';
import { SectionCard, Icon, Toggle } from '../../ui';
import { useAutoSendPolicy } from '../../../hooks/admin/useAutoSendPolicy';
import { useFeatureFlag } from '../../../hooks/useFeatureFlag';
import { ARCHETYPE_LABELS } from '../../../../shared/types/strategy-archetype';
import type { AutoSendPolicyRow } from '../../../../shared/types/strategy-autosend';

export interface TrustLadderPanelProps {
  workspaceId: string;
  /** The Issue feature gate. Threaded into the hook's `enabled` arg so flag-OFF makes zero network
   *  calls even if this panel is ever mounted outside the issueOverviewEl gate. Defaults to true to
   *  preserve the in-gate call site (the caller already gates the whole overview on theIssueEnabled). */
  theIssueEnabled?: boolean;
}

/** Caption text for a single archetype row, given its trust state. */
function rowCaption(row: AutoSendPolicyRow, threshold: number): string {
  if (row.earned) {
    return row.enabled
      ? 'Auto-sends each cycle'
      : 'Ready — flip on to automate';
  }
  return `${row.consecutiveCycles}/${threshold} cycles — unlocks when you've sent this bucket ${threshold} weeks running`;
}

/** A single eligible archetype's row: label + caption + earned-gated teal toggle. */
function LadderRow({
  row,
  threshold,
  onToggle,
  isUpdating,
}: {
  row: AutoSendPolicyRow;
  threshold: number;
  onToggle: (enabled: boolean) => void;
  isUpdating: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="t-ui font-medium text-[var(--brand-text-bright)]">
          {ARCHETYPE_LABELS[row.archetype]}
        </div>
        <div
          className={`t-caption-sm mt-0.5 ${
            row.earned ? 'text-[var(--brand-text)]' : 'text-[var(--brand-text-muted)]'
          }`}
        >
          {rowCaption(row, threshold)}
        </div>
      </div>
      <Toggle
        checked={row.enabled}
        onChange={onToggle}
        disabled={!row.earned || isUpdating}
        label={`Auto-send ${ARCHETYPE_LABELS[row.archetype]}`}
        srOnlyLabel
      />
    </div>
  );
}

/**
 * TrustLadderPanel — the operator's per-archetype auto-send control surface.
 *
 * Renders one row per auto-send-eligible archetype. The `theIssueEnabled` prop is threaded into the
 * hook's `enabled` arg, so flag-OFF makes zero network calls even if this panel is mounted outside
 * the issueOverviewEl gate.
 *
 * Blocker 3 (dark-launch): the panel returns `null` unless the OFF-by-default child flag
 * `strategy-trust-ladder-autosend` is on. With it OFF (the default) the auto-send subsystem is inert
 * server-side AND this control surface never renders — there is no way to flip on a feature the cron
 * won't honor. Both hooks (flag + policy) are called UNCONDITIONALLY before any early return
 * (Rules of Hooks); the policy hook's `enabled` arg is additionally gated on the flag so a hidden
 * panel makes zero network calls.
 *
 * Blocker 4 (empty→null): once the flag IS on, the panel still returns `null` when there are no
 * policy rows yet, so a cold workspace shows zero empty SectionCard chrome (mirrors
 * IssueAlsoOnPlanSection).
 */
export function TrustLadderPanel({ workspaceId, theIssueEnabled = true }: TrustLadderPanelProps) {
  const autoSendEnabled = useFeatureFlag('strategy-trust-ladder-autosend');
  const { policies, threshold, isLoading, isError, setEnabled, isUpdating } =
    useAutoSendPolicy(workspaceId, theIssueEnabled && autoSendEnabled);

  // Dark-launch: nothing renders unless the child flag is on (default OFF).
  if (!autoSendEnabled) return null;
  // Empty → null: no eligible buckets yet ⇒ no empty SectionCard on a cold workspace.
  if (!isLoading && !isError && policies.length === 0) return null;

  const titleIcon = <Icon as={ShieldCheck} size="md" className="text-accent-brand" />;

  return (
    <SectionCard title="Trust ladder" titleIcon={titleIcon}>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">
        Earn auto-send for low-risk buckets after {threshold} consecutive cycles of sending them.
      </p>

      {isLoading ? (
        <p className="t-caption-sm text-[var(--brand-text-muted)] py-4 text-center">
          Checking trust progress…
        </p>
      ) : isError ? (
        <p className="t-caption-sm text-red-400/80 py-4 text-center">
          Couldn't load trust progress. It'll retry shortly.
        </p>
      ) : (
        <div className="divide-y divide-[var(--brand-border)]">
          {policies.map((row) => (
            <LadderRow
              key={row.archetype}
              row={row}
              threshold={threshold}
              onToggle={(enabled) => setEnabled(row.archetype, enabled)}
              isUpdating={isUpdating}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
