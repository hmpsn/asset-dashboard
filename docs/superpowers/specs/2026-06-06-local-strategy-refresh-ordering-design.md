# Local ↔ Strategy Refresh Ordering — Design

**Date:** 2026-06-06
**Status:** Approved (design); pending spec review → implementation plan
**Bounded context:** analytics-intelligence (hmpsn.studio)

## Problem

A keyword **strategy regen reads local SEO data but never refreshes it**, and the dependency only runs one direction — so the *correct order is local SEO first, then strategy*, and nothing in the product makes that knowable. Today:

- Strategy generation consumes local data at two points: the AI synthesis pulls the local-visibility slice for local **candidate inclusion** (`withActiveLocalSeoSlice`, keyword-strategy-ai-synthesis.ts ~:296), and enrichment reads posture + markets + business city/state to build the value-scoring `ScoringContext` (keyword-strategy-enrichment.ts ~:588–592 via `getLocalSeoPosture` / `listLocalSeoMarkets`). It **writes no local data**.
- Local SEO refresh is a **separate, manual, credit-burning** job (~50 kw × 3 markets, sequential to avoid OOM, globally coalesced to one-at-a-time; routes/local-seo.ts ~:208). On completion it **auto-regens recommendations** for local/hybrid (local-seo.ts ~:2377–2398) but **not** the keyword strategy.

