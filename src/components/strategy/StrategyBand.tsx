import type { StrategyBandProps } from './types';

/**
 * Labeled section divider that groups strategy content into named bands
 * (e.g. "Decide", "Act", "Reference").
 *
 * The header row mirrors the "Reference & Analysis" divider markup in
 * KeywordStrategy.tsx: an uppercase t-caption muted label + a flex-1 border-t
 * rule on the right. The outer container also carries a border-t on its top
 * edge (left of the label). When `first` is true the outer top border and
 * leading margin are omitted so the first band sits flush under the page header.
 */
export function StrategyBand({ label, first, children }: StrategyBandProps) {
  return (
    <div>
      {/* Band header divider — mirrors the "Reference & Analysis" divider in KeywordStrategy.tsx */}
      <div
        className={`flex items-center gap-3${first ? '' : ' border-t border-[var(--brand-border)] my-6'}`}
      >
        <span className="t-caption text-[var(--brand-text-muted)] uppercase tracking-wide">
          {label}
        </span>
        <div className="flex-1 border-t border-[var(--brand-border)]" />
      </div>

      {/* Band content */}
      <div className="space-y-8">{children}</div>
    </div>
  );
}
