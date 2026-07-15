// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import { cn } from '../../../lib/utils';
import { useRovingTabindex } from '../useRovingTabindex';
import type { SelectOption } from './FormSelect';

/**
 * Segmented toggle for 2–4 exclusive choices (e.g. date range, view mode).
 * Selected segment is teal-tinted. Controlled — pass `value` and `onChange`.
 * Keyboard: roving tabindex + arrow keys (useRovingTabindex).
 */
export interface SegmentedProps {
  options: SelectOption[];
  value: string;
  onChange?: (value: string) => void;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

// Segments use role="radio" inside role="radiogroup" (not role="tab"/"tablist")
// because the semantics here are "pick one exclusive value from a small set",
// not "switch the visible panel" — the WAI-ARIA radio-group pattern matches
// aria-checked + arrow-key single-select behavior exactly.
export function Segmented({ options, value, onChange, className, id, style }: SegmentedProps): ReactElement {
  const activeIndexFromValue = Math.max(0, options.findIndex((o) => o.value === value));

  const { getItemProps } = useRovingTabindex(options.length, {
    orientation: 'horizontal',
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
      className={cn(
        'inline-flex overflow-hidden rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)]',
        className,
      )}
      style={style}
    >
      {options.map((option, index) => {
        const isOn = option.value === value;
        const itemProps = getItemProps(index);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isOn}
            className={cn(
              't-ui px-3.5 py-2 border-none cursor-pointer whitespace-nowrap',
              'transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]',
              index !== 0 && 'border-l',
              index !== 0 && (isOn ? 'border-l-[var(--brand-mint-dim)]' : 'border-l-[var(--brand-border)]'),
              isOn ? 'bg-[var(--brand-mint-dim)] text-[var(--teal)]' : 'bg-transparent text-[var(--brand-text-muted)]',
            )}
            ref={itemProps.ref}
            tabIndex={itemProps.tabIndex}
            onKeyDown={itemProps.onKeyDown}
            onFocus={itemProps.onFocus}
            onClick={itemProps.onClick}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
