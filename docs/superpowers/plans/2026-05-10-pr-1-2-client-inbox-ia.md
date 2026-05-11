# PR 1.2 — Client Inbox IA Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the client Inbox into 3 client-shaped sections (Decisions, Reviews, Conversations) behind the `new-inbox-ia` feature flag, with note-based routing for approval_batches.

**Architecture:** All changes are client-side and feature-flagged. The `new-inbox-ia` flag (already in `shared/types/feature-flags.ts:75`, default `false`) gates the new layout — when off, existing 3-section layout renders unchanged. No backend changes; `batch.note` is already on the public API.

**Tech Stack:** React 19, TypeScript strict, Vite 8, TailwindCSS 4, React Router DOM 7

---

## File Map

| File | Task(s) | Change |
|------|---------|--------|
| `src/components/client/InboxTab.tsx` | 1, 3 | InboxFilter type + LEGACY_FILTER_MAP + 3-section layout + feature flag gate |
| `src/components/client/Briefing/ActionQueueStrip.tsx` | 2 | `?tab=seo-changes` → `?tab=decisions`, remove TODO comment |
| `src/components/client/RequestsTab.tsx` | 4 | Status display: 6 admin states → 4 client-visible labels |
| `scripts/pr-check.ts` | 5 | Extend `inbox-legacy-filter-literal` deny-list: add `needs-action`, `seo-changes`, `content` |

**Contract test** (`tests/contract/tab-deep-link-wiring.test.ts`): No changes needed — the test is regex-driven and will automatically verify that `ActionQueueStrip` sends `?tab=decisions` and that `'decisions'` exists in `InboxTab.tsx` once the code changes are in place.

---

## Task 1: Update InboxFilter Type + Constants (InboxTab.tsx)

**Model:** Haiku (mechanical type/constant update, 1 file)

**Files:**
- Modify: `src/components/client/InboxTab.tsx:26-68`

**Context:** `InboxTab.tsx` currently exports:
```typescript
// Line 26-27
export type InboxFilter = 'all' | 'needs-action' | 'seo-changes' | 'content';
export const INBOX_FILTER_VALUES: readonly InboxFilter[] =
  ['all', 'needs-action', 'seo-changes', 'content'] as const;
```

And the LEGACY_FILTER_MAP at lines 42-48 currently only maps old URL alias params (from PR 1.1):
```typescript
export const LEGACY_FILTER_MAP: Record<string, InboxFilter> = {
  approvals:       'decisions',
  requests:        'conversations',
  copy:            'reviews',
  'content-plan':  'decisions',
  completed:       'all',
};
```

- [ ] **Step 1: Replace InboxFilter type and INBOX_FILTER_VALUES**

Find lines 26-27 in `src/components/client/InboxTab.tsx` and replace:

```typescript
export type InboxFilter = 'all' | 'decisions' | 'reviews' | 'conversations';
export const INBOX_FILTER_VALUES: readonly InboxFilter[] =
  ['all', 'decisions', 'reviews', 'conversations'] as const;
```

- [ ] **Step 2: Extend LEGACY_FILTER_MAP to include old InboxFilter values**

Find the `LEGACY_FILTER_MAP` constant (around line 42) and replace with:

```typescript
export const LEGACY_FILTER_MAP: Record<string, InboxFilter> = {
  // old InboxFilter section names → new sections
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

- [ ] **Step 3: Fix the filter URL parsing to use updated LEGACY_FILTER_MAP**

The URL parsing at lines 120-129 uses `LEGACY_FILTER_MAP` to resolve old param values. Since the map now covers old InboxFilter values too, no logic change is needed — just verify the pattern still reads:
```typescript
const raw = searchParams.get('tab') ?? '';
const mapped = LEGACY_FILTER_MAP[raw];
const initial: InboxFilter = INBOX_FILTER_VALUES.includes(raw as InboxFilter)
  ? (raw as InboxFilter)
  : (mapped ?? 'all');
