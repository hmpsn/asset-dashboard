// CLIENT-FACING
// Composes the magazine briefing on the client Insights tab.
//
//   ActionQueueStrip (always)
//     ↓
//   FREE tier  → FreeTierUpgradeCTA + MonthlyDigestContent (un-gated tease)
//   PAID tier  → useClientBriefing → loading / empty / hero + secondary rows
//
// Per the plan, the Free-tier branch renders `<MonthlyDigestContent>` un-gated
// as a glimpse of the editorial voice. Premium/Growth never see MonthlyDigest;
// they get the AI-curated weekly briefing instead.

import { Sparkles } from 'lucide-react';
import type { Tier } from '../../ui';
import { LoadingState, EmptyState, Icon } from '../../ui';
import { useClientBriefing } from '../../../hooks/client/useClientBriefing';
import { useMonthlyDigest } from '../../../hooks/client/useMonthlyDigest';
import { ActionQueueStrip } from './ActionQueueStrip';
import { HeroStoryCard } from './HeroStoryCard';
import { SecondaryStoryRow } from './SecondaryStoryRow';
import { FreeTierUpgradeCTA } from './FreeTierUpgradeCTA';
import { MonthlyDigestContent } from '../MonthlyDigest';

interface InsightsBriefingPageProps {
  workspaceId: string;
  effectiveTier: Tier;
  betaMode: boolean;
  actionCounts: {
    approvals: number;
    briefs: number;
    posts: number;
    replies: number;
    contentPlan: number;
  };
}

export function InsightsBriefingPage({
  workspaceId,
  effectiveTier,
  betaMode,
  actionCounts,
}: InsightsBriefingPageProps) {
  const isFree = effectiveTier === 'free';
  const { data: briefing, isLoading } = useClientBriefing(workspaceId, !isFree);
  // Free-tier needs the digest data to render <MonthlyDigestContent> un-gated.
  // We always fetch on the free branch (cheap; staleTime is 1h) but skip on
  // paid since paid never renders MonthlyDigest in the briefing layout.
  const { data: digest, isLoading: digestLoading } = useMonthlyDigest(isFree ? workspaceId : '');

  return (
    <div className="space-y-6">
      <ActionQueueStrip
        workspaceId={workspaceId}
        betaMode={betaMode}
        counts={actionCounts}
      />

      {isFree ? (
        <>
          <FreeTierUpgradeCTA workspaceId={workspaceId} betaMode={betaMode} />
          {/* Tease the editorial voice with the digest body, un-gated. */}
          {digestLoading ? (
            <LoadingState message="Loading your monthly highlights..." />
          ) : digest?.month ? (
            <MonthlyDigestContent digest={digest} />
          ) : null}
        </>
      ) : isLoading ? (
        <LoadingState message="Loading this week's briefing..." />
      ) : !briefing || briefing.stories.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Your first briefing will arrive Monday"
          description="Each week we'll surface the wins, risks, and opportunities that matter — tailored to your business."
        />
      ) : (() => {
        // Single-pass partition (replaces 3 .filter() iterations per render).
        // Phase 1 Zod enforces exactly 1 headline; we use `find` for the
        // hero so we don't pretend the data could ever return >1.
        const hero = briefing.stories.find((s) => s.isHeadline);
        const secondary = briefing.stories.filter((s) => !s.isHeadline);
        return (
          <>
            {hero && (
              <HeroStoryCard
                key={hero.id}
                story={hero}
                workspaceId={workspaceId}
                betaMode={betaMode}
              />
            )}
            {secondary.length > 0 && (
              <div className="border-t border-[var(--brand-border)] pt-4">
                <h3 className="t-label text-[var(--brand-text-muted)] tracking-wider mb-3 flex items-center gap-2">
                  <Icon as={Sparkles} size="sm" className="text-teal-400" />
                  Also this week
                </h3>
                <div className="space-y-0">
                  {secondary.map((s) => (
                    <SecondaryStoryRow
                      key={s.id}
                      story={s}
                      workspaceId={workspaceId}
                      betaMode={betaMode}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
