// @ds-rebuilt
import { useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type {
  SchemaCoverageData,
  SchemaCoveragePage,
  SiteArchitectureResult,
  SiteNode,
} from '../../hooks/admin/useAdminLinks';
import {
  Badge,
  Button,
  ClickableRow,
  DataTable,
  EmptyState,
  GroupBlock,
  Icon,
  InlineBanner,
  Meter,
  MetricTile,
  Skeleton,
  type DataColumn,
} from '../ui';
import { scoreColor } from '../ui/constants';
import type { ArchitectureSourceFilter } from './useLinksSurfaceState';
import { dateTimeOrDash, numberOrDash } from './linksFormatters';

interface ArchitectureLensProps {
  architecture: UseQueryResult<SiteArchitectureResult, Error>;
  coverage: UseQueryResult<SchemaCoverageData, Error>;
  filter: ArchitectureSourceFilter;
  onFilterChange: (filter: ArchitectureSourceFilter) => void;
  search: string;
  clearSearch: () => void;
}

type PriorityRecord = Record<string, unknown> & {
  source: SchemaCoverageData['priorityQueue'][number];
  path: string;
  name: string;
  priority: string;
  inboundLinks: number | null;
  linkScore: number | null;
};

const SOURCE_TONE: Record<SiteNode['source'], 'emerald' | 'blue' | 'teal' | 'zinc'> = {
  existing: 'emerald',
  planned: 'blue',
  strategy: 'teal',
  gap: 'zinc',
};

const PRIORITY_TONE: Record<string, 'red' | 'amber' | 'blue' | 'zinc' | 'emerald'> = {
  critical: 'red',
  high: 'amber',
  medium: 'blue',
  low: 'zinc',
  done: 'emerald',
};

function sourceLabel(source: SiteNode['source']): string {
  if (source === 'existing') return 'Live';
  if (source === 'planned') return 'Planned';
  if (source === 'strategy') return 'Strategy';
  return 'Gap';
}

function coverageMap(coverage: SchemaCoverageData | undefined): Record<string, SchemaCoveragePage> {
  const map: Record<string, SchemaCoveragePage> = {};
  for (const page of coverage?.pages ?? []) {
    map[page.path] = page;
  }
  return map;
}

function filterTree(node: SiteNode, filter: ArchitectureSourceFilter, search: string): SiteNode | null {
  const q = search.trim().toLowerCase();
  const matchesFilter = filter === 'all' || node.source === filter;
  const matchesSearch = !q
    || node.name.toLowerCase().includes(q)
    || node.path.toLowerCase().includes(q)
    || (node.keyword?.toLowerCase().includes(q) ?? false);
  const children = node.children
    .map((child) => filterTree(child, filter, search))
    .filter((child): child is SiteNode => child != null);

  if ((matchesFilter && matchesSearch) || children.length > 0) {
    return { ...node, children };
  }
  return null;
}

function TreeNodeRow({
  node,
  coverageByPath,
}: {
  node: SiteNode;
  coverageByPath: Record<string, SchemaCoveragePage>;
}) {
  const [open, setOpen] = useState(node.depth < 2);
  const hasChildren = node.children.length > 0;
  const coverage = coverageByPath[node.path];
  return (
    <div>
      <ClickableRow
        onClick={() => hasChildren && setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2"
        style={{ paddingLeft: `${node.depth * 18 + 12}px` }}
      >
        <Icon name={hasChildren ? (open ? 'chevronDown' : 'arrowRight') : 'file'} size="sm" className="shrink-0 text-[var(--brand-text-dim)]" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate t-caption font-semibold text-[var(--brand-text-bright)]">{node.name}</span>
            <Badge label={sourceLabel(node.source)} tone={SOURCE_TONE[node.source]} variant="soft" />
            {coverage && (
              coverage.hasSchema
                ? <Badge label={`${coverage.schemaTypes.length} schema`} tone="emerald" variant="outline" />
                : <Badge label="No schema" tone="zinc" variant="outline" />
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate t-caption-sm text-[var(--brand-text-muted)]">{node.path}</span>
            {node.keyword && <span className="truncate t-caption-sm text-[var(--teal)]">{node.keyword}</span>}
          </div>
        </div>
        {hasChildren && <span className="shrink-0 t-caption-sm text-[var(--brand-text-muted)]">{node.children.length}</span>}
      </ClickableRow>
      {open && hasChildren && (
        <div className="mt-1">
          {node.children.map((child) => (
            <TreeNodeRow key={child.path} node={child} coverageByPath={coverageByPath} />
          ))}
        </div>
      )}
    </div>
  );
}

function UrlTree({
  tree,
  coverage,
  clearSearch,
}: {
  tree: SiteNode | null;
  coverage: Record<string, SchemaCoveragePage>;
  clearSearch: () => void;
}) {
  const children = tree?.children ?? [];
  if (children.length === 0) {
    return (
      <EmptyState
        icon={() => <Icon name="search" size="2xl" />}
        title="No architecture pages match this view"
        description="Clear search or choose a broader source filter."
        action={<Button size="sm" variant="secondary" onClick={clearSearch}>Clear search</Button>}
      />
    );
  }
  return (
    <GroupBlock
      title="URL tree"
      meta="Live, planned, strategy, and gap pages in the current architecture model."
      stats={[{ label: 'Top-level', value: children.length, color: 'var(--teal)' }]}
      collapsible
      defaultOpen
    >
      <div className="flex flex-col gap-1">
        {children.map((node) => (
          <TreeNodeRow key={node.path} node={node} coverageByPath={coverage} />
        ))}
      </div>
    </GroupBlock>
  );
}

function DepthDistribution({ distribution }: { distribution: Record<number, number> }) {
  const entries = Object.entries(distribution)
    .map(([depth, count]) => ({ depth: Number(depth), count }))
    .sort((a, b) => a.depth - b.depth);
  const max = Math.max(...entries.map((entry) => entry.count), 1);

  return (
    <GroupBlock title="Depth distribution" meta="Most pages should sit within three clicks of the homepage." collapsible defaultOpen={false}>
      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <div key={entry.depth} className="grid grid-cols-[70px_1fr_42px] items-center gap-2">
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Depth {entry.depth}</span>
            <div className="h-3 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-3)]">
              <div
                className="h-full rounded-[var(--radius-pill)] bg-[var(--brand-mint-dim)]"
                style={{ width: `${Math.max(4, (entry.count / max) * 100)}%` }}
              />
            </div>
            <span className="text-right t-caption-sm tabular-nums text-[var(--brand-text)]">{entry.count}</span>
          </div>
        ))}
      </div>
    </GroupBlock>
  );
}

function PriorityQueue({ coverage }: { coverage: SchemaCoverageData | undefined }) {
  const rows = useMemo<PriorityRecord[]>(() => (
    coverage?.priorityQueue.map((item) => ({
      source: item,
      path: item.path,
      name: item.name,
      priority: item.priority,
      inboundLinks: item.inboundLinks,
      linkScore: item.linkScore,
    })) ?? []
  ), [coverage?.priorityQueue]);

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'name',
      label: 'Page',
      width: 'minmax(220px, 1.4fr)',
      sortable: true,
      render: (_value, record) => {
        const item = (record as PriorityRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{item.name}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{item.path}</span>
          </div>
        );
      },
    },
    {
      key: 'priority',
      label: 'Priority',
      width: '104px',
      sortable: true,
      render: (_value, record) => {
        const item = (record as PriorityRecord).source;
        return <Badge label={item.priority} tone={PRIORITY_TONE[item.priority] ?? 'zinc'} variant="soft" />;
      },
    },
    {
      key: 'inboundLinks',
      label: 'Inbound',
      width: '92px',
      align: 'right',
      sortable: true,
      render: (_value, record) => numberOrDash((record as PriorityRecord).source.inboundLinks),
    },
    {
      key: 'linkScore',
      label: 'Link score',
      width: '150px',
      render: (_value, record) => {
        const score = (record as PriorityRecord).source.linkScore;
        return typeof score === 'number'
          ? <Meter value={score} showValue ariaLabel={`${(record as PriorityRecord).source.name} link score`} />
          : <span className="t-caption-sm text-[var(--brand-text-muted)]">—</span>;
      },
    },
  ], []);

  if (!coverage || rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">Schema priority queue</h3>
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(record) => (record as PriorityRecord).source.path}
      />
    </div>
  );
}

