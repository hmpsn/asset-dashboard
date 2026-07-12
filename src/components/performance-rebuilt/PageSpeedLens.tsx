// @ds-rebuilt
import { useMemo, useState } from 'react';
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
  SectionCard,
  Segmented,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
  type DataColumn,
} from '../ui';
import { adminPath } from '../../routes';
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
type SinglePageResults = Partial<Record<PageSpeedStrategy, PageSpeedResult>>;

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

function resultMatchesPage(result: PageSpeedResult, page: WebflowPageOption): boolean {
  if (result.page.trim().toLowerCase() === page.title.trim().toLowerCase()) return true;
  try {
    const resultPath = new URL(result.url).pathname.replace(/\/$/, '') || '/';
    // page-slug-url-ok — comparison-only path normalization, never a navigable or fetch URL.
    const selectedPath = (page.publishedPath ?? (page.slug ? `/${page.slug}` : '/')).replace(/\/$/, '') || '/';
    return resultPath === selectedPath;
  } catch {
    return false;
  }
}

function savedPageResult(result: SiteSpeedResult | null | undefined, page: WebflowPageOption | null): PageSpeedResult | null {
  if (!result || !page) return null;
  return result.pages.find((candidate) => resultMatchesPage(candidate, page)) ?? null;
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
  const available = typeof value === 'number' && Number.isFinite(value);
  const rating = vitalRating(vitalKey, value);
  return (
    <MetricTile
      label={label}
      value={formatted}
      accent={available ? ratingAccent(rating) : 'var(--brand-text-muted)'}
      sub={!available ? 'Unavailable' : rating === 'good' ? 'Good' : rating === 'poor' ? 'Poor' : 'Needs work'}
    />
  );
}

