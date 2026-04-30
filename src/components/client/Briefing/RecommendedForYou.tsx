// CLIENT-FACING
// "Recommended for You" section of the client briefing — primary upsell moment.
// Ports the row layout from src/components/strategy/ContentGaps.tsx with
// tier-aware CTAs instead of admin navigation buttons.
//
// Tier behaviour:
//   free    → locked upgrade CTA block (no individual rows)
//   growth  → "Generate Brief →" teal CTA per row
//   premium → "Generate Brief (included) →" teal CTA with check icon per row

import { useState, type ReactNode } from 'react';
import { BarChart3, Eye, ArrowUpRight, Sparkles, Lock, Check, Swords, MessageCircleQuestion } from 'lucide-react';
import { SectionCard, Icon } from '../../ui';
import { TrendBadge } from '../../ui/TrendBadge';
import { fmtNum } from '../../../utils/formatNumbers';
import { kdFraming, kdTooltip } from '../../../lib/kdFraming';
import type { BriefingRecommendation } from '../../../../shared/types/briefing';
import type { Tier } from '../../ui';

export interface RecommendedForYouProps {
  recommendations: BriefingRecommendation[];
  tier: Tier;
  /**
   * Called when the user clicks "Generate Brief" on a Growth/Premium row.
   * The parent (T2.5b.10 InsightsBriefingPage) wires this to the existing
   * client pricing modal flow. Receives the recommendation that was clicked.
   */
  onRequestBrief: (rec: BriefingRecommendation) => void;
  /**
   * Called when a Free-tier user clicks the upgrade CTA.
   */
  onUpgrade?: () => void;
}

// File-local helpers — NOT shared utils (exclusive file ownership).
// Ported verbatim from src/components/strategy/ContentGaps.tsx.
const kdColor = (kd?: number) =>
  !kd
    ? 'text-[var(--brand-text-muted)]'
    : kd <= 30
    ? 'text-emerald-400'
    : kd <= 60
    ? 'text-amber-400'
    : kd <= 80
    ? 'text-orange-400'
    : 'text-red-400';

const intentColor = (intent?: string): string => {
  switch (intent) {
    case 'informational':
      return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
    case 'commercial':
      return 'text-teal-400 bg-teal-500/10 border-teal-500/20';
    case 'transactional':
      return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    case 'navigational':
      return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    default:
      return 'text-[var(--brand-text-muted)] bg-[var(--surface-3)]/30 border-[var(--brand-border)]/20';
  }
};

const VISIBLE_COUNT = 3;

