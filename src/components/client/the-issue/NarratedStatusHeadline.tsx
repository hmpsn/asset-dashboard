// ── NarratedStatusHeadline — the evergreen "where your site stands" headline ─────
//
// Spec §5.1 / audit §16.1 (client). One-or-two sentences of plain-English meaning about
// where the site sits and where the momentum is — EVERGREEN (achieved-state + causal
// claim, never a time anchor). A compact health number + a single trend chip sit beside
// it; the full metric strip lives one section down ("Your numbers"), not shoved forward.
//
// Reuses the verdict() framing from StrategyClientOrientHeader but STRIPS the
// "vs last refresh" deltas (evergreen violation). When the #1 curated rec carries an
// opportunity breakdown, its top "why" contribution bars render as progressive disclosure
// (the §16.1 "#1-priority why bars"). No admin jargon, no purple; blue = data, teal = action.

import { useState } from 'react';
import { ChevronDown, Zap } from 'lucide-react';
import { MetricRing, Icon, Button, cardToneClasses } from '../../ui';
import type { OrientMetrics } from '../../../../shared/types/keyword-strategy-ux';
import type { Recommendation } from '../../../../shared/types/recommendations';
import { ISSUE_SECTION_TITLES } from './evergreenCopy';

interface NarratedStatusHeadlineProps {
  /** Client-safe Orient metrics (visibility score + counts). Headline degrades gracefully when absent. */
  orient?: OrientMetrics;
  /** The #1 curated rec (drives the optional "why" bars). Optional. */
  topRec?: Recommendation | null;
  /** The client's stated goal, when known — anchors the momentum sentence ("toward YOUR goal"). */
  statedGoal?: string | null;
}

/**
 * Evergreen verdict — achieved-state framing with a directional momentum clause derived
 * from the score band ALONE (no time-relative deltas). Anchored to the client's stated goal
 * when available. NO "vs last refresh", NO "this week".
 */
function evergreenVerdict(score: number, statedGoal?: string | null): string {
  const goalClause = statedGoal && statedGoal.trim().length > 0
    ? ` — momentum that points toward ${statedGoal.trim()}`
    : '';
  if (score >= 80) return `Your search visibility is strong${goalClause}.`;
  if (score >= 60) return `Your search visibility is building, with real room to grow${goalClause}.`;
  return `Your search visibility is still low — this is where the biggest gains are${goalClause}.`;
}

export function NarratedStatusHeadline({ orient, topRec, statedGoal }: NarratedStatusHeadlineProps) {
  const [showWhy, setShowWhy] = useState(false);

  // Degrade gracefully: with no orient metrics, render a neutral evergreen line and skip the ring.
  const score = orient?.visibilityScore ?? null;

  const whyComponents = topRec?.opportunity && topRec.opportunity.components.length > 0
    ? [...topRec.opportunity.components].sort((a, b) => b.contribution - a.contribution).slice(0, 3)
    : [];
  const maxContribution = Math.max(...whyComponents.map((c) => c.contribution), 0.0001);

  return (
    <section className={`${cardToneClasses('teal')} border px-5 py-4`} style={{ borderRadius: 'var(--radius-signature)' }}>
      <div className="flex items-center gap-5">
        {score != null && <MetricRing score={score} size={88} />}
        <div className="min-w-0 flex-1">
          <span className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">{ISSUE_SECTION_TITLES.status}</span>
          <p className="t-page text-[var(--brand-text-bright)] mt-1 leading-snug">
            {score != null
              ? evergreenVerdict(score, statedGoal)
              : 'We’re getting your search visibility picture set up — your status will appear here as data lands.'}
          </p>
        </div>
      </div>

      {/* #1 "why" contribution bars — progressive disclosure (blue = data). Omitted on legacy recs. */}
      {topRec && whyComponents.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--brand-border)]/40">
          <Button
            variant="link"
            onClick={() => setShowWhy((v) => !v)}
            className="flex items-center gap-2 t-caption-sm text-accent-brand no-underline hover:no-underline transition-colors px-0 py-0"
            aria-expanded={showWhy}
          >
            <Icon as={Zap} size="sm" className="text-accent-brand" />
            Why this is the move we’d make first
            <Icon as={ChevronDown} size="sm" className={`transition-transform ${showWhy ? 'rotate-180' : ''}`} />
          </Button>
          {showWhy && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              <div className="t-ui font-medium text-[var(--brand-text-bright)] mb-0.5">{topRec.title}</div>
              {whyComponents.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-20 flex-shrink-0">
                    <span className="t-caption-sm font-medium text-[var(--brand-text)] capitalize">{c.dimension}</span>
                  </div>
                  <div className="flex-1 min-w-0 h-1.5 rounded-[var(--radius-pill)] bg-[var(--surface-3)] overflow-hidden">
                    <div
                      className="h-full rounded-[var(--radius-pill)] bg-blue-500"
                      style={{ width: `${Math.max(6, Math.round((c.contribution / maxContribution) * 100))}%` }}
                    />
                  </div>
                  <span className="t-caption-sm text-[var(--brand-text-muted)] truncate flex-1 min-w-0">{c.evidence}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
