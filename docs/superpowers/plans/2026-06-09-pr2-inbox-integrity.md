# PR 2 — Inbox Integrity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, single-agent) + `requesting-code-review` before PR. Contract+test-centric per docs/PLAN_WRITING_GUIDE.md: contracts and test assertions locked here; implementation written at execution time against real code. Per task: READ real code → failing test (run, confirm red for the right reason) → minimal implementation → green + typecheck → commit. If real code contradicts a contract, STOP that item and record it in the PR body.

**Goal:** Close the two confirmed inbox data-flow defects (orphaned deliverable mirror on batch delete; missing `DELIVERABLE_*` broadcasts at the mirror seams), sync the legacy respond path's mirror, add the two missing client-side event handlers, and correct the stale "dark/flag-gated" module docs that caused the gaps.

**Branch:** `claude/audit-pr2-inbox-integrity` off `origin/staging` (`d4e2c070`). **Base PR:** `staging`.

**Owning bounded context:** inbox domain (`server/domains/inbox/`); secondary: client data-flow wiring (`src/lib/wsInvalidation.ts`, `src/components/ClientDashboard.tsx`). All behavior corrections, no schema changes, no new flags, no new event names (all events already exist in `server/ws-events.ts`).

**Verified facts this plan relies on (re-checked against `d4e2c070`):**
- `deleteApprovalBatchForClient` (`server/domains/inbox/approval-batch-admin-mutations.ts:84-125`) never touches the mirror; the store (`server/client-deliverables.ts`) has no cancel — but `cancelSchemaPlanDeliverable` (`server/domains/inbox/schema-plan-dual-write.ts:162-199`) is the proven cancel template (`upsertDeliverable` with `status: 'cancelled'` + `DELIVERABLE_UPDATED` broadcast).
- `mirrorApprovalBatchToDeliverable` (3 callers: approvals send, content-plan ×2) and `mirrorClientActionToDeliverable` never broadcast; UnifiedInbox already subscribes to `DELIVERABLE_SENT`/`DELIVERABLE_UPDATED` and `clientUnifiedInboxInvalidationKeys` already maps them — server-side broadcasts complete the loop, no frontend inbox change needed.
- Legacy respond services (`approval-batch-respond.ts`, `approval-batch-item-respond.ts`) are driven by BOTH the legacy public routes AND the unified `respondToSource` propagation — mirror sync added there must be **idempotent** (no-op when the unified path already moved the mirror).
- No delete path exists for client actions or work orders (grep verified) — the orphan fix is approval-batch-only; record this scope note in the PR body.
- Briefing mirrors are born `completed`/`notification` and never client-facing (verifier) — briefing seam excluded.

---

## Task Dependencies

```
Task 1 (mirror-sync + cancel helpers in approval-batch-dual-write.ts)
  → Task 2 (call cancel from delete; fix orphan-asserting unit test)
  → Task 3 (legacy respond mirror sync, batch + per-item)
Task 4 (DELIVERABLE_SENT broadcasts at mirror creation seams)  — parallel-safe with 2/3 but same file as Task 1 → run after Task 1
Task 5 (INSIGHT_RESOLVED + CONTENT_PUBLISHED client handlers)  — independent files, any order
Task 6 (stale dual-write doc headers)                          — last (describes the post-fix reality)
```
Model: orchestrator-inline (Sonnet-tier equivalent); reviewer Opus-tier.

---

## Task 1 — Shared mirror status-sync + cancel helpers

**Files:** Modify `server/domains/inbox/approval-batch-dual-write.ts`. Test: new `tests/unit/approval-batch-mirror-sync.test.ts` (or extend the existing dual-write test file if one exists — check `rg -l 'mirrorApprovalBatchToDeliverable' tests/`).

