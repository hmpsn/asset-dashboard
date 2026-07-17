// @ds-rebuilt
import { Bell, Gauge, Send, Trophy, type LucideIcon } from 'lucide-react';
import type { WorkQueueClassification, WorkQueueItem, WorkQueueSourceType, WorkQueueStream } from '../../../shared/types/work-queue';
import {
  Button,
  EmptyState,
  FilterChip,
  GroupBlock,
  Icon,
  WorkQueueRow,
  WorkStreamSelector,
  type SelectableWorkStream,
} from '../ui';
import { sourceTypeLabel } from './engineFormatters';
import type { EngineStreamFilter } from './useEngineSurfaceState';

interface EngineWorkQueueProps {
  workQueue: WorkQueueClassification;
  stream: EngineStreamFilter;
  onStreamChange: (stream: EngineStreamFilter) => void;
  activeSourceTypes: Set<string>;
  sourceTypeCounts: Partial<Record<WorkQueueSourceType, number>>;
  onToggleSourceType: (sourceType: WorkQueueSourceType) => void;
  onClearSourceTypes: () => void;
  clientName: string;
  clientInitials: string;
  onOpenItem: (item: WorkQueueItem) => void;
  title?: string;
  emptyTitle?: string;
}

const STREAM_META: Record<WorkQueueStream, {
  label: string;
  description: string;
  groupTitle: string;
  icon: LucideIcon;
  iconName: 'gauge' | 'send' | 'trophy' | 'bell';
  color: string;
}> = {
  opt: {
    label: 'Optimize',
    description: 'Technical and content improvements to open.',
    groupTitle: 'Optimization queue',
    icon: Gauge,
    iconName: 'gauge',
    color: 'var(--blue)',
  },
  send: {
    label: 'Send',
    description: 'Client-facing work ready for review.',
    groupTitle: 'Send-ready queue',
    icon: Send,
    iconName: 'send',
    color: 'var(--teal)',
  },
  money: {
    label: 'Growth',
    description: 'Upsell and value-proof work backed by measured results.',
    groupTitle: 'Growth queue',
    icon: Trophy,
    iconName: 'trophy',
    color: 'var(--amber)',
  },
  unclassified: {
    label: 'Needs triage',
    description: 'Client signals and anything not yet sorted',
    groupTitle: 'Needs triage',
    icon: Bell,
    iconName: 'bell',
    color: 'var(--brand-text-muted)',
  },
};

const SOURCE_ORDER: WorkQueueSourceType[] = [
  'request',
  'work_order',
  'content_request',
  'content_pipeline',
  'content_decay',
  'audit_error',
  'rank_drop',
  'churn_signal',
  'setup_gap',
];

function EmptyQueueIcon({ className }: { className?: string }) {
  return <Icon name="check" className={className} />;
}

function visibleItems(
  items: WorkQueueItem[],
  stream: EngineStreamFilter,
  activeSourceTypes: Set<string>,
): WorkQueueItem[] {
  return items.filter((item) => {
    const streamMatch = stream === 'all' || item.stream === stream;
    const sourceMatch = activeSourceTypes.size === 0 || activeSourceTypes.has(item.sourceType);
    return streamMatch && sourceMatch;
  });
}

function groupItems(items: WorkQueueItem[], stream: EngineStreamFilter): Array<[WorkQueueStream, WorkQueueItem[]]> {
  const streams: WorkQueueStream[] = stream === 'all'
    ? ['opt', 'send', 'money', 'unclassified']
    : [stream];
  return streams
    .map((streamId) => [streamId, items.filter((item) => item.stream === streamId)] as [WorkQueueStream, WorkQueueItem[]])
    .filter(([, rows]) => rows.length > 0);
}

export function EngineWorkQueue({
  workQueue,
  stream,
  onStreamChange,
  activeSourceTypes,
  sourceTypeCounts,
  onToggleSourceType,
  onClearSourceTypes,
  clientName,
  clientInitials,
  onOpenItem,
  title = 'Engine work queue',
  emptyTitle = 'No queue rows match this view',
}: EngineWorkQueueProps) {
  const primaryStream: SelectableWorkStream = stream === 'send' || stream === 'money' || stream === 'opt' ? stream : 'opt';
  const filteredItems = visibleItems(workQueue.items, stream, activeSourceTypes);
  const grouped = groupItems(filteredItems, stream);
  const sourceTypes = SOURCE_ORDER.filter((sourceType) => (sourceTypeCounts[sourceType] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-3" data-testid="engine-work-queue">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="t-ui font-semibold text-[var(--brand-text-bright)]">{title}</h2>
          {activeSourceTypes.size > 0 && (
            <Button variant="link" size="sm" onClick={onClearSourceTypes}>
              Clear filters
            </Button>
          )}
        </div>
        <WorkStreamSelector
          ariaLabel="Engine work streams"
          value={primaryStream}
          onChange={onStreamChange}
          options={[
            {
              id: 'opt',
              label: STREAM_META.opt.label,
              description: STREAM_META.opt.description,
              count: workQueue.streams.opt,
              iconName: STREAM_META.opt.iconName,
            },
            {
              id: 'send',
              label: STREAM_META.send.label,
              description: STREAM_META.send.description,
              count: workQueue.streams.send,
              iconName: STREAM_META.send.iconName,
            },
            {
              id: 'money',
              label: STREAM_META.money.label,
              description: STREAM_META.money.description,
              count: workQueue.streams.money,
              iconName: STREAM_META.money.iconName,
            },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Engine queue filters">
        <FilterChip label="All" active={stream === 'all'} count={workQueue.items.length} onClick={() => onStreamChange('all')} />
        <FilterChip label="Needs triage" active={stream === 'unclassified'} count={workQueue.streams.unclassified} onClick={() => onStreamChange('unclassified')} />
        {sourceTypes.map((sourceType) => (
          <FilterChip
            key={sourceType}
            label={sourceTypeLabel(sourceType)}
            count={sourceTypeCounts[sourceType]}
            active={activeSourceTypes.has(sourceType)}
            onClick={() => onToggleSourceType(sourceType)}
          />
        ))}
      </div>

      {grouped.length > 0 ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {grouped.map(([streamId, rows]) => {
            const meta = STREAM_META[streamId];
            return (
              <GroupBlock
                key={streamId}
                title={meta.groupTitle}
                meta={meta.description}
                icon={meta.icon}
                iconColor={meta.color}
                stats={[{ label: 'stream', value: workQueue.streams[streamId], color: meta.color }]}
              >
                <div className="-mx-2 -my-1 overflow-hidden rounded-[var(--radius-md)] border border-[var(--brand-border)]">
                  {rows.map((item) => (
                    <WorkQueueRow
                      key={`${item.stream}-${item.id}`}
                      item={item}
                      clientName={clientName}
                      clientInitials={clientInitials}
                      actionLabel={item.stream === 'send' ? 'Review' : 'Open'}
                      onAction={() => onOpenItem(item)}
                    />
                  ))}
                </div>
              </GroupBlock>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={EmptyQueueIcon}
          title={emptyTitle}
          description="Clear filters or switch streams to review the shared work queue."
          action={activeSourceTypes.size > 0 ? <Button variant="secondary" size="sm" onClick={onClearSourceTypes}>Clear filters</Button> : undefined}
          className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]"
        />
      )}
    </div>
  );
}
