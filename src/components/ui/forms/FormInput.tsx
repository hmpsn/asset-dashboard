import React from 'react';
import { cn } from '../../../lib/utils';
import { useFormField } from './FormField';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface FormInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  function FormInput(
    { value, onChange, type = 'text', placeholder, className, id, ...rest },
    ref
  ) {
    const { hasError, isValid, inputId, descriptionId } = useFormField();
    const resolvedId = id ?? (inputId || undefined);

    const borderClass = hasError
      ? 'border-red-500/50'
      : isValid
        ? 'border-emerald-500/50'
      : 'border-[var(--brand-border)] focus:border-[var(--brand-mint)]';

    return (
      <input
        ref={ref}
        id={resolvedId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={hasError || undefined}
        aria-describedby={descriptionId || undefined}
        className={cn(
          'w-full px-3 py-2',
          'bg-[var(--surface-3)] rounded-md',
          'border',
          borderClass,
          'text-[var(--brand-text-bright)] text-sm',
          'placeholder:text-[var(--brand-text-muted)]',
          'outline-none',
          'focus:ring-2 focus:ring-[var(--brand-mint-glow)]',
          'transition-colors duration-150',
          className,
        )}
        {...rest}
      />
    );
  }
);

FormInput.displayName = 'FormInput';
