import React from 'react';
import { cn } from '../../../lib/utils';
import { useFormField } from './FormField';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
}

// Note: `multiple` is Omit'd because the onChange signature returns a single
// string; supporting multi-select would require a different callback shape.
// Consumers who need multi-select should render a native <select multiple>
// directly or build a dedicated MultiSelect primitive.
export interface FormSelectProps
  extends Omit<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    'onChange' | 'children' | 'multiple'
  > {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const FormSelect = React.forwardRef<HTMLSelectElement, FormSelectProps>(
  function FormSelect(
    { options, value, onChange, placeholder, disabled, className, id, ...rest },
    ref
  ) {
    const { hasError, inputId, descriptionId } = useFormField();
    const resolvedId = id ?? (inputId || undefined);

    const borderClass = hasError
      ? 'border-red-500/50'
      : 'border-zinc-700 focus:border-[var(--brand-mint)]';

    return (
      <select
        ref={ref}
        id={resolvedId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={hasError || undefined}
        aria-describedby={descriptionId || undefined}
        className={cn(
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
        )}
        {...rest}
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
