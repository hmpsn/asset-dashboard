// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import { cn } from '../../../lib/utils';

export type ProvenanceBasis = 'estimate' | 'measured' | 'actual';

export interface ProvenanceChipProps {
  basis: ProvenanceBasis;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

const BASIS_STYLE: Record<ProvenanceBasis, { color: string; bg: string; label: string }> = {
  estimate: {
    color: 'var(--amber)',
    bg: 'color-mix(in srgb, var(--amber) 12%, transparent)',
    label: 'estimate',
  },
  measured: {
    color: 'var(--emerald)',
    bg: 'color-mix(in srgb, var(--emerald) 12%, transparent)',
    label: 'measured',
  },
  actual: {
    color: 'var(--blue)',
    bg: 'color-mix(in srgb, var(--blue) 12%, transparent)',
    label: 'actual',
  },
};

/**
 * co .prov -> DS provenance chip. New primitive because Badge covers tone, not
 * the outcome-value basis ladder semantics used across cockpit/global ops.
 */
export function ProvenanceChip({ basis, className, id, style }: ProvenanceChipProps): ReactElement {
  const tone = BASIS_STYLE[basis];
  return (
    <span
      id={id}
      className={cn('t-micro inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-1.5 py-0.5 font-semibold uppercase', className)}
      style={{
        color: tone.color,
        background: tone.bg,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-[var(--radius-pill)]"
        style={{ background: tone.color }}
      />
      {tone.label}
    </span>
  );
}
