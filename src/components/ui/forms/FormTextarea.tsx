import React from 'react';
import { cn } from '../../../lib/utils';
import { useFormField } from './FormField';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface FormTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  value: string;
  onChange?: (value: string) => void;
  /** Buffer edits locally and call onCommit on blur. Useful for editor fields. */
  commitOnBlur?: boolean;
  onCommit?: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const FormTextarea = React.forwardRef<
  HTMLTextAreaElement,
  FormTextareaProps
>(function FormTextarea(
  {
    value,
    onChange,
    commitOnBlur = false,
    onCommit,
    rows = 4,
    maxLength,
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
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const borderClass = hasError
    ? 'border-red-500/50'
    : isValid
      ? 'border-emerald-500/50'
    : 'border-[var(--brand-border)] focus:border-[var(--brand-mint)]';

  const currentValue = commitOnBlur ? draft : value;
  const charCount = currentValue.length;
  const nearLimit = maxLength !== undefined && charCount >= maxLength * 0.9;

  return (
    <div className="relative">
      <textarea
        ref={ref}
        id={resolvedId}
        value={currentValue}
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
        rows={rows}
        maxLength={maxLength}
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
          'resize-none',
          maxLength !== undefined && 'pb-6',
          className,
        )}
        {...rest}
      />
      {maxLength !== undefined && (
        <span
          className={cn(
            'absolute bottom-2 right-3',
            'text-xs select-none',
            nearLimit ? 'text-red-400' : 'text-[var(--brand-text-muted)]',
          )}
          aria-live="polite"
        >
          {charCount}/{maxLength}
        </span>
      )}
    </div>
  );
});

FormTextarea.displayName = 'FormTextarea';
