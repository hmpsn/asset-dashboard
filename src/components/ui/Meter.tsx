// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';

/**
 * Horizontal progress / value bar (the app's `.oppbar`). `value` over `max`
 * (default 100). Teal fill by default; `gradient` uses the teal→emerald run.
 * Optional label + percentage readout above the track. role="meter" semantics.
 */
export interface MeterProps {
  value: number;
  max?: number;
  color?: string;
  gradient?: boolean;
  height?: number;
  label?: string;
  showValue?: boolean;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function Meter(_props: MeterProps): ReactElement {
  throw new Error('F3 stub — Meter not yet implemented (Lane B)');
}
