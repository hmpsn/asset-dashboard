# ADR 0008: Ephemeral-Source Snapshot Ref (capture source identity at write time)

## Decision

When we record a durable ledger row that references an **ephemeral source** — a
producer that is regenerated or deleted over time — we snapshot the source's
**identity at write time** onto the durable row, rather than relying on a live
lookup by `(sourceType, sourceId)` at read time.

Concretely, Reconcile R6-PR1 (Task B11) adds two additive, nullable columns to
`tracked_actions` (and its archive twin):

- `source_label TEXT` — the resolved human title captured when the action was
  recorded (denormalized flat copy for index-free lookup on the wins read path).
- `source_snapshot TEXT` — a JSON `{ title?, type?, page? }` identity blob
  (`TrackedActionSourceSnapshot`), parsed on read via `parseJsonSafe`.

`recordAction()` gains an optional `source?: { label; snapshot? }` param, threaded
from every write site that already holds the source's identity. Title/label
resolution (`resolveWinTitle` in `server/routes/outcomes.ts`) becomes
**snapshot → live → generic**: the snapshot is used first; the existing live
lookup and the honest generic per-action-type fallback (`WIN_FALLBACK_LABELS`)
are retained behind it.

This is the same pattern `predicted_emv` already uses (migration 116): a
regenerable producer's value is copied onto the durable outcome row so it
survives the producer's regeneration.

`client_deliverable.source_ref` is named as the **second application site** for
this pattern (future work): its per-adapter ref formats (`briefing:<id>`,
`work_order:<id>`, `aeo:<pageUrl>`, …) are ephemeral-source refs with the same
"source may be gone at read time" property.

## Context

The outcome ledger is designed to **outlive its sources**. Recommendation sets
are rebuilt on every scheduled audit (and `buildMergeKey` does not preserve the
old `opportunity`/`title`); briefs and posts are edited; approval items live
inside `approval_batches.items` JSON and are re-minted. So a `tracked_actions`
row's `(sourceType, sourceId)` frequently no longer resolves to a live title by
the time the outcome is measured and surfaced.

Before this ADR, the client-facing "We Called It" wins
(`GET /api/public/outcomes/:workspaceId/wins`) resolved titles by live lookup and
fell back to a generic per-action-type label ("Published new content") whenever
the source was gone. Local data showed the large majority of refs were already
unresolvable by row semantics — so the wins surface silently degraded to generic
labels, losing the specific, trust-building headline the client saw at send time.

Capturing the identity at write time — from data the write site already holds
(never fabricated; FM-2) — makes the durable ledger self-sufficient for display.
This PR is **expand-only**: the columns are nullable, `source` is optional, and a
call site that threads no source records a fully valid action (both columns NULL).

The archive twin is the sharpest edge. `ALTER TABLE ... ADD COLUMN` always
appends at the end, but the twin already carries a trailing `archived_at` column,
so adding the columns to both tables via ADD COLUMN would land them **after**
`archived_at` on the twin — violating `assertArchiveTwinParity()`
(`server/db/archive-twin.ts`, asserted at boot since Task B10) and re-opening the
exact positional-corruption drift migration 164 just closed. The migration
therefore ADDs the columns to the live table and **rebuilds the twin in canonical
column order** (live order + the two new columns + trailing `archived_at`),
following migration 164's rename-to-archive pattern, with an inline
`-- twin-alter-ok:` hatch documenting that the twin is updated via rebuild rather
than ADD COLUMN.

## Alternatives Considered

- **Keep live-lookup only (status quo).** Rejected: outcomes outlive their
  sources, so most wins degrade to generic labels — the specific problem this ADR
  exists to fix. The live lookup is retained as the *second* resolution tier for
  legacy rows, not the primary.
- **Add a hard foreign key from `tracked_actions.source_id` to each source
  table.** Rejected: sources are intentionally regenerated (delete-and-reinsert),
  span many heterogeneous tables (recommendations, briefs, posts, approvals,
  page/keyword refs), and the ledger must survive their deletion — an FK would
  either block regeneration or cascade-delete history. See
  `docs/rules/strategy-recommendations.md` for why rec rows carry no hard FK.
- **Store only the flat `source_label` (no JSON blob).** Rejected: the JSON
  `source_snapshot` also carries `type` and `page`, which the R6-PR2 integrity
  sweep (Task B12) needs to classify danglers per ref-kind class and which future
  consumers can use for richer display. `source_label` is the denormalized
  fast-path copy; both are kept in lockstep.
- **Backfill existing rows in this migration.** Rejected: the migration is
  additive only. Backfill of still-resolvable sources is a separate best-effort
  pass in R6-PR2 (Task B12), after staging verify, because the majority of
  historical refs are already unresolvable.
- **Delete the generic fallback now that snapshots exist.** Rejected for this PR:
  demoting `WIN_FALLBACK_LABELS` is B12's job, and only after the integrity sweep
  confirms zero dangling refs. Removing it here would regress legacy rows that
  have no snapshot.
- **Add the twin columns via ADD COLUMN on both tables (migration 116's shape).**
  Rejected: post-B10 the boot-time parity assert requires `archived_at` to stay
  trailing on the twin; an ADD COLUMN on the twin lands after `archived_at` and
  crashes boot. The canonical-order rebuild is required.

## Consequences

- Client-facing win titles are stable: they read the write-time snapshot first,
  so a regenerated or deleted source no longer degrades a real headline to a
  generic label. Legacy/pre-B11 rows (no snapshot) keep the live lookup + generic
  fallback unchanged.
- Two nullable columns on `tracked_actions` and its archive twin; the twin was
  rebuilt in canonical order so `assertArchiveTwinParity()` continues to pass at
  boot and the archive sweep round-trips both new columns via the generated
  explicit column list (never `SELECT *`).
- Every write site snapshots identity from data it already holds; sites with no
  ephemeral titled producer (schema deploy, brand-voice calibration, strategy
  regen, decay page ref) intentionally thread **no** `source` — the honest generic
  label is correct there (FM-2: never fabricate a title).
- `recordAction`'s payload shape gains one optional field; existing call sites and
  the ~30 tests pinning the payload are untouched (expand-only).
- The pattern is reusable: `client_deliverable.source_ref` is the next candidate
  site. A follow-up (R6-PR2/B12) adds a report-only integrity sweep that counts
  dangling refs per ref-kind class for both `tracked_actions` and
  `client_deliverable.source_ref`, plus a one-time best-effort snapshot backfill.
- The delayed drop of `tracked_actions_archive_r6_old` (the renamed-aside old
  twin) is a separate follow-up migration after staging verify + one backup
  retention window, per `docs/rules/destructive-migrations.md`.
