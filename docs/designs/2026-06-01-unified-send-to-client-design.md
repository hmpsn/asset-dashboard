# Unified Send-to-Client — Design Blueprint

**Date:** 2026-06-01
**Status:** Design (master blueprint; decomposes into phased plans)
**Motivating audit:** [docs/audits/2026-06-01-client-inbox-pipeline-audit.md](../audits/2026-06-01-client-inbox-pipeline-audit.md)
**Prior art it mirrors:** the Opportunity-Value model strangler-fig rollout (migrations 107–110; dual-write + shadow-divergence + flag-gated cutover).

---

## 1. Goal

Replace the five bespoke "send to client" pipelines with **one artifact (`ClientDeliverable`), one service (`sendToClient()`), one client inbox, and one admin inbox** — so that adding a new reviewable work type in the future is *a row and an adapter*, not a sixth subsystem. This is the "streamline and unify for future growth" mandate.

**Owner decisions locked (this session):**
- **Depth:** full data-model consolidation — collapse the 5 artifact tables into one `client_deliverable` table.
- **Scope:** one master blueprint covering all three pillars (spine → client inbox → admin inbox), decomposed into phased plans.
- **Migration:** strangler-fig, per-type cutover — dual-write + backfill + shadow-compare + flag-gated read flip; drop the old tables last.

**Two product calls locked to recommendation (vetoable on review):**
- **(PC-1)** Client default landing stays **Insights/Overview**, not Inbox — but the Overview banner, nav badge, and Inbox all read **one** `awaiting_client` count from the deliverable table (fixes the three-counter disagreement, D1).
- **(PC-2)** One-way work types (`work_order`, `briefing`) live in the **same** `client_deliverable` table as `kind:'notification'` rows, so the admin pane and "what did this client receive" are complete.

---

## 2. Problem context (from the audit, not re-argued here)

"Send to client" is **five independent artifact models** — `approval_batch` (`server/approvals.ts`), `content_request` (`server/content-requests.ts`), `client_action` (`server/client-actions.ts`), `copy_section` (`server/copy-pipeline.ts`), `schema_plan` (`server/schema-store.ts`) — each with its own state machine, status vocabulary, notification wiring, and client/admin surface. Consequences: a destructive client-triggered live write (audit issues, B1), two silent round-trips (copy/schema-plan, B3/B9), an un-pushable-back family (B5/B23), no admin pane spanning the five, and no `awaiting_client`/`stale` concept anywhere (E1/E6). The approval-batch family already works end-to-end and `NormalizedDecision` (`shared/types/decision.ts`) already unifies two of the five — the architecture is half-converged; this finishes it.

---

## 3. Architecture overview

```
                       ┌─────────────────────────────────────────┐
  operator surfaces ──▶│  sendToClient(workspaceId, type, payload) │  one service, 4 guarantees
  (SeoEditor, Brief,   └───────────────────┬─────────────────────┘
   Copy, Schema, …)                        │  per-type adapter: buildPayload()
                                            ▼
                                  ┌───────────────────┐
                                  │ client_deliverable │  one table (+ _item child)
                                  │  type/kind/status   │  one status vocabulary
                                  │  payload(json)      │  one state machine
                                  └─────────┬───────────┘
                ┌─────────────────────────┬─┴───────────────────────┐
                ▼                         ▼                          ▼
   PATCH /respond (one route)   ClientSignalsSlice          unified reads
   approve/changes/decline      (AI/admin-chat see it)      ├─ Pillar 2: client inbox
   → team email EVERY outcome                               │   (NormalizedDecision, PriorityStrip)
   → applyDeliverable() on approve                          └─ Pillar 3: admin inbox
                                                                 (status pane + age axis)
```

### Units (one responsibility each)

| Unit | File (new unless noted) | Responsibility |
|---|---|---|
| `client_deliverable` store | `server/client-deliverables.ts` | table mapper, CRUD, status reads; the only writer of the table |
| `sendToClient()` service | `server/domains/inbox/send-to-client.ts` | the 4-guarantee send + the response handler |
| Deliverable adapters | `server/domains/inbox/deliverable-adapters/<type>.ts` | per-type `buildPayload()` + `applyDeliverable()` |
| Shared types | `shared/types/client-deliverable.ts` | `ClientDeliverable`, status enum, discriminated `payload` union |
| State machine | `server/state-machines.ts` (extend) | `CLIENT_DELIVERABLE_TRANSITIONS` (base + per-type overrides) |
| Migrations | `server/db/migrations/111-client-deliverable.sql`, `112-client-deliverable-item.sql` | schema |
| Shadow-divergence | `server/deliverable-divergence.ts` | per-type old-vs-new read parity log (the cutover gate) |
| Client inbox | `src/components/client/` (consolidate) | one prioritized queue (Pillar 2) |
| Admin inbox | `src/components/admin/` (consolidate) | one status pane (Pillar 3) |
| Nudge cron | `server/deliverable-nudge-cron.ts` | client reminder on idle `awaiting_client` |

