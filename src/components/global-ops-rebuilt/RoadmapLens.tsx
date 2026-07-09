// @ds-rebuilt
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShippingVelocityChart } from '../RoadmapVelocityChart';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FormSelect,
  Icon,
  InlineBanner,
  MetricTile,
  PageContainer,
  PageHeader,
  SearchField,
  SectionCard,
  Segmented,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import { roadmap as roadmapApi } from '../../api/platform';
import { queryKeys } from '../../lib/queryKeys';
import { formatDate, formatNumber } from './globalOpsFormatters';
import { mutationErrorMessage } from './globalOpsMutationFeedback';
import { ROADMAP_VIEWS, useRoadmapViewState, type RoadmapView } from './useGlobalOpsSurfaceState';
import type { RoadmapItem, SprintData } from '../../../shared/types/roadmap';

type RoadmapStatus = RoadmapItem['status'];
type RoadmapPriority = NonNullable<RoadmapItem['priority']>;
type SortKey = 'priority' | 'status' | 'sprint' | 'createdAt' | 'title' | 'est';
type SortDir = 'asc' | 'desc';

type RoadmapRow = {
  rowKey: string;
  id: string;
  rawId: RoadmapItem['id'];
  sprintId: string;
  sprint: string;
  title: string;
  status: RoadmapStatus;
  priority: RoadmapPriority | '—';
  est: string;
  createdAt: string | null;
  shippedAt: string | null;
  source: string;
  notes: string;
  tags: string;
  featureId: number | null;
};

const VIEW_LABELS: Record<RoadmapView, string> = {
  sprint: 'Sprint',
  backlog: 'Backlog',
};

const STATUS_CYCLE: readonly RoadmapStatus[] = ['pending', 'in_progress', 'done'];
const PRIORITY_ORDER: Record<RoadmapPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const STATUS_ORDER: Record<RoadmapStatus, number> = { in_progress: 0, pending: 1, done: 2 };

const SORT_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'createdAt', label: 'Added date' },
  { value: 'title', label: 'Title' },
  { value: 'est', label: 'Estimate' },
];

const DIR_OPTIONS = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

function rowKey(sprintId: string, itemId: RoadmapItem['id']) {
  return `${sprintId}::${String(itemId)}`;
}

function statusLabel(status: RoadmapStatus) {
  return status.replace('_', ' ');
}

function statusTone(status: RoadmapStatus) {
  if (status === 'done') return 'emerald';
  if (status === 'in_progress') return 'teal';
  return 'zinc';
}

function priorityTone(priority: RoadmapPriority | '—') {
  if (priority === 'P0' || priority === 'P1') return 'red';
  if (priority === 'P2') return 'amber';
  if (priority === 'P3') return 'blue';
  return 'zinc';
}

function estToHours(raw: string): number {
  const value = raw.trim().toLowerCase();
  if (!value || value === '—') return Number.POSITIVE_INFINITY;
  const parts = value.split('-').map((part) => part.trim()).filter(Boolean);
  const parsed = parts.map((part) => {
    const match = part.match(/^(\d+(?:\.\d+)?)\s*([mh])?$/);
    if (!match) return Number.POSITIVE_INFINITY;
    const amount = Number(match[1]);
    const unit = match[2] ?? (value.includes('m') && !value.includes('h') ? 'm' : 'h');
    return unit === 'm' ? amount / 60 : amount;
  });
  if (parsed.some((value) => !Number.isFinite(value))) return Number.POSITIVE_INFINITY;
  return parsed.reduce((sum, value) => sum + value, 0) / parsed.length;
}

function compareRows(a: RoadmapRow, b: RoadmapRow, sort: SortKey): number {
  if (sort === 'priority') {
    return (a.priority === '—' ? 99 : PRIORITY_ORDER[a.priority]) - (b.priority === '—' ? 99 : PRIORITY_ORDER[b.priority]);
  }
  if (sort === 'status') return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (sort === 'createdAt') return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  if (sort === 'est') return estToHours(a.est) - estToHours(b.est);
  return String(a[sort]).localeCompare(String(b[sort]));
}

function isSortKey(value: string | null): value is SortKey {
  return SORT_OPTIONS.some((option) => option.value === value);
}

function isSortDir(value: string | null): value is SortDir {
  return value === 'asc' || value === 'desc';
}

