// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import { cn } from '../../../lib/utils';
import { Avatar } from '../Avatar';
import { Badge, type BadgeTone } from '../Badge';
import { Icon } from '../Icon';

export type ClientThreadKind = 'approval' | 'reply' | 'request' | 'instruction';

export interface ClientThreadRowProps {
  author: string;
  message: string;
  kind: ClientThreadKind;
  when?: string;
  initials?: string;
  onPromote?: () => void;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

const KIND_META: Record<ClientThreadKind, { label: string; tone: BadgeTone }> = {
  approval: { label: 'Approved', tone: 'emerald' },
  reply: { label: 'Reply', tone: 'blue' },
  request: { label: 'Request', tone: 'amber' },
  instruction: { label: 'Instruction', tone: 'blue' },
};

/**
 * co .co-trow / ck .ck-frow -> DS client thread row. Badge handles kind tone;
 * optional promote action uses the action-law teal treatment.
 */
export function ClientThreadRow({
  author,
  message,
  kind,
  when,
  initials,
  onPromote,
  className,
  id,
  style,
}: ClientThreadRowProps): ReactElement {
  const meta = KIND_META[kind];
  return (
    <div
      id={id}
      className={cn('flex items-start gap-3 border-t border-[var(--brand-border)] bg-[var(--surface-2)] px-4 py-3', className)}
      style={style}
    >
      <Avatar initials={initials} label={author} size="sm" tone="blue" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate t-ui font-semibold text-[var(--brand-text-bright)]">{author}</span>
          <Badge label={meta.label} tone={meta.tone} variant="soft" shape="pill" />
          {when && <span className="ml-auto t-caption-sm text-[var(--brand-text-muted)]">{when}</span>}
        </div>
        <p className="m-0 mt-1 t-caption text-[var(--brand-text)]">{message}</p>
        {onPromote && (
          <button
            type="button"
            onClick={onPromote}
            className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--teal)] px-2.5 py-1.5 t-caption-sm font-semibold text-[var(--button-primary-text)] transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:opacity-90"
          >
            <Icon name="arrowUp" size="sm" aria-hidden="true" />
            Promote to signal
          </button>
        )}
      </div>
    </div>
  );
}
