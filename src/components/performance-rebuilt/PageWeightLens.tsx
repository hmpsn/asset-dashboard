// @ds-rebuilt
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAdminPageWeightScan,
  useAdminPageWeightSnapshot,
  type PageAsset,
  type PageWeightPage,
  type PageWeightSourceFilter,
} from '../../hooks/admin/useAdminPerformance';
import { adminPath } from '../../routes';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  ClickableRow,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  FormSelect,
  Icon,
  InlineBanner,
  Meter,
  MetricTile,
  SearchField,
  SectionCard,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
  type DataColumn,
} from '../ui';
import { mutationErrorMessage } from './performanceMutationFeedback';
import {
  PAGE_WEIGHT_THRESHOLDS,
  averagePageWeight,
  formatBytes,
  formatScanDate,
  pageSource,
  pageSourceLabel,
  pageWeightAccent,
  pageWeightPercent,
} from './performanceFormatters';

interface PageWeightLensProps {
  workspaceId: string;
  siteId: string;
}

type AssetRecord = Record<string, unknown> & {
  source: PageAsset;
  name: string;
  type: string;
  size: number;
};

const SOURCE_FILTERS: Array<{ id: PageWeightSourceFilter; label: string }> = [
  { id: 'all', label: 'All sources' },
  { id: 'page', label: 'Pages' },
  { id: 'cms', label: 'CMS' },
  { id: 'css', label: 'CSS' },
];

function WeightEmptyIcon({ className }: { className?: string }) {
  return <Icon name="chart" className={className} />;
}

function SearchEmptyIcon({ className }: { className?: string }) {
  return <Icon name="search" className={className} />;
}

function assetTypeLabel(contentType: string): string {
  const [, subtype] = contentType.split('/');
  return subtype || contentType || 'unknown';
}

function assetRows(assets: PageAsset[]): AssetRecord[] {
  return assets.map((asset) => ({
    source: asset,
    name: asset.name,
    type: asset.contentType,
    size: asset.size,
  }));
}

