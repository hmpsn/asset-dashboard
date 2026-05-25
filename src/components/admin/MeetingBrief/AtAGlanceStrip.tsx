import { StatCard } from '../../ui/StatCard';
import type { Page } from '../../../routes';
import type { MeetingBriefMetrics } from '../../../../shared/types/meeting-brief.js';

interface Props {
  metrics: MeetingBriefMetrics;
  onOpenTab: (tab: Page) => void;
}

export function AtAGlanceStrip({ metrics, onOpenTab }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
      <StatCard
        label="Site Health"
        value={metrics.siteHealthScore != null ? `${metrics.siteHealthScore}/100` : '—'}
        valueColor="text-accent-info"
        onClick={() => onOpenTab('seo-audit')}
      />
      <StatCard
        label="Ranking Opps"
        value={metrics.openRankingOpportunities}
        valueColor="text-accent-info"
        onClick={() => onOpenTab('seo-strategy')}
      />
      <StatCard
        label="In Pipeline"
        value={metrics.contentInPipeline}
        sub="pieces"
        valueColor="text-accent-info"
        onClick={() => onOpenTab('content-pipeline')}
      />
      <StatCard
        label="Win Rate"
        value={metrics.overallWinRate != null ? `${metrics.overallWinRate}%` : '—'}
        valueColor="text-accent-info"
        onClick={() => onOpenTab('outcomes')}
      />
      <StatCard
        label="Critical Issues"
        value={metrics.criticalIssues}
        valueColor="text-accent-info"
        onClick={() => onOpenTab('seo-audit')}
      />
    </div>
  );
}
