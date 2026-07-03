// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';

export interface RadioOption {
  value: string;
  label: string;
}

/**
 * Single-select radio group. Selected dot is teal (the action color). Full
 * WAI-ARIA: role="radiogroup", roving tabindex, arrow keys (wrap), Space
 * selects. Controlled: `value` + `onChange(value)`. Integrates with the
 * `FormField` context for aria-invalid. Lay out as a column or a row.
 */
export interface RadioGroupProps {
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  direction?: 'column' | 'row';
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function RadioGroup(_props: RadioGroupProps): ReactElement {
  throw new Error('F3 stub — RadioGroup not yet implemented (Lane C)');
}
