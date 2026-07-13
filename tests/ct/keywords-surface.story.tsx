import './component-test-styles.css';

import {
  KEYWORDS_SURFACE_FILTERS,
  KEYWORDS_SURFACE_LENSES,
} from '../../src/components/keywords-rebuilt/useKeywordsSurfaceState';
import {
  Badge,
  Button,
  DataTable,
  ErrorState,
  FilterChip,
  GroupBlock,
  InlineBanner,
  IntentTag,
  LensSwitcher,
  Meter,
  MetricTile,
  PageHeader,
  SearchField,
  Skeleton,
  StatusBadge,
  Toolbar,
  ToolbarSpacer,
} from '../../src/components/ui';
import { KEYWORD_LIFECYCLE_STAGES } from '../../shared/types/keyword-command-center';
import type { KeywordCommandCenterRow, KeywordCommandCenterSummaryResponse } from '../../shared/types/keyword-command-center';
import type { DataColumn, KeywordIntent } from '../../src/components/ui';

export type KeywordsSurfaceVisualState = 'populated' | 'empty' | 'loading' | 'error' | 'locked';
export type KeywordsSurfaceVisualTheme = 'dark' | 'light';

const rows: KeywordCommandCenterRow[] = [
  {
    keyword: 'cosmetic dentistry',
    normalizedKeyword: 'cosmetic dentistry',
    lifecycleStatus: 'in_strategy',
    statusLabel: 'In Strategy',
    sourceLabels: [{ kind: 'strategy', label: 'Added via strategy' }],
    metrics: {
      intent: 'commercial',
      currentPosition: 6,
      clicks: 42,
      impressions: 900,
      volume: 700,
      difficulty: 29,
    },
    assignment: { pagePath: '/cosmetic-dentistry', pageTitle: 'Cosmetic Dentistry', topicCluster: 'Dental services' },
    tracking: { status: 'active', source: 'strategy_primary', sourceGapKey: 'gap-1', strategyOwned: true },
    nextActions: [],
    isProtected: false,
    localSeoState: {
      lifecycle: 'checked',
      lifecycleLabel: 'Tracked locally',
      priority: 'high_opportunity',
      priorityLabel: 'High opportunity',
      detail: 'Primary market visibility exists.',
      checked: true,
      marketLabel: 'Austin',
      sourceLabels: ['GBP'],
    },
    opportunityScore: 84,
    currentMonthly: 1234,
    upsideMonthly: 2400,
    lifecycleStage: KEYWORD_LIFECYCLE_STAGES.RANKING,
  },
  {
    keyword: 'emergency dentist',
    normalizedKeyword: 'emergency dentist',
    lifecycleStatus: 'tracked',
    statusLabel: 'Tracked',
    sourceLabels: [{ kind: 'manual', label: 'Manually added' }],
    metrics: {
      intent: 'local',
      currentPosition: 14,
      clicks: 5,
      impressions: 240,
      volume: 300,
      difficulty: 18,
    },
    assignment: { pagePath: '/emergency-dentist', pageTitle: 'Emergency Dentist', topicCluster: 'Dental services' },
    tracking: { status: 'active', source: 'manual', pinned: false },
    nextActions: [],
    isProtected: true,
    protectionReason: 'Tracked client keyword',
    opportunityScore: 66,
    lifecycleStage: KEYWORD_LIFECYCLE_STAGES.RANKING,
  },
];

const summary: KeywordCommandCenterSummaryResponse = {
  counts: {
    total: 2,
    inStrategy: 1,
    tracked: 2,
    needsReview: 0,
    evidence: 0,
    local: 1,
    localCandidates: 0,
    retired: 0,
    declined: 0,
    strikingDistance: 1,
  },
  filters: [
    { id: 'all', label: 'All', count: 2 },
    { id: 'tracked', label: 'Tracked', count: 2 },
    { id: 'page_assigned', label: 'Page assigned', count: 2 },
    { id: 'requested', label: 'Requested', count: 1 },
  ],
  rawEvidenceTotal: 18,
  rawEvidenceReturned: 12,
  summarizedAt: '2026-07-05T12:00:00.000Z',
  trafficValueMonthly: 1234,
};

