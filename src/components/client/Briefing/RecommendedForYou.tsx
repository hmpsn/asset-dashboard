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
import { BarChart3, Eye, ArrowUpRight, Sparkles, Check, Swords, MessageCircleQuestion } from 'lucide-react';
import { SectionCard, Icon, TierGate } from '../../ui';
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
}

// File-local helpers — NOT shared utils (exclusive file ownership).
// Ported verbatim from src/components/strategy/ContentGaps.tsx.
const kdColor = (kd?: number) =>
  !kd
    ? 'text-[var(--brand-text-muted)]'
    : kd <= 30
    ? 'text-accent-success'
    : kd <= 60
    ? 'text-accent-warning'
    : kd <= 80
    ? 'text-accent-warning'
    : 'text-accent-danger';

const intentColor = (intent?: string): string => {
  switch (intent) {
    case 'informational':
      return 'text-accent-info bg-blue-500/10 border-blue-500/20';
    case 'commercial':
      return 'text-accent-brand bg-teal-500/10 border-teal-500/20';
    case 'transactional':
      return 'text-accent-success bg-emerald-500/10 border-emerald-500/20';
    case 'navigational':
      return 'text-accent-warning bg-amber-500/10 border-amber-500/20';
    default:
      return 'text-[var(--brand-text-muted)] bg-[var(--surface-3)]/30 border-[var(--brand-border)]/20';
  }
};

const VISIBLE_COUNT = 3;

