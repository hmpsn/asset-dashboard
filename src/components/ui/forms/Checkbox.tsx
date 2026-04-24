import React, { useId } from 'react';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ checked, onChange, label, disabled, className }, ref) {
    const id = useId();

    return (
      <label
        htmlFor={id}
        className={[
          'inline-flex items-center gap-2.5',
          'cursor-pointer select-none',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Hidden native checkbox — handles Space key + accessibility */}
        <input
          ref={ref}
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
        />

        {/* Custom visual checkbox */}
        <span
          aria-hidden="true"
          className={[
            'w-4 h-4 rounded',
            'border',
            'flex items-center justify-center',
            'flex-shrink-0',
            'transition-colors duration-150',
            checked
              ? 'bg-[var(--brand-mint)] border-[var(--brand-mint)]'
              : 'bg-zinc-800 border-zinc-700',
          ].join(' ')}
        >
          {checked && (
            <svg
              className="w-2.5 h-2.5 text-zinc-900"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="1.5,5 4,7.5 8.5,2.5" />
            </svg>
          )}
        </span>

        {/* Label text */}
        <span className="text-sm text-zinc-300">{label}</span>
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
