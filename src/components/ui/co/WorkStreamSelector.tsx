// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { WorkQueueStream } from '../../../../shared/types/work-queue';
import { cn } from '../../../lib/utils';
import { Icon } from '../Icon';
import type { IconName } from '../iconNames';
import { useRovingTabindex } from '../useRovingTabindex';

export type SelectableWorkStream = Exclude<WorkQueueStream, 'unclassified'>;

export interface WorkStreamOption {
  id: SelectableWorkStream;
  label: string;
  description: string;
  count: number;
  unit?: string;
  iconName?: IconName;
}

export interface WorkStreamSelectorProps {
  options: WorkStreamOption[];
  value: SelectableWorkStream;
  onChange: (value: SelectableWorkStream) => void;
  ariaLabel?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

const STREAM_STYLE: Record<SelectableWorkStream, { color: string; bg: string; icon: IconName }> = {
  opt: { color: 'var(--blue)', bg: 'color-mix(in srgb, var(--blue) 12%, transparent)', icon: 'gauge' },
  send: { color: 'var(--teal)', bg: 'var(--brand-mint-dim)', icon: 'send' },
  money: { color: 'var(--amber)', bg: 'color-mix(in srgb, var(--amber) 12%, transparent)', icon: 'trophy' },
};

/**
 * co .co-streams/.co-stream -> DS stream selector. This is not just MetricTile:
 * it is a single-select navigation/filter control, so it uses roving tabindex.
 */
export function WorkStreamSelector({
  options,
  value,
  onChange,
  ariaLabel = 'Work stream',
  className,
  id,
  style,
}: WorkStreamSelectorProps): ReactElement {
  const activeIndex = Math.max(0, options.findIndex(option => option.id === value));
  const roving = useRovingTabindex(options.length, {
    orientation: 'horizontal',
    wrap: true,
    defaultIndex: activeIndex,
    onActivate: (index) => {
      const option = options[index];
      if (option) onChange(option.id);
    },
  });

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('grid gap-3 sm:grid-cols-3', className)}
      style={style}
    >
      {options.map((option, index) => {
        const active = option.id === value;
        const tone = STREAM_STYLE[option.id];
        const itemProps = roving.getItemProps(index);
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            ref={itemProps.ref}
            tabIndex={itemProps.tabIndex}
            onFocus={itemProps.onFocus}
            onKeyDown={itemProps.onKeyDown}
            onClick={itemProps.onClick}
            className={cn(
              'min-h-[126px] rounded-[var(--radius-lg)] border px-4 py-3 text-left',
              'transition-[border-color,background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
              active ? 'border-[color-mix(in_srgb,var(--teal)_45%,var(--brand-border))] bg-[var(--surface-2)]' : 'border-[var(--brand-border)] bg-[var(--surface-2)]',
              'hover:border-[var(--brand-border-hover)]',
            )}
            style={active ? { background: 'linear-gradient(135deg, var(--surface-2), color-mix(in srgb, var(--teal) 7%, var(--surface-2)))' } : undefined}
          >
            <span
              className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)]"
              style={{ background: tone.bg, color: tone.color }}
            >
              <Icon name={option.iconName ?? tone.icon} size="md" aria-hidden="true" />
            </span>
            <span className="block">
              <span className="t-stat inline-flex items-baseline gap-1.5 font-bold text-[var(--brand-text-bright)]">
                {option.count}
                {option.unit && <span className="t-caption-sm text-[var(--brand-text-muted)]">{option.unit}</span>}
              </span>
              <span className="t-ui mt-2 block font-semibold text-[var(--brand-text-bright)]">{option.label}</span>
              <span className="t-caption-sm mt-1 block text-[var(--brand-text)]">{option.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
