// @ds-rebuilt
import { Bell, Gauge, Trophy, Zap, type LucideIcon } from 'lucide-react';
import type { WorkQueueClassification, WorkQueueItem, WorkQueueSourceType, WorkQueueStream } from '../../../shared/types/work-queue';
import {
  Button,
  ClickableRow,
  EmptyState,
  FilterChip,
  Icon,
  SectionCard,
  WorkQueueRow,
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
  anomalyCount: number;
  onOpenAnomalies: () => void;
  onOpenItem: (item: WorkQueueItem) => void;
}

export const STREAM_META: Record<WorkQueueStream, {
  label: string;
  /** Short count suffix shown inline after the tile number (prototype `.su`), e.g. "to fix". */
  unit: string;
  description: string;
  groupTitle: string;
  icon: LucideIcon;
  iconName: 'gauge' | 'zap' | 'trophy' | 'bell';
  color: string;
}> = {
  opt: {
    label: 'Optimizations',
    unit: 'to fix',
    description: 'Site health & rankings',
    groupTitle: 'Optimization queue',
    icon: Gauge,
    iconName: 'gauge',
    color: 'var(--blue)',
  },
  send: {
    label: 'To send',
    unit: 'to send',
    description: 'Ready for the client',
    groupTitle: 'Send-ready queue',
    icon: Zap,
    iconName: 'zap',
    color: 'var(--teal)',
  },
  money: {
    label: 'Growth',
    unit: 'to propose',
    description: 'Upsell and value-proof work backed by measured results.',
    groupTitle: 'Growth queue',
    icon: Trophy,
    iconName: 'trophy',
    color: 'var(--amber)',
  },
  unclassified: {
    label: 'Needs triage',
    unit: 'to triage',
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

export function toSelectableWorkStream(stream: CockpitStreamFilter): SelectableWorkStream | null {
  return stream === 'send' || stream === 'money' || stream === 'opt' ? stream : null;
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

function groupItems(
  items: WorkQueueItem[],
  stream: CockpitStreamFilter,
  includeAnomalyPointer: boolean,
): Array<[WorkQueueStream, WorkQueueItem[]]> {
  const streams: WorkQueueStream[] = stream === 'all'
    ? ['opt', 'send', 'money', 'unclassified']
    : [stream];
  return streams
    .map((streamId) => [streamId, items.filter((item) => item.stream === streamId)] as [WorkQueueStream, WorkQueueItem[]])
    .filter(([streamId, rows]) => rows.length > 0 || (streamId === 'unclassified' && includeAnomalyPointer));
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
  anomalyCount,
  onOpenAnomalies,
  onOpenItem,
}: CockpitWorkQueueProps) {
  const filteredItems = visibleItems(workQueue.items, stream, activeSourceTypes);
  const showAnomalyPointer = anomalyCount > 0
    && (stream === 'all' || stream === 'unclassified')
    && activeSourceTypes.size === 0;
  const anomalyLabel = `${anomalyCount} ${anomalyCount === 1 ? 'anomaly' : 'anomalies'}`;
  const grouped = groupItems(filteredItems, stream, showAnomalyPointer);
  const sourceTypes = SOURCE_ORDER.filter((sourceType) => (sourceTypeCounts[sourceType] ?? 0) > 0);

  const filterControls = (
    <div className="flex min-w-max items-center gap-2" aria-label="Queue filters">
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
      {activeSourceTypes.size > 0 && (
        <Button variant="link" size="sm" onClick={onClearSourceTypes}>
          Clear filters
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="cockpit-work-queue">
      {grouped.length > 0 ? (
        <SectionCard
          title={`${clientName}'s work queue`}
          titleIcon={<Icon name="bell" size="sm" className="text-[var(--teal)]" />}
          iconChip
          subtitle="Everything this client needs, grouped by kind"
          action={(
            <div className="max-w-[52%] overflow-x-auto py-0.5">
              {filterControls}
            </div>
          )}
          noPadding
        >
          <div className="flex flex-col">
            {grouped.map(([streamId, rows]) => {
              const meta = STREAM_META[streamId];
              return (
                <div key={streamId} className="border-t border-[var(--brand-border)] first:border-t-0">
                  {/* co-grp — light inline group header */}
                  <div className="flex items-center gap-2 px-4 pb-1.5 pt-3 t-label" style={{ color: meta.color }}>
                    <Icon name={meta.iconName} size="sm" />
                    <span>{meta.label}</span>
                    {rows.length > 0 && (
                      <span
                        className="rounded-[var(--radius-pill)] px-1.5 t-caption-sm font-semibold tabular-nums"
                        style={{ color: meta.color, backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}
                      >
                        {rows.length}
                      </span>
                    )}
                  </div>
                  {streamId === 'unclassified' && showAnomalyPointer && (
                    <ClickableRow
                      aria-label={`Review ${anomalyLabel} in Search & Traffic`}
                      onClick={onOpenAnomalies}
                      className="flex items-center gap-3 border-t border-[var(--brand-border)] px-4 py-3"
                    >
                      <Icon name="bell" size="sm" className="flex-none text-[var(--blue)]" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block t-ui font-semibold text-[var(--brand-text-bright)] tabular-nums">
                          {anomalyLabel}
                        </span>
                        <span className="block t-caption-sm text-[var(--brand-text-muted)]">
                          Review alert detail in Search &amp; Traffic
                        </span>
                      </span>
                      <Icon name="arrowRight" size="sm" className="flex-none text-[var(--teal)]" aria-hidden="true" />
                    </ClickableRow>
                  )}
                  {rows.map((item) => (
                    <WorkQueueRow
                      key={`${item.stream}-${item.id}`}
                      item={item}
                      clientInitials={clientInitials}
                      actionLabel={item.stream === 'send' ? 'Review' : 'Open'}
                      onAction={() => onOpenItem(item)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </SectionCard>
      ) : (
        <>
          <div className="max-w-full overflow-x-auto">{filterControls}</div>
          <EmptyState
            icon={EmptyQueueIcon}
            title="No queue rows match this view"
            description="Clear filters or switch streams to review the shared work queue."
            action={activeSourceTypes.size > 0 ? <Button variant="secondary" size="sm" onClick={onClearSourceTypes}>Clear filters</Button> : undefined}
            // pr-check-disable-next-line -- brand signature radius on the empty-state container (owner-ratified global asymmetric-on-containers, ui-parity)
            className="rounded-[var(--radius-signature-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]"
          />
        </>
      )}
    </div>
  );
}
