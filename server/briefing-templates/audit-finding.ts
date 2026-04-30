// server/briefing-templates/audit-finding.ts
//
// Deterministic projection from a workspace-scope `audit_finding` analytics
// insight to a `BriefingStory`. Phase 2.5a — see
// docs/superpowers/specs/2026-04-29-client-insights-redesign-design.md §5
// for the voice contract this file enforces.
//
// VOICE CONTRACT (enforced by pr-check rule "Banned hedge words in briefing
// templates" scoped to server/briefing-templates/):
// - No hedge words: potentially / could / may / appears to / suggests /
//   might / seems.
// - Every sentence in the narrative cites a number from the typed payload.
// - Definite tense ("the audit recorded N issues"), never future-tense
//   speculation about what those issues may indicate.
//
// Eligibility: ONLY `data.scope === 'site'`. Page-level audit findings are
// too granular for the briefing — return null. The related `site_health`
// insight type carries `previousScore` directly; `audit_finding` does not,
// so this Phase 2.5a template renders WITHOUT scoreDelta (simplified per
// spec §5 — the catalog row marks audit_finding as "⚠️ Simplified").
//
// `issueMessages` is a semicolon-separated string today. Per spec §10,
// building a typed `categories: AuditCategory[]` field is a deferred
// cleanup — for now we best-effort split + slice and degrade gracefully
// when parsing yields nothing.

import type { AnalyticsInsight, AuditFindingData } from '../../shared/types/analytics.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

export interface TemplateContext {
  workspaceId: string;
  tier: 'free' | 'growth' | 'premium';
}

const RISK_ISSUE_THRESHOLD = 5;
const MAX_ISSUE_CATEGORIES = 3;

/**
 * Best-effort parse of the semicolon-delimited `issueMessages` string into
 * a short list of category labels. Returns at most MAX_ISSUE_CATEGORIES
 * trimmed, non-empty entries. Empty array signals "no parseable categories"
 * to the caller — narrative falls back to a generic count phrasing.
 */
function parseIssueCategories(issueMessages: string): string[] {
  return issueMessages
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_ISSUE_CATEGORIES);
}

export function buildStoryFromInsight(
  insight: AnalyticsInsight<'audit_finding'>,
  _context: TemplateContext,
): BriefingStory | null {
  const data = insight.data as AuditFindingData;

  // Eligibility: workspace-scope only. Page-level audit findings are too
  // granular for the weekly briefing.
  if (data.scope !== 'site') {
    return null;
  }

  // Required fields: degrade gracefully when any are missing.
  if (
    typeof data.issueCount !== 'number' ||
    typeof data.issueMessages !== 'string' ||
    typeof data.siteScore !== 'number'
  ) {
    return null;
  }

  const { siteScore, issueCount, issueMessages } = data;

  // Category: risk if many issues, otherwise framed as a period change.
  const category: BriefingStory['category'] =
    issueCount > RISK_ISSUE_THRESHOLD ? 'risk' : 'period_change';

  // Headline: definite, cites both numbers from the payload.
  const headline = `Site health score is ${siteScore}/100 with ${issueCount} issues to review.`;

  // Narrative: 2-3 sentences, every sentence carries a number, no hedges.
  const categories = parseIssueCategories(issueMessages);
  const sentence1 =
    `The latest audit recorded a site health score of ${siteScore}/100 ` +
    `across ${issueCount} site-wide ${issueCount === 1 ? 'issue' : 'issues'}.`;

  const sentence2 =
    categories.length > 0
      ? `Top categories flagged: ${categories.join(', ')}.`
      : `Findings span ${issueCount} site-wide ${issueCount === 1 ? 'issue' : 'issues'} with no single dominant category.`;

  const narrative = [sentence1, sentence2].join(' ');

  // Data receipt: anchor in the scheduled audit run + bridge source +
  // explicit note that issue categories were parsed from a delimited string
  // (so a downstream reader knows the parsing fidelity is best-effort).
  const dataReceipt =
    `Source: scheduled audit run. Bridge: ${data.source}. ` +
    `Issue messages: parsed from delimited string.`;

  return {
    id: `story-${insight.id}`,
    category,
    isHeadline: false,
    headline,
    narrative,
    metrics: [
      { value: `${siteScore}/100`, label: 'site score' },
      { value: `${issueCount} issues`, label: 'to review' },
    ],
    drillIn: { page: 'health' },
    sourceRefs: [{ type: 'analytics_insight', id: insight.id }],
    dataReceipt,
  };
}