export function RecommendedForYou({
  recommendations,
  tier,
  onRequestBrief,
}: RecommendedForYouProps): ReactNode {
  const [expanded, setExpanded] = useState(false);

  if (recommendations.length === 0) return null;

  const visible = expanded ? recommendations : recommendations.slice(0, VISIBLE_COUNT);
  const hiddenCount = recommendations.length - VISIBLE_COUNT;

  // Free tier wraps the SAME render path in <TierGate>, which blurs the rows
  // and overlays the canonical upgrade CTA. The Reuse Map mandates
  // <TierGate> for free-tier gating; rolling our own block bypasses the
  // platform's tier-upgrade event flow.
  return (
    <TierGate
      tier={tier}
      required="growth"
      feature="Recommended content opportunities"
      teaser={`${recommendations.length} content ${recommendations.length === 1 ? 'opportunity' : 'opportunities'} ready when you upgrade.`}
    >
      <SectionCard title="RECOMMENDED FOR YOU" variant="default">
      <div className="space-y-2">
        {visible.map((rec) => {
          const prioColor =
            rec.priority === 'high'
              ? 'text-accent-danger bg-red-500/10 border-red-500/20'
              : rec.priority === 'medium'
              ? 'text-accent-warning bg-amber-500/10 border-amber-500/20'
              : 'text-[var(--brand-text)] bg-[var(--surface-3)]/30 border-[var(--brand-border)]/20';

          return (
            <div
              key={rec.targetKeyword}
              className="px-3 py-2.5 bg-[var(--surface-3)]/40 rounded-[var(--radius-lg)] border border-[var(--brand-border)]"
            >
              {/* Row 1: topic + opportunity score + intent/priority/pageType badges */}
              <div className="flex items-center justify-between">
                <span className="t-ui font-medium text-[var(--brand-text-bright)]">
                  {rec.topic}
                  {rec.opportunityScore != null && (
                    <span className="ml-2 inline-flex items-center rounded-[var(--radius-pill)] bg-blue-500/10 px-2 py-0.5 t-caption font-medium text-accent-info">
                      {rec.opportunityScore}/100
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`t-caption-sm uppercase px-1.5 py-0.5 rounded-[var(--radius-pill)] border font-medium ${intentColor(rec.intent)}`}
                  >
                    {rec.intent}
                  </span>
                  <span
                    className={`t-caption-sm font-medium px-1.5 py-0.5 rounded border ${prioColor}`}
                  >
                    {rec.priority}
                  </span>
                  {rec.suggestedPageType && rec.suggestedPageType !== 'blog' && (
                    <span className="t-caption-sm px-1.5 py-0.5 rounded bg-teal-500/10 text-accent-brand border border-teal-500/20 font-medium capitalize">
                      {rec.suggestedPageType}
                    </span>
                  )}
                </div>
              </div>

              {/* Row 2: target keyword + metrics + tier-aware CTA */}
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="t-caption-sm text-accent-brand">
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
                    <span className="t-caption-sm text-accent-info flex items-center gap-0.5">
                      <Icon as={Eye} size="sm" className="text-accent-info" />
                      {fmtNum(rec.impressions)} impr
                    </span>
                  )}
                  {rec.volume != null && rec.volume > 0 && (() => {
                    const impact = Math.round(rec.volume * 0.103);
                    if (impact < 10) return null;
                    return (
                      <span className="t-caption-sm text-accent-info flex items-center gap-0.5">
                        <Icon as={ArrowUpRight} size="sm" className="text-accent-info" />
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
                      className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-accent-brand font-medium hover:bg-teal-600/40 transition-all"
                    >
                      <Icon as={Check} size="sm" className="text-accent-brand" />
                      Generate Brief (included) &rarr;
                    </button>
                  ) : (
                    <button
                      onClick={() => onRequestBrief(rec)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-lg)] bg-teal-600/20 border border-teal-500/30 t-caption-sm text-accent-brand font-medium hover:bg-teal-600/40 transition-all"
                    >
                      <Icon as={Sparkles} size="sm" className="text-accent-brand" />
                      Generate Brief &rarr;
                    </button>
                  )}
                </div>
              </div>

              {/* Row 3: trend + SERP features + competitor proof */}
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {rec.trendDirection === 'rising' && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-accent-success font-medium">
                    <TrendBadge value={1} suffix="" iconOnly /> Rising
                  </span>
                )}
                {rec.trendDirection === 'declining' && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-accent-danger font-medium">
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
                      <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-blue-500/10 text-accent-info border border-blue-500/20">
                        ⬜ Snippet
                      </span>
                    )}
                    {rec.serpFeatures.includes('people_also_ask') && (
                      <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-blue-500/10 text-accent-info border border-blue-500/20">
                        ❓ PAA
                      </span>
                    )}
                    {rec.serpFeatures.includes('video') && (
                      <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-blue-500/10 text-accent-info border border-blue-500/20">
                        ▶ Video
                      </span>
                    )}
                    {rec.serpFeatures.includes('local_pack') && (
                      <span className="t-caption-sm px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-blue-500/10 text-accent-info border border-blue-500/20">
                        📍 Local
                      </span>
                    )}
                  </div>
                )}
                {rec.competitorProof && (
                  <span className="flex items-center gap-0.5 t-caption-sm text-accent-warning font-medium">
                    <Icon as={Swords} size="sm" className="text-accent-warning" />
                    {rec.competitorProof}
                  </span>
                )}
              </div>

              {/* Row 4: SERP targeting tips. Amber = warning/medium-priority
                  per the palette; replaces admin's yellow which isn't on the
                  Four Laws palette for client-facing components. */}
              {rec.serpTargeting && rec.serpTargeting.length > 0 && (
                <div className="mt-1.5 pl-2 border-l-2 border-amber-500/20">
                  {rec.serpTargeting.map((tip) => (
                    <div key={tip} className="t-caption-sm text-accent-warning leading-relaxed">
                      &rarr; {tip}
                    </div>
                  ))}
                </div>
              )}

              {/* Row 5: question keywords. Muted text — these are content
                  metadata, not navigational data (cyan would mis-key the
                  semantic per BRAND_DESIGN_LANGUAGE). */}
              {rec.questionKeywords && rec.questionKeywords.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <Icon as={MessageCircleQuestion} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
                  {rec.questionKeywords.map((q) => (
                    <span key={q} className="t-caption-sm text-[var(--brand-text-muted)] italic">
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
              className="t-caption-sm text-accent-brand hover:text-accent-brand transition-colors"
            >
              Show {hiddenCount} more
            </button>
          )}
        </div>
      )}
      </SectionCard>
    </TierGate>
  );
}