---

## 4. Pillar 1 — The Spine

### 4.1 Schema (migration 111 / 112)

```sql
-- 111-client-deliverable.sql
CREATE TABLE IF NOT EXISTS client_deliverable (
  id                   TEXT PRIMARY KEY,
  workspace_id         TEXT NOT NULL,
  type                 TEXT NOT NULL,   -- 'seo_edit'|'audit_issue'|'schema_item'|'schema_plan'
                                        --  |'brief'|'post'|'copy_section'|'redirect'|'internal_link'
                                        --  |'aeo_change'|'content_decay'|'content_plan_sample'
                                        --  |'content_plan_template'|'work_order'|'briefing'
  kind                 TEXT NOT NULL,   -- 'decision'|'batch'|'review'|'notification'
  status               TEXT NOT NULL,   -- canonical vocab (§4.2)
  title                TEXT NOT NULL,
  summary              TEXT,            -- "what am I reviewing + why"
  payload              TEXT NOT NULL,   -- typed JSON, discriminated by `type`
  note                 TEXT,            -- operator send-note → Decisions-vs-Conversations routing
  client_response_note TEXT,            -- client's changes/decline reason
  sent_at              TEXT,            -- entered awaiting_client → THE staleness clock
  decided_at           TEXT,
  due_at               TEXT,            -- optional SLA
  applied_at           TEXT,
  source               TEXT,            -- originating operator tool
  source_ref           TEXT,            -- stable natural key for dedup-on-resend (NOT a timestamp)
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
  status          TEXT NOT NULL,        -- per-item approve/reject/edit
  field           TEXT,                 -- the specific target field (per-check; fixes B1)
  current_value   TEXT,
  proposed_value  TEXT,
  applyable       INTEGER NOT NULL DEFAULT 0,  -- explicit "client can apply this" (fixes B1/B11)
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cdi_deliverable ON client_deliverable_item(deliverable_id);
```

Lockstep (CLAUDE.md DB column + mapper): migration + row interface + `rowToDeliverable()` + `upsertDeliverable()` + Zod schema + public-portal serialization list, all in the same commit. `payload` parsed via `parseJsonSafe` with the discriminated-union schema.

### 4.2 One status vocabulary + one state machine

Canonical: `draft → awaiting_client → {changes_requested ↔ awaiting_client, approved, declined}`, `approved → applied`, plus terminal `expired`/`cancelled`.

| Canonical | absorbs |
|---|---|
| `awaiting_client` | `pending` · `client_review` · `sent_to_client` |
| `changes_requested` | `rejected` · `changes_requested` · `revision_requested` · `client_changes_requested` |
| `approved` | `approved` · `delivered` · `client_approved` |
| `declined` | `declined` (new for client_action family) |
| `applied` / `draft` / `expired` / `cancelled` | `applied`/`active` + lifecycle |

`CLIENT_DELIVERABLE_TRANSITIONS` in `server/state-machines.ts`: one base map, with **per-type overrides** — e.g. `kind:'notification'` (work_order, briefing) has **no** client transitions (one-way; enforces PC-2 safety), `review` types may skip `applied`. `validateTransition()` is called before every status mutation, exactly as the existing maps require.

### 4.3 `sendToClient()` — four structural guarantees

