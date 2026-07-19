// @ds-rebuilt
import { useNavigate } from 'react-router-dom';
import type { CockpitPortfolioWorkspaceRow } from '../../../shared/types/cockpit-portfolio';
import type { CockpitVerdictStatus } from '../../../shared/types/cockpit';
import type { WorkQueueStream } from '../../../shared/types/work-queue';
import type { PresenceMap } from '../../api/presence';
import { useCockpitPortfolio, usePortfolioPresence } from '../../hooks/admin/useCockpitPortfolio';
import { adminPath } from '../../routes';
import { RebuiltTopbarActions } from '../layout/RebuiltAppChrome';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  MetricTile,
  PageHeader,
  SectionCard,
  Skeleton,
} from '../ui';
import type { BadgeTone } from '../ui/Badge';

const VERDICT_META: Record<CockpitVerdictStatus, { label: string; tone: BadgeTone }> = {
  at_risk: { label: 'At risk', tone: 'red' },
  watch: { label: 'Watch', tone: 'amber' },
  establishing: { label: 'Establishing', tone: 'blue' },
  on_track: { label: 'On track', tone: 'emerald' },
};

const STREAM_META: Record<WorkQueueStream, { label: string; tone: BadgeTone }> = {
  opt: { label: 'Optimizations', tone: 'blue' },
  send: { label: 'To send', tone: 'teal' },
  money: { label: 'Growth', tone: 'amber' },
  unclassified: { label: 'Needs triage', tone: 'zinc' },
};

const STREAM_ORDER: WorkQueueStream[] = ['opt', 'send', 'money', 'unclassified'];
const VERDICT_ORDER: CockpitVerdictStatus[] = ['at_risk', 'watch', 'establishing', 'on_track'];

