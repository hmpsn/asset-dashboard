// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import { cn } from '../../../lib/utils';
import { Avatar } from '../Avatar';
import { Badge } from '../Badge';
import { Icon } from '../Icon';

export type ClientHealthTone = 'ok' | 'risk' | 'new';

export interface ClientSwitcherRowProps {
  name: string;
  meta?: string;
  initials?: string;
  health?: ClientHealthTone;
  badge?: string;
  active?: boolean;
  onSelect?: () => void;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

const HEALTH_COLOR: Record<ClientHealthTone, string> = {
  ok: 'var(--emerald)',
  risk: 'var(--amber)',
  new: 'var(--brand-text-muted)',
};

/**
 * co .co-crow -> DS client switcher row. Existing Avatar/Badge cover identity
 * and count chrome; this primitive supplies the shared row affordance.
 */
export function ClientSwitcherRow({
  name,
  meta,
  initials,
  health = 'new',
  badge,
  active = false,
  onSelect,
  className,
  id,
  style,
}: ClientSwitcherRowProps): ReactElement {
  const Tag = onSelect ? 'button' : 'div';
  return (
    <Tag
      id={id}
      onClick={onSelect}
      className={cn(
        'flex min-h-[50px] w-full items-center gap-3 border-t border-[var(--brand-border)] px-4 py-2.5 text-left',
        'bg-[var(--surface-2)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]',
        onSelect && 'cursor-pointer hover:bg-[var(--surface-3)]',
        active && 'bg-[var(--surface-3)]',
        className,
      )}
      style={style}
    >
      <Avatar initials={initials} label={name} size="md" tone="teal" />
      <span className="min-w-0 flex-1">
        <span className="block truncate t-ui font-semibold text-[var(--brand-text-bright)]">{name}</span>
        {meta && <span className="mt-0.5 block truncate t-caption-sm text-[var(--brand-text-muted)]">{meta}</span>}
      </span>
      <span
        aria-label={`Health: ${health}`}
        role="img"
        className="h-2 w-2 flex-none rounded-[var(--radius-pill)]"
        style={{ background: HEALTH_COLOR[health] }}
      />
      {badge && <Badge label={badge} tone="amber" variant="soft" shape="pill" />}
      {onSelect && <Icon name="arrowRight" size="sm" className="flex-none text-[var(--brand-text-dim)]" aria-hidden="true" />}
    </Tag>
  );
}
