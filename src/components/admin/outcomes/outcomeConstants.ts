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
// `outcome` context label is the ADMIN label; client-facing label maps
// (src/components/client/OutcomeSummary.tsx, WinsSurface.tsx) are NOT wired
// here and keep their own wording pending owner sign-off (C2/R12a).
// `Object.keys` typed via `as ActionType[]` is safe: ACTION_CATALOG.outcome is
// `satisfies Record<ActionType, ActionCatalogEntry>`, so its keys are exactly
// the ActionType union.
export const ACTION_TYPE_LABELS: Record<ActionType, string> = Object.fromEntries(
  (Object.keys(ACTION_CATALOG.outcome) as ActionType[]).map((type) => [
    type,
    getActionCatalogEntry('outcome', type)!.label,
  ]),
) as Record<ActionType, string>;
