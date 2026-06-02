# Unified Send-to-Client — Cutover Runbook

**Date:** 2026-06-01
**Audience:** owner/operator performing the production cutover. **This is the owner-gated step.** The autonomous build delivered everything DARK; nothing in this runbook has been executed.
**Source docs:** [design](../designs/2026-06-01-unified-send-to-client-design.md) · [pre-plan audit](../superpowers/audits/2026-06-01-unified-send-to-client-audit.md) · [plan](../superpowers/plans/2026-06-01-unified-send-to-client.md) · [motivating audit](../audits/2026-06-01-client-inbox-pipeline-audit.md)

---

## 0. What's shipped (all dark, on `staging`)

Merged PRs **#1012–#1020** (Phase 0 spine → 7 type adapters → client + admin unified inbox). Production behavior is **unchanged**: four flags, all default `false` (`shared/types/feature-flags.ts`):

| Flag | Gates | Covers types |
|---|---|---|
| `unified-deliverables-approval-family` | dual-write | seo_edit, audit_issue, schema_item, content_plan_sample, content_plan_template |
| `unified-deliverables-broken-family` | dual-write | redirect, internal_link, aeo_change, content_decay |
| `unified-deliverables-rest` | dual-write | schema_plan, copy_section*, content_request*, work_order, briefing |
| `unified-inbox` | the client + admin **UI** reads `client_deliverable` | (all) |

\* `copy_section` and `content_request` are **projected** (read-only from their source tables via `projectFromSource`) — they have no dual-write/backfill; the `rest` flag is irrelevant to them.

**Migrations 111/112** (`client_deliverable` + `_item`) are applied. The service (`sendToClient`/`respondToDeliverable`), adapters, dual-write hooks, backfill scripts (`scripts/backfill-deliverables-*.ts`), and the inbox UI are all present but inert until a flag flips.

---

## 1. ⚠️ Code prerequisites BEFORE any flag flip

These were deliberately deferred from the dark PRs (each is harmless while dark) and **must land before cutover**, or the first flip will misbehave. Each is a small, scoped change.

1. **Send-seam re-mirror must route through the guarded path (PR-1a L1, PR-1b).** The dual-write hooks call `upsertDeliverable` directly, bypassing the `validateTransition` resend guard. If a legacy artifact is re-sent after its unified row was already `approved`, the `ON CONFLICT DO UPDATE` would silently revert it to `awaiting_client` (nulling `decided_at`/`applied_at`). Fix: route the mirror through `sendToClient` (or add a `findBySourceRef` + `validateTransition` check) in `approval-batch-dual-write.ts`, `client-action-dual-write.ts`, `schema-plan-dual-write.ts`, `work-order-dual-write.ts`. **Dark today (no rows exist); a real bug the instant dual-write turns on.**
2. **redirect / internal_link producer `sourceId` change (PR-1b/M2/B17).** The adapters compute a stable `redirect:<siteId>`/`internal_link:<siteId>` `sourceRef`, but the LIVE producers (`RedirectManager.tsx:179`, `InternalLinks.tsx:144`) still key the legacy `client_action.sourceId` on a timestamp. Until they use the stable key, a re-send mints a NEW legacy row (B17 dup) that the backfill then maps to the same deliverable. Change the producers to the stable site key so legacy + dual-write + backfill all converge.
3. **CP-K4 matrix-cell guard (deferred from PR-1a).** Before content_plan approvals write back to the matrix cell at cutover, bring `updateMatrixCell` (`server/content-matrices.ts`) under a `MATRIX_CELL_TRANSITIONS` guard (or derive the cell status from the deliverable) so a failed/partial apply can't desync (audit CP-K4 / B2 / M6).
4. **Apply opt-in stays OFF until the field map soaks (D-apply).** Every adapter's `applyDeliverable` is a disabled stub. Do NOT enable apply-on-approve at the same time as the read flip. Enable dual-write + read first; enable apply per-adapter only after the audit_issue field map (the B1 fix) has been observed correct in the shadow window.

---

## 2. The cutover sequence (per flag group, one at a time)

Recommended order: **approval-family → broken-family → rest** (cleanest data first). For each group:

1. **Backfill prerequisites (order matters):** within the approval family run nothing special; but **`schema_item` (approval-family) must be backfilled before `schema_plan` (rest)** so `schema_plan`'s `parentDeliverableId` resolves (PR-1c) — i.e. flip/backfill `approval-family` before `rest`. The raw `clientPreviewBatchId` is preserved either way, so this only affects link population.
2. **Enable the group's dual-write flag** (`feature_flag_overrides`, or env). New sends now mirror into `client_deliverable`.
3. **Run the backfill(s)** for that group's types: `npx tsx scripts/backfill-deliverables-<type>.ts` (each is idempotent / `--dry-run` / `--check`; supports re-runs via `INSERT … ON CONFLICT DO NOTHING` on the unique `sourceRef` index, and normalizes legacy timestamp `sourceId`s to the stable key). Run `--dry-run` first; verify the `byType` counts + the "every row resolves to exactly one type" parity assertion; then run for real.
4. **Verify parity (shadow window).** Compare the legacy read vs the new `client_deliverable` read at the **public GET path** for a sample of workspaces: same set of awaiting/changes/approved items, same item counts, same client-visible status. (The design's shadow-divergence harness, `server/deliverable-divergence.ts`, was scoped but not built in the dark phase — build it or do a scripted compare here, per design §8. Let it soak before the read flip.) **`work_order`/`briefing` are additive net-new — no legacy artifact to shadow; verify they appear, idempotent on payment/briefing id.**
5. **Repeat** for the next group.

Once all dual-write groups are on, backfilled, and at parity:

6. **Read-path slice cutover (deferred from PR-2b — the M12 read-path inventory).** Route the consumers of the old per-table shapes to read `client_deliverable` (hybrid per type: physical types → the new table; `copy_section`/`content_request` → projected). Consumers to migrate (audit §B.2): `server/intelligence/operational-slice.ts`, `content-pipeline-slice.ts`, `client-signals-slice.ts`; the `/api/workspace-overview` rollup (`server/routes/workspaces.ts`) + `server/workspace-data.ts`; the 3 client counters (`ClientHeader.tsx`, `OverviewTab.tsx`, `InboxTab.tsx`). Respect the `admin-chat-context.ts:691-694` TASK-8 guard. Promote any filtered/sorted/counted field (e.g. copy `version`) out of `payload` into a typed column. **Fix B29 here** (workspace-overview double-counts content-plan batches into the SEO tally + collapses review/flagged).
7. **Enable `unified-inbox`** → the client `UnifiedInbox` (PriorityStrip + uniform verbs) and the admin "Client Deliverables" pane now read the populated table.

**The whole sequence is reversible until §4: flags off → fully dark again.**

---

## 3. Follow-on live improvements (do as part of activating the inbox)

Deferred from the dark PRs; they activate the inbox's full value:
- **Projected respond wiring (PR-2a I1, `TODO(cutover)`):** the unified client inbox currently deep-links copy/content_request to `?tab=reviews` (their bespoke surfaces) instead of calling `/respond` (which is physical-only). To respond to projected types from the unified inbox, route `respondToDeliverable` for `copy_section`/`content_request` to their bespoke source mutators (copy-pipeline `updateSectionStatus`; content-requests routes).
- **Operator actions on changes-requested/pending (B18/E7):** add admin mutate endpoints + pane controls for revise/resend/acknowledge (Remind already exists).
- **Notification-bell categorization + routing (E3/A2):** fix `notificationCategory()` prefixes so `deliverable-*`/`client-actions-*` land under "Actions Needed", and make `App.tsx`'s `requestsSubTab` read `useSearchParams` (the `?tab=` two-halves contract at the admin layer).
- **`approval-reminders.ts` retirement:** when the approval family is fully cut over, retire it and migrate its throttle/dedup state into the deliverable nudge path (a nudge cron was scoped but not built — add it for the client "you have N pending" reminder, audit D11).
- **Client nudge cron (D11):** periodic reminder for `awaiting_client` items idle past a threshold.

---

## 4. Phase 3 — teardown (LAST, only after parity + full read cutover)

**Irreversible — do not start until the new model is authoritative and verified in production.**
1. **Soft-FK prerequisite migration (113):** add `deliverable_id` to `page_edit_states` (`approval_batch_id`/`content_request_id`) and `payments` (`content_request_id`); backfill from the old ids; update BOTH `page_edit_states` mappers (incl. the duplicate in `server/workspaces.ts`) and `server/payments.ts`. Gate with a verifier asserting **zero readers** of the old id columns (retire the 2 behavior-gating reads: `approvals.ts:163`, `webflow-schema.ts:756-757`). (audit §B.3)
2. **Drop the physically-migrated old tables** (`approval_batches`, `client_actions`, `schema_site_plans` + their items). **Do NOT drop `copy_sections`/`content_topic_requests`** (projected — retained as source-of-truth).
3. **Delete `LegacyInboxLayout`** (`InboxTab.tsx:618-956`) — **gated on `new-inbox-ia` at 100% rollout** (you confirmed ~100%). Run the **route-removal-checklist** + grep CLAUDE.md / `docs/rules/inbox-section-routing.md` for stale refs; confirm `inbox-legacy-filter-literal` / `inbox-action-queue-strip` pr-check rules still pass.
4. **Retire the 4 flags** (lifecycle → removed).

---

## 5. Open scope questions (owner decisions — audit §H)

Resolve these as you cut over (none block the dark build):
1. **Per-consumer read strategy** — confirmed **hybrid per type** (migrated → `client_deliverable`; copy/content_request → projected). Re-confirm per slice at §2.6, honoring the `admin-chat-context` TASK-8 guard.
2. **`work_order` entry state** — `WORK_ORDER_TRANSITIONS` entry is `pending`; the adapter maps `pending→ordered` at projection. Keep the projection mapping, or rename the enum (touches the column + tests)?
3. **`redirect_proposal` vs `redirect`** — the stored `sourceType` is `redirect_proposal`; the deliverable type is `redirect`. Map at the boundary (current) or migrate the stored value?
4. **declined/expired vs dedup** — does a `declined`/`expired` deliverable block a fresh send under `uq_cd_ws_type_sourceref`? Decide which statuses count as "active" for supersede-on-resend.
5. **schema_plan send-route guard** — `webflow-schema.ts:696` is site-scoped only; standardize to the admin `requireWorkspaceAccess` pattern at cutover.
6. **B15** (client-reply visibility on `requests`) stays deferred while **B24** (the `REQUEST_TRANSITIONS` guard — scoped but not yet added; add it when convenient) is in scope.

---

## 6. Rollback

At any point **before §4 teardown**: set all four flags to `false`. The UI reverts to the legacy/new-IA inbox, reads revert to the old tables, dual-write stops. The `client_deliverable` rows become inert (harmless). Fully reversible.

---

## 7. Verification gates (every cutover PR)

`npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run verify:feature-flags`, green on `staging` before `main`. Per-type backfill parity + shadow-compare before each read flip. (CI flake note: the rewrite-chat "no AI key → 400" timeout was root-caused + fixed during this work; if a single `test-shard` fails on something else, reproduce that shard locally before re-running.)
