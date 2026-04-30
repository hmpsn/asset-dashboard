// server/briefing-templates/we-called-it.ts
//
// Deterministic projection from a `TrackedAction` + its most-recent
// `strong_win` `ActionOutcome` to a `BriefingStory`. Phase 2.5c —
// "We Called It" story type. See
// docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md §6
// for the spec sample and voice contract this file enforces.
//
// VOICE CONTRACT (enforced by pr-check rule "Banned hedge words in briefing
// templates" scoped to server/briefing-templates/):
// - No hedge words: potentially / could / may / appears to / suggests /
//   might / seems.
// - Every sentence in the narrative cites a number or date from the typed
//   payload.
// - Definite tense ("the prediction landed", "ranking #4"), never
//   future-tense speculation.
//
// TRUST PLAY: this story proves the agency's picks pay off. Headline and
// narrative must reference the concrete page or keyword that was predicted,
// the recorded prediction date, and the measured outcome metric.

import type { TrackedAction, ActionOutcome } from '../../shared/types/outcome-tracking.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import type { TemplateContext } from './index.js';
import { fmtShortDateUTC } from './_helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WeCalledItInput {
  action: TrackedAction;
  /** The most-recent outcome whose `score === 'strong_win'`. */
  outcome: ActionOutcome;
}

/**
 * Build a "We Called It" `BriefingStory` from a tracked action and its
 * `strong_win` outcome. This is a TRUST PLAY — the agency proving its picks
 * pay off.
 *
 * Returns `null` when:
 * - `outcome.score !== 'strong_win'` — defensive guard; the collector
 *   should already filter, but the template owns its eligibility check.
 * - The action has neither a `pageUrl` nor a `targetKeyword` — nothing
 *   concrete to anchor the story on.
 */
export function buildStoryFromWeCalledIt(
  input: WeCalledItInput,
  _context: TemplateContext,
): BriefingStory | null {
  const { action, outcome } = input;

  // --- Eligibility guards ---
  if (outcome.score !== 'strong_win') return null;
  if (!action.pageUrl && !action.targetKeyword) return null;

  // --- Date arithmetic ---
  const predictedMs = Date.parse(action.createdAt);
  const measuredMs = Date.parse(outcome.measuredAt);

  const predictedDate = Number.isFinite(predictedMs) ? fmtShortDateUTC(action.createdAt) : '';
  const measuredDate = Number.isFinite(measuredMs) ? fmtShortDateUTC(outcome.measuredAt) : '';

  const daysToDeliver =
    Number.isFinite(predictedMs) && Number.isFinite(measuredMs)
      ? Math.floor((measuredMs - predictedMs) / DAY_MS)
      : null;

  // --- Anchor: prefer pageUrl, fall back to targetKeyword ---
  const anchor = action.pageUrl ?? action.targetKeyword ?? '';

  // --- Primary metric from delta summary ---
  const delta = outcome.deltaSummary;
  const primaryMetric = delta.primary_metric;
  const currentValue = delta.current_value;
  const deltaAbsolute = delta.delta_absolute;
  const deltaPercent = Math.round(delta.delta_percent);
  const deltaSign = deltaAbsolute >= 0 ? '+' : '';

  // --- Action-type-aware verb for headline ---
  // Maps the ActionType discriminator to a short phrase describing the
  // agency's intervention so the headline reads naturally for each variant.
  function interventionLabel(actionType: TrackedAction['actionType']): string {
    switch (actionType) {
      case 'brief_created':
        return 'the brief we delivered';
      case 'content_refreshed':
        return 'the content refresh we executed';
      case 'meta_updated':
        return 'the metadata update we made';
      case 'schema_deployed':
        return 'the schema we deployed';
      case 'audit_fix_applied':
        return 'the audit fix we applied';
      case 'internal_link_added':
        return 'the internal links we added';
      case 'insight_acted_on':
        return 'the recommendation we acted on';
      case 'content_published':
        return 'the content we published';
      case 'strategy_keyword_added':
        return 'the keyword strategy we set';
      case 'voice_calibrated':
        return 'the voice calibration we completed';
      default:
        return 'the action we took';
    }
  }

  // --- Headline (5-12 words) ---
  // Reference the concrete anchor (page or keyword). Definite tense.
  const headlineAnchor = action.targetKeyword
    ? `"${action.targetKeyword}"`
    : action.pageUrl ?? anchor;
  const headline = `The call we made on ${headlineAnchor} just paid off.`;

  // --- Narrative (2-3 sentences, every sentence carries a number) ---
  const interventionPhrase = interventionLabel(action.actionType);

  let narrative: string;

  if (action.pageUrl && action.targetKeyword) {
    // Both page and keyword available — richest variant.
    narrative =
      `The prediction recorded on ${predictedDate} landed. ` +
      `${action.pageUrl} reached ${currentValue} ${primaryMetric} for ` +
      `"${action.targetKeyword}" — a ${deltaSign}${deltaAbsolute} (${deltaSign}${deltaPercent}%) change from baseline. ` +
      `${interventionPhrase} on ${predictedDate} was the trigger.`;
  } else if (action.pageUrl) {
    // Page-only variant — cite metric on the page.
    narrative =
      `The prediction recorded on ${predictedDate} landed. ` +
      `${action.pageUrl} delivered ${currentValue} ${primaryMetric} — ` +
      `${deltaSign}${deltaAbsolute} (${deltaSign}${deltaPercent}%) above the baseline we set when ${interventionPhrase} was recorded.`;
  } else {
    // Keyword-only variant.
    narrative =
      `The prediction recorded on ${predictedDate} landed. ` +
      `"${action.targetKeyword ?? ''}" reached ${currentValue} ${primaryMetric} — ` +
      `${deltaSign}${deltaAbsolute} (${deltaSign}${deltaPercent}%) above the baseline captured when ${interventionPhrase} was recorded.`;
  }

  // --- Metrics (value must be string) ---
  const metricsArr: BriefingStory['metrics'] = [
    { value: predictedDate || action.createdAt.slice(0, 10), label: 'predicted' },
    {
      value: daysToDeliver !== null ? `${daysToDeliver} days` : `${outcome.checkpointDays} days`,
      label: 'to deliver',
    },
  ];

  // --- Data receipt ---
  const scheduleLabel =
    daysToDeliver !== null ? `${daysToDeliver} days, ahead of schedule` : `within ${outcome.checkpointDays}-day window`;
  const dataReceipt =
    `Original prediction recorded ${predictedDate || action.createdAt.slice(0, 10)}. ` +
    `First crossed ${measuredDate || outcome.measuredAt.slice(0, 10)} — ${scheduleLabel}.`;

  // --- Drill-in ---
  const drillIn: BriefingStory['drillIn'] = {
    page: 'performance',
    queryParams: action.pageUrl ? { page: action.pageUrl } : undefined,
  };

  return {
    id: `wci-${action.id}`,
    category: 'win',
    isHeadline: false,        // hero-promotion happens in the cron, not here
    leadEligible: true,        // weCalledIt is hero-eligible per spec
    headline,
    narrative,
    metrics: metricsArr,
    drillIn,
    sourceRefs: [{ type: 'analytics_insight', id: action.id }],
    dataReceipt,
  };
}
