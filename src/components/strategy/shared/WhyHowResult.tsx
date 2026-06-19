/**
 * WhyHowResult — shared presenter for the why → how → projected-result triad.
 *
 * Compact mode (default): renders only the Why line (one-line, data-anchored from
 * `insight` / `description` / `rationale` / `competitorProof` in priority order).
 *
 * Expanded mode (`expanded={true}`): renders all three tiers:
 *   Why   — one-line insight (same source priority as compact)
 *   How   — the primary action label (from `howLabel` prop)
 *   Result — `estimatedGain` as a blue data badge (design law: blue for data)
 *             OR `impactBand` rendered as emerald (high/medium) / amber (low)
 *             ONLY when `estimatedGain` is absent/empty.
 *
 * Never renders an empty tier or "undefined est." — each tier renders only when
 * it has real content to display.
 *
 * sendable gate: export helper `isSendable(props)` → true when `insight` is
 * non-empty AND either `estimatedGain` or `impactBand` resolves to a displayable
 * value. The send button in consumer components uses this gate to stay disabled
 * until both the why and result are present.
 */
import type { ImpactBand } from '../../../../shared/types/fix-catalog.js';
import { Badge } from '../../ui';

// ── Types ─────────────────────────────────────────────────────────

export interface WhyHowResultProps {
  /**
   * Primary "why this matters" text (highest priority source for the Why line).
   * Falls through to `description`, `rationale`, `competitorProof` in that order.
   */
  insight?: string;
  description?: string;
  rationale?: string;
  competitorProof?: string;

  /** Shown as the How line in expanded mode. e.g. "Refresh content brief" */
  howLabel?: string;

  /**
   * Human-readable projected gain (e.g. "+~340 clicks/mo"). Renders as a blue
   * data badge — the primary Result display.
   */
  estimatedGain?: string;

  /**
   * Client-safe banded impact (low/medium/high). Rendered as emerald/amber ONLY
   * when `estimatedGain` is absent or empty.
   */
  impactBand?: ImpactBand;

  /** When true renders all three tiers; compact (default) shows Why only. */
  expanded?: boolean;

  /** Additional className on the root element. */
  className?: string;
}

// ── sendable gate ─────────────────────────────────────────────────

/**
 * Returns true when the send button should be enabled:
 * - insight (or fallback) is non-empty
 * - AND the Result tier has displayable data (estimatedGain OR impactBand)
 */
export function isSendable(props: Pick<WhyHowResultProps, 'insight' | 'description' | 'rationale' | 'competitorProof' | 'estimatedGain' | 'impactBand'>): boolean {
  const whyText = resolveWhy(props);
  if (!whyText) return false;
  return !!resolveResult(props);
}

// ── Internal helpers ──────────────────────────────────────────────

function resolveWhy(
  props: Pick<WhyHowResultProps, 'insight' | 'description' | 'rationale' | 'competitorProof'>
): string {
  return (
    props.insight?.trim() ||
    props.description?.trim() ||
    props.rationale?.trim() ||
    props.competitorProof?.trim() ||
    ''
  );
}

type ResolvedResult =
  | { kind: 'gain'; label: string }
  | { kind: 'band'; band: 'high' | 'medium' | 'low'; label: string };

function resolveResult(
  props: Pick<WhyHowResultProps, 'estimatedGain' | 'impactBand'>
): ResolvedResult | null {
  if (props.estimatedGain?.trim()) {
    return { kind: 'gain', label: props.estimatedGain.trim() };
  }
  if (props.impactBand) {
    const { band } = props.impactBand;
    return { kind: 'band', band, label: bandLabel(band) };
  }
  return null;
}

function bandLabel(band: 'high' | 'medium' | 'low'): string {
  return band === 'high' ? 'High impact' : band === 'medium' ? 'Medium impact' : 'Low impact';
}

// ── Component ─────────────────────────────────────────────────────

export function WhyHowResult({
  insight,
  description,
  rationale,
  competitorProof,
  howLabel,
  estimatedGain,
  impactBand,
  expanded = false,
  className,
}: WhyHowResultProps) {
  const whyText = resolveWhy({ insight, description, rationale, competitorProof });
  const result = resolveResult({ estimatedGain, impactBand });

  if (!whyText) return null;

  if (!expanded) {
    // Compact: Why line only
    return (
      <p className={`t-caption-sm text-[var(--brand-text-muted)] truncate ${className ?? ''}`}>
        {whyText}
      </p>
    );
  }

  // Expanded: Why → How → Result (each tier omitted when no content)
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      {/* Why */}
      <div className="flex items-start gap-1.5">
        <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium flex-shrink-0">Why</span>
        <span className="t-caption-sm text-[var(--brand-text)]">{whyText}</span>
      </div>

      {/* How — only when howLabel is provided */}
      {howLabel && (
        <div className="flex items-start gap-1.5">
          <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium flex-shrink-0">How</span>
          <span className="t-caption-sm text-[var(--brand-text)]">{howLabel}</span>
        </div>
      )}

      {/* Result — only when data is available */}
      {result && (
        <div className="flex items-center gap-1.5">
          <span className="t-caption-sm text-[var(--brand-text-muted)] font-medium flex-shrink-0">Result</span>
          {result.kind === 'gain' ? (
            // Blue data badge — Four Laws: blue for data metrics
            <Badge
              tone="blue"
              size="sm"
              label={result.label}
              ariaLabel={`Projected result: ${result.label}`}
            />
          ) : (
            // emerald = high/medium impact; amber = low impact (score color law, not green)
            <Badge
              tone={result.band === 'low' ? 'amber' : 'emerald'}
              size="sm"
              label={result.label}
              ariaLabel={`Projected result: ${result.label}`}
            />
          )}
        </div>
      )}
    </div>
  );
}
