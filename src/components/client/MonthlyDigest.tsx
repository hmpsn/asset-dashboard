// CLIENT-FACING
import { useMonthlyDigest } from '../../hooks/client/useMonthlyDigest.js';
import { SectionCard } from '../ui/SectionCard.js';
import { Skeleton } from '../ui/Skeleton.js';
import { TierGate } from '../ui/TierGate.js';
import { Icon } from '../ui/Icon.js';
import { Award, ArrowUpRight, Calendar, CheckCircle } from 'lucide-react';
import type { Tier } from '../ui/TierGate.js';
import type { MonthlyDigestData, ROIHighlight, DigestItem } from '../../../shared/types/narrative.js';

interface Props {
  workspaceId: string;
  tier: Tier;
}

export function MonthlyDigest({ workspaceId, tier }: Props) {
  const { data: digest, isLoading } = useMonthlyDigest(workspaceId);

  if (isLoading) {
    return (
      <SectionCard title="Monthly Performance" titleIcon={<Icon as={Calendar} size="md" className="text-[var(--brand-text)]" />}>
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
      <MonthlyDigestContent digest={digest} />
    </TierGate>
  );
}

/**
 * Presentational subcomponent — renders an already-fetched digest.
 * Extracted so the Free-tier branch of `<InsightsBriefingPage>` (Phase 2 of
 * client-briefing-v2) can render the digest body un-gated as a tease of the
 * editorial voice. The original `<MonthlyDigest>` keeps the TierGate so any
 * non-briefing caller behaves identically to before the split.
 */
export function MonthlyDigestContent({ digest }: { digest: MonthlyDigestData }) {
  return (
    <SectionCard title={`${digest.month} Performance`} titleIcon={<Icon as={Calendar} size="md" className="text-[var(--brand-text)]" />}>
      <div className="space-y-6">
        {/* AI summary */}
        {digest.summary && (
          <p className="t-body text-[var(--brand-text-bright)] leading-relaxed">{digest.summary}</p>
        )}

        {/* Metrics row */}
        {digest.metrics.pagesOptimized > 0 && (
          <div className="flex gap-3 t-caption text-[var(--brand-text-muted)]">
            <span className="text-accent-brand font-medium">{digest.metrics.pagesOptimized} page{digest.metrics.pagesOptimized === 1 ? '' : 's'} optimized</span>
          </div>
        )}

        {/* Wins */}
        {digest.wins.length > 0 && (
          <div>
            <h4 className="t-label text-[var(--brand-text-bright)] mb-2 flex items-center gap-1.5">
              <Icon as={ArrowUpRight} size="sm" className="text-accent-success" />
              Wins this month
            </h4>
            <ul className="space-y-1.5">
              {digest.wins.map((win: DigestItem, i: number) => (
                <li key={win.insightId ?? i} className="flex items-start gap-2 t-body">
                  <Icon as={CheckCircle} size="md" className="text-accent-success mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[var(--brand-text-bright)] font-medium">{win.title}</span>
                    <span className="text-[var(--brand-text-muted)] ml-1">— {win.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Issues addressed */}
        {digest.issuesAddressed.length > 0 && (
          <div>
            <h4 className="t-label text-[var(--brand-text-bright)] mb-2">
              Issues addressed
            </h4>
            <ul className="space-y-1.5">
              {digest.issuesAddressed.map((issue: DigestItem, i: number) => (
                <li key={issue.insightId ?? i} className="t-body text-[var(--brand-text)]">
                  <span className="text-[var(--brand-text-bright)]">{issue.title}</span>
                  <span className="ml-1">— {issue.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ROI highlights */}
        {digest.roiHighlights.length > 0 && (
          <div>
            <h4 className="t-label text-[var(--brand-text-bright)] mb-2 flex items-center gap-1.5">
              <Icon as={Award} size="sm" className="text-accent-info" />
              Measurable results
            </h4>
            <ul className="space-y-2">
              {digest.roiHighlights.map((roi: ROIHighlight, i: number) => (
                <li key={i} className="p-2.5 rounded-[var(--radius-md)] bg-blue-500/5 border border-blue-500/10">
                  <div className="t-body font-medium text-[var(--brand-text-bright)]">{roi.pageTitle}</div>
                  <div className="t-caption text-[var(--brand-text)] mt-0.5">{roi.action} — {roi.result}</div>
                  {roi.clicksGained > 0 && (
                    <div className="t-caption text-accent-info mt-0.5">+{roi.clicksGained.toLocaleString()} clicks</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