type VisualRow = Record<string, unknown> & { source: KeywordCommandCenterRow };

const intentValues = new Set<KeywordIntent>(['commercial', 'informational', 'transactional', 'local']);

function asIntent(value: string | undefined): KeywordIntent | null {
  if (!value) return null;
  const normalized = value.toLowerCase() as KeywordIntent;
  return intentValues.has(normalized) ? normalized : null;
}

function visualRowsFor(state: KeywordsSurfaceVisualState): VisualRow[] {
  if (state === 'empty' || state === 'loading') return [];
  return rows.map((row) => ({
    source: row,
    keyword: row.keyword,
    rank: row.metrics.currentPosition ?? null,
    volume: row.metrics.volume ?? null,
    value: row.currentMonthly ?? null,
  }));
}

const columns: DataColumn[] = [
  {
    key: 'keyword',
    label: 'Keyword',
    width: 'minmax(220px, 1.8fr)',
    render: (_value, record) => {
      const row = (record as VisualRow).source;
      return (
        <div className="min-w-0">
          <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{row.keyword}</span>
          <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">
            {row.assignment?.pageTitle ?? row.assignment?.pagePath ?? 'No page assigned'}
          </span>
        </div>
      );
    },
  },
  {
    key: 'intent',
    label: 'Intent',
    width: '118px',
    render: (_value, record) => {
      const intent = asIntent((record as VisualRow).source.metrics.intent);
      return intent ? <IntentTag intent={intent} /> : <Badge label="Unknown" tone="zinc" variant="outline" size="sm" />;
    },
  },
  {
    key: 'rank',
    label: 'Rank',
    width: '84px',
    align: 'right',
    render: (_value, record) => {
      const row = (record as VisualRow).source;
      return <span>{row.metrics.currentPosition ? `#${row.metrics.currentPosition}` : 'No rank'}</span>;
    },
  },
  {
    key: 'opportunity',
    label: 'Opp',
    width: '148px',
    render: (_value, record) => {
      const row = (record as VisualRow).source;
      return typeof row.opportunityScore === 'number'
        ? <Meter value={row.opportunityScore} showValue ariaLabel={`${row.keyword} opportunity score`} gradient />
        : <span className="t-caption-sm text-[var(--brand-text-muted)]">No score</span>;
    },
  },
  {
    key: 'lifecycle',
    label: 'Lifecycle',
    width: 'minmax(180px, 1fr)',
    render: (_value, record) => {
      const row = (record as VisualRow).source;
      return (
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={row.lifecycleStatus} domain="keyword-command-center" variant="soft" />
          {row.tracking.strategyOwned === true && <Badge label="Auto-managed" tone="teal" variant="soft" size="sm" />}
          {row.isProtected && <Badge label="Protected" tone="amber" variant="outline" size="sm" />}
        </div>
      );
    },
  },
];

const SUMMARY_TILE_CLASS = [
  '!flex !h-full !min-h-[80px] !min-w-0 !flex-col !rounded-[var(--radius-lg)]',
  '[&>div:first-child]:order-2 [&>div:first-child]:!mb-0',
  '[&>div:nth-child(2)]:order-1 [&>div:nth-child(2)]:mb-1',
].join(' ');

function SummaryTiles({ state }: { state: KeywordsSurfaceVisualState }) {
  if (state === 'loading') {
    return (
      <div className="grid grid-cols-2 gap-[10px] xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[80px] w-full" />)}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <InlineBanner tone="warning" title="Summary may be stale">
        Keyword summary data did not refresh, so the last loaded numbers are still shown.
      </InlineBanner>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-[10px] xl:grid-cols-4">
      <MetricTile label="Total keywords" value={state === 'empty' ? 0 : summary.counts.total} accent="var(--blue)" className={SUMMARY_TILE_CLASS} />
      <MetricTile label="Rank tracked" value={state === 'empty' ? 0 : summary.counts.tracked} accent="var(--blue)" className={SUMMARY_TILE_CLASS} />
      <MetricTile label="Needs review" value={state === 'empty' ? 0 : summary.counts.needsReview} accent="var(--amber)" className={SUMMARY_TILE_CLASS} />
      <MetricTile label="Monthly value" value={state === 'empty' ? 'No source' : '$1,234'} accent="var(--blue)" className={SUMMARY_TILE_CLASS} />
    </div>
  );
}

