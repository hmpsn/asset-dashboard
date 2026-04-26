import { TrendingUp, FileText, Zap } from 'lucide-react';
import { useClientIntelligence } from '../../hooks/client/useClientIntelligence.js';
import { SectionCard } from '../ui/SectionCard.js';
import { TierGate, type Tier } from '../ui/TierGate.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Icon } from '../ui/Icon.js';

interface Props {
  workspaceId: string;
  /** Tier sourced from workspace data — not the intelligence response, which may fall back to 'free' on error */
  tier: Tier;
}

export function IntelligenceSummaryCard({ workspaceId, tier }: Props) {
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

  return (
    <SectionCard title="Site Intelligence">
      <div className="grid grid-cols-2 gap-4">
        {/* High-priority insights — all tiers */}
        <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-blue-500/5 border border-blue-500/20">
          <Icon as={Zap} size="md" className="text-blue-400 shrink-0" />
          <div>
            <div className="text-lg font-semibold text-[var(--brand-text-bright)]">
              {intel.insightsSummary?.highPriority ?? 0}
            </div>
            <div className="t-caption-sm text-[var(--brand-text-muted)]">High-priority insights</div>
          </div>
        </div>

        {/* Briefs in progress — all tiers */}
        <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-blue-500/5 border border-blue-500/20">
          <Icon as={FileText} size="md" className="text-blue-400 shrink-0" />
          <div>
            <div className="text-lg font-semibold text-[var(--brand-text-bright)]">
              {intel.pipelineStatus?.briefs.inProgress ?? 0}
            </div>
            <div className="t-caption-sm text-[var(--brand-text-muted)]">Briefs in progress</div>
          </div>
        </div>

        {/* Win rate — Growth+ only */}
        <TierGate
          tier={tier}
          required="growth"
          feature="intelligence-win-rate"
        >
          <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-blue-500/5 border border-blue-500/20 col-span-2">
            <Icon as={TrendingUp} size="md" className="text-blue-400 shrink-0" />
            <div>
              <div className="text-lg font-semibold text-[var(--brand-text-bright)]">
                {intel.learningHighlights
                  ? `${Math.round(intel.learningHighlights.overallWinRate * 100)}%`
                  : '—'}
              </div>
              <div className="t-caption-sm text-[var(--brand-text-muted)]">
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
