// @ds-rebuilt
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAdminPageSpeedBulk,
  useAdminPageSpeedSingle,
  useAdminPageSpeedSnapshot,
  useAdminPerformancePages,
  type CoreWebVitals,
  type PageSpeedDiagnostic,
  type PageSpeedOpportunity,
  type PageSpeedResult,
  type PageSpeedStrategy,
  type SiteSpeedResult,
  type WebflowPageOption,
} from '../../hooks/admin/useAdminPerformance';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  FormSelect,
  GroupBlock,
  Icon,
  InlineBanner,
  MetricRing,
  MetricTile,
  SearchField,
  Segmented,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
  type DataColumn,
} from '../ui';
import { adminPath } from '../../routes';
import { scoreColor } from '../ui/constants';
import { mutationErrorMessage } from './performanceMutationFeedback';
import {
  formatCls,
  formatMilliseconds,
  formatPageSpeedDate,
  formatScanDate,
  pageSpeedErrorMessage,
  ratingAccent,
  ratingTone,
  strategyLabel,
  vitalRating,
} from './performanceFormatters';

interface PageSpeedLensProps {
  workspaceId: string;
  siteId: string;
}

type PageSpeedMode = 'single' | 'bulk';

type PageSpeedRecord = Record<string, unknown> & {
  source: PageSpeedResult;
  page: string;
  score: number;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  opportunities: number;
};

type OpportunityRecord = Record<string, unknown> & {
  source: PageSpeedOpportunity;
  title: string;
  savings: string | null;
  score: number;
};

type DiagnosticRecord = Record<string, unknown> & {
  source: PageSpeedDiagnostic;
  title: string;
  displayValue: string | null;
};

const MODE_OPTIONS = [
  { value: 'single', label: 'Single Page' },
  { value: 'bulk', label: 'Bulk Top Pages' },
];

const STRATEGY_OPTIONS = [
  { value: 'mobile', label: 'Mobile' },
  { value: 'desktop', label: 'Desktop' },
];

const MAX_PAGE_OPTIONS = [
  { value: '3', label: 'Top 3' },
  { value: '5', label: 'Top 5' },
  { value: '10', label: 'Top 10' },
  { value: '25', label: 'Top 25' },
];

const VITALS: Array<{
  key: keyof CoreWebVitals;
  label: string;
  formatter: (value: number | null | undefined) => string;
}> = [
  { key: 'LCP', label: 'LCP', formatter: formatMilliseconds },
  { key: 'FCP', label: 'FCP', formatter: formatMilliseconds },
  { key: 'CLS', label: 'CLS', formatter: formatCls },
  { key: 'INP', label: 'INP', formatter: formatMilliseconds },
  { key: 'TBT', label: 'TBT', formatter: formatMilliseconds },
  { key: 'SI', label: 'Speed Index', formatter: formatMilliseconds },
];

function SpeedEmptyIcon({ className }: { className?: string }) {
  return <Icon name="gauge" className={className} />;
}

function SearchEmptyIcon({ className }: { className?: string }) {
  return <Icon name="search" className={className} />;
}

function pageLabel(page: WebflowPageOption): string {
  // page-slug-url-ok — display-only label string, not a navigable/fetch URL.
  const path = page.publishedPath ?? (page.slug ? `/${page.slug}` : '/');
  return `${page.title} (${path})`;
}

function pagePath(page: WebflowPageOption): string {
  return page.publishedPath ?? page.slug;
}

function pageSpeedRows(result: SiteSpeedResult | null): PageSpeedRecord[] {
  return (result?.pages ?? []).map((page) => ({
    source: page,
    page: page.page,
    score: page.score,
    lcp: page.vitals.LCP,
    cls: page.vitals.CLS,
    inp: page.vitals.INP,
    opportunities: page.opportunities.length,
  }));
}

function opportunityRows(items: PageSpeedOpportunity[]): OpportunityRecord[] {
  return items.map((item) => ({
    source: item,
    title: item.title,
    savings: item.savings,
    score: item.score,
  }));
}

