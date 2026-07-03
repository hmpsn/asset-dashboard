// @ds-rebuilt
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * One label→value row: muted label, bright right-aligned value, optional
 * hairline divider on top. The app's `.kd-row` / `.sg-kv`. Rendered as a
 * semantic <div> pair; use <DefinitionList> for a full <dl>.
 */
export interface KeyValueRowProps {
  label: ReactNode;
  value: ReactNode;
  valueColor?: string;
  divider?: boolean;
  /** Render the value in the mono font family (var(--font-mono)). */
  mono?: boolean;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function KeyValueRow({
  label,
  value,
  valueColor,
  divider = true,
  mono = false,
  className,
  id,
  style,
}: KeyValueRowProps): ReactElement {
  return (
    <div
      id={id}
      className={cn(
        'flex items-center gap-3 py-[9px] t-caption',
        divider && 'border-t border-[var(--brand-border)]',
        className,
      )}
      style={style}
    >
      <span className="text-[var(--brand-text-dim)] min-w-0">{label}</span>
      <span
        className={cn(
          'ml-auto text-right font-semibold tabular-nums',
          mono && 'font-mono',
        )}
        style={{
          color: valueColor || 'var(--brand-text-bright)',
          fontFamily: mono ? 'var(--font-mono)' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export interface DefinitionItem {
  label: ReactNode;
  value: ReactNode;
  valueColor?: string;
  mono?: boolean;
}

/** Hairline-divided semantic <dl> of label→value rows. */
export interface DefinitionListProps {
  items: DefinitionItem[];
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function DefinitionList({ items, className, id, style }: DefinitionListProps): ReactElement {
  return (
    <dl id={id} className={className} style={style}>
      {items.map((item, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center gap-3 py-[9px] t-caption',
            i !== 0 && 'border-t border-[var(--brand-border)]',
          )}
        >
          <dt className="text-[var(--brand-text-dim)] min-w-0">{item.label}</dt>
          <dd
            className={cn('ml-auto text-right font-semibold tabular-nums', item.mono && 'font-mono')}
            style={{
              color: item.valueColor || 'var(--brand-text-bright)',
              fontFamily: item.mono ? 'var(--font-mono)' : undefined,
            }}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
