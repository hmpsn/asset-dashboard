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
import { Sparkles, Check } from 'lucide-react';
import { Badge, SectionCard, TierGate, Button, type BadgeTone } from '../../ui';
import { ContentGapRow } from '../../shared/ContentGapRow';
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
   * SEO Gen-Quality P4 (Contract 3) — the per-workspace `seo-generation-quality`
   * umbrella state, resolved server-side and threaded down via the briefing
   * response (`ovGainActive`). The client has no per-workspace flag mechanism,
   * so this prop is the single gate for the recommendation materiality signal.
   *   ON  → the opportunity-score badge is OV-EMV-derived ("Opportunity NN") and
   *         the competing `volume × 0.103` "est. clicks at rank #3" estimate is
   *         suppressed (one basis — no diverging estimator).
   *   OFF → the pre-P4 surface renders byte-identically: "NN/100" badge + the
   *         "est. clicks at rank #3" line. Defaults OFF (= all prod today).
   */
  ovGainActive?: boolean;
}

const intentTone = (intent?: string): BadgeTone => {
  switch (intent) {
    case 'informational':
      return 'blue';
    case 'commercial':
      return 'teal';
    case 'transactional':
      return 'emerald';
    case 'navigational':
      return 'amber';
    default:
      return 'zinc';
  }
};

const VISIBLE_COUNT = 3;

export function RecommendedForYou({
  recommendations,
  tier,
  onRequestBrief,
  ovGainActive = false,
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
          // Header-right widgets after the shared intent badge: priority + page-type (briefing chrome).
          const headerRight = (
            <>
              <Badge label={rec.priority ?? ''} tone={rec.priority === 'high' ? 'red' : rec.priority === 'medium' ? 'amber' : 'zinc'} variant="outline" />
              {rec.suggestedPageType && rec.suggestedPageType !== 'blog' && (
                <Badge label={rec.suggestedPageType} tone="teal" variant="outline" className="capitalize" />
              )}
            </>
          );
          // Tier-aware CTA footer.
          const footer = (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {tier === 'premium' ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={Check}
                  onClick={() => onRequestBrief(rec)}
                  className="rounded-[var(--radius-lg)] bg-teal-600/20 border-teal-500/30 text-accent-brand hover:bg-teal-600/40"
                >
                  Generate Brief (included) &rarr;
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={Sparkles}
                  onClick={() => onRequestBrief(rec)}
                  className="rounded-[var(--radius-lg)] bg-teal-600/20 border-teal-500/30 text-accent-brand hover:bg-teal-600/40"
                >
                  Generate Brief &rarr;
                </Button>
              )}
            </div>
          );
          return (
            <ContentGapRow
              key={rec.targetKeyword}
              audience="briefing"
              data={rec}
              intentTone={intentTone}
              // P4 (Contract 3): server-resolved per-workspace umbrella, threaded as-is.
              // Flag-OFF (default = all prod) renders the pre-P4 surface byte-identically.
              ovGainActive={ovGainActive}
              headerRight={headerRight}
              footer={footer}
            />
          );
        })}
      </div>

      {/* Show more / collapse toggle */}
      {hiddenCount > 0 && (
        <div className="mt-3 text-center">
          {expanded ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setExpanded(false)}
              className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors no-underline"
            >
              Show less
            </Button>
          ) : (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setExpanded(true)}
              className="t-caption-sm text-accent-brand hover:text-accent-brand transition-colors no-underline"
            >
              Show {hiddenCount} more
            </Button>
          )}
        </div>
      )}
      </SectionCard>
    </TierGate>
  );
}
