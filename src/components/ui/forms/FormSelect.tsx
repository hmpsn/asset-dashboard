import React from 'react';
import { useFormField } from './FormField';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
}

export interface FormSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const FormSelect = React.forwardRef<HTMLSelectElement, FormSelectProps>(
  function FormSelect(
    { options, value, onChange, placeholder, disabled, className },
    ref
  ) {
    const { hasError } = useFormField();

    const borderClass = hasError
      ? 'border-red-500/50'
      : 'border-zinc-700 focus:border-[var(--brand-mint)]';

    return (
      <select
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={hasError || undefined}
        className={[
          'w-full px-3 py-2',
          'bg-zinc-900 rounded-md',
          'border',
          borderClass,
          'text-zinc-200 text-sm',
          'outline-none',
          'focus:ring-2 focus:ring-[var(--brand-mint-glow)]',
          'transition-colors duration-150',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
);

FormSelect.displayName = 'FormSelect';
