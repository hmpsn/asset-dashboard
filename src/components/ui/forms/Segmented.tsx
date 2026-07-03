// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { SelectOption } from './FormSelect';

/**
 * Segmented toggle for 2–4 exclusive choices (e.g. date range, view mode).
 * Selected segment is teal-tinted. Controlled — pass `value` and `onChange`.
 * Keyboard: roving tabindex + arrow keys (useRovingTabindex).
 */
export interface SegmentedProps {
  options: SelectOption[];
  value: string;
  onChange?: (value: string) => void;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function Segmented(_props: SegmentedProps): ReactElement {
  throw new Error('F3 stub — Segmented not yet implemented (Lane C)');
}
