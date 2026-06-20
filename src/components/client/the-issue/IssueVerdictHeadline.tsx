// ── IssueVerdictHeadline — slot 1 of the client spine (verdict-first, no ring) ───
//
// Replaces NarratedStatusHeadline AT THE HEADLINE on the flag-ON spine. It DROPS the
// 0–100 visibility ring + the score-band evergreenVerdict() and instead LEADS WITH MEANING:
// a baseline-anchored, GA4-grounded dollar/outcome verdict. The number and the sentence are
// pure renders — `verdict` is server-assembled (ROIData.outcomeVerdict); the client only formats
// already-resolved values through the provenance render contract + baselineVerdict.
//
// P1a: the dollar precision + disclosure are driven by verdict.provenance via the SINGLE
// resolveProvenanceRender contract (authority-layered-fields rule) — never an inline
// `provenance === …` branch. estimate_ga4 → banded ~ estimate; measured_action → banded ~ dollar
// (the COUNT is measured/"tracked on your site" but the dollar = count × an estimated lead rate, so
// it stays banded — only P3 actual_reconciled is exact at the dollar). The retainer ratio stays
// banded for ALL provenances (a multiple of a measured value is editorial, not sourced).
//
// KEPT from NarratedStatusHeadline (the human-curation moat):
//   • the "Curated by your strategist" byline (teal Sparkles)
//   • the opt-in #1-priority "why" contribution bars (blue = data, progressive disclosure)
//
// Render branches:
//   (a) verdict == null            → honest no-number degradation
//   (b) baseline.state === 'establishing' → value + establishing line, NO fabricated delta
//   (c) ready                      → fmtEstimateMoney + retainer ratio + baselineVerdict()
//
// Four Laws: teal = action/byline, blue = the why-bars (data), emerald = the dollar value.
// No purple. No 0–100 ring (it survives only under the collapsed "Under the hood"). Tokens only.

import { useState } from 'react';
import { ChevronDown, Sparkles, Zap } from 'lucide-react';
import { Icon, Button } from '../../ui';
import type { ROIData } from '../../../../shared/types/roi';
import type { Recommendation } from '../../../../shared/types/recommendations';
import { fmtEstimateRatio } from '../../../utils/formatNumbers';
import { baselineVerdict } from './evergreenCopy';
import { resolveProvenanceRender } from './outcomeProvenance';

type OutcomeVerdict = NonNullable<ROIData['outcomeVerdict']>;

interface IssueVerdictHeadlineProps {
  /** Server-assembled outcome verdict. null → honest no-number degradation. */
  verdict: OutcomeVerdict | null;
  /** The #1 curated rec — drives the optional "why" bars. Optional. */
  topRec?: Recommendation | null;
}

export function IssueVerdictHeadline({ verdict, topRec }: IssueVerdictHeadlineProps) {
  const [showWhy, setShowWhy] = useState(false);

  const whyComponents = topRec?.opportunity && topRec.opportunity.components.length > 0
    ? [...topRec.opportunity.components].sort((a, b) => b.contribution - a.contribution).slice(0, 3)
    : [];
  const maxContribution = Math.max(...whyComponents.map((c) => c.contribution), 0.0001);

  const isEstablishing = verdict != null && verdict.baseline.state === 'establishing';
  // Single resolved provenance contract — drives dollar precision + disclosure (authority-layered).
  const prov = verdict != null ? resolveProvenanceRender(verdict.provenance) : null;
  // The retainer ratio stays banded for ALL provenances — a multiple of a measured value is
  // editorial, not sourced. Intentionally NOT routed through prov.fmtMoney.
  const retainerRatio = verdict?.monthlyRetainer && verdict.monthlyRetainer > 0
    ? fmtEstimateRatio(verdict.estimatedValue / verdict.monthlyRetainer)
    : null;

  return (
    <section
      data-testid="issue-verdict-headline"
      className="bg-gradient-to-br from-teal-500/8 via-[var(--surface-2)] to-[var(--surface-2)] border border-teal-500/15 px-5 py-4"
      style={{ borderRadius: 'var(--radius-signature)' }}
    >
      {verdict == null ? (
        // (a) Honest no-number degradation — no fabricated value.
        <div className="min-w-0">
          <span className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">What your SEO is worth</span>
          <p className="t-page text-[var(--brand-text-bright)] mt-1 leading-snug">
            Your verdict appears here as outcomes land — we’re connecting the conversions your SEO is driving to a dollar value.
          </p>
        </div>
      ) : (
        <div className="min-w-0">
          <span className="t-label text-[var(--brand-text-muted)] uppercase tracking-wider">What your SEO is worth</span>
          {/* The dollar lead — emerald (success/$ law). Precision is provenance-driven: banded ~ for
              estimate_ga4 AND measured_action (value = count × estimated rate), exact only for
              actual_reconciled — never false precision either way. */}
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            {/* stat-primitive-ok: the verdict headline is an intentional editorial hero shell (inline dollar lead + "X your retainer"), not a labeled StatCard grid. */}
            <span className="t-stat-lg text-accent-success leading-none">{prov!.fmtMoney(verdict.estimatedValue)}</span>
            {retainerRatio && (
              <span className="t-caption-sm text-[var(--brand-text-muted)]">{retainerRatio} your retainer</span>
            )}
          </div>
          {/* The baseline-anchored verdict sentence — pure render via baselineVerdict (Lane C). */}
          <p className="t-page text-[var(--brand-text-bright)] mt-2 leading-snug">
            {isEstablishing
              ? baselineVerdict({ outcomeNoun: verdict.outcomeUnitLabel, current: verdict.outcomeCount, baseline: null })
              : baselineVerdict({ outcomeNoun: verdict.outcomeUnitLabel, current: verdict.outcomeCount, baseline: verdict.baseline.baselineConversions })}
          </p>
          {/* Provenance disclosure — the honest label + precision come from the single render
              contract (estimate vs measured vs actual). No inline `provenance === …` branch. */}
          <p className="mt-2 t-caption-sm text-[var(--brand-text-muted)]">
            {prov!.disclosure(verdict.valuePerOutcome)}
          </p>
        </div>
      )}

      {/* "Curated by your strategist" byline — KEPT from NarratedStatusHeadline (the moat). */}
      <p className="mt-3 inline-flex items-center gap-1.5 t-caption-sm text-[var(--brand-text-muted)]">
        <Icon as={Sparkles} size="sm" className="text-accent-brand" />
        Curated by your strategist
      </p>

      {/* #1 "why" contribution bars — opt-in progressive disclosure (blue = data). KEPT. */}
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
