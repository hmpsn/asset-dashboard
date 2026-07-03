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

const WIDTH_TOKENS: Record<'default' | 'narrow' | 'wide' | 'full', string> = {
  default: 'var(--page-max)',
  narrow: 'var(--page-max-narrow)',
  wide: 'var(--page-max-wide)',
  full: 'none',
};

export function PageContainer({
  width = 'default',
  center = false,
  gap = true,
  as = 'div',
  children,
  className,
  id,
  style,
}: PageContainerProps): ReactElement {
  const maxWidth = typeof width === 'number' ? `${width}px` : WIDTH_TOKENS[width];
  const Component = as;

  return (
    <Component
      id={id}
      className={className}
      style={{
        maxWidth,
        margin: center ? '0 auto' : 0,
        padding: 'var(--page-pad-y) var(--page-pad-x) var(--page-pad-bottom)',
        display: gap ? 'flex' : undefined,
        flexDirection: gap ? 'column' : undefined,
        gap: gap ? 'var(--section-gap)' : undefined,
        ...style,
      }}
    >
      {children}
    </Component>
  );
}
