// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Inline toolbar search bar — leading icon, borderless input on --surface-1,
 * teal focus ring, optional trailing keyboard hint (e.g. "⌘K"), clear button,
 * and Escape-to-clear. type="search" semantics. Composes the HEAD FormInput
 * styling patterns (does NOT fork input styling). For a labeled stacked form
 * field use `FormInput` inside a `FormField`.
 */
export interface SearchFieldProps {
  value?: string;
  onChange?: (value: string) => void;
  /** Fires on Enter with the current value. */
  onSubmit?: (value: string) => void;
  placeholder?: string;
  /** Trailing keyboard hint rendered in a <kbd> (e.g. "⌘K"). */
  kbd?: string;
  /** Override the leading icon (defaults to a magnifier). */
  icon?: LucideIcon;
  autoFocus?: boolean;
  /** Debounce onChange by N ms (timer cleaned up on unmount). */
  debounceMs?: number;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function SearchField(_props: SearchFieldProps): ReactElement {
  throw new Error('F3 stub — SearchField not yet implemented (Lane C)');
}