export function PageWeightLens({ workspaceId, siteId }: PageWeightLensProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const snapshot = useAdminPageWeightSnapshot(workspaceId, siteId);
  const scan = useAdminPageWeightScan(workspaceId, siteId);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<PageWeightSourceFilter>('all');
  const [selectedPage, setSelectedPage] = useState<PageWeightPage | null>(null);
  const data = scan.data ?? snapshot.data?.result ?? null;
  const lastScanned = formatScanDate(snapshot.data?.createdAt);
  const pages = data?.pages ?? [];
  const maxSize = pages.reduce((largest, page) => Math.max(largest, page.totalSize), 0);
  const heavyPages = pages.filter((page) => page.totalSize > PAGE_WEIGHT_THRESHOLDS.heavy).length;
  const avgWeight = averagePageWeight(pages);

  const filteredPages = useMemo(() => {
    const query = search.trim().toLowerCase();
    return pages.filter((page) => {
      const source = pageSource(page.page);
      if (filter !== 'all' && source !== filter) return false;
      if (!query) return true;
      return page.page.toLowerCase().includes(query)
        || page.assets.some((asset) => asset.name.toLowerCase().includes(query));
    });
  }, [filter, pages, search]);

  const runScan = () => {
    toast('Page weight re-scan started', 'info');
    scan.mutate(undefined, {
      onSuccess: () => toast('Page weight scan complete', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Page weight scan failed'), 'error'),
    });
  };

  const clearFilters = () => {
    setSearch('');
    setFilter('all');
  };

  const assetColumns = useMemo<DataColumn[]>(() => [
    {
      key: 'name',
      label: 'Asset',
      width: 'minmax(220px, 1.8fr)',
      sortable: true,
      render: (_value, record) => (
        <span className="block truncate font-semibold text-[var(--brand-text-bright)]">
          {(record as AssetRecord).source.name || 'Unnamed asset'}
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      width: '120px',
      render: (_value, record) => (
        <Badge label={assetTypeLabel((record as AssetRecord).source.contentType)} tone="blue" variant="outline" size="sm" />
      ),
    },
    {
      key: 'size',
      label: 'Size',
      width: '120px',
      align: 'right',
      sortable: true,
      render: (_value, record) => {
        const asset = (record as AssetRecord).source;
        const large = asset.size > PAGE_WEIGHT_THRESHOLDS.largeAsset;
        return (
          <div className="flex justify-end gap-2">
            {large && <Badge label=">500KB" tone="amber" variant="soft" size="sm" />}
            <span className="tabular-nums text-[var(--brand-text-bright)]">{formatBytes(asset.size)}</span>
          </div>
        );
      },
    },
  ], []);

  if (snapshot.isLoading && !data) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading Page Weight snapshot">
        <Skeleton className="h-[54px] w-full" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (snapshot.isError && !data) {
    return (
      <ErrorState
        type="data"
        title="Page weight snapshot did not load"
        message="Retry the saved scan before running a fresh page-weight analysis."
        action={{ label: 'Retry', onClick: () => snapshot.refetch() }}
        className="min-h-[360px]"
      />
    );
  }

  if (!data && !scan.isPending) {
    return (
      <EmptyState
        icon={WeightEmptyIcon}
        title="Run a page weight scan"
        description="Scan published pages, CMS image references, and CSS image usage to find the heaviest pages."
        action={(
          <Button size="sm" variant="primary" onClick={runScan} disabled={!siteId}>
            <Icon name="refresh" size="sm" />
            Run Audit
          </Button>
        )}
      />
    );
  }

  if (scan.isPending && !data) {
    return (
      <div className="flex flex-col gap-3" aria-label="Scanning page weight">
        <InlineBanner tone="info" title="Scanning page weight">
          Published pages and assets are being analyzed. This may take 30-60 seconds.
        </InlineBanner>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (scan.isError && !data) {
    return (
      <ErrorState
        type="data"
        title="Page weight scan failed"
        message={mutationErrorMessage(scan.error, 'Page weight scan failed')}
        action={{ label: 'Retry scan', onClick: runScan }}
        className="min-h-[360px]"
      />
    );
  }

  const defaultEmpty = pages.length === 0;

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Pages with Assets" value={data?.totalPages ?? 0} accent="var(--blue)" className="min-w-0" />
        <MetricTile label="Total Asset Size" value={formatBytes(data?.totalAssetSize ?? 0)} accent="var(--blue)" className="min-w-0" />
        <MetricTile label="Heavy Pages (>2MB)" value={heavyPages} accent={heavyPages > 0 ? 'var(--orange)' : 'var(--emerald)'} className="min-w-0" />
        <MetricTile label="Avg Page Weight" value={formatBytes(avgWeight)} accent="var(--blue)" className="min-w-0" />
      </div>

      <Toolbar label="Page weight controls" className="w-full">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search pages or assets"
          className="min-w-[240px] flex-1"
        />
        <FormSelect
          aria-label="Page weight source"
          value={filter}
          onChange={(value) => setFilter(value as PageWeightSourceFilter)}
          options={SOURCE_FILTERS.map((item) => ({ value: item.id, label: item.label }))}
          className="w-full sm:w-[150px]"
        />
        <ToolbarSpacer />
        {lastScanned && <span className="t-caption text-[var(--brand-text-muted)]">Last scanned {lastScanned}</span>}
        <Button size="sm" variant="secondary" onClick={runScan} disabled={scan.isPending}>
          <Icon name="refresh" size="sm" />
          Re-scan
        </Button>
      </Toolbar>

      {scan.isError && data && (
        <InlineBanner tone="warning" title="Page weight may be stale">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-body">Page weight data did not refresh, so the last loaded scan is still shown.</span>
            <Button size="sm" variant="secondary" onClick={runScan}>Retry scan</Button>
          </div>
        </InlineBanner>
      )}

      {filteredPages.length > 0 ? (
        <div className="flex flex-col gap-2" aria-label="Page weight results">
          {filteredPages.map((page) => {
            return (
              <SectionCard key={page.page} noPadding variant="subtle">
                <ClickableRow
                  className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_90px_92px]"
                  onClick={() => setSelectedPage(page)}
                  aria-label={`Inspect ${page.page}, ${page.assetCount} assets, ${formatBytes(page.totalSize)}`}
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon name="arrowRight" size="sm" className="flex-none text-[var(--brand-text-dim)]" aria-hidden="true" />
                      <span className="truncate t-ui font-semibold text-[var(--brand-text-bright)]">{page.page}</span>
                    </div>
                    <div className="ml-[22px] mt-2">
                      <Meter
                        value={pageWeightPercent(page, maxSize)}
                        color={pageWeightAccent(page.totalSize)}
                        ariaLabel={`${page.page} page weight rank`}
                      />
                    </div>
                  </div>
                  <span className="hidden text-right t-caption-sm tabular-nums text-[var(--brand-text-muted)] sm:block">
                    {page.assetCount} asset{page.assetCount === 1 ? '' : 's'}
                  </span>
                  <span className="text-right t-ui font-semibold tabular-nums" style={{ color: pageWeightAccent(page.totalSize) }}>
                    {formatBytes(page.totalSize)}
                  </span>
                </ClickableRow>
              </SectionCard>
            );
          })}
        </div>
      ) : (defaultEmpty ? (
          <EmptyState
            icon={WeightEmptyIcon}
            title="No page-weight results"
            description="The latest scan did not find published page assets. Re-run after assets are published."
            action={<Button size="sm" variant="secondary" onClick={runScan}>Re-scan</Button>}
          />
        ) : (
          <EmptyState
            icon={SearchEmptyIcon}
            title="No pages match this view"
            description="Clear the search or source filter to show the scanned pages again."
            action={<Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button>}
          />
        ))}

      {heavyPages > 0 && (
        <InlineBanner tone="warning" size="sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              <strong className="font-semibold text-[var(--brand-text-bright)]">
                {heavyPages} heavy page{heavyPages === 1 ? '' : 's'} found
              </strong>
              {' — '}compress their images in Asset Manager to cut weight and improve LCP.
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigate(`${adminPath(workspaceId, 'media')}?filter=oversized`)}
            >
              <Icon name="image" size="sm" />
              Asset Manager
              <Icon name="arrowRight" size="sm" />
            </Button>
          </div>
        </InlineBanner>
      )}

      <Drawer
        open={selectedPage != null}
        onClose={() => setSelectedPage(null)}
        title={selectedPage?.page ?? 'Page assets'}
        subtitle={selectedPage ? `${selectedPage.assetCount} asset${selectedPage.assetCount === 1 ? '' : 's'} · ${formatBytes(selectedPage.totalSize)}` : undefined}
        eyebrow="Page weight detail"
        width={640}
      >
        {selectedPage ? (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricTile label="Page Weight" value={formatBytes(selectedPage.totalSize)} accent={pageWeightAccent(selectedPage.totalSize)} />
              <MetricTile label="Assets" value={selectedPage.assetCount} accent="var(--blue)" />
              <MetricTile label="Source" value={pageSourceLabel(pageSource(selectedPage.page))} accent="var(--teal)" />
            </div>
            <p className="t-body text-[var(--brand-text-muted)]">
              Assets over 500KB are emphasized because they are strong compression candidates.
            </p>
            <DataTable
              columns={assetColumns}
              rows={assetRows(selectedPage.assets)}
              getRowKey={(record) => (record as AssetRecord).source.id}
              empty={<EmptyState icon={SearchEmptyIcon} title="No assets on this page" />}
            />
          </div>
        ) : (
          <InlineBanner tone="info" title="No page selected">Pick a row to inspect its asset breakdown.</InlineBanner>
        )}
      </Drawer>
    </div>
  );
}