function VitalsGrid({ vitals }: { vitals: CoreWebVitals }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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

function SingleStrategyResultCard({
  strategy,
  result,
  page,
}: {
  strategy: PageSpeedStrategy;
  result: PageSpeedResult | null;
  page: WebflowPageOption;
}) {
  const label = strategyLabel(strategy);
  return (
    <SectionCard
      title={`${label} result`}
      subtitle={result ? `${result.page || page.title} · ${formatPageSpeedDate(result.fetchedAt)}` : `No saved test for ${page.title}`}
      titleIcon={<Icon name={strategy === 'mobile' ? 'user' : 'globe'} size="sm" className="text-[var(--blue)]" />}
      iconChip
      action={result ? <ProvenanceBadge fieldDataAvailable={result.fieldDataAvailable} /> : undefined}
      className="min-w-0"
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <MetricRing score={result.score} size={82} noAnimation />
            <p className="t-body text-[var(--brand-text-muted)]">
              Lighthouse performance score plus the full Core Web Vitals set.
            </p>
          </div>
          <VitalsGrid vitals={result.vitals} />
        </div>
      ) : (
        <div className="flex min-h-[116px] items-center">
          <p className="t-body text-[var(--brand-text-muted)]">
            Use the test controls above to add a truthful {label.toLowerCase()} result for this page.
          </p>
        </div>
      )}
    </SectionCard>
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

function PageSpeedEvidence({ result }: { result: PageSpeedResult }) {
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
    <div className="flex flex-col gap-3">
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

function PageSpeedDetail({ result }: { result: PageSpeedResult }) {
  return (
    <div className="flex flex-col gap-4">
      <ScoreSummary result={result} label={strategyLabel(result.strategy)} fieldDataAvailable={result.fieldDataAvailable} />
      <PageSpeedEvidence result={result} />
    </div>
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
  const [singleResultsByPage, setSingleResultsByPage] = useState<Record<string, SinglePageResults>>({});
  const [selectedResult, setSelectedResult] = useState<PageSpeedResult | null>(null);
  const pages = useAdminPerformancePages(workspaceId, siteId);
  const mobileSnapshot = useAdminPageSpeedSnapshot(workspaceId, siteId, 'mobile');
  const desktopSnapshot = useAdminPageSpeedSnapshot(workspaceId, siteId, 'desktop');
  const bulk = useAdminPageSpeedBulk(workspaceId, siteId);
  const single = useAdminPageSpeedSingle(workspaceId, siteId);
  const currentSnapshot = strategy === 'mobile' ? mobileSnapshot : desktopSnapshot;
  const currentBulkResult = (bulk.data?.strategy === strategy ? bulk.data : currentSnapshot.data?.result) ?? null;
  const currentScannedAt = formatScanDate(currentSnapshot.data?.createdAt);
  const effectiveSelectedPageId = selectedPageId || pages.data?.[0]?.id || '';
  const selectedPage = pages.data?.find((page) => page.id === effectiveSelectedPageId) ?? null;
  const selectedSingleResults = singleResultsByPage[effectiveSelectedPageId];
  const mobileResult = selectedSingleResults?.mobile ?? savedPageResult(mobileSnapshot.data?.result, selectedPage);
  const desktopResult = selectedSingleResults?.desktop ?? savedPageResult(desktopSnapshot.data?.result, selectedPage);
  const activeSingleResult = strategy === 'mobile' ? mobileResult : desktopResult;
  const hasAnySingleResult = !!mobileResult || !!desktopResult;
  const busy = bulk.isPending || single.isPending;

  const filteredPages = useMemo(() => {
    const query = pageSearch.trim().toLowerCase();
    if (!query) return pages.data ?? [];
    return (pages.data ?? []).filter((page) => pageLabel(page).toLowerCase().includes(query));
  }, [pageSearch, pages.data]);

  const runBulk = (nextStrategy = strategy) => {
    setMode('bulk');
    setStrategy(nextStrategy);
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
          setSingleResultsByPage((current) => ({
            ...current,
            [selectedPage.id]: { ...current[selectedPage.id], [nextStrategy]: result },
          }));
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

  const activeError = mode === 'single' ? single.error : bulk.error;
  const hasActiveResult = mode === 'single' ? hasAnySingleResult : !!currentBulkResult;
  const hardError = (mode === 'single' ? single.isError : bulk.isError) && !hasActiveResult;

  return (
    <div className="flex flex-col gap-[14px]">
      <Toolbar label="PageSpeed controls" className="w-full">
        <Segmented
          options={MODE_OPTIONS}
          value={mode}
          onChange={(value) => {
            setMode(value as PageSpeedMode);
            setSelectedResult(null);
          }}
        />
        <Segmented options={STRATEGY_OPTIONS} value={strategy} onChange={(value) => setStrategy(value as PageSpeedStrategy)} />
        <ToolbarSpacer />
        {mode === 'bulk' && currentScannedAt && (
          <span className="t-caption text-[var(--brand-text-muted)]">Last scanned {currentScannedAt}</span>
        )}
      </Toolbar>

      {mode === 'single' ? (
        <Toolbar label="Single-page PageSpeed test" className="w-full">
          <SearchField
            value={pageSearch}
            onChange={setPageSearch}
            placeholder="Search Webflow pages"
            className="min-w-[220px] flex-1"
          />
          <FormSelect
            aria-label="PageSpeed page"
            value={effectiveSelectedPageId}
            onChange={(value) => {
              setSelectedPageId(value);
              setSelectedResult(null);
            }}
            options={filteredPages.map((page) => ({ value: page.id, label: pageLabel(page) }))}
            placeholder={pages.isLoading ? 'Loading pages' : 'Select a page'}
            className="min-w-[260px] flex-1"
          />
          <Button size="sm" variant="primary" onClick={() => runSingle('mobile')} disabled={busy || !selectedPage}>
            <Icon name="gauge" size="sm" />
            Test Mobile
          </Button>
          <Button size="sm" variant="secondary" onClick={() => runSingle('desktop')} disabled={busy || !selectedPage}>
            <Icon name="gauge" size="sm" />
            Test Desktop
          </Button>
        </Toolbar>
      ) : (
        <SectionCard
          title="Bulk PageSpeed scan"
          subtitle="Test the top published pages and persist the averaged strategy snapshot."
          variant="subtle"
        >
          <Toolbar label="Bulk PageSpeed test" className="w-full">
            <FormSelect
              aria-label="Bulk PageSpeed page count"
              value={String(maxPages)}
              onChange={(value) => setMaxPages(Number(value))}
              options={MAX_PAGE_OPTIONS}
              className="w-[150px]"
            />
            <ToolbarSpacer />
            <Button size="sm" variant="primary" onClick={() => runBulk('mobile')} disabled={busy}>
              <Icon name="gauge" size="sm" />
              Test Mobile
            </Button>
            <Button size="sm" variant="secondary" onClick={() => runBulk('desktop')} disabled={busy}>
              <Icon name="gauge" size="sm" />
              Test Desktop
            </Button>
          </Toolbar>
        </SectionCard>
      )}

      {busy && (
        <InlineBanner tone="info" title="Running PageSpeed analysis">
          Testing via Google PageSpeed Insights API. This may take 30-60 seconds.
        </InlineBanner>
      )}

      {(mode === 'single' ? single.isError : bulk.isError) && hasActiveResult && (
        <InlineBanner tone="warning" title="PageSpeed data may be stale">
          <div className="flex flex-wrap items-center gap-2">
            <span>{pageSpeedErrorMessage(mutationErrorMessage(activeError, 'PageSpeed analysis failed'))}</span>
            <Button size="sm" variant="secondary" onClick={() => (mode === 'single' ? runSingle(strategy) : runBulk(strategy))}>
              Retry
            </Button>
          </div>
        </InlineBanner>
      )}

      {mode === 'bulk' && currentSnapshot.isError && !currentBulkResult && !hardError && (
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
          message={pageSpeedErrorMessage(mutationErrorMessage(activeError, 'PageSpeed analysis failed'))}
          action={{ label: 'Retry', onClick: () => (mode === 'single' ? runSingle(strategy) : runBulk(strategy)) }}
          className="min-h-[320px]"
        />
      )}

      {mode === 'bulk' && busy && !hasActiveResult && !hardError && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading PageSpeed results">
          {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
      )}

      {mode === 'single' && selectedPage && !hardError && (
        <section className="flex flex-col gap-3" aria-labelledby="selected-page-results-heading">
          <div className="flex flex-wrap items-center gap-2">
            <Badge label="Single Page" tone="teal" variant="soft" size="sm" />
            <h3 id="selected-page-results-heading" className="t-ui font-semibold text-[var(--brand-text-bright)]">Selected page results</h3>
            <span className="t-caption text-[var(--brand-text-muted)]">{pageLabel(selectedPage)}</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <SingleStrategyResultCard strategy="mobile" result={mobileResult} page={selectedPage} />
            <SingleStrategyResultCard strategy="desktop" result={desktopResult} page={selectedPage} />
          </div>
          {activeSingleResult ? (
            <PageSpeedEvidence result={activeSingleResult} />
          ) : (
            <InlineBanner tone="info" size="sm" title={`No ${strategyLabel(strategy).toLowerCase()} evidence for ${selectedPage.title}`}>
              Run this strategy to restore its opportunities and diagnostics.
            </InlineBanner>
          )}
        </section>
      )}

      {mode === 'bulk' && currentBulkResult && !hardError && (
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

      {mode === 'bulk' && !busy && !currentBulkResult && !hardError && (
        <EmptyState
          icon={SpeedEmptyIcon}
          title="Run a bulk PageSpeed test"
          description="Choose a strategy and page count to restore the saved site-wide PageSpeed snapshot."
          action={<Button size="sm" variant="primary" onClick={() => runBulk(strategy)}>Run Audit</Button>}
        />
      )}

      <InlineBanner tone="info" size="sm">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            <strong className="font-semibold text-[var(--brand-text-bright)]">Speed fixes start in Asset Manager.</strong>
            {' '}Use PageSpeed to identify Core Web Vitals issues, then repair oversized source files before retesting.
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
