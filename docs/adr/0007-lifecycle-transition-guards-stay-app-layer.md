# ADR 0007: Lifecycle Transition Guards Stay at the Application Layer (DB Trigger Enforcement Deferred)

## Decision

Status-transition legality is enforced at the application layer via
`validateTransition()` in `server/state-machines.ts`, wrapped by the shared
lifecycle envelope (`LIFECYCLE_REGISTRY`, `shared/types/lifecycle.ts`). We
**defer** adding DB-layer `BEFORE UPDATE OF status` triggers that would reject
illegal transitions inside SQLite. The single source of truth for legal edges
remains the `*_TRANSITIONS` tables, read by the app before every write. This
decision is revisited after the Reconcile arc lands.

## Context

Reconcile R3 asked whether transition legality should also be defended at the
storage layer as defense-in-depth. Two facts shaped the answer:

- **SQLite `CHECK` constraints cannot see the old value.** A `CHECK` on a column
  only sees the row being written, so it can validate a *value enum* (the only
  transition-adjacent constraints in-tree today are value enums: migrations
  020/029 `keyword_feedback`, 023 `seo_suggestions`, 047/049 `client_signals`)
  but cannot express `from → to` legality. Transition enforcement in SQLite
  therefore requires **`BEFORE UPDATE` triggers** (`OLD.status` vs `NEW.status`),
  one per protected table, comparing against a legal-edge set duplicated in SQL.
- **The app guard is already the enforcement point.** `validateTransition()` is
  called at 36 real sites across 24 server files and throws
  `InvalidTransitionError` before any write. Every legal edge lives once, in
  TypeScript. Duplicating that graph into per-table SQL triggers would create a
  second authority that can silently drift from the app tables — the exact
  parallel-machine failure mode R3 exists to prevent.

R3-PR1 (this PR) is envelope + census + docs only, with **zero behavior change**.
Introducing triggers here would be a behavior change (and a schema migration per
table), out of scope for the pure refactor, and premature before the app-layer
guard coverage is completed in later R3 PRs.

## Alternatives Considered

- **Add `BEFORE UPDATE` triggers now, per protected table.** Rejected for this
  arc: it duplicates the transition graph into SQL (drift risk + double
  maintenance), forces one migration per table, and enforces guards at the DB
  before the app-layer guards are even complete — inverting the safe ordering.
  It is also load-bearing that app guards land *first* (a delete-and-reinsert
  regen save would otherwise have a single trigger-violating row abort the whole
  transaction; see Reconcile R4's struck≠completed trigger, which is deliberately
  sequenced after its app guards).
- **`CHECK` constraints.** Rejected: cannot express `from → to` legality
  (no access to the old value); only usable for value-enum constraints, which we
  already have where warranted.
- **Do nothing / no explicit record.** Rejected: the deferral is a real scope
  decision that future agents must not silently re-open or assume was an
  oversight — hence this ADR.

## Consequences

- Transition legality is enforced in exactly one place (the app), keeping a
  single source of truth and avoiding a drift-prone SQL copy of the graph.
- The storage layer does not, by itself, reject an illegal transition written by
  a path that bypasses `validateTransition()`. Closing those bypasses is
  app-layer work (later R3 PRs route the remaining unmapped lifecycle write paths
  through the guard, and fold the two in-tree parallel validators —
  `server/copy-review.ts` and `server/voice-calibration.ts` — into the shared
  tables).
- If a targeted, high-value invariant needs storage-level enforcement (e.g. the
  Reconcile R4 `struck ≠ completed` constraint on `recommendation_items`), it is
  added as a **specific** trigger for that invariant with its app guards live
  first — not as a blanket per-table transition-trigger scheme. That narrow case
  does not reverse this ADR.
- Revisit trigger: after the Reconcile arc, if audit evidence shows illegal
  transitions still reaching storage despite complete app-layer coverage.
