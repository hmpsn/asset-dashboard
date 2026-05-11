import React, { createContext, useContext, useId } from 'react';
import { cn } from '../../../lib/utils';

// ─── Context ────────────────────────────────────────────────────────────────

export interface FormFieldContextValue {
  hasError: boolean;
  isValid: boolean;
  required: boolean;
  /**
   * Auto-generated id used to wire <label htmlFor> ↔ <input id>. Children
   * consuming the context (FormInput/FormSelect/FormTextarea) should fall
   * back to this when no caller-provided `id` is set on the input itself.
   * Empty string when not inside a FormField.
   */
  inputId: string;
  /**
   * Auto-generated id for the error/hint message, used for aria-describedby
   * on the input. Empty string when no message is shown.
   */
  descriptionId: string;
}

export const FormFieldContext = createContext<FormFieldContextValue>({
  hasError: false,
  isValid: false,
  required: false,
  inputId: '',
  descriptionId: '',
});

export function useFormField(): FormFieldContextValue {
  return useContext(FormFieldContext);
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  error?: string;
  hint?: string;
  success?: string;
  valid?: boolean;
  required?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  function FormField(
    {
      label,
      error,
      hint,
      success,
      valid = false,
      required = false,
      children,
      className,
      ...rest
    },
    ref,
  ) {
    const reactId = useId();
    const inputId = `form-field-${reactId}`;
    const isValid = Boolean(valid && !error);
    const hasMessage = Boolean(error || hint || (success && isValid));
    const descriptionId = hasMessage ? `${inputId}-desc` : '';

    const contextValue: FormFieldContextValue = {
      hasError: Boolean(error),
      isValid,
      required,
      inputId,
      descriptionId,
    };

    return (
      <FormFieldContext.Provider value={contextValue}>
        <div ref={ref} className={className} {...rest}>
          {/* Label — htmlFor ties label-click to input focus and gives screen
              readers the label-↔-control association */}
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-[var(--brand-text-bright)] mb-1.5"
          >
            {label}
            {required && (
              <span className="text-red-400 ml-1" aria-hidden="true">
                *
              </span>
            )}
          </label>

          {/* Input slot */}
          {children}

          {/* Below-input messages */}
          {error ? (
            <p
              id={descriptionId}
              className="mt-1.5 text-xs text-red-400"
              role="alert"
            >
              {error}
            </p>
          ) : success && isValid ? (
            <p
              id={descriptionId}
              className="mt-1.5 text-xs text-emerald-400"
              role="status"
            >
              {success}
            </p>
          ) : hint ? (
            <p
              id={descriptionId}
              className={cn('mt-1.5 text-xs text-[var(--brand-text-muted)]')}
            >
              {hint}
            </p>
          ) : null}
        </div>
      </FormFieldContext.Provider>
    );
  },
);

FormField.displayName = 'FormField';
