// server/briefing-templates/competitor-alert.ts
//
// Deterministic projection from a `competitor_alert` analytics insight to a
// `BriefingStory`. Phase 2.5a — see
// docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md §5
// for the voice contract this file enforces.
//
// COMPETITOR ALERTS NEVER LEAD (spec §5, type catalog row
// `competitor_alert`). Every story produced here is `isHeadline: false` and
// is intended for the Watch List section of the briefing only. The dispatcher
// must not promote competitor alerts to the hero slot.
//
// VOICE CONTRACT (enforced by pr-check rule "Banned hedge words in briefing
// templates" scoped to server/briefing-templates/):
// - No hedge words: potentially / could / may / appears to / suggests /
//   might / seems.
// - Every sentence in the narrative cites a number or specific name from
//   the typed payload.
// - Definite tense ("moved up to #4", "started ranking for"), never
//   future-tense speculation about what the competitor "could" do.
//
// ELIGIBILITY: only materially specific alerts surface. The four `alertType`
// branches each have their own required-field set — see `buildStoryFromInsight`
// below. A `keyword_gained` alert without a keyword, or an `authority_change`
// alert without a positionChange magnitude, returns null.

import type { AnalyticsInsight, CompetitorAlertData } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';
import { fmtNum } from './_helpers.js';
import type { TemplateContext } from './index.js';

/* TemplateContext imported from ./index.js — see Phase 2.5a review */

