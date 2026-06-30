# The Issue — Operator-Steering Batch Implementation Plan

> Parallel-lane build. Pre-committed shared contracts → 3 exclusive-ownership lanes (server / frontend / tests) → controller integration → full gate → scaled adversarial review (the regen carry-over is trust-critical — the review weights it heavily).

**Goal:** The deeper curation verbs the owner flagged as extremely important (spec §11/§12) — the operator can (1) **correct a rec's wording** (title/insight), (2) **add a rec the system missed**, and (3) **reorder** the client-facing running order — and ALL of it survives the weekly regen that re-mints the recommendation set.

**Spec:** `docs/superpowers/specs/2026-06-19-strategy-the-issue-design.md` §11 (deferred), §12 (operator steering — the named follow-up). Locked.

**Flag:** `strategy-the-issue`. Admin steering surfaces render flag-ON only; the public projection's override-apply is per-workspace flag-gated like the rest of the Issue client read. Flag-OFF byte-identical.

---

## Trust-critical design anchors (from the pre-plan grounding)

- **`applyLifecycleCarryOver` (server/recommendations.ts:617) copies `id` + `createdAt` + the lifecycle axis old→new, matched by `buildMergeKey`.** So an override keyed on **`recId`** automatically follows a rec through regen (the new rec inherits the old id). This is exactly how the cannibalization keeper-override (Phase 1) survives regen.
- **Overrides live in a SEPARATE table and apply ONLY at display boundaries** (the admin GET serialization + the public projection). `loadRecommendations` stays PURE — regen + `mutateRec` read/write the base blob, so an override is NEVER baked into storage. Clearing an override restores the source wording.
- **Auto-resolve retention (server/recommendations.ts:2593-2642):** a rec whose `buildMergeKey` is absent from `newSources` is auto-resolved to `completed` UNLESS exempt (sent/struck/throttled, or a `signal:` rec). **Operator-minted recs have no producer**, so their key is never in `newSources` → they would auto-resolve on the very next regen. The grounding confirmed this is a LIVE pre-existing bug for the competitor-rec mint. Fix: a new retention branch for operator-minted recs (`source` starts with `manual:` OR `competitor:`) — RETAIN as-is when the source is absent. This fixes the competitor bug AND makes add-a-rec durable.

---

## Locked design

1. **Verb 1 — correct wording:** inline-edit a rec's `title` + `insight`. Override stored in `rec_operator_override` (recId-keyed), applied at the admin GET `/api/recommendations/:ws` serialization (so the cockpit shows corrected wording) and in the public client projection (so the client reads the corrected wording). Length-capped; clearing an override (empty payload) restores source wording.
2. **Verb 3 — add-a-rec:** generalize the competitor-rec mint into `POST /api/recommendations/:ws/manual-rec` — mints a rec with `source: 'manual:<randomId>'`, `actionType: 'manual'`, `clientStatus: 'system'`, `lifecycle: 'active'`, `status: 'pending'`. Allowed types = the non-deliverable RecTypes (exclude `cannibalization`, which needs a urlSetKey). The new auto-resolve retention branch keeps it across regen. Operator can strike it to remove.
3. **Verb 2 — reorder (decoupled from archetype grouping):** a "Client running order" panel lists the curated/sent recs (`isCuratedForClient`) in client order with up/down controls. `PATCH /api/recommendations/:ws/reorder` persists `sort_order` in `rec_operator_override`. The **public client projection orders by `sort_order`** (operator-ordered first, ascending; the rest by natural order). The archetype-grouped `BackingMovesQueue` (curation view) is UNCHANGED — reorder is purely the client-facing order, so it never fights the grouping.
4. **Competitor-rec bug fix:** the same retention branch covers `competitor:` sources (was a live regen-survival bug). No behavior change for sent/struck competitor recs; fixes the silent auto-resolve of un-sent ones.

---

## Shared contracts (PRE-COMMIT — controller owns)

- **Migration `145-rec-operator-override.sql`** (new):
  ```sql
  CREATE TABLE IF NOT EXISTS rec_operator_override (
    workspace_id TEXT NOT NULL,
    rec_id       TEXT NOT NULL,
    title        TEXT,
    insight      TEXT,
    sort_order   INTEGER,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (workspace_id, rec_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );
  ```
