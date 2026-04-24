import React from 'react';
import { cn } from '../../../lib/utils';
import { useFormField } from './FormField';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface FormTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
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
  { value, onChange, rows = 4, maxLength, placeholder, className, id, ...rest },
  ref
) {
  const { hasError, inputId, descriptionId } = useFormField();
  const resolvedId = id ?? (inputId || undefined);

  const borderClass = hasError
    ? 'border-red-500/50'
    : 'border-zinc-700 focus:border-[var(--brand-mint)]';

  const charCount = value.length;
  const nearLimit = maxLength !== undefined && charCount >= maxLength * 0.9;

  return (
    <div className="relative">
      <textarea
        ref={ref}
        id={resolvedId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={hasError || undefined}
        aria-describedby={descriptionId || undefined}
        className={cn(
          'w-full px-3 py-2',
          'bg-zinc-900 rounded-md',
          'border',
          borderClass,
          'text-zinc-200 text-sm',
          'placeholder:text-zinc-500',
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
            nearLimit ? 'text-red-400' : 'text-zinc-500',
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