export function RecommendedForYou({
  recommendations,
  tier,
  onRequestBrief,
  onUpgrade,
}: RecommendedForYouProps): ReactNode {
  const [expanded, setExpanded] = useState(false);

  if (recommendations.length === 0) return null;

  const visible = expanded ? recommendations : recommendations.slice(0, VISIBLE_COUNT);
  const hiddenCount = recommendations.length - VISIBLE_COUNT;

  // Free tier: replace row list with locked upgrade CTA
  if (tier === 'free') {
    return (
      <SectionCard
        title="RECOMMENDED FOR YOU"
        titleIcon={<Icon as={Lock} size="sm" className="text-teal-400" />}
        variant="default"
      >
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="w-10 h-10 rounded-full bg-teal-500/10 flex items-center justify-center">
            <Icon as={Lock} size="lg" className="text-teal-400" />
          </div>
          <div>
            <p className="t-body font-semibold text-[var(--brand-text-bright)] mb-1">
              {recommendations.length} content {recommendations.length === 1 ? 'opportunity' : 'opportunities'} locked
            </p>
            <p className="t-caption text-[var(--brand-text-muted)] max-w-sm">
              Upgrade to Growth to access content briefs and rank for these keywords.
            </p>
          </div>
          {onUpgrade && (
            <button
              onClick={onUpgrade}
              className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-ui font-medium text-teal-300 hover:bg-teal-600/40 transition-all"
            >
              <Icon as={Sparkles} size="sm" className="text-teal-300" />
              Upgrade to Growth
            </button>
          )}
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="RECOMMENDED FOR YOU" variant="default">
      <div className="space-y-2">
        {visible.map((rec, i) => {
          const prioColor =
            rec.priority === 'high'
              ? 'text-red-400 bg-red-500/10 border-red-500/20'
              : rec.priority === 'medium'
              ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              : 'text-[var(--brand-text)] bg-[var(--surface-3)]/30 border-[var(--brand-border)]/20';

          return (
            <div
              key={i}
              className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]"
            >
              {/* Row 1: topic + opportunity score + intent/priority/pageType badges */}
              <div className="flex items-center justify-between">
                <span className="t-ui font-medium text-[var(--brand-text-bright)]">
                  {rec.topic}
                  {rec.opportunityScore != null && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 t-caption font-medium text-blue-400">
                      {rec.opportunityScore}/100
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`t-caption-sm uppercase px-1.5 py-0.5 rounded-full border font-medium ${intentColor(rec.intent)}`}
                  >
                    {rec.intent}
                  </span>
                  <span
                    className={`t-caption-sm font-medium px-1.5 py-0.5 rounded border ${prioColor}`}
                  >
                    {rec.priority}
                  </span>
                  {rec.suggestedPageType && rec.suggestedPageType !== 'blog' && (
                    <span className="t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20 font-medium capitalize">
                      {rec.suggestedPageType}
                    </span>
                  )}
                </div>
              </div>

              {/* Row 2: target keyword + metrics + tier-aware CTA */}
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="t-caption-sm text-teal-400">
                    Target keyword: &ldquo;{rec.targetKeyword}&rdquo;
                  </span>
                  {rec.volume != null && (
                    <span className="t-caption-sm text-[var(--brand-text)] flex items-center gap-0.5">
                      <Icon as={BarChart3} size="sm" />
                      {fmtNum(rec.volume)}/mo
                    </span>
                  )}
                  {rec.difficulty != null && rec.difficulty > 0 && (
                    <span
                      className={`t-caption-sm font-medium ${kdColor(rec.difficulty)} cursor-help`}
                      title={kdTooltip(rec.difficulty)}
                    >
                      KD {rec.difficulty}
                    </span>
                  )}
                  {rec.difficulty != null && rec.difficulty > 0 && kdFraming(rec.difficulty) && (
                    <span className="t-caption-sm text-[var(--brand-text-muted)] leading-none">
                      {kdFraming(rec.difficulty)}
                    </span>
                  )}
                  {rec.impressions != null && rec.impressions > 0 && (
                    <span className="t-caption-sm text-blue-400 flex items-center gap-0.5">
                      <Icon as={Eye} size="sm" className="text-blue-400" />
                      {fmtNum(rec.impressions)} impr
                    </span>
                  )}
                  {rec.volume != null && rec.volume > 0 && (() => {
                    const impact = Math.round(rec.volume * 0.103);
                    if (impact < 10) return null;
                    return (
                      <span className="t-caption-sm text-blue-400/70 flex items-center gap-0.5">
                        <Icon as={ArrowUpRight} size="sm" className="text-blue-400/70" />
                        ~{fmtNum(impact)}/mo est. clicks at rank #3
                      </span>
                    );
                  })()}
                </div>

                {/* Tier-aware CTA buttons */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {tier === 'premium' ? (
                    <button
                      onClick={() => onRequestBrief(rec)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 transition-all"
                    >
                      <Icon as={Check} size="sm" className="text-teal-300" />
                      Generate Brief (included) &rarr;
                    </button>
                  ) : (
                    <button
                      onClick={() => onRequestBrief(rec)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 font-medium hover:bg-teal-600/40 transition-all"
                    >
                      <Icon as={Sparkles} size="sm" className="text-teal-300" />
                      Generate Brief &rarr;
                    </button>
                  )}
                </div>
              </div>

              {/* Row 3: trend + SERP features + competitor proof */}
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {rec.trendDirection === 'rising' && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-emerald-400 font-medium">
                    <TrendBadge value={1} suffix="" iconOnly /> Rising
                  </span>
                )}
                {rec.trendDirection === 'declining' && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-red-400 font-medium">
                    <TrendBadge value={-1} suffix="" iconOnly /> Declining
                  </span>
                )}
                {rec.trendDirection === 'stable' && rec.volume != null && rec.volume > 0 && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-[var(--brand-text)] font-medium">
                    <TrendBadge value={0} hideOnZero={false} suffix="" iconOnly /> Stable
                  </span>
                )}
                {Array.isArray(rec.serpFeatures) && rec.serpFeatures.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {rec.serpFeatures.includes('featured_snippet') && (
                      <span className="t-micro px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        ⬜ Snippet
                      </span>
                    )}
                    {rec.serpFeatures.includes('people_also_ask') && (
                      <span className="t-micro px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        ❓ PAA
                      </span>
                    )}
                    {rec.serpFeatures.includes('video') && (
                      <span className="t-micro px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        ▶ Video
                      </span>
                    )}
                    {rec.serpFeatures.includes('local_pack') && (
                      <span className="t-micro px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        📍 Local
                      </span>
                    )}
                  </div>
                )}
                {rec.competitorProof && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-orange-400 font-medium">
                    <Icon as={Swords} size="sm" className="text-orange-400" />
                    {rec.competitorProof}
                  </span>
                )}
              </div>

              {/* Row 4: SERP targeting tips */}
              {rec.serpTargeting && rec.serpTargeting.length > 0 && (
                <div className="mt-1.5 pl-2 border-l-2 border-yellow-500/20">
                  {rec.serpTargeting.map((tip, ri) => (
                    <div key={ri} className="t-caption-sm text-yellow-400/80 leading-relaxed">
                      &rarr; {tip}
                    </div>
                  ))}
                </div>
              )}

              {/* Row 5: question keywords */}
              {rec.questionKeywords && rec.questionKeywords.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <Icon as={MessageCircleQuestion} size="sm" className="text-cyan-400 flex-shrink-0" />
                  {rec.questionKeywords.map((q, qi) => (
                    <span key={qi} className="t-caption-sm text-cyan-400/80 italic">
                      &ldquo;{q}&rdquo;
                    </span>
                  ))}
                </div>
              )}

              {/* Row 6: rationale */}
              <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{rec.rationale}</div>
            </div>
          );
        })}
      </div>

      {/* Show more / collapse toggle */}
      {hiddenCount > 0 && (
        <div className="mt-3 text-center">
          {expanded ? (
            <button
              onClick={() => setExpanded(false)}
              className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
            >
              Show less
            </button>
          ) : (
            <button
              onClick={() => setExpanded(true)}
              className="t-caption-sm text-teal-400 hover:text-teal-300 transition-colors"
            >
              Show {hiddenCount} more
            </button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
