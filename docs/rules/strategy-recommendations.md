# Strategy v3 — Recommendation Lifecycle Contracts

> Feature-specific contract reference for the Strategy v3 curation cockpit. Read this before
> touching any recommendation lifecycle code. Companion to the locked Phase-1 contracts in
> Part 0 of the implementation plan `docs/superpowers/plans/2026-06-18-strategy-v3-curation-cockpit.md`
> and the design spec `docs/superpowers/specs/2026-06-18-strategy-v3-curation-cockpit-design.md`.

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
(`sendRecommendation`, `strikeRecommendation`, `unstrikeRecommendation`, `throttleRecommendation`,
`fixRecommendation`). Each wraps a `db.transaction()` that re-reads the set inside the txn, applies
the single-field delta, recomputes the summary, and upserts via `saveRecommendations`. Never mutate
the lifecycle axis from a route handler directly.

> **As-built note:** `unstrikeRecommendation` is the undo for a strike (not `unsuppressRecommendation`
> as named in some plan drafts). The plan's Phase-2 dependency contract uses the correct name.

### Exported API (frozen for Phase 2 Lane A consumers — never re-implement)

```ts
// server/recommendation-lifecycle.ts

/** clientStatus: curated → sent (or system → sent in one operator step). Sets sentAt.
 *  Routes by policy.sendChannel. Throws InvalidTransitionError on an illegal edge. */
export function sendRecommendation(workspaceId: string, recId: string): Recommendation | null;

/** lifecycle: active → struck. Sets struckAt + (for cascadeOnStrike RecTypes) cascade metadata.
 *  Idempotent re-strike returns the struck rec with the original struckAt unchanged. */
export function strikeRecommendation(
  workspaceId: string,
  recId: string,
  cascade?: Recommendation['cascade'],
): Recommendation | null;

/** lifecycle: struck → active (Undo). Clears lifecycle suppression + cascade metadata.
 *  The strategy-item restore for reversible cascade is the caller's responsibility (P5). */
export function unstrikeRecommendation(workspaceId: string, recId: string): Recommendation | null;

/** lifecycle: active → throttled. days ∈ {7, 30, 90}; sets throttledUntil = now + days.
 *  Auto-resurfaces on-read once the date passes (isActiveRec handles it — no cron needed). */
export function throttleRecommendation(
  workspaceId: string,
  recId: string,
  days: 7 | 30 | 90,
): Recommendation | null;

/** Fix — marks the rec via the existing RecStatus completion path (pending|in_progress → completed).
 *  This is "we'll do it ourselves" on the INTERNAL triage axis — NOT a clientStatus change. */
export function fixRecommendation(workspaceId: string, recId: string): Recommendation | null;
```

All five functions return `null` when the rec id is not found in the workspace blob.

## `isActiveRec` — the ONE active-set predicate

`isActiveRec(rec, now?)` (exported from `server/recommendations.ts:638`) is the single predicate
every reader uses to decide whether a rec is eligible to surface (Act queue, summary top-rec, AI
context, briefings, intelligence slices). A rec is active iff ALL four conditions hold:

1. `RecStatus` is not terminal (`completed` or `dismissed`)
2. `lifecycle` is not `'struck'`
3. Not throttled into the future: `lifecycle !== 'throttled'` OR `throttledUntil` has passed (the
   rec auto-resurfaces on-read once the date passes — no cron or separate job needed)
4. `clientStatus` is not in `{sent, approved, declined}`

Absent v3 fields (`lifecycle === undefined`, `clientStatus === undefined`) → legacy rec → treated as
`lifecycle: 'active'`, `clientStatus: 'system'` → satisfies all four conditions.

### Per-reader retrofit decisions (Phase 1 Lane 1C)

