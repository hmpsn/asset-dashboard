// @ds-rebuilt
import type { CSSProperties, ReactElement, ReactNode } from 'react';

/**
 * Controls row above tables/boards/lists. A wrapping flex row on one spacing
 * rhythm; separate left controls (search/filters/lens) from right actions with
 * a `<ToolbarSpacer/>`. role="toolbar" + arrow-key focus movement between
 * controls (useRovingTabindex).
 */
export interface ToolbarProps {
  children?: ReactNode;
  gap?: number | string;
  align?: 'center' | 'flex-start' | 'flex-end' | 'baseline';
  wrap?: boolean;
  /** Accessible label for the role="toolbar" region. */
  label?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function Toolbar(_props: ToolbarProps): ReactElement {
  throw new Error('F3 stub — Toolbar not yet implemented (Lane D)');
}

/** Flexible spacer that pushes following Toolbar items to the right. */
export function ToolbarSpacer(): ReactElement {
  throw new Error('F3 stub — ToolbarSpacer not yet implemented (Lane D)');
}
