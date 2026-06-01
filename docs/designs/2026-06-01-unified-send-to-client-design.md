# Unified Send-to-Client — Design Blueprint

**Date:** 2026-06-01
**Status:** Design v2 (revised after adversarial review — see §13). Master blueprint; decomposes into phased plans.
**Motivating audit:** [docs/audits/2026-06-01-client-inbox-pipeline-audit.md](../audits/2026-06-01-client-inbox-pipeline-audit.md)
**Prior art it mirrors:** the Opportunity-Value model strangler-fig rollout (migrations 107–110; dual-write + shadow-divergence + flag-gated cutover) and `server/approval-reminders.ts` (the remind/nudge prior art it subsumes).

---

## 1. Goal

Replace the five bespoke "send to client" pipelines with **one artifact model (`ClientDeliverable`), one service (`sendToClient()`), one client inbox, and one admin inbox** — so adding a reviewable work type later is *an adapter*, not a sixth subsystem.

**Owner decisions locked (this session):**
- **Depth:** full data-model consolidation — collapse the artifact tables into one `client_deliverable` table **wherever doing so is lossless** (see §13-D1 — the two *hierarchical* types are projected, not flattened).
- **Scope:** one master blueprint covering all three pillars (spine → client inbox → admin inbox), decomposed into phased plans.
- **Migration:** strangler-fig, per-type cutover — dual-write + backfill + shadow-compare + flag-gated read flip; drop old tables last.