| Reader | File | Decision |
|---|---|---|
| `computeRecommendationSummary` | `server/recommendations.ts:652` | routes through `isActiveRec` (Lane 1B) |
| operational-slice rec counter | `server/intelligence/operational-slice.ts:217` | routes through `isActiveRec` |
| seo-context-slice `topOpportunity` | `server/intelligence/seo-context-slice.ts:484` | routes through `isActiveRec` (was leaking throttled/sent into AI context) |
| page-profile-slice | `server/intelligence/page-profile-slice.ts:70` | routes through `isActiveRec` |
| public projection | `server/recommendation-public-projection.ts` (`stripEmvFromPublicRecs`) | allow-list; admin axis never serialized |
| Act queue | `server/routes/recommendations.ts` (P2 cockpit) | reads via `isActiveRec` + lifecycle filters (Phase 2) |
| `admin-chat-context` / `briefing-candidates` | (read summary indirectly) | EXEMPT — consume `computeRecommendationSummary` output, already filtered |
| outcome-backfill | `server/recommendations.ts` ~line 2450 area | EXEMPT — operates on completed recs only (correct as-is) |

> **As-built note:** The plan's per-reader table named the seo-context-slice reader as `topRec` and
> the public projection function as `projectPublicRec`. As built: the seo-context-slice builds a
> `topOpportunity` object (not a raw rec), and the public projection function is
> `stripEmvFromPublicRecs` (an allow-list, not a named `projectPublicRec`). The contracts are
> equivalent — only the internal function names differ.

## Carry-over through regen

`applyLifecycleCarryOver(newRecs, oldRecs)` (owned by
`server/domains/recommendations/rules.ts` and compatibility-exported from `server/recommendations.ts`)
re-applies the client-facing lifecycle axis onto freshly-minted recs during a regen merge, keyed by
`buildMergeKey(rec)` (`source + affectedPages[0] + title`), for EVERY matched old rec regardless of
`RecStatus`. Without it a sent rec resets to `system` on the next regen.

Called by `server/domains/recommendations/finalization.ts:finalizeRecommendations` after the
RecStatus merge branch so the two merge passes are additive and idempotent. The carry-over copies
the lifecycle axis (`clientStatus`,
`lifecycle`, `throttledUntil`, `sentAt`, `struckAt`, `cascade`, `sendChannel` — only when present on
the old rec) AND re-applies `id` + `createdAt` continuity (so a re-minted rec keeps its identity and
sentAt lineage; idempotent with the RecStatus branch above).

Exit-gate test: `tests/integration/recommendation-regen-preserves-lifecycle.test.ts`.

## Auto-resolve exemption

`isExemptFromAutoResolve(rec)` (owned by `server/domains/recommendations/rules.ts` and
compatibility-exported from `server/recommendations.ts`) exempts recs with
`clientStatus` in `{sent, discussing, approved}` from the destructive auto-resolve → `completed`
sweep inside `generateRecommendations`. `declined` is NOT exempt (the client said no; it can
auto-resolve when the issue is genuinely fixed).

Called inside `finalizeRecommendations` in `server/domains/recommendations/finalization.ts`, AFTER
`applyLifecycleCarryOver` has already re-stamped the lifecycle axis on surviving recs. The ordering
is critical: carry-over runs first so the exemption check sees the correct `clientStatus`.

Exit-gate test: `tests/integration/recommendation-lifecycle.test.ts`
(the `strike-never-completed — auto-resolve exemption survives a real regen` describe block).

### Signal-sourced recs are also exempt (separate guard)

In addition to the `clientStatus` exemption above, recs whose source category is `'signal'`
(merge key prefixed `signal:`, minted by `mintSignalRecs` under the `strategy-signal-fold` flag)
are exempt from the auto-resolve sweep via a **separate guard immediately before the auto-resolve
loop** in `finalizeRecommendations`. The reason is structural, not status-based: `mintSignalRecs`
runs once per generation *after* the merge/auto-resolve block, so a `signal:<insightId>` key is
**never** added to `newSources`. For a signal rec, "absent from `newSources`" is therefore always a
false positive — without the guard every un-actioned folded signal would be rewritten to
`completed` ("✓ Auto-resolved") on the next daily/on-mutation recompute, silently erasing the feed.
The guard retains the existing signal rec unchanged so the post-loop mint dedups against it (no
duplicate, no false completion). **Do not remove or bypass this guard** when refactoring the
auto-resolve loop. Exit-gate test: `server/__tests__/signal-fold-carry-over.test.ts` (the
status-continuity assertion: a plain folded signal rec stays `pending` across ≥2 regens).

