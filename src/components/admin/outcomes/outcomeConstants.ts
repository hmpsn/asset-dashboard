// src/components/admin/outcomes/outcomeConstants.ts
// Shared display constants for outcome components

import type { ActionType } from '../../../../shared/types/outcome-tracking';
import { ACTION_CATALOG, getActionCatalogEntry } from '../../../../shared/types/action-catalog';

/** Format ISO date to "Mar 29, 2026" */
export function formatOutcomeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Format a 0-1 decimal as a percentage string, e.g. 0.73 → "73%" */
export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// R5-PR2 (B9): admin-facing action labels now read the action catalog
// (shared/types/action-catalog.ts) instead of carrying a second, independently
// maintained Record<ActionType, string>. This is admin-only — the catalog's
// `outcome` context label is the ADMIN label (short noun-form, e.g. "Insight
// Acted On"). C2/R12a folded the three CLIENT-facing label maps
// (src/components/client/OutcomeSummary.tsx, WinsSurface.tsx,
// server/routes/outcomes.ts) into shared/types/client-vocabulary.ts, which
// intentionally carries different (fuller-sentence) wording — the admin map
// here is NOT re-pointed at it by design; admin and client surfaces are allowed
// to disagree on tone (admin = internal ops nouns, client = narrative sentences).
// `Object.keys` typed via `as ActionType[]` is safe: ACTION_CATALOG.outcome is
// `satisfies Record<ActionType, ActionCatalogEntry>`, so its keys are exactly
// the ActionType union.
export const ACTION_TYPE_LABELS: Record<ActionType, string> = Object.fromEntries(
  (Object.keys(ACTION_CATALOG.outcome) as ActionType[]).map((type) => [
    type,
    getActionCatalogEntry('outcome', type)!.label,
  ]),
) as Record<ActionType, string>;