**Decisions taken during the v2 revision (please confirm on review):**
- **(D-apply)** `applyDeliverable()` is **opt-in per adapter, default no-op**, and "client approves" and "write to source-of-truth" stay **two distinct, separately-authorized transitions** during cutover (resolves old Open-Q#2; required to *not* re-create the B1 destructive write). §4.4.
- **(D-hybrid)** Physically consolidate the **simple decision/batch types** (`client_action` family, `approval_batch` family, `schema_plan`) into `client_deliverable`. Keep **`copy_section` and `content_request`** in their source tables and expose them through the *same* `ClientDeliverable` interface + service + inboxes via a **projecting adapter** — full physical flattening is lossy for their hierarchy/threads/pipeline (§13-D1). The unified *model* still covers all types; the physical storage is hybrid.
- **(D-workorder)** `briefing` is a true one-way `kind:'notification'`; **`work_order` gets a lifecycle kind** (it's a paid, tracked product — `kind:'notification'` would re-create gap B14). §6, §11.

**Two product calls locked to recommendation (vetoable on review):**
- **(PC-1)** Client default landing stays Insights/Overview, but the Overview banner, nav badge, and Inbox read **one** `awaiting_client` count (fixes D1).
- **(PC-2)** One-way `briefing` lives in the same table as `kind:'notification'` so "what did this client receive" is complete. (`work_order` is *not* one-way — see D-workorder.)

---

## 2. Problem context (from the audit, not re-argued here)

"Send to client" is **five independent artifact models** — `approval_batch` (`server/approvals.ts`), `content_request` (`server/content-requests.ts`), `client_action` (`server/client-actions.ts`), `copy_section` (`server/copy-pipeline.ts`/`copy-review.ts`), `schema_plan` (`server/schema-store.ts`) — each with its own state machine, status vocabulary, notification wiring, and client/admin surface. Consequences: a destructive client-triggered live write (audit issues, B1), two silent round-trips (copy/schema-plan, B3/B9), an un-pushable-back family (B5/B23), no admin pane spanning the five, no `awaiting_client`/`stale` concept anywhere (E1/E6). The approval-batch family already works end-to-end and `NormalizedDecision` (`shared/types/decision.ts`) already unifies two of the five — this finishes the convergence.

---

## 3. Architecture overview

```
                       ┌─────────────────────────────────────────┐
  operator surfaces ──▶│  sendToClient(workspaceId, type, input)   │  one service, 5 guarantees
  (SeoEditor, Brief,   └───────────────────┬─────────────────────┘
   Copy, Schema, MCP)    per-type adapter: validateSendable() + buildPayload()
                                            ▼
              ┌────────────────────────────────────────────────────────┐
              │  ClientDeliverable model (one interface)                  │
              │   • physical: client_deliverable (+ _item) for simple types│
              │   • projected: copy_section / content_request adapters     │
              │   • one status vocabulary + one CLIENT_DELIVERABLE machine  │
              └───────────────────────────┬──────────────────────────────┘
   PATCH /respond (one HTTP adapter)       │  ClientSignalsSlice + read-path inventory (§6)
   approve/changes/decline                 │  (AI/admin-chat + counters + rollup)
   → team email EVERY outcome              ▼
   → applyDeliverable() ONLY if adapter    ├─ Pillar 2: client inbox (PriorityStrip, one counter)
     opts in (default no-op)               └─ Pillar 3: admin inbox (status pane + age axis)
```

### Units (one responsibility each)

| Unit | File | Responsibility |
|---|---|---|
| `client_deliverable` store | `server/client-deliverables.ts` (new) | table mapper, CRUD, status reads; **only** writer of the table |
| `sendToClient()` + response service | `server/domains/inbox/send-to-client.ts` (new) | the 5-guarantee send + the response handler (domain logic) |
| HTTP adapter | `server/routes/deliverables.ts` (new) | thin express layer for the public `/respond` + admin `/remind` routes — **lives under `server/routes/` so pr-check rule 135 (public-route client-portal-auth) actually scans it** (minor-2) |
| Deliverable adapters | `server/domains/inbox/deliverable-adapters/<type>.ts` (new) | per-type `validateSendable()` + `buildPayload()` + `applyDeliverable()` (+ `sourceRef()` + `projectFromSource()` for projected types) |
| Shared types | `shared/types/client-deliverable.ts` (new) | `ClientDeliverable`, status enum, discriminated `payload` union, per-item types |
| State machine | `server/state-machines.ts` (extend) | `CLIENT_DELIVERABLE_TRANSITIONS` (base + per-type overrides) + new `REQUEST_TRANSITIONS` (M11) |
| Migrations | `111-client-deliverable.sql`, `112-client-deliverable-item.sql`, + a teardown-prereq migration (M8) | schema |
| Shadow-divergence | `server/deliverable-divergence.ts` (new) | per-type old-vs-new parity at the **public GET path** (§8) |
| Backfill scripts | `scripts/backfill-deliverables-<type>.ts` (new) | standalone, idempotent (`INSERT OR IGNORE` on the unique index), re-runnable |
| Client inbox | `src/components/client/` (consolidate) | one prioritized queue (Pillar 2) |
| Admin inbox | `src/components/admin/` (consolidate) | one status pane (Pillar 3) |
| Nudge cron | `server/deliverable-nudge-cron.ts` (new) | client reminder; **subsumes `server/approval-reminders.ts`** (M8) |

The existing **MCP `send_to_client`** handler (`server/mcp/tools/content-actions.ts`) is refactored to **delegate** to `sendToClient()` (mapping its input schema onto the adapter contract) so it is not a 6th writer bypassing pr-check rule 1 (minor-5).

---

## 4. Pillar 1 — The Spine

### 4.1 Schema (migration 111 / 112)

```sql
-- 111-client-deliverable.sql
CREATE TABLE IF NOT EXISTS client_deliverable (
  id                   TEXT PRIMARY KEY,
  workspace_id         TEXT NOT NULL,
  external_ref         TEXT,            -- site_id for schema_plan; null otherwise (M3)
  type                 TEXT NOT NULL,   -- 'seo_edit'|'audit_issue'|'schema_item'|'schema_plan'
                                        --  |'redirect'|'internal_link'|'aeo_change'|'content_decay'
                                        --  |'content_plan_sample'|'content_plan_template'
                                        --  |'work_order'|'briefing'  (copy_section/content_request: PROJECTED, §13-D1)
  kind                 TEXT NOT NULL,   -- 'decision'|'batch'|'review'|'notification'|'order'
  status               TEXT NOT NULL,   -- canonical vocab (§4.2), incl. 'partial'
  title                TEXT NOT NULL,
  summary              TEXT,
  payload              TEXT NOT NULL,   -- typed JSON, discriminated by `type`
  note                 TEXT,            -- operator send-note → Decisions-vs-Conversations routing
  client_response_note TEXT,
  parent_deliverable_id TEXT,           -- self-FK: schema_plan → its schema-item batch (M3 clientPreviewBatchId)
  sent_at              TEXT,            -- entered awaiting_client → THE staleness clock
  decided_at           TEXT,
  due_at               TEXT,
  applied_at           TEXT,
  generated_at         TEXT,            -- producer version stamp; distinguishes re-send from overwrite (M3)
  source               TEXT,            -- originating operator tool
  source_ref           TEXT,            -- stable natural key for dedup-on-resend (per-type, §4.5)
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cd_ws_status_sent ON client_deliverable(workspace_id, status, sent_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cd_ws_type_sourceref
  ON client_deliverable(workspace_id, type, source_ref) WHERE source_ref IS NOT NULL;

-- 112-client-deliverable-item.sql  (child rows for kind='batch')
CREATE TABLE IF NOT EXISTS client_deliverable_item (
  id              TEXT PRIMARY KEY,
  deliverable_id  TEXT NOT NULL REFERENCES client_deliverable(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,
  -- typed columns: the apply path keys on these (B1/M-B1) — needed by approval/SEO/schema-item family
  target_ref      TEXT,                 -- pageId (or cms-collection-item id)
  collection_id   TEXT,                 -- Webflow collection (CMS items)
  field           TEXT,                 -- the SPECIFIC target field per check (fixes B1's seoDescription collapse)
  current_value   TEXT,
  proposed_value  TEXT,
  client_value    TEXT,                 -- the client's own edited value (exists today; apply reads it)
  client_note     TEXT,                 -- per-item client note (exists today)
  applyable       INTEGER NOT NULL DEFAULT 0,   -- explicit "client can apply this" (fixes B1/B11)
  item_payload    TEXT,                 -- typed JSON for heterogeneous sub-items (internal-link 6-field,
                                        --  AEO 7-field, redirect 4-field) — per-item filtering is in-app, not SQL
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cdi_deliverable ON client_deliverable_item(deliverable_id);
```

**Scoping decision (resolves B1/DM-2 explicitly):** the **typed item columns** (`target_ref`/`collection_id`/`field`/`current_value`/`proposed_value`/`client_value`/`client_note`/`applyable`) serve the **approval/SEO/schema-item** family, where the apply path needs queryable identity (`server/routes/approvals.ts:414-456` reads `pageId`/`collectionId`/`clientValue`/`field`). The **heterogeneous `client_action` sub-items** (internal-link/AEO/redirect — no `current`/`proposed` pair) live in **`item_payload` JSON**; per-item filtering for those is in-app (the batch is loaded whole to render the flag-one-of-N modal, so this is not a hot query). This is stated so no adapter assumes SQL-level per-item filtering for client_action types.

Lockstep (CLAUDE.md DB column + mapper): migration + row interface + `rowToDeliverable()` + `upsertDeliverable()` + Zod schema + `public-portal.ts` serialization list, all in one commit. `payload`/`item_payload` parsed via `parseJsonSafe` with the discriminated-union schema; per-type **build→store→parse→assert-no-fallback** round-trip tests are wired into the adapter-registration pr-check rule so a drifted variant fails CI instead of silently emptying that type (minor-1 — the `keywordStrategySchema.pageMap` scar).

### 4.2 One status vocabulary + one state machine

Canonical: `draft → awaiting_client → {changes_requested ↔ awaiting_client | approved | declined}`, optional `approved → applied`, plus `partial` (mixed-item batch), terminal `expired`/`cancelled`, and an `order` lifecycle (`ordered → in_progress → completed`) for `work_order`.

| Canonical | absorbs |
|---|---|
| `awaiting_client` | `pending` · `client_review` · `sent_to_client` |
| `changes_requested` | `rejected`(batch) · `changes_requested` · `revision_requested` · `client_changes_requested` |
| `partial` | approval_batch `partial` (mixed-decided items; M7) — **or** derived as a per-item rollup over `client_deliverable_item.status` (the design permits either; the requirement is that `partial` is *represented*, not dropped). Sorts into the admin **Changes-requested** bucket. |
| `approved` | `approved` · `delivered` · `client_approved` |
| `declined` | `declined` (new for client_action family — fixes B23) |
| `applied`/`draft`/`expired`/`cancelled` | `applied`/`active` + lifecycle |

`CLIENT_DELIVERABLE_TRANSITIONS` in `server/state-machines.ts` = one base map + **explicit per-type overrides**:
- **`copy`** (projected): `approved` is **terminal** (`approved: []`, no `→applied`; its real side-effect is voice-sample harvest, modeled as an adapter no-op apply), and `changes_requested → draft` (not the canonical `↔awaiting_client`). (M-B3)
- **`schema_plan`**: client approve does **not** auto-apply; operator publish is a separate transition (M-B3/B11).
- **`content_request`**: carries its full **10-state production pipeline** as a per-type override (`pending_payment → requested → brief_generated → client_review → approved → in_progress → post_review → delivered → published`, + `changes_requested`/`declined`), since most states are internal production/monetization, not client-review states (M4). The unified inbox/admin views surface only the client-facing subset; backfill parity asserts the non-client states are preserved.
- **`notification`** kind (`briefing`): **no** client transitions (one-way; enforces PC-2 safety).
- **`order`** kind (`work_order`): `ordered → in_progress → completed`/`cancelled`; no client decision, but a client *status* surface + operator advance/complete UI (D-workorder, M10).

`validateTransition()` is called before every status mutation, exactly as the existing maps require. **Sibling fix (M11):** add a `REQUEST_TRANSITIONS` map + guard to `PATCH /api/requests/:id` (`server/routes/requests.ts:188` is currently any-to-any, re-firing the client status email on `closed→new`) — this is one of the design's own "one state machine" laws and is independent of the table.

### 4.3 `sendToClient()` — five structural guarantees

```ts
// server/domains/inbox/send-to-client.ts
async function sendToClient(workspaceId, type, input, opts): Promise<ClientDeliverable>
```
Every call, regardless of type, performs (and cannot be bypassed):
0. **`adapter.validateSendable(input)`** — rejects not-ready inputs *before* anything else (post must be `draft`/`approved`, not `generating`/`error`/empty; bulk sends must reconcile "N of M filtered"; decay must carry a validated `targetKeyword`). Because MCP delegates here, MCP inherits the guard. **Closes B19, and is the home for the adapter-input fixes B13/B22/B26/B28** (M5).
1. **Client notification** on send (email + `broadcastToWorkspace(WS_EVENTS.DELIVERABLE_SENT)`). Fixes copy's no-email-on-send (B3) and MCP posts (B6).
2. **State-machine-guarded insert** (`draft → awaiting_client` via `validateTransition`); sets `sent_at`. Fixes the 3 unguarded entities (C.2).
3. **`adapter.buildPayload(input)`** — typed payload (+ child items). The `audit_issue` adapter carries a **real per-check `field` map** and sets `applyable=false` for non-meta checks → **kills B1** (the field map alone is necessary; the §4.1 `target_ref`/`collection_id` columns make it *applyable*).
4. **Team notification on every outcome** (approve/changes/decline) — implemented once in the shared response handler (§4.4), not per-route. Kills the email-asymmetry cluster (B4/B9/B31).

### 4.4 Response path, auth, and apply

```
PATCH /api/public/deliverables/:workspaceId/:id/respond   (server/routes/deliverables.ts → domain service)
   body: { decision:'approved'|'changes_requested'|'declined', note?, itemDecisions? }
```
- **Auth (M1):** the route param is **`:workspaceId`** (matching the existing `requireClientPortalAuth('workspaceId')` convention — using `:ws` silently reads `undefined` and **bypasses auth**). Use **`requireAuthenticatedClientPortalAuth`** (denies passwordless — this route mutates state) and a **per-type guard resolver** that delegates to the existing scoped guards (`requireClientCopyReviewAuth` for copy, `requireClientStrategyMutationAuth` for strategy) so each type's current access semantics are preserved; schema-plan's currently-unguarded send is treated as a **bug to fix, not replicate**. A per-type "unauthenticated `respond` → 401" contract test is required.
- **Handler:** validate transition → persist response + `client_response_note` → **team email on every outcome** → broadcast + invalidate admin caches → **on `approved`, call `adapter.applyDeliverable()` only if the adapter opted in** (D-apply). Apply default is **no-op**; "client approved" and "write to source-of-truth" remain two distinct transitions with distinct authorization during cutover. Apply is only folded into approve *after* a type's field map has soaked behind the flag with apply disabled. This is the guard that prevents the unified path from re-creating B1.
- **B2 (content-plan) reconciliation (M6):** `applyDeliverable()` for `content_plan_*` writes the matrix cell — but `updateMatrixCell` (`server/content-matrices.ts:289-330`) is currently **un-guarded** (CP-K4). Bring it under a `MATRIX_CELL_TRANSITIONS` guard (or make the cell status **derive** from the deliverable status — single source of truth) and define the compensating transition for a failed/partial apply. CP-K4 is **in scope**.

### 4.5 Adapter contract (the only thing a new type implements)

```ts
interface DeliverableAdapter<T> {
  validateSendable(input): Result;                 // §4.3 guarantee 0
  buildPayload(input): { title; summary; kind; items?; payload };
  sourceRef(input): string | null;                 // stable dedup key (below)
  applyDeliverable(deliverable): Promise<{ applied: number }>;   // OPT-IN; default no-op
  projectFromSource?(sourceRow): ClientDeliverable; // ONLY for projected types (copy, content_request)
}
```
- **`sourceRef` per type (M2):** `redirect → redirect:<siteId>`, `internal_link → internal_link:<siteId>` (one live deliverable per site; **supersede on resend** — and the producer components **must stop keying on `analyzedAt`/`scannedAt`**, a producer change the redirect/internal_link cutover PR includes), `aeo → aeo:<pageUrl>`, `content_decay → content_decay:<pagePath>` (these two already key stably — do not touch them). A dedup-on-resend contract test asserts a second identical send collapses onto the same row → closes B17.
- A pr-check rule fails the build if any registered `type` lacks a complete adapter.

---

## 5. Pillar 2 — Client inbox (one prioritized queue)

`NormalizedDecision` generalizes to read the `ClientDeliverable` model; `kind` replaces `isSingleAction`.

| Move | Files | Fixes |
|---|---|---|
| Mount the orphaned **`PriorityStrip`** as the inbox landing | `PriorityStrip.tsx`, `InboxTab.tsx` | D2, D8 |
| **One counter** across Overview banner, nav badge, Inbox | `OverviewTab.tsx`, `ClientHeader.tsx`, `InboxTab.tsx` | D1 |
| Collapse the two flag-gated layouts into the one Decisions/Reviews/Conversations taxonomy; retire `LegacyInboxLayout` | `InboxTab.tsx` | D3, D4 |
| **One decision contract** rendered identically: Approve / Request changes (+note) / Decline | `DecisionCard.tsx`, `DecisionDetailModal.tsx` | D6, D7, B5, B20, B23 |
| Render `sent_at` age + optional `due_at`; preserve operator rationale | `DecisionCard.tsx` | D5, B27 |
| Mobile-first card/modal (diff tables → stacked rows) | client review components | D9 |
| One `?tab=` contract, no beta `reviews→decisions` rewrite | `inbox/inbox-filter.ts`, `ActionQueueStrip.tsx` | D10, B-add-1, CP-K5 |
| **Client nudge cron** on idle `awaiting_client` | `server/deliverable-nudge-cron.ts` | D11 |

**Sequencing (B4/M-B4):** the "one counter" and the layout collapse are **all-types-first barriers** — a single `awaiting_client` count is only correct once every counted type is migrated. So Pillar 2 either ships **after all send-path PRs** or behind a **dual-window union count** (§7). The `NormalizedDecision` generalization (`kind` replacing `isSingleAction`, `DecisionSource` widening) is **not** "no-op"; it ships as a dedicated Pillar-2 PR that updates `decision-adapters.ts` + `InboxTab.tsx` + `DecisionCard.tsx` in one commit per the string-literal-rename rule (minor-6 / D-23). Mounting `PriorityStrip` early would inherit the undercount, so it is gated on the same all-types precondition.

---

## 6. Pillar 3 — Admin inbox (one status pane with an age axis)

| Move | Files | Fixes |
|---|---|---|
| A unified **"Client Deliverables"** admin inbox — one query across all types incl. copy/schema-plan; repurpose the misnamed `AdminInbox` | `src/components/admin/AdminInbox.tsx` | E1, E2 |
| **Status axis** — *Awaiting client · Changes requested · Approved (to apply) · Stale*, oldest-first, "pending N days" from `sent_at` | new pane; `workspaces.ts` rollup | E6, E7 |
| **Operator actions on every non-terminal item** — revise / resend / acknowledge, state-machine-backed | admin pane, `ClientActionsTab.tsx` | E7, B10, B18 |
| **Generalized `POST /api/deliverables/:ws/:id/remind`** for every type | `deliverables.ts` route + service | E4 |
| **Embedded response read-back** in each sending tool (generalize the `PendingApprovals` pattern; includes `ContentManager` so a responded post stops showing a live Approve — B7/minor-4) | each operator tool | E5, B7 |
| Fix notification **bell categorization + routing** — `deliverable-*` → "Actions Needed", **and** make `App.tsx`'s `requestsSubTab` read `useSearchParams` (both halves of the `?tab=` contract; today it's `useState('signals')`, force-reset on workspace switch) | `useNotifications.ts`, `NotificationBell.tsx`, `App.tsx` | E3, A2 |

**Read-path inventory (M12) — required before Pillar 3 plans.** The 5 per-table shapes are read deeply by more than one slice: `operational-slice` (approval queue depth + oldest age via `listBatches`), `content-pipeline-slice` (raw SQL over `copy_sections` + `getSchemaPlan`), `ClientSignalsSlice`, the `/api/workspace-overview` rollup (6 per-domain summaries feeding the bell, Command Center, and the 3 counters). The plan must enumerate **every consumer** with a per-consumer decision: *migrate to read `client_deliverable`* or *be fed by a per-type backfilled projection*. Any field that is **filtered/sorted/counted/slice-read** (e.g. copy `version`) is promoted **out of `payload` into a typed column** (CLAUDE.md "normalize repeated/queried arrays out of JSON"). **B29** (workspace-overview double-counts content-plan batches into the SEO tally and collapses `review`+`flagged`) is fixed/retired during the content_plan cutover.

`requests` (support tickets) and `keyword_feedback` remain *client→engine* and stay out of the deliverable model; **B24** (requests guard) is fixed as the M11 sibling task, and **B15** (client-reply visibility on requests) is documented as **deferred-with-owner**, not implied-closed.

---

## 7. Migration & rollout (strangler-fig, one work-type per PR)

- **Phase 0 — Contracts (1 PR; additive types are zero-importer, but NOT a blanket "no-op"):** migrations 111/112; `shared/types/client-deliverable.ts`; `CLIENT_DELIVERABLE_TRANSITIONS` + `REQUEST_TRANSITIONS`; `sendToClient()` + response handler + adapter interface; `server/client-deliverables.ts` store; `server/routes/deliverables.ts` thin HTTP adapter; **a finite, statically-enumerated feature-flag set** (B5/M-B5) in `FEATURE_FLAGS` + `FEATURE_FLAG_CATALOG` — one flag *per phase group* (`unified-deliverables-approval-family` / `-broken-family` / `-rest`), each with full lifecycle metadata + `linkedRoadmapItemId` (a per-*type* dynamic key is inexpressible against the closed `FeatureFlagKey` union and fails `verify:feature-flags`). Finer per-type cutover granularity lives in a **DB read-routing table / env var keyed by type string**, not the flag system.
- **Phase 1 — Migrate send paths, one type per PR.** Order:
  1. **Approval-batch family first** (`seo_edit`, `schema_item`, `audit_issue` with the corrected `field` map + `applyable` → **B1/B8 fixed here**). Note: `approval_batches` is the **most overloaded** old table (it physically stores 5 deliverable types discriminated by per-item field + `[Review]` batch-name prefix + synthetic pageId), so this PR needs a **deterministic type classifier + mixed-batch tie-break + a parity assertion that every legacy row resolves to exactly one type** (minor-9 / M-B4 reclassification).
  2. **`client_action` family** (`redirect`/`internal_link`/`aeo_change`/`content_decay`) — being on the spine *is* the fix; includes the `sourceRef` producer change (M2).
  3. **`schema_plan`** (apply-rework PR: operator publish; `external_ref`=siteId; `parent_deliverable_id`) and **`content_plan_*`** (apply-rework PR: matrix-cell guard) — these are **NOT** the same shape/size as the approval-batch template (minor-8); each splits into a payload-cutover PR + an apply-rework PR.
  4. **Projected types** (`copy_section`, `content_request`): adapter `projectFromSource()` exposes the source tables through the unified model — **no physical migration, source tables retained** (§13-D1).
  5. **One-way `briefing`** (`kind:'notification'`) and **`work_order`** (`kind:'order'`).
  Each PR (for physically-migrated types): dual-write old+new → backfill (idempotent script) → **shadow-compare at the public GET path** → flip the read flag when parity holds.
  **Writer inventory (M8):** every writer that mutates an old table's status must route through the store during dual-write — not just the send routes but the **content-decay playbook worker, the client-action feedback loop, the standalone `/apply` route, MCP, and the Stripe webhook** — with a dual-write test per writer. `work_order`/`briefing` are **net-new additive** (no old artifact to shadow) — they are carved out of the shadow-compare recipe (idempotent on `payment_id`/briefing id); "reversibility" for them = "stop writing the new row."
- **Phase 2 — Inboxes consume the model (after the send-path PRs / behind the dual-window union count).** Mount `PriorityStrip` + collapse to one client layout; build the unified admin pane; nudge cron + generalized remind; fix the bell. **`LegacyInboxLayout` deletion is gated on `new-inbox-ia` reaching 100% rollout** (Open-Q#1) — a hard precondition folded into the Pillar-2 PR (minor-7), and it runs the **route-removal-checklist** + greps CLAUDE.md/`docs/rules/inbox-section-routing.md` for stale refs.
  **Dual-window count contract (B4/M-B4):** during migration, unified count = `Σ(awaiting_client in client_deliverable for migrated types)` + `legacy count for not-yet-migrated types`, computed in **one place** (a server count endpoint or one client helper); the single-source canonical count is gated on the last read-flip.
- **Phase 3 — Teardown (last).** A **teardown-prerequisite migration** first adds `deliverable_id` to the soft-FK tables `page_edit_states` (`approval_batch_id`/`content_request_id`) and `payments` (`content_request_id`) and backfills them, gated by a verifier asserting **zero readers of the old id columns** (M8) — *then* drop the physically-migrated old tables. **`copy_sections`/`content_request` are NOT dropped** (projected). Retire the phase flags + `LegacyInboxLayout`; when the approval-batch family flipped, **`approval-reminders.ts` was already retired in that PR** with its throttle/dedup state migrated into the nudge cron (M8).

Each phase is independently shippable and green on `staging` before the next (CLAUDE.md phase-per-PR).

---

## 8. Testing & guardrails

- **Shadow-divergence parity contract (M9 — not just "mirrors ov_divergence"; that prior art is read-only/single-scalar and materially easier).** `server/deliverable-divergence.ts` computes a **canonical normalized projection** (natural key, type, normalized status, item count, `sent_at`) from **both** the old per-source reads and the new model, diffs row-set + per-field **at the public GET path** (CLAUDE.md "integration tests must cover the actual read path"), logs **reason-coded** mismatches, and gates the flip on an explicit threshold. "Parity" is defined **per type** where the two machines may legally diverge (= same terminal outcome + same client-visible status), with a stated **dual-write conflict-resolution rule** (which system is authoritative for a mid-flight mutation). The 5→1 normalization is a first-class tested mapping.
- **New pr-check rules:** (1) no direct insert to `client_deliverable` outside the store/`sendToClient()`; (2) every registered `type` has a complete adapter; (3) extend `send-for-review-anti-pattern` to the unified send.
- **Contract tests:** per-type **build→store→parse→assert-no-fallback** round-trip (minor-1); send → respond(approve/changes/decline) → apply; per-type **unauthenticated respond → 401** (M1); **dedup-on-resend** collapses onto one row (M2); `validateSendable` rejects not-ready inputs incl. the decay-keyword and MCP cases (M5); `CLIENT_DELIVERABLE_TRANSITIONS` + `REQUEST_TRANSITIONS` guard tests; **backfill parity** per type incl. content_request non-client states (M4) and "every approval_batch row resolves to one type" (minor-9); dual-write test per writer (M8).
- **Standard gates:** `typecheck`, `vite build`, `vitest run`, `pr-check`, `verify:feature-flags` — all green per phase.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Live in-flight client decisions during migration | Strangler dual-write + per-type shadow-compare + flag-gated reads; don't drop old tables until parity → reversible; per-type cutover bounds blast radius |
| **B1 destructive write is live now** | Sequence `audit_issue` first with the corrected `field` map + `applyable=false`; **apply stays disabled behind the flag until the field map soaks** (D-apply); apply-time guard test asserts non-meta checks are non-applyable |
| Payload typing drift in the JSON column (the platform's #1 silent-data-loss pattern) | Discriminated union + per-type round-trip assert-no-fallback test wired into the adapter pr-check rule (minor-1) |
| One hot table — WAL single-writer contention (M-minor) | At single-tenant-agency volume serialization is acceptable; **`applyDeliverable`'s Webflow call is outside the DB transaction** (mark-pending → external call → mark-applied, two txns, per the external-call-before-write guard) |
| Projected types (copy/content_request) drift from the unified model | They keep their source tables + state machines; the adapter projects read-only and the response handler delegates to their existing mutators; shadow-compare covers the projection |
| 3-pillar scope creep | Master blueprint, phased plans; each phase shippable + green on staging before the next |
| Half-migrated workspace desync | Dual-window union count (§7); exhaustive writer inventory; idempotent backfill; teardown-prereq soft-FK migration |

---

## 10. Findings traceability (what this closes — now exhaustive)

- **Top-5:** B1 → §4.3 g0/g3 field map + §4.1 item identity + apply-disabled-until-soak; B2 → §4.4 matrix-guard apply; B3/B9 → §4.3 g1 + §4.4 team-email-every-outcome; B5/B23 → §4.2 `declined` + §5 one contract; E1/E6 → §6 pane + `sent_at`.
- **Section B (each given an owner):** B4/B6/B31 → §4.3-g1/g4; B7 → §6 read-back + `ContentManager` WS handler; B10/B18 → §6 operator actions; B11 → §4.1 `applyable` + §4.4; **B13** → decay adapter `validateSendable` carries a real `targetKeyword`; B14 → **D-workorder `kind:'order'`** (not notification); B17 → §4.5 `sourceRef`; **B19** → §4.3-g0; **B22/B28** → operator-tool fixes riding the internal_link/schema_item cutover PRs (pre-flight "N of M filtered"); B24 → §4.2 `REQUEST_TRANSITIONS` sibling; **B29** → §6 rollup retire during content_plan cutover; B-add-1 → §5 `?tab=`.
- **Section C:** five-vocabulary siloing → §4.2; duplicate renderers/modals → §5; bespoke audit payload → §4.3.
- **Section D / E:** mapped per-row in §5 / §6.

---

## 11. Open questions / needs-human (remaining after v2)

1. **Live `new-inbox-ia` cohort** — gates `LegacyInboxLayout` deletion (Phase 2 precondition) and B5 urgency.
2. **D-workorder confirmation** — is `work_order` a client-tracked paid product (→ `kind:'order'` with client status + operator complete UI, as assumed) vs a pure notification? Resolving this locks B14's fix.
3. **content_request participation extent** — does it join the deliverable model fully (10-state override) or only via projection of its client-review window? (D-hybrid assumes projection; confirm.)
4. **Keyword-strategy release gate** — out of the deliverable model, but the audit's KWSTRAT-C1 control gap may warrant a sibling decision.
5. **D-apply / D-hybrid / PC-1 / PC-2** — confirm the four revision decisions in §1.

---

## 12. Decomposition

Decomposes into phased implementation plans via `superpowers:writing-plans` after review: **Phase 0 (contracts)** · **Phase 1 (one PR per type, in the §7 order)** · **Phase 2 (the two inboxes + bell + nudge)** · **Phase 3 (teardown)**. Each carries its own model-assignment + verification gates.

---

## 13. Review history

**v2 (2026-06-01)** — revised after a 6-lens adversarial review (data-model fidelity, migration safety, findings-closure, platform-rule compliance, sequencing realism, red-team), verdict **revise-then-ship**. Incorporated **5 blockers** (flat _item lacks apply identity → §4.1 item columns + `item_payload`; copy hierarchy lossy → **D-hybrid projection**; apply-on-approve illegal/destructive → **D-apply opt-in no-op**; "one counter"/admin-pane all-types-first → **dual-window count contract** §7; per-type flag inexpressible → **finite enumerated flags** §7) and **12 majors** (auth param/guard-resolver §4.4; `sourceRef` producer change §4.5; schema_plan site-keying + `external_ref`/`parent_deliverable_id` §4.1; content_request 10-state override §4.2; adapter-input correctness `validateSendable` §4.3-g0; matrix-cell guard §4.4; `partial` status §4.2; writer-inventory + teardown soft-FKs + idempotent backfill + approval-reminders retirement §7; parity-contract §8; work_order `kind:'order'`; requests `REQUEST_TRANSITIONS`; read-path inventory §6) plus the substantive minors (thin route adapter for pr-check coverage; MCP delegation; `NormalizedDecision` phasing; WAL contention; route-removal-checklist on teardown).

**§13-D1 — the data-model refinement (most important change):** the review proved that *pure physical* single-table consolidation is **lossy for the two hierarchical types**: `copy_section` (blueprint→entry→section + per-section append-only `client_suggestions[]` thread + `version`/`steering_history` + sibling `copy_metadata`) and `content_request` (10-state production pipeline + `brief_id`/`post_id` FKs + `comments[]` thread). Forcing them into one flat row drops structure or turns `payload` into deep nested JSON that defeats the "single indexed query" benefit. **Resolution (D-hybrid):** consolidate the simple decision/batch types physically; keep copy + content_request in their source tables and expose them through the *same* `ClientDeliverable` interface via a **projecting adapter**. This preserves the owner's actual goal (one inbox, one service, one status vocabulary, "type #17 = an adapter") while avoiding lossy flattening. *This is a refinement of the "one table" decision and is flagged for owner confirmation (§1, §11-#3).*

**Rejected as overstated (not incorporated):** (a) generalizing `DecisionSource` is **small** blast radius (only `decision-adapters.ts` + `InboxTab.tsx` read `.source`) — kept as a grep obligation, not a flaw; (b) "redirect/internal_link/aeo/decay all need a new stable key" — **only redirect/internal_link** are timestamp-keyed; AEO/content_decay already key stably and must not be touched; (c) "decay generates on a garbage keyword, fully unguarded" — the empty-keyword guard exists; the residual is *non-empty garbage* passthrough (fix still stands, framing narrowed); (d) "`partial` must be a first-class status" — a derived per-item rollup is equally valid; the requirement is only that `partial` is *represented*.
