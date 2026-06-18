# Strategy v3 — Curation Cockpit + Curated Client Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the admin Strategy page into a curation cockpit (operator triages system recommendations and curates a handful to clients) and the client dashboard into a curated, narrative-controlled "Recommended this month" delivery surface — all additive and gated behind the reused `strategy-command-center` flag.

**Architecture:** Recommendations gain a lightweight client-facing lifecycle (`clientStatus`) on a **separate axis** from the internal `RecStatus`; `strike`/`throttle`/`send` are lifecycle transitions written through one transactional single-writer module. The admin cockpit and the client curated overview are file-disjoint tracks that build in parallel against a pre-committed contract surface. Work-products stay on the deliverable/Inbox spine; recs are not deliverables.

**Tech Stack:** React 19 + Vite + Tailwind 4 (frontend), Express + TypeScript + SQLite/better-sqlite3 (backend), React Query, Zod, Pino, Vitest + Playwright.

**Source of truth:** design spec `docs/superpowers/specs/2026-06-18-strategy-v3-curation-cockpit-design.md` · parallelization map `docs/superpowers/audits/2026-06-18-strategy-v3-audit.md` · decision log `docs/superpowers/audits/2026-06-17-strategy-v2-feedback-audit-findings.md` (D1–D10).

---

## Dependency graph & execution stages

```
STAGE 1 (sequenced gate)        STAGE 2 (parallel tracks)            STAGE 3
┌───────────┐   ┌───────────┐   ┌─────────────────────────────┐   ┌──────────────────────┐
│ Phase 0   │──▶│ Phase 1   │──▶│ Track B: Phase 2 ──▶ Phase 3 │──▶│ Phase 5              │
│ v2 cutover│   │ lifecycle │   │ (admin cockpit)              │   │ 5A/5B block on P4    │
│ + legacy  │   │ foundation│   │            ‖                 │   │ 5C/5D/5E need only P2│
│ deletion  │   │ +contracts│   │ Track C: Phase 4             │   │ 5F last              │
└───────────┘   └───────────┘   │ (client curated overview)    │   └──────────────────────┘
                                 └─────────────────────────────┘
```

**The gate that makes Stage 2 safe:** Phase 1 **Lane 1A** commits the full contract surface (see "Part 0" below) BEFORE any Stage-2 dispatch. Tracks then only *add* handlers/UI against locked types — never edit shared enums. On the few shared-hot files (`server/routes/recommendations.ts`, `src/lib/queryKeys.ts`, `src/lib/wsInvalidation.ts`, `server/state-machines.ts`) the tracks append to disjoint regions and rebase in merge order **P1 → P2 → P4**.

## Model assignments (per lane)

| Lane type | Model | Examples |
|---|---|---|
| Contracts / single-writer / judgment / integration | **opus** | P1-1A/1B, P2-A routes, P3-Server, P4-4a/4e, P5-5A/5C |
| UI / hooks / logic-bearing | **sonnet** | P0-A/D, P1-1C/1D, P2-B/C, P3-Bulk/Attention, P4-4c/4d, P5-5B/5D/5E |
| Mechanical (deletes, barrels, docs) | **haiku** | P0-B, P5-5F |

## Parallel-execution protocol (mandatory)

- **Pre-commit contracts first.** Part 0 (Phase 1 Lane 1A) must merge before any Stage-2 lane is dispatched. A missing field discovered mid-Stage-2 is a Phase-1 amendment, not a Stage-2 edit.
- **Exclusive file ownership per lane.** Each lane below lists its files; no two concurrently-running lanes write the same file. Shared-hot files are owned by exactly one lane per stage; others rebase.
- **Controller commits per lane.** In this shared checkout, subagents never run git writes — the controller commits each lane's work (index contention destroyed work in a past run).
- **Diff-review checkpoint after every parallel batch:** `git diff`, grep for duplicate symbols, `npm run typecheck`, full `npx vitest run`.
- **Phase-per-PR, staging-first.** One PR per phase, merged to `staging` and CI-green before the next phase on that track opens. `<FeatureFlag flag="strategy-command-center">` dark-launches incomplete phases. Multi-agent phases → `scaled-code-review` before merge.

---

## Part 0 — Pre-commit Shared Contracts (Phase 1 Lane 1A authors these; every phase references them)

# Strategy v3 — Phase-1 Lane-1A Pre-Commit Contracts (LOCKED)

**Date:** 2026-06-18
**Spec:** `docs/superpowers/specs/2026-06-18-strategy-v3-curation-cockpit-design.md`
**Audit:** `docs/superpowers/audits/2026-06-18-strategy-v3-audit.md`
**Branch baseline:** `strategy-redesign-review-fixes` (v2 command-center on staging)

This file is the **single source of truth** for the 13 shared contracts that MUST land — committed and merged — in **Phase 1 Lane 1A** *before any Stage-2 parallel dispatch* (Track B P2→P3 ‖ Track C P4). Every Stage-2/Stage-3 lane **READS** these types/signatures/events and **never re-derives or renames** them. A field discovered missing mid-Stage-2 is a **Phase-1 amendment to this file**, not a Stage-2 edit (audit collision matrix: `shared/types/recommendations.ts` = single-owner).

**Locked decisions baked into these contracts:**
- **Flag = REUSE `strategy-command-center`.** Phase 0 is the v2 cutover (the command-center becomes the flag-OFF baseline; legacy branch deleted). **No flag-retirement migration.** v3 adds *child* flags under the existing umbrella.
- **`clientStatus` is a SEPARATE axis from `RecStatus`.** `strike`/`throttle`/`send` are lifecycle transitions, **never** `RecStatus` values.
- **`curated_recs_sent` email** is built/fired in **Phase 2** (from the send endpoint), but its `EmailEventType` + `CATEGORY_MAP` + recipient entry are **pre-committed here** so Track B/C never collide on the email files.
- **`rec_discussion` migration = 138** (latest existing = 137; no flag-retirement migration consumed a number under REUSE).
- **Strike** = arm-then-confirm on every rec + Undo. **Throttle** = 7/30/90 picker + on-read resurface. **`requireClientOwner`** gates spend (multiple owners allowed).

---

## 0. Migration ledger (assign once, no two phases collide)

> **Surprise corrected vs the audit:** the audit assumed RETIRE (Phase 0 takes 138, `rec_discussion` = 139). The LOCKED decision is **REUSE** — Phase 0 ships **no migration** (it deletes an inline flag branch + keeps the flag). So `rec_discussion` reclaims **138**, the next free number after the existing latest of 137. Every phase below cites its migration here so the numbers are allocated in one place.

| Migration # | File | Phase / Lane | What it does |
|---|---|---|---|
| 137 | `137-payments-cart-items.sql` | (existing — latest on `main`) | — baseline, do not touch — |
| **138** | `server/db/migrations/138-rec-discussion.sql` | **Phase 2 Lane A** | `CREATE TABLE rec_discussion` (schema = §7) |
| (none) | — | Phase 0 | REUSE flag → **no migration**. Phase 0 edits the inline flag branch in 3 shared components + keeps `strategy-command-center`. |
| (none) | — | Phase 1 | Lifecycle fields live **inside** the `recommendation_sets` JSON TEXT blob (migration `003`). **No new column, no migration.** |
| (none) | — | Phase 3 | `recResponses` is assembled from existing rows; staleness nudges key on `recId+nudgeKind` in-memory/idempotent. **No migration.** |
| (none) | — | Phase 4 | Client respond mutates the blob via the Phase-1 single-writer. **No migration.** |
| (none) | — | Phase 5 | `TopicCluster`/`opportunities` typing lives in the existing `keyword_strategies` blob. **No migration.** |

**Consumed by:** the migration runner (`npm run db:migrate`) + every phase that would otherwise guess a number. Phase 2 Lane A owns the only new migration (138).

---

## 1. Two-axis lifecycle field set on `Recommendation`

**File:** `shared/types/recommendations.ts` — insert the new fields **inside `interface Recommendation`, after `backfilled?` (line 49) and before `createdAt` (line 50)**. No migration: `recommendation_sets` is one JSON TEXT blob (migration `003`); these fields live inside each rec object.

```ts
  backfilled?: boolean;
  // ── Strategy v3 — two-axis client-facing lifecycle (SEPARATE from RecStatus) ──
  // RecStatus (status, above) stays the INTERNAL admin triage axis (pending/in_progress/
  // completed/dismissed). clientStatus + lifecycle are the v3 curation axes. strike/throttle/
  // send NEVER write RecStatus — a struck rec must never be swept to 'completed' and read as
  // "✓ done" to the client (the trust-critical graft, spec §6.1). All optional → byte-identical
  // on every legacy/flag-OFF rec (absent ⇒ treated as clientStatus:'system', lifecycle:'active').
  /** Curation axis: system (minted, not yet curated) → curated (operator picked) → sent
   *  (delivered to client) → approved | declined | discussing (client responded). */
  clientStatus?: 'system' | 'curated' | 'sent' | 'approved' | 'declined' | 'discussing';
  /** Suppression axis, orthogonal to clientStatus: active (default) | throttled (hidden
   *  until throttledUntil) | struck (permanently suppressed, won't be re-suggested). */
  lifecycle?: 'active' | 'throttled' | 'struck';
  /** ISO timestamp the throttle expires; the rec auto-resurfaces as active on-read once
   *  Date.now() passes this (no cron — spec §8). Only set when lifecycle==='throttled'. */
  throttledUntil?: string;
  /** ISO timestamp the rec was sent to the client. Set when clientStatus → 'sent'. */
  sentAt?: string;
  /** ISO timestamp the rec was struck. Set when lifecycle → 'struck'. */
  struckAt?: string;
  /** Cascade metadata for keyword/topic strikes that also remove items from strategy
   *  (spec §4.3 "removes from strategy — reversible"). Carries the reversal payload so
   *  Undo can restore the strategy items the strike removed. Absent on non-cascading strikes. */
  cascade?: { removedKeywords?: string[]; removedClusters?: string[]; reversible: boolean };
  /** Where a Send routes. 'deliverable' for RecTypes with a registered deliverable adapter
   *  (content_decay/cannibalization) — their Send goes to the deliverable spine and the rec
   *  reads its lifecycle from client_actions, NOT an independent clientStatus (spec §6.3).
   *  'rec' (default/absent) for all other RecTypes — Send mutates clientStatus directly. */
  sendChannel?: 'deliverable' | 'rec';
  createdAt: string;
```

> **Note:** `productType?` is **already** on the interface (line 30) — do **not** re-add it; the cockpit/curated CTAs (decision 1/2) read the existing field. Same for `assignedTo?` (line 44) and `impactBand?` (line 43).

**Matching Zod (lockstep — CLAUDE.md "Schema vs stored shape"):** `server/schemas/workspace-schemas.ts`, inside `recommendationSchema`, insert **after `assignedTo` (line 399) and before `createdAt` (line 400)**. The object is `.passthrough()` today, but the Zod-lockstep rule **requires explicit declaration** so a typo in a write path fails validation instead of silently surviving via passthrough.

```ts
  assignedTo: z.enum(['team', 'client']).optional(),
  // ── Strategy v3 lifecycle axes (lockstep with Recommendation in shared/types/recommendations.ts).
  // All .optional(): every PRE-v3 stored blob lacks these keys, so a REQUIRED field would drop the
  // whole rec on read (the "Schema vs stored shape" rule). Explicit (not passthrough-only) so a
  // mistyped write — e.g. clientStatus:'snet' — is caught at the read boundary, not silently kept.
  clientStatus: z.enum(['system', 'curated', 'sent', 'approved', 'declined', 'discussing']).optional(),
  lifecycle: z.enum(['active', 'throttled', 'struck']).optional(),
  throttledUntil: z.string().optional(),
  sentAt: z.string().optional(),
  struckAt: z.string().optional(),
  cascade: z.object({
    removedKeywords: z.array(z.string()).optional(),
    removedClusters: z.array(z.string()).optional(),
    reversible: z.boolean(),
  }).optional(),
  sendChannel: z.enum(['deliverable', 'rec']).optional(),
  createdAt: z.string(),
```

**Consumed by:** `isActiveRec` (§3), the single-writer `recommendation-lifecycle.ts` (P1 Lane 1B), the cockpit row model (P2 Lane B), the curated read + `CuratedRecCard` (P4 Lane 4d), the public allow-list (§4 of the spec / P1 Lane 1C).

---

## 2. `isActiveRec(rec)` predicate + export

**File:** `server/recommendations.ts` — add as an **exported function placed immediately above `computeRecommendationSummary` (line 599)** so the summary can call it (Lane 1B owns this file). Existing readers currently hand-roll `r.status !== 'completed' && r.status !== 'dismissed'` (line 600, 484, 572) — those leak `throttled`/`sent`/`struck` recs into summaries, AI context, and briefings. This is the ONE active-set predicate that replaces all of them.

```ts
/**
 * The ONE active-set predicate (spec §6.4). A rec is "active" — eligible to surface in the
 * Act queue, the summary top-rec, AI context, and briefings — iff:
 *   - RecStatus is not terminal (not completed, not dismissed), AND
 *   - it is not permanently struck, AND
 *   - it is not throttled into the future (throttle auto-resurfaces on-read once the date passes), AND
 *   - the client has not already received/resolved it (clientStatus not sent/approved/declined).
 * Absent v3 fields ⇒ legacy rec ⇒ treated as clientStatus:'system', lifecycle:'active'.
 * Imported by EVERY reader so no surface re-implements a partial filter (the leak bug pattern).
 */
export function isActiveRec(rec: Recommendation, now: number = Date.now()): boolean {
  if (rec.status === 'completed' || rec.status === 'dismissed') return false;
  if (rec.lifecycle === 'struck') return false;
  if (rec.lifecycle === 'throttled' && rec.throttledUntil && Date.parse(rec.throttledUntil) > now) return false;
  if (rec.clientStatus === 'sent' || rec.clientStatus === 'approved' || rec.clientStatus === 'declined') return false;
  return true;
}
```

**Every reader that MUST import it (P1 Lane 1B exports; Lane 1C retrofits the OTHER files):**
| Reader | File | Today |
|---|---|---|
| `computeRecommendationSummary` | `server/recommendations.ts:600` | hand-rolled `status` filter → replace with `isActiveRec` |
| operational-slice rec counter | `server/intelligence/operational-slice.ts:207` | hand-rolled → route through `isActiveRec` |
| seo-context-slice `topRec` | `server/intelligence/seo-context-slice.ts:481-486` | hand-rolled status filter (leaks throttled/sent into AI) |
| page-profile-slice | `server/intelligence/page-profile-slice.ts:70` | `status === 'pending'` filter |
| the public projection | `server/routes/recommendations.ts` (`stripEmvFromPublicRecs`) | allow-list pass filters with `isActiveRec` |
| the Act queue | `server/routes/recommendations.ts` admin GET (P2 mounts the cockpit list) | reads via `isActiveRec` + lifecycle filters |

**Consumed by:** all of the above + the P2 cockpit lifecycle chips and the P4 curated read's freshness check. Exit-gate test: `summary.topRecommendationId` is **never** a struck/throttled/sent rec.

---

## 3. State-machine transition maps (both axes)

**File:** `server/state-machines.ts`.

**(a) Extend the existing `RECOMMENDATION_TRANSITIONS` (line 100)** to add the **operator curation axis** (`system → curated → sent`). The existing internal `RecStatus` rows stay untouched — both axes coexist in one map keyed by the union of both status spaces (they never overlap: `system`/`curated`/`sent`/`approved`/`declined`/`discussing` are disjoint from `pending`/`in_progress`/`completed`/`dismissed`).

```ts
export const RECOMMENDATION_TRANSITIONS: Record<string, readonly string[]> = {
  // Internal RecStatus axis (unchanged) — admin triage.
  pending:     ['in_progress', 'completed', 'dismissed'],
  in_progress: ['pending', 'completed', 'dismissed'],
  completed:   ['pending', 'in_progress'],   // pending/in_progress = issue re-detected
  dismissed:   ['pending'],                  // un-dismiss
  // Strategy v3 operator curation axis (clientStatus) — admin-only (validated separately
  // from the client-side map below). 'system' is the implicit start for an absent clientStatus.
  system:      ['curated'],
  curated:     ['sent', 'system'],           // 'system' = operator un-curated before sending
  // 'sent' has NO operator-side forward edge here — the client owns sent → approved|declined|
  // discussing via CLIENT_REC_TRANSITIONS. (A re-send is a fresh sentAt, not a transition.)
};
```

**(b) Add `CLIENT_REC_TRANSITIONS` (the client-side axis)** — place immediately after `RECOMMENDATION_TRANSITIONS` (after line 105). The client respond route (P4 Lane 4a) validates against THIS map only; it must never touch `RecStatus`.

```ts
// Strategy v3 — client-side response axis (spec §7.2). A sent rec is the only thing the
// client can act on. Distinct from RecStatus AND from the operator curation axis: the
// client respond route (POST /api/public/recommendations/:ws/:recId/respond) validates
// ONLY against this map and mutates ONLY clientStatus — never RecStatus, never completion.
export const CLIENT_REC_TRANSITIONS: Record<string, readonly string[]> = {
  sent:       ['approved', 'declined', 'discussing'],
  discussing: ['approved', 'declined'],   // a discussion resolves to a decision
  approved:   [],                         // terminal (client side)
  declined:   [],                         // terminal (client side)
};
```

**Consumed by:** P2 Lane A admin send/curate routes (`validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, …)`), P4 Lane 4a client respond route (`validateTransition('recommendation', CLIENT_REC_TRANSITIONS, …)`). Pre-committing both here prevents the three-way append drift the collision matrix flags.

---

## 4. `ActivityType` registrations + client-visibility classification

**File:** `server/activity-log.ts`.

**(a)** Add the four rec lifecycle types to the closed `ActivityType` union — insert **after `'rec_dismissed'` (line 148)**:

```ts
  | 'rec_dismissed'        // client dismissed a recommendation
  // Strategy v3 curation lifecycle (spec §7.5). rec_sent + rec_approved are CLIENT-VISIBLE
  // (real client-facing milestones); rec_struck + rec_throttled are ADMIN-ONLY (internal
  // curation hygiene the client must never see — a struck rec read as activity would leak
  // "we decided not to do this").
  | 'rec_sent'             // CLIENT-VISIBLE: operator sent a curated rec to the client
  | 'rec_approved'         // CLIENT-VISIBLE: client approved a sent rec
  | 'rec_struck'           // admin-only: operator permanently suppressed a rec
  | 'rec_throttled'        // admin-only: operator throttled a rec for 7/30/90 days
```

**(b)** Classify the two client-visible ones into `CLIENT_VISIBLE_TYPES` — append to the `Set` initializer (after `'deliverable_sent', 'deliverable_responded',` on line 206):

```ts
  'deliverable_sent', 'deliverable_responded',
  'rec_sent', 'rec_approved',
]);
```

`rec_struck` / `rec_throttled` are deliberately **omitted** from `CLIENT_VISIBLE_TYPES` (admin-only audit trail).

**Consumed by:** P2 Lane A (`addActivity(ws, 'rec_sent'|'rec_struck'|'rec_throttled', …)`), P4 Lane 4a (`addActivity(ws, 'rec_approved', …)`), and the client activity feed read (`selectClientVisible`). All four registered here keeps Track B/C from racing the closed union.

---

## 5. WS event — `RECOMMENDATIONS_DISCUSSION_UPDATED` (the 4-file quartet)

`RECOMMENDATIONS_UPDATED` already exists across all four files (verified: `server/ws-events.ts:135`, `src/lib/wsEvents.ts:89`, `src/hooks/useWsInvalidation.ts:74`, `src/lib/wsInvalidation.ts:400`+`571`). The discuss substrate needs **one net-new** event (zero matches today). Register it in all four so Track B (P2 substrate) and Track C (P4 client discuss UI) share one constant.

**(1) `server/ws-events.ts`** — after `RECOMMENDATIONS_UPDATED` (line 135):

```ts
  // Recommendations
  RECOMMENDATIONS_UPDATED: 'recommendations:updated',
  RECOMMENDATIONS_DISCUSSION_UPDATED: 'recommendations:discussion_updated',
```

**(2) `src/lib/wsEvents.ts`** — after `RECOMMENDATIONS_UPDATED` (line 89):

```ts
  // Recommendations
  RECOMMENDATIONS_UPDATED: 'recommendations:updated',
  RECOMMENDATIONS_DISCUSSION_UPDATED: 'recommendations:discussion_updated',
```

**(3) `src/hooks/useWsInvalidation.ts`** — in the registry map, after the `RECOMMENDATIONS_UPDATED` line (line 74):

```ts
    [WS_EVENTS.RECOMMENDATIONS_UPDATED]: () => invalidateRegistry(WS_EVENTS.RECOMMENDATIONS_UPDATED),
    [WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED]: () => invalidateRegistry(WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED),
```

**(4) `src/lib/wsInvalidation.ts`** — add a `case` in the admin branch (the switch around line 400; place after the `RECOMMENDATIONS_UPDATED` block ending line 409). The concrete query keys are declared in §9; P2 Lane C / P4 Lane 4c fill the exact key set when they own the hooks:

```ts
    case WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED:
      return [
        queryKeys.admin.recDiscussion(workspaceId),
        queryKeys.client.curatedRecommendations(workspaceId),
      ] as const;
```

**Consumed by:** P2 Lane A broadcasts `RECOMMENDATIONS_DISCUSSION_UPDATED` after a discuss write; P2 `useRecDiscussion` + P4 `CuratedRecDiscussThread` re-fetch on it. (Note: `wsInvalidation.ts` has a SECOND `RECOMMENDATIONS_UPDATED` case at line 571 in the client branch — P4 Lane 4c adds `curatedRecommendations` there; out of scope for Lane 1A which only commits the event constant + the one admin case.)

---

## 6. `rec_discussion` table schema + read-shape interface

The discuss substrate is built in **Phase 2** (migration 138 + writer), but the **table schema and read shape are pre-committed here** so Phase-4's client discuss UI builds against a frozen contract in parallel (the one genuine Track-B↔Track-C coupling, resolved by pre-commit per the audit).

**(a) Migration 138** — `server/db/migrations/138-rec-discussion.sql` (Phase 2 Lane A creates the file; this is the exact, locked DDL):

```sql
-- 138-rec-discussion.sql
-- Strategy v3 (spec §6.7) — the Discuss substrate. Recs are NOT deliverables, so a
-- discussion is NOT a client_action thread (forbidden by D2) and NOT the single client_note
-- column. This is a minimal append-only thread keyed to a rec id within a workspace.
-- recId is the in-blob Recommendation.id (recommendation_sets is a JSON blob — no FK target),
-- so NO foreign key; workspace_id scopes every read/write/delete.
-- DB column + mapper lockstep: ships with RecDiscussionRow + rowToRecDiscussion + the writer
-- in server/rec-discussion.ts (Phase 2 Lane A). Not on a public-portal serialization list
-- directly — the client reads discussion via the authenticated curated read.
CREATE TABLE IF NOT EXISTS rec_discussion (
  id           TEXT NOT NULL PRIMARY KEY,
  rec_id       TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author       TEXT NOT NULL,            -- 'client' | 'strategist' (display role, not a user id)
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_discussion_ws_rec ON rec_discussion(workspace_id, rec_id, created_at);
```

**(b) Read-shape interface** — `shared/types/recommendations.ts`, appended after the existing exports (end of file, after `OpportunityWeights`):

```ts
/** One entry in a recommendation discussion thread (spec §6.7). Backed by the rec_discussion
 *  table (migration 138). `author` is a display role, not a user id — 'client' (the client's
 *  question) or 'strategist' (the agency reply). Read by the cockpit Discuss filter (P2) and
 *  the client CuratedRecDiscussThread (P4); both build against THIS shape before the substrate
 *  exists (the pre-committed Track-B↔Track-C contract). */
export interface RecDiscussionEntry {
  id: string;
  recId: string;
  workspaceId: string;
  author: 'client' | 'strategist';
  body: string;
  createdAt: string;        // ISO timestamp
}
```

**Consumed by:** P2 Lane A `server/rec-discussion.ts` (writer + `rowToRecDiscussion` mapper), P2 `useRecDiscussion` (admin), P4 `useRecDiscussion` (client) + `CuratedRecDiscussThread`.

---

## 7. `ClientSignalsSlice.recResponses`

**File:** `shared/types/intelligence.ts` — add to `interface ClientSignalsSlice`, **after `clientActions?` (the block ending line 482) and before the closing brace (line 483)**:

```ts
  clientActions?: {
    pending: number;
    approved: number;
    changesRequested: number;
    completed: number;
    recentDecisions: Array<{ title: string; status: string; sourceType: string; updatedAt: string }>;
  };
  /**
   * Strategy v3 (spec §7.5, data-flow rule #6) — the client's responses to SENT curated recs.
   * The outcome write alone is not enough for AdminChat/strategy to "see the loop" — this slice
   * field surfaces it. Counts derive from Recommendation.clientStatus across the rec set; the
   * outcome (approve→TrackedAction, decline→advisory learning) is recorded separately.
   * Populated by `assembleClientSignals` (P3 writes); read by the curated overview context (P4).
   * Field declared here in Phase 1 Lane 1A — Track B (P3 writes) and Track C (P4 reads) both
   * touch this file, so the shape is frozen before either dispatches.
   */
  recResponses?: {
    approved: number;
    declined: number;
    discussing: number;
    recentResponses: Array<{ title: string; clientStatus: string; respondedAt: string }>;
  };
}
```

**Consumed by:** P3 Lane Server (`assembleClientSignals` in `server/intelligence/client-signals-slice.ts` writes it), P4 (curated overview reads it via `buildWorkspaceIntelligence`), AdminChat context. Declared here (not in P3) because it is the cross-track same-file field the collision matrix flags.

---

## 8. Query-key namespaces (admin + client)

**File:** `src/lib/queryKeys.ts`. The **shared** recommendations key (line 293, `['recommendations', wsId]`) stays **byte-identical** — never touched — so the flag-OFF public snapshot holds. Two net-new keys, in two different object literals (trivially mergeable; P2 owns admin, P4 owns client — pre-declared here so neither guesses the other's shape).

**(a) admin** — after `recommendations:` (line 120):

```ts
    recommendations: (wsId: string) => ['admin-recommendations', wsId] as const,
    /** Strategy v3 — discussion thread for a workspace's recs (admin cockpit Discuss filter). */
    recDiscussion: (wsId: string) => ['admin-rec-discussion', wsId] as const,
```

**(b) client** — inside the `client:` literal, after `activity:` (line 222):

```ts
    activity: (wsId: string) => ['client-activity', wsId] as const,
    /** Strategy v3 — the curated, clientStatus='sent' recs the client actually sees (spec §7.2).
     *  DISTINCT from shared.recommendations (the raw read) — its own key so the curated overview
     *  invalidates independently and the byte-identical shared key is never disturbed. */
    curatedRecommendations: (wsId: string) => ['client-curated-recommendations', wsId] as const,
```

**Consumed by:** §5's `RECOMMENDATIONS_DISCUSSION_UPDATED` invalidation case (already references both), P2 `useRecDiscussion`, P4 `useCuratedRecommendations`, and both `wsInvalidation.ts` `RECOMMENDATIONS_UPDATED` branches (P4 adds `curatedRecommendations` to the line-400 and line-571 cases).

---

## 9. `curated_recs_sent` email contract (event type + category + recipient)

Built/fired in **Phase 2** (from the send endpoint, spec §7.1), but its three type-enforced registrations are pre-committed here so the email files carry **zero** Track-B/C collision. Do **NOT** reuse `recommendations_ready` — its 14-day `audit` cooldown silently swallows curated sends.

**(a) `EmailEventType`** — `server/email-templates.ts`, append to the union (after `'work_order_comment_client'`, line 191):

```ts
  | 'work_order_comment_client'
  | 'curated_recs_sent';
```

**(b) `CATEGORY_MAP`** — `server/email-throttle.ts`. The map is `Record<EmailEventType, ThrottleCategory>` (a miss is a **compile error**). Add to the `'action'` bucket (3/day, respects the 5/day global cap), after `work_order_comment_client` (line 64):

```ts
  work_order_comment_client: 'action',     // team → client reply
  curated_recs_sent: 'action',             // Strategy v3 — batched "N recs ready for your decision"
```

**(c) Recipient policy** — `server/notification-recipients.ts`. Add to the `ClientNotificationEventType` `Extract` (after `'work_order_comment_client'`, line 39):

```ts
  | 'work_order_comment_client'
  | 'curated_recs_sent'
```

…and the policy entry in `CLIENT_NOTIFICATION_RECIPIENT_POLICIES` (it `satisfies Record<ClientNotificationEventType, …>` — a miss is a compile error; add after the `fixes_applied` / `work_order_comment_client` block):

```ts
  curated_recs_sent: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Curated recommendation sends notify the primary workspace client contact — the doorbell back to the hub.',
  },
```

> Pre-declaring the type here means Phase 2 Lane A only writes the **template body + send call**; it never edits the union/map/recipient surface, so Track C never touches these files. (Audit resolution: move the email lane into P2-Lane A, delete from Phase 4.)

**Consumed by:** P2 Lane A send endpoint (renders `curated_recs_sent`, throttled via `getThrottleCategory`, routed via the recipient policy).

---

## 10. Feature flags (REUSE — child flags under `strategy-command-center`)

**File:** `shared/types/feature-flags.ts`. **Keep** `strategy-command-center` (line 59) — it is the v3 umbrella; Phase 0 makes its **ON** branch the v3 target and its **OFF** branch the validated command-center baseline. **Add two child flags.** `assertFeatureFlagGroupingConsistency()` is **import-time** — all three edits (FLAGS map, CATALOG, group keys array) MUST land in one commit or module load throws.

**(a) `FEATURE_FLAGS`** — after `'strategy-command-center': false,` (line 59):

```ts
  'strategy-command-center': false,
  // Strategy v3 — staleness scan child flag. Dark-launches the runSentRecStalenessScan cron
  // pass (sent-rec "no response 14d" nudges + supersession flags). OFF = no nudge engine.
  'strategy-staleness-scan': false,
  // Strategy v3 — DEFERRED paid-topic monetization spine (generic strategy_addon SKU +
  // rec→cart bridge for keyword/topic rec types). OFF until the roadmap item lands; v3 renders
  // Add-to-plan ONLY where rec.productType already resolves a SKU (decision 1 / spec §2 / §11).
  'strategy-paid-topics': false,
} as const;
```

**(b) `FEATURE_FLAG_CATALOG`** — add two entries before the closing brace (after the `strategy-command-center` entry ends line 294):

```ts
  'strategy-staleness-scan': {
    label: 'Strategy v3 — sent-rec staleness scan (nudge + supersession cron)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-18',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once the on-read throttle resurface + nudge cron cost is validated on staging; flag removed and the scan runs unconditionally in the 24h outcome tick.',
      linkedRoadmapItemId: 'strategy-v3-curation-cockpit',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-18',
    },
  },
  'strategy-paid-topics': {
    label: 'Strategy v3 — paid-topic monetization spine (DEFERRED roadmap)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-18',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Enable + remove once the generic strategy_addon SKU + rec→cart bridge + keyword/topic product map ship (deferred roadmap item D8). Until then v3 renders Add-to-plan only where rec.productType already resolves.',
      linkedRoadmapItemId: 'strategy-paid-topic-monetization-spine',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-18',
    },
  },
};
```

**(c) `FEATURE_FLAG_GROUPS`** — add both keys to the `'Strategy'` group's `keys` array (line 324):

```ts
    keys: ['signal-auto-recompute', 'strategy-command-center', 'strategy-staleness-scan', 'strategy-paid-topics'],
```

Verify with `npm run verify:feature-flags`.

**Consumed by:** `strategy-staleness-scan` gates the P3 `runSentRecStalenessScan` cron; `strategy-paid-topics` gates the deferred P4/P5 paid-topic CTA path (`Add to plan` for keyword/topic recs). Both checked via `isFeatureEnabled(flag, workspaceId)`.

---

## 11. `strategy_recommendation` adapter type + per-RecType policy registry shape

**Net-new** (grep-confirmed: zero matches for `StrategyRecommendationPayload` / `strategy_recommendation` in the repo). Pre-committed here so P5 Lane 5C (#6b keyword-opportunity typed-send) and the P1/P2 single-writer policy registry build against one shape. **File:** `shared/types/recommendations.ts`, appended after `RecDiscussionEntry` (§6).

```ts
/** Strategy v3 — the payload an adapter emits to turn a domain item (keyword opportunity,
 *  topic cluster, content gap) INTO a sendable recommendation via the per-row Send spine.
 *  P5 Lane 5C (#6b) builds the keyword-opportunity adapter against this; the policy registry
 *  (below) decides routing (rec vs deliverable) per RecType. Net-new — zero prior matches. */
export interface StrategyRecommendationPayload {
  type: RecType;
  title: string;
  description: string;
  insight: string;                        // "why this matters" — feeds the curated card's why-line
  affectedPages: string[];
  /** Optional pre-resolved product for the priced CTA (decision 1 — Add-to-plan only when set). */
  productType?: string;
  productPrice?: number;
  /** The source domain entity id (e.g. the keyword string or cluster topic) for de-dup + lineage. */
  sourceKey: string;
  source: string;                         // which analysis produced it (mirrors Recommendation.source)
}

/** Per-RecType curation policy (spec §6.2 single-writer policy registry). One entry per RecType
 *  the single-writer (server/recommendation-lifecycle.ts) knows how to mutate. `sendChannel`
 *  decides whether Send mutates clientStatus directly ('rec') or routes to the deliverable spine
 *  ('deliverable' — content_decay/cannibalization read lifecycle from client_actions, spec §6.3).
 *  `cascadeOnStrike` marks RecTypes whose strike also removes strategy items (keyword/topic). */
export interface RecPolicy {
  sendChannel: 'rec' | 'deliverable';
  cascadeOnStrike: boolean;
  /** True when this RecType resolves a productType → a priced Add-to-plan CTA is allowed. */
  monetizable: boolean;
}

/** The registry shape the single-writer consumes. Keyed by RecType; an unlisted RecType is a
 *  bug (it cannot be curated until a policy is registered). Populated in P1 Lane 1B. */
export type RecPolicyRegistry = Partial<Record<RecType, RecPolicy>>;
```

**Consumed by:** P1 Lane 1B `recommendation-lifecycle.ts` (reads `RecPolicyRegistry` to route Send/Strike), P5 Lane 5C `server/routes/public-content.ts` + `KeywordOpportunities.tsx` (emit `StrategyRecommendationPayload` from a keyword opportunity).

---

## 12. `TopicCluster` typed fields + `opportunities` typed shape

**(a) `TopicCluster`** — `shared/types/workspace.ts`, add two fields to `interface TopicCluster` (lines 119-130), before the closing brace (after `gap` line 128). Net-new (the cluster has **neither** today — the line-115 `rationale` belongs to a *different* interface). Single-owner: P5 Lane 5D. Pre-committed here so no other phase rewrites the interface.

```ts
  gap: string[];                 // keywords in cluster without ranking or strategy/page coverage
  /** Strategy v3 (#9) — operator/AI rationale for prioritizing this cluster. Optional: legacy
   *  blobs and clusters minted before v3 lack it; the cluster card hides the line when absent. */
  rationale?: string;
  /** Strategy v3 (#9) — banded projected impact of closing this cluster's gap. Client-safe
   *  (banded, never a raw $ figure — mirrors Recommendation.impactBand). Optional on legacy blobs. */
  projectedImpact?: ImpactBand;
}
```

This requires an `ImpactBand` import in `shared/types/workspace.ts`. If absent, add to the top-of-file imports (grouped with existing imports — CLAUDE.md "Imports at top of file"):

```ts
import type { ImpactBand } from './impact-band.js';
```

**(b) `opportunities` typed shape** — `shared/types/keyword-strategy.ts`. Today `opportunities: string[]` (line 38, `StoredKeywordStrategy`) and line 156 (`KeywordStrategy`). #6b needs a richer shape for the "interested?" typed-send, but a bare-string→object rewrite would break every existing reader. Pre-commit a **parallel optional typed field** (leave `string[]` intact for the byte-identical read path; P5 populates the typed field):

```ts
  /** Keyword gaps / untapped opportunities (blob-sourced). */
  opportunities: string[];
  /** Strategy v3 (#6b) — typed opportunities backing the per-row "interested?" send. Parallel
   *  to the bare `opportunities` string[] above (which stays for the byte-identical read path);
   *  P5 Lane 5C populates this. Optional: absent on every pre-v3 blob. */
  opportunitiesDetailed?: Array<{
    keyword: string;
    volume?: number;
    difficulty?: number;
    rationale?: string;
  }>;
```

> **Surprise / decision for `writing-plans`:** the audit lists `opportunities` as the field to "type." Rewriting `string[]` in place is a breaking change across every keyword-strategy reader + the public serialization (`server/routes/public-content.ts:210`). The DRY-safe contract is the **parallel `opportunitiesDetailed?`** field above — it preserves the byte-identical read path (a hard v3 gate) while giving #6b its typed shape. If `writing-plans` prefers an in-place rewrite, that is a larger P5 sub-task with its own public-serialization migration and must be scoped explicitly.

**Consumed by:** P5 Lane 5D `server/topic-clusters.ts` + `TopicClusters.tsx` (`TopicCluster.rationale`/`projectedImpact`), P5 Lane 5C `KeywordOpportunities.tsx` + `public-content.ts` (`opportunitiesDetailed`).

---

## 13. Contract-landing checklist (Phase 1 Lane 1A exit gate)

All of the following land in **one Phase-1 Lane-1A commit** (or a tight sequence merged before any Stage-2 dispatch), verified green:

- [ ] `shared/types/recommendations.ts` — lifecycle fields (§1) + `RecDiscussionEntry` (§6b) + `StrategyRecommendationPayload`/`RecPolicy`/`RecPolicyRegistry` (§11)
- [ ] `server/schemas/workspace-schemas.ts` — lifecycle Zod (§1)
- [ ] `server/recommendations.ts` — `isActiveRec` export (§2)
- [ ] `server/state-machines.ts` — `RECOMMENDATION_TRANSITIONS` operator axis + `CLIENT_REC_TRANSITIONS` (§3)
- [ ] `server/activity-log.ts` — four `rec_*` types + `CLIENT_VISIBLE_TYPES` classification (§4)
- [ ] WS quartet — `RECOMMENDATIONS_DISCUSSION_UPDATED` (§5)
- [ ] `shared/types/intelligence.ts` — `ClientSignalsSlice.recResponses` (§7)
- [ ] `src/lib/queryKeys.ts` — `admin.recDiscussion` + `client.curatedRecommendations` (§8); `shared.recommendations` byte-identical
- [ ] `server/email-templates.ts` + `server/email-throttle.ts` + `server/notification-recipients.ts` — `curated_recs_sent` (§9)
- [ ] `shared/types/feature-flags.ts` — two child flags across FLAGS + CATALOG + group keys (§10)
- [ ] `shared/types/workspace.ts` — `TopicCluster.rationale`/`projectedImpact` (§12a)
- [ ] `shared/types/keyword-strategy.ts` — `opportunitiesDetailed?` (§12b)
- [ ] Migration ledger (§0) recorded; `rec_discussion` = 138 reserved for P2

**Verify:**
```
npm run typecheck          # zero errors (tsc -b — both app + node configs)
npx vite build             # builds
npm run verify:feature-flags   # the two child flags grouped + cataloged consistently
npx tsx scripts/pr-check.ts    # zero errors (Zod-lockstep, no bare JSON.parse, etc.)
```

Expected: all green. `typecheck` is the load-bearing gate — `CATEGORY_MAP` (§9b) and `CLIENT_NOTIFICATION_RECIPIENT_POLICIES` (§9c) are type-enforced Records, so a missing entry is a compile error, not a silent pass.

---

*End of Phase-1 Lane-1A pre-commit contracts. Stage-2 dispatch is BLOCKED until every box above is checked and merged.*


---

# Part 1 — Phases

## Phase 0 — v2 cutover + legacy deletion (Stage 1 gate, ROOT)

**Goal:** make the Strategy v2 "command-center" layout the **flag-OFF baseline** by deleting the three legacy/flat branches that the `strategy-command-center` flag currently gates, and dropping all `commandCenterEnabled` prop threading. Under the LOCKED **REUSE** decision there is **no flag-retirement migration** — the `strategy-command-center` flag is *kept* as the v3 umbrella; Phase 0 only collapses its OFF branch into the unconditional render. After Phase 0, the command-center is what every workspace sees on the strategy surfaces, and the flag's ON branch becomes the target Phase 1+ builds into. **What merges before this:** nothing — Phase 0 is the ROOT of the whole v3 DAG. **What this gates:** Phase 1 rebases onto Phase 0's merge (the `shared/types/feature-flags.ts` `assertFeatureFlagGroupingConsistency()` import-time invariant forbids concurrent edits — but Phase 0 does **not** touch feature-flags.ts under REUSE, so Phase 0's only hard gate on Phase 1 is component-shape finality). The **exit gate** is the standard quad (`typecheck` · `vite build` · `vitest run` for the two touched component tests · `pr-check`) plus a verify-only pass on the route/nav/deep-link contract tests (Phase 0 is NOT a route removal — `seo-strategy` Page and `strategy` ClientTab both survive).

**Lane order & ownership (exclusive files per lane):**

| Lane | Model | Blocked by | Files (exclusive) |
|---|---|---|---|
| **A** (ROOT) | sonnet | none | `src/components/KeywordStrategy.tsx`; `src/components/client/StrategyTab.tsx`; `src/components/ClientDashboard.tsx` |
| **B** | haiku | Lane A (import prune must land first → zero importers) | `src/components/strategy/StrategyStatGrid.tsx`; `tests/unit/strategy/StrategyStatGrid.test.tsx`; `src/components/strategy/KeywordStrategyGuide.tsx`; `src/components/strategy/index.ts` (StatGrid barrel line only) |
| **C** | opus | none (but lands before Phase 1's feature-flags edit) | `src/components/strategy/index.ts` (cutover comment + barrel reconcile); `scripts/pr-check.ts` (only if a guard is warranted) |
| **D** | sonnet | Lane A (component shape final) | `server/routes/keyword-strategy.ts`; `server/routes/public-content.ts`; `tests/component/client/StrategyTab.test.tsx`; `tests/component/ClientDashboard.test.tsx` |

> **Barrel-ownership note (Lane B vs Lane C on `src/components/strategy/index.ts`):** to honor exclusive file ownership, **Lane B owns the single `export * from './StrategyStatGrid';` line** (it deletes it in the same commit that deletes the file). **Lane C owns the rest of the barrel** (the cutover comment block + verifying no other dead exports). The two lanes touch disjoint lines; Lane C rebases onto Lane B's one-line removal. If you are running both lanes as one agent, do the StatGrid line removal inside Lane B's delete commit and the comment reconcile in Lane C's commit — never edit the same line twice.

---

### Lane A (sonnet) [ROOT] — frontend layout collapse

Collapse the three flag branches so the command-center layout renders unconditionally. The `strategy-command-center` flag stays in `shared/types/feature-flags.ts` (Lane A does NOT touch that file) — Lane A only removes the *reads* of it inside these three components and the dead legacy branches they gated.

**Blocked by:** none (ROOT). Everything else in Phase 0 waits on this lane's merge.

#### Task A.1: Pin the admin command-center as the baseline (failing test first)

The repo has no direct unit test asserting `KeywordStrategyPanel` renders the command-center layout regardless of flag — the existing coverage is the client `StrategyTab.test.tsx`. We assert the behavior via the client component first (Task A.4) because `KeywordStrategyPanel` needs a QueryClient + many hooks. For the admin panel, the proof is the build + the absence of the legacy `Analysis/Guide` TabBar. Start by confirming the current state compiles, so any regression is attributable to your edit.

**Files:** none (baseline check).

1. Run the baseline typecheck so you know it is green before you start:
   ```
   npm run typecheck
   ```
   Expected: `tsc -b` exits 0, zero errors.

#### Task A.2: Delete the legacy `Analysis/Guide` layout + flag read in `KeywordStrategy.tsx`

**Files:** `src/components/KeywordStrategy.tsx`

The component currently has two layouts: `commandCenterAnalysis` (flag ON, lines 413–486) and `legacyAnalysis` (flag OFF, lines 489–533), chosen by `if (commandCenterEnabled) return commandCenterAnalysis;` (line 536) with the legacy `Analysis/Guide` TabBar return below it (lines 538–549). Under the cutover, `commandCenterAnalysis` becomes the only layout.

1. **Remove the flag read.** Delete the `commandCenterEnabled` declaration and its comment (lines 71–72):
   ```tsx
   // Strategy v2 "SEO command center" — Orient zone replaces the legacy stat grid when ON.
   const commandCenterEnabled = useFeatureFlag('strategy-command-center');
   ```
   Then delete the now-unused import (line 11):
   ```tsx
   import { useFeatureFlag } from '../hooks/useFeatureFlag';
   ```

2. **Unconditionally enable the two flag-gated fetches.** The Act-queue and content-decay reads were `{ enabled: commandCenterEnabled }`. The command-center is now always on, so they are always enabled. Replace line 116:
   ```tsx
   const { data: recommendationSet } = useAdminRecommendationSet(workspaceId, { enabled: commandCenterEnabled });
   ```
   with:
   ```tsx
   const { data: recommendationSet } = useAdminRecommendationSet(workspaceId);
   ```
   and replace line 122:
   ```tsx
   const { data: contentDecayData } = useContentDecay(workspaceId, { enabled: commandCenterEnabled });
   ```
   with:
   ```tsx
   const { data: contentDecayData } = useContentDecay(workspaceId);
   ```

3. **Simplify `orientEl`** — drop the `commandCenterEnabled &&` guard (line 388–391). Replace:
   ```tsx
   // Strategy v2 Orient zone — replaces the legacy stat grid when the command-center flag is on.
   const orientEl = commandCenterEnabled && isRealStrategy
     ? <OrientZone orient={strategy?.strategyUx?.orient} />
     : null;
   ```
   with:
   ```tsx
   // Strategy command-center Orient zone (the cutover baseline — always rendered for a real strategy).
   const orientEl = isRealStrategy
     ? <OrientZone orient={strategy?.strategyUx?.orient} />
     : null;
   ```

4. **Simplify `useActQueue`** — drop the `commandCenterEnabled &&` guard (line 392–398). Replace:
   ```tsx
   // Strategy v2 Act zone — the unified impact-ranked recommendation queue. It replaces the legacy
   // quick-wins / LHF / content-gaps / keyword-gaps sections (which it already unifies) ONLY once the
   // recommendation set actually has content. Until then (fresh strategy before regen runs, a
   // pre-engine workspace, or a fetch error) the legacy sections stay as a fallback so no actionable
   // content is hidden behind an empty queue.
   const useActQueue = commandCenterEnabled && isRealStrategy && hasActiveRecommendations;
   const actQueueEl = useActQueue ? <ActQueue workspaceId={workspaceId} /> : null;
   ```
   with:
   ```tsx
   // Act zone — the unified impact-ranked recommendation queue. It replaces the quick-wins / LHF /
   // keyword-gaps sections ONLY once the recommendation set actually has content. Until then (fresh
   // strategy before regen runs, a pre-engine workspace, or a fetch error) those sections stay as a
   // fallback so no actionable content is hidden behind an empty queue.
   const useActQueue = isRealStrategy && hasActiveRecommendations;
   const actQueueEl = useActQueue ? <ActQueue workspaceId={workspaceId} /> : null;
   ```

5. **Delete the `legacyAnalysis` block** (lines 488–533, the whole `const legacyAnalysis = ( … );`).

6. **Delete the flag branch + legacy TabBar return** (lines 535–549). Replace:
   ```tsx
   // Strategy v2 command-center layout (flag ON) — interior ?tab= tabs, no Analysis/Guide TabBar.
   if (commandCenterEnabled) return commandCenterAnalysis;

   return (
     <div className="space-y-8">
       {/* tab-deeplink-ok: the legacy Analysis/Guide TabBar is state-only, not a ?tab= target; the v2 interior tabs are the receiver */}
       <TabBar
         tabs={[{ id: 'analysis', label: 'Analysis' }, { id: 'guide', label: 'Guide' }]}
         active={strategyTab}
         onChange={(id) => setStrategyTab(id as 'analysis' | 'guide')}
       />
       {strategyTab === 'guide' && <KeywordStrategyGuide />}
       {strategyTab === 'analysis' && legacyAnalysis}
     </div>
   );
   }
   ```
   with:
   ```tsx
   // Command-center layout is the baseline (v2 cutover) — interior ?tab= tabs, no Analysis/Guide TabBar.
   return commandCenterAnalysis;
   }
   ```
   Rename the surviving layout for clarity — change line 412–413:
   ```tsx
   // ── Strategy v2 command-center layout (flag ON): page chrome + interior tabs (Overview / Content) ──
   const commandCenterAnalysis = (
   ```
   to:
   ```tsx
   // ── Strategy command-center layout (the baseline): page chrome + interior tabs (Overview / Content) ──
   const strategyLayout = (
   ```
   and update the single reference in the new return: `return strategyLayout;`.

7. **Remove the now-dead `strategyTab` state + `KeywordStrategyGuide` import.** The `Analysis/Guide` TabBar was the only consumer of `strategyTab`. Delete line 69:
   ```tsx
   const [strategyTab, setStrategyTab] = useState<'analysis' | 'guide'>('analysis');
   ```
   and the import (line 7):
   ```tsx
   import { KeywordStrategyGuide } from './strategy/KeywordStrategyGuide';
   ```

8. **Remove the four legacy-only `realLeaves` keys + their imports.** Grep-confirmed the keys `statGrid`, `distribution`, `backlink`, `competitive` were referenced **only** inside `legacyAnalysis`; `BacklinkProfile`, `CompetitiveIntel`, `RankingDistribution`, `StrategyStatGrid` are still re-imported and used by `StrategyRankingsTab`/`StrategyCompetitiveTab`, so the *components* survive — only the dead `KeywordStrategy.tsx` imports + leaf definitions go.

   Delete from the `realLeaves` object (lines 319–340 and 364–372): the `statGrid:` entry, the `distribution:` entry, the `backlink:` entry, and the `competitive:` entry. Concretely remove:
   ```tsx
   statGrid: (
     <StrategyStatGrid
       filteredPageMap={metrics.filteredPageMap}
       totalPageCount={strategy.pageMap?.length ?? 0}
       totalImpressions={metrics.totalImpressions}
       totalClicks={metrics.totalClicks}
       ranked={metrics.ranked}
       avgPos={metrics.avgPos}
     />
   ),
   distribution: (
     <RankingDistribution
       filteredPageMap={metrics.filteredPageMap}
       ranked={metrics.ranked}
       top3={metrics.top3}
       top10={metrics.top10}
       top20={metrics.top20}
       beyond20={metrics.beyond20}
       notRankingCount={metrics.notRankingCount}
       intentCounts={metrics.intentCounts}
     />
   ),
   ```
   and:
   ```tsx
   backlink: <BacklinkProfile workspaceId={workspaceId} />,
   competitive: (
     <CompetitiveIntel
       workspaceId={workspaceId}
       competitors={competitorList}
       seoDataAvailable={settings.seoDataAvailable}
       cachedKeywordGaps={strategy?.keywordGaps}
     />
   ),
   ```
   Then delete the three now-unused imports (lines 14, 15) and the `StrategyStatGrid,` and `RankingDistribution,` names from the `'./strategy'` barrel import (lines 37, 41):
   ```tsx
   import { BacklinkProfile } from './strategy/BacklinkProfile';
   import { CompetitiveIntel } from './strategy/CompetitiveIntel';
   ```
   and within the `} from './strategy';` block remove the lines `  StrategyStatGrid,` and `  RankingDistribution,`.

   > **Watch the `competitorList` constant (line 126).** It is still used by the `StrategyCompetitiveTab` mount inside `strategyLayout` (line 477) — do **not** delete it. Only the `realLeaves.competitive` *leaf* that also consumed it is removed.

9. Run the typecheck to catch any leftover reference (an unused import, a dangling `realLeaves.statGrid`):
   ```
   npm run typecheck
   ```
   Expected: zero errors. If `tsc` reports `'RankingDistribution' is declared but its value is never read` or similar, you missed an import removal — fix it before committing.

#### Task A.3: Run the admin-side build verification

**Files:** none (verification).

1. Build to confirm the admin component still compiles into the bundle:
   ```
   npx vite build
   ```
   Expected: build completes, no errors referencing `KeywordStrategy.tsx`, `legacyAnalysis`, `StrategyStatGrid`, or `useFeatureFlag`.

2. Commit the admin half:
   ```
   git add src/components/KeywordStrategy.tsx
   git commit -m "Strategy v3 Phase 0 — collapse admin legacy Analysis/Guide layout (v2 cutover)"
   ```

#### Task A.4: Update the client `StrategyTab` test to assert the cutover (failing test first)

**Files:** `tests/component/client/StrategyTab.test.tsx`

The existing test at line 497 asserts the *legacy flat layout* renders "when the flag is off." Under the cutover there is no flag and no legacy layout — the command-center is the only layout. Rewrite that assertion to expect the command-center, so it **fails** against the current (pre-cutover) `StrategyTab.tsx` and passes only after Task A.5.

> This is Lane A territory because the test change must land in the same logical step as the component change it pins. Lane D owns *other* edits to this same test file (the `commandCenterEnabled` prop removal in the v2 describe block) — coordinate by doing Task A.4's single-test rewrite first, then Lane D's prop-cleanup sweep rebases on top. If one agent owns both, fold them: do A.4 + D.3 together.

1. Replace the flag-OFF test (lines 497–503):
   ```tsx
   it('renders the legacy flat layout when the flag is off (no Orient header, all sections at once)', () => {
     render(<StrategyTab {...defaultProps} strategyData={makeStrategy()} />);
     expect(screen.queryByTestId('orient-header')).not.toBeInTheDocument();
     expect(screen.getByTestId('strategy-snapshot')).toBeInTheDocument();
     expect(screen.getByTestId('content-opportunities')).toBeInTheDocument();
     expect(screen.getByTestId('page-keyword-map')).toBeInTheDocument();
   });
   ```
   with a cutover assertion (no `commandCenterEnabled` prop — the command-center is unconditional):
   ```tsx
   it('renders the command-center layout unconditionally after the v2 cutover (Orient header + interior tabs)', () => {
     render(<StrategyTab {...defaultProps} strategyData={makeStrategy({ strategyUx: { explanations: [], orient } })} />);
     // Orient header + interior TabBar are now the baseline (no flag to turn them off).
     expect(screen.getByTestId('orient-header')).toBeInTheDocument();
     expect(screen.getByText('Overview')).toBeInTheDocument();
     expect(screen.getByText('Competitive')).toBeInTheDocument();
     // Defaults to Overview; the Content tab's sections are NOT mounted until selected.
     expect(screen.getByTestId('strategy-snapshot')).toBeInTheDocument();
     expect(screen.queryByTestId('content-opportunities')).not.toBeInTheDocument();
   });
   ```
   > `orient` is the fixture object already defined at line 446 inside the `describe('StrategyTab — v2 command center (flag ON)', …)` block. Because this rewritten test now also needs it, **move the rewritten test into that describe block** (it already has the `orient` const + the `searchParamsRef`/`mockUseClientIntelligence` `beforeEach`). Cut the `it(...)` from line 497 and paste it as the last `it` inside the v2 describe block (before its closing `});` at line 504). Delete the now-empty outer location.

2. Run the test — expect it to **fail** (the current `StrategyTab` still gates the command-center behind `commandCenterEnabled`, which `defaultProps` does not set, so the legacy layout renders and `orient-header` is absent):
   ```
   npx vitest run tests/component/client/StrategyTab.test.tsx
   ```
   Expected: the new "renders the command-center layout unconditionally" test FAILS with `Unable to find an element by: [data-testid="orient-header"]`. The other tests still pass.

#### Task A.5: Collapse the client `StrategyTab` flag branch

**Files:** `src/components/client/StrategyTab.tsx`

1. **Remove the `commandCenterEnabled` prop** from the interface. Delete lines 70–76 (the JSDoc + the prop):
   ```tsx
   /**
    * Strategy v2 "command center" reframe (Phase 6b). When true, the tab renders the Orient header +
    * interior Overview/Content/Rankings/Competitive tabs. Defaults false → the legacy flat layout,
    * byte-identical. Read in ClientDashboard (QueryClient in scope) and passed down so this component
    * stays QueryClient-free for its provider-less tests.
    */
   commandCenterEnabled?: boolean;
   ```

2. **Remove it from the destructured signature** (line 122). Replace:
   ```tsx
   export function StrategyTab({ strategyData, requestedTopics, contentRequests, effectiveTier, briefPrice, fullPostPrice, fmtPrice, setPricingModal, contentPlanKeywords, onTabChange, workspaceId, setToast, onContentRequested, hidePrices, commandCenterEnabled = false }: StrategyTabProps) {
   ```
   with:
   ```tsx
   export function StrategyTab({ strategyData, requestedTopics, contentRequests, effectiveTier, briefPrice, fullPostPrice, fmtPrice, setPricingModal, contentPlanKeywords, onTabChange, workspaceId, setToast, onContentRequested, hidePrices }: StrategyTabProps) {
   ```

3. **Update the comment at line 140** (it referenced the removed flag). Replace:
   ```tsx
   // Strategy v2 interior tab (?tab= deep-link, two-halves contract — mirrors the admin StrategyTab).
   // Hooks run unconditionally (rules of hooks); the tab state is only consumed when commandCenterEnabled.
   ```
   with:
   ```tsx
   // Strategy interior tab (?tab= deep-link, two-halves contract — mirrors the admin StrategyTab).
   // The command-center layout is the baseline, so this tab state is always consumed.
   ```

4. **Simplify the three `nextStepsEl` handlers** (lines 759–761) — they branched on `commandCenterEnabled` for the interior-tab navigation vs the legacy scroll-to-section. The command-center is now the only layout, so always use the interior-tab handlers. Replace:
   ```tsx
   onReviewIdeas={commandCenterEnabled ? () => handleInteriorTabChange('content') : () => scrollToSection('new-content', newContentRef)}
   onReviewPages={commandCenterEnabled ? () => handleInteriorTabChange('content') : () => scrollToSection('optimize-existing', optimizeExistingRef)}
   onManageKeywords={commandCenterEnabled ? () => handleInteriorTabChange('rankings') : () => priorityKeywordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
   ```
   with:
   ```tsx
   onReviewIdeas={() => handleInteriorTabChange('content')}
   onReviewPages={() => handleInteriorTabChange('content')}
   onManageKeywords={() => handleInteriorTabChange('rankings')}
   ```

5. **Delete the legacy flat-return branch** (lines 993–1011) and unwrap the command-center `if` block. Replace lines 954–1011:
   ```tsx
   // ── Strategy v2 command-center layout (flag ON): Orient header + interior tabs ──
   if (commandCenterEnabled) {
     return (
       <div className="space-y-8">
         {unvalidatedNoteEl}
         {loadErrorsEl}
         <StrategyClientOrientHeader orient={strategyData.strategyUx?.orient} />
         <TabBar tabs={CLIENT_STRATEGY_TABS} active={interiorTab} onChange={handleInteriorTabChange} />
         {interiorTab === 'overview' && (
           <div className="space-y-8">
             {snapshotEl}
             {refreshSummaryEl}
             {nextStepsEl}
             {keywordFeedbackSummaryEl}
             {businessPrioritiesEl}
           </div>
         )}
         {interiorTab === 'content' && (
           <div className="space-y-8">
             {contentOppsEl}
             {pageImprovementsEl}
           </div>
         )}
         {interiorTab === 'rankings' && (
           <div className="space-y-8">
             {pageKeywordMapEl}
             {requestedTrendEl}
             {keywordsSectionEl}
             {declinedKeywordsEl}
           </div>
         )}
         {interiorTab === 'competitive' && (
           <CompetitorGapsSection workspaceId={workspaceId ?? ''} tier={effectiveTier} />
         )}
         {modalsEl}
       </div>
     );
   }

   // ── Legacy flat layout (flag OFF) — same elements, original order, byte-identical ──
   return (
     <div className="space-y-8">
       {unvalidatedNoteEl}
       {snapshotEl}
       {refreshSummaryEl}
       {nextStepsEl}
       {keywordFeedbackSummaryEl}
       {loadErrorsEl}
       {businessPrioritiesEl}
       {contentOppsEl}
       {pageImprovementsEl}
       {keywordsSectionEl}
       {requestedTrendEl}
       {pageKeywordMapEl}
       {declinedKeywordsEl}
       {modalsEl}
     </div>
   );
   }
   ```
   with:
   ```tsx
   // ── Strategy command-center layout (the v2-cutover baseline): Orient header + interior tabs ──
   return (
     <div className="space-y-8">
       {unvalidatedNoteEl}
       {loadErrorsEl}
       <StrategyClientOrientHeader orient={strategyData.strategyUx?.orient} />
       <TabBar tabs={CLIENT_STRATEGY_TABS} active={interiorTab} onChange={handleInteriorTabChange} />
       {interiorTab === 'overview' && (
         <div className="space-y-8">
           {snapshotEl}
           {refreshSummaryEl}
           {nextStepsEl}
           {keywordFeedbackSummaryEl}
           {businessPrioritiesEl}
         </div>
       )}
       {interiorTab === 'content' && (
         <div className="space-y-8">
           {contentOppsEl}
           {pageImprovementsEl}
         </div>
       )}
       {interiorTab === 'rankings' && (
         <div className="space-y-8">
           {pageKeywordMapEl}
           {requestedTrendEl}
           {keywordsSectionEl}
           {declinedKeywordsEl}
         </div>
       )}
       {interiorTab === 'competitive' && (
         <CompetitorGapsSection workspaceId={workspaceId ?? ''} tier={effectiveTier} />
       )}
       {modalsEl}
     </div>
   );
   }
   ```

6. Run the client test — the Task A.4 cutover test now **passes**, and the v2-describe tests still pass (they pass `commandCenterEnabled` which is now ignored harmlessly — Lane D removes that prop in Task D.3):
   ```
   npx vitest run tests/component/client/StrategyTab.test.tsx
   ```
   Expected: all tests pass. (TypeScript still accepts the stray `commandCenterEnabled` prop in the test because excess JSX props on a component are not a type error in React's `JSX.IntrinsicAttributes` widening — but Lane D removes them; do not rely on this, just confirm green.)

7. Run the typecheck:
   ```
   npm run typecheck
   ```
   Expected: zero errors.

#### Task A.6: Remove the `commandCenterEnabled` flag read + prop in `ClientDashboard.tsx`

**Files:** `src/components/ClientDashboard.tsx`

1. **Delete the flag read + its Rules-of-Hooks comment** (lines 465–470):
   ```tsx
   // Strategy v2 "command center" — gates the client StrategyTab reframe (Orient header + interior tabs).
   // MUST be called unconditionally BEFORE the early returns below (Rules of Hooks — `loading` flips
   // true→false across renders, so a hook placed after these returns would change the hook count and
   // crash the dashboard). Read here because the QueryClient is in scope; threaded to StrategyTab as a
   // prop so that component stays QueryClient-free for its provider-less tests.
   const commandCenterEnabled = useFeatureFlag('strategy-command-center');
   ```

2. **Remove the prop from the `<StrategyTab … />` mount** (line 731). Delete the trailing ` commandCenterEnabled={commandCenterEnabled}` from the element (the rest of the prop list stays byte-identical).

3. **Check whether `useFeatureFlag` is still imported-and-used elsewhere in this file.** Run:
   ```
   grep -n "useFeatureFlag" src/components/ClientDashboard.tsx
   ```
   If the only remaining match is the `import` line (51), remove that import too:
   ```tsx
   import { useFeatureFlag } from '../hooks/useFeatureFlag';
   ```
   If there are other `useFeatureFlag(...)` calls, leave the import.

4. Run the typecheck + build:
   ```
   npm run typecheck && npx vite build
   ```
   Expected: zero errors, clean build.

5. Commit the client half:
   ```
   git add src/components/client/StrategyTab.tsx src/components/ClientDashboard.tsx tests/component/client/StrategyTab.test.tsx
   git commit -m "Strategy v3 Phase 0 — collapse client StrategyTab flag branch + drop commandCenterEnabled prop threading (v2 cutover)"
   ```

---

### Lane B (haiku) [after A] — delete orphan files + prune barrel

**Blocked by:** Lane A (Task A.2 step 8 removed the last `StrategyStatGrid` import from `KeywordStrategy.tsx`; Task A.2 step 7 removed the last `KeywordStrategyGuide` import). This lane verifies zero importers, then deletes the files.

#### Task B.1: Confirm `StrategyStatGrid` has zero importers

**Files:** none (verification).

1. Grep the whole repo for any remaining reference (the barrel re-export at `index.ts:18` is the only expected hit, plus its own file + test):
   ```
   grep -rn "StrategyStatGrid" src/ tests/ server/
   ```
   Expected hits ONLY: `src/components/strategy/StrategyStatGrid.tsx` (the file itself), `tests/unit/strategy/StrategyStatGrid.test.tsx` (its test), `src/components/strategy/index.ts:18` (the barrel line), and `src/components/strategy/types.ts:188` (the `StrategyStatGridProps` interface). If `KeywordStrategy.tsx` still appears, Lane A did not land — STOP and wait for Lane A's merge.

#### Task B.2: Delete `StrategyStatGrid` + its test + prune the barrel line

**Files:** `src/components/strategy/StrategyStatGrid.tsx`; `tests/unit/strategy/StrategyStatGrid.test.tsx`; `src/components/strategy/index.ts` (one line)

1. Delete the component and its test:
   ```
   git rm src/components/strategy/StrategyStatGrid.tsx tests/unit/strategy/StrategyStatGrid.test.tsx
   ```

2. Remove the barrel export line (`src/components/strategy/index.ts` line 18):
   ```ts
   export * from './StrategyStatGrid';
   ```
   (Leave every other barrel line untouched — Lane C owns the comment block.)

3. **Remove the now-orphaned `StrategyStatGridProps` interface.** Grep confirms it lives at `src/components/strategy/types.ts:188` and was consumed only by the deleted component. Open `src/components/strategy/types.ts`, find:
   ```ts
   export interface StrategyStatGridProps {
   ```
   and delete the whole interface block (through its closing `}`).

   > **Ownership note:** `types.ts` is not in Lane B's stated file list. If your run enforces strict ownership, hand this one interface deletion to Lane A (it owns the consumer side) or fold it into Lane B explicitly. Either way it MUST land — a leftover unused-export interface is dead code that `tsc` won't flag but the reviewer will. Verify it is unreferenced first: `grep -rn "StrategyStatGridProps" src/ tests/` should return only the `types.ts` declaration before you delete it.

4. Run the typecheck:
   ```
   npm run typecheck
   ```
   Expected: zero errors (no dangling import of the deleted file or interface).

#### Task B.3: Confirm `KeywordStrategyGuide` has zero importers, then delete it

**Files:** `src/components/strategy/KeywordStrategyGuide.tsx`

1. Grep for any remaining reference:
   ```
   grep -rn "KeywordStrategyGuide" src/ tests/ server/
   ```
   Expected hits ONLY: `src/components/strategy/KeywordStrategyGuide.tsx` (the file itself; the line-2 hit is its own JSDoc). If `KeywordStrategy.tsx` still appears, Lane A's Task A.2 step 7 did not land — STOP.

2. Confirm it is **not** exported from the barrel (it never was — verify):
   ```
   grep -n "KeywordStrategyGuide" src/components/strategy/index.ts
   ```
   Expected: no output. (If it were exported, you would remove that line too.)

3. Delete the file:
   ```
   git rm src/components/strategy/KeywordStrategyGuide.tsx
   ```

4. Run typecheck + build:
   ```
   npm run typecheck && npx vite build
   ```
   Expected: zero errors, clean build.

5. Commit:
   ```
   git add -A
   git commit -m "Strategy v3 Phase 0 — delete orphaned StrategyStatGrid + KeywordStrategyGuide (zero importers post-cutover)"
   ```

---

### Lane C (opus) [must land before Phase 1's feature-flags edit] — cutover wiring + reintroduction guard decision

**Blocked by:** none hard (can start in parallel with Lane A), but its barrel reconcile rebases onto Lane B's one-line removal, and the whole lane MUST merge before Phase 1 touches `shared/types/feature-flags.ts`. Under **REUSE there is NO flag-retirement migration and NO migration file** — the `strategy-command-center` flag is kept, so this lane is lighter than the audit's RETIRE-path sketch.

#### Task C.1: Reconcile the barrel cutover comment

**Files:** `src/components/strategy/index.ts`

The barrel still carries a Phase-R comment block (lines 28–33) referencing the old v2 plan. After the cutover, refresh it so it points at the v3 plan and no longer implies a flag-OFF legacy path exists.

1. Replace the comment block (lines 28–33):
   ```ts
   // Orphaned after Phase R (decision-bands removal): zero importers today, re-homed by Strategy v2.
   // Do NOT delete — re-imported by upcoming phases (Act queue: DecisionQueue/OpportunitiesList/
   // DecayingPagesCard/LostQueryRecoveryCard/CannibalizationTriage/RequestedKeywordTriage).
   // See docs/superpowers/plans/2026-06-17-strategy-v2-command-center.md.
   // (AuthorityAndBacklinks was removed in Phase 5 — the Competitive tab composes BacklinkProfile +
   // CompetitiveIntel directly in research order rather than via the merged wrapper.)
   ```
   with:
   ```ts
   // Act-queue leaves re-homed from the legacy action sections. The Strategy v2 cutover (Phase 0)
   // made the command-center layout the baseline; these are imported by the Act queue and by the
   // Strategy v3 cockpit built behind the kept `strategy-command-center` umbrella flag.
   // See docs/superpowers/plans/parts/10-phase-0.md and the v3 design spec.
   // (AuthorityAndBacklinks was removed in Phase 5 — the Competitive tab composes BacklinkProfile +
   // CompetitiveIntel directly in research order rather than via the merged wrapper.)
   ```

2. Run the typecheck (barrel changes are comment-only, but confirm the file still parses):
   ```
   npm run typecheck
   ```
   Expected: zero errors.

#### Task C.2: Decide whether a pr-check reintroduction guard is warranted (REUSE → NO guard)

**Files:** `scripts/pr-check.ts` (only if a guard is added — under REUSE, it is NOT)

The audit's prevention item #5 ("strategy-command-center reintroduction guard") was written for the **RETIRE** path — it would fail CI if the retired flag key reappeared. Under the **LOCKED REUSE** decision the flag is **kept**, so a "flag must not reappear" guard would be actively wrong (it would fail Phase 1, which references the same flag). 

1. **Do not add a reintroduction guard.** Document the decision inline at the top of this lane's commit message instead (see step 3). The only guard relevant to v3 — the `rec-status-vs-lifecycle-axis` guard (audit prevention #6) — belongs to **Phase 1**, not Phase 0, because the lifecycle axis does not exist yet.

2. Confirm pr-check is currently green so Phase 0 does not introduce a violation:
   ```
   npx tsx scripts/pr-check.ts
   ```
   Expected: zero errors.

3. Commit the barrel reconcile (rebased onto Lane B's StatGrid-line removal):
   ```
   git add src/components/strategy/index.ts
   git commit -m "Strategy v3 Phase 0 — refresh strategy barrel cutover comment; REUSE flag (no retirement guard)

REUSE decision: strategy-command-center is kept as the v3 umbrella, so NO
reintroduction pr-check guard and NO flag-retirement migration. The rec-status-
vs-lifecycle-axis guard lands in Phase 1 with the lifecycle axis."
   ```

---

### Lane D (sonnet) [after A] — stale comments + test prop removal + docs

**Blocked by:** Lane A (the component shape is final — the `commandCenterEnabled` prop is gone, so the test-prop removal and comment edits are against the settled API).

> **Route/nav/deep-link contract = VERIFY-ONLY (NOT a route removal).** Phase 0 keeps the `seo-strategy` `Page` and the `strategy` `ClientTab` (grep-confirmed both survive in `src/routes.ts`). Therefore `src/routes.ts`, `src/App.tsx`, `src/components/navRegistry.tsx`, and `tests/contract/tab-deep-link-wiring.test.ts` are **not edited** — you only run the deep-link contract test to confirm the surviving `?tab=` receivers (the interior `searchParams.get('tab')` readers in both `KeywordStrategy.tsx` and `client/StrategyTab.tsx`, which Lane A preserved) still satisfy the two-halves contract.

#### Task D.1: Update the stale flag comment in `keyword-strategy.ts`

**Files:** `server/routes/keyword-strategy.ts`

1. The Orient-metrics comment (lines 306–307) says the metric is consumed "when the strategy-command-center flag is on; ignored otherwise" — under the cutover the command-center is the baseline, so it is always consumed. Replace lines 306–307:
   ```ts
   // Strategy v2 Orient-zone metrics (visibility score + clicks/impressions/position deltas).
   // Consumed by the Orient zone when the strategy-command-center flag is on; ignored otherwise.
   ```
   with:
   ```ts
   // Strategy command-center Orient-zone metrics (visibility score + clicks/impressions/position
   // deltas). The command-center is the baseline layout (v2 cutover), so the Orient zone always reads this.
   ```

#### Task D.2: Update the stale flag comment in `public-content.ts`

**Files:** `server/routes/public-content.ts`

1. The client Orient comment (lines 174–180) carries the same "when the … flag is on" phrasing (line 178–179). Replace just that clause. Change lines 178–179:
   ```ts
   // public client path. Consumed by the client Strategy v2 Orient header (Phase 6b) when the
   // strategy-command-center flag is on; ignored otherwise. The no-money-field invariant is locked by
   ```
   to:
   ```ts
   // public client path. Consumed by the client Strategy command-center Orient header — the baseline
   // layout after the v2 cutover (always read). The no-money-field invariant is locked by
   ```
   (Leave the surrounding lines, including the `tests/integration/client-strategy-orient-public-read.test.ts` reference on line 180, intact.)

#### Task D.3: Remove the now-ignored `commandCenterEnabled` prop from the StrategyTab test

**Files:** `tests/component/client/StrategyTab.test.tsx`

Lane A removed the `commandCenterEnabled` prop from `StrategyTab`. The v2-describe `renderV2()` helper (line 452–460) still passes it. It is now a stray prop (harmless at runtime, but dead and misleading). Remove it.

> **Coordinate with Lane A's Task A.4:** A.4 already moved the cutover test into the v2 describe block and the v2 tests no longer depend on the flag to show the command-center (it is unconditional). Rebase this task onto A.4's merge.

1. In `renderV2()` (lines 452–460), remove the `commandCenterEnabled` line:
   ```tsx
   function renderV2() {
     return render(
       <StrategyTab
         {...defaultProps}
         commandCenterEnabled
         strategyData={makeStrategy({ strategyUx: { explanations: [], orient } })}
       />,
     );
   }
   ```
   becomes:
   ```tsx
   function renderV2() {
     return render(
       <StrategyTab
         {...defaultProps}
         strategyData={makeStrategy({ strategyUx: { explanations: [], orient } })}
       />,
     );
   }
   ```

2. Update the v2 describe-block title (line 439) — "(flag ON)" is no longer meaningful. Replace:
   ```tsx
   describe('StrategyTab — v2 command center (flag ON)', () => {
   ```
   with:
   ```tsx
   describe('StrategyTab — command center (baseline layout)', () => {
   ```

3. Run the test:
   ```
   npx vitest run tests/component/client/StrategyTab.test.tsx
   ```
   Expected: all tests pass.

#### Task D.4: Verify the ClientDashboard test still reflects reality

**Files:** `tests/component/ClientDashboard.test.tsx`

The Rules-of-Hooks guard comment (lines 925–943) references the historical risk that Phase 6b ran when it "added `useFeatureFlag('strategy-command-center')` next to the early returns." Lane A removed that hook from `ClientDashboard.tsx`. The test's `useFeatureFlag` mock (lines 63–64) and the guard test itself stay valid (the guard protects against the *next* real hook, per the comment at line 942), so the test logic does NOT change — but the historical reference should note the hook was since removed so a future reader is not confused.

1. Update the parenthetical at lines 934–935. Replace:
   ```ts
   // added `useFeatureFlag('strategy-command-center')` next to the early returns).
   ```
   with:
   ```ts
   // added `useFeatureFlag('strategy-command-center')` next to the early returns — that flag read was
   // removed in the Strategy v3 Phase 0 v2 cutover, but this guard still protects the next real hook).
   ```

2. Confirm the `useFeatureFlag` mock (lines 63–64) is still referenced somewhere — if `ClientDashboard.tsx` no longer calls `useFeatureFlag` at all and no other mocked component does, the mock becomes inert but harmless; leave it (removing it risks breaking an unrelated suite that relies on the module being mocked). Run:
   ```
   npx vitest run tests/component/ClientDashboard.test.tsx
   ```
   Expected: all tests pass, including the Rules-of-Hooks guard.

#### Task D.5: Verify-only — deep-link contract + nav (NOT a route removal)

**Files:** none (verification only).

1. Run the deep-link contract test to confirm the surviving `?tab=` receivers still satisfy the two-halves contract (Lane A kept both `searchParams.get('tab')` readers):
   ```
   npx vitest run tests/contract/tab-deep-link-wiring.test.ts
   ```
   Expected: pass. If it fails, Lane A accidentally removed a `?tab=` receiver — that is a bug to fix in Lane A, not here.

2. Confirm the routes/nav are untouched (no diff expected):
   ```
   git status --short src/routes.ts src/App.tsx src/components/navRegistry.tsx tests/contract/tab-deep-link-wiring.test.ts
   ```
   Expected: empty output (no changes). Phase 0 is a layout collapse, not a route removal.

#### Task D.6: Update docs + commit

**Files:** `FEATURE_AUDIT.md`, `data/roadmap.json` (per CLAUDE.md post-task protocol)

1. In `FEATURE_AUDIT.md`, update entry **#521** ("Client Strategy — v2 command center reframe") to note the v2 cutover: the command-center is now the **baseline** layout (no longer flag-OFF/legacy parity — the legacy flat layout was deleted in Strategy v3 Phase 0). Add a one-line note under that entry:
   ```
   **v3 Phase 0 update (2026-06-18):** the legacy flat layout was deleted; the command-center is now the unconditional baseline. `commandCenterEnabled` prop threading removed (`ClientDashboard` → `StrategyTab`); the `strategy-command-center` flag is KEPT as the v3 umbrella (REUSE — no retirement migration).
   ```

2. In `data/roadmap.json`, mark the v2 "delete legacy layout" item (the still-pending cutover) `"done"` and add a `"notes"` field pointing at this phase. Then sort:
   ```
   npx tsx scripts/sort-roadmap.ts
   ```
   Expected: roadmap re-sorted, no error.

3. Commit:
   ```
   git add server/routes/keyword-strategy.ts server/routes/public-content.ts tests/component/client/StrategyTab.test.tsx tests/component/ClientDashboard.test.tsx FEATURE_AUDIT.md data/roadmap.json
   git commit -m "Strategy v3 Phase 0 — stale flag-comment + test-prop cleanup; docs (v2 cutover)"
   ```

---

## Phase exit gates

Phase 0 is complete only when ALL pass (run from repo root):

- [ ] `npm run typecheck` — zero errors (`tsc -b`, both app + node configs). No dangling `commandCenterEnabled`, `legacyAnalysis`, `StrategyStatGrid`, `KeywordStrategyGuide`, or `StrategyStatGridProps` references.
- [ ] `npx vite build` — builds successfully.
- [ ] `npx vitest run tests/component/client/StrategyTab.test.tsx tests/component/ClientDashboard.test.tsx tests/contract/tab-deep-link-wiring.test.ts` — all pass (cutover assertion green; Rules-of-Hooks guard green; `?tab=` two-halves contract green).
- [ ] `npx vitest run` — **full** suite passes (not just the touched tests — a deleted barrel export or component can break an unrelated importer; per CLAUDE.md "run full suite before done").
- [ ] `npx tsx scripts/pr-check.ts` — zero errors.
- [ ] `grep -rn "commandCenterEnabled" src/ tests/` — **zero matches** (the prop is fully removed from component, mount, and test).
- [ ] `grep -rn "StrategyStatGrid\|KeywordStrategyGuide" src/ tests/` — **zero matches** (orphan files + barrel line + props interface all deleted).
- [ ] `git status --short src/routes.ts src/App.tsx src/components/navRegistry.tsx tests/contract/tab-deep-link-wiring.test.ts` — **empty** (verify-only; Phase 0 is not a route removal).
- [ ] `shared/types/feature-flags.ts` — **untouched by Phase 0** (REUSE: the `strategy-command-center` flag is kept; Phase 1 rebases its child-flag additions onto Phase 0's merge under the import-time `assertFeatureFlagGroupingConsistency()` serialization rule).
- [ ] `FEATURE_AUDIT.md` + `data/roadmap.json` updated (entry #521 cutover note; v2-delete-legacy roadmap item → done).
- [ ] Multi-lane work → run `scaled-code-review` before the Phase 0 PR merges to `staging`; fix every surfaced bug in-PR. Merge to `staging`, verify, then `staging` → `main`.

**Cross-phase note for Phase 1 / the assembler:** Phase 0 does **not** edit `shared/types/feature-flags.ts` (REUSE — flag kept), so the only thing Phase 1 must do before its own feature-flags edit is **rebase onto Phase 0's merge** (no flag conflict to resolve, only the import-time grouping invariant means the two PRs cannot both edit feature-flags.ts concurrently — and Phase 0 simply doesn't). The `rec-status-vs-lifecycle-axis` pr-check guard (audit prevention #6) and the `strategy-command-center` reintroduction guard are **NOT** added in Phase 0 — the former belongs to Phase 1 (lifecycle axis), the latter is wrong under REUSE.


---

## Phase 1 — lifecycle foundation (Stage 1, after P0 merge)

**Goal:** land the complete two-axis recommendation lifecycle foundation — the locked Phase-1 shared contracts (types/Zod/state-machines/activity/WS/queryKeys/email/flags), the `server/recommendation-lifecycle.ts` single-writer module, the `isActiveRec()` predicate exported from `server/recommendations.ts`, the regen carry-over + auto-resolve exemption for client-facing lifecycle, and the public read-path conversion to an allow-list — plus the contract doc and the three exit-gate tests. **What merges before it:** Phase 0 (the v2 cutover that makes the command-center the flag-OFF baseline and keeps the `strategy-command-center` flag). Phase 1 branches off the merged-Phase-0 `staging`. **The flag-gated exit gate:** every Stage-2 dispatch is BLOCKED until all of Phase 1 is merged green. The load-bearing gates are (a) the flag-OFF **byte-identical** public snapshot, (b) the flag-ON **no-admin-key-leak** assertion on the REAL public read path, (c) `regen-preserves-lifecycle` (send → regen → `clientStatus` still `'sent'`), and (d) `strike-never-completed` / `isActiveRec` excludes struck/throttled/sent from `summary.topRecommendationId`.

**Lane order (strict):** `1A` (contracts) → `1B` (single-writer + `isActiveRec` + carry-over) → `1C` (reader retrofits, after 1B exports `isActiveRec`) and `1D` (tests + doc, after 1B/1C). 1C and 1D may run in parallel once 1B has merged, but 1D's assertions finalize only after 1C lands the allow-list. The controller commits per-lane; no parallel git writes.

> **Source of truth for every type/signature/event/enum below:** `docs/superpowers/plans/parts/00-contracts.md`. Each code block here reproduces that contract verbatim at its locked anchor. If a field is discovered missing mid-Stage-2, that is a **Phase-1 amendment to 00-contracts.md**, not a Stage-2 edit.

---

### Lane 1A — pre-commit shared contracts (opus) [FIRST within P1, after P0 merge]

**Blocked by:** Phase 0 merge (the `shared/types/feature-flags.ts` flag removal; `assertFeatureFlagGroupingConsistency()` is import-time, so the two Stage-1 edits must serialize). This lane has **no Phase-1 predecessor** — it is dispatched and merged first within Phase 1; everything downstream (1B/1C/1D and all of Stage 2) reads these contracts.

This lane is the 13-contract pre-commit. It is pure type/enum/constant additions — no behavior — so it ships in **one commit** (the contract-landing checklist, 00-contracts.md §13) and is verified by `typecheck` + `verify:feature-flags` + `pr-check`. Each task is one file's contract; the final task verifies + commits the whole batch.

#### Task 1A.1: lifecycle fields on the `Recommendation` interface

**Files:** `shared/types/recommendations.ts` (modify)

1. Open `shared/types/recommendations.ts`. The interface `Recommendation` ends with `backfilled?: boolean;` then `createdAt: string;` (verified lines 49–50). Insert the v3 lifecycle field set **between** them. Replace this exact block:

```ts
  backfilled?: boolean;
  createdAt: string;
```

with:

```ts
  backfilled?: boolean;
  // ── Strategy v3 — two-axis client-facing lifecycle (SEPARATE from RecStatus) ──
  // RecStatus (status, above) stays the INTERNAL admin triage axis (pending/in_progress/
  // completed/dismissed). clientStatus + lifecycle are the v3 curation axes. strike/throttle/
  // send NEVER write RecStatus — a struck rec must never be swept to 'completed' and read as
  // "✓ done" to the client (the trust-critical graft, spec §6.1). All optional → byte-identical
  // on every legacy/flag-OFF rec (absent ⇒ treated as clientStatus:'system', lifecycle:'active').
  /** Curation axis: system (minted, not yet curated) → curated (operator picked) → sent
   *  (delivered to client) → approved | declined | discussing (client responded). */
  clientStatus?: 'system' | 'curated' | 'sent' | 'approved' | 'declined' | 'discussing';
  /** Suppression axis, orthogonal to clientStatus: active (default) | throttled (hidden
   *  until throttledUntil) | struck (permanently suppressed, won't be re-suggested). */
  lifecycle?: 'active' | 'throttled' | 'struck';
  /** ISO timestamp the throttle expires; the rec auto-resurfaces as active on-read once
   *  Date.now() passes this (no cron — spec §8). Only set when lifecycle==='throttled'. */
  throttledUntil?: string;
  /** ISO timestamp the rec was sent to the client. Set when clientStatus → 'sent'. */
  sentAt?: string;
  /** ISO timestamp the rec was struck. Set when lifecycle → 'struck'. */
  struckAt?: string;
  /** Cascade metadata for keyword/topic strikes that also remove items from strategy
   *  (spec §4.3 "removes from strategy — reversible"). Carries the reversal payload so
   *  Undo can restore the strategy items the strike removed. Absent on non-cascading strikes. */
  cascade?: { removedKeywords?: string[]; removedClusters?: string[]; reversible: boolean };
  /** Where a Send routes. 'deliverable' for RecTypes with a registered deliverable adapter
   *  (content_decay/cannibalization) — their Send goes to the deliverable spine and the rec
   *  reads its lifecycle from client_actions, NOT an independent clientStatus (spec §6.3).
   *  'rec' (default/absent) for all other RecTypes — Send mutates clientStatus directly. */
  sendChannel?: 'deliverable' | 'rec';
  createdAt: string;
```

2. Do NOT touch `productType?` (line 30), `assignedTo?` (line 44), or `impactBand?` (line 43) — they already exist.
3. Run `npm run typecheck` — expect zero errors (additive optional fields cannot break consumers).

#### Task 1A.2: `RecDiscussionEntry` + `StrategyRecommendationPayload` + `RecPolicy` + `RecPolicyRegistry`

**Files:** `shared/types/recommendations.ts` (modify)

1. Append the discussion read-shape and the adapter/policy contracts to the **end of the file** (after `OpportunityWeights`, the last export). Add:

```ts

/** One entry in a recommendation discussion thread (spec §6.7). Backed by the rec_discussion
 *  table (migration 138). `author` is a display role, not a user id — 'client' (the client's
 *  question) or 'strategist' (the agency reply). Read by the cockpit Discuss filter (P2) and
 *  the client CuratedRecDiscussThread (P4); both build against THIS shape before the substrate
 *  exists (the pre-committed Track-B↔Track-C contract). */
export interface RecDiscussionEntry {
  id: string;
  recId: string;
  workspaceId: string;
  author: 'client' | 'strategist';
  body: string;
  createdAt: string;        // ISO timestamp
}

/** Strategy v3 — the payload an adapter emits to turn a domain item (keyword opportunity,
 *  topic cluster, content gap) INTO a sendable recommendation via the per-row Send spine.
 *  P5 Lane 5C (#6b) builds the keyword-opportunity adapter against this; the policy registry
 *  (below) decides routing (rec vs deliverable) per RecType. Net-new — zero prior matches. */
export interface StrategyRecommendationPayload {
  type: RecType;
  title: string;
  description: string;
  insight: string;                        // "why this matters" — feeds the curated card's why-line
  affectedPages: string[];
  /** Optional pre-resolved product for the priced CTA (decision 1 — Add-to-plan only when set). */
  productType?: string;
  productPrice?: number;
  /** The source domain entity id (e.g. the keyword string or cluster topic) for de-dup + lineage. */
  sourceKey: string;
  source: string;                         // which analysis produced it (mirrors Recommendation.source)
}

/** Per-RecType curation policy (spec §6.2 single-writer policy registry). One entry per RecType
 *  the single-writer (server/recommendation-lifecycle.ts) knows how to mutate. `sendChannel`
 *  decides whether Send mutates clientStatus directly ('rec') or routes to the deliverable spine
 *  ('deliverable' — content_decay/cannibalization read lifecycle from client_actions, spec §6.3).
 *  `cascadeOnStrike` marks RecTypes whose strike also removes strategy items (keyword/topic). */
export interface RecPolicy {
  sendChannel: 'rec' | 'deliverable';
  cascadeOnStrike: boolean;
  /** True when this RecType resolves a productType → a priced Add-to-plan CTA is allowed. */
  monetizable: boolean;
}

/** The registry shape the single-writer consumes. Keyed by RecType; an unlisted RecType is a
 *  bug (it cannot be curated until a policy is registered). Populated in P1 Lane 1B. */
export type RecPolicyRegistry = Partial<Record<RecType, RecPolicy>>;
```

2. Run `npm run typecheck` — expect zero errors.

#### Task 1A.3: lifecycle Zod (lockstep) in `recommendationSchema`

**Files:** `server/schemas/workspace-schemas.ts` (modify)

1. In `recommendationSchema` (line 366), `assignedTo` is at line 399 and `createdAt` at line 400 (verified). The object is `.passthrough()` today, but the Zod-lockstep rule requires **explicit** declaration so a mistyped write fails validation. Replace this exact block:

```ts
  assignedTo: z.enum(['team', 'client']).optional(),
  createdAt: z.string(),
```

with:

```ts
  assignedTo: z.enum(['team', 'client']).optional(),
  // ── Strategy v3 lifecycle axes (lockstep with Recommendation in shared/types/recommendations.ts).
  // All .optional(): every PRE-v3 stored blob lacks these keys, so a REQUIRED field would drop the
  // whole rec on read (the "Schema vs stored shape" rule). Explicit (not passthrough-only) so a
  // mistyped write — e.g. clientStatus:'snet' — is caught at the read boundary, not silently kept.
  clientStatus: z.enum(['system', 'curated', 'sent', 'approved', 'declined', 'discussing']).optional(),
  lifecycle: z.enum(['active', 'throttled', 'struck']).optional(),
  throttledUntil: z.string().optional(),
  sentAt: z.string().optional(),
  struckAt: z.string().optional(),
  cascade: z.object({
    removedKeywords: z.array(z.string()).optional(),
    removedClusters: z.array(z.string()).optional(),
    reversible: z.boolean(),
  }).optional(),
  sendChannel: z.enum(['deliverable', 'rec']).optional(),
  createdAt: z.string(),
```

2. Run `npm run typecheck` — expect zero errors.

#### Task 1A.4: both state-machine transition maps

**Files:** `server/state-machines.ts` (modify)

1. Extend the existing `RECOMMENDATION_TRANSITIONS` (line 100) with the operator curation axis. Replace this exact block:

```ts
export const RECOMMENDATION_TRANSITIONS: Record<string, readonly string[]> = {
  pending:     ['in_progress', 'completed', 'dismissed'],
  in_progress: ['pending', 'completed', 'dismissed'],
  completed:   ['pending', 'in_progress'],   // pending/in_progress = issue re-detected
  dismissed:   ['pending'],                  // un-dismiss
};
```

with:

```ts
export const RECOMMENDATION_TRANSITIONS: Record<string, readonly string[]> = {
  // Internal RecStatus axis (unchanged) — admin triage.
  pending:     ['in_progress', 'completed', 'dismissed'],
  in_progress: ['pending', 'completed', 'dismissed'],
  completed:   ['pending', 'in_progress'],   // pending/in_progress = issue re-detected
  dismissed:   ['pending'],                  // un-dismiss
  // Strategy v3 operator curation axis (clientStatus) — admin-only (validated separately
  // from the client-side map below). 'system' is the implicit start for an absent clientStatus.
  system:      ['curated'],
  curated:     ['sent', 'system'],           // 'system' = operator un-curated before sending
  // 'sent' has NO operator-side forward edge here — the client owns sent → approved|declined|
  // discussing via CLIENT_REC_TRANSITIONS. (A re-send is a fresh sentAt, not a transition.)
};
```

2. Immediately **after** the closing `};` of `RECOMMENDATION_TRANSITIONS` (line 105) and before `export type RecommendationStateStatus` (line 107), add `CLIENT_REC_TRANSITIONS`:

```ts

// Strategy v3 — client-side response axis (spec §7.2). A sent rec is the only thing the
// client can act on. Distinct from RecStatus AND from the operator curation axis: the
// client respond route (POST /api/public/recommendations/:ws/:recId/respond) validates
// ONLY against this map and mutates ONLY clientStatus — never RecStatus, never completion.
export const CLIENT_REC_TRANSITIONS: Record<string, readonly string[]> = {
  sent:       ['approved', 'declined', 'discussing'],
  discussing: ['approved', 'declined'],   // a discussion resolves to a decision
  approved:   [],                         // terminal (client side)
  declined:   [],                         // terminal (client side)
};
```

3. Run `npm run typecheck` — expect zero errors.

#### Task 1A.5: four `rec_*` ActivityTypes + client-visibility classification

**Files:** `server/activity-log.ts` (modify)

1. In the closed `ActivityType` union, `rec_dismissed` is at line 148 (verified). Insert the four v3 lifecycle types after it. Replace this exact line:

```ts
  | 'rec_dismissed'        // client dismissed a recommendation
```

with:

```ts
  | 'rec_dismissed'        // client dismissed a recommendation
  // Strategy v3 curation lifecycle (spec §7.5). rec_sent + rec_approved are CLIENT-VISIBLE
  // (real client-facing milestones); rec_struck + rec_throttled are ADMIN-ONLY (internal
  // curation hygiene the client must never see — a struck rec read as activity would leak
  // "we decided not to do this").
  | 'rec_sent'             // CLIENT-VISIBLE: operator sent a curated rec to the client
  | 'rec_approved'         // CLIENT-VISIBLE: client approved a sent rec
  | 'rec_struck'           // admin-only: operator permanently suppressed a rec
  | 'rec_throttled'        // admin-only: operator throttled a rec for 7/30/90 days
```

2. In the `CLIENT_VISIBLE_TYPES` Set initializer (line 197), classify the two client-visible ones. The line `'deliverable_sent', 'deliverable_responded',` is at line 206 (verified). Replace this exact block:

```ts
  'deliverable_sent', 'deliverable_responded',
]);
```

with:

```ts
  'deliverable_sent', 'deliverable_responded',
  'rec_sent', 'rec_approved',
]);
```

3. `rec_struck` / `rec_throttled` are deliberately omitted from `CLIENT_VISIBLE_TYPES` (admin-only audit trail). Run `npm run typecheck` — expect zero errors (closed union + Set are both type-checked).

#### Task 1A.6: register `RECOMMENDATIONS_DISCUSSION_UPDATED` across the WS quartet

**Files:** `server/ws-events.ts`, `src/lib/wsEvents.ts`, `src/hooks/useWsInvalidation.ts`, `src/lib/wsInvalidation.ts` (all modify)

1. `server/ws-events.ts` — `RECOMMENDATIONS_UPDATED` is at line 135. Replace:

```ts
  RECOMMENDATIONS_UPDATED: 'recommendations:updated',
```

with:

```ts
  RECOMMENDATIONS_UPDATED: 'recommendations:updated',
  RECOMMENDATIONS_DISCUSSION_UPDATED: 'recommendations:discussion_updated',
```

2. `src/lib/wsEvents.ts` — `RECOMMENDATIONS_UPDATED` is at line 89. Replace the same line with the same two-line block (identical literals):

```ts
  RECOMMENDATIONS_UPDATED: 'recommendations:updated',
  RECOMMENDATIONS_DISCUSSION_UPDATED: 'recommendations:discussion_updated',
```

3. `src/hooks/useWsInvalidation.ts` — the registry entry for `RECOMMENDATIONS_UPDATED` is at line 74. Replace:

```ts
    [WS_EVENTS.RECOMMENDATIONS_UPDATED]: () => invalidateRegistry(WS_EVENTS.RECOMMENDATIONS_UPDATED),
```

with:

```ts
    [WS_EVENTS.RECOMMENDATIONS_UPDATED]: () => invalidateRegistry(WS_EVENTS.RECOMMENDATIONS_UPDATED),
    [WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED]: () => invalidateRegistry(WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED),
```

4. `src/lib/wsInvalidation.ts` — the admin-branch `RECOMMENDATIONS_UPDATED` case spans lines 400–409 (verified; ends with the `] as const;` at line 409). Add the new case **immediately after** line 409 (before `case WS_EVENTS.STRATEGY_UPDATED:` at line 410). Insert:

```ts
    case WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED:
      return [
        queryKeys.admin.recDiscussion(workspaceId),
        queryKeys.client.curatedRecommendations(workspaceId),
      ] as const;
```

> The two query keys this references are added in Task 1A.8 below. Do **not** touch the SECOND `RECOMMENDATIONS_UPDATED` case (the client branch at line 571) — P4 owns that.

5. Run `npm run typecheck` — expect zero errors **after** Task 1A.8 lands (the keys must exist). If running typecheck between 1A.7 and 1A.8, 1A.8 must land in the same commit; do steps 1A.6–1A.8 before the verify task 1A.13.

#### Task 1A.7: `ClientSignalsSlice.recResponses`

**Files:** `shared/types/intelligence.ts` (modify)

1. In `interface ClientSignalsSlice` (line 429) the `clientActions?` block ends at line 482 with `};` and the interface's closing `}` is at line 483 (verified). Insert `recResponses?` after the `clientActions?` block, before the closing brace. Replace this exact block:

```ts
  clientActions?: {
    pending: number;
    approved: number;
    changesRequested: number;
    completed: number;
    recentDecisions: Array<{ title: string; status: string; sourceType: string; updatedAt: string }>;
  };
}
```

with:

```ts
  clientActions?: {
    pending: number;
    approved: number;
    changesRequested: number;
    completed: number;
    recentDecisions: Array<{ title: string; status: string; sourceType: string; updatedAt: string }>;
  };
  /**
   * Strategy v3 (spec §7.5, data-flow rule #6) — the client's responses to SENT curated recs.
   * The outcome write alone is not enough for AdminChat/strategy to "see the loop" — this slice
   * field surfaces it. Counts derive from Recommendation.clientStatus across the rec set; the
   * outcome (approve→TrackedAction, decline→advisory learning) is recorded separately.
   * Populated by `assembleClientSignals` (P3 writes); read by the curated overview context (P4).
   * Field declared here in Phase 1 Lane 1A — Track B (P3 writes) and Track C (P4 reads) both
   * touch this file, so the shape is frozen before either dispatches.
   */
  recResponses?: {
    approved: number;
    declined: number;
    discussing: number;
    recentResponses: Array<{ title: string; clientStatus: string; respondedAt: string }>;
  };
}
```

2. Run `npm run typecheck` — expect zero errors.

#### Task 1A.8: query-key namespaces (admin + client)

**Files:** `src/lib/queryKeys.ts` (modify)

1. The shared key `recommendations: (wsId) => ['recommendations', wsId]` (line 293) stays **byte-identical** — do not touch it. Add the **admin** key after `recommendations:` at line 120. Replace:

```ts
    recommendations: (wsId: string) => ['admin-recommendations', wsId] as const,
```

with:

```ts
    recommendations: (wsId: string) => ['admin-recommendations', wsId] as const,
    /** Strategy v3 — discussion thread for a workspace's recs (admin cockpit Discuss filter). */
    recDiscussion: (wsId: string) => ['admin-rec-discussion', wsId] as const,
```

2. Add the **client** key after `activity:` at line 222. Replace:

```ts
    activity: (wsId: string) => ['client-activity', wsId] as const,
```

with:

```ts
    activity: (wsId: string) => ['client-activity', wsId] as const,
    /** Strategy v3 — the curated, clientStatus='sent' recs the client actually sees (spec §7.2).
     *  DISTINCT from shared.recommendations (the raw read) — its own key so the curated overview
     *  invalidates independently and the byte-identical shared key is never disturbed. */
    curatedRecommendations: (wsId: string) => ['client-curated-recommendations', wsId] as const,
```

3. Run `npm run typecheck` — expect zero errors (this also satisfies the `wsInvalidation.ts` case from Task 1A.6 step 4).

#### Task 1A.9: `curated_recs_sent` email event type + category + recipient policy

**Files:** `server/email-templates.ts`, `server/email-throttle.ts`, `server/notification-recipients.ts` (all modify)

1. `server/email-templates.ts` — append `'curated_recs_sent'` to the `EmailEventType` union. Find the last member `'work_order_comment_client'` and replace:

```ts
  | 'work_order_comment_client'
```

(the union's final member, terminated by `;`) with:

```ts
  | 'work_order_comment_client'
  | 'curated_recs_sent';
```

> Match the EXACT final member — if `'work_order_comment_client'` is not the last member of the union, append `| 'curated_recs_sent'` as the new final member and keep the existing terminator. The union must be syntactically valid.

2. `server/email-throttle.ts` — `CATEGORY_MAP` is `Record<EmailEventType, ThrottleCategory>` (line 29; a miss is a **compile error**). The `'action'` bucket member `work_order_comment_client: 'action',` is at line 64. Replace:

```ts
  work_order_comment_client: 'action',     // team → client reply
```

with:

```ts
  work_order_comment_client: 'action',     // team → client reply
  curated_recs_sent: 'action',             // Strategy v3 — batched "N recs ready for your decision"
```

> Do NOT use `'audit'` — `recommendations_ready: 'audit'` (line 36) has a 14-day cooldown that would silently swallow curated sends.

3. `server/notification-recipients.ts` — add `curated_recs_sent` to the `ClientNotificationEventType` `Extract` union (the member `| 'work_order_comment_client'` is at line 39). Replace:

```ts
  | 'work_order_comment_client'
```

(inside the `Extract<EmailEventType, ...>`) with:

```ts
  | 'work_order_comment_client'
  | 'curated_recs_sent'
```

4. In the same file, add the policy entry to `CLIENT_NOTIFICATION_RECIPIENT_POLICIES` (it `satisfies Record<ClientNotificationEventType, ...>` at line 121 — a miss is a **compile error**). Add this entry inside that object literal (place it just before the closing `} as const satisfies ...`):

```ts
  curated_recs_sent: {
    authority: 'workspace_primary',
    source: 'workspace.clientEmail',
    note: 'Curated recommendation sends notify the primary workspace client contact — the doorbell back to the hub.',
  },
```

> Cross-check the exact shape of an existing policy entry (e.g. `work_order_comment_client` at line 106) and mirror its keys — `authority`, `source`, `note` must match the `ClientNotificationRecipientPolicy` type. If the type uses different key names, use those; the satisfies-Record compile check is the gate.

5. Run `npm run typecheck` — expect zero errors. A missing `CATEGORY_MAP` or recipient-policy entry is a compile error here, not a silent pass.

#### Task 1A.10: two child feature flags under the Strategy umbrella

**Files:** `shared/types/feature-flags.ts` (modify)

1. `assertFeatureFlagGroupingConsistency()` is **import-time** — all three edits (FLAGS map, CATALOG, group keys) MUST land in this one task/commit or module load throws. First, `FEATURE_FLAGS` — `'strategy-command-center': false,` is at line 59. Replace:

```ts
  'strategy-command-center': false,
```

with:

```ts
  'strategy-command-center': false,
  // Strategy v3 — staleness scan child flag. Dark-launches the runSentRecStalenessScan cron
  // pass (sent-rec "no response 14d" nudges + supersession flags). OFF = no nudge engine.
  'strategy-staleness-scan': false,
  // Strategy v3 — DEFERRED paid-topic monetization spine (generic strategy_addon SKU +
  // rec→cart bridge for keyword/topic rec types). OFF until the roadmap item lands; v3 renders
  // Add-to-plan ONLY where rec.productType already resolves a SKU (decision 1 / spec §2 / §11).
  'strategy-paid-topics': false,
```

2. `FEATURE_FLAG_CATALOG` (line 135) — the `strategy-command-center` catalog entry ends near line 294 (verify the closing `},` of that entry). Add two new entries **after** it (before the catalog's closing `};`):

```ts
  'strategy-staleness-scan': {
    label: 'Strategy v3 — sent-rec staleness scan (nudge + supersession cron)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-18',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Promote to default once the on-read throttle resurface + nudge cron cost is validated on staging; flag removed and the scan runs unconditionally in the 24h outcome tick.',
      linkedRoadmapItemId: 'strategy-v3-curation-cockpit',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-18',
    },
  },
  'strategy-paid-topics': {
    label: 'Strategy v3 — paid-topic monetization spine (DEFERRED roadmap)',
    group: 'Strategy',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-18',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Enable + remove once the generic strategy_addon SKU + rec→cart bridge + keyword/topic product map ship (deferred roadmap item D8). Until then v3 renders Add-to-plan only where rec.productType already resolves.',
      linkedRoadmapItemId: 'strategy-paid-topic-monetization-spine',
      staleAuditCadence: 'monthly',
      lastReviewedAt: '2026-06-18',
    },
  },
```

> Mirror the exact `lifecycle` sub-key names from the existing `strategy-command-center` entry — `owner`, `createdAt`, `rolloutTarget`, `removalCondition`, `linkedRoadmapItemId`, `staleAuditCadence`, `lastReviewedAt`. If the `FeatureFlagCatalogEntry` type differs, conform to it (the `Record<FeatureFlagKey, FeatureFlagCatalogEntry>` type is the compile gate).

3. `FEATURE_FLAG_GROUPS` — the `'Strategy'` group's `keys` array is at line 324. Replace:

```ts
    keys: ['signal-auto-recompute', 'strategy-command-center'],
```

with:

```ts
    keys: ['signal-auto-recompute', 'strategy-command-center', 'strategy-staleness-scan', 'strategy-paid-topics'],
```

4. Run `npm run typecheck` then `npm run verify:feature-flags` — both expect zero errors (the two child flags grouped + cataloged consistently).

#### Task 1A.11: `TopicCluster.rationale` + `projectedImpact`

**Files:** `shared/types/workspace.ts` (modify)

1. In `interface TopicCluster` (lines ~119–130) the last field before the closing brace is `gap: string[];` (the line-115 `rationale` belongs to a *different* interface — do not confuse them). Replace this exact block:

```ts
  gap: string[];                 // keywords in cluster without ranking or strategy/page coverage
}
```

with:

```ts
  gap: string[];                 // keywords in cluster without ranking or strategy/page coverage
  /** Strategy v3 (#9) — operator/AI rationale for prioritizing this cluster. Optional: legacy
   *  blobs and clusters minted before v3 lack it; the cluster card hides the line when absent. */
  rationale?: string;
  /** Strategy v3 (#9) — banded projected impact of closing this cluster's gap. Client-safe
   *  (banded, never a raw $ figure — mirrors Recommendation.impactBand). Optional on legacy blobs. */
  projectedImpact?: ImpactBand;
}
```

> Confirm the exact text of the `gap` field line with `grep -n "gap:" shared/types/workspace.ts` and match it verbatim; if the trailing comment differs, keep the file's actual comment.

2. `projectedImpact?: ImpactBand` needs the `ImpactBand` import. Check `grep -n "ImpactBand" shared/types/workspace.ts`. If it is NOT already imported, add to the top-of-file imports (grouped with the existing `import type` lines):

```ts
import type { ImpactBand } from './impact-band.js';
```

3. Run `npm run typecheck` — expect zero errors.

#### Task 1A.12: `opportunitiesDetailed?` parallel field on keyword-strategy

**Files:** `shared/types/keyword-strategy.ts` (modify)

1. Leave the existing `opportunities: string[]` (line 38, `StoredKeywordStrategy`) **intact** for the byte-identical read path. Add a parallel optional typed field after it. Find the line:

```ts
  opportunities: string[];
```

in `StoredKeywordStrategy` and replace it with:

```ts
  /** Keyword gaps / untapped opportunities (blob-sourced). */
  opportunities: string[];
  /** Strategy v3 (#6b) — typed opportunities backing the per-row "interested?" send. Parallel
   *  to the bare `opportunities` string[] above (which stays for the byte-identical read path);
   *  P5 Lane 5C populates this. Optional: absent on every pre-v3 blob. */
  opportunitiesDetailed?: Array<{
    keyword: string;
    volume?: number;
    difficulty?: number;
    rationale?: string;
  }>;
```

> If `opportunities: string[]` already carries a JSDoc comment, replace only the bare field line and append the `opportunitiesDetailed?` block after it — do not duplicate the comment. Confirm the exact text with `grep -n "opportunities:" shared/types/keyword-strategy.ts`.

2. Do NOT modify the `KeywordStrategy` interface's `opportunities` (line 156) — only `StoredKeywordStrategy` (the persisted blob shape) needs the parallel field; the in-memory `KeywordStrategy` can stay `string[]` unless a later phase needs it. (Per 00-contracts §12b, the in-place rewrite is explicitly out of scope for Phase 1.)
3. Run `npm run typecheck` — expect zero errors.

#### Task 1A.13: verify + commit the whole contract batch

**Files:** none (verification + commit)

1. Run the full Phase-1 Lane-1A exit gate:

```
npm run typecheck
npx vite build
npm run verify:feature-flags
npx tsx scripts/pr-check.ts
```

Expected: all four green. `typecheck` is load-bearing — `CATEGORY_MAP` and `CLIENT_NOTIFICATION_RECIPIENT_POLICIES` are type-enforced Records, so a missing entry is a compile error.

2. Commit the entire contract batch as one commit:

```
git add shared/types/recommendations.ts server/schemas/workspace-schemas.ts server/state-machines.ts server/activity-log.ts server/ws-events.ts src/lib/wsEvents.ts src/hooks/useWsInvalidation.ts src/lib/wsInvalidation.ts shared/types/intelligence.ts src/lib/queryKeys.ts server/email-templates.ts server/email-throttle.ts server/notification-recipients.ts shared/types/feature-flags.ts shared/types/workspace.ts shared/types/keyword-strategy.ts
git commit -m "Strategy v3 Phase 1 Lane 1A — pre-commit shared lifecycle contracts"
```

3. This is the gate: Lanes 1B/1C/1D and all of Stage 2 read these contracts. Do not proceed to Lane 1B until 1A is committed.

---

### Lane 1B — single-writer module + carry-over + auto-resolve exemption + `isActiveRec` (opus) [after 1A]

**Blocked by:** Lane 1A (imports the lifecycle types `clientStatus`/`lifecycle`/`RecPolicy`/`RecPolicyRegistry`). This lane owns `server/recommendations.ts` **exclusively** within Phase 1 (Lane 1C edits only the OTHER reader files and imports the `isActiveRec` this lane exports). Mutations route through the **EXISTING** per-workspace single-flight in `server/recommendation-regen-scheduler.ts` — do NOT edit the scheduler.

#### Task 1B.1: write the failing test for `isActiveRec`

**Files:** `tests/unit/recommendation-lifecycle.test.ts` (create — partial; Lane 1D will extend it)

> Lane 1D owns the final `tests/unit/recommendation-lifecycle.test.ts`. To keep TDD honest while 1B builds `isActiveRec`, write the `isActiveRec` describe-block here FIRST as the failing test, then 1D folds it into the full file. (Controller coordination: 1B authors the `isActiveRec` block; 1D authors the single-writer blocks. They append to the same file in merge order 1B→1D — no concurrent edit.)

1. Create `tests/unit/recommendation-lifecycle.test.ts`:

```ts
/**
 * Strategy v3 Phase 1 — lifecycle foundation unit tests.
 * isActiveRec is the ONE active-set predicate (00-contracts §2 / spec §6.4).
 */
import { describe, it, expect } from 'vitest';
import { isActiveRec } from '../../server/recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r1', workspaceId: 'ws1', priority: 'fix_now', type: 'metadata',
    title: 't', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 50, source: 's', affectedPages: [], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

describe('isActiveRec', () => {
  it('treats a legacy rec (no v3 fields) as active', () => {
    expect(isActiveRec(rec())).toBe(true);
  });
  it('excludes completed and dismissed (RecStatus terminal)', () => {
    expect(isActiveRec(rec({ status: 'completed' }))).toBe(false);
    expect(isActiveRec(rec({ status: 'dismissed' }))).toBe(false);
  });
  it('excludes struck recs', () => {
    expect(isActiveRec(rec({ lifecycle: 'struck' }))).toBe(false);
  });
  it('excludes throttled recs whose throttledUntil is in the future', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isActiveRec(rec({ lifecycle: 'throttled', throttledUntil: future }))).toBe(false);
  });
  it('re-includes a throttled rec once throttledUntil has passed (on-read resurface)', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isActiveRec(rec({ lifecycle: 'throttled', throttledUntil: past }))).toBe(true);
  });
  it('excludes sent / approved / declined (client already received/resolved)', () => {
    expect(isActiveRec(rec({ clientStatus: 'sent' }))).toBe(false);
    expect(isActiveRec(rec({ clientStatus: 'approved' }))).toBe(false);
    expect(isActiveRec(rec({ clientStatus: 'declined' }))).toBe(false);
  });
  it('includes curated and discussing (still in the active operator/loop set)', () => {
    expect(isActiveRec(rec({ clientStatus: 'curated' }))).toBe(true);
    expect(isActiveRec(rec({ clientStatus: 'discussing' }))).toBe(true);
  });
});
```

2. Run `npx vitest run tests/unit/recommendation-lifecycle.test.ts` — expect **fail** (`isActiveRec` not exported yet: `SyntaxError` / `isActiveRec is not a function`).

#### Task 1B.2: implement + export `isActiveRec`

**Files:** `server/recommendations.ts` (modify)

1. `computeRecommendationSummary` is at line 599. Add `isActiveRec` as an exported function **immediately above** it (so the summary can call it). Insert before line 599:

```ts
/**
 * The ONE active-set predicate (spec §6.4). A rec is "active" — eligible to surface in the
 * Act queue, the summary top-rec, AI context, and briefings — iff:
 *   - RecStatus is not terminal (not completed, not dismissed), AND
 *   - it is not permanently struck, AND
 *   - it is not throttled into the future (throttle auto-resurfaces on-read once the date passes), AND
 *   - the client has not already received/resolved it (clientStatus not sent/approved/declined).
 * Absent v3 fields ⇒ legacy rec ⇒ treated as clientStatus:'system', lifecycle:'active'.
 * Imported by EVERY reader so no surface re-implements a partial filter (the leak bug pattern).
 */
export function isActiveRec(rec: Recommendation, now: number = Date.now()): boolean {
  if (rec.status === 'completed' || rec.status === 'dismissed') return false;
  if (rec.lifecycle === 'struck') return false;
  if (rec.lifecycle === 'throttled' && rec.throttledUntil && Date.parse(rec.throttledUntil) > now) return false;
  if (rec.clientStatus === 'sent' || rec.clientStatus === 'approved' || rec.clientStatus === 'declined') return false;
  return true;
}
```

2. Run `npx vitest run tests/unit/recommendation-lifecycle.test.ts` — expect **pass** (all `isActiveRec` cases green).

#### Task 1B.3: route `computeRecommendationSummary` through `isActiveRec`

**Files:** `server/recommendations.ts` (modify)

1. `computeRecommendationSummary` currently hand-rolls the filter at line 600: `const activeRecs = recs.filter(r => r.status !== 'completed' && r.status !== 'dismissed');`. Replace that exact line:

```ts
  const activeRecs = recs.filter(r => r.status !== 'completed' && r.status !== 'dismissed');
```

with:

```ts
  const activeRecs = recs.filter(r => isActiveRec(r));
```

2. Run `npm run typecheck` — expect zero errors. Run `npx vitest run tests/unit/recommendation-lifecycle.test.ts` — expect pass.

#### Task 1B.4: write the failing carry-over test (regen preserves lifecycle)

**Files:** `tests/integration/recommendation-regen-preserves-lifecycle.test.ts` (create)

> This is one of the three Phase-1 exit-gate tests. It is owned by Lane 1D in the audit inventory, but TDD requires it RED before 1B implements the carry-over. Author it here; 1D verifies/refines it after 1B/1C land. (Same merge-order discipline as 1B.1.)

1. Create `tests/integration/recommendation-regen-preserves-lifecycle.test.ts`:

```ts
/**
 * Strategy v3 Phase 1 exit gate (00-contracts §6.3, spec §6.3 / audit prevention #3).
 * Carry-over: send a rec (clientStatus='sent'), run a regen merge, assert clientStatus
 * is STILL 'sent' afterward. Guards the merge carry-over at recommendations.ts ~2364-2382,
 * which pre-v3 copied only status/id/createdAt and would silently drop the lifecycle axis.
 *
 * Uses applyLifecycleCarryOver directly (the pure merge helper Lane 1B extracts) so the test
 * is fast + deterministic — no full generateRecommendations crawl.
 */
import { describe, it, expect } from 'vitest';
import { applyLifecycleCarryOver } from '../../server/recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'old1', workspaceId: 'ws1', priority: 'fix_now', type: 'metadata',
    title: 'Fix meta', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 50, source: 'audit:meta', affectedPages: ['home'], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

describe('regen preserves the client-facing lifecycle axis', () => {
  it('carries clientStatus=sent + sentAt onto the freshly-minted matching rec', () => {
    const sentAt = new Date(Date.now() - 3_600_000).toISOString();
    const oldRec = rec({ id: 'old1', clientStatus: 'sent', sentAt, status: 'pending' });
    // a freshly-minted rec from the new run with the SAME merge key (source+pages+title)
    const newRec = rec({ id: 'new1', status: 'pending' });

    applyLifecycleCarryOver([newRec], [oldRec]);

    expect(newRec.clientStatus).toBe('sent');
    expect(newRec.sentAt).toBe(sentAt);
    expect(newRec.id).toBe('old1'); // continuity: keep the old id
  });

  it('carries struck + throttled lifecycle and cascade metadata across a regen', () => {
    const struckAt = new Date(Date.now() - 7_200_000).toISOString();
    const oldStruck = rec({ id: 'old2', source: 'audit:keyword', title: 'kw', lifecycle: 'struck', struckAt, cascade: { removedKeywords: ['foo'], reversible: true } });
    const newStruck = rec({ id: 'new2', source: 'audit:keyword', title: 'kw' });

    applyLifecycleCarryOver([newStruck], [oldStruck]);

    expect(newStruck.lifecycle).toBe('struck');
    expect(newStruck.struckAt).toBe(struckAt);
    expect(newStruck.cascade?.removedKeywords).toEqual(['foo']);
  });

  it('leaves a brand-new rec with no matching old rec untouched (no lifecycle injected)', () => {
    const fresh = rec({ id: 'fresh', source: 'audit:new-check', title: 'new' });
    applyLifecycleCarryOver([fresh], []);
    expect(fresh.clientStatus).toBeUndefined();
    expect(fresh.lifecycle).toBeUndefined();
  });
});
```

2. Run `npx vitest run tests/integration/recommendation-regen-preserves-lifecycle.test.ts` — expect **fail** (`applyLifecycleCarryOver` not exported yet).

#### Task 1B.5: extract + export `applyLifecycleCarryOver` and wire it into the merge

**Files:** `server/recommendations.ts` (modify)

1. The merge carry-over block is at lines 2364–2382 (verified). It currently copies only `status`/`id`/`createdAt` on the in_progress/completed/dismissed branches. Extract a pure helper that ALSO copies every lifecycle-axis field for **every** matched oldRec regardless of `RecStatus`. Add this exported helper immediately above `isActiveRec` (so both live together near the summary), i.e. insert before the `isActiveRec` block you added in 1B.2:

```ts
/** Strategy v3 (00-contracts §6.3) — copy the client-facing lifecycle axis from each matched
 *  old rec onto its freshly-minted counterpart during regen. Keyed by buildMergeKey so a
 *  re-detected issue keeps its sent/throttled/struck state (the trust-critical carry-over —
 *  a sent rec must NOT reset to 'system' on the next regen). Copies for EVERY matched oldRec
 *  regardless of RecStatus (the pre-v3 merge only ran on in_progress/completed/dismissed). */
export function applyLifecycleCarryOver(newRecs: Recommendation[], oldRecs: Recommendation[]): void {
  const oldByKey = new Map<string, Recommendation>();
  for (const oldRec of oldRecs) oldByKey.set(buildMergeKey(oldRec), oldRec);
  for (const newRec of newRecs) {
    const oldRec = oldByKey.get(buildMergeKey(newRec));
    if (!oldRec) continue;
    // Continuity: keep the old id + createdAt so the frontend + sentAt lineage stay stable.
    newRec.id = oldRec.id;
    newRec.createdAt = oldRec.createdAt;
    // Copy the full client-facing lifecycle axis (only when present — absent stays absent so
    // a never-curated rec is byte-identical).
    if (oldRec.clientStatus !== undefined) newRec.clientStatus = oldRec.clientStatus;
    if (oldRec.lifecycle !== undefined) newRec.lifecycle = oldRec.lifecycle;
    if (oldRec.throttledUntil !== undefined) newRec.throttledUntil = oldRec.throttledUntil;
    if (oldRec.sentAt !== undefined) newRec.sentAt = oldRec.sentAt;
    if (oldRec.struckAt !== undefined) newRec.struckAt = oldRec.struckAt;
    if (oldRec.cascade !== undefined) newRec.cascade = oldRec.cascade;
    if (oldRec.sendChannel !== undefined) newRec.sendChannel = oldRec.sendChannel;
  }
}
```

2. Now call it from the existing merge loop so the RecStatus carry-over AND the lifecycle carry-over both run. In the merge block (lines 2360–2382), the per-rec loop sets `status`/`id`/`createdAt`. Leave the existing `status` logic intact (it owns the RecStatus axis), and add the lifecycle copy. Replace the existing per-rec carry-over block:

```ts
      // Preserve status from existing rec if it was in_progress or completed
      const oldRec = existingByKey.get(key);
      if (oldRec) {
        if (oldRec.status === 'in_progress') {
          newRec.status = oldRec.status;
          newRec.id = oldRec.id; // keep same ID for frontend continuity
          newRec.createdAt = oldRec.createdAt;
        } else if (oldRec.status === 'completed') {
          validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, oldRec.status, 'pending');
          newRec.status = 'pending';
          newRec.id = oldRec.id; // keep same ID for frontend continuity
          newRec.createdAt = oldRec.createdAt;
        } else if (oldRec.status === 'dismissed') {
          newRec.status = 'dismissed';
          newRec.id = oldRec.id;
          newRec.createdAt = oldRec.createdAt;
        }
      }
```

with:

```ts
      // Preserve status from existing rec if it was in_progress or completed
      const oldRec = existingByKey.get(key);
      if (oldRec) {
        if (oldRec.status === 'in_progress') {
          newRec.status = oldRec.status;
          newRec.id = oldRec.id; // keep same ID for frontend continuity
          newRec.createdAt = oldRec.createdAt;
        } else if (oldRec.status === 'completed') {
          validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, oldRec.status, 'pending');
          newRec.status = 'pending';
          newRec.id = oldRec.id; // keep same ID for frontend continuity
          newRec.createdAt = oldRec.createdAt;
        } else if (oldRec.status === 'dismissed') {
          newRec.status = 'dismissed';
          newRec.id = oldRec.id;
          newRec.createdAt = oldRec.createdAt;
        }
      }
```

(unchanged — the RecStatus branch keeps its existing logic), then **after** the entire `for (const newRec of recs) { ... }` merge loop closes (after line 2382's `}`), add the single carry-over call over the full set:

```ts
    // Strategy v3 — carry the client-facing lifecycle axis across regen for EVERY matched rec
    // (the RecStatus branch above only ran on in_progress/completed/dismissed). buildMergeKey
    // re-matches old↔new; applyLifecycleCarryOver also re-applies id+createdAt continuity (idempotent
    // with the branch above). This is the trust-critical graft: a sent rec stays sent through regen.
    applyLifecycleCarryOver(recs, Array.from(existingByKey.values()));
```

> `existingByKey` is the `Map<mergeKey, oldRec>` built just above the loop (line 2356). Passing its values gives `applyLifecycleCarryOver` the full old set.

3. Run `npx vitest run tests/integration/recommendation-regen-preserves-lifecycle.test.ts` — expect **pass**.
4. Run `npm run typecheck` — expect zero errors.

#### Task 1B.6: write the failing auto-resolve-exemption test (strike never completed)

**Files:** `tests/unit/recommendation-lifecycle.test.ts` (modify — append a describe block)

1. Append to `tests/unit/recommendation-lifecycle.test.ts` a block exercising the exemption helper Lane 1B adds next. Add this `describe` after the existing `isActiveRec` block (update the import line at the top to also import `isExemptFromAutoResolve`):

```ts
import { isActiveRec, isExemptFromAutoResolve } from '../../server/recommendations.js';
```

(replace the existing single-name import) and append:

```ts
describe('auto-resolve exemption (clientStatus in {sent,discussing,approved})', () => {
  it('exempts a sent rec from the destructive auto-resolve → completed sweep', () => {
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'sent' }))).toBe(true);
  });
  it('exempts discussing + approved recs', () => {
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'discussing' }))).toBe(true);
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'approved' }))).toBe(true);
  });
  it('does NOT exempt system / curated / declined recs (they may auto-resolve normally)', () => {
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'system' }))).toBe(false);
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'curated' }))).toBe(false);
    expect(isExemptFromAutoResolve(rec({ clientStatus: 'declined' }))).toBe(false);
    expect(isExemptFromAutoResolve(rec())).toBe(false); // legacy / no v3 field
  });
});
```

2. Run `npx vitest run tests/unit/recommendation-lifecycle.test.ts` — expect **fail** (`isExemptFromAutoResolve` not exported).

#### Task 1B.7: implement the auto-resolve exemption

**Files:** `server/recommendations.ts` (modify)

1. Add the exempt predicate beside `isActiveRec` (insert above the `isActiveRec` block):

```ts
/** Strategy v3 (00-contracts §6.5 / spec §6.5) — recs the client has SEEN must be exempt from the
 *  destructive auto-resolve → 'completed' sweep. A sent/discussing/approved rec swept to completed
 *  would read to the client as "✓ done" even though we struck/never-did it. When such a rec's
 *  condition is genuinely fixed, a SEPARATE positive-terminal transition handles it (P2/P3) — the
 *  auto-resolve sweep simply skips it here. declined is NOT exempt (the client said no; it can resolve). */
export function isExemptFromAutoResolve(rec: Recommendation): boolean {
  return rec.clientStatus === 'sent' || rec.clientStatus === 'discussing' || rec.clientStatus === 'approved';
}
```

2. Wire it into the auto-resolve loop (lines 2390–2416). The loop currently skips only `completed`/`dismissed` at line 2392. Add the exemption skip right after it. Replace this exact line:

```ts
      if (oldRec.status === 'completed' || oldRec.status === 'dismissed') continue;
```

with:

```ts
      if (oldRec.status === 'completed' || oldRec.status === 'dismissed') continue;
      // Strategy v3 (§6.5): a rec the client has already seen (sent/discussing/approved) must
      // never be auto-swept to 'completed' (it would read as "✓ done" — the trust-critical graft).
      if (isExemptFromAutoResolve(oldRec)) continue;
```

3. Run `npx vitest run tests/unit/recommendation-lifecycle.test.ts` — expect **pass**.
4. Run `npm run typecheck` — expect zero errors.

#### Task 1B.8: write the failing test for the single-writer + policy registry

**Files:** `tests/integration/recommendation-lifecycle.test.ts` (create — single-writer integration block)

> Distinct file from the unit test: this exercises the transactional single-writer against a real DB workspace. Lane 1D's inventory does not list this file by name, but the single-writer module needs its own test; it lands in this lane (1B owns `recommendation-lifecycle.ts`).

1. Create `tests/integration/recommendation-lifecycle.test.ts`:

```ts
/**
 * Strategy v3 Phase 1 Lane 1B — single-writer module (server/recommendation-lifecycle.ts).
 * All blob lifecycle mutations go through one transactional writer that re-reads the set
 * inside the txn, applies the single-field delta, recomputes summary, and upserts
 * (00-contracts §11 / spec §6.2). Tests the real DB round-trip via loadRecommendations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations, loadRecommendations } from '../../server/recommendations.js';
import { sendRecommendation, strikeRecommendation, throttleRecommendation, REC_POLICY_REGISTRY } from '../../server/recommendation-lifecycle.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

let wsId = '';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r1', workspaceId: wsId, priority: 'fix_now', type: 'metadata',
    title: 't', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 50, source: 's', affectedPages: ['home'], trafficAtRisk: 0,
    impressionsAtRisk: 0, estimatedGain: 'g', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

function seed(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId, generatedAt: new Date().toISOString(), recommendations: recs,
    summary: { fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: recs[0]?.id ?? null },
  };
  saveRecommendations(set);
}

beforeAll(() => { wsId = createWorkspace('Rec Lifecycle Single-Writer Test').id; });
afterAll(() => { deleteWorkspace(wsId); });

describe('recommendation-lifecycle single-writer', () => {
  it('sendRecommendation sets clientStatus=sent + sentAt and recomputes summary', () => {
    seed([rec({ id: 'send1', clientStatus: 'curated' })]);
    sendRecommendation(wsId, 'send1');
    const after = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'send1')!;
    expect(after.clientStatus).toBe('sent');
    expect(after.sentAt).toBeTruthy();
    // sent recs are not active → excluded from the summary top-rec
    expect(loadRecommendations(wsId)!.summary.topRecommendationId).not.toBe('send1');
  });

  it('strikeRecommendation sets lifecycle=struck + struckAt and never touches RecStatus', () => {
    seed([rec({ id: 'strike1', status: 'pending' })]);
    strikeRecommendation(wsId, 'strike1');
    const after = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'strike1')!;
    expect(after.lifecycle).toBe('struck');
    expect(after.struckAt).toBeTruthy();
    expect(after.status).toBe('pending'); // RecStatus untouched — the trust-critical graft
  });

  it('throttleRecommendation sets lifecycle=throttled + a future throttledUntil', () => {
    seed([rec({ id: 'throttle1' })]);
    throttleRecommendation(wsId, 'throttle1', 30);
    const after = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'throttle1')!;
    expect(after.lifecycle).toBe('throttled');
    expect(Date.parse(after.throttledUntil!)).toBeGreaterThan(Date.now());
  });

  it('exposes a per-RecType policy registry (metadata routes via "rec", cannibalization via "deliverable")', () => {
    expect(REC_POLICY_REGISTRY.metadata?.sendChannel).toBe('rec');
    expect(REC_POLICY_REGISTRY.cannibalization?.sendChannel).toBe('deliverable');
  });
});
```

2. Run `npx vitest run tests/integration/recommendation-lifecycle.test.ts` — expect **fail** (`server/recommendation-lifecycle.js` does not exist).

#### Task 1B.9: implement the single-writer module + policy registry

**Files:** `server/recommendation-lifecycle.ts` (create)

1. Create `server/recommendation-lifecycle.ts`. It wraps each mutation in `db.transaction()`, re-reads inside the txn, applies the single-field delta, recomputes the summary, and upserts via `saveRecommendations`. It routes through the existing per-workspace single-flight by reusing the same `db` transaction primitive the rest of the module uses (the regen scheduler's single-flight serializes regen; lifecycle mutations are short synchronous txns, so the txn itself is the atomicity guard per spec §6.2):

```ts
/**
 * Strategy v3 (spec §6.2, 00-contracts §11) — the SINGLE WRITER for the recommendation
 * client-facing lifecycle axis. All clientStatus / lifecycle mutations go through here so
 * the trust-critical invariant holds: strike/throttle/send NEVER write RecStatus.
 *
 * Each mutation:
 *   1. opens a db.transaction() (atomic — no AI-call-before-write, all synchronous)
 *   2. re-reads the set INSIDE the txn (not a stale route copy)
 *   3. applies the single-field delta + a state-machine validateTransition guard
 *   4. recomputes the summary (so a sent/struck rec drops out of topRecommendationId)
 *   5. upserts via saveRecommendations
 *
 * Routing per RecType is decided by REC_POLICY_REGISTRY (sendChannel rec|deliverable).
 */
import db from './db/index.js';
import { loadRecommendations, saveRecommendations, computeRecommendationSummary } from './recommendations.js';
import { validateTransition, RECOMMENDATION_TRANSITIONS } from './state-machines.js';
import { createLogger } from './logger.js';
import type { Recommendation, RecPolicyRegistry } from '../shared/types/recommendations.js';

const log = createLogger('recommendation-lifecycle');

/** Per-RecType curation policy (spec §6.2). content_decay/cannibalization route Send to the
 *  deliverable spine; everything else mutates clientStatus directly. keyword/topic strikes cascade
 *  (remove strategy items). An unlisted RecType cannot be curated until a policy is registered. */
export const REC_POLICY_REGISTRY: RecPolicyRegistry = {
  technical:        { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  content:          { sendChannel: 'rec', cascadeOnStrike: false, monetizable: true },
  content_refresh:  { sendChannel: 'rec', cascadeOnStrike: false, monetizable: true },
  schema:           { sendChannel: 'rec', cascadeOnStrike: false, monetizable: true },
  metadata:         { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  performance:      { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  accessibility:    { sendChannel: 'rec', cascadeOnStrike: false, monetizable: true },
  strategy:         { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  aeo:              { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  keyword_gap:      { sendChannel: 'rec', cascadeOnStrike: true,  monetizable: false },
  topic_cluster:    { sendChannel: 'rec', cascadeOnStrike: true,  monetizable: false },
  cannibalization:  { sendChannel: 'deliverable', cascadeOnStrike: false, monetizable: false },
  local_visibility: { sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
  local_service_gap:{ sendChannel: 'rec', cascadeOnStrike: false, monetizable: false },
};

/** Run a lifecycle mutation transactionally: re-read inside the txn, mutate the matched rec,
 *  recompute summary, persist. Returns the mutated rec (or null when the rec id is absent). */
function mutateRec(
  workspaceId: string,
  recId: string,
  apply: (rec: Recommendation) => void,
): Recommendation | null {
  const txn = db.transaction((): Recommendation | null => {
    const set = loadRecommendations(workspaceId);
    if (!set) return null;
    const rec = set.recommendations.find(r => r.id === recId);
    if (!rec) return null;
    apply(rec);
    rec.updatedAt = new Date().toISOString();
    set.summary = computeRecommendationSummary(set.recommendations);
    saveRecommendations(set);
    return rec;
  });
  return txn();
}

/** Send a curated rec to the client. Validates curated→sent on the operator axis and stamps sentAt.
 *  NEVER writes RecStatus. The caller (P2 route) handles the deliverable-spine branch for
 *  sendChannel==='deliverable' RecTypes before reaching here. */
export function sendRecommendation(workspaceId: string, recId: string): Recommendation | null {
  return mutateRec(workspaceId, recId, (rec) => {
    const from = rec.clientStatus ?? 'system';
    // curated→sent is the blessed edge; allow system→sent (operator skips the curate step) by
    // first validating system→curated then curated→sent, mirroring the two-edge path.
    if (from === 'system') validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, 'system', 'curated');
    validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, from === 'system' ? 'curated' : from, 'sent');
    rec.clientStatus = 'sent';
    rec.sentAt = new Date().toISOString();
  });
}

/** Strike a rec — permanent suppression on the lifecycle axis. Arm-then-confirm + Undo live in the
 *  UI (P2); this is the commit. NEVER writes RecStatus. cascade metadata is passed by the caller
 *  for keyword/topic strikes that also remove strategy items (reversible). */
export function strikeRecommendation(
  workspaceId: string,
  recId: string,
  cascade?: Recommendation['cascade'],
): Recommendation | null {
  return mutateRec(workspaceId, recId, (rec) => {
    rec.lifecycle = 'struck';
    rec.struckAt = new Date().toISOString();
    if (cascade) rec.cascade = cascade;
  });
}

/** Throttle a rec for N days. lifecycle=throttled + a future throttledUntil; the rec
 *  auto-resurfaces on-read once the date passes (isActiveRec handles it — no cron). */
export function throttleRecommendation(
  workspaceId: string,
  recId: string,
  days: 7 | 30 | 90 | number,
): Recommendation | null {
  return mutateRec(workspaceId, recId, (rec) => {
    rec.lifecycle = 'throttled';
    rec.throttledUntil = new Date(Date.now() + days * 86_400_000).toISOString();
  });
}

/** Undo a strike or throttle — restore the rec to active. NEVER writes RecStatus. */
export function unsuppressRecommendation(workspaceId: string, recId: string): Recommendation | null {
  return mutateRec(workspaceId, recId, (rec) => {
    rec.lifecycle = 'active';
    delete rec.throttledUntil;
    delete rec.struckAt;
    delete rec.cascade;
  });
}

log.debug('recommendation-lifecycle single-writer loaded');
```

2. The `db` import is a **default** import — `import db from './db/index.js'` (verified: `server/recommendations.ts:15`). It exposes `db.transaction(...)` from better-sqlite3. The import line above already uses the default form; do not change it to a named import.
3. Run `npx vitest run tests/integration/recommendation-lifecycle.test.ts` — expect **pass** (all four cases).
4. Run `npm run typecheck` — expect zero errors.

#### Task 1B.10: verify + commit Lane 1B

**Files:** none (verification + commit)

1. Run:

```
npm run typecheck
npx vitest run tests/unit/recommendation-lifecycle.test.ts tests/integration/recommendation-lifecycle.test.ts tests/integration/recommendation-regen-preserves-lifecycle.test.ts
npx tsx scripts/pr-check.ts
```

Expected: all green. (pr-check verifies the `db.transaction()` wrapper + no bare `JSON.parse` + no AI-call-before-write.)

2. Commit:

```
git add server/recommendation-lifecycle.ts server/recommendations.ts tests/unit/recommendation-lifecycle.test.ts tests/integration/recommendation-lifecycle.test.ts tests/integration/recommendation-regen-preserves-lifecycle.test.ts
git commit -m "Strategy v3 Phase 1 Lane 1B — single-writer + isActiveRec + lifecycle carry-over + auto-resolve exemption"
```

---

### Lane 1C — reader retrofits + public allow-list (sonnet) [after 1B]

**Blocked by:** Lane 1B (imports the exported `isActiveRec`). This lane edits ONLY the reader files (never `server/recommendations.ts` — Lane 1B owns it). Each retrofit replaces a hand-rolled status filter that today leaks throttled/sent/struck recs into AI context, summaries, and the public payload.

#### Task 1C.1: write the failing flag-OFF + flag-ON public allow-list test

**Files:** `tests/integration/recommendations-public-allowlist.test.ts` (create)

> This is the third Phase-1 exit-gate test (audit prevention #2). It exercises the REAL public read path (`GET /api/public/recommendations/:workspaceId`), not the admin GET. It asserts (a) flag-OFF byte-identical (no v3 fields present on a legacy rec → output unchanged), and (b) flag-ON no-admin-key-leak (a rec WITH admin-only lifecycle fields → none appear in the public payload).

1. Create `tests/integration/recommendations-public-allowlist.test.ts`:

```ts
/**
 * Strategy v3 Phase 1 exit gate (spec §7.4, audit prevention #2). The public rec read must be
 * an explicit ALLOW-LIST: admin-only lifecycle keys (throttledUntil, struckAt, sentAt, cascade,
 * lifecycle, sendChannel) must NEVER appear in the public payload, even when set on the rec.
 * AND a legacy rec (no v3 fields) must serialize byte-identically (the flag-OFF guarantee).
 * Exercises the REAL public GET, not the admin route.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { saveRecommendations } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;
let wsId = '';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  const now = new Date().toISOString();
  return {
    id: 'r1', workspaceId: wsId, priority: 'fix_now', type: 'metadata',
    title: 'Fix meta', description: 'd', insight: 'i', impact: 'high', effort: 'low',
    impactScore: 50, source: 'audit:meta', affectedPages: ['home'], trafficAtRisk: 10,
    impressionsAtRisk: 100, estimatedGain: 'Could lift organic clicks', actionType: 'manual',
    status: 'pending', createdAt: now, updatedAt: now, ...overrides,
  };
}

function seed(recs: Recommendation[]): void {
  const set: RecommendationSet = {
    workspaceId: wsId, generatedAt: new Date().toISOString(), recommendations: recs,
    summary: { fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: recs[0]?.id ?? null },
  };
  saveRecommendations(set);
}

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Rec Public Allowlist Test').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('public rec read — allow-list (no admin-only lifecycle key leaks)', () => {
  it('flag-ON: a rec with admin-only lifecycle fields exposes NONE of them on the public read', async () => {
    // A curated rec carrying every admin-only lifecycle key.
    seed([rec({
      id: 'leak_test',
      clientStatus: 'curated',
      lifecycle: 'throttled',
      throttledUntil: new Date(Date.now() + 86_400_000).toISOString(),
      sentAt: new Date().toISOString(),
      struckAt: new Date().toISOString(),
      cascade: { removedKeywords: ['secret-kw'], reversible: true },
      sendChannel: 'deliverable',
    })]);

    const res = await api(`/api/public/recommendations/${wsId}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    // None of the admin-only lifecycle keys (or their values) may appear in the wire payload.
    expect(raw).not.toContain('throttledUntil');
    expect(raw).not.toContain('struckAt');
    expect(raw).not.toContain('sentAt');
    expect(raw).not.toContain('cascade');
    expect(raw).not.toContain('secret-kw');
    expect(raw).not.toContain('sendChannel');
    // lifecycle/clientStatus are admin-axis — not on the public allow-list.
    const body = JSON.parse(raw) as RecommendationSet;
    const found = body.recommendations.find(r => r.id === 'leak_test');
    expect(found).toBeDefined();
    expect((found as Record<string, unknown>).lifecycle).toBeUndefined();
    expect((found as Record<string, unknown>).throttledUntil).toBeUndefined();
  });

  it('flag-OFF byte-identical: a legacy rec (no v3 fields) carries no v3 keys on the public read', async () => {
    seed([rec({ id: 'legacy_rec' })]); // no v3 fields at all
    const res = await api(`/api/public/recommendations/${wsId}`);
    const raw = await res.text();
    expect(raw).not.toContain('lifecycle');
    expect(raw).not.toContain('clientStatus');
    expect(raw).not.toContain('throttledUntil');
    const body = JSON.parse(raw) as RecommendationSet;
    const found = body.recommendations.find(r => r.id === 'legacy_rec');
    expect(found).toBeDefined();
    // The client-safe core survives intact.
    expect(found!.title).toBe('Fix meta');
    expect(found!.priority).toBe('fix_now');
  });
});
```

2. Run `npx vitest run tests/integration/recommendations-public-allowlist.test.ts` — expect **fail** on the flag-ON case (the current `stripEmvFromPublicRecs` is a blocklist that spreads `...base`, so it leaks `throttledUntil`/`struckAt`/etc.).

#### Task 1C.2: convert `stripEmvFromPublicRecs` to an allow-list projection

**Files:** `server/routes/recommendations.ts` (modify)

1. The current `stripEmvFromPublicRecs` (lines 65–84) spreads `...base` (a blocklist — anything new leaks). Convert it to an explicit allow-list that names only client-safe fields. First add the `isActiveRec` import to the existing import from `../recommendations.js` (lines 10–16). Replace:

```ts
import {
  loadRecommendations,
  computeRecommendationSummary,
  updateRecommendationStatus,
  dismissRecommendation,
  recommendationOutcomeActionType,
} from '../recommendations.js';
```

with:

```ts
import {
  loadRecommendations,
  computeRecommendationSummary,
  updateRecommendationStatus,
  dismissRecommendation,
  recommendationOutcomeActionType,
  isActiveRec,
} from '../recommendations.js';
```

2. Replace the entire `stripEmvFromPublicRecs` function body (lines 65–84). Replace:

```ts
function stripEmvFromPublicRecs(recs: Recommendation[]): Recommendation[] {
  return recs.map(r => {
    // Sanitize the top-level gain string (defense-in-depth: no raw $/wk to a client).
    const safeGain = typeof r.estimatedGain === 'string' ? sanitizePublicGain(r.estimatedGain) : r.estimatedGain;
    const base: Recommendation = safeGain === r.estimatedGain ? r : { ...r, estimatedGain: safeGain };
    if (!base.opportunity) return base;
    const { emvPerWeek: rawEmvPerWeek, predictedEmv: _predictedEmv, roiPerEffortDay: _roiPerEffortDay, ...publicOpportunity } = base.opportunity;
    // D-IMPACT: project the admin/AI-only weekly EMV into a client-safe banded
    // monthly range BEFORE it is stripped. computeImpactBand returns undefined below
    // the display floor (no impact line shown) — in that case we drop the key entirely.
    const impactBand = computeImpactBand(rawEmvPerWeek);
    const next: Recommendation = {
      ...base,
      opportunity: publicOpportunity as Recommendation['opportunity'],
    };
    if (impactBand) next.impactBand = impactBand;
    else delete next.impactBand;
    return next;
  });
}
```

with:

```ts
// Strategy v3 (spec §7.4 / 00-contracts §4 readers) — the public rec projection is an explicit
// ALLOW-LIST, not a blocklist. A blocklist (`...rec` minus a few keys) silently leaks every NEW
// admin-only field the moment it is added (the v3 lifecycle axis: throttledUntil/struckAt/sentAt/
// cascade/lifecycle/clientStatus/sendChannel). This names ONLY client-safe fields, so a future
// admin-only field is leak-proof by default. The OpportunityScore is itself allow-listed (raw
// emvPerWeek/predictedEmv/roiPerEffortDay never copied), and estimatedGain is dollar-sanitized.
function projectPublicRec(r: Recommendation): Recommendation {
  const safeGain = typeof r.estimatedGain === 'string' ? sanitizePublicGain(r.estimatedGain) : r.estimatedGain;
  const out: Recommendation = {
    id: r.id,
    workspaceId: r.workspaceId,
    priority: r.priority,
    type: r.type,
    title: r.title,
    description: r.description,
    insight: r.insight,
    impact: r.impact,
    effort: r.effort,
    impactScore: r.impactScore,
    source: r.source,
    affectedPages: r.affectedPages,
    trafficAtRisk: r.trafficAtRisk,
    impressionsAtRisk: r.impressionsAtRisk,
    estimatedGain: safeGain,
    actionType: r.actionType,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
  // Client-safe optional fields — copied only when present (preserves byte-identical absence).
  if (r.productType !== undefined) out.productType = r.productType;
  if (r.productPrice !== undefined) out.productPrice = r.productPrice;
  if (r.targetKeyword !== undefined) out.targetKeyword = r.targetKeyword;
  if (r.assignedTo !== undefined) out.assignedTo = r.assignedTo;
  if (r.backfilled !== undefined) out.backfilled = r.backfilled;
  // OpportunityScore: allow-list the client-safe sub-fields; raw $/ROI never copied.
  if (r.opportunity) {
    const { emvPerWeek: rawEmvPerWeek, predictedEmv: _predictedEmv, roiPerEffortDay: _roiPerEffortDay, ...publicOpportunity } = r.opportunity;
    out.opportunity = publicOpportunity as Recommendation['opportunity'];
    // D-IMPACT: project the stripped weekly EMV into a banded monthly impactBand (undefined below floor).
    const impactBand = computeImpactBand(rawEmvPerWeek);
    if (impactBand) out.impactBand = impactBand;
  }
  return out;
}

function stripEmvFromPublicRecs(recs: Recommendation[]): Recommendation[] {
  return recs.map(projectPublicRec);
}
```

> The allow-list deliberately OMITS every v3 lifecycle field (`clientStatus`, `lifecycle`, `throttledUntil`, `sentAt`, `struckAt`, `cascade`, `sendChannel`). The public curated read (P4) reads `clientStatus` server-side to FILTER which recs to return, but never serializes the axis to the client.

3. Run `npx vitest run tests/integration/recommendations-public-allowlist.test.ts tests/integration/recommendations-public-emv-leak.test.ts` — expect **both pass** (the emv-leak test still green; the new allowlist test now green).
4. Run `npm run typecheck` — expect zero errors.

#### Task 1C.3: retrofit the operational-slice rec counter

**Files:** `server/intelligence/operational-slice.ts` (modify)

1. The hand-rolled rec filter is at line 217: `if (rec.status === 'pending' || !rec.status) {`. This leaks throttled/sent recs into the operational rec counter. First add the import (grouped with existing imports — check `grep -n "^import" server/intelligence/operational-slice.ts` and add to the import from `../recommendations.js` if one exists, else add a new import line):

```ts
import { isActiveRec } from '../recommendations.js';
```

2. Replace the hand-rolled filter at line 217. Replace:

```ts
          if (rec.status === 'pending' || !rec.status) {
```

with:

```ts
          if (isActiveRec(rec)) {
```

> Confirm the surrounding loop with `grep -n "rec.status === 'pending'" server/intelligence/operational-slice.ts` and match the exact line (line 217) — there are other `status === 'pending'` checks in this file (jobs at 88, work orders at 288) that are NOT recs; only the rec-counter one changes.

3. Run `npm run typecheck` — expect zero errors.

#### Task 1C.4: retrofit the seo-context-slice topRec filter

**Files:** `server/intelligence/seo-context-slice.ts` (modify)

1. The hand-rolled topRec status filter spans lines 484–485 (`r.status !== 'completed' && r.status !== 'dismissed'`). This leaks throttled/sent recs into the AI context. Add the import (grouped with existing imports):

```ts
import { isActiveRec } from '../recommendations.js';
```

2. Read the exact filter context first: `grep -n -A2 -B2 "status !== 'completed'" server/intelligence/seo-context-slice.ts`. The filter is a multi-line `.filter(r => ... r.status !== 'completed' && r.status !== 'dismissed')`. Replace the status-predicate portion with `isActiveRec(r)`. For example, if the filter reads:

```ts
          .filter(
            (r) =>
              r.status !== 'completed' &&
              r.status !== 'dismissed',
          )
```

replace it with:

```ts
          .filter((r) => isActiveRec(r))
```

> Match the actual surrounding `.filter(...)` text verbatim before replacing — the predicate may include additional conditions; if so, keep them and swap ONLY the `status !== 'completed' && status !== 'dismissed'` clause for `isActiveRec(r)`.

3. Run `npm run typecheck` — expect zero errors.

#### Task 1C.5: retrofit the page-profile-slice filter

**Files:** `server/intelligence/page-profile-slice.ts` (modify)

1. The hand-rolled filter is at line 70: `.filter(r => r.affectedPages?.some(p => matchPageIdentity(p, pagePath)) && (r.status === 'pending' || !r.status))`. The `(r.status === 'pending' || !r.status)` clause leaks throttled/struck/sent recs onto the page profile. Add the import (grouped with existing imports):

```ts
import { isActiveRec } from '../recommendations.js';
```

2. Replace the filter at line 70. Replace:

```ts
        .filter(r => r.affectedPages?.some(p => matchPageIdentity(p, pagePath)) && (r.status === 'pending' || !r.status))
```

with:

```ts
        .filter(r => r.affectedPages?.some(p => matchPageIdentity(p, pagePath)) && isActiveRec(r))
```

3. Run `npm run typecheck` — expect zero errors.

#### Task 1C.6: verify + commit Lane 1C

**Files:** none (verification + commit)

1. Run the full suite + gates:

```
npm run typecheck
npx vite build
npx vitest run tests/integration/recommendations-public-allowlist.test.ts tests/integration/recommendations-public-emv-leak.test.ts
npx tsx scripts/pr-check.ts
```

Expected: all green. `vite build` confirms the frontend bundle is unaffected by the server-side reader changes.

2. Commit:

```
git add server/routes/recommendations.ts server/intelligence/operational-slice.ts server/intelligence/seo-context-slice.ts server/intelligence/page-profile-slice.ts tests/integration/recommendations-public-allowlist.test.ts
git commit -m "Strategy v3 Phase 1 Lane 1C — reader retrofits to isActiveRec + public allow-list projection"
```

---

### Lane 1D — contract doc + exit-gate test consolidation (sonnet) [after 1B/1C]

**Blocked by:** Lane 1B (single-writer + `isActiveRec` + carry-over assertions) and Lane 1C (allow-list assertions). The doc scaffold can start in parallel with 1B/1C; the per-reader decision table and the final test pass finalize only after 1B/1C land. The three exit-gate tests (`recommendation-lifecycle.test.ts`, `recommendation-regen-preserves-lifecycle.test.ts`, `recommendations-public-allowlist.test.ts`) were authored RED-first inside 1B/1C per TDD; this lane's job is the **contract doc** + a **strike-never-completed regen integration assertion** that 1B/1C did not cover, plus the final full-suite verification.

#### Task 1D.1: write the contract doc `docs/rules/strategy-recommendations.md`

**Files:** `docs/rules/strategy-recommendations.md` (create)

1. Create `docs/rules/strategy-recommendations.md`:

```md
# Strategy v3 — Recommendation Lifecycle Contracts

> Feature-specific contract reference for the Strategy v3 curation cockpit. Read this before
> touching any recommendation lifecycle code. Companion to the locked Phase-1 contracts in
> `docs/superpowers/plans/parts/00-contracts.md` and the design spec
> `docs/superpowers/specs/2026-06-18-strategy-v3-curation-cockpit-design.md`.

## The two axes (NEVER conflate them)

A recommendation carries TWO independent status axes:

| Axis | Field | Values | Who writes it |
|---|---|---|---|
| Internal admin triage | `status` (`RecStatus`) | `pending` · `in_progress` · `completed` · `dismissed` | regen + `updateRecommendationStatus` |
| Client-facing curation | `clientStatus` | `system` · `curated` · `sent` · `approved` · `declined` · `discussing` | the single-writer ONLY |
| Suppression | `lifecycle` | `active` · `throttled` · `struck` | the single-writer ONLY |

**The trust-critical invariant:** `strike` / `throttle` / `send` are transitions on `clientStatus` /
`lifecycle` — they NEVER write `RecStatus`. A struck rec must never be swept to `completed`, or it
would read to the client as "✓ done" when we actually decided not to do it.

## The single writer

ALL `clientStatus` / `lifecycle` mutations go through `server/recommendation-lifecycle.ts`
(`sendRecommendation`, `strikeRecommendation`, `throttleRecommendation`, `unsuppressRecommendation`).
Each wraps a `db.transaction()` that re-reads the set inside the txn, applies the single-field delta,
recomputes the summary, and upserts. Never mutate the lifecycle axis from a route handler directly.

## `isActiveRec` — the ONE active-set predicate

`isActiveRec(rec)` (exported from `server/recommendations.ts`) is the single predicate every reader
uses to decide whether a rec is eligible to surface (Act queue, summary top-rec, AI context,
briefings). A rec is active iff: `RecStatus` not terminal AND not struck AND not throttled-into-the-
future (auto-resurfaces on-read) AND `clientStatus` not in {sent, approved, declined}.

### Per-reader retrofit decisions (Phase 1 Lane 1C)

| Reader | File:line (at retrofit) | Decision |
|---|---|---|
| `computeRecommendationSummary` | `server/recommendations.ts:600` | route through `isActiveRec` (Lane 1B) |
| operational-slice rec counter | `server/intelligence/operational-slice.ts:217` | route through `isActiveRec` |
| seo-context-slice `topRec` | `server/intelligence/seo-context-slice.ts:484` | route through `isActiveRec` (was leaking throttled/sent into AI) |
| page-profile-slice | `server/intelligence/page-profile-slice.ts:70` | route through `isActiveRec` |
| public projection | `server/routes/recommendations.ts` (`projectPublicRec`) | allow-list; admin axis never serialized |
| Act queue | `server/routes/recommendations.ts` (P2 cockpit) | reads via `isActiveRec` + lifecycle filters (Phase 2) |
| `admin-chat-context` / `briefing-candidates` | (read summary indirectly) | EXEMPT — consume `computeRecommendationSummary` output, already filtered |
| outcome-backfill | `server/recommendations.ts:204` area | EXEMPT — operates on completed recs only (correct as-is) |

## Carry-over through regen

`applyLifecycleCarryOver(newRecs, oldRecs)` (exported from `server/recommendations.ts`) re-applies the
client-facing lifecycle axis onto freshly-minted recs during regen, keyed by `buildMergeKey`, for
EVERY matched old rec regardless of `RecStatus`. Without it a sent rec resets to `system` on the next
regen. Exit-gate test: `tests/integration/recommendation-regen-preserves-lifecycle.test.ts`.

## Auto-resolve exemption

`isExemptFromAutoResolve(rec)` exempts recs with `clientStatus` in {sent, discussing, approved} from
the destructive auto-resolve → `completed` sweep. `declined` is NOT exempt. Exit-gate test:
`tests/integration/recommendation-lifecycle.test.ts` (strike-never-completed block).

## Public read = allow-list

`projectPublicRec` in `server/routes/recommendations.ts` is an explicit allow-list of client-safe
fields. The admin lifecycle axis (`clientStatus`, `lifecycle`, `throttledUntil`, `sentAt`, `struckAt`,
`cascade`, `sendChannel`) is NEVER serialized to the client. The curated read (Phase 4) reads
`clientStatus` server-side to FILTER, but the wire payload stays admin-key-free. Exit-gate tests:
`tests/integration/recommendations-public-allowlist.test.ts` (flag-OFF byte-identical + flag-ON
no-leak on the REAL public GET).

## Per-RecType policy registry

`REC_POLICY_REGISTRY` (in `server/recommendation-lifecycle.ts`) maps each `RecType` to its
`sendChannel` (`rec` mutates `clientStatus` directly; `deliverable` routes content_decay/
cannibalization to the deliverable spine), `cascadeOnStrike` (keyword/topic strikes remove strategy
items), and `monetizable` (a priced Add-to-plan CTA is allowed only where `productType` resolves).
An unlisted RecType cannot be curated until a policy is registered.
```

2. No verification command for a doc; the typecheck/build/pr-check at 1D's final task covers it.

#### Task 1D.2: write the failing strike-never-completed regen integration assertion

**Files:** `tests/integration/recommendation-lifecycle.test.ts` (modify — append a regen-exemption block)

1. The unit test in 1B.6 covers `isExemptFromAutoResolve` in isolation. Add a real-regen integration assertion that a SENT rec whose source disappears is NOT swept to `completed` by `generateRecommendations`. Append to `tests/integration/recommendation-lifecycle.test.ts` (it already imports `createWorkspace`/`deleteWorkspace`/`saveRecommendations`/`loadRecommendations` and seeds a workspace). Add `generateRecommendations` to the import from `../../server/recommendations.js`:

```ts
import { saveRecommendations, loadRecommendations, generateRecommendations } from '../../server/recommendations.js';
```

(replace the existing two-name import) and append this describe block:

```ts
describe('strike-never-completed — auto-resolve exemption survives a real regen', () => {
  it('a sent rec whose source vanishes is NOT auto-swept to completed', async () => {
    // Seed a sent rec with a synthetic source that the real regen will not re-mint.
    seed([rec({ id: 'sent_survivor', clientStatus: 'sent', sentAt: new Date().toISOString(), source: 'audit:nonexistent-synthetic-check', status: 'pending' })]);

    // Run a full regen: the synthetic source is absent from the new run, so pre-v3 it would
    // auto-resolve to 'completed'. The exemption must keep it pending + sent.
    await generateRecommendations(wsId);

    const after = loadRecommendations(wsId)!.recommendations.find(r => r.id === 'sent_survivor');
    // It MUST still exist and MUST NOT be completed (the trust-critical graft).
    expect(after).toBeDefined();
    expect(after!.status).not.toBe('completed');
    expect(after!.clientStatus).toBe('sent'); // carry-over preserved it through regen too
  });

  it('summary.topRecommendationId is never a struck/throttled/sent rec', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    seed([
      rec({ id: 'struck_rec', impactScore: 99, lifecycle: 'struck', struckAt: new Date().toISOString() }),
      rec({ id: 'throttled_rec', impactScore: 98, lifecycle: 'throttled', throttledUntil: future }),
      rec({ id: 'sent_rec', impactScore: 97, clientStatus: 'sent', sentAt: new Date().toISOString() }),
      rec({ id: 'active_rec', impactScore: 10 }),
    ]);
    const summary = loadRecommendations(wsId)!.summary;
    expect(['struck_rec', 'throttled_rec', 'sent_rec']).not.toContain(summary.topRecommendationId);
    expect(summary.topRecommendationId).toBe('active_rec');
  });
});
```

> The second test relies on `saveRecommendations` recomputing the summary. If `seed()` writes the summary as-is (it does — it sets `topRecommendationId: recs[0]?.id`), call `computeRecommendationSummary` inside `seed()` instead so the active-set predicate is exercised. Update `seed()` to set `summary: { ...baseCounts, ...computeRecommendationSummary(recs) }` — import `computeRecommendationSummary` from `../../server/recommendations.js` in the same import line.

2. Update `seed()` to recompute the summary via the predicate (so the top-rec test is meaningful). Replace the `seed` function's `summary:` literal:

```ts
    summary: { fixNow: recs.length, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0, topRecommendationId: recs[0]?.id ?? null },
```

with:

```ts
    summary: computeRecommendationSummary(recs),
```

and add `computeRecommendationSummary` to the import line:

```ts
import { saveRecommendations, loadRecommendations, generateRecommendations, computeRecommendationSummary } from '../../server/recommendations.js';
```

3. Run `npx vitest run tests/integration/recommendation-lifecycle.test.ts` — expect **pass** (the exemption + carry-over from Lane 1B make the regen survive; the top-rec test passes because `computeRecommendationSummary` now routes through `isActiveRec`).

#### Task 1D.3: full Phase-1 verification + commit

**Files:** none (verification + commit)

1. Run the complete Phase-1 exit gate:

```
npm run typecheck
npx vite build
npx vitest run tests/unit/recommendation-lifecycle.test.ts tests/integration/recommendation-lifecycle.test.ts tests/integration/recommendation-regen-preserves-lifecycle.test.ts tests/integration/recommendations-public-allowlist.test.ts tests/integration/recommendations-public-emv-leak.test.ts
npm run verify:feature-flags
npx tsx scripts/pr-check.ts
```

Expected: all green.

2. Run the FULL suite to confirm no regression in adjacent code (CLAUDE.md "run full test suite before declaring done"):

```
npx vitest run
```

Expected: all green (no pre-existing tests broken by the reader retrofits or the summary predicate change).

3. Commit:

```
git add docs/rules/strategy-recommendations.md tests/integration/recommendation-lifecycle.test.ts
git commit -m "Strategy v3 Phase 1 Lane 1D — contract doc + strike-never-completed regen gate"
```

---

## Phase exit gates

Phase 1 is not done — and **no Stage-2 dispatch may begin** — until ALL of the following pass on the merged Phase-1 branch:

- [ ] `npm run typecheck` — zero errors (`tsc -b`, both app + node configs). Load-bearing: `CATEGORY_MAP` + `CLIENT_NOTIFICATION_RECIPIENT_POLICIES` are type-enforced Records (a miss is a compile error, not a silent pass).
- [ ] `npx vite build` — builds successfully.
- [ ] `npx vitest run` — the FULL suite passes (not just the new tests).
- [ ] `npm run verify:feature-flags` — the two child flags (`strategy-staleness-scan`, `strategy-paid-topics`) are grouped + cataloged consistently.
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (Zod-lockstep, no bare `JSON.parse`, `db.transaction()` wrapper on the single-writer, no AI-call-before-write).
- [ ] **Contract test — `tests/integration/recommendations-public-allowlist.test.ts`:** flag-OFF byte-identical + flag-ON no-admin-key-leak on the REAL public GET (`/api/public/recommendations/:workspaceId`), NOT the admin GET.
- [ ] **Contract test — `tests/integration/recommendation-regen-preserves-lifecycle.test.ts`:** send a rec (`clientStatus='sent'`), regen, assert `clientStatus` still `'sent'`.
- [ ] **Contract test — `tests/integration/recommendation-lifecycle.test.ts`:** strike-never-completed (a sent rec whose source vanishes survives regen, not swept to `completed`) AND `summary.topRecommendationId` is never a struck/throttled/sent rec.
- [ ] **Unit test — `tests/unit/recommendation-lifecycle.test.ts`:** `isActiveRec` + `isExemptFromAutoResolve` truth tables green.
- [ ] **Contract doc — `docs/rules/strategy-recommendations.md`** committed (two-axis invariant, single-writer, `isActiveRec`, per-reader decision table, allow-list, policy registry).
- [ ] All 13 boxes of the 00-contracts §13 contract-landing checklist are checked (verify the §13 list is fully satisfied by Lane 1A).
- [ ] `FEATURE_AUDIT.md` + `data/roadmap.json` updated for the Phase-1 lifecycle-foundation entry (controller commits these per-PR alongside the lane commits).


---

## Phase 2 — admin cockpit curation (Stage 2 Track B, after P1 merge)

**Goal:** turn the Strategy → Overview hero into a working **curation cockpit** — the operator sees every active rec via `isActiveRec()`, triages it with the four lifecycle actions (Send · Fix · Throttle · Strike), and a `Send` delivers a curated rec to the client (firing the `curated_recs_sent` doorbell email). This phase ships the **server lifecycle routes + `rec_discussion` substrate (migration 138) + the cockpit UI + the wiring** that mounts it as the Overview hero.

**What merges before Phase 2 (hard prerequisites):**
- **Phase 0** — the v2 cutover. The `strategy-command-center` flag is KEPT; its flag-OFF branch is now the validated command-center baseline (the `legacyAnalysis` branch + `commandCenterEnabled` ternary inside `KeywordStrategy.tsx`, `client/StrategyTab.tsx`, `ClientDashboard.tsx` are deleted → **one** layout). The host-swap in Lane C edits that single post-Phase-0 layout, never a flag ternary.
- **Phase 1 Lane 1A–1D** — every contract in `docs/superpowers/plans/parts/00-contracts.md` is committed and green: the two-axis lifecycle fields on `Recommendation` (§1) + Zod lockstep, `isActiveRec()` exported from `server/recommendations.ts` (§2), `RECOMMENDATION_TRANSITIONS` operator axis + `CLIENT_REC_TRANSITIONS` (§3), the four `rec_*` ActivityTypes + `CLIENT_VISIBLE_TYPES` classification (§4), the `RECOMMENDATIONS_DISCUSSION_UPDATED` WS quartet (§5), `RecDiscussionEntry` (§6b), `ClientSignalsSlice.recResponses` (§7), the `admin.recDiscussion` + `client.curatedRecommendations` query keys (§8), the `curated_recs_sent` `EmailEventType` + `CATEGORY_MAP` + recipient policy (§9), the two child flags (§10), and the single-writer module `server/recommendation-lifecycle.ts` (P1 Lane 1B).

> ### Phase-1 dependency contract Lane A calls (READ-ONLY for Phase 2 — pinned here so Lane A never re-derives it)
> The single-writer `server/recommendation-lifecycle.ts` is OWNED and shipped by **Phase 1 Lane 1B**. Its public API is *consumed* by Phase 2 Lane A but is not re-spelled in `00-contracts.md`. Lane A calls **exactly** these exported functions; each performs the transactional re-read-inside-txn → single-field-delta → recompute-summary → upsert through the existing per-workspace single-flight (`runRecommendationRegen`), returns the mutated `Recommendation`, and applies the relevant state-machine guard internally:
> ```ts
> // server/recommendation-lifecycle.ts — Phase 1 Lane 1B exports (frozen API surface for Phase 2)
> /** clientStatus: curated → sent. Sets sentAt. Routes by policy.sendChannel. Throws InvalidTransitionError on illegal edge. */
> export function sendRecommendation(workspaceId: string, recId: string): Recommendation | null;
> /** lifecycle: active → struck. Sets struckAt + (for cascadeOnStrike RecTypes) cascade metadata. Idempotent re-strike returns the struck rec. */
> export function strikeRecommendation(workspaceId: string, recId: string): Recommendation | null;
> /** lifecycle: struck → active (Undo). Restores any cascade-removed strategy items when cascade.reversible. */
> export function unstrikeRecommendation(workspaceId: string, recId: string): Recommendation | null;
> /** lifecycle: active → throttled. days ∈ {7,30,90}; sets throttledUntil = now + days. */
> export function throttleRecommendation(workspaceId: string, recId: string, days: 7 | 30 | 90): Recommendation | null;
> /** Marks the rec as agency-executed work via the existing RecStatus completion path (Fix). Returns the updated rec. */
> export function fixRecommendation(workspaceId: string, recId: string): Recommendation | null;
> ```
> A `null` return means "rec id not found in the set." If any signature above is found to differ when Lane A is implemented, that is a **Phase-1 amendment** to Lane 1B (and a note back to the assembler), **never** a Lane A edit to `recommendation-lifecycle.ts`. Lane A only *imports* from it.

**Flag-gated exit gate.** The cockpit mounts behind `useFeatureFlag('strategy-command-center')` (the v3 umbrella ON branch). Phase exit is green on `npm run typecheck`, `npx vite build`, the Phase-2 vitest suites, `npx tsx scripts/pr-check.ts`, plus the two new contract/integration tests (admin lifecycle routes + cockpit row model). See **Phase exit gates** at the bottom.

**Merge order inside the phase:** Lane A and Lane B run in parallel (file-disjoint). Lane C is blocked by both (it imports Lane A's route shapes + event broadcasts and mounts Lane B's `StrategyCockpit`). The controller commits per-lane; no parallel git writes.

---

### Lane A (opus) — admin lifecycle routes + `rec_discussion` substrate + `curated_recs_sent` email

**Exclusive files (create):** `server/rec-discussion.ts`, `server/db/migrations/138-rec-discussion.sql`, `tests/integration/recommendation-lifecycle-admin-routes.test.ts`
**Exclusive files (modify):** `server/routes/recommendations.ts` (append admin routes), `server/email-templates.ts` (add `curated_recs_sent` render case + payload rule), `server/email.ts` (add `notifyClientCuratedRecsSent`)
**Blocked by:** Phase 1 merge (single-writer + `isActiveRec` + lifecycle types + `RECOMMENDATION_TRANSITIONS` + the four `rec_*` ActivityTypes + the `curated_recs_sent` email contract + the `RECOMMENDATIONS_DISCUSSION_UPDATED` event constant). Not blocked by Lane B/C.

> **Note on already-committed contracts:** `server/state-machines.ts`, `server/activity-log.ts`, `server/ws-events.ts`, `server/email-throttle.ts`, and `server/notification-recipients.ts` are **NOT in Lane A's ownership** — Phase 1 Lane 1A already committed every enum/event/map entry Lane A needs. Lane A *imports* `WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED`, the `'rec_sent'|'rec_struck'|'rec_throttled'` ActivityTypes, `CLIENT_REC_TRANSITIONS`, and the `curated_recs_sent` EmailEventType — it never edits those files.

#### Task A.1: Migration 138 — `rec_discussion` table (the locked DDL)

**Files:** `server/db/migrations/138-rec-discussion.sql` (create)

1. Create the file with the exact DDL from `00-contracts.md` §6a:

```sql
-- 138-rec-discussion.sql
-- Strategy v3 (spec §6.7) — the Discuss substrate. Recs are NOT deliverables, so a
-- discussion is NOT a client_action thread (forbidden by D2) and NOT the single client_note
-- column. This is a minimal append-only thread keyed to a rec id within a workspace.
-- recId is the in-blob Recommendation.id (recommendation_sets is a JSON blob — no FK target),
-- so NO foreign key; workspace_id scopes every read/write/delete.
-- DB column + mapper lockstep: ships with RecDiscussionRow + rowToRecDiscussion + the writer
-- in server/rec-discussion.ts (Phase 2 Lane A). Not on a public-portal serialization list
-- directly — the client reads discussion via the authenticated curated read.
CREATE TABLE IF NOT EXISTS rec_discussion (
  id           TEXT NOT NULL PRIMARY KEY,
  rec_id       TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author       TEXT NOT NULL,            -- 'client' | 'strategist' (display role, not a user id)
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_discussion_ws_rec ON rec_discussion(workspace_id, rec_id, created_at);
```

2. Run the migration and confirm it applies cleanly:

```
npm run db:migrate
```

Expected: log line `applied migration 138-rec-discussion.sql` (or "no pending migrations" if already applied). No error.

3. Commit:

```
git add server/db/migrations/138-rec-discussion.sql
git commit -m "Strategy v3 P2 — migration 138: rec_discussion table"
```

#### Task A.2: `rec-discussion.ts` — failing test for the writer + reader

**Files:** `tests/integration/recommendation-lifecycle-admin-routes.test.ts` (create — this file will hold ALL Lane A integration assertions; we seed it here with the discussion-module unit checks, then grow it across Lane A)

1. Create the test file with a first failing block exercising `addRecDiscussionEntry` + `listRecDiscussion` directly (module-level, no HTTP yet):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';
import { addRecDiscussionEntry, listRecDiscussion } from '../../server/rec-discussion.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let workspaceId = '';
let cleanupWorkspace: (() => void) | undefined;

beforeAll(async () => {
  await ctx.startServer();
  const seeded = seedWorkspace({ clientPassword: '' });
  workspaceId = seeded.workspaceId;
  cleanupWorkspace = seeded.cleanup;
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
  db.prepare('DELETE FROM rec_discussion WHERE workspace_id = ?').run(workspaceId);
  cleanupWorkspace?.();
});

describe('rec-discussion module', () => {
  it('appends and reads back an entry in created-at order', () => {
    const a = addRecDiscussionEntry(workspaceId, 'rec_x', 'strategist', 'First reply');
    const b = addRecDiscussionEntry(workspaceId, 'rec_x', 'client', 'A question');
    const thread = listRecDiscussion(workspaceId, 'rec_x');
    expect(thread.map(e => e.id)).toEqual([a.id, b.id]);
    expect(thread[0]).toMatchObject({ recId: 'rec_x', author: 'strategist', body: 'First reply', workspaceId });
    expect(thread[1].author).toBe('client');
  });

  it('scopes reads to the workspace + rec id', () => {
    addRecDiscussionEntry(workspaceId, 'rec_other', 'client', 'unrelated');
    expect(listRecDiscussion(workspaceId, 'rec_x')).toHaveLength(2);
    expect(listRecDiscussion(workspaceId, 'rec_other')).toHaveLength(1);
  });
});
```

2. Run it and watch it fail (module does not exist yet):

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts
```

Expected: failure — `Failed to resolve import "../../server/rec-discussion.js"` (or "addRecDiscussionEntry is not a function").

#### Task A.3: `rec-discussion.ts` — minimal implementation

**Files:** `server/rec-discussion.ts` (create)

1. Create the module mirroring the `server/annotations.ts` `createStmtCache`/`rowToX` pattern. It reads the `RecDiscussionEntry` shape from the §6b contract:

```ts
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type { RecDiscussionEntry } from '../shared/types/recommendations.js';

// ── SQLite row shape (migration 138) ──
interface RecDiscussionRow {
  id: string;
  rec_id: string;
  workspace_id: string;
  author: string;
  body: string;
  created_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO rec_discussion (id, rec_id, workspace_id, author, body, created_at)
         VALUES (@id, @rec_id, @workspace_id, @author, @body, @created_at)`,
  ),
  selectByRec: db.prepare(
    `SELECT * FROM rec_discussion WHERE workspace_id = ? AND rec_id = ? ORDER BY created_at ASC, id ASC`,
  ),
}));

function rowToRecDiscussion(row: RecDiscussionRow): RecDiscussionEntry {
  return {
    id: row.id,
    recId: row.rec_id,
    workspaceId: row.workspace_id,
    author: row.author as RecDiscussionEntry['author'],
    body: row.body,
    createdAt: row.created_at,
  };
}

export function listRecDiscussion(workspaceId: string, recId: string): RecDiscussionEntry[] {
  const rows = stmts().selectByRec.all(workspaceId, recId) as RecDiscussionRow[];
  return rows.map(rowToRecDiscussion);
}

export function addRecDiscussionEntry(
  workspaceId: string,
  recId: string,
  author: RecDiscussionEntry['author'],
  body: string,
): RecDiscussionEntry {
  const entry: RecDiscussionEntry = {
    id: `recd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    recId,
    workspaceId,
    author,
    body,
    createdAt: new Date().toISOString(),
  };
  stmts().insert.run({
    id: entry.id,
    rec_id: entry.recId,
    workspace_id: entry.workspaceId,
    author: entry.author,
    body: entry.body,
    created_at: entry.createdAt,
  });
  return entry;
}
```

2. Run the test, watch it pass:

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts
```

Expected: `2 passed`.

3. Commit:

```
git add server/rec-discussion.ts tests/integration/recommendation-lifecycle-admin-routes.test.ts
git commit -m "Strategy v3 P2 — rec_discussion append-only thread module"
```

#### Task A.4: `curated_recs_sent` email — failing render test

**Files:** `tests/integration/recommendation-lifecycle-admin-routes.test.ts` (append a `describe` block)

1. Append a render-contract block that imports `renderDigest` + a hand-built `EmailEvent` and asserts the curated-sends template produces a subject + body:

```ts
import { renderDigest } from '../../server/email-templates.js';
import type { EmailEvent } from '../../server/email-templates.js';

describe('curated_recs_sent email template', () => {
  it('renders a "N recommendations ready" subject + decision CTA', () => {
    const event: EmailEvent = {
      type: 'curated_recs_sent',
      recipient: 'client@example.com',
      workspaceId,
      workspaceName: 'Acme SEO',
      dashboardUrl: 'https://app.example.com/client/ws1',
      data: { recCount: 3 },
      createdAt: new Date().toISOString(),
    };
    const { subject, html } = renderDigest('curated_recs_sent', [event]);
    expect(subject).toContain('3');
    expect(subject.toLowerCase()).toContain('decision');
    expect(html).toContain('Acme SEO');
    expect(html).toContain('https://app.example.com/client/ws1');
  });
});
```

2. Run, watch it fail (the `switch` in `renderDigest` falls through to the `'Notification'` default → no `'decision'` in subject):

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts -t "curated_recs_sent email template"
```

Expected: failure on `expect(subject.toLowerCase()).toContain('decision')`.

#### Task A.5: `curated_recs_sent` email — payload rule + renderer

**Files:** `server/email-templates.ts` (add payload rule + `switch` case + renderer fn)

1. Add the payload rule. In `CLIENT_EMAIL_PAYLOAD_RULES` (after the `work_order_comment_client` entry), insert:

```ts
  work_order_comment_client: { requiredStrings: ['orderTitle', 'message'] },
  curated_recs_sent: { requiredNumbers: ['recCount'] },
```

2. Add the `switch` case in `renderDigest` (after the `work_order_comment_client` case, before `default`):

```ts
    case 'work_order_comment_client':
      result = renderWorkOrderCommentClient(events, count, ws, dashUrl, logoUrl); break;
    case 'curated_recs_sent':
      result = renderCuratedRecsSent(events, count, ws, dashUrl, logoUrl); break;
    default:
```

3. Add the renderer (immediately after `renderRecommendationsReady`, mirroring its `layout()` use but with decision-framed copy):

```ts
function renderCuratedRecsSent(_events: EmailEvent[], _count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  // Sum recCount across batched events from one curation session (spec §7.1).
  const recCount = _events.reduce((s, e) => s + ((e.data.recCount as number) || 0), 0);
  const plural = recCount !== 1;
  return {
    subject: `${recCount} recommendation${plural ? 's' : ''} ready for your decision — ${ws}`,
    html: layout({
      preheader: `${recCount} recommendation${plural ? 's' : ''} need${plural ? '' : 's'} your decision`,
      headline: 'Ready for your decision',
      subtitle: ws,
      body: `<div style="padding:16px 24px;font-size:14px;color:#a1a1aa;">Your strategist curated ${recCount} recommendation${plural ? 's' : ''} for you. Review the why, the projected result, and approve or ask a question — right from your dashboard.</div>`,
      cta: dashUrl ? { label: 'Review recommendations', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}
```

4. Run the render test, watch it pass:

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts -t "curated_recs_sent email template"
```

Expected: `1 passed`.

#### Task A.6: `notifyClientCuratedRecsSent` — the fire wrapper

**Files:** `server/email.ts` (add the notify fn — Lane A's only edit here)

1. Add the wrapper (after `notifyClientRecommendationsReady`), mirroring it but using the curated type:

```ts
export function notifyClientCuratedRecsSent(opts: {
  clientEmail: string;
  workspaceName: string;
  workspaceId: string;
  recCount: number;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) return;
  queueEmail(makeEvent('curated_recs_sent', opts.clientEmail, opts.workspaceId, opts.workspaceName, opts.dashboardUrl, {
    recCount: opts.recCount,
  }));
}
```

2. Typecheck (the `EmailEventType` union, `CATEGORY_MAP`, and recipient policy were all committed in Phase 1, so this compiles):

```
npm run typecheck
```

Expected: zero errors.

3. Commit:

```
git add server/email-templates.ts server/email.ts tests/integration/recommendation-lifecycle-admin-routes.test.ts
git commit -m "Strategy v3 P2 — curated_recs_sent email template + notify wrapper"
```

#### Task A.7: `POST .../send` route — failing HTTP test

**Files:** `tests/integration/recommendation-lifecycle-admin-routes.test.ts` (append a `describe` block + a helper that seeds a curated rec)

1. Append a helper that writes one rec at `clientStatus:'curated'` into the set, plus the failing send-route block. Add these imports at the **top** of the file (grouped with the existing imports):

```ts
import { saveRecommendations, computeRecommendationSummary } from '../../server/recommendations.js';
import type { Recommendation, RecommendationSet } from '../../shared/types/recommendations.js';
```

Then append:

```ts
function seedCuratedRec(wsId: string, recId: string, overrides: Partial<Recommendation> = {}): void {
  const rec = {
    id: recId,
    type: 'metadata',
    priority: 'high',
    title: `Rec ${recId}`,
    description: 'desc',
    impactScore: 50,
    effort: 'low',
    affectedPages: [],
    status: 'pending',
    clientStatus: 'curated',
    lifecycle: 'active',
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Recommendation;
  const set: RecommendationSet = {
    workspaceId: wsId,
    generatedAt: new Date().toISOString(),
    recommendations: [rec],
    summary: computeRecommendationSummary([rec]),
  };
  saveRecommendations(set);
}

describe('POST /api/recommendations/:ws/:recId/send', () => {
  it('transitions a curated rec to clientStatus=sent and stamps sentAt', async () => {
    seedCuratedRec(workspaceId, 'rec_send_1');
    const res = await api.patch(`/api/recommendations/${workspaceId}/rec_send_1/send`, {});
    expect(res.status).toBe(200);
    expect(res.body.clientStatus).toBe('sent');
    expect(typeof res.body.sentAt).toBe('string');
  });

  it('404s an unknown rec', async () => {
    const res = await api.patch(`/api/recommendations/${workspaceId}/nope/send`, {});
    expect(res.status).toBe(404);
  });
});
```

2. Run, watch it fail (route does not exist → 404 on the first case too):

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts -t "send"
```

Expected: failure — first case gets 404 instead of 200.

#### Task A.8: `POST .../send` route — implementation

**Files:** `server/routes/recommendations.ts` (add imports + append the admin send route after `/undismiss`)

1. Extend the import from the single-writer + email + workspace getter. At the top of the file, add a new import block (grouped with existing top-of-file imports):

```ts
import {
  sendRecommendation,
  strikeRecommendation,
  unstrikeRecommendation,
  throttleRecommendation,
  fixRecommendation,
} from '../recommendation-lifecycle.js';
import { addRecDiscussionEntry, listRecDiscussion } from '../rec-discussion.js';
import { notifyClientCuratedRecsSent } from '../email.js';
import { adminBaseUrl } from '../helpers.js';
```

> If `adminBaseUrl` does not exist in `helpers.js`, build the dashboard URL inline from `process.env.APP_URL` instead (the email renderer degrades gracefully to no-CTA when `dashboardUrl` is undefined). Confirm with `grep -n "export function adminBaseUrl\|export const adminBaseUrl" server/helpers.ts` before importing; drop the import + the `dashboardUrl` arg if absent.

2. Append the send route after the `/undismiss` route (before `export default router;`):

```ts
// ─── Strategy v3 curation lifecycle (admin-only) ─────────────────────────────
// All four routes mutate the SEPARATE clientStatus/lifecycle axes via the
// single-writer (server/recommendation-lifecycle.ts) — NEVER RecStatus. They
// are admin-only (no /api/public/ prefix → global APP_PASSWORD HMAC gate).

// Send a curated rec to the client (clientStatus: curated → sent). Fires the
// curated_recs_sent doorbell email (spec §7.1) — one note-on-send is recorded
// as a strategist discussion entry so it lands above the rec on the client overview.
router.patch('/api/recommendations/:workspaceId/:recId/send', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  let rec: Recommendation | null;
  try {
    rec = sendRecommendation(workspaceId, recId);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  // Optional note-on-send → a strategist discussion entry (the narrative lever).
  if (note) addRecDiscussionEntry(workspaceId, recId, 'strategist', note);
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, clientStatus: 'sent' });
  addActivity(workspaceId, 'rec_sent', `Recommendation sent to client: ${rec.title}`, note || rec.description);
  // Doorbell email — batched per curation session by the 'action' throttle bucket.
  const ws = getWorkspace(workspaceId);
  if (ws?.clientEmail) {
    notifyClientCuratedRecsSent({
      clientEmail: ws.clientEmail,
      workspaceName: ws.name,
      workspaceId,
      recCount: 1,
      dashboardUrl: typeof adminBaseUrl === 'function' ? undefined : undefined,
    });
  }
  res.json(rec);
});
```

> The `dashboardUrl` here resolves to the **client** hub deep-link; if a client-URL helper exists (`grep -n "clientBaseUrl\|clientPortalUrl" server/helpers.ts`), pass `${clientBaseUrl(workspaceId)}?rec=${recId}` per spec §7.1. If none exists, omit it — the email renderer renders without the CTA button (test A.4 covers the with-URL path via a hand-built event).

3. Run the send test, watch it pass:

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts -t "send"
```

Expected: `2 passed`.

4. Commit:

```
git add server/routes/recommendations.ts tests/integration/recommendation-lifecycle-admin-routes.test.ts
git commit -m "Strategy v3 P2 — admin send route (clientStatus→sent + doorbell email)"
```

#### Task A.9: `POST .../strike` + `.../unstrike` — failing test

**Files:** `tests/integration/recommendation-lifecycle-admin-routes.test.ts` (append)

1. Append the strike/unstrike block (server-side confirm is implicit — the arm-then-confirm UX is Lane B; the route is a single committed transition):

```ts
describe('strike + unstrike routes', () => {
  it('strike sets lifecycle=struck + struckAt; unstrike reverses it', async () => {
    seedCuratedRec(workspaceId, 'rec_strike_1', { clientStatus: 'system' });
    const struck = await api.patch(`/api/recommendations/${workspaceId}/rec_strike_1/strike`, {});
    expect(struck.status).toBe(200);
    expect(struck.body.lifecycle).toBe('struck');
    expect(typeof struck.body.struckAt).toBe('string');

    const restored = await api.patch(`/api/recommendations/${workspaceId}/rec_strike_1/unstrike`, {});
    expect(restored.status).toBe(200);
    expect(restored.body.lifecycle).toBe('active');
  });
});
```

2. Run, watch it fail (routes missing → 404):

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts -t "strike"
```

Expected: failure — first case 404.

#### Task A.10: `.../strike` + `.../unstrike` — implementation

**Files:** `server/routes/recommendations.ts` (append after the send route)

1. Append both routes:

```ts
// Strike a rec (lifecycle: active → struck). Permanent suppression — the rec
// won't be re-suggested. rec_struck is ADMIN-ONLY activity (must never read as
// "we decided not to do this" to the client). The arm-then-confirm UX is client-
// side (Lane B); the server commits a single struck transition + keeps Undo open.
router.patch('/api/recommendations/:workspaceId/:recId/strike', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  let rec: Recommendation | null;
  try {
    rec = strikeRecommendation(workspaceId, recId);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, lifecycle: 'struck' });
  addActivity(workspaceId, 'rec_struck', `Recommendation struck: ${rec.title}`, rec.description);
  res.json(rec);
});

// Undo a strike (lifecycle: struck → active). Restores cascade-removed strategy
// items when the cascade was reversible (the single-writer handles the restore).
router.patch('/api/recommendations/:workspaceId/:recId/unstrike', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  let rec: Recommendation | null;
  try {
    rec = unstrikeRecommendation(workspaceId, recId);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, lifecycle: 'active' });
  addActivity(workspaceId, 'rec_status_updated', `Recommendation strike undone: ${rec.title}`, 'Restored to active');
  res.json(rec);
});
```

2. Run, watch it pass:

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts -t "strike"
```

Expected: `1 passed` (the block has one `it`).

3. Commit:

```
git add server/routes/recommendations.ts tests/integration/recommendation-lifecycle-admin-routes.test.ts
git commit -m "Strategy v3 P2 — admin strike + unstrike routes (arm-then-confirm UX is client-side)"
```

#### Task A.11: `.../throttle` + `.../fix` — failing test

**Files:** `tests/integration/recommendation-lifecycle-admin-routes.test.ts` (append)

1. Append:

```ts
describe('throttle + fix routes', () => {
  it('throttle sets lifecycle=throttled + a future throttledUntil', async () => {
    seedCuratedRec(workspaceId, 'rec_throttle_1', { clientStatus: 'system' });
    const res = await api.patch(`/api/recommendations/${workspaceId}/rec_throttle_1/throttle`, { days: 30 });
    expect(res.status).toBe(200);
    expect(res.body.lifecycle).toBe('throttled');
    expect(Date.parse(res.body.throttledUntil)).toBeGreaterThan(Date.now());
  });

  it('throttle rejects a non-{7,30,90} duration', async () => {
    seedCuratedRec(workspaceId, 'rec_throttle_2', { clientStatus: 'system' });
    const res = await api.patch(`/api/recommendations/${workspaceId}/rec_throttle_2/throttle`, { days: 45 });
    expect(res.status).toBe(400);
  });

  it('fix marks the rec via the completion path', async () => {
    seedCuratedRec(workspaceId, 'rec_fix_1', { clientStatus: 'system' });
    const res = await api.patch(`/api/recommendations/${workspaceId}/rec_fix_1/fix`, {});
    expect(res.status).toBe(200);
  });
});
```

2. Run, watch it fail:

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts -t "throttle + fix"
```

Expected: failure — 404s.

#### Task A.12: `.../throttle` + `.../fix` — implementation

**Files:** `server/routes/recommendations.ts` (append)

1. Append both routes:

```ts
// Throttle a rec (lifecycle: active → throttled) for 7/30/90 days. Resurface is
// ON-READ (no cron) — isActiveRec re-includes it once throttledUntil passes.
router.patch('/api/recommendations/:workspaceId/:recId/throttle', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  const days = req.body?.days;
  if (days !== 7 && days !== 30 && days !== 90) {
    return res.status(400).json({ error: 'days must be one of 7, 30, 90' });
  }
  let rec: Recommendation | null;
  try {
    rec = throttleRecommendation(workspaceId, recId, days);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, lifecycle: 'throttled' });
  addActivity(workspaceId, 'rec_throttled', `Recommendation throttled ${days}d: ${rec.title}`, rec.description);
  res.json(rec);
});

// Fix — mark the rec as agency-executed work (routes to the existing completion
// spine via the single-writer). Distinct from Send; this is "we'll do it ourselves."
router.patch('/api/recommendations/:workspaceId/:recId/fix', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  let rec: Recommendation | null;
  try {
    rec = fixRecommendation(workspaceId, recId);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId, status: rec.status });
  addActivity(workspaceId, 'rec_status_updated', `Recommendation marked as agency work: ${rec.title}`, rec.description);
  res.json(rec);
});
```

2. Run, watch it pass:

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts -t "throttle + fix"
```

Expected: `3 passed`.

3. Commit:

```
git add server/routes/recommendations.ts tests/integration/recommendation-lifecycle-admin-routes.test.ts
git commit -m "Strategy v3 P2 — admin throttle (7/30/90) + fix routes"
```

#### Task A.13: admin discussion routes (`GET` + `POST`) — failing test

**Files:** `tests/integration/recommendation-lifecycle-admin-routes.test.ts` (append)

1. Append:

```ts
describe('admin rec discussion routes', () => {
  it('POSTs a strategist reply and GETs the thread', async () => {
    seedCuratedRec(workspaceId, 'rec_disc_1', { clientStatus: 'sent' });
    const post = await api.post(`/api/recommendations/${workspaceId}/rec_disc_1/discussion`, { body: 'Here is the plan' });
    expect(post.status).toBe(200);
    expect(post.body.author).toBe('strategist');

    const get = await api.get(`/api/recommendations/${workspaceId}/rec_disc_1/discussion`);
    expect(get.status).toBe(200);
    expect(get.body).toHaveLength(1);
    expect(get.body[0].body).toBe('Here is the plan');
  });

  it('rejects an empty body', async () => {
    const res = await api.post(`/api/recommendations/${workspaceId}/rec_disc_1/discussion`, { body: '   ' });
    expect(res.status).toBe(400);
  });
});
```

2. Run, watch it fail:

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts -t "discussion routes"
```

Expected: failure — 404 on POST.

#### Task A.14: admin discussion routes — implementation

**Files:** `server/routes/recommendations.ts` (append)

1. Append both routes (literal `/discussion` segment after the `:recId` param — Express matches it before any bare `:recId` catch-all; there is no bare `:recId` admin route here, so ordering is safe):

```ts
// Read a rec's discussion thread (admin cockpit Discuss filter).
router.get('/api/recommendations/:workspaceId/:recId/discussion', requireWorkspaceAccess('workspaceId'), (req, res) => { // activity-ok: read-only
  const { workspaceId, recId } = req.params;
  res.json(listRecDiscussion(workspaceId, recId));
});

// Append a strategist reply to a rec's discussion thread. Broadcasts the
// discussion-specific event so the cockpit Discuss filter + the client thread re-fetch.
router.post('/api/recommendations/:workspaceId/:recId/discussion', requireWorkspaceAccess('workspaceId'), (req, res) => {
  const { workspaceId, recId } = req.params;
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'body must be a non-empty string' });
  const entry = addRecDiscussionEntry(workspaceId, recId, 'strategist', body);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED, { recId });
  addActivity(workspaceId, 'rec_status_updated', `Strategist replied on: ${recId}`, body);
  res.json(entry);
});
```

2. Run, watch it pass:

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts -t "discussion routes"
```

Expected: `2 passed`.

3. Run the **full** Lane A suite + typecheck + pr-check:

```
npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts
npm run typecheck
npx tsx scripts/pr-check.ts
```

Expected: all green. pr-check passes — every admin route calls `addActivity` + `broadcastToWorkspace`, every blob mutation goes through the single-writer (no bare `updateRecommendationStatus` from a lifecycle path), and the strike/throttle paths never write `RecStatus`.

4. Commit:

```
git add server/routes/recommendations.ts tests/integration/recommendation-lifecycle-admin-routes.test.ts
git commit -m "Strategy v3 P2 — admin rec discussion read/append routes + DISCUSSION_UPDATED broadcast"
```

---

### Lane B (sonnet) — net-new cockpit UI (row model, row, send/throttle/strike, chip axes, sort, Fix-now pin)

**Exclusive files (create):** `src/components/strategy/cockpitRowModel.ts`, `src/components/strategy/StrategyCockpit.tsx`, `src/components/strategy/CockpitRow.tsx`, `src/components/strategy/CockpitSendPanel.tsx`, `src/components/strategy/CockpitThrottlePicker.tsx`, `src/components/strategy/CockpitStrikeConfirm.tsx`, `tests/unit/cockpit-row-model.test.ts`
**Blocked by:** Phase 1 merge (the lifecycle fields on the `Recommendation` type + `isActiveRec` semantics this UI mirrors client-side). Not blocked by Lane A — Lane B takes the lifecycle hooks as **props/callbacks** so it builds against the Lane-C hook signatures declared below, never importing Lane A's routes directly.

> **Do NOT edit** `src/components/admin/recommendations/RecommendationRow.tsx` — it has 3 consumers (ActQueue + 2 others) and is NOT a v3 cockpit row. The cockpit uses its own `CockpitRow`. **Do NOT edit** `src/components/strategy/index.ts` in Lane B — the barrel export is Lane C's (host-swap) responsibility to keep the merge order clean.

> **Hook contract Lane B builds against (provided by Lane C, declared here so Lane B is unblocked).** `StrategyCockpit` receives an `actions` prop of this exact shape; Lane C's `useRecommendationLifecycle` returns it. Each fn is fire-and-forget (the hook owns invalidation):
> ```ts
> export interface CockpitActions {
>   send: (recId: string, note?: string) => void;
>   strike: (recId: string) => void;
>   unstrike: (recId: string) => void;
>   throttle: (recId: string, days: 7 | 30 | 90) => void;
>   fix: (recId: string) => void;
>   isPending: boolean;
> }
> ```

#### Task B.1: `cockpitRowModel.ts` — failing unit test

**Files:** `tests/unit/cockpit-row-model.test.ts` (create)

1. Create the test. The model derives, per rec: the three fixed tag slots `[severity][value][lifecycle]`, a single-line why/how/result string, the left-edge accent rail color, and whether the rec belongs in the `Fix now` pin (top severity, capped). Plus a `partitionByLifecycle` for the segmented control counts:

```ts
import { describe, expect, it } from 'vitest';
import { toCockpitRow, partitionByLifecycle, FIX_NOW_CAP } from '../../src/components/strategy/cockpitRowModel';
import type { Recommendation } from '../../shared/types/recommendations';

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'r1', type: 'metadata', priority: 'high', title: 'Fix titles', description: 'why it matters',
    impactScore: 70, effort: 'low', affectedPages: [], status: 'pending',
    clientStatus: 'system', lifecycle: 'active', createdAt: new Date().toISOString(),
    ...overrides,
  } as Recommendation;
}

describe('cockpitRowModel', () => {
  it('emits three tag slots in fixed [severity, value, lifecycle] order', () => {
    const row = toCockpitRow(rec({ priority: 'high', lifecycle: 'active' }));
    expect(row.tags.map(t => t.slot)).toEqual(['severity', 'value', 'lifecycle']);
    expect(row.tags[2].label.toLowerCase()).toContain('active');
  });

  it('maps the accent rail by lifecycle/clientStatus (teal=active, emerald=sent, muted=struck)', () => {
    expect(toCockpitRow(rec({ lifecycle: 'active' })).railTone).toBe('teal');
    expect(toCockpitRow(rec({ clientStatus: 'sent' })).railTone).toBe('emerald');
    expect(toCockpitRow(rec({ lifecycle: 'struck' })).railTone).toBe('muted');
  });

  it('clamps the why/how/result string to a single line (no newlines)', () => {
    const row = toCockpitRow(rec({ description: 'line one\nline two' }));
    expect(row.whyLine).not.toContain('\n');
  });

  it('partitions active/sent/approved/throttled and caps the Fix-now pin', () => {
    const recs = [
      rec({ id: 'a', priority: 'high', lifecycle: 'active' }),
      rec({ id: 'b', clientStatus: 'sent', lifecycle: 'active' }),
      rec({ id: 'c', clientStatus: 'approved', lifecycle: 'active' }),
      rec({ id: 'd', lifecycle: 'throttled', throttledUntil: new Date(Date.now() + 1e9).toISOString() }),
    ];
    const p = partitionByLifecycle(recs);
    expect(p.active).toBe(1);
    expect(p.sent).toBe(1);
    expect(p.approved).toBe(1);
    expect(p.throttled).toBe(1);
    expect(FIX_NOW_CAP).toBe(5);
  });
});
```

2. Run, watch it fail (module missing):

```
npx vitest run tests/unit/cockpit-row-model.test.ts
```

Expected: failure — `Failed to resolve import ".../cockpitRowModel"`.

#### Task B.2: `cockpitRowModel.ts` — implementation

**Files:** `src/components/strategy/cockpitRowModel.ts` (create)

1. Create the pure model module (no React — testable in isolation):

```ts
import type { Recommendation } from '../../../shared/types/recommendations';

export const FIX_NOW_CAP = 5;

/** Lifecycle segmented-control buckets (single-select mode switch). */
export type LifecycleBucket = 'active' | 'sent' | 'approved' | 'throttled';

export type TagSlot = 'severity' | 'value' | 'lifecycle';
export type RailTone = 'teal' | 'emerald' | 'blue' | 'muted';

export interface CockpitTag {
  slot: TagSlot;
  label: string;
  /** Brand-law tone: teal=action, blue=data, emerald=success, amber=warn, red=error, muted=struck. */
  tone: 'teal' | 'blue' | 'emerald' | 'amber' | 'red' | 'muted';
}

export interface CockpitRowModel {
  rec: Recommendation;
  tags: [CockpitTag, CockpitTag, CockpitTag]; // always [severity, value, lifecycle]
  whyLine: string;
  railTone: RailTone;
  isFixNow: boolean;
}

function severityTag(rec: Recommendation): CockpitTag {
  const tone = rec.priority === 'high' ? 'red' : rec.priority === 'medium' ? 'amber' : 'blue';
  return { slot: 'severity', label: rec.priority, tone };
}

function valueTag(rec: Recommendation): CockpitTag {
  const v = rec.opportunity?.value ?? rec.impactScore;
  return { slot: 'value', label: `value ${Math.round(v)}`, tone: 'blue' };
}

function lifecycleTag(rec: Recommendation): CockpitTag {
  if (rec.lifecycle === 'struck') return { slot: 'lifecycle', label: 'struck', tone: 'muted' };
  if (rec.lifecycle === 'throttled') return { slot: 'lifecycle', label: 'throttled', tone: 'amber' };
  if (rec.clientStatus === 'approved') return { slot: 'lifecycle', label: 'approved', tone: 'emerald' };
  if (rec.clientStatus === 'sent') return { slot: 'lifecycle', label: 'sent', tone: 'emerald' };
  return { slot: 'lifecycle', label: 'active', tone: 'teal' };
}

function railToneFor(rec: Recommendation): RailTone {
  if (rec.lifecycle === 'struck') return 'muted';
  if (rec.clientStatus === 'sent' || rec.clientStatus === 'approved') return 'emerald';
  return 'teal';
}

/** Single-line clamp: collapse all whitespace runs (incl. newlines) to one space. */
function clampLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function toCockpitRow(rec: Recommendation): CockpitRowModel {
  return {
    rec,
    tags: [severityTag(rec), valueTag(rec), lifecycleTag(rec)],
    whyLine: clampLine(rec.description ?? ''),
    railTone: railToneFor(rec),
    isFixNow: rec.priority === 'high' && rec.lifecycle === 'active'
      && rec.clientStatus !== 'sent' && rec.clientStatus !== 'approved',
  };
}

/** Counts for the lifecycle segmented control. A rec lands in exactly one bucket. */
export function partitionByLifecycle(recs: Recommendation[]): Record<LifecycleBucket, number> {
  const out: Record<LifecycleBucket, number> = { active: 0, sent: 0, approved: 0, throttled: 0 };
  for (const r of recs) {
    if (r.lifecycle === 'throttled') out.throttled += 1;
    else if (r.clientStatus === 'approved') out.approved += 1;
    else if (r.clientStatus === 'sent') out.sent += 1;
    else out.active += 1;
  }
  return out;
}

export function bucketOf(rec: Recommendation): LifecycleBucket {
  if (rec.lifecycle === 'throttled') return 'throttled';
  if (rec.clientStatus === 'approved') return 'approved';
  if (rec.clientStatus === 'sent') return 'sent';
  return 'active';
}

export type CockpitSort = 'value' | 'impact' | 'age';

export function sortRecs(recs: Recommendation[], sort: CockpitSort): Recommendation[] {
  const copy = [...recs];
  if (sort === 'age') return copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (sort === 'impact') return copy.sort((a, b) => b.impactScore - a.impactScore);
  return copy.sort((a, b) => (b.opportunity?.value ?? b.impactScore) - (a.opportunity?.value ?? a.impactScore));
}
```

2. Run, watch it pass:

```
npx vitest run tests/unit/cockpit-row-model.test.ts
```

Expected: `4 passed`.

3. Commit:

```
git add src/components/strategy/cockpitRowModel.ts tests/unit/cockpit-row-model.test.ts
git commit -m "Strategy v3 P2 — cockpit row model (tags/rail/fix-now/partition/sort)"
```

#### Task B.3: `CockpitThrottlePicker.tsx` — the 7/30/90 picker

**Files:** `src/components/strategy/CockpitThrottlePicker.tsx` (create)

1. Create a small presentational popover. It is a controlled component: `onPick(days)` + `onCancel`. Teal-for-actions:

```tsx
import { Button } from '../ui';

interface CockpitThrottlePickerProps {
  onPick: (days: 7 | 30 | 90) => void;
  onCancel: () => void;
  disabled?: boolean;
}

const OPTIONS: ReadonlyArray<{ days: 7 | 30 | 90; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

/** Strategy v3 cockpit — Throttle 7/30/90-day picker (spec §4.3 confirmed micro-choice 2).
 *  Resurface is on-read (no cron); the row shows a visible auto-resurface clock afterward. */
export function CockpitThrottlePicker({ onPick, onCancel, disabled }: CockpitThrottlePickerProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--brand-border)] bg-[var(--surface-3)] px-3 py-2">
      <span className="t-caption-sm text-[var(--brand-text-muted)]">Hide for</span>
      {OPTIONS.map(({ days, label }) => (
        <Button key={days} size="sm" variant="secondary" disabled={disabled} onClick={() => onPick(days)}>
          {label}
        </Button>
      ))}
      <button
        type="button"
        className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-1"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
```

2. Typecheck:

```
npm run typecheck
```

Expected: zero errors. (If `Button` has no `variant="secondary"`/`size="sm"`, run `grep -n "variant\|size" src/components/ui/Button.tsx` and use the existing prop values — do not invent ones.)

#### Task B.4: `CockpitStrikeConfirm.tsx` — arm-then-confirm inline

**Files:** `src/components/strategy/CockpitStrikeConfirm.tsx` (create)

1. Create the inline arm-then-confirm strip (spec §4.3 confirmed micro-choice 3 — never a single-click commit; muted-zinc, never violet):

```tsx
import { Button } from '../ui';

interface CockpitStrikeConfirmProps {
  /** Cascade copy for keyword/topic strikes ("removes from strategy — reversible"). */
  cascadeNote?: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** Strategy v3 cockpit — Strike arm-then-confirm (spec §4.3). One click in the ⋯ overflow
 *  ARMS this strip; the operator must explicitly confirm. Brand-law M4: muted-zinc, never violet. */
export function CockpitStrikeConfirm({ cascadeNote, onConfirm, onCancel, disabled }: CockpitStrikeConfirmProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--brand-border)] bg-[var(--surface-3)] px-3 py-2">
      <span className="t-caption-sm text-[var(--brand-text-muted)]">
        Strike — won&apos;t be re-suggested{cascadeNote ? ` · ${cascadeNote}` : ''}
      </span>
      <Button size="sm" variant="danger" disabled={disabled} onClick={onConfirm}>Confirm</Button>
      <button
        type="button"
        className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-1"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}
```

2. Typecheck:

```
npm run typecheck
```

Expected: zero errors. (Confirm `variant="danger"` exists via `grep -n "danger\|destructive" src/components/ui/Button.tsx`; use the codebase's destructive variant name if different.)

#### Task B.5: `CockpitSendPanel.tsx` — note-on-send + Enter-to-send

**Files:** `src/components/strategy/CockpitSendPanel.tsx` (create)

1. Create the inline send panel (spec §4.3 confirmed micro-choice 1 — ↵ Enter sends immediately with whatever note is present; Esc cancels):

```tsx
import { useRef, useState } from 'react';
import { Button } from '../ui';

interface CockpitSendPanelProps {
  onSend: (note: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** Strategy v3 cockpit — note-on-send panel (spec §4.3 confirmed micro-choice 1).
 *  ↵ Enter sends immediately (zero-friction no-note path works — the note may be empty);
 *  Shift+Enter inserts a newline; Esc cancels. The note lands above the rec on the client overview. */
export function CockpitSendPanel({ onSend, onCancel, disabled }: CockpitSendPanelProps) {
  const [note, setNote] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="rounded-lg border border-[var(--brand-border)] bg-[var(--surface-3)] p-3 space-y-2">
      <textarea
        ref={ref}
        autoFocus
        rows={2}
        value={note}
        disabled={disabled}
        placeholder="Add a note for the client (optional) — Enter to send, Esc to cancel"
        className="w-full resize-none rounded-md border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 t-body text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:border-[var(--brand-border-hover)] focus:outline-none"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend(note.trim());
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-1"
          onClick={onCancel}
        >
          Cancel
        </button>
        <Button size="sm" disabled={disabled} onClick={() => onSend(note.trim())}>Send to client</Button>
      </div>
    </div>
  );
}
```

2. Typecheck + commit the three sub-panels:

```
npm run typecheck
git add src/components/strategy/CockpitThrottlePicker.tsx src/components/strategy/CockpitStrikeConfirm.tsx src/components/strategy/CockpitSendPanel.tsx
git commit -m "Strategy v3 P2 — cockpit send/throttle/strike inline panels"
```

Expected: zero typecheck errors.

#### Task B.6: `CockpitRow.tsx` — one row + the four actions

**Files:** `src/components/strategy/CockpitRow.tsx` (create)

1. Create the row. It renders the accent rail + three tag slots + clamped why-line + actions (`Send` primary, `Fix` secondary, `⋯` overflow → Throttle/Strike). It owns its inline-panel mode state (`'idle' | 'send' | 'throttle' | 'strike'`). A struck row keeps an `[Undo]`:

```tsx
import { useState } from 'react';
import { Button } from '../ui';
import { CockpitSendPanel } from './CockpitSendPanel';
import { CockpitThrottlePicker } from './CockpitThrottlePicker';
import { CockpitStrikeConfirm } from './CockpitStrikeConfirm';
import { toCockpitRow } from './cockpitRowModel';
import type { CockpitActions } from './StrategyCockpit';
import type { Recommendation } from '../../../shared/types/recommendations';

interface CockpitRowProps {
  rec: Recommendation;
  actions: CockpitActions;
}

type RowMode = 'idle' | 'send' | 'throttle' | 'strike';

const RAIL_CLASS: Record<string, string> = {
  teal: 'bg-accent-brand',
  emerald: 'bg-emerald-400',
  blue: 'bg-blue-400',
  muted: 'bg-[var(--brand-border-hover)]',
};

const TAG_TONE: Record<string, string> = {
  teal: 'text-accent-brand',
  blue: 'text-blue-400',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
  muted: 'text-[var(--brand-text-muted)]',
};

function resurfaceLabel(rec: Recommendation): string | null {
  if (rec.lifecycle !== 'throttled' || !rec.throttledUntil) return null;
  const days = Math.max(0, Math.ceil((Date.parse(rec.throttledUntil) - Date.now()) / 86_400_000));
  return `resurfaces in ${days}d`;
}

/** Strategy v3 cockpit row — fixed [severity][value][lifecycle] tag slots + single-line-clamped
 *  why-line + left-edge lifecycle accent rail + the four row actions. NOT the shared
 *  admin/recommendations/RecommendationRow (3 consumers) — this is the v3 curation row. */
export function CockpitRow({ rec, actions }: CockpitRowProps) {
  const [mode, setMode] = useState<RowMode>('idle');
  const model = toCockpitRow(rec);
  const isStruck = rec.lifecycle === 'struck';
  const cascadeNote = rec.cascade?.reversible ? 'removes from strategy — reversible' : undefined;
  const resurface = resurfaceLabel(rec);

  const close = () => setMode('idle');

  return (
    <div className={`relative flex flex-col gap-2 rounded-lg border border-[var(--brand-border)] bg-[var(--surface-2)] py-3 pl-4 pr-3 ${isStruck ? 'opacity-60' : ''}`}>
      <span className={`absolute left-0 top-0 h-full w-1 rounded-l-lg ${RAIL_CLASS[model.railTone]}`} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="t-ui font-semibold text-[var(--brand-text)] truncate">{rec.title}</span>
            {model.tags.map((t) => (
              <span key={t.slot} className={`t-micro ${TAG_TONE[t.tone]} shrink-0`}>{t.label}</span>
            ))}
            {resurface && <span className="t-micro text-amber-400 shrink-0">{resurface}</span>}
          </div>
          <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{model.whyLine}</p>
        </div>
        {!isStruck && mode === 'idle' && (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" disabled={actions.isPending} onClick={() => setMode('send')}>Send to client</Button>
            <Button size="sm" variant="secondary" disabled={actions.isPending} onClick={() => actions.fix(rec.id)}>Fix</Button>
            <button
              type="button"
              aria-label="More actions"
              className="rounded-md px-2 py-1 t-ui text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
              onClick={() => setMode(mode === 'throttle' ? 'idle' : 'throttle')}
            >
              ⋯
            </button>
          </div>
        )}
        {isStruck && (
          <Button size="sm" variant="secondary" disabled={actions.isPending} onClick={() => actions.unstrike(rec.id)}>Undo</Button>
        )}
      </div>

      {mode === 'send' && (
        <CockpitSendPanel
          disabled={actions.isPending}
          onSend={(note) => { actions.send(rec.id, note || undefined); close(); }}
          onCancel={close}
        />
      )}
      {mode === 'throttle' && (
        <div className="flex flex-wrap items-center gap-2">
          <CockpitThrottlePicker
            disabled={actions.isPending}
            onPick={(days) => { actions.throttle(rec.id, days); close(); }}
            onCancel={close}
          />
          <button
            type="button"
            className="t-caption-sm text-red-400 hover:text-red-300 px-1"
            onClick={() => setMode('strike')}
          >
            Strike instead
          </button>
        </div>
      )}
      {mode === 'strike' && (
        <CockpitStrikeConfirm
          cascadeNote={cascadeNote}
          disabled={actions.isPending}
          onConfirm={() => { actions.strike(rec.id); close(); }}
          onCancel={close}
        />
      )}
    </div>
  );
}
```

2. Typecheck (this will error on the `CockpitActions` import until B.7 exports it — that's expected; B.7 lands next and resolves it):

```
npm run typecheck
```

Expected: one error — `CockpitActions` not exported from `./StrategyCockpit` yet. Proceed to B.7 (do not commit a red typecheck; B.7 is the same logical unit).

#### Task B.7: `StrategyCockpit.tsx` — the hero shell (Fix-now pin + chip axes + sort)

**Files:** `src/components/strategy/StrategyCockpit.tsx` (create)

1. Create the cockpit shell. It owns: the lifecycle segmented control (single-select), the category counted-toggle chips (multi-select), the sort control, the Fix-now pin (capped, always visible), and renders `CockpitRow`s. It takes `recs` + `actions` as props (Lane C feeds them from the hook so this component is pure):

```tsx
import { useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import { SectionCard, Icon } from '../ui';
import { CockpitRow } from './CockpitRow';
import { recActCategory, ACT_CATEGORIES, type ActCategory } from '../../lib/recCategoryMap';
import {
  toCockpitRow, partitionByLifecycle, bucketOf, sortRecs, FIX_NOW_CAP,
  type LifecycleBucket, type CockpitSort,
} from './cockpitRowModel';
import type { Recommendation } from '../../../shared/types/recommendations';

export interface CockpitActions {
  send: (recId: string, note?: string) => void;
  strike: (recId: string) => void;
  unstrike: (recId: string) => void;
  throttle: (recId: string, days: 7 | 30 | 90) => void;
  fix: (recId: string) => void;
  isPending: boolean;
}

interface StrategyCockpitProps {
  recs: Recommendation[];
  actions: CockpitActions;
}

const LIFECYCLE_TABS: ReadonlyArray<{ id: LifecycleBucket; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'sent', label: 'Sent' },
  { id: 'approved', label: 'Approved' },
  { id: 'throttled', label: 'Throttled' },
];

const CATEGORY_LABELS: Record<ActCategory, string> = {
  content: 'Content',
  technical: 'Technical',
  'quick-win': 'Quick wins',
};

const SORTS: ReadonlyArray<{ id: CockpitSort; label: string }> = [
  { id: 'value', label: 'Value' },
  { id: 'impact', label: 'Impact' },
  { id: 'age', label: 'Age' },
];

/** Strategy v3 admin Curation Cockpit (spec §4) — the Overview-tab hero. Fix-now pin +
 *  lifecycle segmented control + category toggle chips + sort, rendering the v3 CockpitRow.
 *  Pure: recs + lifecycle actions are injected by the host (Lane C wiring). */
export function StrategyCockpit({ recs, actions }: StrategyCockpitProps) {
  const [bucket, setBucket] = useState<LifecycleBucket>('active');
  const [cats, setCats] = useState<Set<ActCategory>>(new Set());
  const [sort, setSort] = useState<CockpitSort>('value');

  const lifeCounts = useMemo(() => partitionByLifecycle(recs), [recs]);

  // Fix-now pin: capped, by value, visible regardless of the active bucket/category chip.
  const fixNow = useMemo(
    () => sortRecs(recs.filter((r) => toCockpitRow(r).isFixNow), 'value').slice(0, FIX_NOW_CAP),
    [recs],
  );

  const inBucket = useMemo(() => recs.filter((r) => bucketOf(r) === bucket), [recs, bucket]);

  const catCounts = useMemo(() => {
    const c: Record<ActCategory, number> = { content: 0, technical: 0, 'quick-win': 0 };
    for (const r of inBucket) c[recActCategory(r.type)] += 1;
    return c;
  }, [inBucket]);

  const visible = useMemo(() => {
    const filtered = cats.size === 0 ? inBucket : inBucket.filter((r) => cats.has(recActCategory(r.type)));
    return sortRecs(filtered, sort);
  }, [inBucket, cats, sort]);

  const toggleCat = (cat: ActCategory) => {
    setCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const titleIcon = <Icon as={Target} size="md" className="text-accent-brand" />;

  return (
    <SectionCard title="Curate recommendations" titleIcon={titleIcon}>
      <div className="space-y-4">
        {/* Fix now pin */}
        {fixNow.length > 0 && (
          <div className="space-y-2">
            <div className="t-caption text-[var(--brand-text-muted)] uppercase tracking-wide">Fix now · {fixNow.length}</div>
            {fixNow.map((r) => <CockpitRow key={`fix-${r.id}`} rec={r} actions={actions} />)}
          </div>
        )}

        {/* Lifecycle segmented control (single-select) */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--brand-border)] bg-[var(--surface-2)] p-1 w-fit">
          {LIFECYCLE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`rounded-md px-3 py-1.5 t-ui ${bucket === t.id ? 'bg-accent-brand text-zinc-950 font-semibold' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}
              onClick={() => setBucket(t.id)}
            >
              {t.label} {lifeCounts[t.id]}
            </button>
          ))}
        </div>

        {/* Category toggle chips (multi-select) + sort */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {ACT_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`rounded-full border px-3 py-1 t-caption-sm ${cats.has(cat) ? 'border-accent-brand text-accent-brand' : 'border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}
                onClick={() => toggleCat(cat)}
              >
                {CATEGORY_LABELS[cat]} {catCounts[cat]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Sort</span>
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`rounded-md px-2 py-1 t-caption-sm ${sort === s.id ? 'text-accent-brand' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}
                onClick={() => setSort(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* The faceted list */}
        <div className="space-y-2">
          {visible.map((r) => <CockpitRow key={r.id} rec={r} actions={actions} />)}
          {visible.length === 0 && (
            <p className="t-caption-sm text-[var(--brand-text-muted)] py-6 text-center">
              Nothing in this view. Switch lifecycle or clear a category filter.
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
```

2. Typecheck + build (B.6 + B.7 now form a closed unit):

```
npm run typecheck
npx vite build
```

Expected: zero errors; build succeeds.

3. Run the full cockpit unit test + pr-check (color-law / primitive checks):

```
npx vitest run tests/unit/cockpit-row-model.test.ts
npx tsx scripts/pr-check.ts
```

Expected: green. pr-check passes — no `violet`/`indigo`, no `text-green-400`, score colors via tokens, no hand-rolled card (uses `SectionCard`).

4. Commit:

```
git add src/components/strategy/CockpitRow.tsx src/components/strategy/StrategyCockpit.tsx
git commit -m "Strategy v3 P2 — StrategyCockpit hero shell + CockpitRow (fix-now pin, chip axes, sort)"
```

---

### Lane C (sonnet) [after A + B] — wiring (hooks + WS mirror + query keys + host swap)

**Exclusive files (create):** `src/hooks/admin/useRecommendationLifecycle.ts`, `src/hooks/admin/useRecDiscussion.ts`
**Exclusive files (modify):** `src/lib/wsEvents.ts`, `src/lib/wsInvalidation.ts`, `src/hooks/useWsInvalidation.ts`, `src/lib/queryKeys.ts`, `src/components/strategy/index.ts`, `src/components/KeywordStrategy.tsx`, `src/api/misc.ts`
**Blocked by:** **Lane A** (the route URLs + the `RECOMMENDATIONS_DISCUSSION_UPDATED` broadcast it must mirror) **and Lane B** (the `StrategyCockpit` component name + its `CockpitActions` prop shape). Lane C merges last in the phase.

> The `RECOMMENDATIONS_DISCUSSION_UPDATED` constant was added to **`server/ws-events.ts`** by Phase 1 Lane 1A. Lane C adds the **client mirror** in `src/lib/wsEvents.ts` + the registry entry in `useWsInvalidation.ts` + the invalidation `case` in `wsInvalidation.ts`, exactly per `00-contracts.md` §5 (2), (3), (4). The query keys `admin.recDiscussion` + `client.curatedRecommendations` were also added by Phase 1 Lane 1A (§8) — **do not re-add them**; Lane C only *references* `queryKeys.admin.recDiscussion`.

#### Task C.1: API client wrappers for the five lifecycle routes + discussion

**Files:** `src/api/misc.ts` (extend the `recommendations` export)

1. Add the admin lifecycle + discussion wrappers to the existing `recommendations` object (after `remove`). Confirm `patch`/`post`/`get` are already imported at the top of `misc.ts` (`grep -n "^import" src/api/misc.ts`); they are (used by `update`/`generate`):

```ts
  remove: (wsId: string, recId: string) =>
    del(`/api/public/recommendations/${wsId}/${recId}`),

  // Strategy v3 admin curation lifecycle (admin-only routes).
  send: (wsId: string, recId: string, note?: string) =>
    patch<Recommendation>(`/api/recommendations/${wsId}/${recId}/send`, { note }),
  strike: (wsId: string, recId: string) =>
    patch<Recommendation>(`/api/recommendations/${wsId}/${recId}/strike`, {}),
  unstrike: (wsId: string, recId: string) =>
    patch<Recommendation>(`/api/recommendations/${wsId}/${recId}/unstrike`, {}),
  throttle: (wsId: string, recId: string, days: 7 | 30 | 90) =>
    patch<Recommendation>(`/api/recommendations/${wsId}/${recId}/throttle`, { days }),
  fix: (wsId: string, recId: string) =>
    patch<Recommendation>(`/api/recommendations/${wsId}/${recId}/fix`, {}),
  // Discussion thread (admin cockpit Discuss filter).
  listDiscussion: (wsId: string, recId: string) =>
    get<RecDiscussionEntry[]>(`/api/recommendations/${wsId}/${recId}/discussion`),
  postDiscussion: (wsId: string, recId: string, body: string) =>
    post<RecDiscussionEntry>(`/api/recommendations/${wsId}/${recId}/discussion`, { body }),
```

2. Add the type imports at the **top** of `src/api/misc.ts` (grouped with existing imports):

```ts
import type { Recommendation, RecDiscussionEntry } from '../../shared/types/recommendations';
```

3. Typecheck:

```
npm run typecheck
```

Expected: zero errors (if a `get`/`post` helper isn't yet imported in `misc.ts`, add it to the existing `import { ... } from './client'` line — check first with `grep -n "from './client'" src/api/misc.ts`).

#### Task C.2: client-side WS event mirror + invalidation

**Files:** `src/lib/wsEvents.ts`, `src/hooks/useWsInvalidation.ts`, `src/lib/wsInvalidation.ts`

1. In `src/lib/wsEvents.ts`, after `RECOMMENDATIONS_UPDATED` (line 89), add the mirror (per §5 (2)):

```ts
  // Recommendations
  RECOMMENDATIONS_UPDATED: 'recommendations:updated',
  RECOMMENDATIONS_DISCUSSION_UPDATED: 'recommendations:discussion_updated',
```

2. In `src/hooks/useWsInvalidation.ts`, after the `RECOMMENDATIONS_UPDATED` registry entry (line 74), add (per §5 (3)):

```ts
    [WS_EVENTS.RECOMMENDATIONS_UPDATED]: () => invalidateRegistry(WS_EVENTS.RECOMMENDATIONS_UPDATED),
    [WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED]: () => invalidateRegistry(WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED),
```

3. In `src/lib/wsInvalidation.ts`, add the `case` after the `RECOMMENDATIONS_UPDATED` block (which ends at line 409), per §5 (4). The `client.curatedRecommendations` key is referenced here so the P4 client thread re-fetches; `admin.recDiscussion` covers the cockpit Discuss filter:

```ts
    case WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED:
      return [
        queryKeys.admin.recDiscussion(workspaceId),
        queryKeys.client.curatedRecommendations(workspaceId),
      ] as const;
```

4. Typecheck:

```
npm run typecheck
```

Expected: zero errors (both query keys exist from Phase 1 §8).

5. Commit:

```
git add src/api/misc.ts src/lib/wsEvents.ts src/hooks/useWsInvalidation.ts src/lib/wsInvalidation.ts
git commit -m "Strategy v3 P2 — API wrappers + RECOMMENDATIONS_DISCUSSION_UPDATED client mirror"
```

#### Task C.3: `useRecDiscussion` (admin) hook

**Files:** `src/hooks/admin/useRecDiscussion.ts` (create)

1. Create the read + append hook (read via `queryKeys.admin.recDiscussion`; the post invalidates on success — the WS broadcast also covers it). Note: the discussion key is per-workspace (§8), so we cache per-rec under a sub-key but invalidate the workspace-level key the WS mirror uses:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recommendations } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';
import type { RecDiscussionEntry } from '../../../shared/types/recommendations';

/** Admin cockpit Discuss filter — read a rec's discussion thread. */
export function useRecDiscussion(workspaceId: string, recId: string | undefined) {
  return useQuery<RecDiscussionEntry[]>({
    queryKey: [...queryKeys.admin.recDiscussion(workspaceId), recId ?? '_'],
    queryFn: () => recommendations.listDiscussion(workspaceId, recId!),
    enabled: !!workspaceId && !!recId,
    staleTime: 15_000,
  });
}

/** Admin cockpit — append a strategist reply to a rec's discussion thread. */
export function usePostRecDiscussion(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recId, body }: { recId: string; body: string }) =>
      recommendations.postDiscussion(workspaceId, recId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.recDiscussion(workspaceId) });
    },
  });
}
```

2. Typecheck:

```
npm run typecheck
```

Expected: zero errors.

#### Task C.4: `useRecommendationLifecycle` hook — the `CockpitActions` provider

**Files:** `src/hooks/admin/useRecommendationLifecycle.ts` (create)

1. Create the hook that returns the exact `CockpitActions` shape Lane B's `StrategyCockpit` consumes. Every mutation invalidates the admin + shared rec caches on success (the WS broadcast also covers cross-client fan-out):

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { recommendations } from '../../api/misc';
import { queryKeys } from '../../lib/queryKeys';
import type { CockpitActions } from '../../components/strategy/StrategyCockpit';
import type { Recommendation } from '../../../shared/types/recommendations';

/** Strategy v3 — wires the cockpit's four lifecycle actions to the admin routes,
 *  invalidating the admin + shared rec caches on each success. Returns the
 *  CockpitActions shape StrategyCockpit consumes (no prop drilling of mutations). */
export function useRecommendationLifecycle(workspaceId: string): CockpitActions {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
    qc.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
  };

  const send = useMutation<Recommendation, Error, { recId: string; note?: string }>({
    mutationFn: ({ recId, note }) => recommendations.send(workspaceId, recId, note),
    onSuccess: invalidate,
  });
  const strike = useMutation<Recommendation, Error, string>({
    mutationFn: (recId) => recommendations.strike(workspaceId, recId),
    onSuccess: invalidate,
  });
  const unstrike = useMutation<Recommendation, Error, string>({
    mutationFn: (recId) => recommendations.unstrike(workspaceId, recId),
    onSuccess: invalidate,
  });
  const throttle = useMutation<Recommendation, Error, { recId: string; days: 7 | 30 | 90 }>({
    mutationFn: ({ recId, days }) => recommendations.throttle(workspaceId, recId, days),
    onSuccess: invalidate,
  });
  const fix = useMutation<Recommendation, Error, string>({
    mutationFn: (recId) => recommendations.fix(workspaceId, recId),
    onSuccess: invalidate,
  });

  return {
    send: (recId, note) => send.mutate({ recId, note }),
    strike: (recId) => strike.mutate(recId),
    unstrike: (recId) => unstrike.mutate(recId),
    throttle: (recId, days) => throttle.mutate({ recId, days }),
    fix: (recId) => fix.mutate(recId),
    isPending: send.isPending || strike.isPending || unstrike.isPending || throttle.isPending || fix.isPending,
  };
}
```

2. Typecheck:

```
npm run typecheck
```

Expected: zero errors.

3. Commit:

```
git add src/hooks/admin/useRecDiscussion.ts src/hooks/admin/useRecommendationLifecycle.ts
git commit -m "Strategy v3 P2 — admin lifecycle + discussion React Query hooks"
```

#### Task C.5: barrel export the cockpit

**Files:** `src/components/strategy/index.ts` (append)

1. Append the cockpit export (after `export * from './ActQueue';`):

```ts
export * from './ActQueue';
export * from './StrategyCockpit';
```

> Only `StrategyCockpit` is exported from the barrel — `CockpitRow`/`CockpitSendPanel`/`CockpitThrottlePicker`/`CockpitStrikeConfirm`/`cockpitRowModel` are internal to the cockpit and imported directly by `StrategyCockpit`, not consumed elsewhere (YAGNI — don't widen the public surface).

2. Typecheck:

```
npm run typecheck
```

Expected: zero errors.

#### Task C.6: host swap — mount `StrategyCockpit` as the Overview hero

**Files:** `src/components/KeywordStrategy.tsx` (modify the Overview region of the post-Phase-0 single layout)

1. First re-read the host to confirm the post-Phase-0 shape (Phase 0 collapsed it to one layout; the `actQueueEl`/`orientEl` region inside the Overview interior tab is where the hero lives):

```
grep -n "actQueueEl\|orientEl\|interiorTab === 'overview'\|useAdminRecommendationSet\|StrategyCockpit\|useRecommendationLifecycle" src/components/KeywordStrategy.tsx
```

2. Add the imports at the **top** of the file (grouped with the existing `../hooks/admin` and `./strategy` import groups):

```ts
import { useRecommendationLifecycle } from '../hooks/admin/useRecommendationLifecycle';
```

…and add `StrategyCockpit` to the existing `from './strategy'` import block (the one that already pulls `OrientZone, ActQueue`):

```ts
  OrientZone,
  ActQueue,
  StrategyCockpit,
```

3. Inside the component body, near where `recommendationSet` is read (the `useAdminRecommendationSet` call) and `actQueueEl` is built, derive the active recs + actions and build the cockpit element. Add after the `useAdminRecommendationSet` line:

```ts
  const lifecycleActions = useRecommendationLifecycle(workspaceId);
  // The cockpit shows ALL recs (it has its own lifecycle/category facets + Fix-now pin);
  // it filters internally. We pass the full set's recommendations array (empty-safe).
  const cockpitRecs = recommendationSet?.recommendations ?? [];
  const cockpitEl = isRealStrategy
    ? <StrategyCockpit recs={cockpitRecs} actions={lifecycleActions} />
    : null;
```

4. In the Overview interior-tab JSX, replace the `actQueueEl ?? (…legacy quick-wins fallback…)` hero with the cockpit. Change:

```tsx
              {orientEl}
              {actQueueEl ?? (
                <>
                  {realLeaves.quickWins}
                  {realLeaves.lhf}
                  {realLeaves.keywordGaps}
                </>
              )}
```

to:

```tsx
              {orientEl}
              {cockpitEl ?? (
                <>
                  {realLeaves.quickWins}
                  {realLeaves.lhf}
                  {realLeaves.keywordGaps}
                </>
              )}
```

> The `ActQueue`/`actQueueEl` binding stays defined (it is still exported + may be referenced elsewhere); the cockpit simply supersedes it as the Overview hero. If `actQueueEl` becomes wholly unreferenced after this swap, remove its `const actQueueEl = …` line + the now-unused `useActQueue` flag in the **same** edit (pr-check + tsc `noUnusedLocals` will flag it — fix it here, do not leave dead code). Confirm with `grep -n "actQueueEl\|useActQueue\|<ActQueue" src/components/KeywordStrategy.tsx` after the swap.

5. Typecheck + build:

```
npm run typecheck
npx vite build
```

Expected: zero errors; build succeeds.

6. Manual smoke (optional but recommended): start the app, open Strategy → Overview for a workspace with recs, confirm the cockpit renders with the Fix-now pin, lifecycle chips with counts, category chips, sort, and that Send opens the note panel (Enter sends).

```
npm run dev:all
```

7. Run the full frontend-touching suites + pr-check:

```
npx vitest run tests/unit/cockpit-row-model.test.ts
npx tsx scripts/pr-check.ts
```

Expected: green.

8. Commit:

```
git add src/components/strategy/index.ts src/components/KeywordStrategy.tsx
git commit -m "Strategy v3 P2 — mount StrategyCockpit as the Overview hero + barrel export"
```

---

### Phase exit gates

Run from the repo root; all must be green before opening the Phase 2 PR to `staging`:

1. **Typecheck (project-aware):**
   ```
   npm run typecheck
   ```
   Expected: zero errors (`tsc -b` across app + node configs).

2. **Production build:**
   ```
   npx vite build
   ```
   Expected: builds successfully.

3. **Phase-2 test suites (the two new + the discussion module + the email render):**
   ```
   npx vitest run tests/integration/recommendation-lifecycle-admin-routes.test.ts tests/unit/cockpit-row-model.test.ts
   ```
   Expected: all pass — send/strike/unstrike/throttle/fix routes, the discussion read/append routes, the `rec_discussion` module, the `curated_recs_sent` template, and the cockpit row model.

4. **Full suite (no regressions elsewhere):**
   ```
   npx vitest run
   ```
   Expected: full suite green (CLAUDE.md "run the full suite, not just new tests").

5. **pr-check:**
   ```
   npx tsx scripts/pr-check.ts
   ```
   Expected: zero errors. Specifically passes: every new admin route calls `addActivity` + `broadcastToWorkspace`; no bare `JSON.parse` on DB columns (`rec-discussion.ts` uses no JSON columns); no `text-green-400`/`violet`/`indigo`; score colors via tokens; cockpit uses `SectionCard` (no hand-rolled card); strike/throttle/send paths never write `RecStatus` (the rec-status-vs-lifecycle-axis guard); migration + mapper lockstep for `rec_discussion`.

6. **Migration applied:**
   ```
   npm run db:migrate
   ```
   Expected: `138-rec-discussion.sql` applied (or "no pending migrations").

7. **Contract-axis invariant (manual assertion in the integration suite — already covered by the route tests):** a struck or throttled rec's `status` (RecStatus) is unchanged by the strike/throttle routes; only `lifecycle`/`clientStatus` move. The send route moves `clientStatus` to `sent` and never sets `status:'completed'`. These are asserted in `tests/integration/recommendation-lifecycle-admin-routes.test.ts` (Tasks A.7–A.12).

8. **Docs (post-task, controller commits per-lane):** append the Phase-2 cockpit + lifecycle-routes entries to `FEATURE_AUDIT.md`; mark the Phase-2 roadmap item progress in `data/roadmap.json` (then `npx tsx scripts/sort-roadmap.ts`); note the cockpit color usage in `BRAND_DESIGN_LANGUAGE.md` (teal actions / emerald sent rail / muted struck). These three files are cross-phase append-only — keep edits minimal and per-lane to avoid merge churn.

---

*End of Phase 2 — admin cockpit curation. Phase 2 merges to `staging` and is verified before Phase 3 (bulk + self-managing) is started; Phase 4 (Track C) runs in parallel against the Phase-1 contracts and the pre-committed `rec_discussion` read shape.*


---

## Phase 3 — bulk + self-managing (Stage 2 Track B, after P2 merge)

This phase turns the cockpit into a *batch-over-~144* tool and makes the curation loop self-managing. **Goal:** (1) bulk operations over the cockpit's filtered set — predicate-based select-all, a sticky bulk-action bar, and a single-transaction bulk mutation; (2) a self-managing nudge engine — a flag-gated cron pass that flags stale sent recs / supersessions, writes `ClientSignalsSlice.recResponses` so AdminChat "sees the loop," and surfaces a "Needs your attention" strip + curation meter + a NotificationBell entry for new client responses. **Merges before it:** Phase 0 (v2 cutover), Phase 1 (the 13 locked contracts — `clientStatus`/`lifecycle` axes, `isActiveRec`, `recResponses` field decl, the two child flags), and **Phase 2** (the cockpit shell `StrategyCockpit.tsx`, `cockpitRowModel.ts`, the per-row admin routes `POST /api/recommendations/:ws/:recId/{send,throttle,strike}`, the `useRecommendationLifecycle` hook, and the `rec_discussion` substrate). The P3-Lane Server cron pass blocks on **P1 only** (it needs the `clientStatus` axis + `isActiveRec`) and can be written the moment P1 merges, but it ships inside the single Phase-3 PR. **Flag-gated exit gate:** the entire phase is dark behind `strategy-command-center` (the v3 umbrella, ON only on staging); the cron pass is additionally gated behind the child flag `strategy-staleness-scan` (per contract §10) so the nudge engine is OFF until its on-read/cost behavior is validated. Phase-3 ships one PR, merged to `staging` and verified before Phase 5's Track-B-dependent lanes (5C/5D) dispatch.

> **Cross-track note (read before dispatch):** Phase 2 has merged before any Phase-3 work starts, so although `server/routes/recommendations.ts` was last owned by P2-Lane A, **P3-Lane Server takes exclusive ownership of it for the duration of Phase 3** to add the single `POST /api/recommendations/:workspaceId/bulk` endpoint (spec §4.4 puts bulk in Phase 3, and bulk MUST wrap N mutations in one `db.transaction()` — a server endpoint, not N frontend calls). There is no write-collision because P2 is fully merged; this is strictly sequential. The bulk endpoint reuses the Phase-1 single-writer `server/recommendation-lifecycle.ts` (it does **not** re-implement blob mutation).

---

### Lane Server (opus) — self-managing cron + slice write + bulk endpoint + notifications payload

**Blocked by:** Phase 1 merge only (needs `clientStatus`/`sentAt` axis + `isActiveRec` + the `recResponses` field decl + the `strategy-staleness-scan` flag). Can be authored as soon as P1 merges; **ships in the Phase-3 PR**. Exclusive files: `server/recommendation-staleness.ts` (NEW), `server/outcome-crons.ts`, `server/intelligence/client-signals-slice.ts`, `server/routes/workspaces.ts`, `server/routes/recommendations.ts` (bulk endpoint only — see cross-track note above), plus the lane's own test files.

> **Idempotency model (locked by contract §0 + §29):** "staleness nudges key on `recId+nudgeKind`, in-memory/idempotent. **No migration.**" The scan persists **no** nudge state on the rec blob and adds **no** new typed field (that would violate the Phase-1 single-owner lock on `shared/types/recommendations.ts`). Instead it mirrors the existing `action_backlog_alert` pattern in `outcome-crons.ts`: the nudge array is **derived fresh** every scan from `clientStatus === 'sent'` + `sentAt` age, and the admin-only `rec_nudge_*` activity is deduplicated via `countActivityByType(ws, type, withinDays)` (the same dedup `runMeasure` uses). Same `recId + nudgeKind` within the dedup window ⇒ no duplicate activity. No race, no cron-written blob.

#### Task S.1: Define the staleness scan result types + the pure age classifier (failing test)

**Files:** `tests/unit/recommendation-staleness.test.ts` (NEW)

1. Create the test file with a unit test for the pure classifier that the cron will call (no DB, no cron — just the age → nudgeKind logic so it's deterministic):

```ts
import { describe, it, expect } from 'vitest';
import { classifyStaleSentRec, STALE_SENT_REC_THRESHOLD_DAYS } from '../../server/recommendation-staleness.js';

describe('classifyStaleSentRec', () => {
  const now = Date.parse('2026-06-18T00:00:00.000Z');

  it('returns null for a sent rec younger than the threshold', () => {
    const sentAt = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(classifyStaleSentRec({ clientStatus: 'sent', sentAt }, now)).toBeNull();
  });

  it('returns a "stale_sent" nudge for a sent rec past the threshold with no response', () => {
    const sentAt = new Date(now - (STALE_SENT_REC_THRESHOLD_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const result = classifyStaleSentRec({ clientStatus: 'sent', sentAt }, now);
    expect(result).toEqual({ nudgeKind: 'stale_sent', ageDays: STALE_SENT_REC_THRESHOLD_DAYS + 1 });
  });

  it('returns null once the client has responded (approved/declined/discussing)', () => {
    const sentAt = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(classifyStaleSentRec({ clientStatus: 'approved', sentAt }, now)).toBeNull();
    expect(classifyStaleSentRec({ clientStatus: 'declined', sentAt }, now)).toBeNull();
    expect(classifyStaleSentRec({ clientStatus: 'discussing', sentAt }, now)).toBeNull();
  });

  it('returns null when sentAt is absent (never actually sent)', () => {
    expect(classifyStaleSentRec({ clientStatus: 'sent' }, now)).toBeNull();
  });
});
```

2. Run it, see it fail (module does not exist):

```
npx vitest run tests/unit/recommendation-staleness.test.ts
```

Expected: `Error: Failed to resolve import "../../server/recommendation-staleness.js"` (red).

#### Task S.2: Minimal `recommendation-staleness.ts` — types + pure classifier

**Files:** `server/recommendation-staleness.ts` (NEW)

1. Create the file with the shared nudge types + the pure classifier (no cron yet):

```ts
// server/recommendation-staleness.ts
// Strategy v3 (spec §4.5, §8) — the self-managing nudge engine for SENT recs.
// Flag-gated behind 'strategy-staleness-scan' (contract §10). Idempotent with NO
// persisted nudge state and NO migration (contract §0): the nudge array is derived
// fresh on every scan from clientStatus==='sent' + sentAt age; the admin-only
// rec_nudge_* activity is deduplicated via countActivityByType. Mirrors the
// action_backlog_alert pattern in outcome-crons.ts.

import type { Recommendation } from '../../shared/types/recommendations.js';
import { createLogger } from './logger.js';

const log = createLogger('recommendation-staleness');

const DAY_MS = 24 * 60 * 60 * 1000;

/** A sent rec is "stale" once it has been waiting for a client decision this long. */
export const STALE_SENT_REC_THRESHOLD_DAYS = 14;

/** The kinds of attention a sent rec can need. 'stale_sent' = no response past the
 *  threshold; 'superseded' = a newer rec covers the same affected pages (see scanWorkspaceStaleness). */
export type RecNudgeKind = 'stale_sent' | 'superseded';

/** One derived nudge for a single rec — never persisted; recomputed each scan. */
export interface RecStalenessNudge {
  recId: string;
  title: string;
  nudgeKind: RecNudgeKind;
  ageDays: number;
}

/**
 * Pure age classifier for a single rec. Returns a nudge ONLY when the rec is
 * clientStatus==='sent', has a sentAt, the client has NOT responded, and the wait
 * exceeds STALE_SENT_REC_THRESHOLD_DAYS. Deterministic — `now` is injected for tests.
 */
export function classifyStaleSentRec(
  rec: Pick<Recommendation, 'clientStatus' | 'sentAt'>,
  now: number = Date.now(),
): { nudgeKind: 'stale_sent'; ageDays: number } | null {
  if (rec.clientStatus !== 'sent') return null;
  if (!rec.sentAt) return null;
  const sentMs = Date.parse(rec.sentAt);
  if (!Number.isFinite(sentMs)) return null;
  const ageDays = Math.floor((now - sentMs) / DAY_MS);
  if (ageDays < STALE_SENT_REC_THRESHOLD_DAYS) return null;
  return { nudgeKind: 'stale_sent', ageDays };
}

export { log as recStalenessLog };
```

2. Run the test, see it pass:

```
npx vitest run tests/unit/recommendation-staleness.test.ts
```

Expected: 4 passed (green).

3. Commit:

```
git add server/recommendation-staleness.ts tests/unit/recommendation-staleness.test.ts
git commit -m "Strategy v3 P3 — staleness scan: pure sent-rec age classifier + nudge types"
```

#### Task S.3: Workspace scan + supersession detection (failing test)

**Files:** `tests/unit/recommendation-staleness.test.ts` (modify)

1. Add a test for `scanWorkspaceStaleness` (pure over a rec array — supersession = a newer non-sent active rec whose `affectedPages` overlap a stale sent rec). Add these imports to the existing import line and append the describe block:

```ts
import { classifyStaleSentRec, STALE_SENT_REC_THRESHOLD_DAYS, scanWorkspaceStaleness } from '../../server/recommendation-staleness.js';
```

```ts
describe('scanWorkspaceStaleness', () => {
  const now = Date.parse('2026-06-18T00:00:00.000Z');
  const oldSent = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();

  it('returns a stale_sent nudge for each old unanswered sent rec', () => {
    const recs = [
      { id: 'r1', title: 'Fix decay on /pricing', clientStatus: 'sent', sentAt: oldSent, affectedPages: ['/pricing'] },
      { id: 'r2', title: 'Recent send', clientStatus: 'sent', sentAt: new Date(now - 2 * 86400000).toISOString(), affectedPages: ['/about'] },
    ] as any;
    const nudges = scanWorkspaceStaleness(recs, now);
    expect(nudges).toHaveLength(1);
    expect(nudges[0]).toMatchObject({ recId: 'r1', nudgeKind: 'stale_sent', ageDays: 20 });
  });

  it('flags a sent rec as superseded when a newer active rec covers the same page', () => {
    const recs = [
      { id: 'r1', title: 'Old sent for /pricing', clientStatus: 'sent', sentAt: oldSent, affectedPages: ['/pricing'], createdAt: oldSent },
      { id: 'r2', title: 'Newer active for /pricing', clientStatus: 'system', lifecycle: 'active', affectedPages: ['/pricing'], createdAt: new Date(now).toISOString() },
    ] as any;
    const nudges = scanWorkspaceStaleness(recs, now);
    const superseded = nudges.find(n => n.nudgeKind === 'superseded');
    expect(superseded).toMatchObject({ recId: 'r1', nudgeKind: 'superseded' });
  });

  it('returns an empty array when nothing needs attention', () => {
    expect(scanWorkspaceStaleness([], now)).toEqual([]);
  });
});
```

2. Run it, see the new block fail (function not exported):

```
npx vitest run tests/unit/recommendation-staleness.test.ts
```

Expected: the `scanWorkspaceStaleness` block is red; the classifier block stays green.

#### Task S.4: Implement `scanWorkspaceStaleness`

**Files:** `server/recommendation-staleness.ts` (modify)

1. Append the pure workspace scanner below `classifyStaleSentRec`:

```ts
/**
 * Derive every attention nudge for a workspace's rec set (pure — no DB, no persistence).
 * Two kinds: stale_sent (a sent rec past the threshold with no client response) and
 * superseded (a stale sent rec whose affectedPages overlap a NEWER active, not-yet-sent
 * rec — the new rec replaces the old ask). Recomputed each scan; never stored.
 */
export function scanWorkspaceStaleness(
  recs: Recommendation[],
  now: number = Date.now(),
): RecStalenessNudge[] {
  const nudges: RecStalenessNudge[] = [];

  for (const rec of recs) {
    const stale = classifyStaleSentRec(rec, now);
    if (!stale) continue;

    // Supersession: any NEWER rec that is active-and-uncurated (clientStatus 'system'|'curated',
    // not struck/throttled) covering at least one of this rec's affected pages.
    const recPages = new Set(rec.affectedPages ?? []);
    const superseded = recs.some(other => {
      if (other.id === rec.id) return false;
      if (other.clientStatus !== 'system' && other.clientStatus !== 'curated') return false;
      if (other.lifecycle === 'struck' || other.lifecycle === 'throttled') return false;
      const otherNewer = Date.parse(other.createdAt) > Date.parse(rec.sentAt!);
      if (!otherNewer) return false;
      return (other.affectedPages ?? []).some(p => recPages.has(p));
    });

    nudges.push({
      recId: rec.id,
      title: rec.title,
      nudgeKind: superseded ? 'superseded' : 'stale_sent',
      ageDays: stale.ageDays,
    });
  }

  return nudges;
}
```

2. Run the test, see all pass:

```
npx vitest run tests/unit/recommendation-staleness.test.ts
```

Expected: 7 passed (green).

3. Commit:

```
git add server/recommendation-staleness.ts tests/unit/recommendation-staleness.test.ts
git commit -m "Strategy v3 P3 — staleness scan: per-workspace stale_sent + supersession derivation"
```

#### Task S.5: The cron pass `runSentRecStalenessScan` — flag-gated + idempotent (failing test)

**Files:** `tests/integration/recommendation-staleness-scan.test.ts` (NEW)

1. Create an integration test that seeds a workspace with one old sent rec, runs the scan with the flag ON, and asserts exactly one `rec_nudge_stale` activity is written — and re-running does NOT write a second (idempotent dedup):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveRecommendations } from '../../server/recommendations.js';
import { runSentRecStalenessScan } from '../../server/recommendation-staleness.js';
import { countActivityByType } from '../../server/activity-log.js';
import { setFeatureFlagOverride, clearFeatureFlagOverride } from '../../server/feature-flags.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

describe('runSentRecStalenessScan', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seeded = seedWorkspace({ name: 'Staleness Scan WS' });
    wsId = seeded.workspaceId;
    cleanup = seeded.cleanup;
    const oldSent = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const recs: Recommendation[] = [{
      id: 'rec-stale-1', type: 'content_decay', title: 'Old sent rec', description: 'd', insight: 'i',
      severity: 'high', affectedPages: ['/pricing'], source: 'test',
      clientStatus: 'sent', sentAt: oldSent, lifecycle: 'active',
      status: 'pending', createdAt: oldSent,
    } as Recommendation];
    saveRecommendations({ workspaceId: wsId, generatedAt: oldSent, recommendations: recs, summary: {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0,
      totalOpportunityValue: 0, actionableOpportunityValue: 0, topRecommendationId: null,
    } });
    setFeatureFlagOverride('strategy-staleness-scan', true);
  });

  afterAll(() => {
    clearFeatureFlagOverride('strategy-staleness-scan');
    cleanup();
  });

  it('writes one rec_nudge_stale activity for the old sent rec', () => {
    const result = runSentRecStalenessScan();
    expect(result.workspacesScanned).toBeGreaterThanOrEqual(1);
    expect(countActivityByType(wsId, 'rec_nudge_stale', 30)).toBe(1);
  });

  it('is idempotent — a second scan within the dedup window writes no new activity', () => {
    runSentRecStalenessScan();
    expect(countActivityByType(wsId, 'rec_nudge_stale', 30)).toBe(1);
  });
});
```

2. Run it, see it fail (the function + the `rec_nudge_stale` activity type + the flag-override helpers do not exist yet):

```
npx vitest run tests/integration/recommendation-staleness-scan.test.ts
```

Expected: red — `runSentRecStalenessScan` not exported (and possibly `'rec_nudge_stale'` not a valid `ActivityType`).

> **Note on the activity type:** `rec_nudge_stale` is a NET-NEW **admin-only** activity type this lane owns end-to-end (it is NOT one of the four `rec_*` types pre-committed in contract §4 — those are lifecycle transitions). Register it in Task S.6. It is deliberately **omitted** from `CLIENT_VISIBLE_TYPES` (a stale-rec nudge is internal curation hygiene the client must never see). If a flag-override helper (`setFeatureFlagOverride`) does not already exist in `server/feature-flags.ts`, the test instead seeds the flag via the existing per-workspace override mechanism the codebase already uses (check `server/feature-flags.ts` exports first; if only `isFeatureEnabled(flag, workspaceId)` exists with a workspace allowlist, pass `wsId` through that path and drop the override calls). This is verify-before-write — read `server/feature-flags.ts` before authoring this test.

#### Task S.6: Register the `rec_nudge_stale` admin-only activity type

**Files:** `server/activity-log.ts` (modify)

> **Ownership note:** contract §4 had Phase 1 register the four lifecycle `rec_*` types. This single admin-only `rec_nudge_stale` type was NOT in that set and is owned by P3-Lane Server. Because P1 and P2 are merged, this is a sequential append to the closed union — no collision.

1. Add the type to the `ActivityType` union, immediately after the `'rec_throttled'` line that Phase 1 added (contract §4a):

```ts
  | 'rec_throttled'        // admin-only: operator throttled a rec for 7/30/90 days
  // Strategy v3 P3 — admin-only staleness nudge (a sent rec waiting >14d with no client
  // response, or superseded by a newer rec). Internal curation hygiene; deliberately NOT
  // in CLIENT_VISIBLE_TYPES — a stale-rec nudge must never surface in the client activity feed.
  | 'rec_nudge_stale'
```

2. Do **not** add it to `CLIENT_VISIBLE_TYPES` (it stays admin-only). Verify it compiles:

```
npm run typecheck
```

Expected: zero errors (red test still red — the cron function does not exist yet).

#### Task S.7: Implement `runSentRecStalenessScan`

**Files:** `server/recommendation-staleness.ts` (modify)

1. Add the imports at the top of the file (grouped with the existing imports — CLAUDE.md "imports at top of file"):

```ts
import type { Recommendation } from '../../shared/types/recommendations.js';
import { createLogger } from './logger.js';
import { listWorkspaces } from './workspaces.js';
import { loadRecommendations } from './recommendations.js';
import { addActivity, countActivityByType } from './activity-log.js';
import { isFeatureEnabled } from './feature-flags.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
```

2. Append the cron pass to the bottom of the file. It mirrors the `action_backlog_alert` dedup pattern: derive nudges, write one deduplicated admin-only activity per `recId+nudgeKind`, broadcast so the cockpit "Needs your attention" strip refetches:

```ts
/** Dedup window for the nudge activity — matches the 14d cadence so a sent rec that stays
 *  stale across two daily ticks is not re-logged every day. */
const NUDGE_DEDUP_DAYS = STALE_SENT_REC_THRESHOLD_DAYS;

export interface StalenessScanResult {
  workspacesScanned: number;
  nudgesWritten: number;
}

/**
 * The self-managing nudge pass (spec §8). Flag-gated behind 'strategy-staleness-scan'.
 * For every workspace: derive its attention nudges via scanWorkspaceStaleness, and for each
 * NEW nudge (deduplicated on recId+nudgeKind within NUDGE_DEDUP_DAYS) write one admin-only
 * rec_nudge_stale activity and broadcast RECOMMENDATIONS_UPDATED so the cockpit's
 * "Needs your attention" strip refetches. NO persisted nudge state, NO migration (contract §0).
 */
export function runSentRecStalenessScan(now: number = Date.now()): StalenessScanResult {
  let workspacesScanned = 0;
  let nudgesWritten = 0;

  for (const ws of listWorkspaces()) {
    // Per-workspace flag check (multi-tenant rollout — staging-only until validated).
    if (!isFeatureEnabled('strategy-staleness-scan', ws.id)) continue;
    workspacesScanned++;

    const set = loadRecommendations(ws.id);
    if (!set || set.recommendations.length === 0) continue;

    const nudges = scanWorkspaceStaleness(set.recommendations as Recommendation[], now);
    if (nudges.length === 0) continue;

    let wroteForWorkspace = false;
    for (const nudge of nudges) {
      // Idempotent: skip if a rec_nudge_stale activity for THIS rec+kind already fired
      // within the dedup window. We key on the rec id + kind embedded in the description
      // so two distinct recs do not collide and a re-stale rec re-nudges after the window.
      const alreadyNudged = countActivityByType(ws.id, 'rec_nudge_stale', NUDGE_DEDUP_DAYS) > 0
        && hasNudgeActivity(ws.id, nudge.recId, nudge.nudgeKind, now);
      if (alreadyNudged) continue;

      addActivity(
        ws.id,
        'rec_nudge_stale',
        nudge.nudgeKind === 'superseded'
          ? `Sent recommendation superseded — "${nudge.title}"`
          : `Sent recommendation waiting ${nudge.ageDays}d — "${nudge.title}"`,
        nudge.nudgeKind === 'superseded'
          ? 'A newer recommendation covers the same pages. Consider striking or re-sending.'
          : `No client response in ${nudge.ageDays} days. Consider a nudge or throttle.`,
        { recId: nudge.recId, nudgeKind: nudge.nudgeKind, ageDays: nudge.ageDays },
      );
      nudgesWritten++;
      wroteForWorkspace = true;
    }

    if (wroteForWorkspace) {
      broadcastToWorkspace(ws.id, WS_EVENTS.RECOMMENDATIONS_UPDATED, { reason: 'staleness_scan' });
    }
  }

  log.info({ workspacesScanned, nudgesWritten }, 'Sent-rec staleness scan complete');
  return { workspacesScanned, nudgesWritten };
}

/** True if an exact recId+nudgeKind activity already exists in the dedup window. countActivityByType
 *  is type-coarse, so we read the recent rec_nudge_stale entries and match the metadata exactly. */
function hasNudgeActivity(workspaceId: string, recId: string, nudgeKind: RecNudgeKind, now: number): boolean {
  // listActivity is the existing read; filter to rec_nudge_stale within the window and match metadata.
  // (Imported lazily to avoid a static cycle with activity-log; see existing dynamic-import pattern.)
  const sinceMs = now - NUDGE_DEDUP_DAYS * DAY_MS;
  const recent = listRecentNudgeActivities(workspaceId, sinceMs);
  return recent.some(a => a.recId === recId && a.nudgeKind === nudgeKind);
}
```

3. The `hasNudgeActivity` helper needs a typed read of recent nudge activities. Add a small typed reader at the bottom that reads via the existing `listActivity` export (read `server/activity-log.ts` for its exact signature first; the codebase exposes `listActivity(workspaceId, opts?)` returning `ActivityEntry[]` with `type`, `createdAt`, `metadata`). Append:

```ts
import { listActivity } from './activity-log.js';

/** Read recent rec_nudge_stale activities and project their metadata for exact dedup matching. */
function listRecentNudgeActivities(
  workspaceId: string,
  sinceMs: number,
): Array<{ recId: string; nudgeKind: RecNudgeKind }> {
  return listActivity(workspaceId)
    .filter(a => a.type === 'rec_nudge_stale' && Date.parse(a.createdAt) >= sinceMs)
    .map(a => ({
      recId: String((a.metadata as Record<string, unknown> | undefined)?.recId ?? ''),
      nudgeKind: ((a.metadata as Record<string, unknown> | undefined)?.nudgeKind ?? 'stale_sent') as RecNudgeKind,
    }));
}
```

> Move the two `import { addActivity, countActivityByType } from './activity-log.js';` / `import { listActivity } from './activity-log.js';` lines into **one** grouped import at the top: `import { addActivity, countActivityByType, listActivity } from './activity-log.js';` (CLAUDE.md "imports at top of file" — never add an import mid-file). Delete the duplicate `import { createLogger }`/`Recommendation` lines introduced in Task S.2 if they now collide; the file must have exactly one import block.

4. Run the integration test, see it pass:

```
npx vitest run tests/integration/recommendation-staleness-scan.test.ts
```

Expected: 2 passed (green).

5. Commit:

```
git add server/recommendation-staleness.ts server/activity-log.ts tests/integration/recommendation-staleness-scan.test.ts
git commit -m "Strategy v3 P3 — runSentRecStalenessScan: flag-gated, idempotent admin nudge pass"
```

#### Task S.8: Register the scan in `outcome-crons.ts` (NOT jobs.ts)

**Files:** `server/outcome-crons.ts` (modify)

1. Add the type import alongside the existing `import type * as` lines (after the `PlatformLearningsPriors` line, ~line 17):

```ts
import type * as PlatformLearningsPriors from './platform-learnings-priors.js';
import type * as RecommendationStaleness from './recommendation-staleness.js';
```

2. Add a `stalenessScanInterval` handle alongside the other interval handles (after `platformPriorsInterval`, ~line 36):

```ts
let platformPriorsInterval: ReturnType<typeof setInterval> | null = null;
let stalenessScanInterval: ReturnType<typeof setInterval> | null = null;
```

3. Add the runner inside `startOutcomeCrons`, after `runPlatformPriorsJob` (~line 285). It is flag-gated *inside* `runSentRecStalenessScan` per workspace, so an unconditional wrapper is correct — workspaces without the flag are skipped:

```ts
  // ── Strategy v3 P3 — sent-rec staleness scan (24h). ──
  // Thin cron wrapper around runSentRecStalenessScan: derives stale_sent / superseded nudges
  // from the persisted rec sets (no crawl, no AI) and writes deduplicated admin-only activity.
  // Per-workspace flag-gated INSIDE the scan ('strategy-staleness-scan') — flag OFF = no-op for
  // that workspace. Loaded via dynamic import so the cron module doesn't pull recommendation
  // transitive deps at startup.
  const runStalenessScanJob = async () => {
    try {
      const { runSentRecStalenessScan }: typeof RecommendationStaleness = await import('./recommendation-staleness.js'); // dynamic-import-ok
      const result = runSentRecStalenessScan();
      log.info(
        { workspacesScanned: result.workspacesScanned, nudgesWritten: result.nudgesWritten },
        'Sent-rec staleness scan cron complete',
      );
    } catch (err) {
      log.error({ err }, 'Sent-rec staleness scan cron failed');
    }
  };
```

4. Add the startup timeout (after the `runPlatformPriorsJob` 60s entry, ~line 299) and the interval (after `platformPriorsInterval`, ~line 310):

```ts
    setTimeout(() => void runPlatformPriorsJob(), 60_000),
    setTimeout(() => void runStalenessScanJob(), 65_000),
  ];
```

```ts
  platformPriorsInterval = setInterval(() => void runPlatformPriorsJob(), WEEKLY_MS);
  stalenessScanInterval = setInterval(() => void runStalenessScanJob(), DAILY_MS);
```

5. Add the teardown in `stopOutcomeCrons` (after the `platformPriorsInterval` clear + null, ~line 329 and ~line 339):

```ts
  if (platformPriorsInterval) clearInterval(platformPriorsInterval);
  if (stalenessScanInterval) clearInterval(stalenessScanInterval);
```

```ts
  platformPriorsInterval = null;
  stalenessScanInterval = null;
```

6. Verify it compiles and builds:

```
npm run typecheck && npx vite build
```

Expected: zero errors, build succeeds.

7. Commit:

```
git add server/outcome-crons.ts
git commit -m "Strategy v3 P3 — register sent-rec staleness scan in the 24h outcome-crons tick"
```

#### Task S.9: Write `ClientSignalsSlice.recResponses` in `assembleClientSignals` (failing test)

**Files:** `tests/unit/client-signals-rec-responses.test.ts` (NEW)

1. Create a unit test seeding a workspace with recs in approved/declined/discussing states and asserting the assembled slice's `recResponses` counts (the field was declared in contract §7; this lane writes it):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { saveRecommendations } from '../../server/recommendations.js';
import { assembleClientSignals } from '../../server/intelligence/client-signals-slice.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

describe('assembleClientSignals — recResponses', () => {
  let wsId: string;
  let cleanup: () => void;

  beforeAll(() => {
    const seeded = seedWorkspace({ name: 'RecResponses WS' });
    wsId = seeded.workspaceId;
    cleanup = seeded.cleanup;
    const at = new Date().toISOString();
    const mk = (id: string, clientStatus: Recommendation['clientStatus']): Recommendation => ({
      id, type: 'content_decay', title: `Rec ${id}`, description: 'd', insight: 'i',
      severity: 'medium', affectedPages: [], source: 'test',
      clientStatus, status: 'pending', createdAt: at,
    } as Recommendation);
    saveRecommendations({ workspaceId: wsId, generatedAt: at, recommendations: [
      mk('a', 'approved'), mk('b', 'approved'), mk('c', 'declined'), mk('d', 'discussing'), mk('e', 'sent'),
    ], summary: {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0,
      totalOpportunityValue: 0, actionableOpportunityValue: 0, topRecommendationId: null,
    } });
  });

  afterAll(() => cleanup());

  it('counts approved/declined/discussing and lists recent responses', async () => {
    const slice = await assembleClientSignals(wsId);
    expect(slice.recResponses).toMatchObject({ approved: 2, declined: 1, discussing: 1 });
    expect(slice.recResponses!.recentResponses.length).toBe(4); // approved+declined+discussing, not 'sent'
    expect(slice.recResponses!.recentResponses[0]).toHaveProperty('clientStatus');
  });
});
```

2. Run it, see it fail (`recResponses` is `undefined`):

```
npx vitest run tests/unit/client-signals-rec-responses.test.ts
```

Expected: red (`expect(undefined).toMatchObject(...)`).

#### Task S.10: Implement the `recResponses` read

**Files:** `server/intelligence/client-signals-slice.ts` (modify)

1. Add the import for the rec loader at the top, grouped with the existing imports (after `import { readOptionalSlicePart } from './optional-slice-part.js';`):

```ts
import { readOptionalSlicePart } from './optional-slice-part.js';
import { loadRecommendations } from '../recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';
```

2. Add the `recResponses` assembly block immediately after the existing `clientActions` block (after the block ending ~line 545, before the `return {` at ~line 547):

```ts
  // Strategy v3 (spec §7.5, data-flow rule #6) — the client's responses to SENT curated recs.
  // Counts derive from Recommendation.clientStatus across the rec set; surfaced so AdminChat/
  // strategy "see the loop". Degrades to undefined if the rec set is unavailable.
  const recResponses = await readOptionalSlicePart<ClientSignalsSlice['recResponses']>(
    'assembleClientSignals: rec responses',
    workspaceId,
    undefined,
    () => {
      const set = loadRecommendations(workspaceId);
      const recs: Recommendation[] = set?.recommendations ?? [];
      const responded = recs.filter(
        r => r.clientStatus === 'approved' || r.clientStatus === 'declined' || r.clientStatus === 'discussing',
      );
      if (responded.length === 0
        && !recs.some(r => r.clientStatus === 'approved' || r.clientStatus === 'declined' || r.clientStatus === 'discussing')) {
        // No responses at all — return zeroed shape (not undefined) so consumers can render "0 responses".
      }
      const recentResponses = [...responded]
        .sort((a, b) => Date.parse(b.sentAt ?? b.createdAt) - Date.parse(a.sentAt ?? a.createdAt))
        .slice(0, 5)
        .map(r => ({
          title: r.title,
          clientStatus: r.clientStatus ?? 'sent',
          respondedAt: r.sentAt ?? r.createdAt,
        }));
      return {
        approved: responded.filter(r => r.clientStatus === 'approved').length,
        declined: responded.filter(r => r.clientStatus === 'declined').length,
        discussing: responded.filter(r => r.clientStatus === 'discussing').length,
        recentResponses,
      };
    },
    { logger: log },
  );
```

> Simplify: drop the empty `if` placeholder block above — it documents intent but the mapper already returns a zeroed shape whenever `responded` is empty. Keep only the `recentResponses` + return object.

3. Add `recResponses` to the returned object (in the `return { ... }` at the end, after `clientActions,`):

```ts
    latestBriefing,
    clientActions,
    recResponses,
  };
```

4. Run the test, see it pass:

```
npx vitest run tests/unit/client-signals-rec-responses.test.ts
```

Expected: 1 passed (green).

5. Commit:

```
git add server/intelligence/client-signals-slice.ts tests/unit/client-signals-rec-responses.test.ts
git commit -m "Strategy v3 P3 — write ClientSignalsSlice.recResponses in assembleClientSignals (data-flow rule #6)"
```

#### Task S.11: Add `recResponses` to the admin workspace-overview payload (failing test)

**Files:** `tests/integration/workspace-overview-rec-responses.test.ts` (NEW)

1. Create an integration test hitting `GET /api/workspace-overview` and asserting the seeded workspace's row carries a `recResponses` block:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from '../integration/helpers.js';
import { saveRecommendations } from '../../server/recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

describe('GET /api/workspace-overview — recResponses', () => {
  const ctx = createEphemeralTestContext(import.meta.url);
  let wsId: string;

  beforeAll(async () => {
    await ctx.start();
    wsId = (await ctx.createWorkspace({ name: 'Overview RecResponses WS' })).id;
    const at = new Date().toISOString();
    const recs: Recommendation[] = [
      { id: 'a', type: 'content_decay', title: 'A', description: 'd', insight: 'i', severity: 'low',
        affectedPages: [], source: 't', clientStatus: 'approved', status: 'pending', createdAt: at } as Recommendation,
      { id: 'b', type: 'content_decay', title: 'B', description: 'd', insight: 'i', severity: 'low',
        affectedPages: [], source: 't', clientStatus: 'discussing', status: 'pending', createdAt: at } as Recommendation,
    ];
    saveRecommendations({ workspaceId: wsId, generatedAt: at, recommendations: recs, summary: {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0,
      totalOpportunityValue: 0, actionableOpportunityValue: 0, topRecommendationId: null,
    } });
  });

  afterAll(async () => { await ctx.stop(); });

  it('includes recResponses counts on the workspace row', async () => {
    const res = await ctx.adminGet('/api/workspace-overview');
    expect(res.status).toBe(200);
    const row = (res.body as Array<{ id: string; recResponses?: { approved: number; discussing: number } }>)
      .find(w => w.id === wsId);
    expect(row?.recResponses).toMatchObject({ approved: 1, discussing: 1 });
  });
});
```

> Adapt `ctx.start()/createWorkspace/adminGet/stop` to the exact `createEphemeralTestContext` API surface — read `tests/integration/helpers.ts` first for the real method names (the existing overview tests are the closest reference). The assertion (row carries `recResponses`) is the load-bearing part.

2. Run it, see it fail (no `recResponses` on the row):

```
npx vitest run tests/integration/workspace-overview-rec-responses.test.ts
```

Expected: red (`row?.recResponses` is `undefined`).

#### Task S.12: Implement the overview `recResponses` aggregation

**Files:** `server/routes/workspaces.ts` (modify)

1. Add the rec loader import alongside the existing imports at the top (group with the other `server/` imports — read the existing import block first; add to it):

```ts
import { loadRecommendations } from '../recommendations.js';
```

2. Inside the `overview = workspaces.map(ws => { ... })` body, after the `clientActions` aggregation (~line 181, after the `try { ... summarizeClientActions ... }` block), add:

```ts
    // Strategy v3 P3 — client responses to sent recs (counts for the NotificationBell entry).
    let recApproved = 0;
    let recDeclined = 0;
    let recDiscussing = 0;
    try {
      const recSet = loadRecommendations(ws.id);
      for (const r of recSet?.recommendations ?? []) {
        if (r.clientStatus === 'approved') recApproved++;
        else if (r.clientStatus === 'declined') recDeclined++;
        else if (r.clientStatus === 'discussing') recDiscussing++;
      }
    } catch (err) { if (isProgrammingError(err)) log.warn({ err }, 'workspaces: programming error'); /* non-critical */ }
```

3. Add the `recResponses` block to the returned object (after `clientActions: { ... },` ~line 219):

```ts
      clientActions: {
        approved: clientActionApproved,
        changesRequested: clientActionChangesRequested,
      },
      recResponses: {
        approved: recApproved,
        declined: recDeclined,
        discussing: recDiscussing,
      },
```

4. Run the test, see it pass:

```
npx vitest run tests/integration/workspace-overview-rec-responses.test.ts
```

Expected: 1 passed (green).

5. Commit:

```
git add server/routes/workspaces.ts tests/integration/workspace-overview-rec-responses.test.ts
git commit -m "Strategy v3 P3 — surface recResponses counts on the admin workspace-overview payload"
```

#### Task S.13: Bulk lifecycle endpoint `POST /api/recommendations/:workspaceId/bulk` (failing test)

**Files:** `tests/integration/recommendation-bulk-admin.test.ts` (NEW)

> See the cross-track note at the top of the phase: P3-Lane Server owns `server/routes/recommendations.ts` for this single addition (P2 fully merged). The endpoint accepts `{ recIds: string[], action: 'send' | 'throttle' | 'strike', throttleDays?: 7|30|90, note?: string, confirmStrike?: boolean }` and applies all N via the Phase-1 single-writer inside ONE transaction.

1. Create the integration test (seed 3 recs, bulk-throttle 2, assert both flipped and one untouched, and assert bulk-strike requires `confirmStrike`):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from '../integration/helpers.js';
import { saveRecommendations, loadRecommendations } from '../../server/recommendations.js';
import type { Recommendation } from '../../shared/types/recommendations.js';

describe('POST /api/recommendations/:workspaceId/bulk', () => {
  const ctx = createEphemeralTestContext(import.meta.url);
  let wsId: string;

  beforeAll(async () => {
    await ctx.start();
    wsId = (await ctx.createWorkspace({ name: 'Bulk WS' })).id;
    const at = new Date().toISOString();
    const mk = (id: string): Recommendation => ({
      id, type: 'content_decay', title: id, description: 'd', insight: 'i', severity: 'low',
      affectedPages: [], source: 't', clientStatus: 'system', lifecycle: 'active', status: 'pending', createdAt: at,
    } as Recommendation);
    saveRecommendations({ workspaceId: wsId, generatedAt: at, recommendations: [mk('r1'), mk('r2'), mk('r3')], summary: {
      fixNow: 0, fixSoon: 0, fixLater: 0, ongoing: 0, totalImpactScore: 0, trafficAtRisk: 0,
      totalOpportunityValue: 0, actionableOpportunityValue: 0, topRecommendationId: null,
    } });
  });

  afterAll(async () => { await ctx.stop(); });

  it('bulk-throttles N recs in one transaction', async () => {
    const res = await ctx.adminPost(`/api/recommendations/${wsId}/bulk`, {
      recIds: ['r1', 'r2'], action: 'throttle', throttleDays: 30,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ modified: 2 });
    const set = loadRecommendations(wsId)!;
    expect(set.recommendations.find(r => r.id === 'r1')!.lifecycle).toBe('throttled');
    expect(set.recommendations.find(r => r.id === 'r3')!.lifecycle).toBe('active');
  });

  it('rejects a bulk strike without confirmStrike (arm-then-confirm)', async () => {
    const res = await ctx.adminPost(`/api/recommendations/${wsId}/bulk`, {
      recIds: ['r3'], action: 'strike',
    });
    expect(res.status).toBe(400);
  });
});
```

> Adapt `ctx.adminPost` to the real helper name (read `tests/integration/helpers.ts`).

2. Run it, see it fail (route 404s):

```
npx vitest run tests/integration/recommendation-bulk-admin.test.ts
```

Expected: red (404 / route not found).

#### Task S.14: Implement the bulk endpoint via the single-writer + one transaction

**Files:** `server/routes/recommendations.ts` (modify)

1. Read the file's import block and the per-row routes P2 added (`applyRecLifecycle` or the named single-writer exports from `server/recommendation-lifecycle.ts`). Add the Zod schema + route. Add to the existing imports at the top:

```ts
import { z, validate } from '../middleware/validate.js';
import db from '../db/index.js';
import { applyRecLifecycleTransition } from '../recommendation-lifecycle.js';
```

> `applyRecLifecycleTransition` is the Phase-1 single-writer export (contract §11 / P1-Lane 1B). Confirm its exact exported name and signature in `server/recommendation-lifecycle.ts` before authoring — it takes `(workspaceId, recId, transition, opts)` and returns the mutated rec. If P1/P2 named the per-action writers differently (`sendRec`/`throttleRec`/`strikeRec`), call those instead; the bulk loop is a thin wrapper either way.

2. Add the route, placed immediately after the existing `undismiss` route (~line 333). It validates, then wraps all N transitions in a single `db.transaction`:

```ts
const bulkRecActionSchema = z.object({
  recIds: z.array(z.string()).min(1).max(200),
  action: z.enum(['send', 'throttle', 'strike']),
  throttleDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  note: z.string().max(2000).optional(),
  confirmStrike: z.boolean().optional(),
});

router.post(
  '/api/recommendations/:workspaceId/bulk',
  requireWorkspaceAccess('workspaceId'),
  validate({ body: bulkRecActionSchema }),
  (req, res) => {
    const { workspaceId } = req.params;
    const { recIds, action, throttleDays, note, confirmStrike } = req.body as z.infer<typeof bulkRecActionSchema>;

    // Bulk Strike still arm-then-confirms (spec §4.4) — refuse without explicit confirmation.
    if (action === 'strike' && !confirmStrike) {
      return res.status(400).json({ error: 'Bulk strike requires confirmStrike' });
    }
    if (action === 'throttle' && !throttleDays) {
      return res.status(400).json({ error: 'Throttle requires throttleDays (7, 30, or 90)' });
    }

    // ONE transaction over all N (spec §4.4) — the single-writer re-reads the set inside
    // the txn per rec; wrapping the whole batch makes the bulk apply atomic.
    let modified = 0;
    const apply = db.transaction(() => {
      for (const recId of recIds) {
        const result = applyRecLifecycleTransition(workspaceId, recId, action, {
          throttleDays, note, source: 'bulk',
        });
        if (result) modified++;
      }
    });
    apply();

    return res.json({ modified });
  },
);
```

> **Do NOT** manually `broadcastToWorkspace` or `addActivity` here — the single-writer `applyRecLifecycleTransition` already broadcasts `RECOMMENDATIONS_UPDATED` and logs the per-rec `rec_sent`/`rec_throttled`/`rec_struck` activity (contract §4, bridge-authoring rule #3). The bulk route is a pure transactional fan-out. If the single-writer broadcasts per-call (N broadcasts), that is acceptable at bulk scale; if P1/P2 exposed a `broadcast: false` opt, pass it and emit one broadcast after the txn.

3. Run the test, see it pass:

```
npx vitest run tests/integration/recommendation-bulk-admin.test.ts
```

Expected: 2 passed (green).

4. Verify the whole lane compiles + pr-check clean:

```
npm run typecheck && npx tsx scripts/pr-check.ts
```

Expected: zero errors (the `db.transaction` wrapper satisfies the "multi-step DB writes inside a transaction" pr-check rule).

5. Commit:

```
git add server/routes/recommendations.ts tests/integration/recommendation-bulk-admin.test.ts
git commit -m "Strategy v3 P3 — bulk lifecycle endpoint: one transaction, single-writer fan-out, arm-then-confirm strike"
```

---

### Lane Bulk-UI (sonnet) — predicate selection + sticky bar + bulk mutation hook

**Blocked by:** Phase 2 cockpit merge (this lane mounts into the P2 `StrategyCockpit.tsx` list and reads its `cockpitRowModel` shape) + the Phase-1 lifecycle endpoints (P3-Lane Server's bulk endpoint — author against the contract above, sequence the integration after S.14 merges within the PR). Exclusive files: `src/components/strategy/CurationBulkActionBar.tsx` (NEW), `src/components/strategy/hooks/useCurationSelection.ts` (NEW), `src/hooks/admin/useRecBulkMutation.ts` (NEW), `src/hooks/admin/useAdminRecommendations.ts` (modify). Model the bar on `src/components/keyword-command-center/KeywordBulkActionBar.tsx` (NOT the SEO-editor `BulkOperations`).

> **Predicate selection (spec §4.4, audit shared-utility #8):** `select-all-in-filter` is a **predicate** — a filter descriptor + an explicit exclusion set — NOT N mounted checkbox booleans. This lets "apply to all 144 matching" coexist with the cap-at-8 rendered view without virtualization. The hook holds either an explicit id `Set` (manual picks) OR a `{ allInFilter: true, excluded: Set }` mode.

#### Task B.1: `useCurationSelection` predicate hook (failing test)

**Files:** `tests/unit/strategy/useCurationSelection.test.ts` (NEW)

1. Create the test (the hook is pure-state; test via `@testing-library/react`'s `renderHook`):

```ts
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCurationSelection } from '../../../src/components/strategy/hooks/useCurationSelection';

const allIds = ['r1', 'r2', 'r3', 'r4'];

describe('useCurationSelection', () => {
  it('toggles individual ids and reports selectedCount', () => {
    const { result } = renderHook(() => useCurationSelection(allIds));
    act(() => result.current.toggle('r1'));
    act(() => result.current.toggle('r3'));
    expect(result.current.selectedCount).toBe(2);
    expect(result.current.isSelected('r1')).toBe(true);
    expect(result.current.isSelected('r2')).toBe(false);
  });

  it('select-all-in-filter is a predicate, not N ids — selectedCount = total minus exclusions', () => {
    const { result } = renderHook(() => useCurationSelection(allIds));
    act(() => result.current.selectAllInFilter());
    expect(result.current.selectedCount).toBe(4);
    act(() => result.current.toggle('r2')); // exclude one from the all-selection
    expect(result.current.selectedCount).toBe(3);
    expect(result.current.isSelected('r2')).toBe(false);
  });

  it('resolveSelectedIds returns concrete ids from either mode', () => {
    const { result } = renderHook(() => useCurationSelection(allIds));
    act(() => result.current.selectAllInFilter());
    act(() => result.current.toggle('r4'));
    expect(result.current.resolveSelectedIds().sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('clear resets to empty', () => {
    const { result } = renderHook(() => useCurationSelection(allIds));
    act(() => result.current.selectAllInFilter());
    act(() => result.current.clear());
    expect(result.current.selectedCount).toBe(0);
  });
});
```

2. Run it, see it fail (module missing):

```
npx vitest run tests/unit/strategy/useCurationSelection.test.ts
```

Expected: red (`Failed to resolve import`).

#### Task B.2: Implement `useCurationSelection`

**Files:** `src/components/strategy/hooks/useCurationSelection.ts` (NEW)

1. Create the hook. `filteredIds` is the id list of the currently-visible filtered set (the cockpit passes it in); the hook never assumes those ids are all mounted:

```ts
import { useCallback, useMemo, useState } from 'react';

type SelectionMode =
  | { kind: 'ids'; ids: Set<string> }
  | { kind: 'all-in-filter'; excluded: Set<string> };

export interface CurationSelection {
  selectedCount: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAllInFilter: () => void;
  clear: () => void;
  /** Concrete id list for the bulk mutation — resolved from whichever mode is active. */
  resolveSelectedIds: () => string[];
  /** True when select-all-in-filter is active (drives the "apply to all N matching" copy). */
  isAllInFilter: boolean;
}

/**
 * Predicate-based selection for the curation cockpit (spec §4.4, CLAUDE.md UI rule #9).
 * `select-all-in-filter` is a predicate (mode + exclusion set), NOT N mounted checkbox
 * booleans — so "apply to all 144 matching" coexists with the cap-at-8 rendered view.
 * `filteredIds` = the ids of the currently-filtered set (cockpit-provided, recomputed when
 * the filter changes). Toggling under all-in-filter ADDS to the exclusion set.
 */
export function useCurationSelection(filteredIds: string[]): CurationSelection {
  const [mode, setMode] = useState<SelectionMode>({ kind: 'ids', ids: new Set() });

  const isSelected = useCallback(
    (id: string) =>
      mode.kind === 'ids' ? mode.ids.has(id) : !mode.excluded.has(id),
    [mode],
  );

  const toggle = useCallback((id: string) => {
    setMode(prev => {
      if (prev.kind === 'ids') {
        const next = new Set(prev.ids);
        next.has(id) ? next.delete(id) : next.add(id);
        return { kind: 'ids', ids: next };
      }
      // all-in-filter: toggling means moving in/out of the exclusion set.
      const excluded = new Set(prev.excluded);
      excluded.has(id) ? excluded.delete(id) : excluded.add(id);
      return { kind: 'all-in-filter', excluded };
    });
  }, []);

  const selectAllInFilter = useCallback(() => {
    setMode({ kind: 'all-in-filter', excluded: new Set() });
  }, []);

  const clear = useCallback(() => {
    setMode({ kind: 'ids', ids: new Set() });
  }, []);

  const resolveSelectedIds = useCallback((): string[] => {
    if (mode.kind === 'ids') return [...mode.ids];
    return filteredIds.filter(id => !mode.excluded.has(id));
  }, [mode, filteredIds]);

  const selectedCount = useMemo(
    () => (mode.kind === 'ids' ? mode.ids.size : filteredIds.filter(id => !mode.excluded.has(id)).length),
    [mode, filteredIds],
  );

  return {
    selectedCount,
    isSelected,
    toggle,
    selectAllInFilter,
    clear,
    resolveSelectedIds,
    isAllInFilter: mode.kind === 'all-in-filter',
  };
}
```

2. Run the test, see it pass:

```
npx vitest run tests/unit/strategy/useCurationSelection.test.ts
```

Expected: 4 passed (green).

3. Commit:

```
git add src/components/strategy/hooks/useCurationSelection.ts tests/unit/strategy/useCurationSelection.test.ts
git commit -m "Strategy v3 P3 — useCurationSelection: predicate select-all-in-filter (not N checkboxes)"
```

#### Task B.3: `useRecBulkMutation` hook (failing test)

**Files:** `tests/unit/admin/useRecBulkMutation.test.tsx` (NEW)

1. Create a test that mocks the `post` API client and asserts the hook posts to the bulk endpoint and invalidates both rec query keys:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const postMock = vi.fn().mockResolvedValue({ modified: 2 });
vi.mock('../../../src/api/client.js', () => ({ post: (...a: unknown[]) => postMock(...a) }));

import { useRecBulkMutation } from '../../../src/hooks/admin/useRecBulkMutation';
import { queryKeys } from '../../../src/lib/queryKeys';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useRecBulkMutation', () => {
  beforeEach(() => postMock.mockClear());

  it('posts the bulk payload to the bulk endpoint', async () => {
    const { result } = renderHook(() => useRecBulkMutation('ws-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ recIds: ['r1', 'r2'], action: 'throttle', throttleDays: 30 });
    });
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(
      '/api/recommendations/ws-1/bulk',
      { recIds: ['r1', 'r2'], action: 'throttle', throttleDays: 30 },
    ));
  });

  it('exposes the queryKeys it invalidates for the cockpit', () => {
    expect(queryKeys.admin.recommendations('ws-1')).toEqual(['admin-recommendations', 'ws-1']);
  });
});
```

2. Run it, see it fail (module missing):

```
npx vitest run tests/unit/admin/useRecBulkMutation.test.tsx
```

Expected: red.

#### Task B.4: Implement `useRecBulkMutation`

**Files:** `src/hooks/admin/useRecBulkMutation.ts` (NEW)

1. Create the hook:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { post } from '../../api/client.js';
import { queryKeys } from '../../lib/queryKeys.js';

export interface BulkRecActionPayload {
  recIds: string[];
  action: 'send' | 'throttle' | 'strike';
  throttleDays?: 7 | 30 | 90;
  note?: string;
  confirmStrike?: boolean;
}

/**
 * Bulk lifecycle mutation for the curation cockpit (spec §4.4). Posts ALL N recIds to the
 * single bulk endpoint, which applies them in ONE server-side transaction via the Phase-1
 * single-writer — NOT N independent client requests. Bulk Strike still arm-then-confirms
 * (the caller passes confirmStrike:true only after the inline confirm). Invalidates both the
 * admin and shared rec caches so the cockpit + any public read refetch.
 */
export function useRecBulkMutation(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BulkRecActionPayload): Promise<{ modified: number }> =>
      post<{ modified: number }>(`/api/recommendations/${workspaceId}/bulk`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.recommendations(workspaceId) });
      qc.invalidateQueries({ queryKey: queryKeys.shared.recommendations(workspaceId) });
    },
  });
}
```

2. Run the test, see it pass:

```
npx vitest run tests/unit/admin/useRecBulkMutation.test.tsx
```

Expected: 2 passed (green).

3. Commit:

```
git add src/hooks/admin/useRecBulkMutation.ts tests/unit/admin/useRecBulkMutation.test.tsx
git commit -m "Strategy v3 P3 — useRecBulkMutation: single-transaction bulk via the bulk endpoint"
```

#### Task B.5: `CurationBulkActionBar` sticky bar (failing test)

**Files:** `tests/component/strategy/CurationBulkActionBar.test.tsx` (NEW)

1. Create a component test: bar hidden at 0 selected, shows count + fires actions, and bulk Strike arms-then-confirms (does not fire `onAction('strike')` on the first click):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CurationBulkActionBar } from '../../../src/components/strategy/CurationBulkActionBar';

describe('CurationBulkActionBar', () => {
  const base = { selectedCount: 0, isAllInFilter: false, isPending: false, onAction: vi.fn(), onClear: vi.fn() };

  it('renders nothing at zero selection', () => {
    const { container } = render(<CurationBulkActionBar {...base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the selected count and fires send/throttle', () => {
    const onAction = vi.fn();
    render(<CurationBulkActionBar {...base} selectedCount={3} onAction={onAction} />);
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send 3/i }));
    expect(onAction).toHaveBeenCalledWith('send');
  });

  it('arm-then-confirms bulk strike — first click does NOT fire strike', () => {
    const onAction = vi.fn();
    render(<CurationBulkActionBar {...base} selectedCount={2} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: /strike 2/i }));
    expect(onAction).not.toHaveBeenCalledWith('strike');
    fireEvent.click(screen.getByRole('button', { name: /confirm strike/i }));
    expect(onAction).toHaveBeenCalledWith('strike');
  });
});
```

2. Run it, see it fail (module missing):

```
npx vitest run tests/component/strategy/CurationBulkActionBar.test.tsx
```

Expected: red.

#### Task B.6: Implement `CurationBulkActionBar`

**Files:** `src/components/strategy/CurationBulkActionBar.tsx` (NEW)

1. Create the bar, modeled on `KeywordBulkActionBar` (same fixed/sticky shell, tokens, `<Button>`). Throttle days are chosen via a small inline 7/30/90 segmented set; Strike arms an inline confirm. Colors follow the Four Laws (teal primary, danger red for strike confirm):

```tsx
import { useState } from 'react';
import { Send, Pause, XCircle, X } from 'lucide-react';

import { Button } from '../ui';

export type BulkAction = 'send' | 'throttle' | 'strike';

interface CurationBulkActionBarProps {
  selectedCount: number;
  isAllInFilter: boolean;
  isPending: boolean;
  /** Throttle passes the chosen day count; send/strike pass undefined. */
  onAction: (action: BulkAction, throttleDays?: 7 | 30 | 90) => void;
  onClear: () => void;
}

export function CurationBulkActionBar({
  selectedCount,
  isAllInFilter,
  isPending,
  onAction,
  onClear,
}: CurationBulkActionBarProps) {
  const [throttleOpen, setThrottleOpen] = useState(false);
  const [strikeArmed, setStrikeArmed] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-[var(--z-dropdown)] pointer-events-none">
      <div
        role="toolbar"
        aria-label="Selected recommendation bulk actions"
        className="mx-auto w-[min(960px,calc(100%-2rem))] pointer-events-auto rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ boxShadow: 'var(--brand-shadow-md)' }}
      >
        <div className="min-w-0">
          <p className="t-caption font-semibold text-[var(--brand-text-bright)]">
            {selectedCount} selected{isAllInFilter ? ' (all matching)' : ''}
          </p>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            Bulk changes apply in one step. Strike still confirms before suppressing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={Send}
            disabled={isPending}
            onClick={() => onAction('send')}
          >
            Send {selectedCount}
          </Button>

          {throttleOpen ? (
            <div className="flex items-center gap-1" role="group" aria-label="Throttle duration">
              {([7, 30, 90] as const).map(days => (
                <Button
                  key={days}
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => { onAction('throttle', days); setThrottleOpen(false); }}
                >
                  {days}d
                </Button>
              ))}
              <Button size="sm" variant="ghost" icon={X} onClick={() => setThrottleOpen(false)} aria-label="Cancel throttle" />
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              icon={Pause}
              disabled={isPending}
              onClick={() => setThrottleOpen(true)}
            >
              Throttle {selectedCount}
            </Button>
          )}

          {strikeArmed ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="danger"
                icon={XCircle}
                disabled={isPending}
                onClick={() => { onAction('strike'); setStrikeArmed(false); }}
              >
                Confirm strike {selectedCount}
              </Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => setStrikeArmed(false)} aria-label="Cancel strike" />
            </div>
          ) : (
            <Button
              size="sm"
              variant="danger"
              icon={XCircle}
              disabled={isPending}
              onClick={() => setStrikeArmed(true)}
            >
              Strike {selectedCount}
            </Button>
          )}

          <Button size="sm" variant="ghost" icon={X} disabled={isPending} onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
```

2. Run the test, see it pass:

```
npx vitest run tests/component/strategy/CurationBulkActionBar.test.tsx
```

Expected: 3 passed (green).

3. Commit:

```
git add src/components/strategy/CurationBulkActionBar.tsx tests/component/strategy/CurationBulkActionBar.test.tsx
git commit -m "Strategy v3 P3 — CurationBulkActionBar: sticky bar, 7/30/90 throttle picker, arm-then-confirm strike"
```

#### Task B.7: Expose `filteredIds` from `useAdminRecommendations` for predicate selection

**Files:** `src/hooks/admin/useAdminRecommendations.ts` (modify)

> The cockpit needs the id list of the currently-filtered, `isActiveRec`-eligible recs to feed `useCurationSelection(filteredIds)`. The existing `useAdminRecommendationSet` returns the whole set; add a thin selector hook so the cockpit does not recompute the id list inline.

1. Append a selector hook below `useAdminUndismissRecommendation`:

```ts
/**
 * Derives the ordered id list of a workspace's recommendations for predicate selection
 * (Strategy v3 P3 — feeds useCurationSelection). Returns [] while loading. The cockpit
 * narrows this to the active filter before passing it to the selection hook; this hook is
 * intentionally filter-agnostic (it returns ALL rec ids in set order) so the cockpit owns
 * the filter predicate in one place.
 */
export function useAdminRecommendationIds(workspaceId: string | undefined): string[] {
  const { data } = useAdminRecommendationSet(workspaceId, { enabled: !!workspaceId });
  return (data?.recommendations ?? []).map(r => r.id);
}
```

2. Verify it compiles + the existing hook tests still pass:

```
npm run typecheck && npx vitest run tests/unit/admin/useRecBulkMutation.test.tsx
```

Expected: zero type errors, 2 passed.

3. Commit:

```
git add src/hooks/admin/useAdminRecommendations.ts
git commit -m "Strategy v3 P3 — useAdminRecommendationIds selector for predicate curation selection"
```

> **Integration note (no new file):** the actual wiring of `CurationBulkActionBar` + `useCurationSelection` + `useRecBulkMutation` INTO `StrategyCockpit.tsx` is owned by P2-Lane B's component surface and is performed in the Phase-3 PR as a `StrategyCockpit.tsx` edit. Because `StrategyCockpit.tsx` is a Track-B-internal file and P2 has merged, the controller applies that mount as a small follow-on edit after B.1–B.7 land — it reads `useAdminRecommendationIds`, passes the filtered slice to `useCurationSelection`, renders per-row checkboxes (driven by `isSelected`) + a "Select all N matching" affordance, and mounts `<CurationBulkActionBar onAction={(a, d) => bulk.mutate({ recIds: sel.resolveSelectedIds(), action: a, throttleDays: d, confirmStrike: a === 'strike' })} />`. Keep this edit in the same commit as the barrel export below.

---

### Lane Attention-UI (sonnet) — NeedsAttentionStrip + CurationMeter + NotificationBell wiring

**Blocked by:** Phase 2 cockpit merge (the strip + meter mount into the cockpit header) **AND** P3-Lane Server's `recResponses` overview payload (the NotificationBell entry reads it). Within Phase 3, sequence the NotificationBell task (AT.5) after Lane Server's S.12 lands. Exclusive files: `src/components/strategy/NeedsAttentionStrip.tsx` (NEW), `src/components/strategy/CurationMeter.tsx` (NEW), `src/hooks/admin/useNotifications.ts` (modify).

> **Name discipline (audit):** the strip is `NeedsAttentionStrip` — a DISTINCT concept from the existing `StrategyStalenessNudges.tsx` (which warns about strategy-vs-local-data staleness, unrelated). Do not rename, merge, or import the existing component.

#### Task AT.1: `NeedsAttentionStrip` presentational component (failing test)

**Files:** `tests/component/strategy/NeedsAttentionStrip.test.tsx` (NEW)

1. Create the test — the strip renders one row per attention item with a real action button (spec §4.5: "Nudge actions are real buttons, not bracketed text"), and renders nothing when empty:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NeedsAttentionStrip } from '../../../src/components/strategy/NeedsAttentionStrip';

describe('NeedsAttentionStrip', () => {
  it('renders nothing when there are no attention items', () => {
    const { container } = render(<NeedsAttentionStrip items={[]} onAct={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per item with a real action button', () => {
    const onAct = vi.fn();
    render(
      <NeedsAttentionStrip
        items={[
          { recId: 'r1', title: 'Old sent rec', kind: 'stale_sent', detail: 'No response in 20 days' },
          { recId: 'r2', title: 'Replaced rec', kind: 'superseded', detail: 'A newer rec covers /pricing' },
          { recId: 'r3', title: 'New client reply', kind: 'new_reply', detail: 'Client asked a question' },
        ]}
        onAct={onAct}
      />,
    );
    expect(screen.getByText(/Needs your attention/i)).toBeInTheDocument();
    expect(screen.getByText('Old sent rec')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /review/i })[0]);
    expect(onAct).toHaveBeenCalledWith('r1', 'stale_sent');
  });
});
```

2. Run it, see it fail (module missing):

```
npx vitest run tests/component/strategy/NeedsAttentionStrip.test.tsx
```

Expected: red.

#### Task AT.2: Implement `NeedsAttentionStrip`

**Files:** `src/components/strategy/NeedsAttentionStrip.tsx` (NEW)

1. Create the strip. It uses the amber warning surface used elsewhere, `<SectionCard>` shell, and a real `<Button>` per row. Three kinds: `stale_sent`, `superseded`, `new_reply` (aggregated across statuses per spec §4.5):

```tsx
import { AlertTriangle, Send, RefreshCw, MessageSquare } from 'lucide-react';

import { SectionCard, Button, Icon } from '../ui';

export type AttentionKind = 'stale_sent' | 'superseded' | 'new_reply';

export interface AttentionItem {
  recId: string;
  title: string;
  kind: AttentionKind;
  detail: string;
}

interface NeedsAttentionStripProps {
  items: AttentionItem[];
  /** Jump the operator to the rec in the cockpit list (and, for new_reply, the discuss thread). */
  onAct: (recId: string, kind: AttentionKind) => void;
}

const KIND_META: Record<AttentionKind, { icon: typeof Send; cta: string }> = {
  stale_sent: { icon: Send, cta: 'Review' },
  superseded: { icon: RefreshCw, cta: 'Review' },
  new_reply: { icon: MessageSquare, cta: 'Open reply' },
};

export function NeedsAttentionStrip({ items, onAct }: NeedsAttentionStripProps) {
  if (items.length === 0) return null;

  return (
    <SectionCard>
      <div className="flex items-center gap-2 mb-3">
        <Icon as={AlertTriangle} size="md" className="text-accent-warning" />
        <h3 className="t-h2 text-[var(--brand-text-bright)]">
          Needs your attention · {items.length}
        </h3>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map(item => {
          const meta = KIND_META[item.kind];
          return (
            <li
              key={`${item.recId}-${item.kind}`}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)] px-3 py-2"
            >
              <div className="flex items-start gap-2 min-w-0">
                <Icon as={meta.icon} size="sm" className="text-[var(--brand-text-muted)] mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="t-caption font-medium text-[var(--brand-text-bright)] truncate">{item.title}</p>
                  <p className="t-caption-sm text-[var(--brand-text-muted)] truncate">{item.detail}</p>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => onAct(item.recId, item.kind)}>
                {meta.cta}
              </Button>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
```

> `bg-[var(--surface-3)]` for the inner row inside the `SectionCard` (which is surface-2) — surface-3 is lighter so the inner row is visible (MEMORY: surface-in-surface invisibility). `t-caption-sm` carries no color, so an explicit `text-[var(--brand-text-muted)]` is added.

2. Run the test, see it pass:

```
npx vitest run tests/component/strategy/NeedsAttentionStrip.test.tsx
```

Expected: 2 passed (green).

3. Commit:

```
git add src/components/strategy/NeedsAttentionStrip.tsx tests/component/strategy/NeedsAttentionStrip.test.tsx
git commit -m "Strategy v3 P3 — NeedsAttentionStrip: aggregated stale/superseded/new-reply nudges with real action buttons"
```

#### Task AT.3: `CurationMeter` header component (failing test)

**Files:** `tests/component/strategy/CurationMeter.test.tsx` (NEW)

1. Create the test — the meter shows the "this cycle" sent count + a qualitative health phrase, hidden when sent = 0:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CurationMeter } from '../../../src/components/strategy/CurationMeter';

describe('CurationMeter', () => {
  it('shows the curated count and a healthy phrase for a small set', () => {
    render(<CurationMeter sentThisCycle={4} />);
    expect(screen.getByText(/4 sent/i)).toBeInTheDocument();
    expect(screen.getByText(/healthy curated set/i)).toBeInTheDocument();
  });

  it('warns when over-sending', () => {
    render(<CurationMeter sentThisCycle={12} />);
    expect(screen.getByText(/12 sent/i)).toBeInTheDocument();
    expect(screen.getByText(/curate, don.t just send/i)).toBeInTheDocument();
  });

  it('renders nothing when nothing has been sent this cycle', () => {
    const { container } = render(<CurationMeter sentThisCycle={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

2. Run it, see it fail (module missing):

```
npx vitest run tests/component/strategy/CurationMeter.test.tsx
```

Expected: red.

#### Task AT.4: Implement `CurationMeter`

**Files:** `src/components/strategy/CurationMeter.tsx` (NEW)

1. Create the meter — a lean header pill framing *curate, don't just send* (spec §4.5). Teal for a healthy set, amber when over-sending:

```tsx
import { Sparkles } from 'lucide-react';

import { Icon } from '../ui';

interface CurationMeterProps {
  /** Recs sent to the client in the current curation cycle. */
  sentThisCycle: number;
}

/** A healthy curated set is a handful — past this the coachmark framing flips to a nudge. */
const HEALTHY_SEND_CEILING = 8;

export function CurationMeter({ sentThisCycle }: CurationMeterProps) {
  if (sentThisCycle === 0) return null;

  const overSending = sentThisCycle > HEALTHY_SEND_CEILING;
  const phrase = overSending ? 'curate, don’t just send' : 'a healthy curated set';
  const tone = overSending ? 'text-accent-warning' : 'text-teal-400';

  return (
    <div className="inline-flex items-center gap-1.5 rounded-[var(--radius-full)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-1">
      <Icon as={Sparkles} size="sm" className={tone} />
      <span className="t-caption text-[var(--brand-text-bright)]">{sentThisCycle} sent</span>
      <span className={`t-caption-sm ${tone}`}>· {phrase}</span>
    </div>
  );
}
```

2. Run the test, see it pass:

```
npx vitest run tests/component/strategy/CurationMeter.test.tsx
```

Expected: 3 passed (green).

3. Commit:

```
git add src/components/strategy/CurationMeter.tsx tests/component/strategy/CurationMeter.test.tsx
git commit -m "Strategy v3 P3 — CurationMeter: this-cycle send count + curate-dont-just-send framing"
```

#### Task AT.5: NotificationBell entry for client rec responses (failing test)

**Files:** `tests/unit/admin/useNotifications-recResponses.test.ts` (NEW)

> Sequence after Lane Server S.12 (the overview payload must carry `recResponses` first). This task reads it.

1. Create a test mocking `workspaceOverview.list()` to return a row with `recResponses` and asserting `fetchNotifications` produces a "client recommendation responses" item. Read the existing `useNotifications.ts` test patterns first; the hook's `fetchNotifications` is not exported, so test via the public hook with a mocked API:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const listMock = vi.fn();
vi.mock('../../../src/api/platform', () => ({ workspaceOverview: { list: () => listMock() } }));
vi.mock('../../../src/api/misc', () => ({
  anomalies: { listAll: () => Promise.resolve([]) },
  churnSignals: { list: () => Promise.resolve([]) },
}));

import { useNotifications } from '../../../src/hooks/admin/useNotifications';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useNotifications — rec responses', () => {
  beforeEach(() => listMock.mockReset());

  it('emits a notification for new client recommendation responses', async () => {
    listMock.mockResolvedValue([{
      id: 'ws-1', name: 'Acme', requests: { new: 0 }, approvals: { pending: 0 },
      recResponses: { approved: 2, declined: 0, discussing: 1 },
    }]);
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const item = result.current.data!.find(n => n.id === 'rec-responses-ws-1');
    expect(item).toBeDefined();
    expect(item!.label).toMatch(/3 client recommendation response/i);
    expect(item!.tab).toBe('seo-strategy');
  });
});
```

2. Run it, see it fail (no such notification item):

```
npx vitest run tests/unit/admin/useNotifications-recResponses.test.ts
```

Expected: red (`item` is `undefined`).

#### Task AT.6: Implement the NotificationBell rec-responses entry

**Files:** `src/hooks/admin/useNotifications.ts` (modify)

1. Extend the `WorkspaceSummary` interface (after `clientActions?: { ... };`):

```ts
  clientActions?: { approved?: number; changesRequested?: number };
  recResponses?: { approved?: number; declined?: number; discussing?: number };
```

2. Add the notification push inside the `for (const ws of workspaces)` loop, after the `clientActions.changesRequested` block (the last block before the loop closes). Use `MessageSquare` (already imported) and teal (client-driven positive signal):

```ts
    const recResponseTotal =
      (ws.recResponses?.approved || 0) + (ws.recResponses?.declined || 0) + (ws.recResponses?.discussing || 0);
    if (recResponseTotal > 0) {
      notifications.push({
        id: `rec-responses-${ws.id}`,
        label: `${recResponseTotal} client recommendation response${recResponseTotal === 1 ? '' : 's'}`,
        sub: ws.name,
        color: 'text-teal-400',
        icon: MessageSquare,
        workspaceId: ws.id,
        workspaceName: ws.name,
        tab: 'seo-strategy',
      });
    }
```

> `tab: 'seo-strategy'` deep-links the bell into the Strategy cockpit (the curation surface). Confirm `seo-strategy` is the current `Page` value in `src/routes.ts` before committing (the cockpit lives in Strategy → Overview); adjust the literal to the actual nav target if it differs.

3. Run the test, see it pass:

```
npx vitest run tests/unit/admin/useNotifications-recResponses.test.ts
```

Expected: 1 passed (green).

4. Commit:

```
git add src/hooks/admin/useNotifications.ts tests/unit/admin/useNotifications-recResponses.test.ts
git commit -m "Strategy v3 P3 — NotificationBell entry: N client recommendation responses"
```

#### Task AT.7: Export the new components from the strategy barrel

**Files:** `src/components/strategy/index.ts` (modify)

> The barrel is append-only within Track B (collision matrix: P2/P3 add, P5 reconciles via Lane 5F). Add the three new component exports.

1. Add after the existing exports (e.g. after `export * from './KeywordOpportunities';`):

```ts
export * from './NeedsAttentionStrip';
export * from './CurationMeter';
export * from './CurationBulkActionBar';
```

2. Verify the whole phase compiles, builds, full suite + pr-check pass:

```
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Expected: zero type errors, build succeeds, all tests pass, pr-check zero errors.

3. Commit:

```
git add src/components/strategy/index.ts
git commit -m "Strategy v3 P3 — barrel: export NeedsAttentionStrip, CurationMeter, CurationBulkActionBar"
```

---

## Phase exit gates

Run before opening the Phase-3 PR (all must be green):

- [ ] `npm run typecheck` — zero errors (`tsc -b`, both app + node configs).
- [ ] `npx vite build` — builds successfully.
- [ ] `npx vitest run` — full suite passes (not just the new tests).
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (the bulk endpoint's `db.transaction` wrapper satisfies the multi-step-DB-write rule; the cron writes through `addActivity` + `broadcastToWorkspace`, no inline WS string literals).
- [ ] `npm run verify:feature-flags` — `strategy-staleness-scan` stays grouped/cataloged (this phase consumes it; no new flags added).
- [ ] **Contract tests for this phase:**
  - `npx vitest run tests/unit/recommendation-staleness.test.ts` — classifier + supersession derivation (7 cases).
  - `npx vitest run tests/integration/recommendation-staleness-scan.test.ts` — flag-gated + **idempotent** (no duplicate nudge activity on re-scan).
  - `npx vitest run tests/unit/client-signals-rec-responses.test.ts` — `recResponses` counts assembled from `clientStatus`.
  - `npx vitest run tests/integration/workspace-overview-rec-responses.test.ts` — `recResponses` on the **real** overview payload.
  - `npx vitest run tests/integration/recommendation-bulk-admin.test.ts` — bulk applies in ONE transaction; bulk strike requires `confirmStrike`.
  - `npx vitest run tests/unit/strategy/useCurationSelection.test.ts` — predicate select-all (count = total − exclusions, not N booleans).
  - `npx vitest run tests/unit/admin/useRecBulkMutation.test.tsx` — posts the bulk payload, invalidates both rec caches.
  - `npx vitest run tests/component/strategy/CurationBulkActionBar.test.tsx` — sticky bar + arm-then-confirm strike.
  - `npx vitest run tests/component/strategy/NeedsAttentionStrip.test.tsx` — real action buttons, empty-state hides.
  - `npx vitest run tests/component/strategy/CurationMeter.test.tsx` — count + curate-don't-just-send framing.
  - `npx vitest run tests/unit/admin/useNotifications-recResponses.test.ts` — NotificationBell rec-responses entry.
- [ ] `FEATURE_AUDIT.md` + `data/roadmap.json` updated for the bulk + self-managing feature work (controller commits this per-lane; do not parallel-write git).
- [ ] Multi-agent batch → run `scaled-code-review` before merge; fix every surfaced bug in-PR (grep for duplicate `useCurationSelection`/staleness reimplementations across lanes).


---

## Phase 4 — client curated overview + respond spine (Stage 2 Track C, after P1 merge)

**Goal:** turn the client Home/Overview into the curated, narrative-controlled delivery surface from spec §5 — the client sees only `clientStatus='sent'` recs as a finite, decision-shaped "Needs your decision · N" set, grounded in their own proof and visibility score, and can Approve / Discuss / (where a product resolves) Add-to-plan on each one. **What merges before it:** Phase 0 (v2 cutover — the command-center is the flag-OFF baseline) and **Phase 1 Lane 1A–1D** (the locked contracts in `docs/superpowers/plans/parts/00-contracts.md`: lifecycle fields on `Recommendation`, `isActiveRec`, `CLIENT_REC_TRANSITIONS`, the four `rec_*` ActivityTypes, `RECOMMENDATIONS_DISCUSSION_UPDATED`, `ClientSignalsSlice.recResponses`, both queryKey namespaces, the `curated_recs_sent` email surface, the `RecDiscussionEntry` read-shape, the two child flags). Phase 4 runs **in parallel with Track B (P2→P3)**; on the shared-hot files (`server/routes/recommendations.ts`, `src/lib/queryKeys.ts`, `src/lib/wsInvalidation.ts`, `server/state-machines.ts`) Phase 4 only **appends** to its own (public / client) regions and **rebases onto P2's merge** (merge order P1→P2→P4). **The flag-gated exit gate:** with `strategy-command-center` ON, the client overview renders `CuratedOverview` (curated read + respond + discuss + tier-driven CTAs + quiet/empty tri-state); with the flag OFF the public read is **byte-identical** and the overview body is unchanged. All boxes in "Phase exit gates" below are green before Phase 4 merges to `staging`.

> **Locked decisions threaded through this phase (from `00-contracts.md`):** `clientStatus` is a SEPARATE axis from `RecStatus` — the client respond route mutates ONLY `clientStatus` and validates ONLY against `CLIENT_REC_TRANSITIONS`, never `RecStatus`. `requireClientOwner` gates spend (multiple owners allowed — checks "is an owner," not "is the sole owner"). `Add·$` renders ONLY where `rec.productType` already resolves. The `curated_recs_sent` email is built in **Phase 2** (fired from the send endpoint) — Phase 4 does **NOT** author it.

> **Single-writer contract Lane 4a depends on (Phase 1 Lane 1B — `server/recommendation-lifecycle.ts`, already merged):** Lane 4a calls **`respondToCuratedRec(workspaceId, recId, action)`** — the client-side transition writer. It re-reads the set inside `db.transaction()`, validates `sent → {approved|declined|discussing}` against `CLIENT_REC_TRANSITIONS`, mutates ONLY `clientStatus` (never `RecStatus`), recomputes the summary, upserts, and returns the updated `Recommendation` (or `null` if the rec id is not found). It throws `InvalidTransitionError` on an illegal transition. **If this exported signature is missing when Lane 4a begins, that is a Phase-1 amendment to `00-contracts.md`, not a Lane 4a edit** (single-writer is single-owner). Lane 4a reads the curated set with `loadRecommendations` + `isActiveRec`/`clientStatus` filters (both already exported from `server/recommendations.ts`), and the discuss writer **`appendRecDiscussion(workspaceId, recId, author, body)`** + reader **`listRecDiscussion(workspaceId, recId)`** from `server/rec-discussion.ts` (Phase 2 Lane A — merged before P4 per merge order P1→P2→P4).

---

### Lane 4a (opus) — server respond / curated / discuss endpoints + `requireClientOwner`

**Blocked by:** Phase 1 merge (allow-list public projection, single-writer `respondToCuratedRec`, `CLIENT_REC_TRANSITIONS` pre-committed in `server/state-machines.ts`). On `server/routes/recommendations.ts`: **rebase onto Phase 2 Lane A's admin-route additions** (merge order P1→P2→P4) — append the public routes in a distinct block below P2's admin routes. Phase 2 Lane A also created `server/rec-discussion.ts` (`appendRecDiscussion` / `listRecDiscussion`) which this lane consumes.

**Files (exclusive ownership):**
- `server/middleware.ts` — add `requireClientOwner` guard
- `server/routes/recommendations.ts` — append public `/respond`, `/curated`, `/discuss` routes
- `server/state-machines.ts` — **reference only** `CLIENT_REC_TRANSITIONS` (committed in Phase 1; do NOT re-edit the map)
- `tests/integration/public-rec-respond.test.ts` — owned jointly with Lane 4c; Lane 4a writes the server-side assertions (see Task 4a.6). Lane 4c adds the deep-link contract test in its own file.

#### Task 4a.1: Failing test — `requireClientOwner` denies a member and a sessionless caller

**Files:** `tests/integration/public-rec-respond.test.ts` (create)

1. Create the test file with the spend-guard cases. This asserts the guard's two security properties from `00-contracts.md` checklist item 12: deny a `client_member` and deny a sessionless/admin-HMAC-less caller on a spend-bearing action.

```ts
// tests/integration/public-rec-respond.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from '../integration/helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';

const ctx = await createEphemeralTestContext(import.meta.url);

describe('requireClientOwner spend guard', () => {
  let workspaceId: string;
  beforeAll(async () => {
    const seeded = await seedWorkspace({ baseUrl: ctx.baseUrl });
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it('denies a sessionless caller on a spend-bearing add-to-plan', async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/public/recommendations/${workspaceId}/rec-1/add-to-plan`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    expect(res.status).toBe(401);
  });
});
```

2. Run it, see it fail (the route does not exist yet → 404, not 401):

```
npx vitest run tests/integration/public-rec-respond.test.ts
```

Expected: FAIL — `expected 404 to be 401` (route not mounted yet).

#### Task 4a.2: Implement `requireClientOwner` guard

**Files:** `server/middleware.ts`

1. Read the existing imports at the top of `server/middleware.ts` (the guard reuses `getWorkspace`, `verifyClientUserTokenForWorkspace`, `verifyAdminToken` already imported there). Add the role helper import to the existing import group (grouped with existing imports — never mid-file). At the top of the file, in the block that imports from `./client-users.js`, add `getClientUserById` if not present:

```ts
import { getClientUserById } from './client-users.js';
```

2. Add the guard immediately after `requireAuthenticatedClientPortalAuth` (after line 251). It threads the client role into `res.locals.clientRole` and denies anyone who is not an owner (members, sessionless callers, admin-HMAC callers without a client identity). Multiple owners are allowed — it checks "is an owner," not "is the sole owner."

```ts
/**
 * Strategy v3 (spec §7.3 / decision 4) — spend-authorization guard. Threads the
 * client role from the JWT into res.locals.clientRole and ADMITS only an authenticated
 * client_owner. Used on spend-bearing public routes (Add to plan, any Approve that spawns
 * paid work). Multiple owners are allowed — this checks "is an owner," not "is the sole
 * owner". A sessionless caller, a legacy-cookie-only session (no user identity), an
 * admin-HMAC caller (no client identity), and a client_member are all DENIED:
 * client_member can Discuss + flag intent, but cannot authorize spend.
 */
export function requireClientOwner(wsIdParam = 'workspaceId') {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const workspaceId = req.params[wsIdParam];
    const ws = getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (ws.clientPortalEnabled != null && !ws.clientPortalEnabled) {
      return res.status(403).json({ error: 'Client portal is disabled for this workspace' });
    }
    // Resolve the client user identity from the JWT only — spend requires a real owner,
    // never an admin-HMAC or legacy-session passthrough (which carry no client role).
    const clientToken = req.cookies?.[`client_user_token_${workspaceId}`];
    const userId = verifyClientUserTokenForWorkspace(workspaceId, clientToken);
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = getClientUserById(userId);
    if (!user || user.workspaceId !== workspaceId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (user.role !== 'client_owner') {
      res.locals.clientRole = user.role;
      return res.status(403).json({ error: 'This action requires an account owner' });
    }
    res.locals.clientRole = user.role;
    return next();
  };
}
```

> **Note on `verifyClientUserTokenForWorkspace`'s return:** it returns the userId string (truthy) on a valid token, else null/undefined. If the existing helper returns a boolean instead, resolve the user id via the project's existing client-JWT decode helper used by `requireAuthenticatedClientPortalAuth`'s sibling code — read the actual signature in `server/middleware.ts` before wiring, do not guess (CLAUDE.md "Read-before-write for cross-module consumption"). `getClientUserById` returns `{ id, workspaceId, role, ... } | null` from `server/client-users.ts`.

3. `npm run typecheck` — zero errors. (The test from 4a.1 still 404s because the route is not mounted; that's fixed in 4a.4.)

#### Task 4a.3: Failing test — `/respond` mutates clientStatus only, never RecStatus

**Files:** `tests/integration/public-rec-respond.test.ts`

1. Add the respond happy-path + axis-isolation test. This is the trust-critical assertion from spec §6.1: a respond must NEVER touch `RecStatus`.

```ts
  it('approve mutates clientStatus to approved and leaves RecStatus untouched', async () => {
    // Seed a sent rec via the admin send route (Phase 2) — or directly set clientStatus via
    // the single-writer test helper if the admin route is out of this lane's scope.
    const sent = await fetch(
      `${ctx.baseUrl}/api/recommendations/${workspaceId}/rec-1/send`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-auth-token': ctx.adminToken }, body: '{}' },
    );
    expect(sent.status).toBe(200);

    const res = await fetch(
      `${ctx.baseUrl}/api/public/recommendations/${workspaceId}/rec-1/respond`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: ctx.clientOwnerCookie },
        body: JSON.stringify({ action: 'approved' }),
      },
    );
    expect(res.status).toBe(200);
    const rec = await res.json();
    expect(rec.clientStatus).toBe('approved');
    // Axis isolation: RecStatus must NOT have been swept to 'completed'.
    expect(rec.status).not.toBe('completed');
  });

  it('rejects an illegal client transition (approved → discussing) with 400', async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/public/recommendations/${workspaceId}/rec-1/respond`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: ctx.clientOwnerCookie },
        body: JSON.stringify({ action: 'discussing' }),
      },
    );
    expect(res.status).toBe(400);
  });
```

> **Test-context note:** `createEphemeralTestContext` must expose `adminToken`, `clientOwnerCookie`, and `clientMemberCookie`. If those helpers don't exist on the context yet, add them to `tests/integration/helpers.ts` via the existing auth-seed fixture (`tests/fixtures/auth-seed.ts`) — that file is shared infra, coordinate the addition with the controller before editing (it is not in this lane's exclusive list). The seed must create one `client_owner` and one `client_member` user for the workspace.

2. Run it, see it fail:

```
npx vitest run tests/integration/public-rec-respond.test.ts
```

Expected: FAIL — `/respond` route 404s.

#### Task 4a.4: Implement the public `/respond` + `/curated` + `/discuss` routes

**Files:** `server/routes/recommendations.ts`

1. Read the existing imports (`grep -n '^import' server/routes/recommendations.ts`). Add to the existing import groups (top of file, never mid-file):

```ts
import { requireAuthenticatedClientPortalAuth, requireClientPortalAuth, requireClientOwner } from '../middleware.js';
```

…and add to the state-machines import block (which already imports `RECOMMENDATION_TRANSITIONS`, `validateTransition`, `InvalidTransitionError`):

```ts
import {
  RECOMMENDATION_TRANSITIONS,
  CLIENT_REC_TRANSITIONS,
  validateTransition,
  InvalidTransitionError,
} from '../state-machines.js';
```

…and the single-writer + discuss substrate (new import groups):

```ts
import { respondToCuratedRec } from '../recommendation-lifecycle.js';
import { appendRecDiscussion, listRecDiscussion } from '../rec-discussion.js';
import type { RecDiscussionEntry } from '../../shared/types/recommendations.js';
```

2. Append the three public routes in a **distinct block at the end of the public-route section**, below Phase 2's admin routes (per merge order). The respond route mutates only `clientStatus` via the single-writer, validates against `CLIENT_REC_TRANSITIONS`, logs `rec_approved` (client-visible) on approve, and broadcasts `RECOMMENDATIONS_UPDATED`:

```ts
// ─── Strategy v3 — client curated respond / read / discuss (public) ───────────
// These mutate ONLY the clientStatus axis via the single-writer (never RecStatus).
// CLIENT_REC_TRANSITIONS is the only legal-transition source here.

/** Client responds to a SENT curated rec: approved | declined | discussing. */
router.post(
  '/api/public/recommendations/:workspaceId/:recId/respond',
  requireAuthenticatedClientPortalAuth(),
  (req, res) => {
    const { workspaceId, recId } = req.params;
    const { action } = req.body as { action?: string };
    if (!action || !['approved', 'declined', 'discussing'].includes(action)) {
      return res.status(400).json({ error: 'Valid action required: approved, declined, discussing' });
    }
    let rec: Recommendation | null;
    try {
      // Single-writer: re-reads the set in a txn, validates sent → action against
      // CLIENT_REC_TRANSITIONS, mutates ONLY clientStatus, recomputes summary, upserts.
      rec = respondToCuratedRec(workspaceId, recId, action as 'approved' | 'declined' | 'discussing');
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid response' });
    }
    if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
    // rec_approved is client-visible (00-contracts §4); decline/discussing stay internal here
    // (decline → advisory learning is recorded by the single-writer; no client-visible activity).
    if (action === 'approved') {
      addActivity(workspaceId, 'rec_approved', {
        title: rec.title,
        description: `Client approved: ${rec.title}`,
      });
    }
    invalidateIntelligenceCache(workspaceId);
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId });
    // Public projection: strip admin-only fields before responding.
    return res.json(stripEmvFromPublicRecs([rec])[0]);
  },
);

/** Client reads the curated set: only clientStatus='sent' recs (+ in-flight discussing/approved
 *  for the "in motion" group), public-projected. Its own query key (queryKeys.client.curatedRecommendations). */
router.get(
  '/api/public/recommendations/:workspaceId/curated',
  requireClientPortalAuth(),
  (req, res) => {
    const { workspaceId } = req.params;
    const set = loadRecommendations(workspaceId);
    if (!set) {
      return res.json({ recommendations: [], freshness: 'never_curated' });
    }
    // The client sees sent (needs a decision) + discussing/approved (in motion). Declined and
    // un-sent (system/curated) recs are NEVER returned on the curated read.
    const visible = set.recommendations.filter(
      r => r.clientStatus === 'sent' || r.clientStatus === 'discussing' || r.clientStatus === 'approved',
    );
    // Tri-state freshness (spec §5.6): never_curated (no sent ever) | stale_or_failed (compute
    // stale / provider error) | curated_but_quiet (sent exist but none need a decision).
    const hasEverSent = set.recommendations.some(r => r.sentAt != null);
    const needsDecision = visible.some(r => r.clientStatus === 'sent');
    let freshness: 'never_curated' | 'curated_but_quiet' | 'stale_or_failed';
    if (!hasEverSent) freshness = 'never_curated';
    else if (set.lastError || isComputeStale(set.computedAt)) freshness = 'stale_or_failed';
    else freshness = needsDecision ? 'curated_but_quiet' /* overridden client-side when N>0 */ : 'curated_but_quiet';
    const publicSet = toPublicRecommendationSet(set, visible);
    return res.json({ ...publicSet, freshness });
  },
);

/** Client reads a rec's discussion thread (the inline Ask-a-question history). */
router.get(
  '/api/public/recommendations/:workspaceId/:recId/discuss',
  requireClientPortalAuth(),
  (req, res) => {
    const { workspaceId, recId } = req.params;
    const entries: RecDiscussionEntry[] = listRecDiscussion(workspaceId, recId);
    return res.json(entries);
  },
);

/** Client posts a question to a rec's discussion thread (author='client'). Transitions the rec to
 *  clientStatus='discussing' via the single-writer, then appends the message. */
router.post(
  '/api/public/recommendations/:workspaceId/:recId/discuss',
  requireAuthenticatedClientPortalAuth(),
  (req, res) => {
    const { workspaceId, recId } = req.params;
    const { body } = req.body as { body?: string };
    if (!body || !body.trim()) {
      return res.status(400).json({ error: 'A message is required' });
    }
    // Move the rec to 'discussing' (idempotent if already discussing — single-writer no-ops an
    // already-satisfied transition). Skip the transition only if the rec is already discussing.
    let rec: Recommendation | null;
    try {
      rec = respondToCuratedRec(workspaceId, recId, 'discussing');
    } catch (err) {
      // If it is ALREADY discussing, CLIENT_REC_TRANSITIONS has no discussing→discussing edge;
      // treat that as a no-op and proceed to append the message.
      if (!(err instanceof InvalidTransitionError)) {
        return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid action' });
      }
      rec = loadRecommendations(workspaceId)?.recommendations.find(r => r.id === recId) ?? null;
    }
    if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
    const entry = appendRecDiscussion(workspaceId, recId, 'client', body.trim());
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED, { recId });
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId });
    return res.status(201).json(entry);
  },
);

/** Spend-bearing add-to-plan — owner-gated. Renders client-side ONLY where productType resolves
 *  (decision 1); the guard is the server enforcement of decision 4. The cart/checkout bridge is
 *  deferred (strategy-paid-topics flag); this route returns the resolved product for the confirm step. */
router.post(
  '/api/public/recommendations/:workspaceId/:recId/add-to-plan',
  requireClientOwner(),
  (req, res) => {
    const { workspaceId, recId } = req.params;
    const set = loadRecommendations(workspaceId);
    const rec = set?.recommendations.find(r => r.id === recId) ?? null;
    if (!rec) return res.status(404).json({ error: 'Recommendation not found' });
    if (!rec.productType) {
      return res.status(400).json({ error: 'This recommendation has no purchasable product' });
    }
    // v1 (no paid-topic spine): record the owner's intent + return the product for the confirm
    // step. The actual checkout lands when strategy-paid-topics ships (deferred roadmap).
    addActivity(workspaceId, 'rec_approved', {
      title: rec.title,
      description: `Owner requested add-to-plan: ${rec.title}`,
    });
    broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { recId });
    return res.json({ recId, productType: rec.productType });
  },
);
```

> **`isComputeStale` / `set.computedAt` / `set.lastError`:** read the actual `RecommendationSet` shape in `shared/types/recommendations.ts` before wiring the freshness branch (CLAUDE.md "Read-before-write"). If `RecommendationSet` exposes `computedAt` (epoch ms) use a `Date.now() - computedAt > THRESHOLD` check inline (define `const STALE_MS = 7 * 24 * 60 * 60 * 1000;` near the top of the file); if there is no compute timestamp on the set, drop `isComputeStale` and base `stale_or_failed` on `set.lastError` only, and note the gap in the PR. Do NOT invent a field name.

3. Run the integration test, see it pass:

```
npx vitest run tests/integration/public-rec-respond.test.ts
```

Expected: PASS — respond returns `clientStatus:'approved'`, `status` not `'completed'`; illegal transition → 400; add-to-plan sessionless → 401.

#### Task 4a.5: Failing test — `requireClientOwner` denies a member but admits an owner

**Files:** `tests/integration/public-rec-respond.test.ts`

1. Add the two role cases:

```ts
  it('denies a client_member on add-to-plan (403)', async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/public/recommendations/${workspaceId}/rec-1/add-to-plan`,
      { method: 'POST', headers: { 'content-type': 'application/json', cookie: ctx.clientMemberCookie }, body: '{}' },
    );
    expect(res.status).toBe(403);
  });

  it('admits a client_owner on add-to-plan and returns the resolved product', async () => {
    // rec-1 must have a resolvable productType in the seed for this to pass.
    const res = await fetch(
      `${ctx.baseUrl}/api/public/recommendations/${workspaceId}/rec-1/add-to-plan`,
      { method: 'POST', headers: { 'content-type': 'application/json', cookie: ctx.clientOwnerCookie }, body: '{}' },
    );
    expect([200, 400]).toContain(res.status); // 200 if productType resolves, 400 if seed rec has none
  });
```

2. Run it, see it pass:

```
npx vitest run tests/integration/public-rec-respond.test.ts
```

Expected: PASS — member 403, owner 200/400.

#### Task 4a.6: Failing test — public allow-list holds on the curated read (no admin-only key leaks)

**Files:** `tests/integration/public-rec-respond.test.ts`

1. Add the no-admin-key-leak assertion on the **curated** read (spec §7.4 — exercise the real public path, never the admin GET):

```ts
  it('curated read never leaks admin-only lifecycle keys', async () => {
    const res = await fetch(
      `${ctx.baseUrl}/api/public/recommendations/${workspaceId}/curated`,
      { headers: { cookie: ctx.clientOwnerCookie } },
    );
    expect(res.status).toBe(200);
    const set = await res.json();
    const json = JSON.stringify(set);
    // throttledUntil / struckAt / emvPerWeek must never appear on the client payload.
    expect(json).not.toContain('throttledUntil');
    expect(json).not.toContain('struckAt');
    expect(json).not.toContain('emvPerWeek');
  });
```

> **Allow-list note:** `stripEmvFromPublicRecs` (Phase 1 Lane 1C converts it to an allow-list) strips `emvPerWeek`/`predictedEmv`/`roiPerEffortDay`. The v3 admin-only lifecycle fields (`throttledUntil`, `struckAt`, `struck` lifecycle, `cascade`) must ALSO be excluded by that allow-list — if this test fails on `throttledUntil`, the gap is in Phase 1's allow-list (a Phase-1 amendment), not Lane 4a. The curated read only returns `sent`/`discussing`/`approved` recs (never throttled/struck), so `throttledUntil`/`struckAt` should already be absent; this test is the safety net.

2. Run it, see it pass:

```
npx vitest run tests/integration/public-rec-respond.test.ts
```

Expected: PASS.

#### Task 4a.7: Verify + commit Lane 4a

1. Full lane verify:

```
npm run typecheck
npx vitest run tests/integration/public-rec-respond.test.ts
npx tsx scripts/pr-check.ts
```

Expected: typecheck zero errors; all respond tests pass; pr-check zero errors (the new public mutation routes call `addActivity` + `broadcastToWorkspace` — the public-portal-mutation pr-check rule is satisfied).

2. Commit:

```
git add server/middleware.ts server/routes/recommendations.ts tests/integration/public-rec-respond.test.ts
git commit -m "Strategy v3 Phase 4a — client respond/curated/discuss public routes + requireClientOwner spend guard"
```

---

### Lane 4c (sonnet) — client hooks + query key + ws invalidation + `?rec=` contract test

**Blocked by:** Lane 4a (route names/shapes). On `src/lib/queryKeys.ts` / `src/lib/wsInvalidation.ts`: add to the **client** namespace/branch only, **rebase onto Phase 2 Lane C's edits** (P2 owns the admin additions; merge order P1→P2→P4). `queryKeys.client.curatedRecommendations` is already declared in Phase 1 (`00-contracts.md §8`) — Lane 4c **uses** it, does not re-declare it.

**Files (exclusive ownership):**
- `src/hooks/client/useCuratedRecommendations.ts` (create)
- `src/hooks/client/useRecRespond.ts` (create)
- `src/hooks/client/useRecDiscussion.ts` (create)
- `src/hooks/client/index.ts` (append exports)
- `src/api/analytics.ts` (append public fetchers — this lane owns the new curated/respond/discuss wrappers)
- `src/lib/wsInvalidation.ts` (add `curatedRecommendations` to the client `RECOMMENDATIONS_UPDATED` case AND the `RECOMMENDATIONS_DISCUSSION_UPDATED` case)
- `tests/contract/rec-deep-link-wiring.test.ts` (create — the `?rec=` two-halves contract)

#### Task 4c.1: Add the public API fetchers (curated read, respond, discuss)

**Files:** `src/api/analytics.ts`

1. Read the existing `get`/`post` wrapper imports at the top of `src/api/analytics.ts` (`grep -n '^import\|^const get\|function get\|function post' src/api/analytics.ts`). The file already uses a typed `get<T>(path)` wrapper (see `fetchClientIntelligence`). Confirm a `post<T>(path, body)` wrapper exists; if only `get` is present, import the shared `post` from the same module the other public fetchers use. Append the curated types + fetchers after `fetchClientJobs` (line 191):

```ts
// ── Strategy v3 — curated recommendations (client) ─────────────────────
export type CuratedFreshness = 'never_curated' | 'curated_but_quiet' | 'stale_or_failed';

export interface CuratedRecommendationSet {
  recommendations: import('../../shared/types/recommendations.js').Recommendation[];
  freshness: CuratedFreshness;
  summary?: import('../../shared/types/recommendations.js').RecommendationSummary;
  computedAt?: number;
}

export type RecRespondAction = 'approved' | 'declined' | 'discussing';

export interface RecDiscussionEntryClient {
  id: string;
  recId: string;
  workspaceId: string;
  author: 'client' | 'strategist';
  body: string;
  createdAt: string;
}

/** GET the curated set (clientStatus='sent'/'discussing'/'approved' recs, public-projected). */
export async function fetchCuratedRecommendations(workspaceId: string): Promise<CuratedRecommendationSet> {
  return get<CuratedRecommendationSet>(`/api/public/recommendations/${workspaceId}/curated`);
}

/** POST a client response to a sent rec (mutates clientStatus only). */
export async function respondToCuratedRec(
  workspaceId: string,
  recId: string,
  action: RecRespondAction,
): Promise<import('../../shared/types/recommendations.js').Recommendation> {
  return post(`/api/public/recommendations/${workspaceId}/${recId}/respond`, { action });
}

/** GET a rec's discussion thread. */
export async function fetchRecDiscussion(workspaceId: string, recId: string): Promise<RecDiscussionEntryClient[]> {
  return get<RecDiscussionEntryClient[]>(`/api/public/recommendations/${workspaceId}/${recId}/discuss`);
}

/** POST a client question to a rec's discussion thread. */
export async function postRecDiscussion(
  workspaceId: string,
  recId: string,
  body: string,
): Promise<RecDiscussionEntryClient> {
  return post(`/api/public/recommendations/${workspaceId}/${recId}/discuss`, { body });
}

/** POST an owner add-to-plan intent (owner-gated server-side). Returns the resolved product. */
export async function addRecToPlan(
  workspaceId: string,
  recId: string,
): Promise<{ recId: string; productType: string }> {
  return post(`/api/public/recommendations/${workspaceId}/${recId}/add-to-plan`, {});
}
```

> **Wrapper signature:** if the shared `post<T>` returns `Promise<T>` with an explicit type param, annotate the calls (`post<Recommendation>(...)`). Read the actual `post` signature in `src/api/analytics.ts` (or wherever `get` is defined) and match it — do not assume. The inline `import('../../shared/types/recommendations.js').X` type-only imports avoid adding top-level imports if the file doesn't already import from that module; if it does, hoist them to the existing import group.

2. `npm run typecheck` — zero errors.

#### Task 4c.2: Failing test — `useCuratedRecommendations` calls the curated endpoint with the curated key

**Files:** `src/hooks/client/useCuratedRecommendations.ts` (create), `tests/unit/client/useCuratedRecommendations.test.tsx` (create — co-located unit test in this lane's hook ownership)

1. Create the failing test:

```tsx
// tests/unit/client/useCuratedRecommendations.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../../src/api/analytics.js', () => ({
  fetchCuratedRecommendations: vi.fn().mockResolvedValue({ recommendations: [], freshness: 'never_curated' }),
}));

import { useCuratedRecommendations } from '../../../src/hooks/client/useCuratedRecommendations.js';
import { fetchCuratedRecommendations } from '../../../src/api/analytics.js';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useCuratedRecommendations', () => {
  beforeEach(() => vi.clearAllMocks());
  it('fetches the curated set for the workspace', async () => {
    const { result } = renderHook(() => useCuratedRecommendations('ws-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchCuratedRecommendations).toHaveBeenCalledWith('ws-1');
    expect(result.current.data?.freshness).toBe('never_curated');
  });
});
```

2. Run it, see it fail (module not found):

```
npx vitest run tests/unit/client/useCuratedRecommendations.test.tsx
```

Expected: FAIL — `Cannot find module '.../useCuratedRecommendations.js'`.

#### Task 4c.3: Implement `useCuratedRecommendations`

**Files:** `src/hooks/client/useCuratedRecommendations.ts`

1. Create the read hook (mirrors `useClientWorkFeed`'s own-key discipline; uses the pre-committed `queryKeys.client.curatedRecommendations`):

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchCuratedRecommendations } from '../../api/analytics.js';
import type { CuratedRecommendationSet } from '../../api/analytics.js';
import { queryKeys } from '../../lib/queryKeys.js';

/**
 * Strategy v3 — the curated, clientStatus='sent' recs the client actually sees (spec §7.2).
 * Its OWN query key (queryKeys.client.curatedRecommendations), DISTINCT from the raw
 * queryKeys.shared.recommendations read so the byte-identical flag-OFF snapshot is never
 * disturbed. Invalidated on RECOMMENDATIONS_UPDATED + RECOMMENDATIONS_DISCUSSION_UPDATED via
 * the central wsInvalidation client branch (both halves of the broadcast contract).
 */
export function useCuratedRecommendations(workspaceId: string) {
  return useQuery<CuratedRecommendationSet>({
    queryKey: queryKeys.client.curatedRecommendations(workspaceId),
    queryFn: () => fetchCuratedRecommendations(workspaceId),
    staleTime: 30 * 1000,
    enabled: !!workspaceId,
  });
}
```

2. Run it, see it pass:

```
npx vitest run tests/unit/client/useCuratedRecommendations.test.tsx
```

Expected: PASS.

#### Task 4c.4: Failing test — `useRecRespond` mutates and invalidates the curated key

**Files:** `tests/unit/client/useRecRespond.test.tsx` (create)

1. Create the failing test:

```tsx
// tests/unit/client/useRecRespond.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../../src/api/analytics.js', () => ({
  respondToCuratedRec: vi.fn().mockResolvedValue({ id: 'rec-1', clientStatus: 'approved', status: 'pending' }),
}));

import { useRecRespond } from '../../../src/hooks/client/useRecRespond.js';
import { respondToCuratedRec } from '../../../src/api/analytics.js';
import { queryKeys } from '../../../src/lib/queryKeys.js';

describe('useRecRespond', () => {
  beforeEach(() => vi.clearAllMocks());
  it('responds then invalidates the curated key', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRecRespond('ws-1'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ recId: 'rec-1', action: 'approved' });
    });
    expect(respondToCuratedRec).toHaveBeenCalledWith('ws-1', 'rec-1', 'approved');
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.client.curatedRecommendations('ws-1') }),
    );
  });
});
```

2. Run it, see it fail (module not found):

```
npx vitest run tests/unit/client/useRecRespond.test.tsx
```

Expected: FAIL.

#### Task 4c.5: Implement `useRecRespond`

**Files:** `src/hooks/client/useRecRespond.ts`

1. Create the mutation hook (mirrors `useRespondToDeliverable`):

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { respondToCuratedRec } from '../../api/analytics.js';
import type { RecRespondAction } from '../../api/analytics.js';
import type { Recommendation } from '../../../shared/types/recommendations.js';
import { queryKeys } from '../../lib/queryKeys.js';

export interface RecRespondVars {
  recId: string;
  action: RecRespondAction;
}

/**
 * Strategy v3 — client responds to a sent curated rec (approve/decline/discuss).
 * Mutates clientStatus only (server enforces the axis isolation). On success, invalidates
 * the curated key so the "Needs your decision · N" header + progress bar re-derive.
 */
export function useRecRespond(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation<Recommendation, Error, RecRespondVars>({
    mutationFn: ({ recId, action }) => respondToCuratedRec(workspaceId, recId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.client.curatedRecommendations(workspaceId) });
    },
  });
}
```

2. Run it, see it pass:

```
npx vitest run tests/unit/client/useRecRespond.test.tsx
```

Expected: PASS.

#### Task 4c.6: Implement `useRecDiscussion` (read + post) with a test

**Files:** `tests/unit/client/useRecDiscussion.test.tsx` (create), `src/hooks/client/useRecDiscussion.ts` (create)

1. Create the failing test:

```tsx
// tests/unit/client/useRecDiscussion.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../../src/api/analytics.js', () => ({
  fetchRecDiscussion: vi.fn().mockResolvedValue([]),
  postRecDiscussion: vi.fn().mockResolvedValue({ id: 'd1', recId: 'rec-1', workspaceId: 'ws-1', author: 'client', body: 'hi', createdAt: 'now' }),
}));

import { useRecDiscussion, usePostRecDiscussion } from '../../../src/hooks/client/useRecDiscussion.js';
import { fetchRecDiscussion, postRecDiscussion } from '../../../src/api/analytics.js';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useRecDiscussion', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads a thread', async () => {
    const { result } = renderHook(() => useRecDiscussion('ws-1', 'rec-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchRecDiscussion).toHaveBeenCalledWith('ws-1', 'rec-1');
  });
  it('posts a message', async () => {
    const { result } = renderHook(() => usePostRecDiscussion('ws-1', 'rec-1'), { wrapper: makeWrapper() });
    await act(async () => { await result.current.mutateAsync('hi'); });
    expect(postRecDiscussion).toHaveBeenCalledWith('ws-1', 'rec-1', 'hi');
  });
});
```

2. Run it, see it fail:

```
npx vitest run tests/unit/client/useRecDiscussion.test.tsx
```

Expected: FAIL — module not found.

3. Implement the hook:

```ts
// src/hooks/client/useRecDiscussion.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchRecDiscussion, postRecDiscussion } from '../../api/analytics.js';
import type { RecDiscussionEntryClient } from '../../api/analytics.js';
import { queryKeys } from '../../lib/queryKeys.js';

/** Read a rec's discussion thread. Keyed off the curated key + recId so it invalidates with the set. */
export function useRecDiscussion(workspaceId: string, recId: string) {
  return useQuery<RecDiscussionEntryClient[]>({
    queryKey: [...queryKeys.client.curatedRecommendations(workspaceId), 'discuss', recId],
    queryFn: () => fetchRecDiscussion(workspaceId, recId),
    staleTime: 15 * 1000,
    enabled: !!workspaceId && !!recId,
  });
}

/** Post a client question. On success, invalidates the thread + the curated set (the rec moves to discussing). */
export function usePostRecDiscussion(workspaceId: string, recId: string) {
  const queryClient = useQueryClient();
  return useMutation<RecDiscussionEntryClient, Error, string>({
    mutationFn: (body: string) => postRecDiscussion(workspaceId, recId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...queryKeys.client.curatedRecommendations(workspaceId), 'discuss', recId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.client.curatedRecommendations(workspaceId) });
    },
  });
}
```

4. Run it, see it pass:

```
npx vitest run tests/unit/client/useRecDiscussion.test.tsx
```

Expected: PASS.

#### Task 4c.7: Export the three hooks from the client barrel

**Files:** `src/hooks/client/index.ts`

1. Append to the existing export block:

```ts
export { useCuratedRecommendations } from './useCuratedRecommendations';
export { useRecRespond } from './useRecRespond';
export { useRecDiscussion, usePostRecDiscussion } from './useRecDiscussion';
```

2. `npm run typecheck` — zero errors.

#### Task 4c.8: Wire `curatedRecommendations` invalidation into the client ws-invalidation branch (both cases)

**Files:** `src/lib/wsInvalidation.ts`

1. Read the client branch (`grep -n "case WS_EVENTS.RECOMMENDATIONS" src/lib/wsInvalidation.ts` — the client `RECOMMENDATIONS_UPDATED` case is the single-key one returning `[queryKeys.shared.recommendations(workspaceId)]`). Add `curatedRecommendations` to that case:

```ts
    case WS_EVENTS.RECOMMENDATIONS_UPDATED:
      return [
        queryKeys.shared.recommendations(workspaceId),
        queryKeys.client.curatedRecommendations(workspaceId),
      ] as const;
```

2. Add a `RECOMMENDATIONS_DISCUSSION_UPDATED` case in the client branch (Phase 1 added the admin case; the client branch needs its own). Place it after the client `RECOMMENDATIONS_UPDATED` case:

```ts
    case WS_EVENTS.RECOMMENDATIONS_DISCUSSION_UPDATED:
      return [queryKeys.client.curatedRecommendations(workspaceId)] as const;
```

> **Note:** the admin-branch `RECOMMENDATIONS_DISCUSSION_UPDATED` case (returning `admin.recDiscussion` + `client.curatedRecommendations`) was committed in Phase 1 (`00-contracts.md §5`). This task adds ONLY the **client-branch** case — do not touch the admin branch.

3. `npm run typecheck` — zero errors.

#### Task 4c.9: Failing `?rec=` two-halves contract test, then verify it passes

**Files:** `tests/contract/rec-deep-link-wiring.test.ts` (create)

1. Create the contract test, mirroring `tests/contract/tab-deep-link-wiring.test.ts` but for `?rec=`. It statically asserts every `?rec=` sender targets a component that reads `searchParams.get('rec')`:

```ts
// tests/contract/rec-deep-link-wiring.test.ts
//
// CONTRACT: ?rec= deep-link senders and receivers must be wired (spec §5.7).
// When code constructs a URL with ?rec=X (an InlinePointer wayfinding chip), the
// curated overview receiver must read useSearchParams and match it against sent recs.
//
// readFile-ok — this test intentionally reads source files for static analysis.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '../..');
const SRC_DIR = join(ROOT, 'src');

function collectTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsx(full));
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('?rec= deep-link wiring contract', () => {
  const files = collectTsx(SRC_DIR);

  it('at least one receiver reads searchParams.get("rec")', () => {
    const receivers = files.filter(f => {
      const src = readFileSync(f, 'utf8'); // readFile-ok — static analysis
      return /searchParams\.get\(\s*['"]rec['"]\s*\)/.test(src);
    });
    // The curated overview (Lane 4e) is the receiver; it MUST exist before any ?rec= sender ships.
    expect(receivers.length).toBeGreaterThan(0);
  });

  it('every ?rec= sender targets a file that reads searchParams.get("rec")', () => {
    const senderRe = /[?&]rec=/;
    const senders = files.filter(f => senderRe.test(readFileSync(f, 'utf8'))); // readFile-ok
    const hasReceiver = files.some(f => /searchParams\.get\(\s*['"]rec['"]\s*\)/.test(readFileSync(f, 'utf8'))); // readFile-ok
    // If any sender exists, a receiver must exist (the two-halves contract).
    if (senders.length > 0) expect(hasReceiver).toBe(true);
  });
});
```

2. Run it, see it fail (no receiver exists yet — Lane 4e adds it):

```
npx vitest run tests/contract/rec-deep-link-wiring.test.ts
```

Expected: FAIL — `expected 0 to be greater than 0` (the `searchParams.get('rec')` receiver lands in Lane 4e). **This test stays red until Lane 4e wires the receiver** — that is the intended two-halves coupling. Note it in the lane handoff: Lane 4e's Task closes this gate.

#### Task 4c.10: Verify + commit Lane 4c

1. Lane verify (the rec-deep-link test is expected red until 4e — run the rest green):

```
npm run typecheck
npx vitest run tests/unit/client/useCuratedRecommendations.test.tsx tests/unit/client/useRecRespond.test.tsx tests/unit/client/useRecDiscussion.test.tsx
npx tsx scripts/pr-check.ts
```

Expected: typecheck zero errors; the three hook tests pass; pr-check zero errors (all hooks use `useQuery`/`useMutation`, client-prefixed keys).

2. Commit (include the still-red contract test — it is wired green by Lane 4e in the same PR):

```
git add src/hooks/client/useCuratedRecommendations.ts src/hooks/client/useRecRespond.ts src/hooks/client/useRecDiscussion.ts src/hooks/client/index.ts src/api/analytics.ts src/lib/wsInvalidation.ts tests/contract/rec-deep-link-wiring.test.ts tests/unit/client/useCuratedRecommendations.test.tsx tests/unit/client/useRecRespond.test.tsx tests/unit/client/useRecDiscussion.test.tsx
git commit -m "Strategy v3 Phase 4c — client curated/respond/discuss hooks + curated invalidation + ?rec= contract test"
```

---

### Lane 4d (sonnet) — net-new curated UI components

**Blocked by:** Phase 1 merge (lifecycle fields on `Recommendation`). Net-new files ONLY. **Import `RecommendedForYou` / `WinsSurface` / `ActionQueueStrip` from `src/components/client/Briefing/`** (verified present in that dir) — do NOT recreate them. Uses Lane 4c's hooks (`useCuratedRecommendations`, `useRecRespond`, `useRecDiscussion`) — those must be merged/available first within the PR; the components are written against the hook signatures defined in Lane 4c.

**Files (exclusive ownership):**
- `src/components/client/CuratedOverview.tsx` (create)
- `src/components/client/curated/CuratedRecCard.tsx` (create)
- `src/components/client/curated/CuratedRecsLayer.tsx` (create)
- `src/components/client/curated/CuratedRecDiscussThread.tsx` (create)
- `src/components/client/curated/QuietMonthScreen.tsx` (create)
- `src/components/ui/InlinePointer.tsx` (create — the ~30-line wayfinding chip)
- `tests/component/client/CuratedRecsLayer.test.tsx` (create)

> **Design-law reminders (CLAUDE.md Four Laws + client-framing rule):** NO purple anywhere (client-facing). Approve CTA = teal (`from-teal-600 to-emerald-600`). Paid action = **teal outline** with the price as a **cost band** OUTSIDE the button label + a confirm step. Impact uses `impactBand` (banded, never raw $). The visibility ring fills from `scoreColor()` (amber at 64, not emerald). Use `SectionCard`, `Badge`, `Button`, `Icon`, `EmptyState` from `src/components/ui/` — never hand-roll cards. Verify with `grep -r "purple-" src/components/client/curated/` before commit.

#### Task 4d.1: `InlinePointer` wayfinding chip

**Files:** `src/components/ui/InlinePointer.tsx`

1. Create the presentational chip (spec §5.7 — light `?rec=` wayfinding, teal, action color):

```tsx
import { Lightbulb, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

interface InlinePointerProps {
  /** The hub path with ?rec= appended (caller builds it via clientPath + ?rec=recId). */
  to: string;
  /** Count of live curated recs relevant to this screen (aggregated to one chip per screen). */
  count: number;
}

/**
 * Strategy v3 (spec §5.7) — a light wayfinding chip that jumps from a data screen into the
 * curated hub. Renders ONLY when count > 0 (the caller must not mount it on a 0-rec screen —
 * no hollow "0 recommendations" state). Teal (action color). One chip per screen.
 */
export function InlinePointer({ to, count }: InlinePointerProps) {
  if (count <= 0) return null;
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/40 bg-teal-500/10 px-3 py-1 text-teal-300 hover:bg-teal-500/20 hover:text-teal-200 transition-colors t-ui"
    >
      <Lightbulb className="w-3.5 h-3.5" />
      <span>{count === 1 ? '1 recommendation here' : `${count} recommendations here`}</span>
      <ArrowRight className="w-3.5 h-3.5" />
    </Link>
  );
}
```

2. `npm run typecheck` — zero errors.

#### Task 4d.2: Failing test — `CuratedRecsLayer` renders "Needs your decision · N" and the done-state

**Files:** `tests/component/client/CuratedRecsLayer.test.tsx` (create)

1. Create the failing component test (the layer's core contract: lead header + done-state):

```tsx
// tests/component/client/CuratedRecsLayer.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// The layer takes already-loaded data as props (no data fetching inside) so it is purely presentational.
import { CuratedRecsLayer } from '../../../src/components/client/curated/CuratedRecsLayer.js';

function rec(id: string, clientStatus: string) {
  return { id, title: `Rec ${id}`, description: '', clientStatus, status: 'pending', affectedPages: [] } as any;
}

describe('CuratedRecsLayer', () => {
  it('leads with "Needs your decision · N" when sent recs exist', () => {
    render(
      <MemoryRouter>
        <CuratedRecsLayer
          workspaceId="ws-1"
          recommendations={[rec('1', 'sent'), rec('2', 'sent')]}
          freshness="curated_but_quiet"
          tier="growth"
          onRespond={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Needs your decision/i)).toBeInTheDocument();
    expect(screen.getByText(/·\s*2/)).toBeInTheDocument();
  });

  it('shows the done-state when no rec needs a decision', () => {
    render(
      <MemoryRouter>
        <CuratedRecsLayer
          workspaceId="ws-1"
          recommendations={[rec('1', 'approved')]}
          freshness="curated_but_quiet"
          tier="growth"
          onRespond={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/everything that needs a decision this month/i)).toBeInTheDocument();
  });
});
```

2. Run it, see it fail:

```
npx vitest run tests/component/client/CuratedRecsLayer.test.tsx
```

Expected: FAIL — `CuratedRecsLayer` module not found.

#### Task 4d.3: Implement `CuratedRecCard` (tier-driven split CTAs)

**Files:** `src/components/client/curated/CuratedRecCard.tsx`

1. Create the card (spec §5.4 — benefit title → why sentence → impact band → tier-driven CTA; `Add·$` only where `productType` resolves):

```tsx
import { useState } from 'react';
import { Button, Badge, Icon } from '../../ui';
import { CheckCircle2, MessageCircle, PlusCircle } from 'lucide-react';
import type { Recommendation } from '../../../../shared/types/recommendations.js';
import type { Tier } from '../../ui/TierGate';
import { CuratedRecDiscussThread } from './CuratedRecDiscussThread';

interface CuratedRecCardProps {
  workspaceId: string;
  rec: Recommendation;
  tier: Tier;
  onRespond: (recId: string, action: 'approved' | 'declined' | 'discussing') => void;
}

/**
 * Strategy v3 (spec §5.4) — the curated rec card. CTAs are tier-driven:
 *  - assignedTo==='team' (Premium) → "Approve — we'll do it" (teal solid, no price).
 *  - else, where rec.productType resolves → "Add to plan" (teal OUTLINE) with the price as a
 *    cost band OUTSIDE the label + a confirm step (decision 1/2).
 *  - else → Approve / Discuss only (no priced CTA — decision 1).
 * Discuss is always available (the easiest action) — opens the inline Ask-a-question thread.
 * NO purple. Impact uses rec.impactBand (banded, never raw $).
 */
export function CuratedRecCard({ workspaceId, rec, tier, onRespond }: CuratedRecCardProps) {
  const [confirmingAddToPlan, setConfirmingAddToPlan] = useState(false);
  const [discussing, setDiscussing] = useState(rec.clientStatus === 'discussing');

  const isTeamExecuted = rec.assignedTo === 'team';
  const hasProduct = !!rec.productType;
  const isApproved = rec.clientStatus === 'approved';

  return (
    <div className="rounded-lg border border-[var(--brand-border)] bg-[var(--surface-2)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="t-h2 text-[var(--brand-text-bright)]">{rec.title}</h4>
          {rec.insight && <p className="t-body text-[var(--brand-text)] mt-1">{rec.insight}</p>}
        </div>
        {rec.impactBand && (
          <Badge color="blue">{rec.impactBand.label ?? 'Projected impact'}</Badge>
        )}
      </div>

      {isApproved ? (
        <div className="mt-3 flex items-center gap-2 text-emerald-400 t-ui">
          <CheckCircle2 className="w-4 h-4" />
          <span>Approved — we're on it</span>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isTeamExecuted ? (
            <Button variant="primary" onClick={() => onRespond(rec.id, 'approved')}>
              Approve — we'll do it
            </Button>
          ) : hasProduct ? (
            <div className="flex flex-col gap-1">
              {confirmingAddToPlan ? (
                <div className="flex items-center gap-2">
                  <Button variant="primary" onClick={() => onRespond(rec.id, 'approved')}>
                    Confirm add to plan
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingAddToPlan(false)}>Cancel</Button>
                </div>
              ) : (
                <Button variant="outline" onClick={() => setConfirmingAddToPlan(true)}>
                  <Icon icon={PlusCircle} size="sm" /> Add to plan
                </Button>
              )}
              {/* Price as a cost band OUTSIDE the button label (decision 2). */}
              {rec.productPrice != null && (
                <span className="t-caption-sm text-[var(--brand-text-muted)]">
                  ${rec.productPrice} add-on · estimate, not a guarantee
                </span>
              )}
            </div>
          ) : (
            <Button variant="primary" onClick={() => onRespond(rec.id, 'approved')}>Approve</Button>
          )}
          <Button variant="ghost" onClick={() => { setDiscussing(true); onRespond(rec.id, 'discussing'); }}>
            <Icon icon={MessageCircle} size="sm" /> Ask a question
          </Button>
        </div>
      )}

      {discussing && <CuratedRecDiscussThread workspaceId={workspaceId} recId={rec.id} />}
    </div>
  );
}
```

> **Type-field caveat:** `rec.productPrice` / `rec.impactBand.label` — confirm these exist on the merged `Recommendation` / `ImpactBand` types before wiring (`grep -n "productPrice\|impactBand\|interface ImpactBand" shared/types/recommendations.ts shared/types/impact-band.ts`). `00-contracts.md §1` notes `productType?`, `assignedTo?`, `impactBand?` are already on the interface; `productPrice` may live elsewhere — if absent, derive the price band from the resolved product via the existing `mapToProduct` helper (read its signature first) or omit the price line and note the gap. NEVER guess a field name (CLAUDE.md "Read-before-write").

2. `npm run typecheck` — zero errors.

#### Task 4d.4: Implement `CuratedRecDiscussThread` (inline Ask-a-question)

**Files:** `src/components/client/curated/CuratedRecDiscussThread.tsx`

1. Create the inline thread (spec §5.4 — strategist's latest reply inline + a reply box; uses Lane 4c's `useRecDiscussion` + `usePostRecDiscussion`):

```tsx
import { useState } from 'react';
import { Button } from '../../ui';
import { useRecDiscussion, usePostRecDiscussion } from '../../../hooks/client';

interface CuratedRecDiscussThreadProps {
  workspaceId: string;
  recId: string;
}

/**
 * Strategy v3 (spec §5.4) — the inline conversational rec state. Shows the discussion thread
 * (client questions + strategist replies) with a one-tap reply box, no navigation. NO purple.
 */
export function CuratedRecDiscussThread({ workspaceId, recId }: CuratedRecDiscussThreadProps) {
  const { data: entries = [] } = useRecDiscussion(workspaceId, recId);
  const post = usePostRecDiscussion(workspaceId, recId);
  const [draft, setDraft] = useState('');

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    post.mutate(body, { onSuccess: () => setDraft('') });
  };

  return (
    <div className="mt-3 rounded-md border border-[var(--brand-border)] bg-[var(--surface-3)] p-3">
      <div className="space-y-2">
        {entries.length === 0 ? (
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            Ask your strategist anything about this recommendation.
          </p>
        ) : (
          entries.map(e => (
            <div key={e.id} className="t-body">
              <span className={e.author === 'strategist' ? 'text-teal-300' : 'text-[var(--brand-text-bright)]'}>
                {e.author === 'strategist' ? 'Your strategist' : 'You'}:
              </span>{' '}
              <span className="text-[var(--brand-text)]">{e.body}</span>
            </div>
          ))
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="Ask a question…"
          className="flex-1 rounded-md border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-1.5 t-ui text-[var(--brand-text-bright)] placeholder:text-[var(--brand-text-muted)]"
        />
        <Button variant="primary" onClick={submit} disabled={post.isPending || !draft.trim()}>Send</Button>
      </div>
    </div>
  );
}
```

2. `npm run typecheck` — zero errors.

#### Task 4d.5: Implement `QuietMonthScreen`

**Files:** `src/components/client/curated/QuietMonthScreen.tsx`

1. Create the first-class quiet-month screen (spec §5.5 — reassurance + in-progress work + next check-in; imports `WinsSurface` + `AgencyWorkFeed`):

```tsx
import { WinsSurface } from '../Briefing/WinsSurface';
import { AgencyWorkFeed } from '../AgencyWorkFeed';
import { SectionCard, Icon } from '../../ui';
import { CalendarCheck } from 'lucide-react';

interface QuietMonthScreenProps {
  workspaceId: string;
  /** ISO date of the next scheduled check-in, if known. */
  nextCheckIn?: string | null;
}

/**
 * Strategy v3 (spec §5.5) — the quiet/empty-month screen (the #1 churn moment). NOT a hollow
 * shell: a featured past win still compounding + a reassurance line + in-progress approved work
 * + a dated next check-in. NO purple.
 */
export function QuietMonthScreen({ workspaceId, nextCheckIn }: QuietMonthScreenProps) {
  return (
    <div className="space-y-4">
      <WinsSurface workspaceId={workspaceId} />
      <SectionCard>
        <p className="t-body text-[var(--brand-text)]">
          Nothing needs your decision this month — your strategy is on track and we're executing
          the work you've already approved.
        </p>
      </SectionCard>
      <AgencyWorkFeed workspaceId={workspaceId} mode="in-progress" />
      {nextCheckIn && (
        <div className="flex items-center gap-2 t-ui text-[var(--brand-text-muted)]">
          <Icon icon={CalendarCheck} size="sm" />
          <span>Next check-in: {new Date(nextCheckIn).toLocaleDateString()}</span>
        </div>
      )}
    </div>
  );
}
```

> **Prop-shape caveat:** `WinsSurface` / `AgencyWorkFeed` props — read their actual signatures (`grep -n "interface.*Props\|export function WinsSurface\|export function AgencyWorkFeed" src/components/client/Briefing/WinsSurface.tsx src/components/client/AgencyWorkFeed.tsx`) and pass exactly what they require. The `mode="in-progress"` prop above is illustrative — if `AgencyWorkFeed` filters differently, match its real API. Do NOT guess prop names.

2. `npm run typecheck` — zero errors.

#### Task 4d.6: Implement `CuratedRecsLayer` (the orchestrating layer) → green test

**Files:** `src/components/client/curated/CuratedRecsLayer.tsx`

1. Create the layer (spec §5.4/§5.6 — "Needs your decision · N" lead + 3-segment progress bar + group-by-decision-state + done-state + cap-at-5 + tri-state emptiness):

```tsx
import { useState, useRef, useEffect } from 'react';
import { CuratedRecCard } from './CuratedRecCard';
import { QuietMonthScreen } from './QuietMonthScreen';
import { Button, EmptyState, Icon } from '../../ui';
import { Sparkles, RefreshCw } from 'lucide-react';
import type { Recommendation } from '../../../../shared/types/recommendations.js';
import type { Tier } from '../../ui/TierGate';
import type { CuratedFreshness } from '../../../api/analytics.js';

interface CuratedRecsLayerProps {
  workspaceId: string;
  recommendations: Recommendation[];
  freshness: CuratedFreshness;
  tier: Tier;
  onRespond: (recId: string, action: 'approved' | 'declined' | 'discussing') => void;
  nextCheckIn?: string | null;
  /** Strategy v3 (spec §5.7) — the ?rec= deep-link target; the matching card scrolls into view +
   *  highlights on mount. Optional/absent when the user navigated without a ?rec= param. */
  focusedRecId?: string | null;
}

const VISIBLE_CAP = 5;

/**
 * Strategy v3 (spec §5.4–§5.6) — the ONE curated recs layer. Leads with "Needs your decision · N",
 * shows a 3-segment progress bar (approved / in-discussion / remaining), groups by decision-state
 * when > 3, caps the visible decision set at 5 with "View N more", and renders the done-state when
 * nothing needs a decision. Tri-state emptiness: never_curated (cold-start), curated_but_quiet
 * (the QuietMonthScreen on-track screen), stale_or_failed ("we're refreshing your data").
 */
export function CuratedRecsLayer({
  workspaceId, recommendations, freshness, tier, onRespond, nextCheckIn, focusedRecId,
}: CuratedRecsLayerProps) {
  const [showAll, setShowAll] = useState(false);
  // Strategy v3 — when a ?rec= deep-link lands, expand the full set so the target card is
  // mounted, then scroll it into view + highlight (the receiver half of the two-halves contract).
  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusedRecId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusedRecId]);
  useEffect(() => {
    if (focusedRecId) setShowAll(true); // ensure a capped-out target card is mounted
  }, [focusedRecId]);

  const needsDecision = recommendations.filter(r => r.clientStatus === 'sent');
  const inDiscussion = recommendations.filter(r => r.clientStatus === 'discussing');
  const approved = recommendations.filter(r => r.clientStatus === 'approved');

  // Tri-state emptiness (spec §5.6) — gate the reassuring copy behind the freshness check.
  if (freshness === 'never_curated') {
    return (
      <EmptyState
        icon={Sparkles}
        title="Your recommendations are on the way"
        description="Your strategist is curating the highest-impact moves for your site. You'll get an email the moment they're ready."
      />
    );
  }
  if (freshness === 'stale_or_failed') {
    return (
      <EmptyState
        icon={RefreshCw}
        title="We're refreshing your data"
        description="Your latest recommendations are being recalculated. Check back shortly."
      />
    );
  }

  // curated_but_quiet with nothing needing a decision → the done/quiet screen.
  if (needsDecision.length === 0 && inDiscussion.length === 0) {
    return (
      <div className="space-y-4">
        <p className="t-h2 text-emerald-400">That's everything that needs a decision this month.</p>
        <QuietMonthScreen workspaceId={workspaceId} nextCheckIn={nextCheckIn} />
      </div>
    );
  }

  const total = needsDecision.length + inDiscussion.length + approved.length;
  const visible = showAll ? needsDecision : needsDecision.slice(0, VISIBLE_CAP);
  const hidden = needsDecision.length - visible.length;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="t-h1 text-[var(--brand-text-bright)]">
          Needs your decision · {needsDecision.length}
        </h3>
        {(inDiscussion.length > 0 || approved.length > 0) && (
          <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">
            {approved.length} approved · {inDiscussion.length} in discussion
          </p>
        )}
        {/* 3-segment progress bar: approved / in-discussion / remaining. */}
        {total > 0 && (
          <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div className="bg-emerald-500" style={{ width: `${(approved.length / total) * 100}%` }} />
            <div className="bg-blue-500" style={{ width: `${(inDiscussion.length / total) * 100}%` }} />
            <div className="bg-teal-500/30" style={{ width: `${(needsDecision.length / total) * 100}%` }} />
          </div>
        )}
      </div>

      <div className="space-y-3">
        {visible.map(rec => (
          <div key={rec.id} ref={rec.id === focusedRecId ? focusRef : undefined}>
            <CuratedRecCard workspaceId={workspaceId} rec={rec} tier={tier} onRespond={onRespond} />
          </div>
        ))}
      </div>

      {hidden > 0 && (
        <Button variant="ghost" onClick={() => setShowAll(true)}>View {hidden} more</Button>
      )}

      {/* "In motion" — discussion threads collapse to a compact group below the decisions. */}
      {inDiscussion.length > 0 && (
        <div className="space-y-3 pt-2">
          <p className="t-label text-[var(--brand-text-muted)]">In motion</p>
          {inDiscussion.map(rec => (
            <CuratedRecCard key={rec.id} workspaceId={workspaceId} rec={rec} tier={tier} onRespond={onRespond} />
          ))}
        </div>
      )}
    </div>
  );
}
```

2. Run the component test, see it pass:

```
npx vitest run tests/component/client/CuratedRecsLayer.test.tsx
```

Expected: PASS — "Needs your decision · 2" renders; done-state renders when only approved recs exist.

#### Task 4d.7: Implement `CuratedOverview` (the composition root + hero win proof-strip)

**Files:** `src/components/client/CuratedOverview.tsx`

1. Create the composition (spec §5.1 vertical order: Briefing recap → Layer-1 stand-card → hero win proof-strip → Layer-3 curated recs → done-state). It fetches via Lane 4c's `useCuratedRecommendations` + drives `useRecRespond`; the visibility stand-card is composed in Lane 4e (the orient metrics are wired onto the home read there) — `CuratedOverview` accepts an optional `orient` prop and a `standCard` slot:

```tsx
import { useCuratedRecommendations, useRecRespond } from '../../hooks/client';
import { CuratedRecsLayer } from './curated/CuratedRecsLayer';
import { WinsSurface } from './Briefing/WinsSurface';
import { LoadingState, ErrorState, SectionCard } from '../ui';
import { ErrorBoundary } from '../ErrorBoundary';
import type { Tier } from '../ui/TierGate';
import type { ReactNode } from 'react';

interface CuratedOverviewProps {
  workspaceId: string;
  tier: Tier;
  /** The Layer-1 stand-card (visibility ring + verdict), composed by the host (Lane 4e). */
  standCard?: ReactNode;
  /** The Briefing recap masthead, composed by the host (reuses the briefing trio). */
  briefingRecap?: ReactNode;
  nextCheckIn?: string | null;
  /** Strategy v3 (spec §5.7) — the ?rec= deep-link target id from the host's useSearchParams
   *  (Lane 4e reads it in OverviewTab and passes it here). Threaded to CuratedRecsLayer for
   *  scroll-into-view + highlight. Owned HERE (Lane 4d) so Lane 4e never edits this file. */
  focusedRecId?: string | null;
}

/**
 * Strategy v3 (spec §5) — the curated client overview composition root. Vertical order (locked):
 * Briefing recap → Layer-1 stand-card → hero win proof-strip → Layer-3 curated recs → done-state.
 * Every block hides when empty (quiet months get shorter, not hollow). NO purple. Mounted under
 * the strategy-command-center flag by the host (Lane 4e).
 */
export function CuratedOverview({
  workspaceId, tier, standCard, briefingRecap, nextCheckIn, focusedRecId,
}: CuratedOverviewProps) {
  const { data, isLoading, isError, refetch } = useCuratedRecommendations(workspaceId);
  const respond = useRecRespond(workspaceId);

  const onRespond = (recId: string, action: 'approved' | 'declined' | 'discussing') => {
    respond.mutate({ recId, action });
  };

  if (isLoading) return <LoadingState message="Bringing together your recommendations…" />;
  if (isError) return <ErrorState message="We couldn't load your recommendations." onRetry={refetch} />;

  return (
    <ErrorBoundary>
      <div className="space-y-5">
        {briefingRecap}
        {standCard}
        {/* Hero win proof-strip (spec §5.3, M10) — ABOVE the curated recs. */}
        <SectionCard>
          <WinsSurface workspaceId={workspaceId} />
        </SectionCard>
        <CuratedRecsLayer
          workspaceId={workspaceId}
          recommendations={data?.recommendations ?? []}
          freshness={data?.freshness ?? 'never_curated'}
          tier={tier}
          onRespond={onRespond}
          nextCheckIn={nextCheckIn}
          focusedRecId={focusedRecId}
        />
      </div>
    </ErrorBoundary>
  );
}
```

> **Prop-shape caveat:** confirm `LoadingState` / `ErrorState` / `WinsSurface` accept the props passed (`message`, `onRetry`, `workspaceId`). Read each signature before wiring. If `WinsSurface` needs more than `workspaceId` (e.g. the win rows as a prop), thread them from `CuratedOverviewProps` rather than guessing.

2. `npm run typecheck` — zero errors.

#### Task 4d.8: Verify + commit Lane 4d

1. Lane verify:

```
npm run typecheck
npx vitest run tests/component/client/CuratedRecsLayer.test.tsx
grep -rn "purple-" src/components/client/curated/ src/components/client/CuratedOverview.tsx src/components/ui/InlinePointer.tsx
npx tsx scripts/pr-check.ts
```

Expected: typecheck zero errors; component test passes; the `grep` for `purple-` returns NOTHING (client-facing law); pr-check zero errors.

2. Commit:

```
git add src/components/client/CuratedOverview.tsx src/components/client/curated/ src/components/ui/InlinePointer.tsx tests/component/client/CuratedRecsLayer.test.tsx
git commit -m "Strategy v3 Phase 4d — curated overview UI (CuratedOverview + rec card/layer/discuss thread/quiet-month + InlinePointer)"
```

---

### Lane 4e (opus) — overview integration edits (RUN LAST in Track C)

**Blocked by:** Lane 4c (hooks) + Lane 4d (UI components). `strategyData.strategyUx.orient` is ALREADY on the home read (`ClientDashboard` fetches `useClientStrategy` and passes `strategyData` to `OverviewTab`) — this is **composition, not a net-new server read**. **Coordinate with the in-flight v2 branch** on `StrategyTab.tsx` / `StrategyClientOrientHeader.tsx` / `ClientDashboard.tsx` (those files were churned by v2 on 2026-06-17 — rebase, do not clobber).

**Files (exclusive ownership):**
- `src/components/client/OverviewTab.tsx` — mount `CuratedOverview` under the flag + the `?rec=` receiver
- `src/components/ClientDashboard.tsx` — compose the gated visibility stand-card onto the home composition (orient already on the read)
- `src/components/client/strategy/StrategyClientOrientHeader.tsx` — extract/reuse the visibility stand-card helper
- `src/routes.ts` — `?rec=` is a query param on the existing overview path (no new `ClientTab`); add a `clientPath` doc note only if needed (verify-only on the union)

#### Task 4e.1: Failing test — `?rec=` receiver reads `searchParams.get('rec')`

**Files:** the contract test from Lane 4c (`tests/contract/rec-deep-link-wiring.test.ts`) is the failing test here — it is currently RED because no receiver exists.

1. Confirm it is red:

```
npx vitest run tests/contract/rec-deep-link-wiring.test.ts
```

Expected: FAIL — `expected 0 to be greater than 0` (no `searchParams.get('rec')` receiver yet). This is the gate Lane 4e closes.

#### Task 4e.2: Mount `CuratedOverview` under the flag + wire the `?rec=` receiver in `OverviewTab`

**Files:** `src/components/client/OverviewTab.tsx`

1. Read the existing imports (`grep -n '^import' src/components/client/OverviewTab.tsx`). Add to the existing import groups (top of file — never mid-file):

```ts
import { useSearchParams } from 'react-router-dom';
import { CuratedOverview } from './CuratedOverview';
import type { Tier } from '../ui/TierGate';
```

> `useFeatureFlag` is already imported (line 22); `clientPath` is already imported (line 21). Reuse them.

2. Inside the `OverviewTab` function body, near the existing flag reads (after `const briefingV2Enabled = useFeatureFlag('client-briefing-v2');`, line 117), add the v3 flag + the `?rec=` receiver + the curated branch. The `?rec=` receiver reads the param and threads it into `CuratedOverview` for scroll/highlight (the two-halves contract receiver):

```ts
  // ── Strategy v3 — curated overview (spec §5). When strategy-command-center is ON, the
  // overview body becomes the curated CuratedOverview composition. The ?rec= receiver (the
  // two-halves contract, spec §5.7) reads the param so an InlinePointer chip can deep-link a
  // specific rec into the hub for scroll/highlight. ──
  const curationCockpitEnabled = useFeatureFlag('strategy-command-center');
  const [searchParams] = useSearchParams();
  const focusedRecId = searchParams.get('rec'); // two-halves contract receiver
  if (curationCockpitEnabled) {
    // tier resolves from the workspace; reuse the existing tier source threaded through props
    // (ws.tier or the existing tier helper — read the actual field before wiring).
    const tier = (ws.tier ?? 'free') as Tier;
    return (
      <CuratedOverview
        workspaceId={workspaceId}
        tier={tier}
        focusedRecId={focusedRecId}
      />
    );
  }
```

> **Two notes:** (1) `ws.tier` — confirm the tier field name on `WorkspaceInfo` (`grep -n "tier" src/components/client/types.ts`); if the tier is threaded differently (e.g. a `tier` prop or a `useClientPricing` hook), use that source — do NOT guess. (2) The `focusedRecId?: string | null` prop is **already on `CuratedOverviewProps`** — Lane 4d declares it in Task 4d.7 and threads it down to `CuratedRecsLayer` for scroll-into-view + highlight. Lane 4e therefore only **passes** it (no edit to Lane 4d's file — the cross-lane contract is the prop, owned by 4d). **The `searchParams.get('rec')` read MUST live in `OverviewTab` (this lane's file)** — that is what the contract test asserts, so this task alone turns the test green.

3. `npm run typecheck` — zero errors.

4. Run the contract test, see it pass:

```
npx vitest run tests/contract/rec-deep-link-wiring.test.ts
```

Expected: PASS — `OverviewTab` now reads `searchParams.get('rec')`; the receiver exists.

#### Task 4e.3: Extract the visibility stand-card helper for reuse

**Files:** `src/components/client/strategy/StrategyClientOrientHeader.tsx`

1. Read the file (the `verdict`/`signed`/`positionSub` helpers + `StrategyClientOrientHeader({ orient })` are already there — lines 13–68). The component already renders the CTR-weighted visibility ring + verdict from `orient`. Export it so the home composition can reuse it as the Layer-1 stand-card (spec §5.3). It is currently exported as a named export (`export function StrategyClientOrientHeader`) — verify it is exported; if so, no edit is needed beyond confirming the import path. If it is NOT exported (local-only), add `export`:

```ts
export function StrategyClientOrientHeader({ orient }: StrategyClientOrientHeaderProps) {
```

> The audit notes this is "helper reuse" — the goal is to mount the EXISTING `StrategyClientOrientHeader` as the stand-card, not to duplicate the ring. No new ring component. If the v2 branch already exports it, this task is verify-only.

2. `npm run typecheck` — zero errors.

#### Task 4e.4: Compose the visibility stand-card onto the home overview in `ClientDashboard`

**Files:** `src/components/ClientDashboard.tsx`

1. Read the home composition (`grep -n "OverviewTab\|strategyData\|strategyUx\|orient\|useClientStrategy" src/components/ClientDashboard.tsx`). `strategyData` (with `strategyUx.orient`) is already fetched via `useClientStrategy` and passed to `OverviewTab`. The orient metrics are therefore already available on the home read — Lane 4e's job is to compose `StrategyClientOrientHeader` as the stand-card slot.

Two valid wiring shapes — pick the one matching how `OverviewTab` consumes the curated branch (Task 4e.2):
- **(a)** If `CuratedOverview` reads orient via a `standCard` slot, `OverviewTab` (Task 4e.2) builds `<StrategyClientOrientHeader orient={strategyData?.strategyUx?.orient} />` and passes it as the `standCard` prop. Then `ClientDashboard` needs no edit (orient already flows to `OverviewTab` via `strategyData`).
- **(b)** If `CuratedOverview` should fetch/receive orient directly, thread `orient={strategyData?.strategyUx?.orient}` from `ClientDashboard` → `OverviewTab` → `CuratedOverview`.

Prefer **(a)** — it keeps `ClientDashboard` untouched (lowest collision with the in-flight v2 branch) and composes inside `OverviewTab` which this lane owns. **Update Task 4e.2's curated branch** to pass the stand-card:

```ts
  if (curationCockpitEnabled) {
    const tier = (ws.tier ?? 'free') as Tier;
    return (
      <CuratedOverview
        workspaceId={workspaceId}
        tier={tier}
        focusedRecId={focusedRecId}
        standCard={<StrategyClientOrientHeader orient={strategyData?.strategyUx?.orient ?? undefined} />}
      />
    );
  }
```

…with the import added to `OverviewTab.tsx`:

```ts
import { StrategyClientOrientHeader } from './strategy/StrategyClientOrientHeader';
```

> **Therefore `ClientDashboard.tsx` is verify-only** under shape (a): confirm `strategyData` is already passed to `OverviewTab` (it is — the audit confirms line 707), confirm `strategyData.strategyUx.orient` is the orient path (`grep -n "strategyUx\|orient" shared/types/` and the `ClientKeywordStrategy` type), and make NO edit if it already flows. If a field rename is needed to surface orient on `OverviewTab`'s `strategyData` prop, that is the only `ClientDashboard` edit — coordinate with the v2 branch. Document in the PR which shape was used.

2. `npm run typecheck` — zero errors.

#### Task 4e.5: `routes.ts` — confirm `?rec=` needs no new union value

**Files:** `src/routes.ts`

1. `?rec=` is a query param on the existing overview path (`clientPath(workspaceId)` → `/client/:workspaceId`), NOT a new `ClientTab`. Confirm no `ClientTab` change is needed (`grep -n "ClientTab\|clientPath" src/routes.ts`). The receiver reads `useSearchParams` (Task 4e.2); the sender (an `InlinePointer`) builds `` `${clientPath(workspaceId)}?rec=${recId}` ``. Add a one-line doc comment above `clientPath` noting the `?rec=` overview deep-link contract (mirrors the `?tab=` note), if the file documents query-param contracts; otherwise this task is verify-only:

```ts
// Note: the client overview accepts a `?rec=<recId>` deep-link (Strategy v3, spec §5.7) — the
// InlinePointer chip sends it, OverviewTab reads it via useSearchParams (two-halves contract).
```

2. `npm run typecheck` — zero errors.

#### Task 4e.6: Full Phase-4 verify + commit Lane 4e

1. Full Phase-4 verification (all lanes integrated):

```
npm run typecheck
npx vite build
npx vitest run tests/integration/public-rec-respond.test.ts tests/contract/rec-deep-link-wiring.test.ts tests/unit/client/useCuratedRecommendations.test.tsx tests/unit/client/useRecRespond.test.tsx tests/unit/client/useRecDiscussion.test.tsx tests/component/client/CuratedRecsLayer.test.tsx
npx tsx scripts/pr-check.ts
grep -rn "purple-" src/components/client/curated/ src/components/client/CuratedOverview.tsx
```

Expected: typecheck zero errors; build succeeds; all Phase-4 tests pass (including the now-green `?rec=` contract test); pr-check zero errors; no `purple-` in client curated UI.

2. Commit:

```
git add src/components/client/OverviewTab.tsx src/components/client/strategy/StrategyClientOrientHeader.tsx src/components/ClientDashboard.tsx src/routes.ts
git commit -m "Strategy v3 Phase 4e — mount CuratedOverview under flag + ?rec= receiver + visibility stand-card composition"
```

---

## Phase exit gates

Before Phase 4 merges to `staging` (run from the integrated branch, all four lanes landed):

- [ ] `npm run typecheck` — zero errors (`tsc -b`, both app + node configs).
- [ ] `npx vite build` — builds successfully.
- [ ] `npx vitest run` — **full suite** passes (not just Phase-4 tests).
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (public mutation routes call `addActivity` + `broadcastToWorkspace`; all client hooks use `useQuery`/`useMutation` with `client-`-prefixed keys; no bare `JSON.parse`).
- [ ] **Phase-4 contract/integration tests green:**
  - `tests/integration/public-rec-respond.test.ts` — respond mutates `clientStatus` only (never `RecStatus`); illegal client transition → 400; `requireClientOwner` denies member (403) + sessionless (401), admits owner; curated read leaks no admin-only key (`throttledUntil`/`struckAt`/`emvPerWeek`).
  - `tests/contract/rec-deep-link-wiring.test.ts` — every `?rec=` sender targets a `searchParams.get('rec')` receiver (green only after Lane 4e mounts the receiver).
  - `tests/unit/client/useCuratedRecommendations.test.tsx`, `tests/unit/client/useRecRespond.test.tsx`, `tests/unit/client/useRecDiscussion.test.tsx` — hooks call the right endpoints + invalidate the curated key.
  - `tests/component/client/CuratedRecsLayer.test.tsx` — "Needs your decision · N" lead + done-state.
- [ ] **Flag-OFF byte-identical:** with `strategy-command-center` OFF, `OverviewTab` renders the unchanged (Phase-0 command-center) body and the public read is byte-identical (the curated read is a separate endpoint + key; the shared `queryKeys.shared.recommendations` key is untouched).
- [ ] **No purple in client-facing curated UI:** `grep -rn "purple-" src/components/client/curated/ src/components/client/CuratedOverview.tsx src/components/ui/InlinePointer.tsx` returns nothing.
- [ ] **Parallel-lane review:** Phase 4 used 4 parallel lanes → invoke `scaled-code-review` before merge; fix every surfaced bug in-PR (no "pre-existing/out-of-scope" deferral). Confirm no duplicate `respondToCuratedRec`/freshness-logic reimplementation across lanes.
- [ ] `FEATURE_AUDIT.md` + `data/roadmap.json` updated for the Phase-4 client curated overview (per CLAUDE.md post-task protocol; the barrel/docs sweep is Phase 5 Lane 5F — Phase 4 appends its own audit entry).


---

## Phase 5 — reconcile/retire + enrichment (Stage 3)

**Goal:** with the v3 curated overview (Phase 4 / Track C) and the admin cockpit (Phase 2) merged, sweep away the now-double-shown legacy surfaces (spec §9) so the client overview and strategy tab read clean against the v3 composition, graft the surviving disclosures onto their v3 hosts, and ship three enrichment items the v3 spine unlocks: #6b keyword-opportunity typed-send, #9 cluster add/remove/research, and #8a brief pre-seed `strategyCardContext` on the Standalone path. **What merges before it:** Phase 0 (v2 cutover — the `strategy-command-center` flag-OFF baseline IS the command-center), Phase 1 (lifecycle contracts), Phase 2 (cockpit + per-row Send + `StrategyRecommendationPayload` adapter), Phase 4 / Track C (curated overview — the sole importer of every §9 retire target). **Exit gate:** every retire-sweep deletion is grep-confirmed unreferenced on the **flag-OFF** branch first (the command-center baseline must stay byte-identical and importable); 5C/5D enrichment renders only under `strategy-command-center` ON; `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts` green.

**Blocked-by recap (honor before dispatch):**
- **Lane 5A** [opus] — HARD after Phase 4 / Track C merge (every retire target's sole importer is a Phase-4 file).
- **Lane 5B** [sonnet] — after Phase 4 / Track C merge.
- **Lane 5C** [opus] — after Phase 2 merge (consumes `StrategyRecommendationPayload` + per-row Send from `00-contracts.md` §11 / P2).
- **Lane 5D** [sonnet] — soft after Phase 3 (reads `recResponses` read-only; can start once P2 merges).
- **Lane 5E** [sonnet] — isolated server work; no hard block.
- **Lane 5F** [haiku] — LAST, after 5A–5E land (barrel + docs reconcile).

> **Cross-track note (controller):** 5A and 5B both delete from files Phase 4 just rewrote (`OverviewTab.tsx`, `StrategyTab.tsx`). They MUST run after the Phase-4 merge is on `staging` and green. 5C/5D/5E are file-disjoint from 5A/5B and from each other — they can run in parallel with 5A/5B once their own blockers clear. 5F runs strictly last (it reconciles the barrel + appends docs every other lane touched).

---

### Lane 5A — client overview retire sweep (opus)

> **Blocked by:** Phase 4 / Track C merge (HARD). Every target below is double-shown once the v3 `CuratedOverview` mounts. Multi-importer components (`MonthlyDigest` = 5 importers, `InsightsDigest` = 3 importers incl. admin `BriefingReviewQueue`) are **UN-MOUNTED here only — never file-deleted.** Sole-importer cards (`PredictionShowcaseCard`, `IntelligenceSummaryCard`, `HealthScoreCard`) are owned by Lane 5B; 5A only removes their **import + mount** from `OverviewTab.tsx`, 5B deletes/grafts the files.
>
> **Files:** `src/components/client/OverviewTab.tsx`; `src/components/client/Briefing/InsightsBriefingPage.tsx`; `src/components/shared/ContentGapRow.tsx`

#### Task 5A.1: Grep-confirm zero flag-OFF references before any delete

**Files:** (read-only investigation)

1. Confirm the command-center (flag-OFF baseline) still mounts `CuratedOverview` under the flag and that the legacy body is what gets removed. Run:
   ```
   grep -n "CuratedOverview\|useFeatureFlag('strategy-command-center')\|FeatureFlag flag=\"strategy-command-center\"" src/components/client/OverviewTab.tsx
   ```
   **Expected:** at least one match mounting `CuratedOverview` inside a `strategy-command-center` gate (added by Phase 4 Lane 4e). If zero matches, STOP — Phase 4 has not merged; this lane is not unblocked.
2. Confirm `MonthlyDigest` and `InsightsDigest` have importers OTHER than `OverviewTab.tsx` (so they must be un-mounted, not file-deleted):
   ```
   grep -rln "MonthlyDigest" src/ | grep -v "MonthlyDigest.tsx"
   grep -rln "InsightsDigest" src/ | grep -v "InsightsDigest.tsx"
   ```
   **Expected:** `MonthlyDigest` → `OverviewTab.tsx`, `Briefing/FreeTierUpgradeCTA.tsx`, `Briefing/InsightsBriefingPage.tsx`, `hooks/client/index.ts`, `hooks/client/useMonthlyDigest.ts`. `InsightsDigest` → `admin/BriefingReviewQueue.tsx`, `OverviewTab.tsx`, `Briefing/InsightsBriefingPage.tsx`. Both have non-OverviewTab importers ⇒ **un-mount only.**
3. No commit (investigation only). Record the result inline in the PR description.

#### Task 5A.2: Write the failing component test that asserts the legacy overview body is gone under the flag

**Files:** `src/components/client/OverviewTab.tsx` (test target — the test file is owned by Phase 4 Lane 4c/5F reconcile, so add the assertion inline to the existing flag-ON test if present; otherwise add a focused assertion block). For this lane, add the assertions to the existing `tests/component/client` coverage by extending the nearest existing OverviewTab test. If none exists, create `tests/component/client/OverviewTab.retire.test.tsx`:

1. Create `tests/component/client/OverviewTab.retire.test.tsx`:
   ```tsx
   import { describe, it, expect, vi } from 'vitest';
   import { render, screen } from '@testing-library/react';
   import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
   import { MemoryRouter } from 'react-router-dom';
   import { OverviewTab } from '../../../src/components/client/OverviewTab';

   // Flag ON → the v3 CuratedOverview owns the body; the legacy #1-Priority,
   // CTA banner, StatCard grid, Recent-Work timeline, and Content-Opportunities
   // preview must be GONE (spec §9 retire inventory).
   vi.mock('../../../src/hooks/useFeatureFlag', () => ({
     useFeatureFlag: (flag: string) => flag === 'strategy-command-center',
   }));

   function renderOverview() {
     const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
     return render(
       <QueryClientProvider client={qc}>
         <MemoryRouter>
           <OverviewTab workspaceId="ws_test" ws={{ id: 'ws_test', name: 'Test', tier: 'premium' } as never} betaMode={false} navigate={() => {}} />
         </MemoryRouter>
       </QueryClientProvider>,
     );
   }

   describe('OverviewTab v3 retire sweep (flag ON)', () => {
     it('does not render the legacy #1 Priority card', () => {
       renderOverview();
       expect(screen.queryByText(/#1 Priority/i)).toBeNull();
     });
     it('does not render the legacy Recent Work timeline section', () => {
       renderOverview();
       expect(screen.queryByText(/^Recent Work$/)).toBeNull();
     });
     it('does not render the legacy Content Opportunities preview', () => {
       renderOverview();
       expect(screen.queryByText(/^Content Opportunities$/)).toBeNull();
     });
   });
   ```
2. Run it — see it fail (the legacy regions still render):
   ```
   npx vitest run tests/component/client/OverviewTab.retire.test.tsx
   ```
   **Expected:** FAIL — `#1 Priority` / `Recent Work` / `Content Opportunities` still present.
3. Commit the failing test:
   ```
   git add tests/component/client/OverviewTab.retire.test.tsx
   git commit -m "test(strategy-v3): assert legacy overview body retired under flag (5A)"
   ```

#### Task 5A.3: Remove the inline `#1 Priority` region from `OverviewTab.tsx`

**Files:** `src/components/client/OverviewTab.tsx`

1. Read the exact region first (it begins at the comment near line 287):
   ```
   grep -n "#1 Priority" src/components/client/OverviewTab.tsx
   ```
2. Delete the entire `{/* #1 Priority — single reconciled top recommendation from the ranked engine. */}` JSX block (the comment through its closing `)}` / `</…>`). Use Read to capture the precise span, then Edit it out. The block renders the top reconciled recommendation card — now owned by `CuratedRecsLayer` in `CuratedOverview`.
3. Run the test — the `#1 Priority` assertion now passes:
   ```
   npx vitest run tests/component/client/OverviewTab.retire.test.tsx -t "#1 Priority"
   ```
   **Expected:** PASS for the `#1 Priority` case.
4. Commit:
   ```
   git add src/components/client/OverviewTab.tsx
   git commit -m "refactor(strategy-v3): retire inline #1 Priority card from OverviewTab (5A)"
   ```

#### Task 5A.4: Remove the contextual CTA banner

**Files:** `src/components/client/OverviewTab.tsx`

1. Locate: `grep -n "Primary CTA Banner" src/components/client/OverviewTab.tsx` (near line 347).
2. Read the span, then Edit out the entire `{/* Primary CTA Banner - contextual next action */}` block through its closing JSX. The curated overview's `CuratedRecsLayer` is the single decision surface now (spec §9 "Retire: the ungated contextual CTA banner").
3. Verify build still compiles: `npx vite build` → **Expected:** builds (no dangling refs).
4. Commit:
   ```
   git add src/components/client/OverviewTab.tsx
   git commit -m "refactor(strategy-v3): retire contextual CTA banner from OverviewTab (5A)"
   ```

#### Task 5A.5: Remove the duplicate StatCard grid

**Files:** `src/components/client/OverviewTab.tsx`

1. Locate: `grep -n "Key metrics — full-span StatCards\|<StatCard" src/components/client/OverviewTab.tsx` (comment near line 181, `<StatCard` mounts near 229).
2. Read the span, then Edit out the `{/* Key metrics — full-span StatCards */}` region and the `<StatCard … />` grid it wraps. The v3 stand-card uses the briefing `PulseStrip` lean single-line stats instead (spec §5.3 "retire the duplicate StatCard grid").
3. If `StatCard` is now unused, remove it from the `'../ui'` import on line 15 (read line 15, drop only `StatCard` from the destructured list; keep `MetricRing, Icon, Button, ClickableRow, SectionCard, Badge, FreshnessStamp`). Confirm with:
   ```
   grep -n "StatCard" src/components/client/OverviewTab.tsx
   ```
   **Expected:** zero matches after the edit.
4. `npx vite build` → **Expected:** builds.
5. Commit:
   ```
   git add src/components/client/OverviewTab.tsx
   git commit -m "refactor(strategy-v3): retire duplicate StatCard grid from OverviewTab (5A)"
   ```

#### Task 5A.6: Remove the legacy Recent-Work timeline section

**Files:** `src/components/client/OverviewTab.tsx`

1. Locate: `grep -n 'title="Recent Work"' src/components/client/OverviewTab.tsx` (near line 603).
2. Read the span, then Edit out the entire `<SectionCard title="Recent Work" …>…</SectionCard>` block. The quiet-month screen promotes `AgencyWorkFeed`'s in-progress list instead (spec §5.5 / §9 "Retire: the legacy Recent-Work timeline").
3. If `Activity` (the lucide icon used only by Recent Work) is now unused, remove it from its import. Confirm: `grep -n "Activity" src/components/client/OverviewTab.tsx` → drop the import line only if zero remaining uses.
4. Run the full retire test — `Recent Work` assertion passes:
   ```
   npx vitest run tests/component/client/OverviewTab.retire.test.tsx -t "Recent Work"
   ```
   **Expected:** PASS.
5. Commit:
   ```
   git add src/components/client/OverviewTab.tsx
   git commit -m "refactor(strategy-v3): retire Recent-Work timeline from OverviewTab (5A)"
   ```

#### Task 5A.7: Remove the Content-Opportunities sidebar preview

**Files:** `src/components/client/OverviewTab.tsx`

1. Locate: `grep -n 'title="Content Opportunities"' src/components/client/OverviewTab.tsx` (near line 558).
2. Read the span, then Edit out the entire `<SectionCard title="Content Opportunities" …>…</SectionCard>` preview block. Content gaps now route through the curated recs layer (spec §9 "Retire: the Content-Opportunities sidebar preview").
3. Run the full retire test:
   ```
   npx vitest run tests/component/client/OverviewTab.retire.test.tsx
   ```
   **Expected:** all three cases PASS.
4. Commit:
   ```
   git add src/components/client/OverviewTab.tsx
   git commit -m "refactor(strategy-v3): retire Content-Opportunities preview from OverviewTab (5A)"
   ```

#### Task 5A.8: UN-MOUNT the four multi-importer / sole-importer cards (never file-delete the shared ones)

**Files:** `src/components/client/OverviewTab.tsx`

1. Locate the four mounts:
   ```
   grep -n "<MonthlyDigest\|<IntelligenceSummaryCard\|<PredictionShowcaseCard\|<InsightsDigest" src/components/client/OverviewTab.tsx
   ```
   **Expected:** `<MonthlyDigest` ~428, `<IntelligenceSummaryCard` ~434, `<PredictionShowcaseCard` ~452, `<InsightsDigest` ~460.
2. Edit out each of the four JSX mounts (and the conditional wrappers they sit in, e.g. the `clientIntel?.weCalledIt !== undefined && <PredictionShowcaseCard …/>` ternary). These surfaces are absorbed into the one curated recs layer (spec §9).
3. Remove the now-unused imports on lines 5, 6, 8, 18:
   ```
   // delete:
   import { MonthlyDigest } from './MonthlyDigest';
   import { IntelligenceSummaryCard } from './IntelligenceSummaryCard';
   import { PredictionShowcaseCard } from './PredictionShowcaseCard';
   import { InsightsDigest } from './InsightsDigest';
   ```
   **Do NOT** delete `MonthlyDigest.tsx` (5 importers) or `InsightsDigest.tsx` (3 importers incl. admin `BriefingReviewQueue`) — file-deletion would break `Briefing/InsightsBriefingPage.tsx`, `Briefing/FreeTierUpgradeCTA.tsx`, and `admin/BriefingReviewQueue.tsx`. `PredictionShowcaseCard.tsx` + `IntelligenceSummaryCard.tsx` files are owned by Lane 5B (it deletes them after confirming OverviewTab was their sole importer).
4. Also remove the `HealthScoreCard` mount (line ~175) and its import (line 7) — the visibility-score ring with the grafted breakdown disclosure replaces it (5B owns `HealthScoreCard.tsx`):
   ```
   grep -n "<HealthScoreCard\|import { HealthScoreCard }" src/components/client/OverviewTab.tsx
   ```
   Edit out both.
5. Verify zero dangling references:
   ```
   grep -n "MonthlyDigest\|IntelligenceSummaryCard\|PredictionShowcaseCard\|InsightsDigest\|HealthScoreCard" src/components/client/OverviewTab.tsx
   ```
   **Expected:** zero matches.
6. `npm run typecheck` → **Expected:** zero errors. `npx vite build` → **Expected:** builds.
7. Commit:
   ```
   git add src/components/client/OverviewTab.tsx
   git commit -m "refactor(strategy-v3): un-mount Monthly/Intelligence/Prediction/Insights/Health cards from OverviewTab (5A)"
   ```

#### Task 5A.9: Reconcile `InsightsBriefingPage.tsx` — absorb RecommendedForYou/ActionQueueStrip duplication

**Files:** `src/components/client/Briefing/InsightsBriefingPage.tsx`

1. Identify the v3-absorbed surfaces still rendered here that the curated recs layer now owns:
   ```
   grep -n "RecommendedForYou\|ActionQueueStrip\|InsightsDigest\|MonthlyDigest" src/components/client/Briefing/InsightsBriefingPage.tsx
   ```
2. For each that is gated behind `strategy-command-center` ON elsewhere, wrap (or remove) the duplicate render so it does NOT double-show with `CuratedRecsLayer`. Read the surrounding flag gate; if the briefing page is the flag-OFF surface (command-center baseline keeps it), guard the duplicate with the flag so it renders ONLY when the curated layer is absent. Concretely, if `RecommendedForYou` / `ActionQueueStrip` mount unconditionally, wrap them:
   ```tsx
   {!commandCenterEnabled && <RecommendedForYou … />}
   {!commandCenterEnabled && <ActionQueueStrip … />}
   ```
   where `commandCenterEnabled = useFeatureFlag('strategy-command-center')` (add the hook import if absent — top of file, grouped with existing imports).
3. `npx vite build` → **Expected:** builds.
4. Commit:
   ```
   git add src/components/client/Briefing/InsightsBriefingPage.tsx
   git commit -m "refactor(strategy-v3): stop double-showing absorbed recs in InsightsBriefingPage under flag (5A)"
   ```

#### Task 5A.10: Reconcile `ContentGapRow.tsx` audience variants

**Files:** `src/components/shared/ContentGapRow.tsx`

1. This shared primitive is imported by `Briefing/RecommendedForYou`, `client/strategy/StrategyContentOpportunitiesSection`, and `strategy/ContentGaps` (admin). Phase 4 reframed the client-facing audience variant. Confirm no admin/client variant drift was introduced:
   ```
   grep -n "audience\|variant\|client\|admin" src/components/shared/ContentGapRow.tsx
   ```
2. If Phase 4 added a client-narrative variant prop, ensure the admin caller (`strategy/ContentGaps`) still passes the admin variant (no purple, admin jargon allowed). If both variants already coexist cleanly, this task is a verify-only no-op — record "no reconcile needed" in the PR. If a drift exists (e.g. a hardcoded client string leaking into the admin path), fix it to drive off the `audience`/`variant` prop.
3. Verify no client-facing purple leaked: `grep -rn "purple-" src/components/shared/ContentGapRow.tsx` → **Expected:** zero matches.
4. `npx vite build` → **Expected:** builds. If a change was made, commit:
   ```
   git add src/components/shared/ContentGapRow.tsx
   git commit -m "refactor(strategy-v3): reconcile ContentGapRow audience variants (5A)"
   ```

#### Task 5A.11: Lane 5A verification

**Files:** (verification only)

1. `npx vitest run tests/component/client/OverviewTab.retire.test.tsx` → **Expected:** all PASS.
2. `npm run typecheck` → **Expected:** zero errors.
3. `npx vite build` → **Expected:** builds.
4. `npx tsx scripts/pr-check.ts` → **Expected:** zero errors.
5. Final grep gate (no dangling refs, no client purple in touched files):
   ```
   grep -rn "purple-" src/components/client/OverviewTab.tsx src/components/client/Briefing/InsightsBriefingPage.tsx src/components/shared/ContentGapRow.tsx
   ```
   **Expected:** zero matches.

---

### Lane 5B — client strategy-tab retire + visibility-score breakdown graft (sonnet)

> **Blocked by:** Phase 4 / Track C merge. Phase 4 rewrote `StrategyTab.tsx` composition and wired the CTR-weighted visibility score onto the home read. This lane retires the legacy gated surfaces inside the strategy tab and grafts `HealthScoreCard`'s "what makes up this score" disclosure onto the v3 visibility-score ring.
>
> **Files:** `src/components/client/StrategyTab.tsx`; `src/components/client/PredictionShowcaseCard.tsx`; `src/components/client/IntelligenceSummaryCard.tsx`; `src/components/client/HealthScoreCard.tsx`

#### Task 5B.1: Confirm sole-importer status before file-deleting Prediction/Intelligence cards

**Files:** (read-only investigation)

1. After Lane 5A un-mounted these from `OverviewTab`, confirm `PredictionShowcaseCard` and `IntelligenceSummaryCard` have NO remaining importers besides their own files:
   ```
   grep -rln "PredictionShowcaseCard" src/ | grep -v "PredictionShowcaseCard.tsx"
   grep -rln "IntelligenceSummaryCard" src/ | grep -v "IntelligenceSummaryCard.tsx"
   ```
   **Expected:** zero lines each (5A removed the OverviewTab import). If any importer remains, STOP and un-mount it first — do not file-delete a still-imported component.
2. Record the result in the PR description. No commit.

#### Task 5B.2: Write the failing test — visibility-score breakdown disclosure exists, legacy /100 score gone

**Files:** `tests/component/client/StrategyTab.test.tsx` (existing — extend it)

1. Read the existing test to match its render harness, then add a describe block:
   ```tsx
   describe('StrategyTab v3 retire + visibility-score breakdown graft (flag ON)', () => {
     it('renders the visibility-score breakdown disclosure (grafted from HealthScoreCard)', async () => {
       // render StrategyTab with strategy-command-center ON and strategyData carrying
       // strategyUx.orient.visibilityScore — mirror the existing test's setup
       // then assert the "what makes up this score" / "Score breakdown" disclosure is present
       expect(await screen.findByText(/what makes up this score/i)).toBeTruthy();
     });
     it('does not render the legacy Snapshot /100 headline score', () => {
       // assert no element shows the "/100" double-score headline (spec §9)
       expect(screen.queryByText(/\/100/)).toBeNull();
     });
   });
   ```
   Use the existing test file's mock/render scaffolding for the flag and `strategyData` props (do not invent a new harness).
2. Run it — see it fail:
   ```
   npx vitest run tests/component/client/StrategyTab.test.tsx -t "v3 retire"
   ```
   **Expected:** FAIL — the breakdown disclosure isn't grafted yet and/or `/100` still renders.
3. Commit:
   ```
   git add tests/component/client/StrategyTab.test.tsx
   git commit -m "test(strategy-v3): assert visibility-score breakdown graft + /100 retire (5B)"
   ```

#### Task 5B.3: Graft the breakdown disclosure onto the visibility score

**Files:** `src/components/client/StrategyTab.tsx`, `src/components/client/HealthScoreCard.tsx`

1. Read `HealthScoreCard.tsx` and locate its expandable "what makes up this score" disclosure (the breakdown list + toggle). This is the piece spec §5.3 says to graft onto the gated CTR-weighted visibility score.
2. Extract the disclosure into a small presentational sub-component within `HealthScoreCard.tsx` and export it (so the ring host can mount it without the full card):
   ```tsx
   // HealthScoreCard.tsx — export the breakdown disclosure for the v3 visibility-score ring graft.
   export function ScoreBreakdownDisclosure({ factors }: { factors: Array<{ label: string; contribution: number }> }) {
     // …the existing expandable "what makes up this score" markup, driven by `factors`…
   }
   ```
   Keep `HealthScoreCard` itself intact for now (deleted in 5B.5 only after the disclosure is grafted and no importer remains).
3. In `StrategyTab.tsx`, mount `ScoreBreakdownDisclosure` directly beneath the v3 visibility-score ring (the `StrategyClientOrientHeader` `visibilityScore`), passing the score factors from `strategyData.strategyUx.orient`. Add the import grouped with existing imports.
4. Run the breakdown assertion:
   ```
   npx vitest run tests/component/client/StrategyTab.test.tsx -t "breakdown disclosure"
   ```
   **Expected:** PASS.
5. Commit:
   ```
   git add src/components/client/StrategyTab.tsx src/components/client/HealthScoreCard.tsx
   git commit -m "feat(strategy-v3): graft score-breakdown disclosure onto visibility ring (5B)"
   ```

#### Task 5B.4: Retire NextSteps / Snapshot /100 / RefreshSummary / interior TabBar from StrategyTab

**Files:** `src/components/client/StrategyTab.tsx`

1. Locate the legacy gated surfaces:
   ```
   grep -n "NextSteps\|StrategyNextSteps\|Snapshot\|/100\|RefreshSummary\|StrategyRefreshSummary\|TabBar" src/components/client/StrategyTab.tsx
   ```
2. Remove, in separate Edits:
   - the `StrategyNextStepsSection` render (absorbed into the curated recs layer — spec §9);
   - the `StrategySnapshotSection` `/100` **headline score** (keep only its 4-tile counts if the tab still shows them; delete the double-score headline + the Snapshot ring per spec §9);
   - the `StrategyRefreshSummarySection` separate surface (its New/Moved/Retired framing folds into the Briefing change-context — spec §5.2);
   - the gated **interior `TabBar` IA** (the v3 strategy tab links into workbench surfaces, it does not embed an interior tab switcher — spec §9).
3. Remove now-unused imports for any fully-deleted section. Verify:
   ```
   grep -n "StrategyNextSteps\|StrategyRefreshSummary" src/components/client/StrategyTab.tsx
   ```
   **Expected:** zero matches.
4. Run the `/100` retire assertion:
   ```
   npx vitest run tests/component/client/StrategyTab.test.tsx -t "/100"
   ```
   **Expected:** PASS.
5. `npx vite build` → **Expected:** builds.
6. Commit:
   ```
   git add src/components/client/StrategyTab.tsx
   git commit -m "refactor(strategy-v3): retire NextSteps/Snapshot-/100/RefreshSummary/interior-TabBar from StrategyTab (5B)"
   ```

#### Task 5B.5: File-delete the now-orphaned Prediction + Intelligence cards

**Files:** `src/components/client/PredictionShowcaseCard.tsx`; `src/components/client/IntelligenceSummaryCard.tsx`; `tests/component/client/IntelligenceSummaryCard.test.tsx`

1. Re-confirm zero importers (5A removed the OverviewTab mounts; 5B.4 may have removed any strategy-tab mount):
   ```
   grep -rln "PredictionShowcaseCard" src/ | grep -v "PredictionShowcaseCard.tsx"
   grep -rln "IntelligenceSummaryCard" src/ | grep -v "IntelligenceSummaryCard.tsx"
   ```
   **Expected:** zero lines each. If non-empty, STOP — do not delete.
2. Delete the component files and the orphaned test:
   ```
   git rm src/components/client/PredictionShowcaseCard.tsx
   git rm src/components/client/IntelligenceSummaryCard.tsx
   git rm tests/component/client/IntelligenceSummaryCard.test.tsx
   ```
3. `npm run typecheck` → **Expected:** zero errors (no dangling imports). `npx vite build` → **Expected:** builds.
4. Commit:
   ```
   git commit -m "chore(strategy-v3): delete orphaned PredictionShowcaseCard + IntelligenceSummaryCard (5B)"
   ```

#### Task 5B.6: Decide HealthScoreCard's fate (delete the card, keep the grafted disclosure)

**Files:** `src/components/client/HealthScoreCard.tsx`

1. Confirm `HealthScoreCard` (the full card) has no remaining importers — only `ScoreBreakdownDisclosure` (the extracted export) is consumed by `StrategyTab`:
   ```
   grep -rln "HealthScoreCard" src/ | grep -v "HealthScoreCard.tsx"
   ```
   **Expected:** `StrategyTab.tsx` (importing `ScoreBreakdownDisclosure`). No importer of the default `HealthScoreCard` component.
2. Delete the full-card `HealthScoreCard` component from the file, keeping ONLY the exported `ScoreBreakdownDisclosure` (rename the file's remaining content accordingly; do NOT rename the file path — `StrategyTab` imports from `./HealthScoreCard`). Remove any now-unused imports inside the file.
3. `npm run typecheck` → **Expected:** zero errors.
4. Commit:
   ```
   git add src/components/client/HealthScoreCard.tsx
   git commit -m "refactor(strategy-v3): reduce HealthScoreCard to the grafted ScoreBreakdownDisclosure (5B)"
   ```

#### Task 5B.7: Lane 5B verification

**Files:** (verification only)

1. `npx vitest run tests/component/client/StrategyTab.test.tsx` → **Expected:** PASS (incl. the new v3 block).
2. `npm run typecheck` → **Expected:** zero errors.
3. `npx vite build` → **Expected:** builds.
4. `grep -rn "purple-" src/components/client/StrategyTab.tsx src/components/client/HealthScoreCard.tsx` → **Expected:** zero (client-facing, no purple).
5. `npx tsx scripts/pr-check.ts` → **Expected:** zero errors.

---

### Lane 5C — #6b keyword-opportunity typed-send (opus)

> **Blocked by:** Phase 2 merge (consumes `StrategyRecommendationPayload` from `00-contracts.md` §11 + the per-row Send endpoint built in P2). The **gating sub-task** is typing the bare `opportunities: string[]` — done via the parallel `opportunitiesDetailed?` field pre-committed in `00-contracts.md` §12b (the bare `string[]` stays for the byte-identical read path).
>
> **Files:** `shared/types/keyword-strategy.ts`; `server/routes/public-content.ts`; `src/components/strategy/KeywordOpportunities.tsx`

#### Task 5C.1: Confirm the §12b `opportunitiesDetailed` field landed in Phase 1

**Files:** (read-only investigation)

1. The parallel typed field is a **Phase-1 Lane-1A pre-commit** (`00-contracts.md` §12b). Confirm it merged:
   ```
   grep -n "opportunitiesDetailed" shared/types/keyword-strategy.ts
   ```
   **Expected:** the optional `opportunitiesDetailed?: Array<{ keyword: string; volume?: number; difficulty?: number; rationale?: string }>` field present on `StoredKeywordStrategy`. If absent, STOP — Phase 1 has not merged this contract; this lane is blocked.
2. Confirm `StrategyRecommendationPayload` exists (the adapter shape 5C emits):
   ```
   grep -n "StrategyRecommendationPayload" shared/types/recommendations.ts
   ```
   **Expected:** the interface from `00-contracts.md` §11. If absent, STOP.
3. No commit.

#### Task 5C.2: Write the failing test — public-content serializes `opportunitiesDetailed`

**Files:** `tests/integration/public-content-routes-extended.test.ts` (existing — extend it)

1. Read the existing test's setup helper (workspace seed + public GET). Add a case asserting the public strategy read now includes the typed `opportunitiesDetailed` array when present, parallel to the bare `opportunities` string list:
   ```ts
   it('serializes opportunitiesDetailed alongside bare opportunities on the public strategy read', async () => {
     // seed a workspace whose keyword strategy has opportunitiesDetailed populated
     // (use the existing seed helper; set opportunitiesDetailed: [{ keyword: 'dental implants cost', volume: 1200, difficulty: 34, rationale: 'high intent, low coverage' }])
     const res = await fetch(`${baseUrl}/api/public/content/${workspaceId}/strategy`);
     const body = await res.json();
     expect(Array.isArray(body.opportunities)).toBe(true);              // byte-identical bare list stays
     expect(Array.isArray(body.opportunitiesDetailed)).toBe(true);      // new typed list
     expect(body.opportunitiesDetailed[0]).toMatchObject({ keyword: 'dental implants cost', volume: 1200 });
   });
   ```
   Match the actual public strategy endpoint path the existing tests hit (read the file to confirm — it is the public-content strategy serialization at the route owning lines ~143–257).
2. Run it — see it fail:
   ```
   npx vitest run tests/integration/public-content-routes-extended.test.ts -t "opportunitiesDetailed"
   ```
   **Expected:** FAIL — `body.opportunitiesDetailed` is undefined (route doesn't serialize it yet).
3. Commit:
   ```
   git add tests/integration/public-content-routes-extended.test.ts
   git commit -m "test(strategy-v3): public read serializes opportunitiesDetailed (5C)"
   ```

#### Task 5C.3: Serialize `opportunitiesDetailed` on the public strategy read

**Files:** `server/routes/public-content.ts`

1. The bare list serializes at line 210 (`opportunities: strategy?.opportunities || []`). Add the parallel typed list directly after it (allow-list — only the four client-safe fields):
   ```ts
   opportunities: strategy?.opportunities || [],
   // Strategy v3 (#6b) — typed opportunities backing the per-row "interested?" send.
   // Parallel to the bare list above (which stays for the byte-identical read path).
   // Allow-list: only keyword/volume/difficulty/rationale — no admin-only scoring fields.
   opportunitiesDetailed: (strategy?.opportunitiesDetailed || []).map(o => ({
     keyword: o.keyword,
     volume: o.volume,
     difficulty: o.difficulty,
     rationale: o.rationale,
   })),
   ```
2. Run the test:
   ```
   npx vitest run tests/integration/public-content-routes-extended.test.ts -t "opportunitiesDetailed"
   ```
   **Expected:** PASS.
3. `npm run typecheck` → **Expected:** zero errors.
4. Commit:
   ```
   git add server/routes/public-content.ts
   git commit -m "feat(strategy-v3): serialize opportunitiesDetailed on public strategy read (5C)"
   ```

#### Task 5C.4: Write the failing component test — KeywordOpportunities renders an "Interested?" send affordance

**Files:** `tests/component/strategy/KeywordOpportunities.test.tsx` (create)

1. Create the test:
   ```tsx
   import { describe, it, expect, vi } from 'vitest';
   import { render, screen, fireEvent } from '@testing-library/react';
   import { KeywordOpportunities } from '../../../src/components/strategy/KeywordOpportunities';

   describe('KeywordOpportunities #6b typed-send', () => {
     it('renders an "Interested?" send button per detailed opportunity and emits the payload on click', () => {
       const onSend = vi.fn();
       render(
         <KeywordOpportunities
           opportunities={['dental implants cost']}
           opportunitiesDetailed={[{ keyword: 'dental implants cost', volume: 1200, difficulty: 34, rationale: 'high intent, low coverage' }]}
           workspaceId="ws_test"
           onSendOpportunity={onSend}
         />,
       );
       const btn = screen.getByRole('button', { name: /interested/i });
       fireEvent.click(btn);
       expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
         type: 'keyword_opportunity',
         sourceKey: 'dental implants cost',
         title: expect.stringContaining('dental implants cost'),
       }));
     });
   });
   ```
2. Run it — see it fail:
   ```
   npx vitest run tests/component/strategy/KeywordOpportunities.test.tsx
   ```
   **Expected:** FAIL — `onSendOpportunity` / `opportunitiesDetailed` props don't exist; no "Interested?" button.
3. Commit:
   ```
   git add tests/component/strategy/KeywordOpportunities.test.tsx
   git commit -m "test(strategy-v3): KeywordOpportunities Interested? typed-send (5C)"
   ```

#### Task 5C.5: Extend `KeywordOpportunitiesProps` with the typed-send surface

**Files:** `src/components/strategy/types.ts`

1. Add the two props to `KeywordOpportunitiesProps` (after `navigate?` on line 233), importing the payload type at the top of the file (grouped with existing imports):
   ```ts
   import type { StrategyRecommendationPayload } from '../../../shared/types/recommendations';
   ```
   ```ts
   navigate?: (path: string) => void;
   /** Strategy v3 (#6b) — typed opportunities backing the per-row "Interested?" send.
    *  Parallel to the bare `opportunities` string[] above; populated from the public read's
    *  opportunitiesDetailed projection. Absent → no per-row send affordance (byte-identical). */
   opportunitiesDetailed?: Array<{ keyword: string; volume?: number; difficulty?: number; rationale?: string }>;
   /** Emits a StrategyRecommendationPayload when the operator clicks "Interested?" on a row.
    *  The host wires this to the Phase-2 per-row Send endpoint (mints + sends a keyword_opportunity rec). */
   onSendOpportunity?: (payload: StrategyRecommendationPayload) => void;
   ```
2. `npm run typecheck` → **Expected:** zero errors.
3. Commit:
   ```
   git add src/components/strategy/types.ts
   git commit -m "feat(strategy-v3): KeywordOpportunitiesProps typed-send surface (5C)"
   ```

#### Task 5C.6: Render the "Interested?" affordance in `KeywordOpportunities.tsx`

**Files:** `src/components/strategy/KeywordOpportunities.tsx`

1. Add a helper that maps a detailed opportunity to the adapter payload, and render an "Interested?" button per row when `opportunitiesDetailed` + `onSendOpportunity` are provided. Update the signature and the import line (line 5):
   ```tsx
   import { Sparkles, ArrowUpRight, Send } from 'lucide-react';
   import { Badge, SectionCard, Icon, IconButton, Button } from '../ui';
   import { adminPath } from '../../routes';
   import { buildHubDeepLinkQuery } from '../../lib/keywordHubDeepLink';
   import type { KeywordOpportunitiesProps } from './types';
   import type { StrategyRecommendationPayload } from '../../../shared/types/recommendations';

   export function KeywordOpportunities({ opportunities, opportunitiesDetailed, workspaceId, navigate, onSendOpportunity }: KeywordOpportunitiesProps) {
     if (opportunities.length === 0) return null;

     const showExplore = !!(workspaceId && navigate);
     const detailByKeyword = new Map((opportunitiesDetailed || []).map(o => [o.keyword, o]));

     const toPayload = (opp: string): StrategyRecommendationPayload => {
       const d = detailByKeyword.get(opp);
       return {
         type: 'keyword_opportunity',
         title: `Target the keyword "${opp}"`,
         description: d?.rationale || `Untapped keyword opportunity surfaced from your strategy.`,
         insight: d?.rationale || `"${opp}" is a gap your competitors rank for and you do not.`,
         affectedPages: [],
         sourceKey: opp,
         source: 'keyword_strategy',
       };
     };
     // …existing return, with an extra per-row button when onSendOpportunity && detailByKeyword.has(opp):
     //   <Button size="sm" variant="ghost" onClick={() => onSendOpportunity!(toPayload(opp))}>
     //     <Icon as={Send} size="sm" /> Interested?
     //   </Button>
   ```
   Place the `Interested?` button in the `showExplore` row branch, right of the existing "Explore in Hub" `IconButton`, gated on `onSendOpportunity && detailByKeyword.has(opp)`. Use **teal** for the action button (`Button` defaults to the teal CTA per the Four Laws — confirm it is not blue/data styling).
   > **Contract note:** `'keyword_opportunity'` must be a valid `RecType`. If it is not yet in the `RecType` union, this lane does NOT add it — that is a Phase-1/2 contract amendment. Confirm with `grep -n "keyword_opportunity" shared/types/recommendations.ts`. If absent, flag to the controller (cross-phase) and use the nearest existing keyword/opportunity `RecType` the policy registry already routes; do not invent a literal.
2. Run the component test:
   ```
   npx vitest run tests/component/strategy/KeywordOpportunities.test.tsx
   ```
   **Expected:** PASS.
3. `npm run typecheck` → **Expected:** zero errors. `npx vite build` → **Expected:** builds.
4. Commit:
   ```
   git add src/components/strategy/KeywordOpportunities.tsx
   git commit -m "feat(strategy-v3): Interested? typed-send affordance in KeywordOpportunities (5C)"
   ```

#### Task 5C.7: Lane 5C verification

**Files:** (verification only)

1. `npx vitest run tests/integration/public-content-routes-extended.test.ts tests/component/strategy/KeywordOpportunities.test.tsx` → **Expected:** PASS.
2. `npm run typecheck` → **Expected:** zero errors.
3. `npx vite build` → **Expected:** builds.
4. `npx tsx scripts/pr-check.ts` → **Expected:** zero errors (Zod-lockstep, no bare JSON.parse).

---

### Lane 5D — #9 cluster add/remove/research (sonnet)

> **Blocked by:** soft after Phase 3 (reads `recResponses` read-only). Can start once Phase 2 merges. `00-contracts.md` §12a pre-committed `TopicCluster.rationale?` + `projectedImpact?` (and the `ImpactBand` import). **Migration ledger (§0):** NO new migration in Phase 5 — these fields live in the existing `keyword_strategies` blob fallback path, NOT the normalized `topic_clusters` table (which has fixed columns). So the new fields survive via `normalizeTopicCluster` (blob carry) and are written/read through the blob, not new SQL columns.
>
> **Files:** `shared/types/workspace.ts`; `server/topic-clusters.ts`; `src/components/strategy/TopicClusters.tsx`

#### Task 5D.1: Confirm the §12a `TopicCluster` fields landed in Phase 1

**Files:** (read-only investigation)

1. Confirm the pre-committed fields + import:
   ```
   grep -n "rationale?\|projectedImpact?\|ImpactBand" shared/types/workspace.ts
   ```
   **Expected:** `rationale?: string;` and `projectedImpact?: ImpactBand;` on `interface TopicCluster`, plus `import type { ImpactBand } from './impact-band.js';`. If absent, STOP — §12a was not merged in Phase 1.
2. No commit. (If `00-contracts.md` §12a was deferred to Phase 5, add the two fields + import here as the FIRST sub-task before proceeding — but per the locked ledger they are a Phase-1 pre-commit.)

#### Task 5D.2: Write the failing unit test — normalizeTopicCluster carries rationale + projectedImpact

**Files:** `tests/unit/strategy/topic-clusters-enrichment.test.ts` (create)

1. Create:
   ```ts
   import { describe, it, expect } from 'vitest';
   import { normalizeTopicCluster } from '../../../server/topic-clusters';

   describe('normalizeTopicCluster #9 enrichment carry', () => {
     const base = { topic: 'dental implants', keywords: ['dental implants', 'implant cost'], ownedCount: 1, totalCount: 2, coveragePercent: 50, gap: ['implant cost'] };

     it('carries rationale and projectedImpact when present', () => {
       const c = normalizeTopicCluster({ ...base, rationale: 'high-intent cluster with weak coverage', projectedImpact: { band: 'high', monthlyMid: 800 } });
       expect(c).not.toBeNull();
       expect(c!.rationale).toBe('high-intent cluster with weak coverage');
       expect(c!.projectedImpact).toMatchObject({ band: 'high' });
     });

     it('omits rationale/projectedImpact when absent (legacy blob byte-identical)', () => {
       const c = normalizeTopicCluster(base);
       expect(c).not.toBeNull();
       expect(c!.rationale).toBeUndefined();
       expect(c!.projectedImpact).toBeUndefined();
     });
   });
   ```
   > Use the real `ImpactBand` shape — confirm its fields first: `grep -n "interface ImpactBand\|band:\|monthlyMid" shared/types/fix-catalog.ts`. Match the assertion to the actual shape.
2. Run it — see it fail:
   ```
   npx vitest run tests/unit/strategy/topic-clusters-enrichment.test.ts
   ```
   **Expected:** FAIL — `normalizeTopicCluster` drops the two new fields (it builds an explicit object that never copies them).
3. Commit:
   ```
   git add tests/unit/strategy/topic-clusters-enrichment.test.ts
   git commit -m "test(strategy-v3): normalizeTopicCluster carries #9 enrichment fields (5D)"
   ```

#### Task 5D.3: Carry rationale + projectedImpact through `normalizeTopicCluster`

**Files:** `server/topic-clusters.ts`

1. Read the precise `ImpactBand` shape (for the validation helper), then extend `normalizeTopicCluster` (the explicit return object near line 60) to copy the two optional fields. Add a local validator for `projectedImpact` and import `ImpactBand` at the top (grouped with the existing `import type { TopicCluster } …`):
   ```ts
   import type { TopicCluster, ImpactBand } from '../shared/types/workspace.js';
   ```
   Inside `normalizeTopicCluster`, after `const topCompetitorCoverage = finiteNumber(candidate.topCompetitorCoverage);`:
   ```ts
   const rationale = nonEmptyString(candidate.rationale);
   const projectedImpact = isImpactBand(candidate.projectedImpact) ? candidate.projectedImpact : undefined;
   ```
   And in the returned object, after `gap,`:
   ```ts
     gap,
     ...(rationale ? { rationale } : {}),
     ...(projectedImpact ? { projectedImpact } : {}),
   ```
   Add the `isImpactBand` type-guard above `normalizeTopicCluster` (match the actual `ImpactBand` field set — `band` is the discriminant):
   ```ts
   function isImpactBand(value: unknown): value is ImpactBand {
     return !!value && typeof value === 'object' && typeof (value as { band?: unknown }).band === 'string';
   }
   ```
2. Run the unit test:
   ```
   npx vitest run tests/unit/strategy/topic-clusters-enrichment.test.ts
   ```
   **Expected:** PASS.
3. `npm run typecheck` → **Expected:** zero errors.
4. Commit:
   ```
   git add server/topic-clusters.ts
   git commit -m "feat(strategy-v3): carry rationale+projectedImpact in normalizeTopicCluster (5D)"
   ```

#### Task 5D.4: Write the failing component test — TopicClusters renders rationale + projected impact and add/remove

**Files:** `tests/component/strategy/TopicClusters.test.tsx` (create)

1. Create:
   ```tsx
   import { describe, it, expect, vi } from 'vitest';
   import { render, screen, fireEvent } from '@testing-library/react';
   import { TopicClusters } from '../../../src/components/strategy/TopicClusters';

   const cluster = {
     topic: 'dental implants', keywords: ['dental implants'], ownedCount: 1, totalCount: 2,
     coveragePercent: 50, gap: ['implant cost'],
     rationale: 'high-intent cluster with weak coverage',
     projectedImpact: { band: 'high', monthlyMid: 800 },
   };

   describe('TopicClusters #9 enrichment + curation', () => {
     it('renders the rationale line when present', () => {
       render(<TopicClusters clusters={[cluster as never]} />);
       expect(screen.getByText(/high-intent cluster with weak coverage/i)).toBeTruthy();
     });
     it('fires onRemoveCluster when the remove control is clicked', () => {
       const onRemove = vi.fn();
       render(<TopicClusters clusters={[cluster as never]} onRemoveCluster={onRemove} />);
       fireEvent.click(screen.getByRole('button', { name: /remove cluster/i }));
       expect(onRemove).toHaveBeenCalledWith('dental implants');
     });
     it('fires onResearchCluster when the research control is clicked', () => {
       const onResearch = vi.fn();
       render(<TopicClusters clusters={[cluster as never]} onResearchCluster={onResearch} />);
       fireEvent.click(screen.getByRole('button', { name: /research/i }));
       expect(onResearch).toHaveBeenCalledWith('dental implants');
     });
   });
   ```
2. Run it — see it fail:
   ```
   npx vitest run tests/component/strategy/TopicClusters.test.tsx
   ```
   **Expected:** FAIL — no rationale line, no remove/research controls.
3. Commit:
   ```
   git add tests/component/strategy/TopicClusters.test.tsx
   git commit -m "test(strategy-v3): TopicClusters rationale + add/remove/research (5D)"
   ```

#### Task 5D.5: Render rationale, projected impact, and add/remove/research controls in `TopicClusters.tsx`

**Files:** `src/components/strategy/TopicClusters.tsx`

1. Update the local `TopicCluster` interface (lines 4–14) to add the two fields, and replace `TopicClustersProps` with the curation surface. Import `ImpactBand` for the prop type:
   ```tsx
   import { Icon, IconButton } from '../ui';
   import { Layers, BarChart3, AlertTriangle, X, Search } from 'lucide-react';
   import type { ImpactBand } from '../../../shared/types/workspace';

   interface TopicCluster {
     topic: string;
     keywords: string[];
     ownedCount: number;
     totalCount: number;
     coveragePercent: number;
     avgPosition?: number;
     topCompetitor?: string;
     topCompetitorCoverage?: number;
     gap: string[];
     rationale?: string;
     projectedImpact?: ImpactBand;
   }

   export interface TopicClustersProps {
     clusters: TopicCluster[];
     /** Strategy v3 (#9) — remove a cluster from the strategy (reversible). */
     onRemoveCluster?: (topic: string) => void;
     /** Strategy v3 (#9) — kick off keyword research for a cluster's gap. */
     onResearchCluster?: (topic: string) => void;
   }
   ```
2. In `TopicClusters({ clusters, onRemoveCluster, onResearchCluster })`, render:
   - the `rationale` line under the topic header (only when present): `{cluster.rationale && <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{cluster.rationale}</p>}`;
   - the `projectedImpact` banded label next to the coverage badge (banded, never raw $): `{cluster.projectedImpact && <span className="t-caption-sm text-teal-300">Projected impact: {cluster.projectedImpact.band}</span>}`;
   - two `IconButton`s in the header's right-side action row, each gated on its handler:
     ```tsx
     {onResearchCluster && (
       <IconButton icon={Search} label="Research" title="Research this cluster" size="sm" variant="ghost"
         onClick={() => onResearchCluster(cluster.topic)} className="text-[var(--brand-text-muted)] hover:text-accent-brand" />
     )}
     {onRemoveCluster && (
       <IconButton icon={X} label="Remove cluster" title="Remove from strategy (reversible)" size="sm" variant="ghost"
         onClick={() => onRemoveCluster(cluster.topic)} className="text-[var(--brand-text-muted)] hover:text-red-400" />
     )}
     ```
   > Note: this component imports `IconButton` (was only `Icon`) — update line 1 accordingly. Keep all existing coverage-bar / gap-chip markup unchanged.
3. Run the component test:
   ```
   npx vitest run tests/component/strategy/TopicClusters.test.tsx
   ```
   **Expected:** PASS.
4. `npm run typecheck` → **Expected:** zero errors. `npx vite build` → **Expected:** builds.
5. Commit:
   ```
   git add src/components/strategy/TopicClusters.tsx
   git commit -m "feat(strategy-v3): TopicClusters rationale/projected-impact + add/remove/research (5D)"
   ```

#### Task 5D.6: Wire `projectedImpact` through the public topic-cluster projection

**Files:** `server/routes/public-content.ts`

1. The public topicClusters projection is at lines 247–257. Add the two banded-safe fields to the allow-list map (rationale is client-safe narrative; `projectedImpact.band` is banded, never raw $ — spec §11 projection guard):
   ```ts
   topicClusters: topicClusters.map(c => ({
     topic: c.topic,
     keywords: c.keywords,
     ownedCount: c.ownedCount,
     totalCount: c.totalCount,
     coveragePercent: c.coveragePercent,
     avgPosition: c.avgPosition,
     topCompetitor: c.topCompetitor,
     topCompetitorCoverage: c.topCompetitorCoverage,
     gap: c.gap,
     // Strategy v3 (#9) — client-safe enrichment. projectedImpact is banded (no raw $).
     rationale: c.rationale,
     projectedImpact: c.projectedImpact ? { band: c.projectedImpact.band } : undefined,
   })),
   ```
2. `npm run typecheck` → **Expected:** zero errors.
3. Commit:
   ```
   git add server/routes/public-content.ts
   git commit -m "feat(strategy-v3): serialize topic-cluster rationale+projectedImpact band on public read (5D)"
   ```

#### Task 5D.7: Lane 5D verification

**Files:** (verification only)

1. `npx vitest run tests/unit/strategy/topic-clusters-enrichment.test.ts tests/component/strategy/TopicClusters.test.tsx` → **Expected:** PASS.
2. `npm run typecheck` → **Expected:** zero errors.
3. `npx vite build` → **Expected:** builds.
4. `npx tsx scripts/pr-check.ts` → **Expected:** zero errors.

---

### Lane 5E — #8a brief pre-seed `strategyCardContext` on the Standalone path (sonnet)

> **Blocked by:** none hard (isolated server work). The **Request path** (`generateBriefForRequest`) already builds `strategyCardContext` at `server/content-brief-generation-job.ts:339` and passes it to `generateBrief`; the **Standalone path** (`generateStandaloneBrief`, starts line 116) MISSES it — it calls `generateBrief` at line 213 with no `strategyCardContext`. This lane threads it through so standalone briefs get the same strategy grounding.
>
> **Files:** `server/content-brief-generation-job.ts`; `server/content-brief.ts`; `server/routes/content-briefs.ts`

#### Task 5E.1: Write the failing integration test — standalone brief injects the strategy-card block

**Files:** `tests/integration/content-brief-standalone-strategy-card.test.ts` (create)

1. Mirror the existing `tests/integration/content-brief-decay-context.test.ts` harness (OpenAI mock + direct function call). Assert the prompt sent to the AI contains the `STRATEGY CARD CONTEXT` block (from `buildStrategyCardBlock`) when the standalone path runs with `pageAnalysisContext.searchIntent` set:
   ```ts
   /**
    * Integration test: the Standalone brief path now injects strategyCardContext
    * (parity with the Request path). #8a.
    * Port: n/a (direct function call via the job runner, no HTTP server).
    */
   import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
   import { setupOpenAIMocks, mockOpenAIJsonResponse, getCapturedOpenAICalls, resetOpenAIMocks } from '../mocks/openai.js';
   setupOpenAIMocks();
   // …mirror the other brief tests' workspace-intelligence / web-scraper / analytics mocks…

   describe('Standalone brief strategyCardContext pre-seed (#8a)', () => {
     beforeAll(() => { /* seed a workspace via the shared fixture */ });
     afterAll(() => { /* cleanup */ resetOpenAIMocks(); });

     it('injects the STRATEGY CARD CONTEXT block when searchIntent is provided', async () => {
       mockOpenAIJsonResponse({ /* minimal valid brief JSON */ });
       // run generateStandaloneBrief (via the exported job entry) with
       // pageAnalysisContext: { searchIntent: 'commercial' }
       const calls = getCapturedOpenAICalls();
       const prompt = calls.map(c => JSON.stringify(c.messages)).join('\n');
       expect(prompt).toContain('STRATEGY CARD CONTEXT');
       expect(prompt).toMatch(/Search intent: commercial/);
     });
   });
   ```
   > `generateStandaloneBrief` is module-private — exercise it through the exported job entry (`startContentBriefGenerationJob` / the job runner) the way the existing brief integration tests do, OR temporarily export a thin test seam if the existing tests already do so. Match the existing pattern in `content-brief-decay-context.test.ts`.
2. Run it — see it fail:
   ```
   npx vitest run tests/integration/content-brief-standalone-strategy-card.test.ts
   ```
   **Expected:** FAIL — no `STRATEGY CARD CONTEXT` block in the standalone prompt.
3. Commit:
   ```
   git add tests/integration/content-brief-standalone-strategy-card.test.ts
   git commit -m "test(strategy-v3): standalone brief injects strategyCardContext (5E)"
   ```

#### Task 5E.2: Thread `searchIntent` from the route into the standalone job params

**Files:** `server/routes/content-briefs.ts`

1. The standalone generate route (line 154) already accepts `pageAnalysisContext` (line 157) and passes it to the job (line 180). `pageAnalysisContext.searchIntent` is the intent source for the standalone strategy card. No new field is needed at the route boundary — confirm `pageAnalysisContext` carries `searchIntent` through to the job:
   ```
   grep -n "searchIntent" server/content-brief-generation-job.ts
   ```
   **Expected:** `searchIntent?` already on the `pageAnalysisContext` shape in `StandaloneContentBriefGenerationParams` (line 29 block). This task is verify-only if so — record "route already threads searchIntent via pageAnalysisContext" in the PR. If the route strips it, restore it (keep `pageAnalysisContext: pageAnalysisContext || undefined`).
2. No code change expected; no commit unless a strip was found.

#### Task 5E.3: Build `strategyCardContext` in `generateStandaloneBrief` and pass it to `generateBrief`

**Files:** `server/content-brief-generation-job.ts`

1. In `generateStandaloneBrief`, after `keywordMetrics` / `relatedKeywords` are resolved (line ~162) and `pageAnalysisContext` is destructured from `params`, build the strategy card from what the standalone path already has (intent from `pageAnalysisContext.searchIntent`, volume/difficulty from `keywordMetrics`, rationale synthesized from the page analysis). Insert before the `generateBrief` call at line 213:
   ```ts
   // #8a: pre-seed the strategy card on the Standalone path (parity with the Request
   // path at generateBriefForRequest). Intent drives journeyStage + prompt grounding;
   // volume/difficulty come from the provider metrics already fetched above.
   const standaloneStrategyCardContext: StrategyCardContext | undefined = (
     pageAnalysisContext?.searchIntent || keywordMetrics || (pageAnalysisContext?.recommendations?.length)
   ) ? {
     rationale: pageAnalysisContext?.recommendations?.[0],
     intent: pageAnalysisContext?.searchIntent,
     volume: keywordMetrics?.volume,
     difficulty: keywordMetrics?.difficulty,
     journeyStage: deriveJourneyStage(pageAnalysisContext?.searchIntent),
   } : undefined;
   ```
2. Add `strategyCardContext: standaloneStrategyCardContext,` to the `generateBrief(...)` options object (line 213 call), alongside the existing options (e.g. after `pageAnalysisContext,`):
   ```ts
     pageAnalysisContext,
     strategyCardContext: standaloneStrategyCardContext,
     decayQueryContext: standaloneDecayQueryContext,
   ```
   `StrategyCardContext` is already imported (line 25) and `deriveJourneyStage` is already defined (line 112) — no new imports.
3. Run the integration test:
   ```
   npx vitest run tests/integration/content-brief-standalone-strategy-card.test.ts
   ```
   **Expected:** PASS — the standalone prompt now contains `STRATEGY CARD CONTEXT` + `Search intent: commercial`.
4. `npm run typecheck` → **Expected:** zero errors.
5. Commit:
   ```
   git add server/content-brief-generation-job.ts
   git commit -m "feat(strategy-v3): pre-seed strategyCardContext on standalone brief path (#8a, 5E)"
   ```

#### Task 5E.4: Confirm `buildStrategyCardBlock` renders the standalone fields (volume/difficulty surfacing decision)

**Files:** `server/content-brief.ts`

1. `buildStrategyCardBlock` (line 602) currently only emits rationale/intent/priority/journeyStage lines — it does NOT render `volume`/`difficulty`/`trendDirection`/`serpFeatures`/`competitorProof`/`impressions`. The standalone card sets `volume`/`difficulty`; decide whether to surface them. Per spec §11 (banded, methodology-aware) and to keep the prompt grounded, add volume/difficulty lines to the block:
   ```ts
   if (ctx.priority) lines.push(`- Priority: ${ctx.priority}`);
   if (typeof ctx.volume === 'number') lines.push(`- Monthly search volume: ${ctx.volume}`);
   if (typeof ctx.difficulty === 'number') lines.push(`- Keyword difficulty: ${ctx.difficulty}`);
   if (ctx.journeyStage) lines.push(`- Journey stage: ${ctx.journeyStage} — tailor depth, CTA, and tone to this stage`);
   ```
   This also enriches the Request path (which never set volume/difficulty before — additive, no behavior change there since those fields stay undefined on that path).
2. Add/extend a unit assertion (reuse the standalone integration test) confirming `Monthly search volume:` appears when volume is set. Re-run:
   ```
   npx vitest run tests/integration/content-brief-standalone-strategy-card.test.ts
   ```
   **Expected:** PASS (add a `expect(prompt).toMatch(/Monthly search volume/)` assertion to the test in 5E.1 if you set `keywordMetrics` in the mock).
3. `npm run typecheck` → **Expected:** zero errors.
4. Commit:
   ```
   git add server/content-brief.ts
   git commit -m "feat(strategy-v3): surface volume/difficulty in strategy-card block (5E)"
   ```

#### Task 5E.5: Lane 5E verification

**Files:** (verification only)

1. `npx vitest run tests/integration/content-brief-standalone-strategy-card.test.ts` → **Expected:** PASS.
2. Run the existing brief tests to confirm no Request-path regression:
   ```
   npx vitest run tests/integration/content-brief-decay-context.test.ts
   ```
   **Expected:** PASS.
3. `npm run typecheck` → **Expected:** zero errors.
4. `npx tsx scripts/pr-check.ts` → **Expected:** zero errors.

---

### Lane 5F — barrel + docs reconcile (haiku)

> **Blocked by:** LAST — after 5A–5E land. This lane reconciles the `src/components/strategy/index.ts` barrel (5B may have removed exports; 5C/5D changed component prop surfaces but not export names) and appends the required docs. Controller commits per-lane — no parallel git writes.
>
> **Files:** `src/components/strategy/index.ts`; `docs/rules/strategy-recommendations.md`; `FEATURE_AUDIT.md`; `data/roadmap.json`

#### Task 5F.1: Reconcile the strategy barrel

**Files:** `src/components/strategy/index.ts`

1. Confirm no orphaned export points at a deleted file and that `TopicClusters` + `KeywordOpportunities` (whose prop surfaces 5C/5D extended) are still exported:
   ```
   grep -n "TopicClusters\|KeywordOpportunities" src/components/strategy/index.ts
   ```
   **Expected:** `export * from './KeywordOpportunities';` present (line ~26). `TopicClusters` is NOT currently barrel-exported — add it if 5D's consumers import via the barrel; otherwise leave it (it's imported directly today). Add only if a consumer needs it:
   ```ts
   export * from './TopicClusters';
   ```
2. Verify every `export * from './X'` resolves to a live file (no dangling export after 5B deletions — 5B deleted client-dir files, not strategy-dir files, so the strategy barrel should be unaffected; this is a confirm step):
   ```
   npx vite build
   ```
   **Expected:** builds (a dangling barrel export fails the build).
3. `npm run typecheck` → **Expected:** zero errors.
4. Commit:
   ```
   git add src/components/strategy/index.ts
   git commit -m "chore(strategy-v3): reconcile strategy barrel after Phase 5 (5F)"
   ```

#### Task 5F.2: Append the Phase-5 contracts to the strategy-recommendations rule doc

**Files:** `docs/rules/strategy-recommendations.md`

1. This doc is scaffolded in Phase 1 Lane 1D. Append a Phase-5 section documenting the three enrichment contracts so future agents don't re-derive them:
   ```md
   ## Phase 5 — reconcile/retire + enrichment contracts

   ### #6b keyword-opportunity typed-send
   - `StoredKeywordStrategy.opportunitiesDetailed?` (parallel to the bare `opportunities: string[]`,
     which stays byte-identical) backs the per-row "Interested?" send.
   - `KeywordOpportunities` emits a `StrategyRecommendationPayload` (type `keyword_opportunity`,
     `sourceKey = the keyword string`) via `onSendOpportunity`; the host wires it to the Phase-2
     per-row Send endpoint. The public read serializes only `{keyword, volume, difficulty, rationale}`.

   ### #9 cluster add/remove/research
   - `TopicCluster.rationale?` + `projectedImpact?: ImpactBand` (banded — never raw $). No migration:
     these live in the `keyword_strategies` blob fallback and are carried by `normalizeTopicCluster`,
     NOT the normalized `topic_clusters` table columns.
   - `TopicClusters` exposes `onRemoveCluster(topic)` / `onResearchCluster(topic)`. Removal is
     reversible (spec §4.3). Public read exposes `rationale` + `projectedImpact.band` only.

   ### #8a brief pre-seed strategyCardContext
   - The Standalone brief path (`generateStandaloneBrief`) now builds `strategyCardContext` from
     `pageAnalysisContext.searchIntent` + provider `keywordMetrics` (parity with the Request path).
   - `buildStrategyCardBlock` now renders `volume` + `difficulty` lines (additive; Request path
     leaves them undefined).

   ### Retire sweep (spec §9) — un-mount vs file-delete
   - File-deleted (sole importer was OverviewTab): `PredictionShowcaseCard`, `IntelligenceSummaryCard`;
     `HealthScoreCard` reduced to the exported `ScoreBreakdownDisclosure` (grafted onto the visibility ring).
   - Un-mounted only (multi-importer — NEVER file-delete): `MonthlyDigest` (5 importers),
     `InsightsDigest` (3 importers incl. admin `BriefingReviewQueue`).
   - Inline-JSX deletions from `OverviewTab`: #1-Priority, contextual CTA banner, duplicate StatCard
     grid, Recent-Work timeline, Content-Opportunities preview.
   ```
2. Commit:
   ```
   git add docs/rules/strategy-recommendations.md
   git commit -m "docs(strategy-v3): document Phase-5 enrichment + retire contracts (5F)"
   ```

#### Task 5F.3: Update FEATURE_AUDIT.md

**Files:** `FEATURE_AUDIT.md`

1. Add/update the Strategy v3 entry to note Phase 5 shipped: the client overview/strategy-tab retire sweep, the visibility-score breakdown graft, #6b keyword-opportunity typed-send, #9 cluster add/remove/research, #8a standalone-brief strategy-card pre-seed. Keep the existing entry format (match surrounding rows).
2. Commit:
   ```
   git add FEATURE_AUDIT.md
   git commit -m "docs(strategy-v3): FEATURE_AUDIT Phase-5 reconcile/retire + enrichment (5F)"
   ```

#### Task 5F.4: Mark Phase-5 roadmap items done + add the deferred roadmap items

**Files:** `data/roadmap.json`

1. Mark the Phase-5 in-scope items `"pending"` → `"done"` with `"notes"`, then ADD the **deferred** roadmap items the spec §12 + `00-contracts.md` §10 child flags reference (capture, don't lose). Add entries with `"status": "pending"`:
   - `strategy-paid-topic-monetization-spine` — generic `strategy_addon` SKU + rec→cart bridge + product map for keyword/topic rec types (gated by the `strategy-paid-topics` child flag; spec §2 / §11 / D8).
   - `strategy-per-tier-included-allowance` — the literal mixed free+paid "included allowance" screen (spec §2 / §12).
   - `strategy-per-row-recommendation-table` — per-row rec storage replacing whole-blob (spec §2 / §12).
   - `strategy-per-workspace-reporting-timezone` (spec §12).
   - `strategy-admin-client-view-preview` — C's admin "client view preview" panel (spec §2 / §12).
   - `strategy-automated-stripe-refunds` (spec §12 / FP16).
   - `strategy-lost-query-as-rec-type` — promote `lost_query` to a first-class `RecType` behind the policy registry (spec §6.8 / §12).
   - `client-dashboard-v2-full-rethink` — the full visual/IA rethink of every client tab (spec §2 / §12).
   Use the existing roadmap entry shape (id, title, status, sprint, notes).
2. Re-sort the roadmap:
   ```
   npx tsx scripts/sort-roadmap.ts
   ```
   **Expected:** runs clean, archives nothing unexpected.
3. Commit:
   ```
   git add data/roadmap.json
   git commit -m "docs(strategy-v3): mark Phase-5 done + capture deferred roadmap items (5F)"
   ```

#### Task 5F.5: Lane 5F verification

**Files:** (verification only)

1. `npm run typecheck` → **Expected:** zero errors.
2. `npx vite build` → **Expected:** builds.
3. `npx tsx scripts/pr-check.ts` → **Expected:** zero errors.

---

## Phase exit gates

Phase 5 is not done until ALL pass (run from repo root, full suite — not just the new tests):

- [ ] `npm run typecheck` — zero errors (`tsc -b`, both app + node configs).
- [ ] `npx vite build` — builds successfully (catches any dangling barrel export / removed import).
- [ ] `npx vitest run` — **full** suite green, including the Phase-5 additions:
  - `tests/component/client/OverviewTab.retire.test.tsx` (5A)
  - `tests/component/client/StrategyTab.test.tsx` v3 block (5B)
  - `tests/integration/public-content-routes-extended.test.ts` `opportunitiesDetailed` (5C)
  - `tests/component/strategy/KeywordOpportunities.test.tsx` (5C)
  - `tests/unit/strategy/topic-clusters-enrichment.test.ts` (5D)
  - `tests/component/strategy/TopicClusters.test.tsx` (5D)
  - `tests/integration/content-brief-standalone-strategy-card.test.ts` (5E)
  - `tests/integration/content-brief-decay-context.test.ts` (5E — no Request-path regression)
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (Zod-lockstep, no bare JSON.parse, color laws).
- [ ] **Flag-OFF retire-safety gate (spec §10 hard requirement):** every 5A/5B deletion was grep-confirmed unreferenced on the command-center baseline BEFORE removal; `MonthlyDigest`/`InsightsDigest` were un-mounted (never file-deleted); `PredictionShowcaseCard`/`IntelligenceSummaryCard` had zero importers before `git rm`.
- [ ] `grep -rn "purple-" src/components/client/OverviewTab.tsx src/components/client/StrategyTab.tsx src/components/strategy/TopicClusters.tsx src/components/strategy/KeywordOpportunities.tsx` — zero (no purple in any client-facing or v3 surface).
- [ ] `npm run verify:feature-flags` — no orphaned/ungrouped flag keys (5F roadmap entries reference `strategy-paid-topics` already cataloged in Phase 1 §10).
- [ ] **Multi-agent gate:** Phase 5 ran 6 parallel lanes → invoke `scaled-code-review` before merge; fix every Critical/Important finding in-PR (no "pre-existing/out-of-scope" deferral).
- [ ] Phase-per-PR: this is the FINAL v3 phase — confirm Phase 4 / Track C merged green on `staging` before this lands; merge `staging` → `main` only after staging verification.
