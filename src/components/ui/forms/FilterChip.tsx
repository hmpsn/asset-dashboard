// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { cn } from '../../../lib/utils';

/**
 * Pressable filter/toggle chip for toolbars. Active = teal tint + teal border
 * (the action color); inactive = calm surface. Optional leading icon and
 * trailing count. Set `onRemove` for the removable variant (accessible × with a
 * ≥44px hit target). For read-only status/category tags use `Badge`.
 */
export interface FilterChipProps {
  label: string;
  active?: boolean;
  count?: number;
  icon?: LucideIcon;
  onClick?: () => void;
  /** Render a remove (×) affordance; fires this on activate. */
  onRemove?: () => void;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function FilterChip({
  label,
  active = false,
  count,
  icon: Icon,
  onClick,
  onRemove,
  className,
  id,
  style,
}: FilterChipProps): ReactElement {
  return (
    <span
      id={id}
      style={style}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-md)] whitespace-nowrap',
        't-caption-sm font-semibold',
        'transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]',
        'border',
        active
          ? 'bg-[var(--brand-mint-dim)] border-[var(--brand-mint-dim)] text-[var(--teal)]'
          : 'bg-[var(--surface-2)] border-[var(--brand-border)] text-[var(--brand-text)]',
        // onRemove renders a second inline button, so this container drops its
        // own right-side padding in favor of the remove button's own hit area.
        onRemove ? 'pl-[11px] pr-1 py-[3px]' : 'px-[11px] py-1.5',
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1.5 border-none bg-transparent cursor-pointer p-0',
          active ? 'text-[var(--teal)]' : 'text-[var(--brand-text)]',
        )}
      >
        {Icon && (
          <Icon
            size={13}
            className={active ? 'text-[var(--teal)]' : 'text-[var(--brand-text-dim)]'}
            aria-hidden="true"
          />
        )}
        {label}
        {count != null && (
          <span
            className={cn(
              't-mono font-bold',
              active ? 'text-[var(--teal)] opacity-100' : 'text-[var(--brand-text-dim)] opacity-70',
            )}
          >
            {count}
          </span>
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            // The visible glyph is a compact 13px X, but the effective hit
            // target must still reach ~44px — achieved via padding (not a
            // fixed box) so the chip's visual footprint stays compact while
            // the tap target is generous. before/after pseudo-content
            // approach avoided in favor of a plain padded button.
            'relative inline-flex items-center justify-center border-none bg-transparent cursor-pointer',
            'min-w-11 min-h-11 rounded-[var(--radius-md)]',
            active ? 'text-[var(--teal)]' : 'text-[var(--brand-text-dim)]',
          )}
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