```
If it uses a different pattern, adapt to the same intent: resolve old values via LEGACY_FILTER_MAP.

- [ ] **Step 4: Fix any TypeScript errors caused by the type change**

The InboxFilter type changed from `'needs-action' | 'seo-changes' | 'content'` to `'decisions' | 'reviews' | 'conversations'`. Search for usages of the old literal values in the same file (e.g., `filter === 'seo-changes'`, `filter === 'needs-action'`, `filter === 'content'`) in the existing layout code and update them to the new values OR leave them as-is if they're inside the `else` branch (old layout, preserved). The key: the TypeScript compiler will flag any direct comparisons against the old string literals.

The existing layout uses `showSection1`, `showSection2`, `showSection3` variables derived from the filter — check their definitions and update the filter comparisons to the new values:
```typescript
// Old showSection1 might check: filter === 'all' || filter === 'needs-action'
// New: filter === 'all' || filter === 'decisions' (for the old section 1 content)
```

- [ ] **Step 5: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: zero errors. If there are errors about old filter literal comparisons, fix them in the same task.

- [ ] **Step 6: Commit**

```bash
git add src/components/client/InboxTab.tsx
git commit -m "feat(inbox): update InboxFilter type to decisions/reviews/conversations

INBOX_FILTER_VALUES now exports the 3 new client-shaped filter values.
LEGACY_FILTER_MAP extended to cover old filter literals (needs-action,
seo-changes, content) in addition to legacy URL alias params.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: ActionQueueStrip Escalation Pill Fix

**Model:** Haiku (single-line fix, 1 file)

**Files:**
- Modify: `src/components/client/Briefing/ActionQueueStrip.tsx:162-166`

**Context:** In PR 1.1, `ActionQueueStrip.tsx` was reverted from `?tab=decisions` back to `?tab=seo-changes` with a TODO comment pending PR 1.2. Now we apply the fix.

Lines to find (around 162-166):
```typescript
// TODO PR 1.2: update escalation pill to ?tab=decisions once InboxTab has that filter value
onClick={() => navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=seo-changes`)}
```

- [ ] **Step 1: Update the ?tab= value and remove the TODO comment**

Replace those 2 lines with:
```typescript
onClick={() => navigate(`${clientPath(workspaceId, 'inbox', betaMode)}?tab=decisions`)}
```

(Remove the TODO comment entirely — it's resolved by this task.)

- [ ] **Step 2: Run pr-check to confirm the old value is now flagged and gone**

```bash
npx tsx scripts/pr-check.ts
```

Expected: 0 errors. If `?tab=seo-changes` still appears anywhere else in `src/`, the pr-check rule will catch it (after Task 5 extends the deny list). This task is narrowly scoped to ActionQueueStrip.

- [ ] **Step 3: Run contract test to verify wiring**

```bash
npx vitest run tests/contract/tab-deep-link-wiring.test.ts
```

Expected: passes. The test will find ActionQueueStrip sending `?tab=decisions` and verify `'decisions'` exists in InboxTab.tsx (added in Task 1).

- [ ] **Step 4: Commit**

```bash
git add src/components/client/Briefing/ActionQueueStrip.tsx
git commit -m "feat(inbox): update ActionQueueStrip escalation pill to ?tab=decisions

Resolves TODO from PR 1.1 — now that InboxTab exports 'decisions' in
INBOX_FILTER_VALUES, the two-halves tab-deep-link contract is satisfied.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: New 3-Section Layout Behind Feature Flag + PriorityStrip Removal

**Model:** Sonnet (multi-section layout, conditional rendering, data splits — requires reading component logic)

**Files:**
- Modify: `src/components/client/InboxTab.tsx` (the main implementation task)

**Context — current InboxTab structure:**

InboxTab.tsx has this high-level structure (all line numbers approximate):
```
imports (1-35)
type/constants (26-68)
component props interface (55-70)
component function start + state (100-180)
derived data + counts (181-260)
filter chip array + render start (260-370)
PriorityStrip mount (363-374) ← REMOVE this
Section 1: "Needs Action & Requests" (376-543)
Section 2: "SEO Changes" (546-615)
Section 3: "Content" (619-653)
completed mode / history (660+)
```

