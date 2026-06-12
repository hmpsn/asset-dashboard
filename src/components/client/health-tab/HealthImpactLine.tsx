/**
 * HealthImpactLine — shows a conservative monthly organic-value range for a
 * fix, derived from the server's banded emvPerWeek projection (D-IMPACT).
 *
 * Renders nothing when `impactBand` is absent or `monthlyRangeUsd` is absent
 * (below the display floor — the server omits the field rather than sending zero).
 *
 * The ROI methodology popover reuses the same `<details>` / `<summary>` pattern
 * as `ROIMethodologyDisclosure` in `ROIDashboard.tsx` so the methodology
 * explanation is consistent across the dashboard.
 */
import { ChevronDown, Info } from 'lucide-react';
import { Icon } from '../../ui/Icon';
import type { ImpactBand } from '../../../../shared/types/fix-catalog.js';

interface HealthImpactLineProps {
  impactBand: ImpactBand | undefined;
}

export function HealthImpactLine({ impactBand }: HealthImpactLineProps) {
  if (!impactBand?.monthlyRangeUsd) return null;

  const [lo, hi] = impactBand.monthlyRangeUsd;
  const rangeText = lo === hi ? `~$${lo}/mo` : `~$${lo}–$${hi}/mo`;

  return (
    <details
      data-testid="health-impact-line"
      className="group"
      onClick={(e) => e.stopPropagation()}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-[var(--radius-sm)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 [&::-webkit-details-marker]:hidden">
        <span className="t-caption-sm text-accent-info">
          Est. {rangeText} organic value at stake
        </span>
        <Icon
          as={Info}
          size="sm"
          className="text-accent-info flex-shrink-0"
          aria-label="How we calculate impact estimates"
        />
        <Icon
          as={ChevronDown}
          size="sm"
          className="text-[var(--brand-text-muted)] transition-transform group-open:rotate-180"
        />
      </summary>

      <div
        data-testid="health-impact-methodology"
        className="mt-2 rounded-[var(--radius-lg)] border border-blue-500/20 bg-blue-500/5 px-3 py-2 space-y-1.5"
      >
        <p className="t-caption-sm font-medium text-[var(--brand-text-bright)]">How we calculate impact estimates</p>
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          Each range is derived from estimated weekly organic value (clicks × keyword cost-per-click)
          scaled to a monthly view and rounded to a conservative band. We use the lower end of
          industry click-through curves to avoid over-promising.
        </p>
        <p className="t-caption-sm text-[var(--brand-text-muted)]">
          These are directional estimates, not revenue guarantees — actual results depend on
          your site, competition, and content quality.
        </p>
      </div>
    </details>
  );
}
