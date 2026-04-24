import React from 'react';
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
    const { hasError, inputId, descriptionId } = useFormField();
    const resolvedId = id ?? (inputId || undefined);

    const borderClass = hasError
      ? 'border-red-500/50'
      : 'border-zinc-700 focus:border-[var(--brand-mint)]';

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
        className={[
          'w-full px-3 py-2',
          'bg-zinc-900 rounded-md',
          'border',
          borderClass,
          'text-zinc-200 text-sm',
          'placeholder:text-zinc-500',
          'outline-none',
          'focus:ring-2 focus:ring-[var(--brand-mint-glow)]',
          'transition-colors duration-150',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
    );
  }
);

FormInput.displayName = 'FormInput';
