# B1 — Hub Cutover Blockers (audit #4)

> **Branch:** `claude/core-b1-hub-blockers`
> **Lane:** B (Keyword Hub)
> **Model:** Sonnet (implementation). **Reviewer:** Opus.
> **Flag gate:** `keyword-hub` (P5, staging-validation). Both fixes land DORMANT behind the existing flag — no flip.
> **Verified citations (branch head, 2026-06-10):**
>   - `KeywordActionMenu.tsx:90` — `onAction(a.type, a.disabledReason ? { force: true } : undefined)` ✓
>   - No add-keyword input anywhere in `KeywordHub.tsx` or `src/components/keyword-hub/*` ✓

---

## Scope (two fixes)

### Fix 1 — Protected-keyword force bypass (`KeywordActionMenu.tsx`)

**Bug:** When a lifecycle action has `disabledReason` set (meaning the keyword is protected — client-requested, strategy-owned, gap-sourced, or pinned), clicking the button silently calls `onAction` with `{ force: true }`, bypassing protection without any user confirmation.

**Fix:** Replace the silent force pass-through with a `<ConfirmDialog>` gate:
- A second `useState` tracks which protected action is pending (`pendingForceAction: KeywordCommandCenterNextAction | null`).
- Clicking a protected action sets `pendingForceAction`; dialog opens showing `a.disabledReason` as the message.
- Confirm → dispatches `onAction(a.type, { force: true })`; Cancel → dispatches nothing.
- Unprotected actions (no `disabledReason`) dispatch immediately, no dialog.
- The Delete confirm flow (`confirmOpen`) is UNCHANGED.

**Primitive:** `<ConfirmDialog>` from `src/components/ui/ConfirmDialog.tsx`. Props confirmed:
  - `open: boolean`
  - `title: string`
  - `message: string`
  - `confirmLabel?: string`
  - `cancelLabel?: string`
  - `onConfirm: () => void`
  - `onCancel: () => void`
  - `variant?: 'default' | 'destructive'`

**Color law:** protected action confirm button uses `variant="default"` (teal — action). Delete confirm uses `variant="destructive"` (red — irreversible). These are distinct dialogs.

---

### Fix 2 — Add-keyword input in Hub header (`KeywordHub.tsx`)

**Bug:** The Hub has no manual way to add a keyword. The legacy surface (`RankTracker.tsx`) had one.

**Fix:** Add an add-keyword input to the `PageHeader` `actions` region:
- Input value + handler via `useState` (local, not hub state — it's not a filter).
- On Enter or "Add" button click: trim, guard empty, call mutation → clear input on success.
- Mutation: add `useRankTrackingAddKeyword(workspaceId)` hook to `useKeywordCommandCenter.ts` (the existing `rankTracking.addKeyword` API wrapper; invalidates via `keywordMutationInvalidationKeys`).
- Error surfaced via the existing `actionErrorMessage` band (first error in `rowAction.error ?? hardDelete.error ?? localRefresh.error ?? bulkAction.error ?? addKeywordMutation.error`).
- Design: `FormInput` for the text field + `Button` size="sm" variant="primary" teal for "Add". Both are shared primitives; no hand-rolled button.

---

## Contracts

### `useRankTrackingAddKeyword(workspaceId: string)` (new export in `useKeywordCommandCenter.ts`)

```ts
// Returns a React Query mutation that calls rankTracking.addKeyword(wsId, { query })
// and on success invalidates keywordMutationInvalidationKeys(workspaceId).
function useRankTrackingAddKeyword(workspaceId: string): UseMutationResult<unknown, Error, string>
```

- Input: the raw keyword string (untrimmed — trimming at call site).
- Called at: `KeywordHub.tsx` header add handler; not called from anywhere else in this PR.
- **NOT a new endpoint.** Wraps `POST /api/rank-tracking/:workspaceId/keywords`.

---

## Test assertions (component tests — TDD, write RED first)

### File 1: `tests/component/keyword-command-center/KeywordActionMenu.b1.test.tsx`

1. **Protected action opens ConfirmDialog** — a row with `disabledReason` on a lifecycle action; clicking the button renders a `<dialog>` / role=`dialog` with the disabledReason text (message prop). `onAction` NOT yet called.
2. **Confirm dispatches with force:true** — after opening, click Confirm → `onAction` called with `(actionType, { force: true })`.
3. **Cancel dispatches nothing** — after opening, click Cancel → `onAction` NOT called.
4. **Unprotected action dispatches immediately** — action with no `disabledReason`; click → `onAction` called immediately with `(actionType, undefined)`. No dialog appears.
5. **Flag-off / existing behavior unchanged** — existing assertions from `KeywordActionMenu.test.tsx` must still pass (verified by test runner; not duplicated in the new file).

### File 2: `tests/component/KeywordHub.add-keyword.test.tsx`

1. **Add input is rendered** — `screen.getByLabelText('Add keyword')` (or `placeholder="Add keyword..."`) is present.
2. **Empty submit does nothing** — input empty, click Add → mutation NOT called.
3. **Submit with keyword calls mutation** — type " plumber austin ", click Add (or Enter) → mutation called with `"plumber austin"` (trimmed).
4. **Input clears on success** — after mutateAsync resolves, input value is `""`.
5. **Enter key triggers add** — `fireEvent.keyDown(input, { key: 'Enter' })` → mutation called.

---

## File ownership

**OWNS (modifies):**
- `src/components/keyword-command-center/KeywordActionMenu.tsx`
- `src/components/KeywordHub.tsx`
- `src/hooks/admin/useKeywordCommandCenter.ts` (adds `useRankTrackingAddKeyword`)
- `tests/component/keyword-command-center/KeywordActionMenu.b1.test.tsx` (new)
- `tests/component/KeywordHub.add-keyword.test.tsx` (new)
- `docs/superpowers/plans/2026-06-10-b1-hub-blockers.md` (this file)

**READS (must NOT modify):**
- `server/keyword-command-center.ts`
- `server/routes/keyword-command-center.ts`
- `shared/types/keyword-command-center.ts`
- `src/components/ui/ConfirmDialog.tsx`
- `src/api/seo.ts` (rankTracking.addKeyword)

---

## Quality gates

```
npm run typecheck
npx vite build
npx vitest run
npm run pr-check
npm run verify:feature-flags
grep -r "purple-" src/components/client/
```

No new feature flags — both fixes live entirely behind the existing `keyword-hub` flag (the Hub component is the gate; these subcomponents are never rendered when the flag is off).

---

## Verification

- `grep -r "purple-" src/components/client/` → clean (we don't touch client/).
- No new server routes — the add-keyword path reuses `POST /api/rank-tracking/:workspaceId/keywords`.
- No new flag entries — `verify:feature-flags` should pass unchanged.
- All Five Laws: FormInput + Button primitives used (no hand-rolled); teal for add action (primary); ConfirmDialog for protected gate.
