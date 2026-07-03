// @ds-rebuilt
import type { CSSProperties, ReactElement, ReactNode } from 'react';

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

export function BoardColumn(_props: BoardColumnProps): ReactElement {
  throw new Error('F3 stub — BoardColumn not yet implemented (Lane B)');
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

export function BoardCard(_props: BoardCardProps): ReactElement {
  throw new Error('F3 stub — BoardCard not yet implemented (Lane B)');
}
