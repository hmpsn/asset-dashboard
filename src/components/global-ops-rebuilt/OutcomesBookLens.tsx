// @ds-rebuilt
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOutcomeOverview, useOutcomePortfolioRollup } from '../../hooks/admin/useOutcomes';
import { useWorkspaceOverviewData } from '../../hooks/admin/useWorkspaceOverview';
import { adminPath } from '../../routes';
import { InlineBanner, MetricTile, Skeleton } from '../ui';
import { OutcomeRecentWins } from './wave-c/outcomes/OutcomeRecentWins';
import { OutcomesBookTable, type OutcomeBookEntry } from './wave-c/outcomes/OutcomesBookTable';
import { formatMoney, formatNumber } from './globalOpsFormatters';

export function OutcomesBookLens() {
  const navigate = useNavigate();
  const overview = useWorkspaceOverviewData();
  const outcomeOverview = useOutcomeOverview();
  const portfolioRollup = useOutcomePortfolioRollup();
  const workspaces = overview.data?.workspaces ?? [];

  const outcomeByWorkspace = useMemo(() => {
    const map = new Map((outcomeOverview.data ?? []).map((item) => [item.workspaceId, item]));
    return map;
  }, [outcomeOverview.data]);

  const portfolioByWorkspace = useMemo(() => {
    return new Map((portfolioRollup.data?.workspaces ?? []).map((item) => [item.workspaceId, item]));
  }, [portfolioRollup.data]);

  const entries = useMemo<OutcomeBookEntry[]>(() => {
    return workspaces
      .map((workspace) => ({
        workspace,
        outcome: outcomeByWorkspace.get(workspace.id),
        portfolio: portfolioByWorkspace.get(workspace.id),
      }))
      .sort((left, right) => {
        const valueDelta = (right.portfolio?.totals.valuePerMonth ?? 0) - (left.portfolio?.totals.valuePerMonth ?? 0);
        if (valueDelta !== 0) return valueDelta;
        return left.workspace.name.localeCompare(right.workspace.name);
      });
  }, [outcomeByWorkspace, portfolioByWorkspace, workspaces]);

  const portfolio = portfolioRollup.data;

  const openWorkspace = (workspaceId: string) => navigate(adminPath(workspaceId, 'outcomes'));

  return (
    <div
      data-testid="outcomes-book-rebuilt"
      className="mx-auto min-h-full w-full max-w-[1080px] px-4 pb-[90px] pt-2 sm:px-[30px]"
    >
      <header className="mb-[22px]">
        <div className="mb-3 flex items-center gap-2 t-mono font-semibold uppercase tracking-[0.09em] text-[var(--emerald)]">
          <span className="h-[7px] w-[7px] rounded-[var(--radius-pill)] bg-[var(--emerald)]" aria-hidden="true" />
          <span>Action results · across your book</span>
          <span className="ml-auto hidden normal-case tracking-normal text-[var(--brand-text-dim)] sm:inline">
            {portfolio?.window.label ?? 'Outcome window unavailable'}
          </span>
        </div>
        <h1 className="t-h1 !font-bold text-[var(--brand-text-bright)]">What the work has delivered.</h1>
        <p className="mt-2 max-w-[74ch] t-body leading-relaxed text-[var(--brand-text-muted)]">
          Every proof point across your whole book, rolled up so you can see <strong className="font-semibold text-[var(--brand-text-bright)]">where value is landing</strong> and which workspace is due for attention without opening every dashboard. Each win still lives in its workspace outcome tools and client portal.
        </p>
      </header>

      {(overview.isError || outcomeOverview.isError || portfolioRollup.isError) && (
        <InlineBanner
          tone="warning"
          className="mb-4"
          title="Some outcome evidence may be stale"
          message="The latest available workspace results are still shown below."
        />
      )}

      {portfolioRollup.isLoading ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3" aria-label="Loading portfolio outcome totals">
          {[0, 1, 2].map(index => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
      ) : portfolio && portfolio.totals.wins > 0 ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <MetricTile
            label="Measured value / mo"
            value={formatMoney(portfolio.totals.valuePerMonth)}
            sub={`${portfolio.totals.withValue} wins carry attributed value`}
            accent="var(--blue)"
          />
          <MetricTile
            label="Clicks gained"
            value={formatNumber(portfolio.totals.clicksGained)}
            sub={portfolio.window.label}
            accent="var(--blue)"
          />
          <MetricTile
            label="Measured wins"
            value={formatNumber(portfolio.totals.wins)}
            sub={`${portfolio.attribution.platformExecuted.wins} agency-executed · ${portfolio.attribution.externallyExecuted.wins} client-side`}
            accent="var(--emerald)"
          />
        </div>
      ) : portfolio ? (
        <InlineBanner
          tone="info"
          className="mb-4"
          title="No measured wins in this window"
          message={`${portfolio.window.label} has no win-scored outcomes yet. Totals stay blank until measured proof lands.`}
        />
      ) : null}

      <div className="flex flex-col gap-4">
        <OutcomesBookTable
          entries={entries}
          loading={overview.isLoading || outcomeOverview.isLoading || portfolioRollup.isLoading}
          windowLabel={portfolio?.window.label ?? null}
          onOpenWorkspace={openWorkspace}
        />
        <OutcomeRecentWins workspaces={outcomeOverview.data ?? []} loading={outcomeOverview.isLoading} onOpenWorkspace={openWorkspace} />
        <InlineBanner tone="success" title="The Prove lens at book scale">
          A result lands here only after tracked work becomes a measurable outcome worth sharing. Work in flight stays in the Command Center; proof lives here and in each workspace.
        </InlineBanner>
      </div>
    </div>
  );
}
