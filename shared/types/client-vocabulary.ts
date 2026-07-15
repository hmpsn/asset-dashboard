// ── Client vocabulary (C2 / R12a) ───────────────────────────────────────────
//
// ONE canonical Record<ActionType, string> for client-facing outcome wording.
// Folds four maps that had DRIFTED into different wording for the same action:
//   - src/components/client/OutcomeSummary.tsx      (ACTION_TYPE_LABELS — short admin-ish nouns)
//   - src/components/client/Briefing/WinsSurface.tsx (ACTION_LABELS — full client sentences)
//   - server/routes/outcomes.ts                      (WIN_FALLBACK_LABELS — full client sentences)
//   - src/components/admin/outcomes/outcomeConstants.ts (admin-only; reads the action catalog,
//     NOT this module — admin wording intentionally stays short/noun-form, see that file)
//
// Modeled on the locked-copy pattern in src/components/client/the-issue/evergreenCopy.ts:
// a single source-of-truth module + a contract test that PINS the chosen strings so future
// drift fails loudly.
//
// WORDING RULE (owner pre-decided, applied here): where surfaces disagreed, this map prefers
// the fuller CLIENT-FACING sentence (WinsSurface's long-form style, e.g. "Replied to a Google
// Business Profile review") over admin nouns/short forms (e.g. "GBP reply", "Insight applied").
// No brand-new wording was invented — every value below is one of the pre-existing drifted
// variants (or, where all three client surfaces already agreed, that shared wording).
//
// Full per-action wording table (current vs. chosen) lives in the C2 PR description for
// owner review at prod promotion.

import type { ActionType } from './outcome-tracking.js';

/**
 * Canonical client-facing label for every ActionType. Read this from any client surface
 * that renders an outcome/win action type — do not hand-roll a parallel Record.
 *
 * `satisfies Record<ActionType, string>` makes a missing ActionType member a compile error,
 * matching the exhaustiveness discipline of OUTCOME_CATALOG.
 */
export const CLIENT_ACTION_LABELS = {
  insight_acted_on: 'Acted on a recommendation',
  content_published: 'Published new post',
  brief_created: 'Created content brief',
  strategy_keyword_added: 'Added keyword to strategy',
  schema_deployed: 'Added structured data',
  audit_fix_applied: 'Fixed audit issue',
  content_refreshed: 'Refreshed existing content',
  internal_link_added: 'Added internal links',
  meta_updated: 'Updated meta description',
  voice_calibrated: 'Calibrated brand voice',
  competitor_gap_closed: 'Closed a competitor keyword gap',
  cluster_published: 'Filled a topic cluster',
  cannibalization_resolved: 'Resolved keyword cannibalization',
  local_visibility_won: 'Won local pack visibility',
  local_service_added: 'Started targeting a local service',
  // Strategy redesign P2 pre-commit — managed-set keep markers (internal curation, never
  // recorded as a client-facing outcome; present only to keep this Record exhaustive).
  topic_cluster_keep: 'Prioritized a topic cluster',
  content_gap_keep: 'Prioritized a content opportunity',
  // Reconcile R8-PR1 (B13) — ships dark; see shared/types/outcome-tracking.ts.
  gbp_review_reply: 'Replied to a Google Business Profile review',
} as const satisfies Record<ActionType, string>;

/**
 * Look up the canonical client-facing label for an ActionType. Accepts `string` too so
 * callers with a loosely-typed/legacy value (e.g. a historical DB row) never crash — an
 * unrecognized value degrades to a humanized version of the raw string, never a raw
 * underscored enum leaking onto the client surface. NEVER throws and NEVER returns a blank
 * string — even a `null`/`undefined`/non-string value arriving through a less-typed JS
 * boundary resolves to a safe non-empty label.
 */
export function clientActionLabel(type: ActionType | string): string {
  return (CLIENT_ACTION_LABELS as Record<string, string>)[type] ?? humanizeActionType(type);
}

/**
 * snake_case → "snake case" fallback for an unrecognized action type. Hardened to be
 * total: coerces any input (incl. null/undefined/number arriving through an untyped
 * boundary) to a string, and falls back to a generic label rather than ever returning
 * an empty string. This is what makes `clientActionLabel`'s never-throws/never-blank
 * guarantee literally true for ALL inputs, not just today's typed call sites.
 */
function humanizeActionType(type: string): string {
  const s = String(type ?? '').replace(/_/g, ' ').trim();
  return s || 'Recent activity';
}
