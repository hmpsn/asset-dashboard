# PR 1.2 — Client Inbox IA Restructure

**Date:** 2026-05-10
**PR:** feat/client-inbox-ia → staging
**Phase:** Phase 1 of Client IA Redesign
**Depends on:** PR 1.1 ✅ (shared contracts), PR 1.4 ✅ (send-to-client note convention)
**Parallel-safe with:** PR 1.3

---

## Goal

Restructure the client Inbox from 4 admin-shaped sections ("Needs Action & Requests", "SEO Changes", "Content") to 3 client-shaped sections (Decisions, Reviews, Conversations), behind the `new-inbox-ia` feature flag. Wire the note-based routing rule: approval_batches and client_actions with an attached note route to Conversations; without a note, they route to Decisions.

---

## What This PR Does NOT Include

- Trust-first `<DecisionPrimitive>` modal shell (Phase 2 — existing `ClientActionDetailModal` and `ApprovalsTab` UX is preserved for now)
- `ContentPlanTab` routing changes (complex discriminator: topic cells → Decisions, brief cells → Reviews — Phase 2)
- `ClientActionDetailModal` major rewrite (Phase 2)
- Status simplification for `RequestsTab` (6 → 4 client-visible states) — included as a simple mapping change (§5.6)
- `SchemaPlanPanel` → Reviews re-routing (deferred; requires its own API endpoint update)

---

## Affected Files

| File | Change |
|------|--------|
| `src/components/client/InboxTab.tsx` | New `InboxFilter` type + 3-section layout + routing logic + feature flag gate |
| `src/components/client/Briefing/ActionQueueStrip.tsx` | Escalation pill `?tab=seo-changes` → `?tab=decisions` (remove TODO comment) |
| `src/components/client/RequestsTab.tsx` | Status display: map 6 admin states → 4 client-visible labels |
| `scripts/pr-check.ts` | Update `inbox-legacy-filter-literal` rule: add `seo-changes`, `needs-action`, `content` to deny list; add `decisions`, `reviews`, `conversations` to allow list |
| `tests/contract/tab-deep-link-wiring.test.ts` | Add contract assertions for new filter values |

---

## 1. InboxFilter Type Change

**Current** (`InboxTab.tsx:26`):
```typescript
export type InboxFilter = 'all' | 'needs-action' | 'seo-changes' | 'content';
export const INBOX_FILTER_VALUES: readonly InboxFilter[] =
  ['all', 'needs-action', 'seo-changes', 'content'] as const;
```

**New:**
```typescript
export type InboxFilter = 'all' | 'decisions' | 'reviews' | 'conversations';
export const INBOX_FILTER_VALUES: readonly InboxFilter[] =
  ['all', 'decisions', 'reviews', 'conversations'] as const;
```

**LEGACY_FILTER_MAP** (`InboxTab.tsx:42-48`) — extend to cover old values:
```typescript
export const LEGACY_FILTER_MAP: Record<string, InboxFilter> = {
  // old section names → new sections
  'needs-action':  'decisions',
  'seo-changes':   'decisions',
  'content':       'reviews',
  // legacy URL alias params (from CLIENT_INBOX_ALIASES in routes.ts)
  approvals:       'decisions',
  requests:        'conversations',
  copy:            'reviews',
  'content-plan':  'decisions',
  completed:       'all',
};
```

---

## 2. InboxTab 3-Section Layout

The new layout has three section slots. Each section renders when `filter === 'all' || filter === <section>`. Behind the `new-inbox-ia` feature flag; when flag is off the existing 3-section layout is unchanged.

### Filter Chips

Replace the existing 4 chips:
```typescript
const filterChips: { id: InboxFilter; label: string; count?: number }[] = [
  { id: 'all', label: 'All' },
  { id: 'decisions', label: 'Decisions', count: decisionsCount },
  { id: 'reviews', label: 'Reviews', count: reviewsCount },
  { id: 'conversations', label: 'Conversations', count: conversationsCount },
];
```

Counts:
- `decisionsCount` = pending approval_batches (no note) + pending client_actions (no clientNote)
- `reviewsCount` = existing section 3 count (content briefs + posts + copy sections)
- `conversationsCount` = unanswered requests + approval_batches with note

### Section: Decisions

Renders when `filter === 'all' || filter === 'decisions'`.

Content (from existing sections):
- **Approval batches without note** — rendered by `<ApprovalsTab>` filtered to `batch.note == null`
- **Client action cards** — `aeo_change`, `internal_link`, `redirect_proposal`, `content_decay` client_actions **without** `clientNote`

Both sub-sections already exist in the current InboxTab sections 1 and 2. PR 1.2 moves them under the Decisions heading and filters by note absence.

### Section: Reviews

Renders when `filter === 'all' || filter === 'reviews'`.

Content (from existing section 3):
- `<ContentTab>` (briefs, posts, copy review) — unchanged
- `<SchemaReviewTab>` (already exists) — moved here from "SEO Changes"

### Section: Conversations

Renders when `filter === 'all' || filter === 'conversations'`.

