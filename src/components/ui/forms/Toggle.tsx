import React, { useId } from 'react';
import { cn } from '../../../lib/utils';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** When true, the label text is visually hidden (sr-only) but still accessible. */
  srOnlyLabel?: boolean;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const Toggle = React.forwardRef<HTMLInputElement, ToggleProps>(
  function Toggle({ checked, onChange, label, disabled, srOnlyLabel, className }, ref) {
    const id = useId();

    return (
      <label
        htmlFor={id}
        className={cn(
          // `relative` is REQUIRED — gives the `sr-only` input below an explicit
          // positioned ancestor. Without it, the absolutely-positioned input
          // anchors to the viewport (initial containing block), so when a label
          // click focuses the input, the browser's auto-scrollIntoView scrolls
          // the WINDOW instead of the nearest overflow:auto ancestor (e.g.
          // <main>). On long-scrolled pages (FeatureFlagSettings) this blanks
          // the screen until the user refreshes.
          'relative inline-flex items-center gap-3',
          'cursor-pointer select-none',
          disabled && 'opacity-50 cursor-not-allowed',
          className,
        )}
      >
        {/* Hidden native checkbox — handles Space key + accessibility.
            aria-checked is implicit on <input type="checkbox" role="switch">
            so we don't duplicate it here (would risk desync). */}
        <input
          ref={ref}
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only peer"
        />

        {/* Toggle track */}
        <span
          aria-hidden="true"
          className={cn(
            'relative inline-flex items-center',
            'w-9 h-5 rounded-full',
            'flex-shrink-0',
            'transition-colors duration-150',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-teal-500',
            checked ? 'bg-[var(--brand-mint)]' : 'bg-[var(--surface-3)]',
          )}
        >
          {/* Knob */}
          <span
            className={cn(
              'absolute top-0.5 left-0.5',
              'w-4 h-4 rounded-full',
              'bg-white',
              'shadow-sm',
              'transition-all duration-150',
              checked ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </span>

        {/* Label text */}
        <span className={cn('text-sm text-[var(--brand-text)]', srOnlyLabel && 'sr-only')}>{label}</span>
      </label>
    );
  }
);

Toggle.displayName = 'Toggle';