export function buildStoryFromInsight(
  insight: AnalyticsInsight<'competitor_alert'>,
  _context: TemplateContext,
): BriefingStory | null {
  const data = insight.data as CompetitorAlertData;

  // Hard requirement across every alertType: we name a specific competitor.
  // A nameless competitor alert is the exact "vague competitive noise" the
  // Phase 2 voice failure produced — refuse to render it.
  if (!data.competitorDomain || data.competitorDomain.trim().length === 0) {
    return null;
  }

  const competitorDomain = data.competitorDomain.trim();
  const keyword = typeof data.keyword === 'string' ? data.keyword.trim() : '';
  const hasKeyword = keyword.length > 0;
  const hasPrev = typeof data.previousPosition === 'number';
  const hasCurr = typeof data.currentPosition === 'number';
  const hasVolume = typeof data.volume === 'number' && data.volume > 0;

  let headline: string;
  let narrative: string;
  const metrics: BriefingStory['metrics'] = [];

  switch (data.alertType) {
    case 'keyword_gained': {
      // Require keyword AND at least one position anchor.
      if (!hasKeyword || (!hasPrev && !hasCurr)) return null;

      headline = hasCurr
        ? `${competitorDomain} just moved up to #${data.currentPosition} for "${keyword}".`
        : `${competitorDomain} just gained ground on "${keyword}".`;

      const positionMovementSentence =
        hasPrev && hasCurr
          ? `${competitorDomain} rose from #${data.previousPosition} to #${data.currentPosition} on "${keyword}" in this week's snapshot.`
          : hasCurr
            ? `${competitorDomain} now ranks #${data.currentPosition} on "${keyword}" in this week's snapshot.`
            : `${competitorDomain} previously ranked #${data.previousPosition} on "${keyword}" before this week's gain.`;

      const volumeSentence = hasVolume
        ? `The keyword sees ${fmtNum(data.volume!)} searches/mo, snapshot dated ${data.snapshotDate}.`
        : `Snapshot dated ${data.snapshotDate}.`;

      narrative = `${positionMovementSentence} ${volumeSentence}`;

      const positionMetricValue =
        hasPrev && hasCurr
          ? `#${data.previousPosition} → #${data.currentPosition}`
          : hasCurr
            ? `#${data.currentPosition}`
            : `#${data.previousPosition}`;
      metrics.push({ value: positionMetricValue, label: competitorDomain });
      if (hasVolume) {
        metrics.push({ value: `${fmtNum(data.volume!)}/mo`, label: 'volume' });
      }
      break;
    }

    case 'keyword_lost': {
      // Require keyword AND at least one position anchor.
      if (!hasKeyword || (!hasPrev && !hasCurr)) return null;

      headline = hasPrev
        ? `${competitorDomain} dropped from #${data.previousPosition} on "${keyword}".`
        : `${competitorDomain} lost ground on "${keyword}".`;

      const movementSentence =
        hasPrev && hasCurr
          ? `${competitorDomain} fell from #${data.previousPosition} to #${data.currentPosition} on "${keyword}" in this week's snapshot.`
          : hasPrev
            ? `${competitorDomain} previously ranked #${data.previousPosition} on "${keyword}" and fell out of view in this week's snapshot.`
            : `${competitorDomain} now ranks #${data.currentPosition} on "${keyword}" after losing position this week.`;

      const volumeSentence = hasVolume
        ? `The keyword sees ${fmtNum(data.volume!)} searches/mo, snapshot dated ${data.snapshotDate}.`
        : `Snapshot dated ${data.snapshotDate}.`;

      narrative = `${movementSentence} ${volumeSentence}`;

      const positionMetricValue =
        hasPrev && hasCurr
          ? `#${data.previousPosition} → #${data.currentPosition}`
          : hasPrev
            ? `#${data.previousPosition}`
            : `#${data.currentPosition}`;
      metrics.push({ value: positionMetricValue, label: competitorDomain });
      if (hasVolume) {
        metrics.push({ value: `${fmtNum(data.volume!)}/mo`, label: 'volume' });
      }
      break;
    }

    case 'new_keyword': {
      // Require keyword.
      if (!hasKeyword) return null;

      headline = `${competitorDomain} started ranking for "${keyword}".`;

      const rankSentence = hasCurr
        ? `${competitorDomain} entered the SERP for "${keyword}" at #${data.currentPosition} in this week's snapshot.`
        : `${competitorDomain} entered the SERP for "${keyword}" in this week's snapshot.`;

      const volumeSentence = hasVolume
        ? `The keyword sees ${fmtNum(data.volume!)} searches/mo, snapshot dated ${data.snapshotDate}.`
        : `Snapshot dated ${data.snapshotDate}.`;

      narrative = `${rankSentence} ${volumeSentence}`;

      metrics.push({ value: `"${keyword}"`, label: 'new ranking' });
      if (hasVolume) {
        metrics.push({ value: `${fmtNum(data.volume!)}/mo`, label: 'volume' });
      }
      break;
    }

    case 'authority_change': {
      // Require positionChange magnitude.
      if (typeof data.positionChange !== 'number' || data.positionChange === 0) {
        return null;
      }

      const change = data.positionChange;
      const changeStr = change > 0 ? `+${change}` : `${change}`;
      const direction = change > 0 ? 'rose' : 'fell';
      const magnitude = Math.abs(change);

      headline = `${competitorDomain}'s overall authority shifted by ${changeStr}.`;

      narrative =
        `${competitorDomain}'s overall authority ${direction} by ${magnitude} ` +
        `in this week's snapshot dated ${data.snapshotDate}. ` +
        `The shift affects every keyword we track against ${competitorDomain}.`;

      metrics.push({ value: changeStr, label: `${competitorDomain} authority` });
      break;
    }

    default: {
      // Unknown alertType — refuse to render rather than improvise.
      return null;
    }
  }

  const dataReceipt =
    `Source: weekly competitor monitoring (Monday cron). ` +
    `Snapshot: ${data.snapshotDate}. Type: ${data.alertType}.`;

  return {
    id: `story-${insight.id}`,
    category: 'competitive',
    // NEVER lead — spec §5 type catalog: competitor_alert is `Never lead`.
    // The dispatcher relies on this flag to keep competitor alerts in the
    // Watch List section.
    isHeadline: false,
    leadEligible: false,
    headline,
    narrative,
    metrics,
    drillIn: {
      // No specific page — lands on Strategy where the client can review the
      // broader competitive context.
      page: 'strategy',
    },
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
    dataReceipt,
  };
}