**Contracts:**
1. `syncApprovalBatchDeliverableStatus(workspaceId: string, batch: ApprovalBatch): ClientDeliverable | null` — resolves type via `classifyApprovalBatch`, sourceRef via the adapter, `findBySourceRef`; maps batch status → deliverable status (`approved→approved`, `rejected→changes_requested`, `partial→partial`, `pending`/unknown → no-op null); **no-op when the mirror already has the target status** (idempotency vs the unified respond path); validates the move with the deliverable transition map (`getDeliverableTransitions` / `validateTransition` — read `server/state-machines.ts:149-215` for the real API) and skips+logs an illegal move instead of throwing; preserves all other fields exactly like the `cancelSchemaPlanDeliverable` template; sets `decidedAt` (preserve existing) when moving to a decided status; carries the client note into `clientResponseNote` when provided; broadcasts `DELIVERABLE_UPDATED {deliverableId, type, status}` on a real move; best-effort try/catch (never throws into the caller).
2. `cancelApprovalBatchDeliverable(workspaceId: string, batch: ApprovalBatch): ClientDeliverable | null` — same lookup; `status: 'cancelled'`; broadcast `DELIVERABLE_UPDATED`; null when no mirror; never throws.
3. Both exported for Tasks 2–3; no other module re-implements this lookup ("cross-PR contract": future mirror families reuse this shape).

**Test assertions:** seeded workspace + mirrored batch (use existing test fixtures/factories — check `tests/fixtures/` and how `tests/unit/approval-batch-admin-mutations.test.ts` builds batches): (a) sync with batch status `approved` moves mirror `awaiting_client → approved` and broadcasts `DELIVERABLE_UPDATED`; (b) second sync with same status is a no-op (no second broadcast); (c) batch `rejected` → mirror `changes_requested`; (d) cancel moves to `cancelled` and broadcasts; (e) no mirror row → both return null without throwing.

## Task 2 — Cancel the mirror on batch delete

**Files:** Modify `server/domains/inbox/approval-batch-admin-mutations.ts` (`deleteApprovalBatchForClient`). Modify `tests/unit/approval-batch-admin-mutations.test.ts` — the verifier reported it currently **asserts the orphaning behavior**; replace that assertion with the cancellation contract.

