// ── outcomeNoun — shared eventConfig outcome-noun helpers ────────────────────────
//
// Promotes the inline `eventDisplayName` / `isEventPinned` helpers that lived in
// ClientDashboard.tsx into one module both ClientDashboard and the Lane B verdict/
// outcome-count components consume. Behavior is byte-identical to the verified inline
// originals — a custom displayName wins only when it differs from the raw eventName;
// otherwise the eventName is de-underscored for display; the pinned flag falls back to
// false. Keeping the logic in one place prevents the outcome noun from drifting between
// the admin-facing config surface and the client-facing verdict.

import type { EventDisplayConfig } from '../../../../shared/types/workspace';

/**
 * Human label for a GA4 event: the admin's custom `displayName` when it differs from the
 * raw event name, otherwise the de-underscored event name (`generate_lead` → `generate lead`).
 */
export function eventDisplayName(config: EventDisplayConfig[] | undefined, eventName: string): string {
  const cfg = config?.find((c) => c.eventName === eventName);
  return cfg?.displayName && cfg.displayName !== eventName ? cfg.displayName : eventName.replace(/_/g, ' ');
}

/** True when the admin pinned this event as a true conversion; false for unknown/unpinned events. */
export function isEventPinned(config: EventDisplayConfig[] | undefined, eventName: string): boolean {
  return config?.find((c) => c.eventName === eventName)?.pinned || false;
}

/**
 * The pinned events as `{ eventName, label }` pairs — the verdict/outcome-count source of truth.
 * Returns [] for an undefined config so Lane B can render the admin-nudge-to-pin thin state on `.length === 0`.
 */
export function pinnedOutcomeNouns(
  config: EventDisplayConfig[] | undefined,
): { eventName: string; label: string }[] {
  if (!config) return [];
  return config
    .filter((c) => c.pinned)
    .map((c) => ({ eventName: c.eventName, label: eventDisplayName(config, c.eventName) }));
}