## Public read = allow-list

`stripEmvFromPublicRecs(recs)` in `server/recommendation-public-projection.ts` is an explicit allow-list of
client-safe fields. It enumerates ONLY the fields the client may see — the admin lifecycle axis
(`clientStatus`, `lifecycle`, `throttledUntil`, `sentAt`, `struckAt`, `cascade`, `sendChannel`) is
never spread or copied.

**Why an allow-list and not a blocklist:** a blocklist (`...rec` minus a few keys) would silently
leak every new admin-only field the moment it is added. The allow-list is leak-proof by default.

The curated read (Phase 4) will read `clientStatus` server-side to FILTER recs, but the wire
payload stays admin-key-free.

Exit-gate tests: `tests/integration/recommendations-public-allowlist.test.ts`
(flag-OFF byte-identical + flag-ON no-admin-key-leak on the REAL public GET
`/api/public/recommendations/:workspaceId`).

## Per-RecType policy registry

`REC_POLICY_REGISTRY` (exported from `server/recommendation-lifecycle.ts`) maps each `RecType` to:

- `sendChannel`: `'rec'` (mutates `clientStatus` directly) or `'deliverable'`
  (routes `content_decay` / `cannibalization` to the deliverable spine)
- `cascadeOnStrike`: `true` for `keyword_gap` / `topic_cluster` (removes strategy items on strike)
- `monetizable`: `true` where a priced Add-to-plan CTA is allowed (requires `productType` to resolve)

An unlisted `RecType` cannot be curated until a policy entry is registered here.

Current registry (Phase 1, + `competitor` added in P4 / PR #1286):

| RecType | sendChannel | cascadeOnStrike | monetizable |
|---|---|---|---|
| `technical` | `rec` | false | false |
| `content` | `rec` | false | true |
| `content_refresh` | `rec` | false | true |
| `schema` | `rec` | false | true |
| `metadata` | `rec` | false | false |
| `performance` | `rec` | false | false |
| `accessibility` | `rec` | false | true |
| `strategy` | `rec` | false | false |
| `aeo` | `rec` | false | false |
| `keyword_gap` | `rec` | **true** | false |
| `topic_cluster` | `rec` | **true** | false |
| `cannibalization` | **`deliverable`** | false | false |
| `local_visibility` | `rec` | false | false |
| `local_service_gap` | `rec` | false | false |
| `competitor` | `rec` | false | false |

`competitor` recs are minted on demand from a competitive gap by `POST /:ws/competitor-rec`
(`CompetitiveIntel` "Send to client", flag `strategy-competitor-send`); the generation engine emits
none, and `signalToRecType` never maps to `competitor`.

## Deferred items (do not implement early)

- **Positive-terminal transitions** (sent → approved, sent → declined from the client side): Phase 2/3.
  The current `CLIENT_REC_TRANSITIONS` in `server/state-machines.ts` defines these edges but the
  routes that exercise them ship in Phase 2 Lane A.
- **Cascade restore** (undo a keyword/topic strike reverting strategy items): Phase 5.
  `unstrikeRecommendation` clears the lifecycle axis; the actual strategy-item restore is the
  route-layer caller's responsibility (Phase 5).
- **`clientStatus: 'curated'` step**: the curate-before-send UI step is a Phase 2 cockpit UX
  concern. `sendRecommendation` already handles the `system → sent` direct path (operator skips
  the curate step) so Phase 1 is complete without the curate route.
