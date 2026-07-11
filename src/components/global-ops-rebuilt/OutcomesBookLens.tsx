// @ds-rebuilt
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOutcomeOverview } from '../../hooks/admin/useOutcomes';
import { useWorkspaceOverviewData } from '../../hooks/admin/useWorkspaceOverview';
import { adminPath } from '../../routes';
import { InlineBanner } from '../ui';
import { OutcomeRecentWins } from './wave-c/outcomes/OutcomeRecentWins';
import { OutcomesBookTable, type OutcomeBookEntry } from './wave-c/outcomes/OutcomesBookTable';

export function OutcomesBookLens() {
  const navigate = useNavigate();
  const overview = useWorkspaceOverviewData();
  const outcomeOverview = useOutcomeOverview();
  const workspaces = overview.data?.workspaces ?? [];

  const outcomeByWorkspace = useMemo(() => {
    const map = new Map((outcomeOverview.data ?? []).map((item) => [item.workspaceId, item]));
    return map;
  }, [outcomeOverview.data]);

  const entries = useMemo<OutcomeBookEntry[]>(() => {
    return workspaces
      .map((workspace) => ({ workspace, outcome: outcomeByWorkspace.get(workspace.id) }))
      .sort((left, right) => {
        const valueDelta = (right.workspace.outcomeValue?.valuePerMonth ?? 0) - (left.workspace.outcomeValue?.valuePerMonth ?? 0);
        if (valueDelta !== 0) return valueDelta;
        return left.workspace.name.localeCompare(right.workspace.name);
      });
  }, [outcomeByWorkspace, workspaces]);

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
          <span className="ml-auto hidden normal-case tracking-normal text-[var(--brand-text-dim)] sm:inline">Rolling 90 days</span>
        </div>
        <h1 className="t-h1 !font-bold text-[var(--brand-text-bright)]">What your work has delivered.</h1>
        <p className="mt-2 max-w-[74ch] t-body leading-relaxed text-[var(--brand-text-muted)]">
          Every proof point across your whole book, rolled up so you can see <strong className="font-semibold text-[var(--brand-text-bright)]">where value is landing</strong> and which workspace is due for attention without opening every dashboard. Each win still lives in its workspace outcome tools and client portal.
        </p>
      </header>

      {(overview.isError || outcomeOverview.isError) && (
        <InlineBanner
          tone="warning"
          className="mb-4"
          title="Some outcome evidence may be stale"
          message="The latest available workspace results are still shown below."
        />
      )}

      <InlineBanner
        tone="info"
        className="mb-4"
        title="Book totals are not yet available"
        message="Workspace results remain comparable below. A book-wide total will appear when it can be reconciled with the same attribution rules."
      />

      <div className="flex flex-col gap-4">
        <OutcomesBookTable
          entries={entries}
          loading={overview.isLoading || outcomeOverview.isLoading}
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
