// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import { useId } from 'react';
import { cn } from '../../../lib/utils';
import { useRovingTabindex } from '../useRovingTabindex';
import { useFormField } from './FormField';

export interface RadioOption {
  value: string;
  label: string;
}

/**
 * Single-select radio group. Selected dot is teal (the action color). Full
 * WAI-ARIA: role="radiogroup", roving tabindex, arrow keys (wrap), Space
 * selects. Controlled: `value` + `onChange(value)`. Integrates with the
 * `FormField` context for aria-invalid. Lay out as a column or a row.
 */
export interface RadioGroupProps {
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  direction?: 'column' | 'row';
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function RadioGroup({
  options,
  value,
  onChange,
  name,
  direction = 'column',
  className,
  id,
  style,
}: RadioGroupProps): ReactElement {
  const { hasError, descriptionId } = useFormField();
  const reactId = useId();
  const groupName = name || `radio-group-${reactId}`;
  const activeIndexFromValue = Math.max(0, options.findIndex((o) => o.value === value));

  const { getItemProps } = useRovingTabindex(options.length, {
    orientation: direction === 'row' ? 'horizontal' : 'vertical',
    wrap: true,
    defaultIndex: activeIndexFromValue,
    onActivate: (index) => {
      const option = options[index];
      if (option) onChange?.(option.value);
    },
  });

  return (
    <div
      id={id}
      role="radiogroup"
      aria-invalid={hasError || undefined}
      aria-describedby={descriptionId || undefined}
      style={style}
      className={cn(
        'flex flex-wrap',
        direction === 'row' ? 'flex-row gap-[18px]' : 'flex-col gap-[9px]',
        className,
      )}
    >
      {options.map((option, index) => {
        const isOn = option.value === value;
        const itemProps = getItemProps(index);
        return (
          <label
            key={option.value}
            className="inline-flex items-center gap-[9px] cursor-pointer min-h-[28px]"
          >
            <button
              type="button"
              role="radio"
              name={groupName}
              aria-checked={isOn}
              className={cn(
                'flex-none flex items-center justify-center p-0 rounded-full cursor-pointer',
                'w-[17px] h-[17px] bg-[var(--surface-1)] border-[1.5px]',
                'transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]',
                isOn ? 'border-[var(--teal)]' : 'border-[var(--brand-border-strong)]',
              )}
              ref={itemProps.ref}
              tabIndex={itemProps.tabIndex}
              onKeyDown={itemProps.onKeyDown}
              onFocus={itemProps.onFocus}
              onClick={itemProps.onClick}
            >
              {isOn && <span className="w-[9px] h-[9px] rounded-full bg-[var(--teal)]" />}
            </button>
            <span className="t-ui text-[var(--brand-text-bright)]">{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
