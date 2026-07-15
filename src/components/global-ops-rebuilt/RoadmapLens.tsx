// @ds-rebuilt
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  FormSelect,
  InlineBanner,
  SearchField,
  Segmented,
} from '../ui';
import { roadmap as roadmapApi } from '../../api/platform';
import { queryKeys } from '../../lib/queryKeys';
import { mutationErrorMessage } from './globalOpsMutationFeedback';
import { ROADMAP_VIEWS, useRoadmapViewState, type RoadmapView } from './useGlobalOpsSurfaceState';
import type { RoadmapItem, SprintData } from '../../../shared/types/roadmap';
import { RoadmapBacklog } from './wave-a/RoadmapBacklog';
import { RoadmapHero } from './wave-a/RoadmapHero';
import { RoadmapMetricStrip } from './wave-a/RoadmapMetricStrip';
import { RoadmapProgressCard } from './wave-a/RoadmapProgressCard';
import { RoadmapSprintGroups } from './wave-a/RoadmapSprintGroups';
import { RoadmapVelocityCard } from './wave-a/RoadmapVelocityCard';
import type {
  RoadmapDisplayGroup,
  RoadmapDisplayRow,
  RoadmapPriority,
  RoadmapRuntimeStatus,
  VelocityPoint,
} from './wave-a/roadmapDisplayTypes';
import {
  compareRows,
  DIR_OPTIONS,
  isSortDir,
  isSortKey,
  makeRows,
  normalizeRuntimeStatus,
  PRIORITIES,
  RUNTIME_STATUSES,
  shortSprintLabel,
  SORT_OPTIONS,
  STATUS_CYCLE,
  type SortDir,
  type SortKey,
} from './wave-a/roadmapModel';

type RoadmapStatus = RoadmapItem['status'];

const VIEW_LABELS: Record<RoadmapView, string> = {
  sprint: 'Sprint View',
  backlog: 'Backlog View',
};

