/**
 * HubKeywordRowMeta — the renderKeywordMeta slot for HubKeywordList (P1-T3).
 *
 * Renders below the keyword text inside the KeywordTable keyword cell:
 *   - <StatusBadge domain="keyword-command-center"> for row.lifecycleStatus
 *   - a blue "From gap" Badge when row.tracking.sourceGapKey is defined (truthy)
 *   - a teal "Auto-managed" Badge when row.tracking.strategyOwned === true
 *
 * Four Laws of Color:
 *   - lifecycle status → StatusBadge (platform-canonical colors per domain config)
 *   - sourceGapKey → blue (data badge — read-only provenance)
 *   - strategyOwned === true → teal (action/managed state)
 *
 * THREE-STATE GUARD: strategyOwned is a three-state boolean (true/false/undefined).
 * Only === true shows "Auto-managed". Both false and undefined omit it.
 * Using truthiness (if strategyOwned) would be a bug — coercing undefined→false
 * mislabels pre-reconcile rows as "explicitly not owned".
 */
import { Badge } from '../ui/Badge';
import { StatusBadge } from '../ui/StatusBadge';
import type { KeywordCommandCenterRow } from '../../../shared/types/keyword-command-center';

export interface HubKeywordRowMetaProps {
  row: KeywordCommandCenterRow;
}

export function HubKeywordRowMeta({ row }: HubKeywordRowMetaProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 mt-0.5">
      {/* Lifecycle status badge — platform-canonical colors via StatusBadge domain config */}
      <StatusBadge
        domain="keyword-command-center"
        status={row.lifecycleStatus}
        size="sm"
        variant="outline"
      />

      {/* From gap — blue (data: read-only provenance pointer) */}
      {row.tracking.sourceGapKey ? (
        <Badge label="From gap" tone="blue" variant="soft" size="sm" />
      ) : null}

      {/* Auto-managed — teal (action: managed by reconciler strategy).
          THREE-STATE: must be === true, not truthy.
          strategyOwned false → explicitly not owned (omit badge).
          strategyOwned undefined → ownership unknown, pre-reconcile (omit badge). */}
      {row.tracking.strategyOwned === true ? (
        <Badge label="Auto-managed" tone="teal" variant="soft" size="sm" />
      ) : null}
    </div>
  );
}
