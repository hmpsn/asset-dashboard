// @ds-rebuilt
import { Children, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Kanban / lifecycle board column: header (accent dot · title · count pill), a
 * gap-spaced scrolling stack of cards, and a built-in empty state. Presentational
 * only — no drag-drop (that is surface behavior). Lay a row of these in a CSS
 * grid to form the board.
 */
export interface BoardColumnProps {
  title: string;
  count?: number;
  /** Header accent dot color (e.g. var(--teal), var(--amber)). */
  accent?: string;
  /** Empty-state text shown when there are no children. */
  empty?: string;
  children?: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function BoardColumn({
  title,
  count,
  accent,
  empty = 'Nothing here yet',
  children,
  className,
  id,
  style,
}: BoardColumnProps): ReactElement {
  const isEmpty = Children.count(children) === 0;

  return (
    <div
      id={id}
      className={cn(
        'flex flex-col min-h-[120px] bg-[var(--surface-2)] border border-[var(--brand-border)]',
        'rounded-[var(--radius-lg)] overflow-hidden',
        className,
      )}
      style={style}
    >
      <div className="flex items-center gap-2 px-3 pt-[11px] pb-[9px] border-b border-[var(--brand-border)] flex-shrink-0">
        {accent && (
          <span aria-hidden="true" className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: accent }} />
        )}
        <span className="t-caption font-bold text-[var(--brand-text-bright)]">{title}</span>
        {count != null && (
          <span className="ml-auto t-mono font-bold text-[var(--brand-text-dim)] bg-[var(--surface-1)] rounded-[var(--radius-pill)] px-[7px] leading-[1.7]">
            {count}
          </span>
        )}
      </div>
      <div
        className="flex flex-col gap-[9px] flex-1 overflow-y-auto p-2.5"
        style={{ scrollbarColor: 'var(--scrollbar-thumb) transparent' }}
      >
        {isEmpty ? (
          <div className="t-caption-sm text-[var(--brand-text-muted)] text-center italic px-2 py-4">{empty}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** Default calm card for placing inside a BoardColumn. */
export interface BoardCardProps {
  title?: string;
  meta?: string;
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function BoardCard({ title, meta, onClick, children, className, id, style }: BoardCardProps): ReactElement {
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      id={id}
      onClick={onClick}
      className={cn(
        'text-left w-full bg-[var(--surface-3)] border border-[var(--brand-border)]',
        'rounded-[var(--radius-md)] px-[10px] py-[9px] transition-colors',
        onClick ? 'cursor-pointer hover:border-[var(--brand-border-hover)]' : 'cursor-default',
        className,
      )}
      style={{ transitionDuration: 'var(--dur-fast)', ...style }}
    >
      {title && (
        <div className={cn('t-ui font-semibold text-[var(--brand-text-bright)]', (children || meta) && 'mb-1')}>
          {title}
        </div>
      )}
      {meta && <div className="t-caption-sm text-[var(--brand-text-dim)]">{meta}</div>}
      {children}
    </Tag>
  );
}
