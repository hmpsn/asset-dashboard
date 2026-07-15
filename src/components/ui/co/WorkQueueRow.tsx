// @ds-rebuilt
import type { CSSProperties, ReactElement } from 'react';
import type { WorkQueueItem, WorkQueueStream } from '../../../../shared/types/work-queue';
import { cn } from '../../../lib/utils';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import type { IconName } from '../iconNames';
import { ProvenanceChip, type ProvenanceBasis } from './ProvenanceChip';

export interface WorkQueueRowProps {
  item: WorkQueueItem;
  clientName?: string;
  clientInitials?: string;
  actionLabel?: string;
  onAction?: () => void;
  provenance?: ProvenanceBasis;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

const STREAM_ACTION: Record<WorkQueueStream, { color: string; icon: IconName }> = {
  opt: { color: 'var(--blue)', icon: 'gauge' },
  send: { color: 'var(--teal)', icon: 'send' },
  money: { color: 'var(--amber)', icon: 'trophy' },
  unclassified: { color: 'var(--brand-text-muted)', icon: 'bell' },
};

/**
 * co .co-sig -> DS work queue row. Avatar/metadata compose existing primitives;
 * only the row layout is new because cockpit/global ops share this queue shape.
 */
export function WorkQueueRow({
  item,
  clientName,
  clientInitials,
  actionLabel,
  onAction,
  provenance,
  className,
  id,
  style,
}: WorkQueueRowProps): ReactElement {
  const stream = STREAM_ACTION[item.stream];
  const action = actionLabel ?? (item.stream === 'send' ? 'Send' : item.stream === 'money' ? 'Propose' : 'Open');
  const impactTone = item.direction === 'positive'
    ? 'var(--emerald)'
    : item.direction === 'negative'
      ? 'var(--red)'
      : 'var(--brand-text)';

  return (
    <div
      id={id}
      className={cn(
        'flex min-h-[58px] items-center gap-3 border-t border-[var(--brand-border)] px-4 py-2.5',
        'bg-[var(--surface-2)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[var(--surface-3)]',
        className,
      )}
      style={style}
    >
      <Avatar initials={clientInitials} label={clientName} size="sm" tone="teal" />
      <div className="min-w-0 flex-1">
        <div className="truncate t-ui font-semibold text-[var(--brand-text-bright)]">{item.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 t-caption-sm text-[var(--brand-text-muted)]">
          {clientName && <span className="font-semibold text-[var(--brand-text)]">{clientName}</span>}
          <span>{item.meta}</span>
        </div>
      </div>
      {(item.impact || provenance) && (
        <div className="hidden min-w-[76px] flex-none text-right sm:block">
          {item.impact && <div className="t-ui font-semibold" style={{ color: impactTone }}>{item.impact}</div>}
          {provenance && <div className="mt-1"><ProvenanceChip basis={provenance} /></div>}
        </div>
      )}
      <button
        type="button"
        onClick={onAction}
        className="inline-flex flex-none items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-3)] px-3 py-1.5 t-caption-sm font-semibold transition-[border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--brand-border-hover)]"
        style={{ color: stream.color }}
      >
        <Icon name={stream.icon} size="sm" aria-hidden="true" />
        {action}
      </button>
    </div>
  );
}