```ts
// server/domains/inbox/send-to-client.ts
async function sendToClient(workspaceId, type, input, opts): Promise<ClientDeliverable>
```
Every call, regardless of type, performs (and cannot be bypassed):
1. **Client notification** — email + `broadcastToWorkspace(WS_EVENTS.DELIVERABLE_SENT)`. (Fixes copy's no-email-on-send B3, MCP posts B6.)
2. **State-machine-guarded insert** — `draft → awaiting_client` via `validateTransition`; sets `sent_at`. (Fixes the 3 unguarded entities, C.2.)
3. **Adapter `buildPayload(input)`** — produces the typed `payload` (+ child items). The audit-issue adapter carries a **real per-check `field` map** and sets `applyable=false` for non-meta checks → **kills B1**.
4. **One row in one table** → the admin rollup is a single indexed query (enables Pillar 3); also surfaced into `ClientSignalsSlice` (data-flow rule #6).

### 4.4 One response path + apply

```
PATCH /api/public/deliverables/:ws/:id/respond
   body: { decision:'approved'|'changes_requested'|'declined', note?, itemDecisions? }
```
Shared handler (replaces the 5 divergent public routes in `public-content.ts`/`public-portal.ts`/`client-actions.ts`/`webflow-schema.ts`): validate transition → persist response + `client_response_note` → **team email on EVERY outcome** (`notifyTeam*`, fixes B4/B9/B31) → broadcast + invalidate admin caches → on `approved`, call the adapter's `applyDeliverable()` which writes back to source-of-truth (SEO→`updatePageSeo`, brief→generation, content_plan→`updateMatrixCell`, etc.) — **closing the dangling approval→artifact round-trips B2/B7/B11**.

### 4.5 Adapter contract (the only thing a new type implements)

```ts
interface DeliverableAdapter<T extends DeliverableType> {
  buildPayload(input): { title; summary; kind; items?; payload };
  applyDeliverable(deliverable): Promise<{ applied: number }>;  // no-op for review/notification
}
```
A pr-check rule fails the build if any registered `type` lacks an adapter.

---

## 5. Pillar 2 — Client inbox (one prioritized queue)

`NormalizedDecision` generalizes to read from `client_deliverable`; `kind` replaces `isSingleAction` (`decision`→inline card, `batch`→modal, `review`→content view, `notification`→read-only).

| Move | Files | Fixes |
|---|---|---|
| Mount the orphaned **`PriorityStrip`** as the inbox landing (per-item CTA + single "all caught up") | `src/components/client/PriorityStrip.tsx`, `InboxTab.tsx` | D2, D8 |
| **One counter, one formula** (`awaiting_client` count) across Overview banner, nav badge, Inbox | `OverviewTab.tsx`, `ClientHeader.tsx`, `InboxTab.tsx` | D1 |
| Collapse the two flag-gated layouts into the **one** Decisions/Reviews/Conversations taxonomy; retire `LegacyInboxLayout` | `InboxTab.tsx` | D3, D4 |
| **One decision contract** rendered identically: Approve / Request changes (+note) / Decline | `DecisionCard.tsx`, `DecisionDetailModal.tsx` | D6, D7, B5, B20, B23 |
| Render `sent_at` age + optional `due_at`; preserve operator rationale to the client | `DecisionCard.tsx` | D5, B27 |
| Mobile-first card/modal (diff tables → stacked rows; no full-screen TipTap wall) | client review components | D9 |
| One `?tab=` contract, no beta `reviews→decisions` rewrite | `inbox/inbox-filter.ts`, `ActionQueueStrip.tsx` | D10, B-add-1, CP-K5 |
| **Client nudge cron** on idle `awaiting_client` (the `sent_at` clock) | `server/deliverable-nudge-cron.ts` | D11 |

---

## 6. Pillar 3 — Admin inbox (one status pane with an age axis)

| Move | Files | Fixes |
|---|---|---|
| A unified **"Client Deliverables"** admin inbox — one query over the table, all types incl. copy/schema-plan; repurpose the misnamed `AdminInbox` (chat-signals-only today) | `src/components/admin/AdminInbox.tsx` (repurpose), new pane | E1, E2 |
| **Status axis** — buckets *Awaiting client · Changes requested · Approved (to apply) · Stale*, sortable oldest-first, "pending N days" from `sent_at` | new pane; `server/routes/workspaces.ts` rollup | E6, E7 |
| **Operator actions on every non-terminal item** — revise / resend / acknowledge, state-machine-backed | admin pane, `ClientActionsTab.tsx` | E7, B10, B18 |
| **Generalized `POST /api/deliverables/:ws/:id/remind`** for every type | `send-to-client.ts` | E4 |
| **Embedded response read-back** in each sending tool (generalize the `PendingApprovals` pattern) | each operator tool | E5 |
| Fix notification **bell categorization + routing** (`deliverable-*` → "Actions Needed"; honor `?tab=` sub-tab) | `useNotifications.ts`, `NotificationBell.tsx`, `App.tsx` | E3, A2 |

The Command Center "Needs Attention" list and the bell both read this one table, so inbound `requests` (support tickets) and outbound deliverables render as distinct, complete signals. (Note: client-initiated `requests` and `keyword_feedback` remain *client→engine* and stay out of the deliverable model; only their admin-visibility is touched where it overlaps notifications.)

---

## 7. Migration & rollout (strangler-fig, one work-type per PR)

- **Phase 0 — Contracts (1 PR, dark/no-op):** migrations 111/112; `shared/types/client-deliverable.ts`; `CLIENT_DELIVERABLE_TRANSITIONS`; `sendToClient()` + response handler + adapter interface; `server/client-deliverables.ts` store; feature flags (`unified-deliverables`, plus a per-type read flag pattern). Nothing reads it yet.
- **Phase 1 — Migrate send paths, one type per PR:**
  1. **Approval-batch family first** (`seo_edit`, `schema_item`, `audit_issue` with the corrected `field` map + `applyable` → **B1/B8 fixed here**) — cleanest data, proves the spine.
  2. **Broken/painful** (`copy_section`, `schema_plan`, then `client_action`: `redirect`/`internal_link`/`aeo_change`/`content_decay`) — being on the spine *is* the fix.
  3. **Rest** (`brief`/`post`, `content_plan_*`, then one-way `work_order`/`briefing` as `kind:'notification'`).
  Each PR: dual-write old+new on send → backfill existing rows → **shadow-compare** old-vs-new reads (`server/deliverable-divergence.ts`) → flip the read flag for that type when parity holds.
- **Phase 2 — Inboxes consume the table (per pillar, interleavable):** mount `PriorityStrip` + collapse to one client layout; build the unified admin pane; nudge cron + generalized remind; fix the bell.
- **Phase 3 — Teardown (last PR):** drop the 5 old tables; retire flags + `LegacyInboxLayout`; delete the dead `FixRecommendations` orphan.

Each phase is independently shippable and must be green on `staging` before the next (CLAUDE.md phase-per-PR).

---

## 8. Testing & guardrails

- **Shadow-divergence harness** per type (old-vs-new reads) — the parity gate for each cutover; mirrors `ov_divergence`.
- **New pr-check rules:** (1) *no direct insert to `client_deliverable` outside `sendToClient()`/the store* (prevents regression to ad-hoc pipelines); (2) *every `type` must register an adapter* (`buildPayload`+`applyDeliverable`); (3) extend the existing `send-for-review-anti-pattern` rule to the unified send.
- **Contract tests:** every type round-trips send → respond(approve/changes/decline) → apply; **state-machine guard tests** for `CLIENT_DELIVERABLE_TRANSITIONS`; **integration tests** on the public respond route + the admin rollup; **backfill parity test** (row counts + per-type spot checks); `verify:feature-flags`.
- **Standard gates:** `npm run typecheck`, `npx vite build`, `npx vitest run`, `npx tsx scripts/pr-check.ts` — all green per phase.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Live in-flight client decisions during migration | Strangler dual-write + shadow-compare + flag-gated reads; **don't drop old tables until parity** → reversible; per-type cutover bounds blast radius |
| **B1 destructive write is live now** | Sequence `audit_issue` early (its corrected adapter is the fix); optional tactical guard in Phase 0 if it must die immediately |
| Payload typing drift in the JSON column | Discriminated union validated by Zod at the boundary (DB column + mapper lockstep) |
| One hot table | Indexes on `(workspace_id, status, sent_at)` and `(workspace_id, type, source_ref)` |
| One-way types showing approve/decline UI | `kind` drives affordance; `notification` kind has no client transitions (state-machine-enforced) |
| 3-pillar scope creep | Master blueprint, **phased plans**; each phase shippable + green on staging before the next |
| Backfill mapping errors per type | Per-type backfill PR includes a parity test + shadow window before the read flip; old table retained |

---

## 10. Findings traceability (what this closes)

- **Top-5 audit issues:** #1 B1 (audit destructive write) → §4.3 adapter field map + `applyable`. #2 B2 (content-plan dead-end) → §4.4 `applyDeliverable`. #3 B3/B9 (silent copy/schema round-trips) → §4.3 guarantee 1 + §4.4 team-email-every-outcome. #4 B5/B23 (un-pushable client_action) → §4.2 `declined` + §5 one decision contract. #5 E1/E6 (no admin pane, no age) → §6 unified pane + `sent_at` axis.
- **Section B (correctness):** B4/B6/B31 → §4.4; B7/B11 → §4.4 apply; B10/B18 → §6 operator actions; B17 → `source_ref` dedup; B-add-1 → §5 `?tab=`.
- **Section C (consistency):** the five-vocabulary siloing → §4.2; duplicate renderers/modals → §5; bespoke audit payload → §4.3.
- **Section D / E:** mapped per-row in §5 / §6.

---

## 11. Open questions / needs-human (carried from the audit)

1. **Live `new-inbox-ia` cohort** — sets B5 urgency and how aggressively Phase 2 retires `LegacyInboxLayout`.
2. **Apply ownership** — does client approval *trigger* apply, or is operator publish the only path? Determines whether `applyDeliverable()` runs on approve or whether we just remove the "will be applied" copy (affects schema/content-plan adapters).
3. **Work-order intent** — review pipeline vs one-way notification (PC-2 assumes `notification`; if it should be a true review, it becomes a `decision`/`batch` type).
4. **Keyword-strategy release gate** — out of the deliverable model, but the audit's KWSTRAT-C1 control gap may warrant a sibling decision.
5. **PC-1 / PC-2** themselves — confirm the landing-tab and one-way-in-same-table calls.

---

*Decomposes into phased implementation plans via `superpowers:writing-plans` after review.*
