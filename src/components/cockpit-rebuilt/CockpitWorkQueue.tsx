// @ds-rebuilt
import { Bell, Gauge, Send, Trophy, type LucideIcon } from 'lucide-react';
import type { WorkQueueClassification, WorkQueueItem, WorkQueueSourceType, WorkQueueStream } from '../../../shared/types/work-queue';
import {
  Button,
  EmptyState,
  FilterChip,
  Icon,
  SectionCard,
  WorkQueueRow,
  WorkStreamSelector,
  type SelectableWorkStream,
} from '../ui';
import { sourceTypeLabel } from './cockpitFormatters';
import type { CockpitStreamFilter } from './useCockpitSurfaceState';

interface CockpitWorkQueueProps {
  workQueue: WorkQueueClassification;
  stream: CockpitStreamFilter;
  onStreamChange: (stream: CockpitStreamFilter) => void;
  activeSourceTypes: Set<string>;
  sourceTypeCounts: Partial<Record<WorkQueueSourceType, number>>;
  onToggleSourceType: (sourceType: string) => void;
  onClearSourceTypes: () => void;
  clientName: string;
  clientInitials: string;
  onOpenItem: (item: WorkQueueItem) => void;
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
    label: 'Money',
    description: 'Value and pricing work with real provenance.',
    groupTitle: 'Money queue',
    icon: Trophy,
    iconName: 'trophy',
    color: 'var(--amber)',
  },
  unclassified: {
    label: 'Risk',
    description: 'Client signals and unclassified attention.',
    groupTitle: 'Risk and unclassified',
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
  stream: CockpitStreamFilter,
  activeSourceTypes: Set<string>,
): WorkQueueItem[] {
  return items.filter((item) => {
    const streamMatch = stream === 'all' || item.stream === stream;
    const sourceMatch = activeSourceTypes.size === 0 || activeSourceTypes.has(item.sourceType);
    return streamMatch && sourceMatch;
  });
}

function groupItems(items: WorkQueueItem[], stream: CockpitStreamFilter): Array<[WorkQueueStream, WorkQueueItem[]]> {
  const streams: WorkQueueStream[] = stream === 'all'
    ? ['opt', 'send', 'money', 'unclassified']
    : [stream];
  return streams
    .map((streamId) => [streamId, items.filter((item) => item.stream === streamId)] as [WorkQueueStream, WorkQueueItem[]])
    .filter(([, rows]) => rows.length > 0);
}

export function CockpitWorkQueue({
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
}: CockpitWorkQueueProps) {
  const primaryStream: SelectableWorkStream = stream === 'send' || stream === 'money' || stream === 'opt' ? stream : 'opt';
  const filteredItems = visibleItems(workQueue.items, stream, activeSourceTypes);
  const grouped = groupItems(filteredItems, stream);
  const sourceTypes = SOURCE_ORDER.filter((sourceType) => (sourceTypeCounts[sourceType] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-3" data-testid="cockpit-work-queue">
      <WorkStreamSelector
        ariaLabel="Cockpit work streams"
        value={primaryStream}
        onChange={onStreamChange}
        options={[
          {
            id: 'opt',
            label: STREAM_META.opt.label,
            description: STREAM_META.opt.description,
            count: workQueue.streams.opt,
            iconName: 'gauge',
          },
          {
            id: 'send',
            label: STREAM_META.send.label,
            description: STREAM_META.send.description,
            count: workQueue.streams.send,
            iconName: 'send',
          },
          {
            id: 'money',
            label: STREAM_META.money.label,
            description: STREAM_META.money.description,
            count: workQueue.streams.money,
            iconName: 'trophy',
          },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2" aria-label="Queue filters">
        <FilterChip label="All" active={stream === 'all'} count={workQueue.items.length} onClick={() => onStreamChange('all')} />
        <FilterChip label="Risk" active={stream === 'unclassified'} count={workQueue.streams.unclassified} onClick={() => onStreamChange('unclassified')} />
        {sourceTypes.map((sourceType) => (
          <FilterChip
            key={sourceType}
            label={sourceTypeLabel(sourceType)}
            count={sourceTypeCounts[sourceType]}
            active={activeSourceTypes.has(sourceType)}
            onClick={() => onToggleSourceType(sourceType)}
          />
        ))}
        {activeSourceTypes.size > 0 && (
          <Button variant="link" size="sm" onClick={onClearSourceTypes}>
            Clear filters
          </Button>
        )}
      </div>

      {grouped.some(([, rows]) => rows.length > 0) ? (
        <SectionCard
          title={`${clientName}'s work queue`}
          titleIcon={<Icon name="bell" size="sm" className="text-[var(--teal)]" />}
          titleExtra={<span className="t-caption-sm text-[var(--brand-text-muted)]">Everything this client needs, grouped by kind</span>}
          noPadding
        >
          <div className="flex flex-col">
            {grouped.map(([streamId, rows]) => {
              if (rows.length === 0) return null;
              const meta = STREAM_META[streamId];
              return (
                <div key={streamId} className="border-t border-[var(--brand-border)] first:border-t-0">
                  {/* co-grp — light inline group header */}
                  <div className="flex items-center gap-2 px-4 pb-1.5 pt-3 t-label" style={{ color: meta.color }}>
                    <Icon name={meta.iconName} size="sm" />
                    <span>{meta.label}</span>
                    <span
                      className="rounded-full px-1.5 t-caption-sm font-semibold tabular-nums"
                      style={{ color: meta.color, backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}
                    >
                      {rows.length}
                    </span>
                  </div>
                  {rows.map((item) => (
                    <WorkQueueRow
                      key={`${item.stream}-${item.id}`}
                      item={item}
                      clientName={clientName}
                      clientInitials={clientInitials}
                      actionLabel={item.sourceType === 'work_order' ? 'Open panel' : undefined}
                      onAction={() => onOpenItem(item)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </SectionCard>
      ) : (
        <EmptyState
          icon={EmptyQueueIcon}
          title="No queue rows match this view"
          description="Clear filters or switch streams to review the shared work queue."
          action={activeSourceTypes.size > 0 ? <Button variant="secondary" size="sm" onClick={onClearSourceTypes}>Clear filters</Button> : undefined}
          className="rounded-[var(--radius-signature-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]"
        />
      )}
    </div>
  );
}
