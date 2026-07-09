// @ds-rebuilt
import OutcomeDashboard from '../admin/outcomes/OutcomeDashboard';
import { EmptyState, Icon, PageContainer, PageHeader, SectionCard } from '../ui';

interface OutcomeWorkspaceLensProps {
  workspaceId?: string;
}

export function OutcomeWorkspaceLens({ workspaceId }: OutcomeWorkspaceLensProps) {
  if (!workspaceId) {
    return (
      <PageContainer width="wide" className="min-h-full">
        <EmptyState
          icon={({ className }) => <Icon name="trophy" className={className} />}
          title="Choose a workspace"
          description="Choose a workspace to load wins, scorecards, playbooks, learnings, and coverage."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide" className="min-h-full" gap={false}>
      <div data-testid="outcome-workspace-rebuilt" className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader title="Outcome Dashboard" subtitle="Top wins, scorecard, playbooks, actions, learnings, and coverage diagnostics." />
        <SectionCard title="Workspace outcomes" noPadding>
          <div className="p-4">
            <OutcomeDashboard workspaceId={workspaceId} />
          </div>
        </SectionCard>
      </div>
    </PageContainer>
  );
}
