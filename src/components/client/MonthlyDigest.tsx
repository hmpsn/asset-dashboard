// CLIENT-FACING
import { useMonthlyDigest } from '../../hooks/client/useMonthlyDigest.js';
import { SectionCard } from '../ui/SectionCard.js';
import { Skeleton } from '../ui/Skeleton.js';
import { TierGate } from '../ui/TierGate.js';
import { Calendar, TrendingUp, CheckCircle, Award } from 'lucide-react';
import type { Tier } from '../ui/TierGate.js';
import type { ROIHighlight, DigestItem } from '../../../shared/types/narrative.js';

interface Props {
  workspaceId: string;
  tier: Tier;
}

export function MonthlyDigest({ workspaceId, tier }: Props) {
  const { data: digest, isLoading } = useMonthlyDigest(workspaceId);

  if (isLoading) {
    return (
      <SectionCard title="Monthly Performance" titleIcon={<Calendar className="w-4 h-4 text-zinc-400" />}>
        <div className="space-y-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-20" />
        </div>
      </SectionCard>
    );
  }

  if (!digest?.month) return null;

  return (
    <TierGate tier={tier} required="growth" feature="Monthly Performance Digest" teaser="See a monthly summary of your SEO wins, issues addressed, and ROI highlights">
      <SectionCard title={`${digest.month} Performance`} titleIcon={<Calendar className="w-4 h-4 text-zinc-400" />}>
        <div className="space-y-6">
          {/* AI summary */}
          {digest.summary && (
            <p className="text-sm text-zinc-300 leading-relaxed">{digest.summary}</p>
          )}

          {/* Metrics row */}
          {digest.metrics.pagesOptimized > 0 && (
            <div className="flex gap-3 text-xs text-zinc-500">
              <span className="text-teal-400 font-medium">{digest.metrics.pagesOptimized} page{digest.metrics.pagesOptimized === 1 ? '' : 's'} optimized</span>
            </div>
          )}

          {/* Wins */}
          {digest.wins.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-zinc-400 tracking-wider mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3 text-emerald-400" />
                Wins this month
              </h4>
              <ul className="space-y-1.5">
                {digest.wins.map((win: DigestItem, i: number) => (
                  <li key={win.insightId ?? i} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-zinc-300 font-medium">{win.title}</span>
                      <span className="text-zinc-500 ml-1">— {win.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Issues addressed */}
          {digest.issuesAddressed.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-zinc-400 tracking-wider mb-2">
                Issues addressed
              </h4>
              <ul className="space-y-1.5">
                {digest.issuesAddressed.map((issue: DigestItem, i: number) => (
                  <li key={issue.insightId ?? i} className="text-sm text-zinc-400">
                    <span className="text-zinc-300">{issue.title}</span>
                    <span className="ml-1">— {issue.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ROI highlights */}
          {digest.roiHighlights.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-zinc-400 tracking-wider mb-2 flex items-center gap-1.5">
                <Award className="w-3 h-3 text-blue-400" />
                Measurable results
              </h4>
              <ul className="space-y-2">
                {digest.roiHighlights.map((roi: ROIHighlight, i: number) => (
                  <li key={i} className="p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
                    <div className="text-sm font-medium text-zinc-200">{roi.pageTitle}</div>
                    <div className="text-xs text-zinc-400 mt-0.5">{roi.action} — {roi.result}</div>
                    {roi.clicksGained > 0 && (
                      <div className="text-xs text-blue-400 mt-0.5">+{roi.clicksGained.toLocaleString()} clicks</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SectionCard>
    </TierGate>
  );
}