export function ArchitectureLens({
  architecture,
  coverage,
  filter,
  onFilterChange,
  search,
  clearSearch,
}: ArchitectureLensProps) {
  const data = architecture.data ?? null;
  const coverageData = coverage.data;
  const coverageByPath = useMemo(() => coverageMap(coverageData), [coverageData]);
  const filteredTree = useMemo(() => data ? filterTree(data.tree, filter, search) : null, [data, filter, search]);
  const filters = [
    { id: 'all' as const, label: 'All', count: data?.totalPages ?? 0 },
    { id: 'existing' as const, label: 'Live', count: data?.existingPages ?? 0 },
    { id: 'planned' as const, label: 'Planned', count: data?.plannedPages ?? 0 },
    { id: 'strategy' as const, label: 'Strategy', count: data?.strategyPages ?? 0 },
    { id: 'gap' as const, label: 'Gaps', count: data?.gaps.length ?? 0 },
  ];

  if (!data && architecture.isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading architecture">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
        <Skeleton className="h-[360px] w-full" />
      </div>
    );
  }

  if (!data && architecture.isError) {
    return (
      <EmptyState
        icon={() => <Icon name="alert" size="2xl" />}
        title="Site architecture did not load"
        description="Retry the architecture read before reviewing URL structure and schema coverage."
        action={<Button size="sm" variant="primary" onClick={() => architecture.refetch()}>Retry architecture</Button>}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={() => <Icon name="sitemap" size="2xl" />}
        title="No architecture data"
        description="Analyze the site architecture to build the URL tree from live pages, planned content, and strategy pages."
        action={<Button size="sm" variant="primary" onClick={() => architecture.refetch()}>Analyze architecture</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {architecture.isError && (
        <InlineBanner tone="warning" title="Architecture may be stale">
          The latest architecture read did not refresh, so the last loaded tree remains on screen.
        </InlineBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricTile label="Total pages" value={data.totalPages} accent="var(--teal)" />
        <MetricTile label="Live pages" value={data.existingPages} accent="var(--emerald)" />
        <MetricTile label="Planned" value={data.plannedPages} accent="var(--blue)" />
        <MetricTile label="Strategy" value={data.strategyPages} accent="var(--blue)" />
        <MetricTile label="Gaps" value={data.gaps.length} accent={data.gaps.length > 0 ? 'var(--amber)' : 'var(--brand-text-dim)'} />
        <MetricTile
          label="Schema coverage"
          value={coverageData ? `${coverageData.coveragePct}%` : '—'}
          sub={coverageData ? `${coverageData.withSchema}/${coverageData.totalExisting} live pages` : 'Coverage unavailable'}
          accent={coverageData ? scoreColor(coverageData.coveragePct) : 'var(--brand-text-dim)'}
        />
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Architecture source filters">
        {filters.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={filter === item.id ? 'secondary' : 'ghost'}
            onClick={() => onFilterChange(item.id)}
            aria-pressed={filter === item.id}
          >
            {item.label} <span className="t-micro text-[var(--brand-text-dim)]">{item.count}</span>
          </Button>
        ))}
      </div>

      <p className="t-caption text-[var(--brand-text-muted)]">
        Last analyzed {dateTimeOrDash(data.analyzedAt)}
        {coverageData?.snapshotDate ? ` · Schema snapshot ${dateTimeOrDash(coverageData.snapshotDate)}` : ''}
      </p>

      {data.gaps.length > 0 && (
        <GroupBlock
          title="Architecture gaps"
          meta="Suggested URL structure gaps from the existing architecture model."
          stats={[{ label: 'Gaps', value: data.gaps.length, color: 'var(--amber)' }]}
          collapsible
          defaultOpen={false}
        >
          <div className="grid gap-2 lg:grid-cols-2">
            {data.gaps.map((gap) => (
              <div key={`${gap.parentPath}:${gap.suggestedPath}`} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate t-caption font-semibold text-[var(--brand-text-bright)]">{gap.suggestedPath}</p>
                    <p className="truncate t-caption-sm text-[var(--brand-text-muted)]">Under {gap.parentPath}</p>
                  </div>
                  <Badge label={gap.priority} tone={PRIORITY_TONE[gap.priority] ?? 'zinc'} variant="soft" />
                </div>
                <p className="mt-2 t-caption-sm text-[var(--brand-text-muted)]">{gap.reason}</p>
              </div>
            ))}
          </div>
        </GroupBlock>
      )}

      {data.orphanPaths.length > 0 && (
        <GroupBlock
          title="Architecture orphans"
          meta="Content paths whose parent directory lacks a hub or landing page."
          stats={[{ label: 'Orphans', value: data.orphanPaths.length, color: 'var(--orange)' }]}
          collapsible
          defaultOpen={false}
        >
          <div className="grid gap-2 lg:grid-cols-2">
            {data.orphanPaths.map((path) => (
              <div key={path} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2 t-caption-sm text-[var(--brand-text)]">
                {path}
              </div>
            ))}
          </div>
        </GroupBlock>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <UrlTree tree={filteredTree} coverage={coverageByPath} clearSearch={clearSearch} />
        <div className="flex flex-col gap-5">
          <PriorityQueue coverage={coverageData} />
          <DepthDistribution distribution={data.depthDistribution} />
        </div>
      </div>

      <InlineBanner tone="info" title="Architecture relocation">
        This tab carries the existing architecture readout into Links. Creating new pages from gaps is deferred until a signed write target exists.
      </InlineBanner>
    </div>
  );
}
