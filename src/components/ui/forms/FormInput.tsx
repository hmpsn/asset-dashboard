import React from 'react';
import { cn } from '../../../lib/utils';
import { useFormField } from './FormField';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface FormInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string | number;
  onChange?: (value: string) => void;
  /** Buffer edits locally and call onCommit on blur. Useful for editor cells. */
  commitOnBlur?: boolean;
  onCommit?: (value: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  function FormInput(
    {
      value,
      onChange,
      commitOnBlur = false,
      onCommit,
      type = 'text',
      placeholder,
      className,
      id,
      onBlur,
      ...rest
    },
    ref
  ) {
    const { hasError, isValid, inputId, descriptionId } = useFormField();
    const resolvedId = id ?? (inputId || undefined);
    const stringValue = String(value ?? '');
    const [draft, setDraft] = React.useState(stringValue);

    React.useEffect(() => {
      setDraft(stringValue);
    }, [stringValue]);

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
        value={commitOnBlur ? draft : stringValue}
        onChange={(e) => {
          if (commitOnBlur) {
            setDraft(e.target.value);
          } else {
            onChange?.(e.target.value);
          }
        }}
        onBlur={(e) => {
          if (commitOnBlur) {
            onCommit?.(draft);
          }
          onBlur?.(e);
        }}
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