**Section 2 "SEO Changes" contains:**
- `<ApprovalsTab workspaceId approvalBatches approvalsLoading ...>` — receives all batches
- Schema plan card (inline JSX with `schemaPlan` data + `setSchemaModalOpen`)

**Section 3 "Content" contains:**
- `<ClientCopyReview workspaceId>` (gated by `hasCopyEntries`)
- `<ContentTab contentRequests ... workspaceId ...>`

**Props already available on InboxTab:** `approvalBatches`, `approvalsLoading`, `clientActions`, `pendingApprovals`, `setApprovalBatches`, `loadApprovals`, `effectiveTier`, `pageMap`, `setToast`, `workspaceId`, `schemaPlan`, `schemaPlanPending`, `setSchemaModalOpen`.

Requests data is fetched inside InboxTab via `useClientRequests` hook — `requests`, `requestsLoading` are already local state.

- [ ] **Step 1: Add useFeatureFlag import**

Find the import block in `InboxTab.tsx`. Add:
```typescript
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
```
Place it with the other local imports. Do NOT add it mid-file — add it at the top with existing imports.

- [ ] **Step 2: Add the feature flag hook call inside the component**

Find where other hooks are called (near the top of the component function, after state declarations). Add:
```typescript
const newInboxIa = useFeatureFlag('new-inbox-ia');
```

- [ ] **Step 3: Compute note-based batch splits**

