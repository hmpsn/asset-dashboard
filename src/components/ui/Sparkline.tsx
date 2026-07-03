// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';

/**
 * Inline trend line (no axes) from a series of numbers — the app's `.spark`.
 * Hand-rolled SVG (no chart dependency). Blue by default (the data color);
 * `area` adds a soft gradient fill. Handles empty/single-point series safely.
 */
export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  area?: boolean;
  strokeWidth?: number;
  /** Accessible label; when omitted the SVG is aria-hidden (purely decorative). */
  label?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function Sparkline(_props: SparklineProps): ReactElement {
  throw new Error('F3 stub — Sparkline not yet implemented (Lane B)');
}
