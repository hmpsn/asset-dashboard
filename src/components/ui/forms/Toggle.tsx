import React, { useId } from 'react';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const Toggle = React.forwardRef<HTMLInputElement, ToggleProps>(
  function Toggle({ checked, onChange, label, disabled, className }, ref) {
    const id = useId();

    return (
      <label
        htmlFor={id}
        className={[
          'inline-flex items-center gap-3',
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
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
          aria-checked={checked}
        />

        {/* Toggle track */}
        <span
          aria-hidden="true"
          className={[
            'relative inline-flex items-center',
            'w-9 h-5 rounded-full',
            'flex-shrink-0',
            'transition-colors duration-150',
            checked ? 'bg-[var(--brand-mint)]' : 'bg-zinc-700',
          ].join(' ')}
        >
          {/* Knob */}
          <span
            className={[
              'absolute top-0.5 left-0.5',
              'w-4 h-4 rounded-full',
              'bg-white',
              'shadow-sm',
              'transition-all duration-150',
              checked ? 'translate-x-4' : 'translate-x-0',
            ].join(' ')}
          />
        </span>

        {/* Label text */}
        <span className="text-sm text-zinc-300">{label}</span>
      </label>
    );
  }
);

Toggle.displayName = 'Toggle';