- **`shared/types/rec-operator-steering.ts`** (new):
  ```ts
  import type { RecType, RecPriority } from './recommendations.js';
  /** Manual-rec mint is allowed for every RecType EXCEPT cannibalization (deliverable-routed, needs a urlSetKey). */
  export const MANUAL_REC_ALLOWED_TYPES = [
    'content','content_refresh','keyword_gap','topic_cluster','technical','metadata',
    'schema','performance','accessibility','strategy','aeo','local_visibility','local_service_gap','competitor',
  ] as const;
  export type ManualRecType = typeof MANUAL_REC_ALLOWED_TYPES[number];
  export const REC_WORDING_TITLE_MAX = 160;
  export const REC_WORDING_INSIGHT_MAX = 600;
  export interface RecWordingOverridePayload { title?: string; insight?: string; }   // empty/absent both → clear that field
  export interface ReorderRecsPayload { recIds: string[]; }                          // curated recs in desired client order
  export interface CreateManualRecPayload {
    type: ManualRecType; title: string; insight: string;
    description?: string; priority?: RecPriority; targetKeyword?: string; affectedPages?: string[];
  }
  export interface OperatorOverridesResponse {
    workspaceId: string;
    wording: Record<string, { title?: string; insight?: string }>;
    sortOrder: Record<string, number>;
  }
  ```
- **`src/lib/queryKeys.ts`** — `admin.operatorOverrides: (wsId) => ['admin-operator-overrides', wsId] as const`.

---

## Lane B — Server (exclusive owner: `server/` non-test)

- Create `server/rec-operator-overrides.ts` — `createStmtCache`-backed store over `rec_operator_override`:
  - `getOperatorOverrides(workspaceId): { wording: Map<recId,{title?,insight?}>, sortOrder: Map<recId,number> }`.
  - `setWordingOverride(workspaceId, recId, { title?, insight? })` — upsert title/insight (NULL clears a field; if the row ends all-NULL, delete it). Caps enforced.
  - `setSortOrders(workspaceId, orderedRecIds: string[])` — in a `db.transaction()`, assign `sort_order = 0..n-1` to those recIds (upsert, preserving any title/insight on the row); rows not listed keep their existing sort_order? No — clear sort_order on all the workspace's rows first, then set for the listed ids (so a removed rec's stale order is dropped).
  - `applyWordingOverrides(workspaceId, recs): Recommendation[]` — returns SHALLOW-CLONED recs with `title`/`insight` overridden where present (never mutates the input/cached array; `loadRecommendations` stays pure).
  - `getSortOrderMap(workspaceId): Map<recId, number>` (used by the public projection ordering).
  - `pruneOverridesNotIn(workspaceId, liveRecIds: Set<string>)` — optional GC; OR skip (FK cascade handles workspace delete; orphan rec_ids are harmless no-ops). Skip for v1, document.
- Edit `server/recommendations.ts` `generateRecommendations` — add a retention branch in the auto-resolve loop, RIGHT AFTER the `isExemptFromAutoResolve` branch (~line 2605):
  ```ts
  // Operator-minted recs (manual:/competitor:) have no auto-producer, so their merge key is never in
  // newSources. Without this they auto-resolve to "completed" on the next regen. RETAIN as-is — the
  // operator owns their lifecycle; only an explicit strike removes them. (Fixes the live competitor-rec bug.)
  if (isOperatorMintedRec(oldRec)) {
    if (!newSources.has(buildMergeKey(oldRec))) recs.push({ ...oldRec });
    continue;
  }
  ```
  Add `export function isOperatorMintedRec(rec: { source: string }): boolean { return rec.source.startsWith('manual:') || rec.source.startsWith('competitor:'); }`.
- Edit `server/routes/recommendations.ts`:
  - `PATCH /api/recommendations/:workspaceId/:recId/wording` (body `RecWordingOverridePayload`) — verify the rec exists in the set; `setWordingOverride`; broadcast `RECOMMENDATIONS_UPDATED`; activity `rec_status_updated` (or a new `rec_wording_edited`). Validate caps + at-least-one-field-or-clear.
  - `PATCH /api/recommendations/:workspaceId/reorder` (body `ReorderRecsPayload`) — validate every recId exists + is curated; `setSortOrders`; broadcast.
  - `POST /api/recommendations/:workspaceId/manual-rec` (body `CreateManualRecPayload`) — validate `type ∈ MANUAL_REC_ALLOWED_TYPES`; mint (generalize the competitor-rec block: `source: 'manual:'+randomHex`, `actionType:'manual'`, sensible defaults for impact/effort/impactScore/estimatedGain/affectedPages); `loadRecommendations`→push→`computeRecommendationSummary`→`saveRecommendations` in a txn; broadcast; activity. Return the minted rec.
  - `GET /api/recommendations/:workspaceId/operator-overrides` → `OperatorOverridesResponse` (serialize the two maps to records).
  - In the existing admin `GET /api/recommendations/:workspaceId` handler, wrap the returned recs with `applyWordingOverrides(workspaceId, set.recommendations)` (display-only; do NOT save).
  - Literal routes before param routes; `requireWorkspaceAccess`; Zod via `validate()`.