function diagnosticRows(items: PageSpeedDiagnostic[]): DiagnosticRecord[] {
  return items.map((item) => ({
    source: item,
    title: item.title,
    displayValue: item.displayValue ?? null,
  }));
}

function ProvenanceBadge({ fieldDataAvailable }: { fieldDataAvailable?: boolean }) {
  return fieldDataAvailable
    ? <Badge label="Field data" tone="emerald" variant="soft" size="sm" />
    : <Badge label="Lab test" tone="amber" variant="soft" size="sm" />;
}

function VitalTile({
  label,
  vitalKey,
  value,
  formatted,
}: {
  label: string;
  vitalKey: string;
  value: number | null | undefined;
  formatted: string;
}) {
  const rating = vitalRating(vitalKey, value);
  return (
    <MetricTile
      label={label}
      value={formatted}
      accent={ratingAccent(rating)}
      sub={rating === 'good' ? 'Good' : rating === 'poor' ? 'Poor' : 'Needs work'}
    />
  );
}

function VitalsGrid({ vitals }: { vitals: CoreWebVitals }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {VITALS.map((item) => (
        <VitalTile
          key={item.key}
          label={item.label}
          vitalKey={item.key}
          value={vitals[item.key]}
          formatted={item.formatter(vitals[item.key])}
        />
      ))}
    </div>
  );
}

function ScoreSummary({
  result,
  label,
  fieldDataAvailable,
}: {
  result: SiteSpeedResult | PageSpeedResult;
  label: string;
  fieldDataAvailable?: boolean;
}) {
  const score = 'averageScore' in result ? result.averageScore : result.score;
  const vitals = 'averageVitals' in result ? result.averageVitals : result.vitals;
  return (
    <div className="grid gap-4 xl:grid-cols-[auto_1fr]">
      <div className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
        <MetricRing score={score} size={96} noAnimation />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge label={label} tone="teal" variant="soft" size="sm" />
            <ProvenanceBadge fieldDataAvailable={fieldDataAvailable} />
          </div>
          <p className="mt-2 t-body text-[var(--brand-text-muted)]">
            Lighthouse performance score plus the full Core Web Vitals set.
          </p>
        </div>
      </div>
      <VitalsGrid vitals={vitals} />
    </div>
  );
}

function PageSpeedDetail({ result }: { result: PageSpeedResult }) {
  const opportunityColumns = useMemo<DataColumn[]>(() => [
    {
      key: 'title',
      label: 'Opportunity',
      width: 'minmax(260px, 1.6fr)',
      sortable: true,
      render: (_value, record) => {
        const item = (record as OpportunityRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{item.title}</span>
            <span className="block t-caption-sm text-[var(--brand-text-muted)]">{item.description}</span>
          </div>
        );
      },
    },
    {
      key: 'savings',
      label: 'Savings',
      width: '120px',
      align: 'right',
      render: (_value, record) => (
        <span className="tabular-nums">{(record as OpportunityRecord).source.savings ?? '—'}</span>
      ),
    },
    {
      key: 'score',
      label: 'Score',
      width: '92px',
      align: 'right',
      sortable: true,
      render: (_value, record) => (
        <span className="tabular-nums">{Math.round(((record as OpportunityRecord).source.score ?? 0) * 100)}</span>
      ),
    },
  ], []);

  const diagnosticColumns = useMemo<DataColumn[]>(() => [
    {
      key: 'title',
      label: 'Diagnostic',
      width: 'minmax(260px, 1.6fr)',
      sortable: true,
      render: (_value, record) => {
        const item = (record as DiagnosticRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{item.title}</span>
            <span className="block t-caption-sm text-[var(--brand-text-muted)]">{item.description}</span>
          </div>
        );
      },
    },
    {
      key: 'displayValue',
      label: 'Value',
      width: '140px',
      align: 'right',
      render: (_value, record) => (
        <span className="tabular-nums">{(record as DiagnosticRecord).source.displayValue ?? '—'}</span>
      ),
    },
  ], []);

  return (
    <div className="flex flex-col gap-5">
      <ScoreSummary result={result} label={strategyLabel(result.strategy)} fieldDataAvailable={result.fieldDataAvailable} />
      <GroupBlock
        title={`Opportunities (${result.opportunities.length})`}
        meta="Savings reported by PageSpeed Insights. Most speed opportunities resolve in Asset Manager after review."
        collapsible
        defaultOpen={false}
      >
        {result.opportunities.length > 0 ? (
          <DataTable
            columns={opportunityColumns}
            rows={opportunityRows(result.opportunities)}
            getRowKey={(record) => (record as OpportunityRecord).source.id}
          />
        ) : (
          <InlineBanner tone="info" size="sm" title="No opportunities returned" />
        )}
      </GroupBlock>
      <GroupBlock
        title={`Diagnostics (${result.diagnostics.length})`}
        meta="Additional Lighthouse diagnostics from the same PageSpeed run."
        collapsible
        defaultOpen={false}
      >
        {result.diagnostics.length > 0 ? (
          <DataTable
            columns={diagnosticColumns}
            rows={diagnosticRows(result.diagnostics)}
            getRowKey={(record) => (record as DiagnosticRecord).source.id}
          />
        ) : (
          <InlineBanner tone="info" size="sm" title="No diagnostics returned" />
        )}
      </GroupBlock>
    </div>
  );
}

