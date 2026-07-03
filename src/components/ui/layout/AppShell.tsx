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

const MAIN_CONTENT_ID = 'app-shell-main-content';

export function AppShell({ sidebar, topbar, rail = false, children, className, id, style }: AppShellProps): ReactElement {
  return (
    <div
      id={id}
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `${rail ? 'var(--shell-sidebar-rail)' : 'var(--shell-sidebar)'} 1fr`,
        height: '100vh',
        background: 'var(--surface-1)',
        color: 'var(--brand-text)',
        transition: 'grid-template-columns var(--dur-base) var(--ease-out)',
        ...style,
      }}
    >
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="t-ui"
        style={{
          position: 'absolute',
          left: -9999,
          top: 'auto',
          width: 1,
          height: 1,
          overflow: 'hidden',
          zIndex: 'var(--z-toast)',
          background: 'var(--surface-2)',
          color: 'var(--brand-text-bright)',
          padding: '10px 16px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--brand-border)',
        }}
        onFocus={(e) => {
          e.currentTarget.style.left = '10px';
          e.currentTarget.style.top = '10px';
          e.currentTarget.style.width = 'auto';
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.overflow = 'visible';
        }}
        onBlur={(e) => {
          e.currentTarget.style.left = '-9999px';
          e.currentTarget.style.top = 'auto';
          e.currentTarget.style.width = '1px';
          e.currentTarget.style.height = '1px';
          e.currentTarget.style.overflow = 'hidden';
        }}
      >
        Skip to content
      </a>
      <aside
        style={{
          background: 'var(--surface-1)',
          borderRight: '1px solid var(--brand-border)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          overflow: 'visible',
        }}
      >
        {sidebar}
      </aside>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {topbar && (
          <header
            style={{
              height: 'var(--shell-topbar)',
              flexShrink: 0,
              borderBottom: '1px solid var(--brand-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '0 22px',
            }}
          >
            {topbar}
          </header>
        )}
        <div
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', containerType: 'inline-size' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
