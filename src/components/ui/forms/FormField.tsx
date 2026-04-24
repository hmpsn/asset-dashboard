import React, { createContext, useContext } from 'react';

// ─── Context ────────────────────────────────────────────────────────────────

export interface FormFieldContextValue {
  hasError: boolean;
  required: boolean;
}

export const FormFieldContext = createContext<FormFieldContextValue>({
  hasError: false,
  required: false,
});

export function useFormField(): FormFieldContextValue {
  return useContext(FormFieldContext);
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface FormFieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FormField({
  label,
  error,
  hint,
  required = false,
  children,
  className,
}: FormFieldProps): React.JSX.Element {
  const contextValue: FormFieldContextValue = {
    hasError: Boolean(error),
    required,
  };

  return (
    <FormFieldContext.Provider value={contextValue}>
      <div className={className}>
        {/* Label */}
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
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
          <p className="mt-1.5 text-xs text-red-400" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>
        ) : null}
      </div>
    </FormFieldContext.Provider>
  );
}
