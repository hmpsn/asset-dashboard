// @ds-rebuilt
import { useEffect, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { isEditableKeyTarget } from '../../../lib/keyboardGuards';

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
  /** Persistent shell content rendered outside the scrolling page canvas. */
  footer?: ReactNode;
  /** Collapse the sidebar to --shell-sidebar-rail. */
  rail?: boolean;
  /** Controlled focus mode: collapses the sidebar rail while true. */
  focusMode?: boolean;
  /** Called with false when focus mode should exit, such as a non-editing Escape press. */
  onFocusModeChange?: (focusMode: boolean) => void;
  children?: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

const MAIN_CONTENT_ID = 'app-shell-main-content';

function hasOpenOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  // Modal/Drawer/Popover own Escape while open; focus mode exits only after they are gone.
  return document.querySelector('[aria-modal="true"], [data-modal-backdrop="true"], [data-drawer-backdrop="true"], [data-popover-menu="true"]') !== null;
}

export function AppShell({
  sidebar,
  topbar,
  footer,
  rail = false,
  focusMode,
  onFocusModeChange,
  children,
  className,
  id,
  style,
}: AppShellProps): ReactElement {
  const collapsedRail = rail || focusMode === true;

  useEffect(() => {
    if (focusMode !== true) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isEditableKeyTarget(event.target)) return;
      if (hasOpenOverlay()) return;
      onFocusModeChange?.(false);
    };

    document.addEventListener('keydown', handleKeyDown); // keydown-ok — guarded for editable targets and only active while focusMode is true.
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [focusMode, onFocusModeChange]);

  return (
    <div
      id={id}
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `${collapsedRail ? 'var(--shell-sidebar-rail)' : 'var(--shell-sidebar)'} 1fr`,
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
        {footer && <footer style={{ flexShrink: 0 }}>{footer}</footer>}
      </div>
    </div>
  );
}
