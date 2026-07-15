// @ds-rebuilt
import OutcomeDashboard from '../admin/outcomes/OutcomeDashboard';
import { EmptyState, Icon } from '../ui';
import { OutcomeWorkspaceFrame } from './wave-c/outcomes/OutcomeWorkspaceFrame';

interface OutcomeWorkspaceLensProps {
  workspaceId?: string;
}

export function OutcomeWorkspaceLens({ workspaceId }: OutcomeWorkspaceLensProps) {
  if (!workspaceId) {
    return (
      <div className="mx-auto min-h-full w-full max-w-[860px] px-4 pb-[90px] pt-2 sm:px-[30px]">
        <EmptyState
          icon={({ className }) => <Icon name="trophy" className={className} />}
          title="Choose a workspace"
          description="Choose a workspace to load wins, scorecards, playbooks, learnings, and coverage."
        />
      </div>
    );
  }

  return (
    <div
      data-testid="outcome-workspace-rebuilt"
      data-workspace-id={workspaceId}
      className="mx-auto min-h-full w-full max-w-[1080px] px-4 pb-[90px] pt-2 sm:px-[30px]"
    >
      <header className="mb-[18px]">
        <div className="mb-2 flex items-center gap-2 t-mono font-semibold uppercase tracking-[0.09em] text-[var(--emerald)]">
          <span className="h-[7px] w-[7px] rounded-[var(--radius-pill)] bg-[var(--emerald)]" aria-hidden="true" />
          Workspace action results
        </div>
        <h1 className="t-h2 !font-bold text-[var(--brand-text-bright)]">Outcome Dashboard</h1>
        <p className="mt-1 max-w-[74ch] t-body text-[var(--brand-text-muted)]">
          Record shipped work, inspect graduated wins, and review the scorecard, playbooks, actions, learnings, and coverage behind them.
        </p>
      </header>

      <OutcomeWorkspaceFrame>
        <OutcomeDashboard workspaceId={workspaceId} />
      </OutcomeWorkspaceFrame>
    </div>
  );
}
