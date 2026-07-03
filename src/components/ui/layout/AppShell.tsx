// @ds-rebuilt
import type { CSSProperties, ReactElement, ReactNode } from 'react';

/**
 * The application frame: a sidebar column + a main column (optional top bar over
 * a scrolling canvas), sized from the shell tokens. `rail` collapses the sidebar
 * to the icon rail width. Page content goes in children — usually a
 * `PageContainer`. Presentational only — NO nav content/registry/flags (F4
 * wires `sidebar`/`topbar` from navRegistry). The prop names below are the
 * frozen F4 wiring surface (review CP3) — do not rename.
 */
export interface AppShellProps {
  /** Nav slot (F4 fills this from navRegistry.tsx). */
  sidebar?: ReactNode;
  topbar?: ReactNode;
  /** Collapse the sidebar to --shell-sidebar-rail. */
  rail?: boolean;
  children?: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

export function AppShell(_props: AppShellProps): ReactElement {
  throw new Error('F3 stub — AppShell not yet implemented (Lane D)');
}
