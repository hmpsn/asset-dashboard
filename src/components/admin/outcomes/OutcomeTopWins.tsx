import { Trophy } from 'lucide-react';
import { SectionCard, EmptyState, Badge, Skeleton } from '../../ui';
import { useOutcomeTopWins } from '../../../hooks/admin/useOutcomes';
import { formatOutcomeDate } from './outcomeConstants';
import type { TopWin } from '../../../../shared/types/outcome-tracking';

interface Props {
  workspaceId: string;
}

function winLabel(win: TopWin): string {
  if (win.targetKeyword) return `"${win.targetKeyword}"`;
  if (win.pageUrl) {
    try {
      const u = new URL(win.pageUrl);
      const path = u.pathname.length > 32 ? u.pathname.slice(0, 32) + '…' : u.pathname;
      return u.hostname + path;
    } catch {
      return win.pageUrl;
    }
  }
  return 'Untitled action';
}

export default function OutcomeTopWins({ workspaceId }: Props) {
  const { data: wins, isLoading } = useOutcomeTopWins(workspaceId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!wins || wins.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="No wins recorded yet"
        description="Top wins will appear here as outcomes are measured over the coming weeks."
      />
    );
  }

  return (
    <SectionCard
      title={`Top ${wins.length} Win${wins.length !== 1 ? 's' : ''}`}
      titleIcon={<Trophy className="w-4 h-4 text-amber-400" />}
    >
      <div className="space-y-3">
        {wins.map((win) => (
          <div key={win.actionId} className="flex items-start gap-3 py-2 border-b border-zinc-800/60 last:border-0">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-200 truncate">
                {winLabel(win)}
              </p>
              <p className="text-[11px] text-blue-400 mt-0.5">
                {win.delta.delta_percent >= 0 ? '+' : ''}{win.delta.delta_percent.toFixed(1)}% {win.delta.primary_metric}
              </p>
              <p className="text-[11px] text-zinc-600 mt-0.5">{formatOutcomeDate(win.createdAt)}</p>
            </div>
            <Badge
              label={win.score === 'strong_win' ? 'Strong Win' : 'Win'}
              color={win.score === 'strong_win' ? 'green' : 'blue'}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
