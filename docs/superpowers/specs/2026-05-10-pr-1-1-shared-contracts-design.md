# PR 1.1 — Shared Contracts for IA Redesign

**Date:** 2026-05-10
**PR:** feat/ia-shared-contracts → staging
**Phase:** Phase 1 of Client IA Redesign
**Depends on:** PR 1.0a (merged), PR 1.0b (merged)
**Must merge before:** PR 1.2 (inbox restructure), PR 1.3 (wins surface), PR 1.4 (send-to-client convention)

---

## Goal

Establish the shared type contracts and feature flags that all subsequent Phase 1 PRs depend on.
No new UI. No DB migrations. Pure type/contract work + feature flag registration + route alias pre-update.

---

## Changes

### 1. AeoChangeDiff payload enrichment

**File:** `shared/types/client-actions.ts`

Add three optional fields to `AeoChangeDiff`:

```typescript
export interface AeoChangeDiff {
  page: string;
  section?: string;
  current: string;
  proposed: string;
  // Phase 1 enrichment — source: AeoPageChange fields mapped at send-time
  rationale?: string;              // "Why this change" — one sentence
  effort?: 'low' | 'medium' | 'high';  // mapped from AeoEffort
  priority?: 'high' | 'medium' | 'low'; // direct from AeoPageChange.priority
}
```

**AeoEffort → effort mapping:** `AeoPageChange.effort` is `AeoEffort` = `'quick' | 'moderate' | 'significant'`. Add a helper in `shared/types/client-actions.ts`:

```typescript
import type { AeoEffort } from './aeo.js';

export function mapAeoEffortToClientEffort(e: AeoEffort): 'low' | 'medium' | 'high' {
  if (e === 'quick') return 'low';
  if (e === 'significant') return 'high';
  return 'medium';
}
```

**File:** `src/components/AeoReview.tsx`

Update the `.map()` in `sendPageToClient()` (lines 157–164) to populate the new fields:

```typescript
diffs: (clientReadyPage.changes ?? []).map(c => ({
  page: clientReadyPage.pageTitle || clientReadyPage.pageUrl,
  section: c.location,
  current: c.currentContent ?? '',
  proposed: c.suggestedChange,
  rationale: c.rationale,
  effort: mapAeoEffortToClientEffort(c.effort),
  priority: c.priority,
})),
```

Import `mapAeoEffortToClientEffort` from `../../shared/types/client-actions.js`.

**No changes to `ClientActionDetailModal.tsx`** — the new fields are stored in the payload but not yet rendered client-side (Phase 2 concern per spec §5.3).

---

### 2. ClientRequestStatus derived type + mapping function

**File:** `shared/types/requests.ts`

Add after the existing `RequestStatus` type:

```typescript
export type ClientRequestStatus =
  | 'awaiting_team'  // admin: 'new', 'in_review' — no unread team note
  | 'in_progress'    // admin: 'in_progress', 'on_hold' — no unread team note
  | 'resolved'       // admin: 'completed', 'closed'
  | 'team_replied';  // any non-terminal status + last note author is 'team'

/**
 * Maps admin RequestStatus + notes array to the 4 client-visible states.
 * "team_replied" is inferred from last note author (no explicit unread tracking).
 * Priority: resolved > team_replied > in_progress > awaiting_team
 */
export function toClientRequestStatus(
  status: RequestStatus,
  notes: Pick<RequestNote, 'author'>[],
): ClientRequestStatus {
  if (status === 'completed' || status === 'closed') return 'resolved';
  const lastNote = notes[notes.length - 1];
  if (lastNote?.author === 'team') return 'team_replied';
  if (status === 'in_progress' || status === 'on_hold') return 'in_progress';
  return 'awaiting_team';
}
```

No DB changes — this is a pure derived type over existing data.

---

### 3. Feature flag registration

**File:** `shared/types/feature-flags.ts`

Add two new flags (default `false`) to the `FEATURE_FLAGS` const:

```typescript
// Client IA Redesign Phase 1 (PRs 1.2 + 1.3)
'new_inbox_ia': false,         // Gates PR 1.2 inbox restructure
'client_wins_surface': false,  // Gates PR 1.3 wins surface + "we called it" hide
```

Group them under a `// Client IA Redesign` comment near the end of the existing flags.

No server or DB changes — the `feature_flag_overrides` table already supports arbitrary keys.

---

### 4. Route alias pre-update

**File:** `src/routes.ts`

Update `CLIENT_INBOX_ALIASES` targets to match the new three-section IA that PR 1.2 will implement. Old URLs will redirect to these tab values once PR 1.2 lands; before PR 1.2, `InboxTab` falls back to `'all'` for unrecognized filter values (harmless):

```typescript
export const CLIENT_INBOX_ALIASES: Record<ClientInboxAlias, string> = {
  approvals: 'decisions',     // legacy /approvals → Decisions (approval batches)
  requests: 'conversations',  // legacy /requests → Conversations
  content: 'reviews',         // legacy /content → Reviews
};
```

No change to `ClientInboxAlias` type or `ClientTab` union — those are PR 1.2 concerns.

---

## Affected Files

| File | Change |
|------|--------|
| `shared/types/client-actions.ts` | Enrich `AeoChangeDiff` + add `mapAeoEffortToClientEffort` helper |
| `src/components/AeoReview.tsx` | Populate new fields at send-time |
| `shared/types/requests.ts` | Add `ClientRequestStatus` type + `toClientRequestStatus()` |
| `shared/types/feature-flags.ts` | Add `new_inbox_ia` + `client_wins_surface` |
| `src/routes.ts` | Update `CLIENT_INBOX_ALIASES` targets |

**Not changed:** No DB migrations. No new routes. No UI component changes beyond AeoReview.tsx send path.

---

## Out of Scope

- `ClientActionDetailModal.tsx` rendering of rationale/effort/priority (Phase 2)
- `InboxTab.tsx` restructure into Decisions/Reviews/Conversations (PR 1.2)
- `WinsSurface` component (PR 1.3)
- "We called it" feature-flag hide in `OverviewTab.tsx` (PR 1.3)
- Removal of old `InboxFilter` values (PR 1.2)
