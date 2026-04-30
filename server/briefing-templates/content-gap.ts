// server/briefing-templates/content-gap.ts
//
// Deterministic briefing-template module for `content_gap` candidates.
//
// Unlike the sibling templates in this directory (which take an
// `AnalyticsInsight<T>`), this template's input is a `ContentGap` row from
// `keywordStrategy.contentGaps[]` — gaps are not stored as analytics insights
// and have a different field shape. The exported function name therefore
// differs (`buildStoryFromContentGap`, not `buildStoryFromInsight`) and the
// dispatcher in `server/insight-to-story.ts` routes to it explicitly.
//
// Voice rules (spec §5):
//   - Banned hedges: potentially, could, may, appears to, suggests, might, seems
//   - Every sentence cites a number from the typed payload
//   - Definite tone — "lands top-5 within 90 days", not "could land top-5"
//   - No vague comparators or generic phrases
//
// Voice reference: see spec §5 `content_gap — Lead variant` sample template
// (docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md).

import type { ContentGap } from '../../shared/types/workspace.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import { fmtNum } from './_helpers.js';

export interface GapTemplateContext {
  workspaceId: string;
  tier: 'free' | 'growth' | 'premium';
  /**
   * Workspace's weighted-avg CPC from ROI computation. Used for the `≈ $X/mo
   * ad-spend equivalent at rank #3` footnote in the data receipt. When
   * undefined, the receipt omits the dollar figure.
   */
  avgCPC?: number;
}

/**
 * Map keyword difficulty (0-100) to a single-word framing for the metric
 * label. Bands match `kdFraming()` in `src/lib/kdFraming.ts`.
 */
function difficultyFraming(kd: number): 'low' | 'medium' | 'high' | 'expert' {
  if (kd <= 30) return 'low';
  if (kd <= 60) return 'medium';
  if (kd <= 80) return 'high';
  return 'expert';
}

export function buildStoryFromContentGap(
  gap: ContentGap,
  context: GapTemplateContext,
): BriefingStory | null {
  // Required fields — degrade gracefully when missing.
  if (!gap.targetKeyword || typeof gap.volume !== 'number' || gap.volume <= 0) {
    return null;
  }

  const volumeLabel = fmtNum(gap.volume);

  const hasDifficulty = typeof gap.difficulty === 'number' && gap.difficulty > 0;
  const framing = hasDifficulty ? difficultyFraming(gap.difficulty as number) : null;

  const hasImpressions = typeof gap.impressions === 'number' && gap.impressions > 0;
  const hasCompetitorProof = typeof gap.competitorProof === 'string' && gap.competitorProof.length > 0;
  const hasCPC = typeof context.avgCPC === 'number' && context.avgCPC > 0;

  // Headline — the keyword and its monthly volume, framed as untargeted demand.
  const headline =
    `"${gap.targetKeyword}" is searched ${volumeLabel} times per month — ` +
    `your site doesn't yet target it.`;

  // Narrative — 2-3 sentences, every sentence cites a number, no hedges.
  // Sentence 1: keyword + volume + KD framing if present.
  const sentence1 = hasDifficulty
    ? `"${gap.targetKeyword}" sees ${volumeLabel} searches/mo at KD ${gap.difficulty} (${framing}).`
    : `"${gap.targetKeyword}" sees ${volumeLabel} searches/mo.`;

  // Sentence 2: GSC impressions proof of audience demand, OR competitor proof,
  // OR (when neither is present) a numeric restatement that pins the gap.
  let sentence2: string;
  if (hasImpressions && hasCompetitorProof) {
    const proof = (gap.competitorProof as string).replace(/\.$/, '');
    sentence2 =
      `Your site already shows ${fmtNum(gap.impressions as number)} impressions/mo for the term ` +
      `without a dedicated page, while ${proof}.`;
  } else if (hasImpressions) {
    sentence2 =
      `Your site already shows ${fmtNum(gap.impressions as number)} impressions/mo for the term ` +
      `without a dedicated page — proof of real demand from your audience.`;
  } else if (hasCompetitorProof) {
    // `competitorProof` is a full descriptive clause from the keyword-strategy
    // generator (e.g. "Plumber Pros ranks #2 for this term."), not a bare
    // noun. Splicing it into the subject position would produce garbled prose
    // ("Plumber Pros ranks #2 for this term. is capturing the 8.6k/mo..."),
    // so we wrap it as a parenthetical clause and put the action verb on a
    // sentence-level subject the reader controls. Devin caught this on
    // PR #380 — branch was untested because all unit fixtures set impressions.
    const proofClause = (gap.competitorProof as string).replace(/\.$/, '');
    sentence2 = `A competitor is already ranking for the term (${proofClause}), capturing the ${volumeLabel}/mo demand while your site has 0 impressions.`;
  } else {
    sentence2 = `Your site captures 0 of the ${volumeLabel} monthly searches today.`;
  }

  // Sentence 3: definite payoff, calibrated to KD framing when available.
  const sentence3 = hasDifficulty && (framing === 'low' || framing === 'medium')
    ? `A fresh page on this query has a clear path to top-5 within 90 days.`
    : `A fresh page on this query has a clear path to top-10 within 90 days.`;

  const narrative = `${sentence1} ${sentence2} ${sentence3}`;

  // Metrics — 2 badges. Difficulty badge only when present (>0).
  const metrics: BriefingStory['metrics'] = [
    { value: `${volumeLabel}/mo`, label: 'searches' },
  ];
  if (hasDifficulty && framing) {
    metrics.push({ value: `KD ${gap.difficulty}`, label: framing });
  }

  // Data receipt — built conditionally per spec §5 sample.
  const receiptParts: string[] = [];
  receiptParts.push(
    `Source: SEMrush volume ${volumeLabel}/mo${hasDifficulty ? ` · KD ${gap.difficulty} (${framing})` : ''}.`,
  );
  if (hasCompetitorProof) {
    // `competitorProof` is sometimes terminated, sometimes not — normalize with a period.
    const proof = (gap.competitorProof as string).replace(/\.$/, '');
    receiptParts.push(`${proof}.`);
  }
  if (hasImpressions) {
    receiptParts.push(
      `Your impressions for the term: ${fmtNum(gap.impressions as number)}/mo ` +
        `(you appear in rankings #50–100 occasionally).`,
    );
  }
  if (hasCPC) {
    // Position-3 CTR floor of 10.3% × monthly volume × CPC.
    const adSpendEquiv = Math.round((gap.volume as number) * 0.103 * (context.avgCPC as number));
    receiptParts.push(`≈ $${adSpendEquiv}/mo ad-spend equivalent at rank #3.`);
  }
  const dataReceipt = receiptParts.join(' ');

  // Stable id — slug the keyword. Dispatchers / dedup pipelines rely on this.
  const slug = gap.targetKeyword.replace(/\s+/g, '-');

  return {
    id: `story-gap-${slug}`,
    category: 'opportunity',
    isHeadline: false,
    headline,
    narrative,
    metrics,
    dataReceipt,
    drillIn: {
      page: 'strategy',
      queryParams: { gap: gap.targetKeyword },
    },
    sourceRefs: [{ type: 'recommendation', id: `gap-${gap.targetKeyword}` }],
  };
}
