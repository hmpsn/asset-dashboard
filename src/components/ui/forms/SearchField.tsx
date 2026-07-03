// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/utils';

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

export function SearchField({
  value = '',
  onChange,
  onSubmit,
  placeholder = 'Search…',
  kbd,
  icon: Icon = Search,
  autoFocus,
  debounceMs,
  className,
  id,
  style,
}: SearchFieldProps): ReactElement {
  const [focused, setFocused] = useState(false);
  // Local draft lets typing feel instant even when onChange is debounced —
  // the input always reflects what the user typed, not the (possibly
  // delayed) committed value.
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(value);
    // Cancel any pending debounce when the value is synced externally — otherwise
    // a stale timer would fire onChange(oldDraft) and silently revert the value
    // the parent just pushed (review finding).
    if (timerRef.current) clearTimeout(timerRef.current);
  }, [value]);

  // Clean up any in-flight debounce timer on unmount so a late fire never
  // calls onChange after the component (and possibly its onChange closure)
  // is gone.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const commit = (next: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (debounceMs && debounceMs > 0) {
      timerRef.current = setTimeout(() => {
        onChange?.(next);
      }, debounceMs);
    } else {
      onChange?.(next);
    }
  };

  const handleChange = (next: string) => {
    setDraft(next);
    commit(next);
  };

  const handleClear = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setDraft('');
    onChange?.('');
  };

  return (
    <div
      id={id}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2',
        'bg-[var(--surface-1)] border transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
        focused ? 'border-[var(--teal)] shadow-[0_0_0_3px_var(--brand-mint-glow)]' : 'border-[var(--brand-border)]',
        className,
      )}
    >
      <Icon size={15} className="flex-none text-[var(--brand-text-dim)]" aria-hidden="true" />
      <input
        type="search"
        value={draft}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSubmit?.(draft);
          } else if (e.key === 'Escape') {
            handleClear();
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          't-ui flex-1 min-w-0 bg-transparent border-none outline-none',
          'text-[var(--brand-text-bright)] placeholder:text-[var(--brand-text-muted)]',
        )}
      />
      {draft !== '' && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={handleClear}
          className="flex-none inline-flex items-center justify-center border-none bg-transparent cursor-pointer text-[var(--brand-text-dim)]"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
      {kbd && (
        <kbd
          className={cn(
            't-micro flex-none px-1.5 py-0.5 rounded-[var(--radius-sm)]',
            'bg-[var(--surface-3)] border border-[var(--brand-border)] text-[var(--brand-text-dim)]',
          )}
        >
          {kbd}
        </kbd>
      )}
    </div>
  );
}
