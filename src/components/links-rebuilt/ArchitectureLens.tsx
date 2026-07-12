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
import { useToast } from '../Toast';
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
  filters,
  filter,
  onFilterChange,
  clearSearch,
}: {
  tree: SiteNode | null;
  coverage: Record<string, SchemaCoveragePage>;
  filters: Array<{ id: ArchitectureSourceFilter; label: string; count: number }>;
  filter: ArchitectureSourceFilter;
  onFilterChange: (filter: ArchitectureSourceFilter) => void;
  clearSearch: () => void;
}) {
  const children = tree?.children ?? [];
  return (
    <GroupBlock
      title="URL tree"
      meta="Live, planned, strategy, and gap pages in the current architecture model."
      stats={[{ label: 'Top-level', value: children.length, color: 'var(--teal)' }]}
      collapsible
      defaultOpen
    >
      <div className="mb-2 flex flex-wrap gap-1.5 border-b border-[var(--brand-border)] pb-2" aria-label="Architecture source filters">
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
      {children.length === 0 ? (
        <EmptyState
          icon={() => <Icon name="search" size="2xl" />}
          title="No architecture pages match this view"
          description="Clear search or choose a broader source filter."
          action={<Button size="sm" variant="secondary" onClick={clearSearch}>Clear search</Button>}
        />
      ) : (
        <div className="flex max-h-[660px] flex-col gap-1 overflow-y-auto pr-1">
          {children.map((node) => (
            <TreeNodeRow key={node.path} node={node} coverageByPath={coverage} />
          ))}
        </div>
      )}
    </GroupBlock>
  );
}

function DepthDistribution({ distribution }: { distribution: Record<number, number> }) {
  const entries = Object.entries(distribution)
    .map(([depth, count]) => ({ depth: Number(depth), count }))
    .sort((a, b) => a.depth - b.depth);
  const max = Math.max(...entries.map((entry) => entry.count), 1);

  return (
    <GroupBlock title="Depth distribution" meta="Most pages should sit within three clicks of the homepage." collapsible defaultOpen>
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

function ArchitectureGaps({
  gaps,
  onAddPage,
}: {
  gaps: SiteArchitectureResult['gaps'];
  onAddPage: (path: string) => void;
}) {
  return (
    <GroupBlock
      title="Architecture gaps"
      meta="Missing hub pages and broken hierarchy."
      stats={[{ label: 'Gaps', value: gaps.length, color: gaps.length > 0 ? 'var(--amber)' : 'var(--emerald)' }]}
      collapsible
      defaultOpen
    >
      {gaps.length === 0 ? (
        <div className="px-2 py-4 text-center t-caption text-[var(--brand-text-muted)]">No architecture gaps in the current model.</div>
      ) : (
        <div className="divide-y divide-[var(--brand-border)]">
          {gaps.map((gap) => (
            <div key={`${gap.parentPath}:${gap.suggestedPath}`} className="grid gap-2 px-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge label={gap.priority} tone={PRIORITY_TONE[gap.priority] ?? 'zinc'} variant="soft" />
                  <p className="truncate t-caption font-semibold text-[var(--brand-text-bright)]">{gap.suggestedPath}</p>
                </div>
                <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{gap.reason}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => onAddPage(gap.suggestedPath)}>
                <Icon name="plus" size="sm" />
                Add page
              </Button>
            </div>
          ))}
        </div>
      )}
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
    <GroupBlock
      title="Schema priority queue"
      meta={`Schema and internal-link evidence for pages that need attention · ${coverage.withSchema}/${coverage.totalExisting} live pages have schema.`}
      stats={[{ label: 'Pages', value: rows.length, color: 'var(--blue)' }]}
      headingLevel="h2"
      collapsible
      defaultOpen={false}
    >
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(record) => (record as PriorityRecord).source.path}
      />
    </GroupBlock>
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
  const { toast } = useToast();
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
    <div className="flex flex-col gap-[14px]">
      {architecture.isError && (
        <InlineBanner tone="warning" title="Architecture may be stale">
          The latest architecture read did not refresh, so the last loaded tree remains on screen.
        </InlineBanner>
      )}

      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6" data-testid="architecture-metrics">
        <MetricTile label="Total pages" value={data.totalPages} accent="var(--blue)" />
        <MetricTile label="Live pages" value={data.existingPages} accent="var(--emerald)" />
        <MetricTile label="Planned" value={data.plannedPages} accent="var(--blue)" />
        <MetricTile label="Strategy" value={data.strategyPages} accent="var(--blue)" />
        <MetricTile label="Gaps" value={data.gaps.length} accent={data.gaps.length > 0 ? 'var(--amber)' : 'var(--brand-text-dim)'} />
        <MetricTile
          label="Schema coverage"
          value={coverageData ? `${coverageData.coveragePct}%` : '—'}
          accent={coverageData ? scoreColor(coverageData.coveragePct) : 'var(--brand-text-dim)'}
        />
      </div>

      <div data-testid="architecture-orphans">
        {data.orphanPaths.length > 0 ? (
          <InlineBanner tone="warning" title={`${data.orphanPaths.length} architecture orphan${data.orphanPaths.length === 1 ? '' : 's'}`}>
            <p className="t-body text-[var(--brand-text-muted)]">
              These content paths have no parent hub, making them harder for crawlers to discover.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.orphanPaths.slice(0, 3).map((path) => (
                <span key={path} className="max-w-full truncate rounded-[var(--radius-sm)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-2 py-1 t-caption-sm text-[var(--amber)]">
                  {path}
                </span>
              ))}
              {data.orphanPaths.length > 3 && (
                <span className="rounded-[var(--radius-sm)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-2 py-1 t-caption-sm text-[var(--brand-text-muted)]">
                  +{data.orphanPaths.length - 3} more in the URL tree
                </span>
              )}
            </div>
          </InlineBanner>
        ) : (
          <InlineBanner tone="success" title="No architecture orphans">Every modeled page has a discoverable parent path.</InlineBanner>
        )}
      </div>

      <div className="grid gap-[14px] xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]" data-testid="architecture-primary">
        <UrlTree
          tree={filteredTree}
          coverage={coverageByPath}
          filters={filters}
          filter={filter}
          onFilterChange={onFilterChange}
          clearSearch={clearSearch}
        />
        <div className="flex flex-col gap-[14px]">
          <ArchitectureGaps
            gaps={data.gaps}
            onAddPage={(path) => toast(`Open Content Pipeline to create ${path}; Links does not publish pages directly.`, 'info')}
          />
          <DepthDistribution distribution={data.depthDistribution} />
        </div>
      </div>

      <div data-testid="architecture-schema">
        <PriorityQueue coverage={coverageData} />
      </div>

      <InlineBanner tone="info" title="Architecture next steps">
        <p className="t-body text-[var(--brand-text-muted)]">
          Use gaps as page-planning inputs. Create approved hub pages from the content workflow, then refresh Links to confirm the URL tree. Last analyzed {dateTimeOrDash(data.analyzedAt)}{coverageData?.snapshotDate ? ` · Schema snapshot ${dateTimeOrDash(coverageData.snapshotDate)}` : ''}.
        </p>
      </InlineBanner>
    </div>
  );
}