Content:
- **`<RequestsTab>`** — existing requests component; status labels mapped to 4 client-visible states (§5 below)
- **Approval batches WITH note** — rendered in a simple card: batch title, `batch.note` as the opener message, then a link to the full `ApprovalsTab` detail view

---

## 3. Note-Based Routing Rule

At render time (client-side), split `approvalBatches` by note presence:

```typescript
const batchesWithNote = approvalBatches.filter(b => b.note);
const batchesWithoutNote = approvalBatches.filter(b => !b.note);
```

Pass `batchesWithoutNote` to Decisions, `batchesWithNote` to Conversations.

Similarly for `clientActions` (already have `clientNote` field from PR 1.1):
```typescript
const actionsWithNote = clientActions.filter(a => a.clientNote);
const actionsWithoutNote = clientActions.filter(a => !a.clientNote);
```

`actionsWithNote` go to Conversations; `actionsWithoutNote` go to Decisions.

**No backend changes needed** — `batch.note` is already returned by the public API (confirmed by audit). `clientNote` is already on the `ClientAction` type (PR 1.1).

---

## 4. ActionQueueStrip Fix

**File:** `src/components/client/Briefing/ActionQueueStrip.tsx:166`

Change:
```typescript
// Before
onClick={() => navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=seo-changes`)}
```
```typescript
// After
onClick={() => navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=decisions`)}
```

Remove the TODO comment on line 162. This is gated by whether `INBOX_FILTER_VALUES` includes `'decisions'` — the tab-deep-link-wiring contract test will enforce it.

---

## 5. PriorityStrip Removal from InboxTab

Per §5.6 of the main spec, the in-Inbox `PriorityStrip` is removed. The Insights page `ActionQueueStrip` is retained.

In `InboxTab.tsx`, remove the `<PriorityStrip>` mount (find and delete the JSX element and any prop computation that feeds it). Keep the `PriorityStrip.tsx` file itself.

---

## 6. RequestsTab Status Mapping (§3.5 Rule 6)

Map 6 admin states → 4 client-visible labels in `RequestsTab.tsx`:

```typescript
function clientStatusLabel(status: string, notes: RequestNote[]): string {
  const lastNote = notes[notes.length - 1];
  if (lastNote?.author === 'team') return 'Team replied';
  switch (status) {
    case 'new':
    case 'in_review':     return 'Awaiting team';
    case 'in_progress':   return 'In progress';
    case 'on_hold':       return 'In progress'; // sub-note added separately
    case 'completed':
    case 'closed':        return 'Resolved';
    default:              return 'Awaiting team';
  }
}
```

The `on_hold` sub-note ("on hold — waiting on X") is surfaced only when a note with `author: 'team'` includes the phrase "on hold" — display it as a `t-caption-sm text-[var(--brand-text-muted)]` line below the status badge.

---

## 7. pr-check Rule Update

**Rule `inbox-legacy-filter-literal`** (`scripts/pr-check.ts:5125`):

Currently flags: `?tab=approvals`, `?tab=requests`, `?tab=content-plan`, `?tab=copy`

Update to ALSO flag old InboxFilter literals:
- Add: `?tab=needs-action`, `?tab=seo-changes`, `?tab=content`

Update allow-list / regex to permit new values:
- `?tab=decisions`, `?tab=reviews`, `?tab=conversations`

---

## 8. Feature Flag Wiring

The `new-inbox-ia` flag (already in `shared/types/feature-flags.ts:75`, default `false`) gates the new 3-section layout. When `false`, the existing InboxTab layout is rendered unchanged.

Pattern in InboxTab.tsx:
```typescript
const newInboxIa = useFeatureFlag('new-inbox-ia');
// ...
if (newInboxIa) {
  // new 3-section layout
} else {
  // existing layout (unchanged JSX)
}
```

Use `<FeatureFlag flag="new-inbox-ia">` component or the `useFeatureFlag` hook (whichever is the codebase pattern).

---

## 9. Contract Test

`tests/contract/tab-deep-link-wiring.test.ts` must be updated to include the new filter values. The test asserts that every `?tab=X` sender has X in the receiver's `INBOX_FILTER_VALUES`. Add:
- Sender: `ActionQueueStrip` → `?tab=decisions`
- Receiver: `InboxTab.tsx` `INBOX_FILTER_VALUES` includes `'decisions'`

---

## Acceptance Criteria

- [ ] `InboxFilter` type is `'all' | 'decisions' | 'reviews' | 'conversations'`
- [ ] Old filter values (`needs-action`, `seo-changes`, `content`) are in `LEGACY_FILTER_MAP` → map to new values
- [ ] Behind `new-inbox-ia` flag: 3 sections render correctly; existing layout unchanged when flag is off
- [ ] `batch.note` presence correctly splits batches between Decisions and Conversations
- [ ] ActionQueueStrip escalation pill sends `?tab=decisions`
- [ ] `RequestsTab` shows 4 client-visible status labels
- [ ] `PriorityStrip` removed from InboxTab JSX
- [ ] pr-check rule updated; `?tab=seo-changes` and `?tab=needs-action` are now flagged
- [ ] Tab-deep-link-wiring contract test passes
- [ ] `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts` — all green