- Edit `server/routes/recommendations.ts` public projection (the `GET /api/public/recommendations/:ws` path that calls `stripEmvFromPublicRecs`): apply `applyWordingOverrides` THEN order by `getSortOrderMap` (operator-ordered first asc, rest natural) — **flag-gated** (`isFeatureEnabled('strategy-the-issue', workspaceId)`), so non-Issue clients are byte-identical.

## Lane C — Frontend (exclusive owner: `src/`)

- Create `src/api/operatorSteering.ts` — `getOperatorOverrides`, `editRecWording(ws, recId, payload)`, `reorderRecs(ws, recIds)`, `createManualRec(ws, payload)`.
- Create `src/hooks/admin/useOperatorSteering.ts` — query `admin.operatorOverrides` (enabled-gated on the flag) + three mutations, each invalidating `admin.recommendations` + `admin.operatorOverrides` (and `shared.recommendations`); `useWorkspaceEvents` on `RECOMMENDATIONS_UPDATED`. Returns `{ wording, sortOrder, editWording, reorder, addManualRec, isPending }`.
- Edit `src/components/strategy/CockpitRow.tsx` — add an inline-edit affordance for `title` + `insight` (a pencil toggle → `FormInput` for title + `FormTextarea` for insight, commit-on-blur, calling an `onEditWording(recId, {title, insight})` prop). Threaded only when provided (default off → flag-OFF/command-center rows unchanged). Reuse the `DraftedPovEditor` EditableProse pattern.
- Create `src/components/strategy/issue/AddRecommendationModal.tsx` — `FormSelect` (type, from `MANUAL_REC_ALLOWED_TYPES`) + `FormInput` (title) + `FormTextarea` (insight) + `FormSelect` (priority) + optional targetKeyword; submit → `addManualRec`. Use `ConfirmDialog`/modal primitive.
- Create `src/components/strategy/issue/ClientRunningOrder.tsx` — `SectionCard` "Client running order"; lists the curated/sent recs in `sortOrder` order with up/down `IconButton`s; on move, call `reorder(newOrderedIds)`. `EmptyState` when none sent yet.
- Edit `src/components/KeywordStrategy.tsx` — thread `onEditWording` into the cockpit rows (flag-ON); mount an "Add a recommendation" button (opens `AddRecommendationModal`) + `<ClientRunningOrder>` in `issueOverviewEl` (flag-ON only). Flag-OFF path untouched.
- Edit `BRAND_DESIGN_LANGUAGE.md` — note the inline rec editor + add-rec modal + running-order panel.

## Lane D — Tests (exclusive owner: `tests/`)

- `tests/unit/rec-operator-overrides.test.ts` — store: set/get wording; clearing a field deletes when all-NULL; caps; `setSortOrders` assigns 0..n and drops stale order; `applyWordingOverrides` returns clones (does not mutate input) and overrides only present fields.
- `tests/integration/rec-operator-steering-regen.test.ts` — **the trust-critical test**: (a) a `manual:` rec survives a `generateRecommendations` regen (NOT auto-resolved to completed); (b) a `competitor:` rec survives regen (the bug fix); (c) a wording override keyed on a rec id still applies after the rec is re-minted with a carried-over id (override follows id continuity); (d) `loadRecommendations` after an override is UNCHANGED (no baking — the stored blob has source wording).
- `tests/integration/rec-operator-steering-routes.test.ts` — PATCH wording (caps rejected; applied in the admin GET serialization); POST manual-rec (disallowed type → 400; minted rec present with `manual:` source); PATCH reorder (non-curated/absent recId → 400; sort persisted); GET operator-overrides shape.
- `tests/integration/rec-operator-steering-public.test.ts` — the public client projection reflects a wording override + the reorder order WHEN the flag is on, and is byte-identical when off.

---

## Acceptance gates (controller)

- [ ] typecheck · vite build · full vitest · pr-check 0 errors · verify:feature-flags.
- [ ] **Trust-critical:** manual + competitor recs survive regen; wording override survives regen via id-continuity; NO baking (loadRecommendations pure). The scaled review MUST scrutinize the auto-resolve retention branch + the no-baking invariant.
- [ ] Flag-OFF byte-identical: cockpit rows, public projection, nav all unchanged; steering surfaces render flag-ON only.
- [ ] Two-axis invariant intact (manual mint sets clientStatus/lifecycle, never abuses RecStatus; wording edit touches only title/insight).
- [ ] Scaled adversarial review; fix all Critical/Important; re-gate.
- [ ] FEATURE_AUDIT #525 (operator-steering follow-up) + roadmap + memory boundary.