function StrategySnapshotCard({
  strategy,
  result,
  scannedAt,
  loading,
  onRun,
  pending,
}: {
  strategy: PageSpeedStrategy;
  result: SiteSpeedResult | null;
  scannedAt: string;
  loading: boolean;
  onRun: () => void;
  pending: boolean;
}) {
  return (
    <GroupBlock
      title={strategyLabel(strategy)}
      meta={scannedAt ? `Last scanned ${scannedAt}` : 'No saved bulk scan'}
      stats={result ? [
        { label: 'Score', value: result.averageScore, color: typeof result.averageScore === 'number' ? scoreColor(result.averageScore) : 'var(--brand-text-muted)' },
        { label: 'Pages', value: result.pages.length, color: 'var(--blue)' },
      ] : []}
      collapsible
      defaultOpen={!!result}
    >
      {loading && !result ? (
        <Skeleton className="h-[88px] w-full" />
      ) : result ? (
        <div className="flex flex-col gap-3">
          <ScoreSummary result={result} label={`${strategyLabel(strategy)} average`} />
          <Button size="sm" variant="secondary" onClick={onRun} disabled={pending}>
            <Icon name="refresh" size="sm" />
            Re-run {strategyLabel(strategy)}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-caption-sm text-[var(--brand-text-muted)]">Run a bulk scan to populate this strategy snapshot.</span>
          <Button size="sm" variant="secondary" onClick={onRun} disabled={pending}>
            <Icon name="refresh" size="sm" />
            Run {strategyLabel(strategy)}
          </Button>
        </div>
      )}
    </GroupBlock>
  );
}

