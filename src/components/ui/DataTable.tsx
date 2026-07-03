// @ds-rebuilt
import type { CSSProperties, ReactElement, ReactNode } from 'react';

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

export function DataTable(_props: DataTableProps): ReactElement {
  throw new Error('F3 stub — DataTable not yet implemented (Lane B)');
}