After the existing derived data section (where `batchesWithNote` / `batchesWithoutNote` don't yet exist), add:

```typescript
// Note-based routing: batches WITH note → Conversations; WITHOUT note → Decisions
const batchesWithNote = approvalBatches.filter(b => b.note);
const batchesWithoutNote = approvalBatches.filter(b => !b.note);
```

- [ ] **Step 4: Compute counts for the new filter chips**

```typescript
// Chip counts (only used when newInboxIa is true)
const decisionsCount =
  batchesWithoutNote.filter(b => b.items.some(i => i.status === 'pending' || !i.status)).length +
  clientActions.filter(a => !a.clientNote && (a.status === 'pending' || !a.status)).length;
const reviewsCount = (contentReviews ?? 0) + (copyReviewCount ?? 0);
const conversationsCount =
  requests.filter(r => r.status !== 'completed' && r.status !== 'closed').length +
  batchesWithNote.length;
```

(Use existing variable names — `contentReviews`, `copyReviewCount` are already computed. Adapt if the actual variable names differ.)

- [ ] **Step 5: Remove PriorityStrip from InboxTab JSX**

Find and delete the PriorityStrip mount block (around line 363):
```tsx
{/* ── Priority strip (active mode only) ── */}
{mode === 'active' && (
  <PriorityStrip
    items={priorityItems}
    showAllCaughtUp={
      !approvalsLoading && !requestsLoading &&
      !schemaPlanQuery.isLoading &&
      priorityItems.length === 0
    }
  />
)}
```

Also remove the `PriorityStrip` and `PriorityItem` imports at lines 16-17:
```typescript
import { PriorityStrip } from './PriorityStrip';
import type { PriorityItem } from './PriorityStrip';
```

Keep `PriorityStrip.tsx` itself — only remove it from InboxTab.

Also remove any prop computation that feeds ONLY PriorityStrip (e.g. `priorityItems` array construction and `schemaPlanQuery`). If `schemaPlanQuery` or `priorityItems` are used elsewhere in the component, keep them.

- [ ] **Step 6: Add the new filter chips array (for newInboxIa path)**

The existing filter chips at around line 175 use old InboxFilter values. The new chips will be computed inside the conditional render. Define a `newFilterChips` array to be used in the new layout:

```typescript
const newFilterChips: { id: InboxFilter; label: string; count?: number }[] = [
  { id: 'all', label: 'All' },
  { id: 'decisions', label: 'Decisions', count: decisionsCount || undefined },
  { id: 'reviews', label: 'Reviews', count: reviewsCount || undefined },
  { id: 'conversations', label: 'Conversations', count: conversationsCount || undefined },
];
```

- [ ] **Step 7: Wrap the existing layout in `else` and add new layout under `if (newInboxIa)`**

Find the part of the render that outputs the filter chips + sections (after the top-level wrapper/header, before the footer/modal). Wrap it:

```tsx
{newInboxIa ? (
  <>
    {/* ── New filter chips ── */}
    <div className="flex gap-2 flex-wrap">
      {newFilterChips.map(chip => (
        <button
          key={chip.id}
          type="button"
          onClick={() => setFilter(chip.id)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-pill)] t-caption-sm font-medium border transition-colors ${
            filter === chip.id
              ? 'bg-teal-500/15 border-teal-500/30 text-accent-brand'
              : 'bg-[var(--surface-2)] border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'
          }`}
        >
          {chip.label}
          {chip.count != null && chip.count > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-[var(--radius-pill)] bg-amber-500/20 text-accent-warning t-caption-sm font-semibold">
              {chip.count}
            </span>
          )}
        </button>
      ))}
    </div>

    {/* ── Section: Decisions ── */}
    {(filter === 'all' || filter === 'decisions') && (
      <section aria-label="Decisions" className="space-y-4">
        <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">
          Decisions
          {decisionsCount > 0 && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-amber-500/15 text-accent-warning border border-amber-500/30">
              {decisionsCount} pending
            </span>
          )}
        </h3>
        {/* Approval batches WITHOUT note */}
        <ApprovalsTab
          workspaceId={workspaceId}
          approvalBatches={batchesWithoutNote}
          approvalsLoading={approvalsLoading}
          pendingApprovals={pendingApprovals}
          effectiveTier={effectiveTier}
          setApprovalBatches={setApprovalBatches}
          loadApprovals={loadApprovals}
          setToast={setToast}
          pageMap={pageMap}
        />
        {/* Client actions WITHOUT clientNote — keep existing client_action card JSX from section 1 */}
        {/* (copy the client_action rendering from old Section 1, filter to actionsWithoutNote) */}
      </section>
    )}

    {/* ── Section: Reviews ── */}
    {(filter === 'all' || filter === 'reviews') && (
      <section aria-label="Reviews" className="space-y-4">
        <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">
          Reviews
          {reviewsCount > 0 && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-blue-500/15 text-accent-info border border-blue-500/30">
              {reviewsCount} needs review
            </span>
          )}
        </h3>
        {/* Schema plan card (moved from SEO Changes) */}
        {schemaPlan && (
          <div className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Icon as={Shield} size="sm" className="text-accent-brand" />
                  <span className="t-caption-sm font-medium text-accent-brand">Schema Strategy</span>
                  {schemaPlanPending && (
                    <span className="t-caption-sm font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-amber-500/15 text-accent-warning border border-amber-500/30">Ready for review</span>
                  )}
                </div>
                <h4 className="t-ui font-medium text-[var(--brand-text-bright)]">
                  Schema strategy — {schemaPlan.pageRoles.length} page{schemaPlan.pageRoles.length !== 1 ? 's' : ''}
                </h4>
                <p className="t-caption text-[var(--brand-text-muted)] mt-0.5">
                  {schemaPlanPending
                    ? 'Your schema strategy is ready for your review and approval.'
                    : schemaPlan.status === 'client_approved' ? 'Approved — implementation in progress.'
                    : schemaPlan.status === 'active' ? 'Active schema strategy.'
                    : 'Schema strategy on file.'}
                </p>
              </div>
              <Button size="sm" variant={schemaPlanPending ? 'primary' : 'ghost'} onClick={() => setSchemaModalOpen(true)}>
                Review schema plan →
              </Button>
            </div>
          </div>
        )}
        {/* Copy review */}
        {hasCopyEntries && (
          <div className="space-y-2">
            <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Copy Review</p>
            <ClientCopyReview workspaceId={workspaceId} />
          </div>
        )}
        {/* Content pipeline */}
        <div className="space-y-2">
          <p className="t-caption-sm text-[var(--brand-text-muted)] uppercase font-semibold tracking-wider">Pipeline</p>
          <ContentTab
            contentRequests={contentRequests}
            setContentRequests={setContentRequests}
            effectiveTier={effectiveTier}
            briefPrice={briefPrice}
            fullPostPrice={fullPostPrice}
            fmtPrice={fmtPrice}
            setPricingModal={setPricingModal}
            pricingConfirming={pricingConfirming}
            workspaceId={workspaceId}
            setToast={setToast}
            hidePrices={hidePrices}
          />
        </div>
      </section>
    )}

    {/* ── Section: Conversations ── */}
    {(filter === 'all' || filter === 'conversations') && (
      <section aria-label="Conversations" className="space-y-4">
        <h3 className="t-ui font-semibold text-[var(--brand-text-bright)]">
          Conversations
          {conversationsCount > 0 && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium bg-blue-500/15 text-accent-info border border-blue-500/30">
              {conversationsCount} active
            </span>
          )}
        </h3>
        {/* Approval batches WITH note — simple card + link to detail view */}
        {batchesWithNote.map(batch => (
          <div key={batch.id} className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="t-ui font-medium text-[var(--brand-text-bright)] mb-1">{batch.title}</p>
                {batch.note && (
                  <p className="t-caption text-[var(--brand-text-muted)] line-clamp-2">{batch.note}</p>
                )}
              </div>
            </div>
          </div>
        ))}
        {/* Requests */}
        <RequestsTab
          workspaceId={workspaceId}
          requests={requests}
          requestsLoading={requestsLoading}
          setToast={setToast}
        />
      </section>
    )}
  </>
) : (
  <>
    {/* ── EXISTING LAYOUT (flag off) — do NOT modify this block ── */}
    {/* existing filter chips + Section 1 + Section 2 + Section 3 JSX goes here unchanged */}
  </>
)}
```

**CRITICAL:** The `else` block must contain the EXACT EXISTING JSX for filter chips, Section 1, Section 2, and Section 3 — copy it verbatim. Do not modify the existing layout code. Only wrap it in the `else` branch.

**Note on RequestsTab props:** Check `RequestsTab.tsx` props interface and pass exactly what it expects. The current InboxTab already renders RequestsTab in Section 1 — use the same prop set.

**Note on client_actions in Decisions:** The old Section 1 renders client_actions (aeo_change, internal_link, redirect_proposal, content_decay). In the new Decisions section, include the same JSX but filter to `clientActions.filter(a => !a.clientNote)`. The actionsWithNote go to Conversations (not in scope for this PR — leave actionsWithNote out of UI for now per spec "No backend changes needed" note).

- [ ] **Step 8: Verify typecheck and build**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors and successful build. Fix any prop mismatches.

- [ ] **Step 9: Verify full test suite and pr-check**

```bash
npx vitest run && npx tsx scripts/pr-check.ts
```

Expected: all tests pass, 0 pr-check errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/client/InboxTab.tsx
git commit -m "feat(inbox): 3-section layout behind new-inbox-ia feature flag

Decisions/Reviews/Conversations sections with note-based batch routing.
PriorityStrip removed from InboxTab JSX. Existing layout preserved in
else branch when flag is off.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: RequestsTab Status Mapping (6 → 4 Client-Visible Labels)

**Model:** Haiku (add 1 helper function + update 2 display sites, 1 file)

**Files:**
- Modify: `src/components/client/RequestsTab.tsx`

**Context:** The current status display (around lines 202-210) uses an inline `statusLabels` Record:
```typescript
const statusLabels: Record<string, string> = {
  new: 'New', in_review: 'In Review', in_progress: 'In Progress',
  on_hold: 'On Hold', completed: 'Completed', closed: 'Closed',
};
```

And the status badge renders: `{statusLabels[req.status] || req.status}`.

The new labels map 6 admin states to 4 client-visible states, with the last note's author taking priority.

- [ ] **Step 1: Add clientStatusLabel helper above the component function**

Find the imports section of `RequestsTab.tsx`. After the imports and before the component function, add:

```typescript
function clientStatusLabel(status: string, notes: Pick<RequestNote, 'author'>[]): string {
  const lastNote = notes[notes.length - 1];
  if (lastNote?.author === 'team') return 'Team replied';
  switch (status) {
    case 'new':
    case 'in_review':   return 'Awaiting team';
    case 'in_progress': return 'In progress';
    case 'on_hold':     return 'In progress';
    case 'completed':
    case 'closed':      return 'Resolved';
    default:            return 'Awaiting team';
  }
}
```

Note: `RequestNote` is already imported/defined in this file — the `Pick<RequestNote, 'author'>[]` type matches what `req.notes` provides.

- [ ] **Step 2: Update the statusLabels inline Record**

The existing `statusLabels` Record is inside the `.map()` callback. Replace:
```typescript
const statusLabels: Record<string, string> = {
  new: 'New', in_review: 'In Review', in_progress: 'In Progress',
  on_hold: 'On Hold', completed: 'Completed', closed: 'Closed',
};
```

Remove this line entirely. The badge render below will use the helper instead.

- [ ] **Step 3: Update the status badge text to use clientStatusLabel**

Find the badge render (around line 223):
```tsx
{statusLabels[req.status] || req.status}
```

Replace with:
```tsx
{clientStatusLabel(req.status, req.notes)}
```

- [ ] **Step 4: Update statusColors to match the 4 client-visible state groups**

The `statusColors` Record maps status values to CSS classes. Update it to group by the new 4 labels:
```typescript
const statusColors: Record<string, string> = {
  // Awaiting team
  new:         'bg-blue-500/10 border-blue-500/30 text-accent-info',
  in_review:   'bg-blue-500/10 border-blue-500/30 text-accent-info',
  // In progress
  in_progress: 'bg-teal-500/10 border-teal-500/30 text-accent-brand',
  on_hold:     'bg-teal-500/10 border-teal-500/30 text-accent-brand',
  // Resolved
  completed:   'bg-emerald-500/10 border-emerald-500/30 text-accent-success',
  closed:      'bg-emerald-500/10 border-emerald-500/30 text-accent-success',
};
```

If the last note is from 'team', the status badge will show "Team replied" but the color should remain the same (based on `req.status`) — this is fine since we don't change the color logic, only the label text.

- [ ] **Step 5: Add on_hold sub-note display**

The spec requires: when a note with `author: 'team'` includes the phrase "on hold", display a sub-note below the status badge.

After the status badge `<span>`, add:
```tsx
{req.status === 'on_hold' && req.notes.some(n => n.author === 'team' && n.content?.toLowerCase().includes('on hold')) && (
  <span className="t-caption-sm text-[var(--brand-text-muted)] block mt-0.5">
    {req.notes.filter(n => n.author === 'team' && n.content?.toLowerCase().includes('on hold')).at(-1)?.content}
  </span>
)}
```

- [ ] **Step 6: Verify typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/client/RequestsTab.tsx
git commit -m "feat(inbox): map 6 admin request states to 4 client-visible labels

clientStatusLabel() maps new/in_review→'Awaiting team', in_progress/on_hold→
'In progress', completed/closed→'Resolved', team-last-note→'Team replied'.
On-hold sub-note displayed when team note contains 'on hold'.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Extend pr-check inbox-legacy-filter-literal Rule

**Model:** Haiku (regex extension in 1 file)

**Files:**
- Modify: `scripts/pr-check.ts` (the `inbox-legacy-filter-literal` rule at lines 5105-5148)

**Context:** The current deny-list regex:
```typescript
const legacyRe = /[?&]tab=(approvals|requests|content-plan|copy)(?=['"`& ]|$)/;
```

This flags old URL alias params from before PR 1.1. PR 1.2 also retires the old InboxFilter section names (`needs-action`, `seo-changes`, `content`) — those are now disallowed as `?tab=` values in `src/`.

The current comment in the rule also incorrectly describes the mapping direction (it says "approvals→seo-changes" reflecting the OLD state, not the current state after PR 1.1+1.2).

- [ ] **Step 1: Extend the legacyRe to include old InboxFilter values**

Find the `customCheck` function inside the `inbox-legacy-filter-literal` rule. Locate:
```typescript
const legacyRe = /[?&]tab=(approvals|requests|content-plan|copy)(?=['"`& ]|$)/;
```

Replace with:
```typescript
const legacyRe = /[?&]tab=(approvals|requests|content-plan|copy|needs-action|seo-changes|content)(?=['"`& ]|$)/;
```

- [ ] **Step 2: Update the rule's name comment and message to reflect current state**

Update the comment at the top of the rule:
```typescript
// Flags old InboxFilter string literals and legacy URL alias params retired in the 2026-05-08
// inbox redesign (PR 1.1) and the 2026-05-10 inbox IA restructure (PR 1.2).
// Denied values: approvals, requests, content-plan, copy, needs-action, seo-changes, content
// Allowed values: decisions, reviews, conversations (new client-shaped sections)
```

Update the `message` field:
```typescript
message:
  "Old inbox filter value — update to new InboxFilter value (decisions, reviews, or conversations). See 2026-05-10 inbox IA restructure. Add // inbox-legacy-filter-literal-ok if intentional.",
```

Update the `rationale` field:
```typescript
rationale:
  "Prevents re-introduction of retired InboxFilter literals after the inbox IA restructure (PR 1.2). Denied: approvals, requests, content-plan, copy, needs-action, seo-changes, content.",
```

- [ ] **Step 3: Run pr-check to confirm the rule works**

```bash
npx tsx scripts/pr-check.ts
```

Expected: 0 errors. The `?tab=seo-changes` that was in `ActionQueueStrip.tsx` was already fixed in Task 2. No other sources of old literals should remain in `src/`.

If there are hits, either fix the remaining occurrences or add `// inbox-legacy-filter-literal-ok` comments where the occurrence is intentional (e.g., in documentation/comments).

- [ ] **Step 4: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "chore(pr-check): extend inbox-legacy-filter-literal to deny needs-action, seo-changes, content

Extended deny-list regex covers all 7 retired inbox filter values:
approvals, requests, content-plan, copy, needs-action, seo-changes, content.
Updated message and rationale to reflect PR 1.2 scope.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final Verification

After all tasks are complete:

- [ ] **Full quality gate:**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Expected:
- `typecheck`: 0 errors
- `vite build`: success
- `vitest run`: all tests pass (contract test in `tests/contract/tab-deep-link-wiring.test.ts` passes, including the new `?tab=decisions` sender assertion)
- `pr-check`: 0 errors

- [ ] **Manual checklist:**

- [ ] `InboxFilter` type is `'all' | 'decisions' | 'reviews' | 'conversations'`
- [ ] Old filter values (`needs-action`, `seo-changes`, `content`) are in `LEGACY_FILTER_MAP`
- [ ] Behind `new-inbox-ia` flag: 3 sections render correctly; existing layout unchanged when flag is off
- [ ] `batch.note` presence correctly splits batches between Decisions and Conversations
- [ ] ActionQueueStrip escalation pill sends `?tab=decisions`
- [ ] `RequestsTab` shows 4 client-visible status labels
- [ ] `PriorityStrip` removed from InboxTab JSX
- [ ] pr-check rule flags `?tab=seo-changes` and `?tab=needs-action`
- [ ] Tab-deep-link-wiring contract test passes