**Contracts:**
1. `deleteApprovalBatchForClient` calls `cancelApprovalBatchDeliverable(workspaceId, batch)` after the legacy delete succeeds (batch was read before delete — pass the pre-delete `batch`).
2. `'cancelled'` is excluded from `CLIENT_FACING_STATUSES` (`server/domains/inbox/unified-inbox-read.ts:52-58` — verify, don't change), so the card leaves the client inbox on the already-subscribed `DELIVERABLE_UPDATED`.

**Test assertions:** after send (mirror exists, `awaiting_client`) then `deleteApprovalBatchForClient`: mirror status === `'cancelled'`; `DELIVERABLE_UPDATED` broadcast fired; legacy behavior (batch deleted, page states cleared, `APPROVAL_UPDATE {action:'deleted'}`) unchanged.

## Task 3 — Legacy respond paths sync the mirror

**Files:** Modify `server/domains/inbox/approval-batch-respond.ts` and `server/domains/inbox/approval-batch-item-respond.ts`. Test: extend Task 1's test file or the existing respond tests (`rg -l 'respondToApprovalBatch' tests/`).

**Contracts:**
1. After the transaction commits and side effects fire, both services call `syncApprovalBatchDeliverableStatus(workspaceId, updatedBatch)` (best-effort — a sync failure must not fail the respond).
2. Idempotency: when the unified `respondToDeliverable` path drove the respond (mirror already moved), the sync is a no-op — asserted by test.
3. The missing-batch path keeps returning null exactly as today (the orphan-response hazard dies with Task 2, since cancelled mirrors are no longer respondable from the inbox — verify `respondToDeliverable` transition-guards `cancelled` and note the result in the PR body).

**Test assertions:** (a) drive `respondToApprovalBatch` directly (legacy-route shape) on a mirrored batch → mirror status follows the batch (`approved` / `changes_requested`); (b) drive the per-item service to a partial state → mirror `partial`; (c) pre-move the mirror to `approved` (simulating the unified path) then respond → no duplicate broadcast/no status churn.

## Task 4 — Broadcast DELIVERABLE_SENT at mirror creation

**Files:** Modify `server/domains/inbox/approval-batch-dual-write.ts` (`mirrorApprovalBatchToDeliverable`) and `server/domains/inbox/client-action-dual-write.ts` (`mirrorClientActionToDeliverable` — READ it first; same shape assumed, verify). Test: extend the dual-write tests; check `tests/integration/broadcast-handler-pairs.test.ts` still passes (DELIVERABLE_SENT already has frontend handlers).

**Contracts:**
1. On successful mirror creation, broadcast `WS_EVENTS.DELIVERABLE_SENT {deliverableId, type, status}` from inside the mirror function (single seam covers all three approval-batch callers + the client-action seam) — matching `schema-plan-admin-mutations.ts:97-102` payload shape (READ it to confirm fields).
2. No broadcast on skipped/failed mirror.
3. The legacy `APPROVAL_UPDATE` / `CLIENT_ACTION_UPDATE` broadcasts at the callers are unchanged (legacy surfaces still consume them).

**Test assertions:** mirror creation fires exactly one `DELIVERABLE_SENT` with the deliverable id; adapter-rejected (empty) batch fires none.

## Task 5 — Client-side handlers for INSIGHT_RESOLVED and CONTENT_PUBLISHED

**Files:** Modify `src/lib/wsInvalidation.ts` (`clientDashboardInvalidationKeys`) and `src/components/ClientDashboard.tsx` (subscription map). Test: extend the existing wsInvalidation unit tests (`rg -l 'clientDashboardInvalidationKeys' tests/`).

**Contracts:**
1. `INSIGHT_RESOLVED` → client keys for insights (mirror the key set the admin scope already lists for client: `queryKeys.client.clientInsights` etc. — READ `src/lib/wsInvalidation.ts:250-256` and reuse, don't guess key names).
2. `CONTENT_PUBLISHED` → `[contentPlan, roi, postPreviewAll, activity]` client keys (verify each key exists in `src/lib/queryKeys.ts` — no typo'd keys; the audit's exact list is a starting point, the file is authoritative).
3. Both events added to ClientDashboard's `useWorkspaceEvents` subscription map (NOT `useGlobalAdminEvents`).
4. `tests/integration/broadcast-handler-pairs.test.ts` exception lists: if these events appear in an "admin-only handler" exception list, remove them from it in the same commit.

**Test assertions:** invalidation-key unit test: `clientDashboardInvalidationKeys(INSIGHT_RESOLVED, ws)` returns the client insight keys; `(CONTENT_PUBLISHED, ws)` returns the four keys; both subscribed in ClientDashboard (the existing wiring tests' pattern — follow whatever mechanism pins other events).

## Task 6 — Correct stale dual-write module docs

**Files:** `server/domains/inbox/unified-inbox-read.ts` (:22-24 "table is empty until cutover" claim), `server/domains/inbox/approval-batch-dual-write.ts` (header: "We do NOT mirror on the public approve / apply / per-item paths" — now false after Task 3; "flag reader" import claim), `server/domains/inbox/client-action-dual-write.ts` (:25 flag-reader claim), `server/domains/inbox/client-actions-mutations.ts` (:87-91 "DARK ... flag ... default off" comment).

**Contract:** each header describes the post-PR reality: mirrors run unconditionally on send; respond/apply/delete sync the mirror; no feature flag exists. Doc-only — no behavior. Commit together with no code changes so the diff is reviewable.

---

## Systemic Improvements
- New tests: mirror-sync idempotency suite, cancel-on-delete (replacing an assertion that pinned the bug), DELIVERABLE_SENT broadcast pins, client invalidation-key cases.
- Shared utility: `syncApprovalBatchDeliverableStatus` / `cancelApprovalBatchDeliverable` — the canonical mirror-lifecycle helpers future families copy.
- pr-check rules: none here (delete-side mirror sync rule is a candidate noted in the audit; revisit after PR 6 deletes the legacy components).
- Feature-class gates: bug-fix class — full suite + typecheck + build + pr-check; no FEATURE_AUDIT/roadmap/BRAND_DESIGN entries (no UI change).

## Verification Strategy
- [ ] `npx vitest run tests/unit/approval-batch-mirror-sync.test.ts tests/unit/approval-batch-admin-mutations.test.ts` + the respond/dual-write/wsInvalidation files touched
- [ ] `npx vitest run tests/integration/broadcast-handler-pairs.test.ts` — pairing meta-test green with the new broadcasts
- [ ] Full suite, typecheck, `npx vite build`, `npm run pr-check`, `verify:feature-flags`, `verify:coverage-ratchet`
- [ ] `superpowers:requesting-code-review` — fix all surfaced issues in-PR
