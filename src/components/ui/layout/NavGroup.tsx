// @ds-rebuilt
import { useId, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Icon } from '../Icon';

export interface NavGroupProps {
  label: string;
  accent?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  children: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

type NavGroupStyle = CSSProperties & { '--nav-group-accent'?: string };

export function NavGroup({
  label,
  accent = 'var(--brand-text-dim)',
  collapsed = false,
  onToggleCollapse,
  children,
  className,
  id,
  style,
}: NavGroupProps): ReactElement {
  const generatedId = useId();
  const headerId = `${id ?? generatedId}-header`;
  const regionId = `${id ?? generatedId}-items`;
  const rootStyle: NavGroupStyle = {
    '--nav-group-accent': accent,
    margin: '0 0 4px',
    ...style,
  };

  if (!label) {
    return (
      <div id={id} className={className} style={rootStyle}>
        {children}
      </div>
    );
  }

  return (
    <div id={id} className={className} style={rootStyle}>
      <button
        id={headerId}
        type="button"
        aria-expanded={!collapsed}
        aria-controls={regionId}
        onClick={onToggleCollapse}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          width: '100%',
          minHeight: 32,
          padding: '14px 8px 5px',
          border: 'none',
          background: 'transparent',
          color: 'var(--nav-group-accent)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.11em',
          textTransform: 'uppercase',
          opacity: 0.9,
          transition: 'color var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out)',
        }}
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          style={{
            flex: 1,
            height: 1,
            background: 'var(--nav-group-accent)',
            opacity: 0.35,
          }}
        />
        <Icon
          name="chevronDown"
          size="sm"
          style={{
            flexShrink: 0,
            color: 'var(--nav-group-accent)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform var(--dur-fast) var(--ease-out)',
          }}
        />
      </button>
      <div id={regionId} role="region" aria-labelledby={headerId} hidden={collapsed}>
        {children}
      </div>
    </div>
  );
}
