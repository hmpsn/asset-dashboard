// @ds-rebuilt
import { useState, useMemo, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';
import { useRovingTabindex } from './useRovingTabindex';
import { Inbox } from 'lucide-react';

export interface DataColumn {
  /** Row-object key this column reads. */
  key: string;
  /** Header label (rendered uppercase mono). */
  label: string;
  /** grid-template width: e.g. '1fr', '84px', '1.6fr'. Default '1fr'. */
  width?: string;
  align?: 'left' | 'center' | 'right';
  /** Custom cell renderer — receives (value, row, index). Falls back to the raw value. */
  render?: (value: unknown, row: Record<string, unknown>, index: number) => ReactNode;
  /** Enable a sortable header for this column (aria-sort + click/Enter/Space toggles). */
  sortable?: boolean;
}

/**
 * Grid-based data table. One column spec drives both the sticky uppercase-mono
 * header and the hairline-divided rows. Right-aligned columns get tabular-nums
 * automatically. Rows are keyboard-activatable when `onRowClick` is passed.
 */
export interface DataTableProps {
  columns: DataColumn[];
  rows: Record<string, unknown>[];
  onRowClick?: (row: Record<string, unknown>, index: number) => void;
  getRowKey?: (row: Record<string, unknown>, index: number) => string | number;
  stickyHeader?: boolean;
  /** Render Skeleton placeholder rows instead of data. */
  loading?: boolean;
  /** Rendered via <EmptyState> when `rows` is empty and not loading. */
  empty?: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

type SortDirection = 'ascending' | 'descending' | 'none';

function cellAlignClass(align?: DataColumn['align']): string {
  if (align === 'right') return 'justify-end text-right';
  if (align === 'center') return 'justify-center text-center';
  return 'justify-start text-left';
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function DataTable({
  columns,
  rows,
  onRowClick,
  getRowKey,
  stickyHeader = true,
  loading = false,
  empty,
  className,
  id,
  style,
}: DataTableProps): ReactElement {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>('none');

  const template = columns.map((c) => c.width || '1fr').join(' ');

  const sortedRows = useMemo(() => {
    if (!sortKey || sortDir === 'none') return rows;
    const dir = sortDir === 'ascending' ? 1 : -1;
    return [...rows].sort((a, b) => dir * compareValues(a[sortKey], b[sortKey]));
  }, [rows, sortKey, sortDir]);

  const roving = useRovingTabindex(onRowClick ? sortedRows.length : 0, {
    orientation: 'vertical',
    onActivate: (index) => onRowClick?.(sortedRows[index], index),
  });

  const cycleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('ascending');
      return;
    }
    if (sortDir === 'ascending') setSortDir('descending');
    else if (sortDir === 'descending') {
      setSortDir('none');
      setSortKey(null);
    } else {
      setSortDir('ascending');
    }
  };

  const ariaSortFor = (col: DataColumn): 'none' | 'ascending' | 'descending' | undefined => {
    if (!col.sortable) return undefined;
    return sortKey === col.key ? sortDir : 'none';
  };

  const isEmpty = sortedRows.length === 0 && !loading;

  return (
    <div
      id={id}
      className={cn(
        'bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] overflow-hidden',
        className,
      )}
      style={style}
    >
      <div
        role="row"
        className={cn(
          'grid items-center gap-2.5 px-[18px] py-[11px] bg-[var(--surface-1)] border-b border-[var(--brand-border)]',
          stickyHeader && 'sticky top-0 z-[var(--z-sticky)]',
        )}
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((col) => {
          const sortState = ariaSortFor(col);
          const headerContent = (
            <span className="t-mono whitespace-nowrap text-[var(--brand-text-dim)]">{col.label}</span>
          );
          if (!col.sortable) {
            return (
              <span key={col.key} role="columnheader" className={cellAlignClass(col.align)}>
                {headerContent}
              </span>
            );
          }
          return (
            <span
              key={col.key}
              role="columnheader"
              aria-sort={sortState}
              tabIndex={0}
              onClick={() => cycleSort(col.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  cycleSort(col.key);
                }
              }}
              className={cn(
                'cursor-pointer select-none flex items-center gap-1',
                cellAlignClass(col.align),
              )}
            >
              {headerContent}
            </span>
          );
        })}
      </div>

      {loading &&
        Array.from({ length: 5 }).map((_, i) => (
          <div
            key={`skeleton-${i}`}
            className="grid items-center gap-2.5 px-[18px] py-3 border-t border-[var(--brand-border)] first:border-t-0"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((col) => (
              <Skeleton key={col.key} className="h-3 w-full" />
            ))}
          </div>
        ))}

      {isEmpty && (
        <div className="col-span-full">
          {empty && typeof empty !== 'string' ? (
            empty
          ) : (
            <EmptyState icon={Inbox} title={typeof empty === 'string' ? empty : 'No data yet'} />
          )}
        </div>
      )}

      {!loading &&
        sortedRows.map((row, i) => {
          const key = getRowKey ? getRowKey(row, i) : i;
          const rowProps = onRowClick ? roving.getItemProps(i) : null;
          return (
            <div
              key={key}
              role={onRowClick ? 'button' : 'row'}
              tabIndex={rowProps ? rowProps.tabIndex : undefined}
              ref={rowProps ? (rowProps.ref as (el: HTMLDivElement | null) => void) : undefined}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              onKeyDown={rowProps ? rowProps.onKeyDown : undefined}
              onFocus={rowProps ? rowProps.onFocus : undefined}
              className={cn(
                'grid items-center gap-2.5 px-[18px] py-3 border-t border-[var(--brand-border)] first:border-t-0 t-body text-[var(--brand-text)]',
                'transition-colors',
                onRowClick && 'cursor-pointer hover:bg-[var(--surface-3)]',
              )}
              style={{
                gridTemplateColumns: template,
                transitionDuration: 'var(--dur-fast)',
              }}
            >
              {columns.map((col) => (
                <div
                  key={col.key}
                  className={cn(
                    'flex items-center min-w-0',
                    cellAlignClass(col.align),
                    col.align === 'right' && 'tabular-nums font-semibold text-[var(--brand-text-bright)]',
                  )}
                >
                  {col.render ? (
                    col.render(row[col.key], row, i)
                  ) : (
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {row[col.key] as ReactNode}
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })}
    </div>
  );
}
