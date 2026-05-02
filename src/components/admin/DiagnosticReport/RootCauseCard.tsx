import { SectionCard } from '../../ui/SectionCard.js';
import type { RootCause } from '../../../../shared/types/diagnostics.js';

const CONFIDENCE_COLORS = {
  high: 'bg-emerald-500/10 text-accent-success',
  medium: 'bg-amber-500/10 text-accent-warning',
  low: 'bg-[var(--surface-3)] text-[var(--brand-text-muted)]',
} as const;

interface Props {
  cause: RootCause;
}

export function RootCauseCard({ cause }: Props) {
  return (
    <SectionCard>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-[var(--brand-text-muted)]">#{cause.rank}</span>
          <h3 className="text-sm font-semibold text-[var(--brand-text-bright)]">{cause.title}</h3>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${CONFIDENCE_COLORS[cause.confidence]}`}>
          {cause.confidence}
        </span>
      </div>
      <p className="text-sm text-[var(--brand-text)] mb-3">{cause.explanation}</p>
      {cause.evidence.length > 0 && (
        <ul className="space-y-1">
          {cause.evidence.map((e, i) => (
            <li key={i} className="text-xs text-[var(--brand-text-muted)] flex items-start gap-2">
              <span className="text-accent-info mt-0.5">-</span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
