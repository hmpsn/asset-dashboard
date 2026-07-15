// @ds-rebuilt
import { Badge, Button, Icon } from '../../ui';
import { formatDate } from '../globalOpsFormatters';
import type { RoadmapDisplayRow, RoadmapPriority, RoadmapRuntimeStatus } from './roadmapDisplayTypes';

function statusLabel(status: RoadmapRuntimeStatus) {
  if (status === 'deferred') return 'On hold';
  if (status === 'closed') return 'Closed';
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusIcon(status: RoadmapRuntimeStatus) {
  if (status === 'done') return 'check' as const;
  if (status === 'in_progress') return 'clock' as const;
  if (status === 'closed') return 'x' as const;
  return 'minus' as const;
}

function statusClass(status: RoadmapRuntimeStatus) {
  if (status === 'done') return 'text-[var(--emerald)]';
  if (status === 'in_progress') return 'text-[var(--amber)]';
  return 'text-[var(--brand-text-dim)]';
}

function priorityTone(priority: RoadmapPriority | '—') {
  if (priority === 'P0') return 'red' as const;
  if (priority === 'P1') return 'amber' as const;
  if (priority === 'P2' || priority === 'P3') return 'blue' as const;
  return 'zinc' as const;
}

interface RoadmapItemRowProps {
  row: RoadmapDisplayRow;
  expanded: boolean;
  cycling: boolean;
  variant?: 'sprint' | 'backlog';
  onToggle: () => void;
  onCycle: () => void;
}

export function RoadmapItemRow({ row, expanded, cycling, variant = 'sprint', onToggle, onCycle }: RoadmapItemRowProps) {
  const deferred = row.status === 'deferred';
  const closed = row.status === 'closed';
  const backlog = variant === 'backlog';
  const cycleLabel = closed
    ? `${row.title} is closed and was not shipped`
    : deferred
    ? `Re-open ${row.title} as pending`
    : `Cycle ${row.title} status from ${statusLabel(row.status)}`;

  const idCell = (
    <span
      className="block truncate text-right t-mono tabular-nums text-[var(--brand-text-dim)]"
      title={row.id}
    >
      {row.id}
    </span>
  );

  const statusControl = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={cycleLabel}
      title={cycleLabel}
      disabled={closed || cycling}
      onClick={onCycle}
      className={`h-7 min-w-0 w-7 px-0 transition-transform enabled:hover:scale-110 disabled:cursor-not-allowed ${statusClass(row.status)}`}
      style={{ transitionDuration: 'var(--dur-fast)' }}
    >
      <Icon name={statusIcon(row.status)} size="sm" />
    </Button>
  );

  return (
    <div className="border-t border-[var(--brand-border)] first:border-t-0">
      {backlog ? (
        <div
          data-testid={`roadmap-backlog-row-${row.rowKey}`}
          data-layout="six-column"
          className="grid min-h-[46px] min-w-[760px] grid-cols-[100px_28px_minmax(0,1fr)_72px_62px_96px] items-center gap-3 px-[15px] py-2 hover:bg-[var(--surface-3)]"
        >
          {idCell}
          {statusControl}
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            {/* muted-tier-ok: completed work is intentionally tertiary and struck through. */}
            <span className={`truncate t-caption font-semibold ${row.status === 'done' ? 'text-[var(--brand-text-dim)] line-through' : 'text-[var(--brand-text-bright)]'}`}>{row.title}</span>
            {row.feature && <Badge label={row.feature} tone="blue" variant="soft" />}
          </div>
          <Badge label={row.priority} tone={priorityTone(row.priority)} variant="soft" />
          <span className="t-mono tabular-nums text-[var(--brand-text-dim)]">{row.est}</span>
          <div className="flex min-w-0 items-center justify-between gap-1">
            <span className="truncate t-caption-sm text-[var(--brand-text-muted)]">{statusLabel(row.status)}</span>
            <Button variant="ghost" size="sm" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.title}`} aria-expanded={expanded} onClick={onToggle} className="h-7 min-w-0 w-7 shrink-0 px-0">
              <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size="sm" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid min-h-[46px] grid-cols-[100px_28px_minmax(0,1fr)_auto_30px] items-center gap-2 px-[15px] py-2 hover:bg-[var(--surface-3)]">
          {idCell}
          {statusControl}
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            {/* muted-tier-ok: completed work is intentionally tertiary and struck through. */}
            <span className={`truncate t-caption font-semibold ${row.status === 'done' ? 'text-[var(--brand-text-dim)] line-through' : 'text-[var(--brand-text-bright)]'}`}>{row.title}</span>
            <Badge label={row.priority} tone={priorityTone(row.priority)} variant="soft" />
            {deferred && <Badge label="On hold" tone="zinc" variant="outline" />}
            {closed && <Badge label="Closed" tone="zinc" variant="outline" />}
            {row.feature && <Badge label={row.feature} tone="blue" variant="soft" />}
            {row.tags.slice(0, 2).map((tag) => <Badge key={tag} label={tag} tone="zinc" variant="outline" />)}
          </div>
          <span className="t-mono tabular-nums text-[var(--brand-text-dim)]">{row.est}</span>
          <Button variant="ghost" size="sm" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.title}`} aria-expanded={expanded} onClick={onToggle} className="min-w-0 px-1.5">
            <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size="sm" />
          </Button>
        </div>
      )}
      {expanded && (
        <div className={`${backlog ? 'min-w-[760px] pl-[155px]' : 'pl-[115px]'} pb-3 pr-[15px]`}>
          <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2.5">
            <p className="t-caption text-[var(--brand-text)]">{row.notes || 'No description added yet.'}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 t-caption-sm text-[var(--brand-text-muted)]">
              {backlog && <span>Sprint: {row.sprint}</span>}
              <span>Source: {row.source}</span><span>Added: {row.createdAt ? formatDate(row.createdAt) : '—'}</span>
              {row.shippedAt && <span>Shipped: {formatDate(row.shippedAt)}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