function makeRows(sprints: SprintData[]): RoadmapRow[] {
  return sprints.flatMap((sprint) =>
    sprint.items.map((item) => ({
      rowKey: rowKey(sprint.id, item.id),
      id: `#${String(item.id)}`,
      rawId: item.id,
      sprintId: sprint.id,
      sprint: sprint.name,
      title: item.title,
      status: item.status,
      priority: item.priority ?? '—',
      est: item.est ?? '—',
      createdAt: item.createdAt ?? null,
      shippedAt: item.shippedAt ?? null,
      source: item.source ?? '—',
      notes: item.notes ?? '',
      tags: item.tags?.join(', ') ?? '',
      featureId: item.featureId ?? null,
    })),
  );
}

export function RoadmapLens() {
  const state = useRoadmapViewState();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const search = searchParams.get('q') ?? '';
  const sortParam = searchParams.get('sort');
  const dirParam = searchParams.get('dir');
  const sort: SortKey = isSortKey(sortParam) ? sortParam : 'priority';
  const dir: SortDir = isSortDir(dirParam) ? dirParam : 'asc';

  const roadmap = useQuery({
    queryKey: queryKeys.admin.roadmap(),
    queryFn: async () => {
      const data = await roadmapApi.get();
      return Array.isArray(data?.sprints) ? data.sprints : [];
    },
  });

  const toggleStatus = useMutation({
    mutationFn: ({ row, nextStatus }: { row: RoadmapRow; nextStatus: RoadmapStatus }) =>
      roadmapApi.updateItem(row.rawId, row.sprintId, { status: nextStatus }),
    onMutate: async ({ row, nextStatus }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.roadmap() });
      const previousSnapshot = queryClient.getQueryData<SprintData[]>(queryKeys.admin.roadmap());
      queryClient.setQueryData<SprintData[]>(queryKeys.admin.roadmap(), (prev) =>
        (prev ?? []).map((sprint) =>
          sprint.id !== row.sprintId
            ? sprint
            : {
                ...sprint,
                items: sprint.items.map((item) =>
                  String(item.id) === String(row.rawId) ? { ...item, status: nextStatus } : item,
                ),
              },
        ),
      );
      return { previousSnapshot };
    },
    onError: (_error, _vars, ctx) => {
      if (ctx?.previousSnapshot) queryClient.setQueryData(queryKeys.admin.roadmap(), ctx.previousSnapshot);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.roadmap() });
    },
  });

  const sprints = roadmap.data ?? [];
  const allItems = sprints.flatMap((sprint) => sprint.items);
  const done = allItems.filter((item) => item.status === 'done').length;
  const inProgress = allItems.filter((item) => item.status === 'in_progress').length;
  const total = allItems.length;
  const completion = total > 0 ? Math.round((done / total) * 100) : 0;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = makeRows(sprints).filter((row) => {
      if (state.view === 'sprint' && row.status === 'done') return false;
      if (!q) return true;
      return [row.title, row.notes, row.sprint, row.source, row.tags, row.id]
        .some((value) => value.toLowerCase().includes(q));
    });
    return [...base].sort((a, b) => {
      const result = compareRows(a, b, sort);
      return dir === 'asc' ? result : -result;
    });
  }, [dir, search, sort, sprints, state.view]);

  const selected = rows.find((row) => row.rowKey === selectedKey) ?? null;

  const updateParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!value) next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  };

  const cycleStatus = (row: RoadmapRow) => {
    const currentIndex = STATUS_CYCLE.indexOf(row.status);
    const nextStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length];
    toggleStatus.mutate({ row, nextStatus });
  };

  return (
    <PageContainer width="wide" className="min-h-full" gap={false}>
      <div data-testid="roadmap-rebuilt" data-active-view={state.view} className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader
          title="Roadmap"
          subtitle="Sprint execution, backlog triage, velocity, and status-cycle operations."
          actions={<Badge label="Sprint + backlog" tone="blue" variant="soft" />}
        />

        {state.invalidView && (
          <InlineBanner
            tone="warning"
            title="Unknown Roadmap view"
            message="The requested view is not active, so Roadmap opened Sprint."
          />
        )}

        <div className="grid gap-3 md:grid-cols-4">
          <MetricTile label="Total Items" value={formatNumber(total)} accent="var(--teal)" />
          <MetricTile label="Completed" value={formatNumber(done)} accent="var(--emerald)" />
          <MetricTile label="In Progress" value={formatNumber(inProgress)} accent="var(--amber)" />
          <MetricTile label="Completion" value={`${completion}%`} accent="var(--blue)" />
        </div>

        <SectionCard title="Velocity" titleIcon={<Icon name="sparkle" size="md" className="text-[var(--blue)]" />}>
          {roadmap.isLoading ? (
            <div className="h-[220px]" aria-busy="true" />
          ) : (
            <ShippingVelocityChart items={allItems} />
          )}
        </SectionCard>

        <Toolbar label="Roadmap controls">
          <Segmented
            options={ROADMAP_VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view] }))}
            value={state.view}
            onChange={(value) => state.setView(value as RoadmapView)}
          />
          <SearchField
            value={search}
            onChange={(value) => updateParam('q', value)}
            placeholder="Search roadmap"
            debounceMs={150}
            className="min-w-[220px] flex-1 md:flex-none"
          />
          <ToolbarSpacer />
          <FormSelect
            aria-label="Sort roadmap"
            value={sort}
            onChange={(value) => updateParam('sort', value)}
            options={SORT_OPTIONS}
            className="w-[150px]"
          />
          <FormSelect
            aria-label="Sort direction"
            value={dir}
            onChange={(value) => updateParam('dir', value)}
            options={DIR_OPTIONS}
            className="w-[140px]"
          />
        </Toolbar>

        <DataTable
          columns={[
            { key: 'id', label: '#', sortable: true, width: '74px' },
            { key: 'title', label: 'Item', sortable: true, width: '1.4fr' },
            {
              key: 'status',
              label: 'Status',
              sortable: true,
              width: '128px',
              render: (value) => <Badge label={statusLabel(value as RoadmapStatus)} tone={statusTone(value as RoadmapStatus)} variant="soft" />,
            },
            {
              key: 'priority',
              label: 'Priority',
              sortable: true,
              width: '96px',
              render: (value) => <Badge label={String(value)} tone={priorityTone(value as RoadmapPriority | '—')} variant="soft" />,
            },
            { key: 'sprint', label: 'Sprint', sortable: true, width: '1fr' },
            { key: 'est', label: 'Est', sortable: true, align: 'right', width: '82px' },
            { key: 'createdAt', label: 'Added', sortable: true, width: '120px', render: (value) => typeof value === 'string' ? formatDate(value) : '—' },
            {
              key: 'rowKey',
              label: 'Cycle',
              width: '92px',
              align: 'right',
              render: (_value, row) => (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => cycleStatus(row as RoadmapRow)}
                  loading={toggleStatus.isPending}
                >
                  Cycle
                </Button>
              ),
            },
          ]}
          rows={rows}
          getRowKey={(row) => String(row.rowKey)}
          loading={roadmap.isLoading}
          empty={
            <EmptyState
              icon={({ className }) => <Icon name="sitemap" className={className} />}
              title="No roadmap items match"
              description="Clear search or switch views to inspect more work."
            />
          }
          onRowClick={(row) => setSelectedKey(String(row.rowKey))}
        />

        {toggleStatus.isError && (
          <InlineBanner
            tone="error"
            title="Roadmap update failed"
            message={mutationErrorMessage(toggleStatus.error, 'Roadmap status update failed')}
          />
        )}

        {selected && (
          <SectionCard
            title={selected.title}
            titleIcon={<Icon name="clipboard" size="md" className="text-[var(--teal)]" />}
            titleExtra={<Badge label={selected.sprint} tone="blue" variant="soft" />}
          >
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <div className="t-label text-[var(--brand-text-muted)]">Status</div>
                <div className="mt-1"><Badge label={statusLabel(selected.status)} tone={statusTone(selected.status)} variant="soft" /></div>
              </div>
              <div>
                <div className="t-label text-[var(--brand-text-muted)]">Priority</div>
                <div className="mt-1"><Badge label={selected.priority} tone={priorityTone(selected.priority)} variant="soft" /></div>
              </div>
              <div>
                <div className="t-label text-[var(--brand-text-muted)]">Source</div>
                <div className="mt-1 t-caption text-[var(--brand-text)]">{selected.source}</div>
              </div>
              <div>
                <div className="t-label text-[var(--brand-text-muted)]">Shipped</div>
                <div className="mt-1 t-caption text-[var(--brand-text)]">{selected.shippedAt ? formatDate(selected.shippedAt) : '—'}</div>
              </div>
            </div>
            <p className="mt-4 t-caption text-[var(--brand-text)]">
              {selected.notes || 'No description added yet.'}
            </p>
          </SectionCard>
        )}
      </div>
    </PageContainer>
  );
}