function EmptyBookIcon({ className }: { className?: string }) {
  return <Icon name="layers" className={className} />;
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Refresh time unavailable';
  return `Ranked ${date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function PresenceIndicator({
  workspaceId,
  presence,
  loading,
  unavailable,
}: {
  workspaceId: string;
  presence: PresenceMap;
  loading: boolean;
  unavailable: boolean;
}) {
  if (loading) {
    return <span className="t-caption-sm text-[var(--brand-text-muted)]">Checking presence…</span>;
  }
  if (unavailable) {
    return <span className="t-caption-sm text-[var(--brand-text-muted)]">Presence unavailable</span>;
  }

  const users = presence[workspaceId] ?? [];
  if (users.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)]">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-[var(--radius-pill)] bg-[var(--brand-text-dim)]" />
        No one active
      </span>
    );
  }

  const names = users.map((user) => user.name || user.email.split('@')[0]).filter(Boolean);
  const label = users.length === 1 ? `${names[0]} active now` : `${users.length} people active now`;
  return (
    <span className="inline-flex items-center gap-1.5 t-caption-sm font-semibold text-[var(--emerald)]">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-[var(--radius-pill)] bg-[var(--emerald)] opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-[var(--radius-pill)] bg-[var(--emerald)]" />
      </span>
      {label}
    </span>
  );
}

function WorkspaceCard({
  row,
  presence,
  presenceLoading,
  presenceUnavailable,
}: {
  row: CockpitPortfolioWorkspaceRow;
  presence: PresenceMap;
  presenceLoading: boolean;
  presenceUnavailable: boolean;
}) {
  const navigate = useNavigate();
  const verdict = VERDICT_META[row.verdict.status];
  const preview = row.workQueue.items.slice(0, 3);

  return (
    <div data-testid="portfolio-workspace-card">
      <SectionCard
      title={row.workspaceName}
      titleIcon={(
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)] px-1.5 t-micro font-bold tabular-nums text-[var(--brand-text-bright)]">
          #{row.attention.rank}
        </span>
      )}
      titleExtra={<Badge label={verdict.label} tone={verdict.tone} variant="soft" shape="pill" />}
      subtitle={(
        <PresenceIndicator
          workspaceId={row.workspaceId}
          presence={presence}
          loading={presenceLoading}
          unavailable={presenceUnavailable}
        />
      )}
      action={(
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Open ${row.workspaceName} Cockpit`}
          onClick={() => navigate(adminPath(row.workspaceId))}
        >
          Open Cockpit
          <Icon name="arrowRight" size="xs" aria-hidden="true" />
        </Button>
      )}
      noPadding
      className={row.attention.needsAttention ? 'border-l-[3px] border-l-[var(--amber)]' : undefined}
    >
      <div className="flex flex-col">
        <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
          <div className="min-w-0">
            <h3 className="t-body font-semibold text-[var(--brand-text-bright)]">{row.verdict.headline}</h3>
            <p className="mt-1 t-body text-[var(--brand-text-muted)]">{row.verdict.narrative}</p>
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`${row.workspaceName} stream counts`}>
              {STREAM_ORDER.map((stream) => (
                <Badge
                  key={stream}
                  label={`${STREAM_META[stream].label} ${row.workQueue.streams[stream]}`}
                  tone={STREAM_META[stream].tone}
                  variant="soft"
                  shape="pill"
                  className="tabular-nums"
                />
              ))}
            </div>
          </div>
          <div className="min-w-0 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)]/40">
            <div className="flex items-center justify-between border-b border-[var(--brand-border)] px-3 py-2">
              <span className="t-label text-[var(--brand-text-muted)]">Attention preview</span>
              <span className="t-caption-sm tabular-nums text-[var(--brand-text-muted)]">{row.attention.totalItemCount} total</span>
            </div>
            {preview.length > 0 ? (
              <div className="divide-y divide-[var(--brand-border)]">
                {preview.map((item) => (
                  <div key={`${item.stream}:${item.id}`} className="flex items-start gap-2 px-3 py-2.5">
                    <Icon name={item.direction === 'negative' ? 'alert' : 'arrowRight'} size="sm" className={item.direction === 'negative' ? 'mt-0.5 text-[var(--red)]' : 'mt-0.5 text-[var(--blue)]'} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate t-ui font-semibold text-[var(--brand-text-bright)]">{item.title}</span>
                      <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{item.meta}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-3 py-4 t-caption-sm text-[var(--brand-text-muted)]">No queued work needs attention.</p>
            )}
          </div>
        </div>
      </div>
      </SectionCard>
    </div>
  );
}

export function CommandCenterSurface() {
  const navigate = useNavigate();
  const portfolioQuery = useCockpitPortfolio();
  const presenceQuery = usePortfolioPresence();
  const portfolio = portfolioQuery.data;

  if (portfolioQuery.isLoading && !portfolio) {
    return (
      <div data-testid="command-center-rebuilt-loading" className="flex flex-col gap-4" role="status" aria-label="Ranking workspace attention">
        <span className="sr-only">Ranking workspace attention…</span>
        <Skeleton className="h-[58px] w-full" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-[104px] w-full" />
          <Skeleton className="h-[104px] w-full" />
          <Skeleton className="h-[104px] w-full" />
        </div>
        <Skeleton className="h-[220px] w-full" />
        <Skeleton className="h-[220px] w-full" />
      </div>
    );
  }

  if (portfolioQuery.isError || !portfolio) {
    return (
      <ErrorState
        title="The client book did not load"
        message="We couldn't rank workspace attention right now. Your workspace data is safe — try the read again."
        action={{ label: 'Retry portfolio', onClick: () => { void portfolioQuery.refetch(); } }}
        type="data"
      />
    );
  }

  if (portfolio.workspaces.length === 0) {
    return (
      <div data-testid="command-center-rebuilt-surface">
        <PageHeader title="Command Center" subtitle="Your client book, ranked by attention" />
        <EmptyState
          icon={EmptyBookIcon}
          title="No workspaces in this book yet"
          description="Create or connect a workspace, then return here for portfolio triage."
          action={<Button variant="primary" onClick={() => navigate('/settings')}>Open settings</Button>}
          className="mt-5 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]"
        />
      </div>
    );
  }

  const totals = portfolio.totals;
  const moneyMetrics = [
    { label: 'Value at stake', metric: totals.valueAtStake },
    { label: 'Recovered so far', metric: totals.recoveredSoFar },
  ];
  return (
    <div data-testid="command-center-rebuilt-surface" className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
      <RebuiltTopbarActions fallback={<span className="self-end t-caption-sm text-[var(--brand-text-muted)]">{formatGeneratedAt(portfolio.generatedAt)}</span>}>
        <span className="t-caption-sm text-[var(--brand-text-muted)]">{formatGeneratedAt(portfolio.generatedAt)}</span>
      </RebuiltTopbarActions>

      <PageHeader
        title="Command Center"
        subtitle="Your client book, ranked by attention"
        icon={<Icon name="layers" size="lg" className="text-[var(--teal)]" aria-hidden="true" />}
      />

      <div className="grid gap-3 sm:grid-cols-3" aria-label="Book count totals">
        <div data-testid="portfolio-workspace-count"><MetricTile label="Workspaces" value={totals.workspaces.value} sub="Visible in this book" accent="var(--blue)" /></div>
        <div data-testid="portfolio-attention-count"><MetricTile label="Need attention" value={totals.attentionNeeded.value} sub="Server-ranked verdicts" accent={totals.attentionNeeded.value > 0 ? 'var(--amber)' : 'var(--emerald)'} /></div>
        <div data-testid="portfolio-queue-count"><MetricTile label="Queue items" value={totals.workQueue.value.itemCount} sub="Across every work stream" accent="var(--blue)" /></div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard title="Work streams" subtitle="Reconciled queue counts across the book" titleIcon={<Icon name="chart" size="sm" className="text-[var(--blue)]" />} iconChip>
          <div data-testid="portfolio-stream-totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STREAM_ORDER.map((stream) => (
              <div key={stream} className="rounded-[var(--radius-lg)] bg-[var(--surface-3)] px-3 py-2.5">
                <p className="t-caption-sm text-[var(--brand-text-muted)]">{STREAM_META[stream].label}</p>
                {/* stat-primitive-ok -- compact count matrix inside the owning SectionCard, not a standalone stat display. */}
                <p className="mt-1 t-stat-sm tabular-nums text-[var(--brand-text-bright)]">{totals.workQueue.value.streams[stream]}</p>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Verdicts" subtitle="Reconciled workspace status counts" titleIcon={<Icon name="gauge" size="sm" className="text-[var(--blue)]" />} iconChip>
          <div data-testid="portfolio-verdict-totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VERDICT_ORDER.map((status) => (
              <div key={status} className="rounded-[var(--radius-lg)] bg-[var(--surface-3)] px-3 py-2.5">
                <p className="t-caption-sm text-[var(--brand-text-muted)]">{VERDICT_META[status].label}</p>
                {/* stat-primitive-ok -- compact count matrix inside the owning SectionCard, not a standalone stat display. */}
                <p className="mt-1 t-stat-sm tabular-nums text-[var(--brand-text-bright)]">{totals.verdicts.value[status]}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Book money"
        subtitle="Portfolio aggregation remains bounded by attribution and measurement windows"
        titleIcon={<Icon name="info" size="sm" className="text-[var(--blue)]" />}
        iconChip
      >
        <div data-testid="portfolio-money-honesty" className="grid gap-3 md:grid-cols-2">
          {moneyMetrics.map(({ label, metric }) => (
            <div key={label} className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)]/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="t-ui font-semibold text-[var(--brand-text-bright)]">{label}</span>
                <Badge label="Not yet reconcilable" tone="zinc" variant="outline" shape="pill" />
              </div>
              <p className="mt-2 t-caption-sm text-[var(--brand-text-muted)]">{metric.reason}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <section aria-labelledby="portfolio-workspaces-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="portfolio-workspaces-heading" className="t-h2 text-[var(--brand-text-bright)]">Attention order</h2>
            <p className="mt-0.5 t-caption-sm text-[var(--brand-text-muted)]">Server-ranked. Highest attention stays first.</p>
          </div>
          <Badge label={`${portfolio.workspaces.length} workspaces`} tone="blue" variant="soft" shape="pill" />
        </div>
        {portfolio.workspaces.map((row) => (
          <WorkspaceCard
            key={row.workspaceId}
            row={row}
            presence={presenceQuery.data ?? {}}
            presenceLoading={presenceQuery.isLoading}
            presenceUnavailable={presenceQuery.isError}
          />
        ))}
      </section>
    </div>
  );
}
