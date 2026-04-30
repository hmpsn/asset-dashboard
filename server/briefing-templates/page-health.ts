// server/briefing-templates/page-health.ts
//
// Deterministic projection from a `page_health` analytics insight to a
// `BriefingStory`. Phase 2.5a — see
// docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md §5
// for the voice contract this file enforces.
//
// SCOPE (per spec §5 type catalog):
//   `page_health` is **Watch List only**, never lead-eligible. CWV/LCP/INP
//   fields are deferred (no external instrumentation today), so this
//   template renders a score-based summary only — relying exclusively on
//   the typed `PageHealthData` payload (score, trend, clicks, optional
//   audit-derived enrichment).
//
// VOICE CONTRACT (enforced by pr-check rule "Banned hedge words in briefing
// templates" scoped to server/briefing-templates/):
// - No hedge words: potentially / could / may / appears to / suggests /
//   might / seems.
// - Every sentence in the narrative cites a number from the typed payload.
// - Definite tense, never future-tense speculation.
//
// Eligibility: only flag low-health pages whose trajectory is NOT already
// improving — `score < 60` AND `trend !== 'improving'`. A page that is
// already on the mend does not need to clutter this week's Watch List.

import type { AnalyticsInsight, PageHealthData } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

export interface TemplateContext {
  workspaceId: string;
  tier: 'free' | 'growth' | 'premium';
}

export function buildStoryFromInsight(
  insight: AnalyticsInsight<'page_health'>,
  _context: TemplateContext,
): BriefingStory | null {
  const data = insight.data as PageHealthData;

  // Required fields — degrade gracefully when any are missing.
  if (
    typeof data.score !== 'number' ||
    typeof data.trend !== 'string' ||
    typeof data.clicks !== 'number' ||
    typeof data.impressions !== 'number'
  ) {
    return null;
  }

  // Eligibility: only non-improving low-health pages surface here.
  if (data.score >= 60 || data.trend === 'improving') {
    return null;
  }

  const pageLabel = insight.pageTitle && insight.pageTitle.trim().length > 0
    ? insight.pageTitle.trim()
    : 'A page';

  const category: 'risk' | 'opportunity' = data.score < 40 ? 'risk' : 'opportunity';

  // Headline: definite tense, cites the score and trend.
  const headline = `${pageLabel} health: ${data.score}/100 — ${data.trend}.`;

  // Narrative: 2-3 sentences, every sentence cites a number from the payload.
  const sentence1 =
    `Health score sits at ${data.score}/100 with a ${data.trend} trajectory over the latest measurement window.`;

  const sentence2 =
    `The page draws ${data.clicks} clicks per month from ${data.impressions} impressions, so the drop affects live traffic.`;

  // Sentence 3 prefers topIssues; falls back to errorCount + warningCount.
  let sentence3 = '';
  const topIssues = Array.isArray(data.topIssues) ? data.topIssues.slice(0, 2) : [];
  if (topIssues.length > 0) {
    const issuesLabel = topIssues.length === 1 ? 'issue' : 'issues';
    sentence3 = `Top ${topIssues.length} ${issuesLabel} from the latest audit: ${topIssues.join('; ')}.`;
  } else if (
    typeof data.errorCount === 'number' &&
    typeof data.warningCount === 'number' &&
    (data.errorCount > 0 || data.warningCount > 0)
  ) {
    sentence3 = `The latest audit logged ${data.errorCount} errors and ${data.warningCount} warnings on the page.`;
  }

  const narrative = [sentence1, sentence2, sentence3].filter(Boolean).join(' ');

  // Metrics: 2 badges. Score is always shown; second badge prefers issue
  // counts when errorCount > 0, otherwise traffic-at-risk from clicks.
  const issuesBadgeEligible = typeof data.errorCount === 'number' && data.errorCount > 0;
  const secondMetric = issuesBadgeEligible
    ? {
        value: `${data.errorCount}E / ${typeof data.warningCount === 'number' ? data.warningCount : 0}W`,
        label: 'issues',
      }
    : {
        value: `${data.clicks}/mo`,
        label: 'traffic at risk',
      };

  const dataReceipt =
    `Source: page-level audit + GSC merge. Trend: ${data.trend}. ` +
    `Audit snapshot: ${data.auditSnapshotId ?? 'n/a'}.`;

  // drillIn.queryParams.page is only set when we have a pageId — omitted
  // entirely when missing so the receiving page doesn't try to filter on ''.
  const drillIn: BriefingStory['drillIn'] = insight.pageId
    ? { page: 'health', queryParams: { page: insight.pageId } }
    : { page: 'health' };

  return {
    id: `story-${insight.id}`,
    category,
    isHeadline: false, // page_health is Watch List only — never leads.
    headline,
    narrative,
    metrics: [
      { value: `${data.score}/100`, label: 'health' },
      secondMetric,
    ],
    drillIn,
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
    dataReceipt,
  };
}
