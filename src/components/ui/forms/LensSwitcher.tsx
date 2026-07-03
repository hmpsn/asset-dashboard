// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface LensOption {
  value: string;
  label: string;
  icon?: LucideIcon;
  /** Trailing count pill. */
  count?: number;
}

/**
 * Tray segmented switcher (lens / scope / sub-tabs). Selected segment fills
 * with --surface-active; segments may carry an icon and a count pill. The
 * dominant "pick a view/lens" control. For a borderless two-up toggle use
 * `Segmented`; for an underlined page-level tab strip use `TabBar`. Keyboard:
 * roving tabindex + arrow keys.
 */
export interface LensSwitcherProps {
  options: LensOption[];
  value?: string;
  onChange?: (value: string) => void;
  size?: 'sm' | 'md';
  /** Monospace labels (matches the app's .tf-* / mono switchers). */
  mono?: boolean;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function LensSwitcher(_props: LensSwitcherProps): ReactElement {
  throw new Error('F3 stub — LensSwitcher not yet implemented (Lane C)');
}
