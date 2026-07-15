// @ds-rebuilt
import type { WorkspaceOutcomeOverview } from '../../../../../shared/types/outcome-tracking';
import { ACTION_TYPE_LABELS, formatOutcomeDate } from '../../../admin/outcomes/outcomeConstants';
import { ClickableRow, EmptyState, Icon, SectionCard, Skeleton } from '../../../ui';
import type { IconName } from '../../../ui';
import { formatMoney } from '../../globalOpsFormatters';

interface OutcomeRecentWinsProps {
  workspaces: WorkspaceOutcomeOverview[];
  loading?: boolean;
  onOpenWorkspace: (workspaceId: string) => void;
}

function TrophyIcon({ className }: { className?: string }) {
  return <Icon name="trophy" className={className} />;
}

function winTitle(win: NonNullable<WorkspaceOutcomeOverview['topWin']>): string {
  const sourceLabel = win.sourceLabel?.trim();
  if (sourceLabel) return sourceLabel;
  if (win.targetKeyword) return `“${win.targetKeyword}”`;
  if (win.pageUrl) {
    try {
      const url = new URL(win.pageUrl);
      return url.pathname === '/' ? url.hostname : url.pathname;
    } catch {
      return win.pageUrl;
    }
  }
  return ACTION_TYPE_LABELS[win.actionType];
}

function winIcon(actionType: NonNullable<WorkspaceOutcomeOverview['topWin']>['actionType']): { name: IconName; className: string } {
  if (actionType === 'content_published' || actionType === 'content_refreshed' || actionType === 'brief_created') {
    return { name: 'clipboard', className: 'bg-[var(--surface-3)] text-[var(--blue)]' };
  }
  if (actionType === 'local_visibility_won' || actionType === 'local_service_added' || actionType === 'gbp_review_reply') {
    return { name: 'pin', className: 'bg-[var(--surface-3)] text-[var(--emerald)]' };
  }
  return { name: 'zap', className: 'bg-[var(--surface-3)] text-[var(--amber)]' };
}

export function OutcomeRecentWins({ workspaces, loading = false, onOpenWorkspace }: OutcomeRecentWinsProps) {
  const recentWins = workspaces
    .filter((workspace) => workspace.topWin?.attribution !== 'not_acted_on')
    .filter((workspace): workspace is WorkspaceOutcomeOverview & { topWin: NonNullable<WorkspaceOutcomeOverview['topWin']> } => Boolean(workspace.topWin))
    .sort((left, right) => Date.parse(right.topWin.scoredAt) - Date.parse(left.topWin.scoredAt))
    .slice(0, 6);

  return (
    <SectionCard
      title="Recent wins"
      subtitle="The latest scored proof point available for each workspace"
      titleIcon={<Icon name="star" size="md" className="text-[var(--emerald)]" aria-hidden="true" />}
      iconChip
      noPadding
    >
      {loading ? (
        <div className="space-y-0" aria-label="Loading recent wins">
          {[0, 1, 2].map((index) => (
            <div key={index} className="grid grid-cols-[32px_minmax(0,1fr)_74px] items-center gap-[13px] border-t border-[var(--brand-border)] px-[18px] py-[13px] first:border-t-0">
              <Skeleton className="h-8 w-8" />
              <div className="space-y-1.5"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
              <Skeleton className="h-6 w-full" />
            </div>
          ))}
        </div>
      ) : recentWins.length === 0 ? (
        <EmptyState
          icon={TrophyIcon}
          title="No graduated wins yet"
          description="Wins appear after a tracked action reaches a scored measurement checkpoint."
          className="!py-10"
        />
      ) : recentWins.map(({ workspaceId, workspaceName, topWin }) => {
        const icon = winIcon(topWin.actionType);
        const hasAttributedValue = typeof topWin.attributedValue === 'number' && topWin.attributedValue > 0;
        const delta = topWin.delta.delta_percent;
        const result = hasAttributedValue
          ? formatMoney(topWin.attributedValue)
          : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
        const resultLabel = hasAttributedValue ? 'attributed value' : topWin.delta.primary_metric;
        const attributionLabel = topWin.attribution === 'externally_executed'
          ? 'Client-side · measured result'
          : 'Platform-executed';

        return (
          <ClickableRow
            key={`${workspaceId}-${topWin.actionId}`}
            onClick={() => onOpenWorkspace(workspaceId)}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[13px] border-t border-[var(--brand-border)] px-[18px] py-[13px] first:border-t-0"
            aria-label={`Open ${workspaceName} outcomes: ${winTitle(topWin)}`}
          >
            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] ${icon.className}`}>
              <Icon name={icon.name} size="md" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate t-body font-semibold text-[var(--brand-text-bright)]">{winTitle(topWin)}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)]">
                <span className="font-medium text-[var(--brand-text-muted)]">{workspaceName}</span>
                <span aria-hidden="true">·</span>
                <span>{ACTION_TYPE_LABELS[topWin.actionType]}</span>
                <span aria-hidden="true">·</span>
                <span>{attributionLabel}</span>
                <span aria-hidden="true">·</span>
                <span>{formatOutcomeDate(topWin.scoredAt)}</span>
              </span>
            </span>
            <span className="text-right">
              <span className="block t-body tabular-nums font-bold text-[var(--emerald)]">{result}</span>
              <span className="mt-0.5 block t-caption-sm text-[var(--brand-text-muted)]">{resultLabel}</span>
            </span>
          </ClickableRow>
        );
      })}
    </SectionCard>
  );
}
