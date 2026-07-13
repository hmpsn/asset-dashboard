# Keyword Normalization Identity Migration

## Purpose

Keyword normalization is a durable identity contract, not only a display helper. The v1 comparison key is persisted in primary keys, unique indexes, provenance pointers, cache keys, and historical grouping columns. Unicode normalization therefore ships through additive compatibility before canonical switchover.

## Identity versions

- **v1:** lowercase ASCII letters/numbers, punctuation-to-space, collapsed whitespace. This remains canonical until K3c.
- **v2:** Unicode NFKC; conservative token rewrites for `C#`, `C++`, `F#`, and `.NET`; locale-independent lowercase; Unicode letters/numbers; punctuation-to-space; collapsed ASCII whitespace; no accent folding.
- `&` becomes `and` only when flanked by Unicode letters/numbers. Generic punctuation remains a separator.
- Raw provider, query, and display values are never rewritten by either identity helper.

## Persistence census

| Store | Existing identity | Raw recoverable? | K3b contract |
|---|---|---:|---|
| `tracked_keywords` | `normalized_query` primary key; `source_gap_key` provenance pointer | yes (`query`) | additive v2 identity/backfill; merge only true v2 equivalents and preserve every metadata/provenance field |
| `site_keyword_metrics` | `normalized_query` primary key | yes (`keyword`) | additive v2 identity/backfill with deterministic evidence preservation |
| `local_visibility_snapshots` | `normalized_keyword` indexes/grouping | yes (`keyword`) | additive v2 identity/backfill; historical grouping change is explicit |
| `serp_snapshots` | normalized query primary key | no for legacy rows | retain v1 alias; store raw/v2 identity for new rows |
| `keyword_metrics_cache` | normalized key primary key | no | version-invalidate/clear; never guess |
| `keyword_feedback` | normalized unique decision key | no for legacy rows | retain v1 decision alias; never silently merge or discard approval/decline/request state |
| `strategy_keyword_set` | lower/trim stored term; runtime comparison key | yes | preserve stored term; only runtime semantic dedupe changes in K3c |
| rank snapshot JSON | raw GSC strings; runtime dedupe | yes | no storage rewrite; K3c changes runtime comparison only |

## Collision rules

1. Backfills are transactional, idempotent, restart-safe, and run in TypeScript because SQLite migrations cannot execute the JavaScript NFKC policy.
2. Convergence is allowed only when recoverable raw values are truly v2-equivalent. Preserve status, intent, CPC, source, provenance, timestamps, and operator/client decisions using an explicit deterministic merge policy.
3. Meaning-distinct legacy rows collapsed by v1 are never combined based on the v1 key. If raw spelling is unavailable, retain the legacy key as an alias.
4. Dual reads resolve v2 first and then an explicit v1 alias. Dual writes persist v2 identity while compatibility is active.
5. Removing aliases is a later retirement PR with staging/production evidence; K3c does not remove them.

## Phase gates

### K3a contract

- Persisted identity census and v2 policy are committed.
- Roadmap and dependency graph make K4 depend on K3c.
- No runtime or data changes.

### K3b compatibility/backfill

- Red tests cover fresh writes, pre-v2 upgrades, collisions, idempotence, rollback, K1 evidence preservation, public reads, and cache versioning.
- Canonical comparison stays v1.
- Staging backfill reports counts, collisions, aliases, and errors without prompts/secrets.

### K3c switchover

- Staging backfill is complete and data-integrity checks show zero orphaned feedback, tracked keywords, metrics, or provenance links.
- Canonical/deep-link tests cover composed/decomposed accents, non-Latin scripts, Unicode numbers, compatibility forms, semantic technology tokens, punctuation-only input, determinism, and idempotence.
- Full verification and staging smoke are green before K4 begins.
