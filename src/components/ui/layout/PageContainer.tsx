// @ds-rebuilt
import type { CSSProperties, ReactElement, ReactNode } from 'react';

/**
 * The page content column — canonical max-width + padding from the layout
 * tokens. `width`: 'default' (--page-max) · 'narrow' (--page-max-narrow,
 * forms/reading) · 'wide' (--page-max-wide, dashboards) · 'full' · or an
 * explicit px number. Left-aligned unless `center`. With `gap` (default)
 * children stack with --section-gap. `as="main"` for the semantic landmark.
 */
export interface PageContainerProps {
  width?: 'default' | 'narrow' | 'wide' | 'full' | number;
  center?: boolean;
  /** Stack children as a flex column with --section-gap. Default true. */
  gap?: boolean;
  /** Render as the semantic <main> landmark (one per page). Default 'div'. */
  as?: 'div' | 'main';
  children?: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function PageContainer(_props: PageContainerProps): ReactElement {
  throw new Error('F3 stub — PageContainer not yet implemented (Lane D)');
}