export function PageSpeedLens({ workspaceId, siteId }: PageSpeedLensProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mode, setMode] = useState<PageSpeedMode>('single');
  const [strategy, setStrategy] = useState<PageSpeedStrategy>('mobile');
  const [maxPages, setMaxPages] = useState(3);
  const [pageSearch, setPageSearch] = useState('');
  const [selectedPageId, setSelectedPageId] = useState('');
  const [singleResult, setSingleResult] = useState<PageSpeedResult | null>(null);
  const [selectedResult, setSelectedResult] = useState<PageSpeedResult | null>(null);
  const pages = useAdminPerformancePages(workspaceId, siteId);
  const mobileSnapshot = useAdminPageSpeedSnapshot(workspaceId, siteId, 'mobile');
  const desktopSnapshot = useAdminPageSpeedSnapshot(workspaceId, siteId, 'desktop');
  const bulk = useAdminPageSpeedBulk(workspaceId, siteId);
  const single = useAdminPageSpeedSingle(workspaceId, siteId);
  const currentSnapshot = strategy === 'mobile' ? mobileSnapshot : desktopSnapshot;
  const currentBulkResult = (bulk.data?.strategy === strategy ? bulk.data : currentSnapshot.data?.result) ?? null;
  const currentScannedAt = formatScanDate(currentSnapshot.data?.createdAt);
  const selectedPage = pages.data?.find((page) => page.id === selectedPageId) ?? null;
  const busy = bulk.isPending || single.isPending;

  useEffect(() => {
    if (selectedPageId || !pages.data?.length) return;
    setSelectedPageId(pages.data[0].id);
  }, [pages.data, selectedPageId]);

  const filteredPages = useMemo(() => {
    const query = pageSearch.trim().toLowerCase();
    if (!query) return pages.data ?? [];
    return (pages.data ?? []).filter((page) => pageLabel(page).toLowerCase().includes(query));
  }, [pageSearch, pages.data]);

  const runBulk = (nextStrategy = strategy) => {
    setMode('bulk');
    setStrategy(nextStrategy);
    setSingleResult(null);
    toast(`${strategyLabel(nextStrategy)} PageSpeed bulk test started`, 'info');
    bulk.mutate(
      { strategy: nextStrategy, maxPages },
      {
        onSuccess: () => toast(`${strategyLabel(nextStrategy)} PageSpeed bulk test complete`, 'success'),
        onError: (error) => toast(mutationErrorMessage(error, 'PageSpeed bulk test failed'), 'error'),
      },
    );
  };

  const runSingle = (nextStrategy = strategy) => {
    if (!selectedPage) return;
    setMode('single');
    setStrategy(nextStrategy);
    setSingleResult(null);
    toast(`${strategyLabel(nextStrategy)} PageSpeed test started`, 'info');
    single.mutate(
      {
        pageId: selectedPage.id,
        pageSlug: pagePath(selectedPage),
        pageTitle: selectedPage.title,
        strategy: nextStrategy,
      },
      {
        onSuccess: (result) => {
          setSingleResult(result);
          toast(`${strategyLabel(nextStrategy)} PageSpeed test complete`, 'success');
        },
        onError: (error) => toast(mutationErrorMessage(error, 'PageSpeed test failed'), 'error'),
      },
    );
  };

  const tableColumns = useMemo<DataColumn[]>(() => [
    {
      key: 'score',
      label: 'Score',
      width: '90px',
      align: 'center',
      sortable: true,
      render: (_value, record) => <MetricRing score={(record as PageSpeedRecord).source.score} size={52} noAnimation />,
    },
    {
      key: 'page',
      label: 'Page',
      width: 'minmax(260px, 1.8fr)',
      sortable: true,
      render: (_value, record) => {
        const row = (record as PageSpeedRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{row.page || row.url}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{row.url}</span>
          </div>
        );
      },
    },
    {
      key: 'provenance',
      label: 'Source',
      width: '120px',
      render: (_value, record) => <ProvenanceBadge fieldDataAvailable={(record as PageSpeedRecord).source.fieldDataAvailable} />,
    },
    {
      key: 'lcp',
      label: 'LCP',
      width: '96px',
      align: 'right',
      sortable: true,
      render: (_value, record) => {
        const value = (record as PageSpeedRecord).source.vitals.LCP;
        return <Badge label={formatMilliseconds(value)} tone={ratingTone(vitalRating('LCP', value))} variant="soft" size="sm" />;
      },
    },
    {
      key: 'cls',
      label: 'CLS',
      width: '86px',
      align: 'right',
      sortable: true,
      render: (_value, record) => {
        const value = (record as PageSpeedRecord).source.vitals.CLS;
        return <Badge label={formatCls(value)} tone={ratingTone(vitalRating('CLS', value))} variant="soft" size="sm" />;
      },
    },
    {
      key: 'inp',
      label: 'INP',
      width: '96px',
      align: 'right',
      sortable: true,
      render: (_value, record) => {
        const value = (record as PageSpeedRecord).source.vitals.INP;
        return <Badge label={formatMilliseconds(value)} tone={ratingTone(vitalRating('INP', value))} variant="soft" size="sm" />;
      },
    },
    {
      key: 'opportunities',
      label: 'Opps',
      width: '82px',
      align: 'right',
      sortable: true,
      render: (_value, record) => (
        <span className="tabular-nums">{(record as PageSpeedRecord).source.opportunities.length}</span>
      ),
    },
  ], []);

  const hardError = (bulk.isError || single.isError) && !currentBulkResult && !singleResult;
  const error = single.error ?? bulk.error;

  return (
    <div className="flex flex-col gap-5">
      <Toolbar label="PageSpeed controls" className="w-full">
        <Segmented options={MODE_OPTIONS} value={mode} onChange={(value) => setMode(value as PageSpeedMode)} />
        <Segmented options={STRATEGY_OPTIONS} value={strategy} onChange={(value) => setStrategy(value as PageSpeedStrategy)} />
        <ToolbarSpacer />
        {currentScannedAt && <span className="t-caption text-[var(--brand-text-muted)]">Last scanned {currentScannedAt}</span>}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => (mode === 'single' ? runSingle(strategy) : runBulk(strategy))}
          disabled={busy || (mode === 'single' && !selectedPage)}
        >
          <Icon name="refresh" size="sm" />
          Re-scan
        </Button>
      </Toolbar>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
        {mode === 'single' ? (
          <div className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <SearchField
                value={pageSearch}
                onChange={setPageSearch}
                placeholder="Search Webflow pages"
                className="min-w-[220px] flex-1"
              />
              <FormSelect
                aria-label="PageSpeed page"
                value={selectedPageId}
                onChange={setSelectedPageId}
                options={filteredPages.map((page) => ({ value: page.id, label: pageLabel(page) }))}
                placeholder={pages.isLoading ? 'Loading pages' : 'Select a page'}
                className="min-w-[260px] flex-1"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => runSingle('mobile')} disabled={busy || !selectedPage}>
                <Icon name="gauge" size="sm" />
                Test Mobile
              </Button>
              <Button size="sm" variant="secondary" onClick={() => runSingle('desktop')} disabled={busy || !selectedPage}>
                <Icon name="gauge" size="sm" />
                Test Desktop
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-3">
            <p className="t-body text-[var(--brand-text-muted)]">
              Bulk tests the top published pages and persists the averaged strategy snapshot.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => runBulk('mobile')} disabled={busy}>
                <Icon name="gauge" size="sm" />
                Test Mobile
              </Button>
              <Button size="sm" variant="secondary" onClick={() => runBulk('desktop')} disabled={busy}>
                <Icon name="gauge" size="sm" />
                Test Desktop
              </Button>
            </div>
          </div>
        )}
        <FormSelect
          aria-label="Bulk PageSpeed page count"
          value={String(maxPages)}
          onChange={(value) => setMaxPages(Number(value))}
          options={MAX_PAGE_OPTIONS}
          className="self-start"
        />
      </div>

      <InlineBanner tone="info" title="Speed fixes start in Asset Manager">
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-body">Use PageSpeed to identify Core Web Vitals issues. For image-heavy opportunities, repair oversized source files in Asset Manager before retesting.</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`${adminPath(workspaceId, 'media')}?filter=oversized`)}
          >
            <Icon name="image" size="sm" />
            Open assets
          </Button>
        </div>
      </InlineBanner>

      {busy && (
        <InlineBanner tone="info" title="Running PageSpeed analysis">
          Testing via Google PageSpeed Insights API. This may take 30-60 seconds.
        </InlineBanner>
      )}

      {(bulk.isError || single.isError) && (currentBulkResult || singleResult) && (
        <InlineBanner tone="warning" title="PageSpeed data may be stale">
          <div className="flex flex-wrap items-center gap-2">
            <span>{pageSpeedErrorMessage(mutationErrorMessage(error, 'PageSpeed analysis failed'))}</span>
            <Button size="sm" variant="secondary" onClick={() => (mode === 'single' ? runSingle(strategy) : runBulk(strategy))}>
              Retry
            </Button>
          </div>
        </InlineBanner>
      )}

      {currentSnapshot.isError && !currentBulkResult && !singleResult && !hardError && (
        <ErrorState
          type="data"
          title="PageSpeed snapshot did not load"
          message="Retry the saved PageSpeed snapshot before running a new scan."
          action={{ label: 'Retry snapshot', onClick: () => currentSnapshot.refetch() }}
          className="min-h-[320px]"
        />
      )}

      {hardError && (
        <ErrorState
          type="data"
          title="PageSpeed analysis failed"
          message={pageSpeedErrorMessage(mutationErrorMessage(error, 'PageSpeed analysis failed'))}
          action={{ label: 'Retry', onClick: () => (mode === 'single' ? runSingle(strategy) : runBulk(strategy)) }}
          className="min-h-[320px]"
        />
      )}

      {busy && !currentBulkResult && !singleResult && !hardError && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading PageSpeed results">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
      )}

      {!busy && !currentBulkResult && !singleResult && !hardError && (
        <EmptyState
          icon={SpeedEmptyIcon}
          title="Run a PageSpeed test"
          description="Test a single page or bulk-test the top pages to restore Core Web Vitals and Lighthouse diagnostics."
          action={(
            <Button size="sm" variant="primary" onClick={() => (mode === 'single' ? runSingle(strategy) : runBulk(strategy))} disabled={mode === 'single' && !selectedPage}>
              <Icon name="refresh" size="sm" />
              Run Audit
            </Button>
          )}
        />
      )}

      {singleResult && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge label="Single Page" tone="teal" variant="soft" size="sm" />
            <span className="t-caption text-[var(--brand-text-muted)]">
              {singleResult.page || singleResult.url} · {formatPageSpeedDate(singleResult.fetchedAt)}
            </span>
          </div>
          <PageSpeedDetail result={singleResult} />
        </div>
      )}

      {currentBulkResult && (
        <div className="flex flex-col gap-4">
          <ScoreSummary result={currentBulkResult} label={`${strategyLabel(currentBulkResult.strategy)} average`} />
          <DataTable
            columns={tableColumns}
            rows={pageSpeedRows(currentBulkResult)}
            getRowKey={(record) => (record as PageSpeedRecord).source.url}
            onRowClick={(record) => setSelectedResult((record as PageSpeedRecord).source)}
            empty={<EmptyState icon={SearchEmptyIcon} title="No PageSpeed pages returned" />}
          />
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <StrategySnapshotCard
          strategy="mobile"
          result={mobileSnapshot.data?.result ?? null}
          scannedAt={formatScanDate(mobileSnapshot.data?.createdAt)}
          loading={mobileSnapshot.isLoading}
          onRun={() => runBulk('mobile')}
          pending={busy}
        />
        <StrategySnapshotCard
          strategy="desktop"
          result={desktopSnapshot.data?.result ?? null}
          scannedAt={formatScanDate(desktopSnapshot.data?.createdAt)}
          loading={desktopSnapshot.isLoading}
          onRun={() => runBulk('desktop')}
          pending={busy}
        />
      </div>

      <Drawer
        open={selectedResult != null}
        onClose={() => setSelectedResult(null)}
        title={selectedResult?.page ?? 'PageSpeed detail'}
        subtitle={selectedResult?.url}
        eyebrow="PageSpeed result"
        width={720}
      >
        {selectedResult ? (
          <PageSpeedDetail result={selectedResult} />
        ) : (
          <InlineBanner tone="info" title="No result selected">Pick a row to inspect PageSpeed detail.</InlineBanner>
        )}
      </Drawer>
    </div>
  );
}
