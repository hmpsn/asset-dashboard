import { useClientInsights } from '../../hooks/client/useClientInsights.js';
import { SectionCard } from '../ui/SectionCard.js';
import { EmptyState } from '../ui/EmptyState.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Lightbulb, TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from 'lucide-react';
import type { ClientInsight } from '../../../shared/types/narrative.js';
import type { InsightSeverity } from '../../../shared/types/analytics.js';

interface Props {
  workspaceId: string;
}

const severityConfig: Record<InsightSeverity, { icon: React.ComponentType<{ className?: string }>, color: string, bg: string }> = {
  critical: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
  warning: { icon: TrendingDown, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  opportunity: { icon: TrendingUp, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  positive: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
};

export function InsightNarrative({ workspaceId }: Props) {
  const { data, isLoading } = useClientInsights(workspaceId);
  const insights: ClientInsight[] = data?.insights ?? [];

  if (isLoading) {
    return (
      <SectionCard title="Performance Insights" titleIcon={<Lightbulb className="w-4 h-4 text-zinc-400" />}>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      </SectionCard>
    );
  }

  if (!insights.length) {
    return (
      <SectionCard title="Performance Insights" titleIcon={<Lightbulb className="w-4 h-4 text-zinc-400" />}>
        <EmptyState
          icon={Lightbulb}
          title="No insights yet"
          description="Insights will appear once we have enough data to analyze your site's performance"
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Performance Insights" titleIcon={<Lightbulb className="w-4 h-4 text-zinc-400" />}>
      <div className="space-y-3">
        {insights.slice(0, 8).map(insight => {
          const config = severityConfig[insight.severity] ?? severityConfig.opportunity;
          const Icon = config.icon;
          return (
            <div key={insight.id} className={`p-4 rounded-lg ${config.bg}`}>
              <div className="flex items-start gap-3">
                <Icon className={`w-5 h-5 mt-0.5 ${config.color} shrink-0`} />
                <div>
                  <h4 className="text-sm font-medium text-zinc-200">{insight.headline}</h4>
                  <p className="text-sm text-zinc-400 mt-1">{insight.narrative}</p>
                  {insight.impact && (
                    <p className="text-xs text-zinc-500 mt-1">{insight.impact}</p>
                  )}
                  {insight.actionTaken && (
                    <p className="text-xs text-teal-400 mt-1 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      {insight.actionTaken}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
