import { TrendingUp, FileText, Zap } from 'lucide-react';
import { useClientIntelligence } from '../../hooks/client/useClientIntelligence.js';
import { SectionCard } from '../ui/SectionCard.js';
import { TierGate } from '../ui/TierGate.js';
import { Skeleton } from '../ui/Skeleton.js';

interface Props {
  workspaceId: string;
}

export function IntelligenceSummaryCard({ workspaceId }: Props) {
  const { data: intel, isLoading } = useClientIntelligence(workspaceId);

  if (isLoading) {
    return (
      <SectionCard title="Site Intelligence">
        <div className="space-y-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-48" />
        </div>
      </SectionCard>
    );
  }

  if (!intel) return null;

  const currentTier = intel.tier ?? 'free';

  return (
    <SectionCard title="Site Intelligence">
      <div className="grid grid-cols-2 gap-4">
        {/* High-priority insights — all tiers */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
          <Zap className="w-4 h-4 text-blue-400 shrink-0" />
          <div>
            <div className="text-lg font-semibold text-zinc-200">
              {intel.insightsSummary?.highPriority ?? 0}
            </div>
            <div className="text-[11px] text-zinc-500">High-priority insights</div>
          </div>
        </div>

        {/* Briefs in progress — all tiers */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
          <FileText className="w-4 h-4 text-blue-400 shrink-0" />
          <div>
            <div className="text-lg font-semibold text-zinc-200">
              {intel.pipelineStatus?.briefs.inProgress ?? 0}
            </div>
            <div className="text-[11px] text-zinc-500">Briefs in progress</div>
          </div>
        </div>

        {/* Win rate — Growth+ only */}
        <TierGate
          tier={currentTier}
          required="growth"
          feature="intelligence-win-rate"
        >
          <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 col-span-2">
            <TrendingUp className="w-4 h-4 text-blue-400 shrink-0" />
            <div>
              <div className="text-lg font-semibold text-zinc-200">
                {intel.learningHighlights
                  ? `${Math.round(intel.learningHighlights.overallWinRate * 100)}%`
                  : '—'}
              </div>
              <div className="text-[11px] text-zinc-500">
                Action win rate
                {intel.learningHighlights?.recentWins
                  ? ` · ${intel.learningHighlights.recentWins} recent wins`
                  : ''}
              </div>
            </div>
          </div>
        </TierGate>
      </div>
    </SectionCard>
  );
}