Consequences: (1) operators regenerate strategy on stale or **empty** local data — most acute when onboarding a local workspace (markets set, never crawled); (2) after a local refresh, the strategy silently drifts out of date (recs update, strategy doesn't); (3) there is no signal of either condition.

## Goals

- Make the correct order (**local → strategy**) discoverable and one-click for **local/hybrid** workspaces.
- Surface staleness in **both** directions: local-needs-refresh-before-strategy, and strategy-older-than-local.
- Keep everything **non-blocking** (operator can always override) and **opt-in** (no automatic credit spend).

## Non-goals / Out of scope

- **Do NOT** auto-run a local refresh on every strategy regen (rejected: credit cost; the strategy's *value-scoring* local inputs — posture/markets/address — are stable and don't need a visibility crawl to be correct).
- No change to local-refresh cadence or the local-refresh pipeline internals.
- **Non-local / unknown** posture workspaces are untouched — they see none of this.
- No new tables.

## Key decisions (resolved in brainstorming)

1. **Both surfaces** — a smart prompt at the moment of strategy regen, *and* a dedicated "Full refresh" action.
2. **Staleness rule** — local data is "stale enough" when it is **missing**, **older than a threshold (30 days)**, or **markets changed since the last crawl**.
3. **Sequencing** — the combined action **auto-chains** (local → strategy) and **aborts the strategy regen if the local refresh hard-fails**.
4. **Scope** — v1 covers **both directions**: forward (local→strategy ordering) and the reverse nudge (strategy older than local), reusing one comparator.
5. **Orchestration** — **server-side job chaining** (not client-orchestrated), so the chain survives a closed tab and abort-on-fail is enforced where the failure is known. This mirrors the existing local-refresh completion hook that already conditionally regens recommendations.

## Architecture

### Component 1 — Staleness comparator (the shared core)

A single server helper is the source of truth for both directions:

**Contract:** `getLocalStrategySyncStatus(workspaceId): LocalStrategySyncStatus`

```
LocalStrategySyncStatus = {
  applies: boolean;                 // true only for posture local | hybrid
  localNeedsRefresh: boolean;       // missing | stale | markets_changed
  localNeedsRefreshReason: 'missing' | 'stale' | 'markets_changed' | null;
  strategyStaleVsLocal: boolean;    // strategy.generatedAt predates latest local crawl
  lastLocalRefreshAt: string | null;  // max(local_visibility_snapshots.captured_at)
  lastStrategyGeneratedAt: string | null; // keyword_strategy.generatedAt
}
```

**Inputs (all reads, no new tables):** `getLocalSeoPosture(workspaceId)`; `max(local_visibility_snapshots.captured_at)` for the workspace; `max(local_seo_markets.updated_at)`; `keyword_strategy.generatedAt`.

**Rules:**
- `applies = posture ∈ {local, hybrid}`. If false, every other field is false/null and no UI fires.
- `localNeedsRefreshReason`: `missing` if no snapshots; else `markets_changed` if any market `updated_at` > latest snapshot `captured_at`; else `stale` if latest snapshot older than `LOCAL_DATA_STALE_DAYS` (30, named constant); else `null`.
- `strategyStaleVsLocal = lastStrategyGeneratedAt != null && lastLocalRefreshAt != null && lastStrategyGeneratedAt < lastLocalRefreshAt`.

Surfaced to the client as fields on an existing status read for the strategy/keyword surface (no new endpoint).

### Component 2 — Forward path (local → strategy)

- **Smart prompt** on the admin "Generate Strategy" action (`KeywordStrategy`): if `applies && localNeedsRefresh`, intercept before enqueuing with a warning keyed to the reason, offering: **Full refresh (local → strategy)** [primary] · **Generate anyway** [non-blocking override] · **Cancel**.
- **Dedicated "Full refresh" button** alongside Generate Strategy, shown for local/hybrid, visually flagged "recommended" when `localNeedsRefresh`.
- **Combined action (server job chain):** enqueue the local refresh with a `thenRegenerateStrategy` flag. The local-refresh completion hook (where it already conditionally regens recommendations) gains a branch: if the flag is set **and** the refresh produced usable snapshots → enqueue the strategy regen; if the refresh **hard-failed** → abort, do not enqueue, surface the failure. Progress shows as two phases over the existing background-job/WS-event system. Honors the existing global one-refresh-at-a-time coalescing.

### Component 3 — Reverse path (strategy older than local)

A **non-blocking nudge banner** on the strategy view when `applies && strategyStaleVsLocal`: "Local SEO was refreshed {lastLocalRefreshAt}, newer than this strategy ({lastStrategyGeneratedAt}) — regenerate to reflect it," with a Generate CTA. Fills the gap that local refresh auto-regens recs but not strategy.

## Error handling / boundary behavior

- **Abort-on-fail definition:** a **hard failure** = the local-refresh job errored OR produced **zero usable snapshots** → abort the chained strategy regen, surface the local failure. A **degraded-but-partial** crawl (some usable snapshots, provider-degraded markets) counts as **success** → proceed to the strategy regen.
- **Non-blocking everywhere:** "Generate anyway" runs the existing strategy regen directly; the reverse nudge is dismissable; nothing hard-blocks a regen.
- **Non-local/unknown:** `applies:false` → no prompt, no Full-refresh button, no nudge.
- **Concurrency:** if a local refresh is already running platform-wide, the combined action defers to the existing coalescing behavior (it does not bypass it).

## Data flow (forward, happy path)

```
Operator clicks Generate (local/hybrid, localNeedsRefresh)
  → smart prompt → "Full refresh"
  → enqueue local refresh { thenRegenerateStrategy: true }
  → local refresh runs (existing pipeline, progress phase 1)
  → completion hook: usable snapshots? 
        yes → enqueue strategy regen (progress phase 2) → persist → done
        no  → abort, surface local failure, no strategy regen
```

## Testing strategy

- **Unit (comparator):** each `localNeedsRefreshReason` (missing / markets_changed / stale via the 30-day constant / null when fresh); `strategyStaleVsLocal` true and false; `applies:false` for non-local/unknown (and that it zeroes all other fields).
- **Integration (chain):** combined action enqueues the strategy regen after a successful local refresh; **aborts** (no strategy regen) on local hard-fail (errored / zero usable snapshots); **proceeds** on degraded-but-partial.
- **Component (UI):** smart prompt renders the reason-specific copy and the non-blocking "Generate anyway" override; reverse nudge shows/hides per `strategyStaleVsLocal`; non-local posture renders neither prompt, button-flag, nor nudge.

## Open items for the plan

- Confirm the exact existing status-read to extend for the client (vs a thin new field-bag), and the exact local-refresh completion hook site, at execution time (stale-grounding guard — re-verify line anchors against staging before editing).
- "Full refresh" button placement: admin strategy page in v1; **possible** addition on KCC/Hub where the standalone local-refresh button already lives — deferred unless the owner wants it in v1.