export function KeywordsSurfaceVisualFixture({
  state,
  theme,
}: {
  state: KeywordsSurfaceVisualState;
  theme: KeywordsSurfaceVisualTheme;
}) {
  if (state === 'locked') {
    return (
      <div className={`${theme === 'light' ? 'dashboard-light' : ''} min-h-screen bg-[var(--surface-1)] p-6 text-[var(--brand-text)]`}>
        <PageHeader title="Keywords" subtitle="Rankings, opportunities, pages, clusters, and lifecycle state in one rebuild pilot." />
        <div className="mt-5">
          <ErrorState
            type="permission"
            title="Keyword intelligence is locked"
            message="This workspace plan does not include keyword command-center access yet."
            className="min-h-[420px]"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`${theme === 'light' ? 'dashboard-light' : ''} min-h-screen bg-[var(--surface-1)] p-6 text-[var(--brand-text)]`}>
      <div className="mx-auto flex max-w-[1128px] flex-col">
        <PageHeader
          title="Keywords"
          subtitle="Rankings, opportunities, pages, clusters, and lifecycle for every tracked keyword."
          className="[&_h2]:!text-[23px] [&_h2]:!font-bold"
          actions={<Button size="sm" variant="primary">Add</Button>}
        />
        <div className="mt-[18px]"><SummaryTiles state={state} /></div>
        <div className="mt-4 w-fit max-w-full overflow-x-auto rounded-[var(--radius-lg)]">
          <LensSwitcher
            id="keywords-ct-lens"
            options={KEYWORDS_SURFACE_LENSES.map((lens) => ({ value: lens.id, label: lens.label, count: lens.id === 'clusters' ? 1 : 2 }))}
            value="rankings"
            onChange={() => {}}
            size="md"
          />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Toolbar label="Keyword search and advanced filters" className="w-full">
            <SearchField value="" onChange={() => {}} placeholder="Search keywords…" className="w-full max-w-[320px]" />
            <ToolbarSpacer />
            <span className="t-caption text-[var(--brand-text-muted)]">More filters</span>
          </Toolbar>
          <div className="flex flex-wrap gap-2" aria-label="Keyword filters">
            {KEYWORDS_SURFACE_FILTERS.map((filter) => (
              <FilterChip key={filter.id} label={filter.label} active={filter.id === 'all'} onClick={() => {}} />
            ))}
          </div>
        </div>
        <div className="mt-3">
          <DataTable
            columns={columns}
            rows={visualRowsFor(state)}
            loading={state === 'loading'}
            getRowKey={(record) => (record as VisualRow).source.normalizedKeyword}
            empty={(
              <div className="py-10 text-center">
                <p className="t-ui font-semibold text-[var(--brand-text-bright)]">No keywords yet</p>
                <p className="t-caption text-[var(--brand-text-muted)]">Connect Search Console data or run an initial strategy.</p>
              </div>
            )}
            className="[&>[role=row]]:!gap-2 [&>[role=row]]:!px-4 [&>[role=row]:first-child]:!h-[38px] [&>[role=row]:first-child]:!py-0 [&>[role=row]:not(:first-child)]:!min-h-14 [&>[role=row]:not(:first-child)]:!py-2"
          />
        </div>
        {state === 'error' && (
          <div className="mt-3">
            <InlineBanner tone="error" title="Could not load keywords">
              Stale rows remain visible while the retry runs.
            </InlineBanner>
          </div>
        )}
        <div className="mt-4">
          <GroupBlock
            title="Client keyword feedback"
            meta="Requested, declined, and approved keyword direction from the client portal."
            stats={[
              { label: 'Requested', value: 1, color: 'var(--teal)' },
              { label: 'Declined', value: 1, color: 'var(--red)' },
              { label: 'Approved', value: 0, color: 'var(--emerald)' },
            ]}
          >
            <div className="flex flex-wrap gap-2">
              <Badge label="Requested" tone="teal" variant="soft" />
              <span className="t-caption text-[var(--brand-text-bright)]">dental implants</span>
            </div>
          </GroupBlock>
        </div>
      </div>
    </div>
  );
}