export function RoadmapLens() {
  const state = useRoadmapViewState();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
    mutationFn: ({ row, nextStatus }: { row: RoadmapDisplayRow; nextStatus: RoadmapStatus }) =>
      roadmapApi.updateItem(row.rawId, row.sprintId, { status: nextStatus }),
    onMutate: async ({ row, nextStatus }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.admin.roadmap() });
      const previousSnapshot = queryClient.getQueryData<SprintData[]>(queryKeys.admin.roadmap());
      queryClient.setQueryData<SprintData[]>(queryKeys.admin.roadmap(), (previous) =>
        (previous ?? []).map((sprint) => sprint.id !== row.sprintId ? sprint : {
          ...sprint,
          items: sprint.items.map((item) => String(item.id) === String(row.rawId) ? { ...item, status: nextStatus } : item),
        }),
      );
      return { previousSnapshot };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousSnapshot) queryClient.setQueryData(queryKeys.admin.roadmap(), context.previousSnapshot);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.roadmap() });
    },
  });

  const sprints = roadmap.data ?? [];
  const allRows = useMemo(() => makeRows(sprints), [sprints]);
  const total = allRows.length;
  const done = allRows.filter((row) => row.status === 'done').length;
  const inProgress = allRows.filter((row) => row.status === 'in_progress').length;
  const pending = allRows.filter((row) => row.status === 'pending').length;
  const deferred = allRows.filter((row) => row.status === 'deferred').length;
  const executableTotal = done + inProgress + pending;
  const completion = executableTotal > 0 ? Math.round((done / executableTotal) * 100) : 0;

  const priorityParam = searchParams.get('priority');
  const statusParam = searchParams.get('status');
  const sprintParam = searchParams.get('sprint');
  const featureParam = searchParams.get('feature');
  const tagParam = searchParams.get('tag');
  const priority = priorityParam && PRIORITIES.includes(priorityParam as RoadmapPriority) ? priorityParam : 'all';
  const status = statusParam && RUNTIME_STATUSES.includes(statusParam as RoadmapRuntimeStatus) ? statusParam : 'all';
  const sprint = sprintParam && sprints.some((item) => item.id === sprintParam) ? sprintParam : 'all';

  const featureValues = useMemo(
    () => Array.from(new Set(allRows.map((row) => row.feature).filter((value): value is string => Boolean(value)))).sort(),
    [allRows],
  );
  const tagValues = useMemo(
    () => Array.from(new Set(allRows.flatMap((row) => row.tags))).sort(),
    [allRows],
  );
  const feature = featureParam && featureValues.includes(featureParam) ? featureParam : 'all';
  const tag = tagParam && tagValues.includes(tagParam) ? tagParam : 'all';

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = allRows.filter((row) => {
      if (priority !== 'all' && row.priority !== priority) return false;
      if (status !== 'all' && row.status !== status) return false;
      if (sprint !== 'all' && row.sprintId !== sprint) return false;
      if (feature !== 'all' && row.feature !== feature) return false;
      if (tag !== 'all' && !row.tags.includes(tag)) return false;
      if (!query) return true;
      return [row.id, row.title, row.notes, row.sprint, row.source, row.feature ?? '', row.status, ...row.tags]
        .some((value) => value.toLowerCase().includes(query));
    });
    return [...rows].sort((a, b) => {
      const result = compareRows(a, b, sort);
      return dir === 'asc' ? result : -result;
    });
  }, [allRows, dir, feature, priority, search, sort, sprint, status, tag]);

  const groups = useMemo<RoadmapDisplayGroup[]>(() => sprints.map((sprintData) => {
    const rows = filteredRows.filter((row) => row.sprintId === sprintData.id);
    const sourceRows = allRows.filter((row) => row.sprintId === sprintData.id);
    return {
      id: sprintData.id,
      name: sprintData.name,
      rationale: sprintData.rationale ?? null,
      hours: sprintData.hours ?? null,
      done: sourceRows.filter((row) => row.status === 'done').length,
      total: sourceRows.length,
      rows,
    };
  }).filter((group) => group.rows.length > 0), [allRows, filteredRows, sprints]);

  // "Shipping velocity" = items shipped per recent *completed* sprint. The roadmap API orders
  // fully-shipped sprints newest-first below the backlog (scripts/sort-roadmap.ts), so restrict to
  // fully-shipped sprints before slicing — otherwise slice(0, 4) picks the top-of-list in-flight
  // sprints (partial done-counts) and can exclude the shipped history the widget advertises.
  const velocityPoints = useMemo<VelocityPoint[]>(() => sprints
    .filter((sprintData) => sprintData.items.length > 0
      && sprintData.items.every((item) => normalizeRuntimeStatus(item.status) === 'done'))
    .map((sprintData) => ({
      id: sprintData.id,
      label: shortSprintLabel(sprintData.name),
      fullLabel: sprintData.name,
      count: sprintData.items.filter((item) => normalizeRuntimeStatus(item.status) === 'done').length,
    }))
    .slice(0, 4)
    .reverse(), [sprints]);

  const currentSprint = sprints.find((sprintData) => sprintData.items.some((item) => {
    const itemStatus = normalizeRuntimeStatus(item.status);
    return itemStatus === 'pending' || itemStatus === 'in_progress';
  }))?.name ?? null;

  const updateParam = (key: string, value: string) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace: true });
  };

  const clearFilters = () => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      ['q', 'priority', 'status', 'sprint', 'feature', 'tag', 'sort', 'dir'].forEach((key) => next.delete(key));
      return next;
    }, { replace: true });
  };

  const cycleStatus = (row: RoadmapDisplayRow) => {
    if (row.status === 'closed') return;
    if (row.status === 'deferred') {
      toggleStatus.mutate({ row, nextStatus: 'pending' });
      return;
    }
    const currentIndex = STATUS_CYCLE.indexOf(row.status);
    const nextStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length];
    toggleStatus.mutate({ row, nextStatus });
  };

  const cyclingKey = toggleStatus.isPending ? toggleStatus.variables?.row.rowKey ?? null : null;
  const filtersActive = Boolean(search)
    || priority !== 'all'
    || status !== 'all'
    || sprint !== 'all'
    || feature !== 'all'
    || tag !== 'all'
    || sort !== 'priority'
    || dir !== 'asc';

  return (
    <div
      data-testid="roadmap-rebuilt"
      data-active-view={state.view}
      className="mx-auto flex min-h-full w-full max-w-[1100px] flex-col gap-[14px] px-4 pb-[90px] pt-2 sm:px-[30px]"
    >
      <RoadmapHero total={total} done={done} inProgress={inProgress} pending={pending} deferred={deferred} />

      {state.invalidView && (
        <InlineBanner
          tone="warning"
          title="Unknown Roadmap view"
          message="The requested view is not active, so Roadmap opened Sprint."
        />
      )}

      {roadmap.isError && (
        <InlineBanner
          tone="error"
          title="Roadmap could not be loaded"
          message="The latest roadmap data is unavailable. Retry before changing an item status."
        />
      )}

      <RoadmapMetricStrip total={total} done={done} inProgress={inProgress} completion={completion} />
      <RoadmapVelocityCard points={velocityPoints} loading={roadmap.isLoading} />
      <RoadmapProgressCard
        total={total}
        done={done}
        inProgress={inProgress}
        pending={pending}
        deferred={deferred}
        currentSprint={currentSprint}
      />

      <Segmented
        options={ROADMAP_VIEWS.map((view) => ({ value: view, label: VIEW_LABELS[view] }))}
        value={state.view}
        onChange={(value) => state.setView(value as RoadmapView)}
        className="w-fit"
      />

      <div role="toolbar" aria-label="Roadmap filters" className="flex flex-wrap items-center gap-2 pb-0.5">
        <SearchField
          value={search}
          onChange={(value) => updateParam('q', value)}
          placeholder="Search items…"
          debounceMs={150}
          className="min-w-[180px] flex-1"
        />
        <FormSelect
          aria-label="Filter by priority"
          value={priority}
          onChange={(value) => updateParam('priority', value)}
          options={[{ value: 'all', label: 'All priorities' }, ...PRIORITIES.map((value) => ({ value, label: value }))]}
          className="w-[120px] shrink-0"
        />
        <FormSelect
          aria-label="Filter by status"
          value={status}
          onChange={(value) => updateParam('status', value)}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'pending', label: 'Pending' },
            { value: 'in_progress', label: 'In progress' },
            { value: 'done', label: 'Done' },
            { value: 'deferred', label: 'On hold' },
          ]}
          className="w-[114px] shrink-0"
        />
        <FormSelect
          aria-label="Filter by sprint"
          value={sprint}
          onChange={(value) => updateParam('sprint', value)}
          options={[{ value: 'all', label: 'All sprints' }, ...sprints.map((item) => ({ value: item.id, label: item.name }))]}
          className="w-[116px] shrink-0"
        />
        <FormSelect
          aria-label="Filter by feature"
          value={feature}
          onChange={(value) => updateParam('feature', value)}
          options={[{ value: 'all', label: 'All features' }, ...featureValues.map((value) => ({ value, label: value }))]}
          disabled={featureValues.length === 0}
          className="w-[114px] shrink-0"
        />
        <FormSelect
          aria-label="Filter by tag"
          value={tag}
          onChange={(value) => updateParam('tag', value)}
          options={[{ value: 'all', label: 'All tags' }, ...tagValues.map((value) => ({ value, label: value }))]}
          disabled={tagValues.length === 0}
          className="w-[104px] shrink-0"
        />
        <FormSelect
          aria-label="Sort roadmap"
          value={sort}
          onChange={(value) => updateParam('sort', value)}
          options={SORT_OPTIONS}
          className="w-[118px] shrink-0"
        />
        <FormSelect
          aria-label="Sort direction"
          value={dir}
          onChange={(value) => updateParam('dir', value)}
          options={DIR_OPTIONS}
          className="w-[104px] shrink-0"
        />
        {filtersActive && (
          <Button variant="secondary" size="sm" onClick={clearFilters} className="shrink-0">Clear</Button>
        )}
      </div>

      {state.view === 'sprint' ? (
        <RoadmapSprintGroups
          groups={groups}
          expandedKey={expandedKey}
          cyclingKey={cyclingKey}
          loading={roadmap.isLoading}
          onToggle={(key) => setExpandedKey((current) => current === key ? null : key)}
          onCycle={cycleStatus}
        />
      ) : (
        <RoadmapBacklog
          rows={filteredRows}
          expandedKey={expandedKey}
          cyclingKey={cyclingKey}
          loading={roadmap.isLoading}
          onToggle={(key) => setExpandedKey((current) => current === key ? null : key)}
          onCycle={cycleStatus}
        />
      )}

      {toggleStatus.isError && (
        <InlineBanner
          tone="error"
          title="Roadmap update failed"
          message={mutationErrorMessage(toggleStatus.error, 'Roadmap status update failed')}
        />
      )}
    </div>
  );
}
