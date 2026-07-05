// @ds-rebuilt
import {
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../Icon';

export interface NavItemProps {
  icon?: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  badge?: ReactNode;
  meta?: string;
  accent?: string;
  href?: string;
  onClick?: () => void;
  title?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
  tabIndex?: 0 | -1;
  itemRef?: (element: HTMLElement | null) => void;
  onFocus?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLAnchorElement | HTMLButtonElement>) => void;
}

type NavItemStyle = CSSProperties & { '--nav-accent'?: string };

export function NavItem({
  icon,
  label,
  active = false,
  disabled = false,
  badge,
  meta,
  accent = 'var(--teal)',
  href,
  onClick,
  title,
  className,
  id,
  style,
  tabIndex,
  itemRef,
  onFocus,
  onKeyDown,
}: NavItemProps): ReactElement {
  const [isInteractive, setIsInteractive] = useState(false);
  const interactive = isInteractive && !active && !disabled;
  const Component = href ? 'a' : 'button';
  const mergedStyle: NavItemStyle = {
    '--nav-accent': accent,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: 44,
    boxSizing: 'border-box',
    textAlign: 'left',
    textDecoration: 'none',
    padding: '8px 10px',
    margin: '1px 0',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    outline: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    pointerEvents: disabled ? 'none' : undefined,
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    fontWeight: 500,
    lineHeight: 1.2,
    background: active
      ? 'color-mix(in srgb, var(--nav-accent) 12%, transparent)'
      : interactive
        ? 'color-mix(in srgb, var(--nav-accent) 7%, transparent)'
        : 'transparent',
    color: active || interactive ? 'var(--nav-accent)' : 'var(--brand-text)',
    opacity: disabled ? 0.52 : 1,
    transition:
      'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out)',
    ...style,
  };

  const handleClick = (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.();
  };

  const commonProps = {
    id,
    className,
    title,
    style: mergedStyle,
    'aria-current': active ? 'page' as const : undefined,
    'aria-disabled': disabled ? 'true' as const : undefined,
    onMouseEnter: () => setIsInteractive(true),
    onMouseLeave: () => setIsInteractive(false),
    onFocus: () => {
      setIsInteractive(true);
      onFocus?.();
    },
    onBlur: () => setIsInteractive(false),
    onKeyDown,
    onClick: handleClick,
    ref: itemRef,
    tabIndex,
  };

  return (
    <Component
      {...commonProps}
      {...(href ? { href: disabled ? undefined : href } : { type: 'button' as const, disabled })}
    >
      {active && (
        <span
          data-testid="navitem-active-accent"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -8,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 3,
            height: 18,
            background: 'var(--nav-accent)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          }}
        />
      )}
      {icon && (
        <Icon
          as={icon}
          size="sm"
          style={{
            flexShrink: 0,
            color: active || interactive ? 'var(--nav-accent)' : 'var(--brand-text-dim)',
          }}
        />
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {badge != null && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 700,
            minWidth: 20,
            textAlign: 'center',
            padding: '2px 6px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--brand-yellow-dim)',
            color: 'var(--brand-yellow)',
            lineHeight: 1.2,
          }}
        >
          {badge}
        </span>
      )}
      {meta && (
        <span
          style={{
            flexShrink: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            fontWeight: 600,
            color: 'var(--brand-text-dim)',
            opacity: 0.82,
          }}
        >
          {meta}
        </span>
      )}
    </Component>
  );
}
