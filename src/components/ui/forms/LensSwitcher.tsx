// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useRovingTabindex } from '../useRovingTabindex';

export interface LensOption {
  value: string;
  label: string;
  icon?: LucideIcon;
  /** Trailing count pill. */
  count?: number;
}

/**
 * Tray segmented switcher (lens / scope / sub-tabs). Selected segment fills
 * with --surface-active; segments may carry an icon and a count pill. The
 * dominant "pick a view/lens" control. For a borderless two-up toggle use
 * `Segmented`; for an underlined page-level tab strip use `TabBar`. Keyboard:
 * roving tabindex + arrow keys.
 */
export interface LensSwitcherProps {
  options: LensOption[];
  value?: string;
  onChange?: (value: string) => void;
  size?: 'sm' | 'md';
  /** Monospace labels (matches the app's .tf-* / mono switchers). */
  mono?: boolean;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

const SIZE_STYLES: Record<'sm' | 'md', { pad: string; gap: string; iconSize: number; text: string }> = {
  sm: { pad: 'px-[11px] py-[5px]', gap: 'gap-1.5', iconSize: 13, text: 't-caption-sm' },
  md: { pad: 'px-[15px] py-2', gap: 'gap-[7px]', iconSize: 15, text: 't-ui' },
};

// role="radio"/"radiogroup" — same reasoning as Segmented: this picks one
// exclusive lens/scope value, it does not switch a page-level tab panel.
export function LensSwitcher({
  options,
  value,
  onChange,
  size = 'md',
  mono = false,
  className,
  id,
  style,
}: LensSwitcherProps): ReactElement {
  const activeIndexFromValue = Math.max(0, options.findIndex((o) => o.value === value));
  const sizeStyles = SIZE_STYLES[size];

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
        'inline-flex max-w-full w-fit gap-[3px] p-1',
        'bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)]',
        className,
      )}
      style={style}
    >
      {options.map((option, index) => {
        const isOn = option.value === value;
        const Icon = option.icon;
        const itemProps = getItemProps(index);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isOn}
            className={cn(
              'flex items-center whitespace-nowrap border-none cursor-pointer rounded-[var(--radius-md)]',
              'transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]',
              sizeStyles.pad,
              sizeStyles.gap,
              mono ? 't-mono' : sizeStyles.text,
              'font-semibold',
              isOn
                ? 'bg-[var(--surface-active)] text-[var(--brand-text-bright)] shadow-[var(--shadow-sm)]'
                : 'bg-transparent text-[var(--brand-text-muted)]',
            )}
            ref={itemProps.ref}
            tabIndex={itemProps.tabIndex}
            onKeyDown={itemProps.onKeyDown}
            onFocus={itemProps.onFocus}
            onClick={itemProps.onClick}
          >
            {Icon && (
              <Icon
                size={sizeStyles.iconSize}
                className={isOn ? 'text-[var(--teal)]' : 'text-current opacity-80'}
                aria-hidden="true"
              />
            )}
            {option.label}
            {option.count != null && (
              <span
                className={cn(
                  't-micro px-1.5 rounded-[var(--radius-pill)]',
                  isOn ? 'bg-[var(--brand-mint-dim)] text-[var(--teal)]' : 'bg-[var(--surface-1)] text-[var(--brand-text-dim)]',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
