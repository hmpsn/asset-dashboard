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
| `content_gap_votes` | normalized unique vote key | no for legacy rows | retain v1 vote alias; new raw/v2 votes coexist without exact-delete cross-talk |
| `strategy_keyword_set` | lower/trim stored term; runtime comparison key | yes | preserve stored term; only runtime semantic dedupe changes in K3c |
| rank snapshot JSON | raw GSC strings; runtime dedupe | yes | no storage rewrite; K3c changes runtime comparison only |
| recommendation producer identity | source/payload keys may include v1 keyword text | varies | S2 records an explicit v1 producer-identity version; K3c must migrate this seam rather than inventing a second normalizer |

## K3b additive storage contract

- `tracked_keywords_v2_compat` and `site_keyword_metrics_v2_compat` retain a complete payload for every raw variant and mark exactly one canonical variant per v2 identity. Noncanonical variants remain auditable and never win ordinary reads. The existing v1 tables remain deterministic rollback projections.
- `keyword_feedback_v2_compat` and `content_gap_votes_v2_compat` retain the complete current decision plus a transactionally assigned workspace write order. Alias tables retain every recoverable raw spelling. Existing v1 tables are the explicit store for unrecoverable legacy aliases.
- `serp_snapshots_v2_compat` retains each complete `(workspace,date,v2,raw)` observation. Readers choose one coherent row by observed time and raw-byte order; they never combine position, URL, or feature fields from different observations.
- Before feedback, vote, or SERP code repurposes a legacy main-table row as a rollback projection, it copies the full pre-K3 payload into that store's `*_v1_legacy_aliases` table and records the main key in `*_v1_projection_keys`, in the same transaction. This preserves an unrecoverable decision/evidence row while allowing the main v1 table to remain a deterministic rollback projection.
- `local_visibility_snapshots.normalized_keyword_v2` is additive because the snapshot `id` remains row identity. Every exact lookup, latest query, grouping, trend, and retention seam uses explicit v2-first compatibility rather than silently switching the global helper.
- `keyword_metrics_cache_v2` is separate and explicitly versioned. The legacy cache remains rollback-only and is never read-forward or reinterpreted as v2 evidence.
- The backfill is an operator-only TypeScript CLI, dry-run by default, never invoked by server boot. It uses per-workspace immediate transactions and emits counts/stable error codes plus bounded redacted samples (`workspaceId` and stable row-reference hash only)—never raw keywords, workspace names, provider payloads, prompts, or secrets.

### Operator invocation

- Dry-run every workspace: `npm run db:backfill-keyword-identity-v2`
- Dry-run one workspace: `npm run db:backfill-keyword-identity-v2 -- --workspace-id <workspace-id>`
- Apply to one workspace: `npm run db:backfill-keyword-identity-v2 -- --apply --workspace-id <workspace-id>`
- Apply to every workspace only when intentionally authorized: `npm run db:backfill-keyword-identity-v2 -- --apply`

Empty or flag-like workspace values fail closed. The staging gate records the first dry-run, the apply report, and a second apply whose `inserted`, `updated`, and `errors` totals are zero. Compatibility census counts can remain nonzero on the second report because retained aliases, projections, and collisions are durable evidence rather than repeated writes.

## Collision rules

1. Backfills are transactional, idempotent, restart-safe, and run in TypeScript because SQLite migrations cannot execute the JavaScript NFKC policy.
2. Convergence is allowed only when recoverable raw values are truly v2-equivalent. Preserve status, intent, CPC, source, provenance, timestamps, and operator/client decisions using an explicit deterministic merge policy.
3. Meaning-distinct legacy rows collapsed by v1 are never combined based on the v1 key. If raw spelling is unavailable, retain the legacy key as an alias.
4. Dual reads resolve v2 first and then an explicit v1 alias. Dual writes persist v2 identity while compatibility is active.
5. Removing aliases is a later retirement PR with staging/production evidence; K3c does not remove them.
6. Tracked/site mutations reconcile at v2 identity level. Alternate raw spellings remain aliases and cannot later replace a newer canonical payload. Deleting one identity never deletes a meaning-distinct sibling sharing its v1 key.
7. Feedback/vote conflicts resolve by transactionally assigned write order, then timestamps, then raw-byte order. Conflicting statuses inside one bulk request for the same v2 identity reject the whole request rather than using input order.
8. `source_gap_key_v2` comes only from the raw gap identity held by the writer. A backfill may derive it only when the stored v1 pointer equals the tracked query v1 key; otherwise it remains unresolved and is counted.
9. Every dual write rebuilds each affected v1 projection inside the same transaction. The projected winner is the highest canonical `write_order`, then authoritative timestamps where present, then raw-byte order. Exact deletion re-elects from surviving v2 siblings sharing the v1 key; it never blindly deletes the rollback row.
10. Backfill assigns `write_order` only after sorting collision groups by authoritative timestamps where present and raw-byte order. Database scan/input order is never a tie-breaker.
11. A nonblank v2 identity with blank v1 is `v2_only`: it is written only to the sidecar, never inserted into a blank v1 projection, and remains unavailable to rollback readers by design. Reports count it separately; exact deletion still removes only that v2 identity.
12. Tracked/site single-identity mutations make the explicitly touched raw variant canonical after demoting the prior canonical in the same immediate transaction. Batch replace pre-groups by v2: an existing canonical remains canonical when its raw spelling is present; otherwise the store-specific deterministic whole-row policy elects one submitted variant. Historical non-submitted variants remain noncanonical audit rows. Backfill uses the deterministic policy only, never scan order.
13. Feedback/vote/SERP union readers include full legacy archives plus unmarked main-table legacy rows, and exclude main rows marked as rollback projections. Before the first projection write for a nonblank v1 key, archive the unmarked existing row, then mark and rebuild the projection atomically. Exact legacy deletion removes the archive alias; it does not delete a marked projection needed by surviving v2 siblings.

### Tracked/site canonical comparators

When a tracked-keyword v2 group has no retained canonical, select one complete row by this exact comparator (earlier item wins): pinned `true`; status `active > paused > replaced > deprecated > unset`; source `client_requested > manual > content_gap > recommendation > strategy_primary > strategy_site_keyword > unknown > unset`; latest valid `last_strategy_seen_at`; latest valid `strategy_generated_at`; earliest valid `added_at`; lowest non-null `sort_order`; raw query UTF-8/SQLite BINARY ascending. Do not field-merge losing rows. Single-identity explicit mutation still wins as rule 12 states.

When a site-metric v2 group has no retained canonical, select one complete row by: greater count of non-null metric fields; higher non-null volume; higher non-null difficulty; raw keyword UTF-8/SQLite BINARY ascending. Do not take maxima from different rows.

Batch creation without a prior canonical and backfill use these exact comparators. Backfill assigns monotonically increasing `write_order` only after comparator sorting; reverse database/input order must produce the same canonical rows and rollback projections.

## K3b public compatibility

- Feedback response shapes and pagination fields do not change. Recoverable v2 rows expose the trimmed raw display keyword in `keyword`; unrecoverable legacy rows expose their existing v1 key. Ordering is `write_order DESC`, then `updated_at DESC`, then raw/display byte order, and pagination/counting occurs after the v2-plus-unrepresented-v1 union.
- Feedback exact reads and deletes compute the supplied raw input identities, resolve v2 first, and use v1 only when no v2 identity exists. Delete responses use the resolved display/raw value for v2 and the historical key for legacy rows. Deleting C# cannot clear C or C++.
- The content-gap vote wire shape remains `{ votes: Record<string, string> }`. Keys are trimmed raw display keywords for recoverable v2 rows and unchanged v1 keys for legacy rows, so meaning-distinct C/C#/C++ votes coexist. `vote: 'none'` follows the same exact v2-first deletion rule.
- Existing public serializers continue omitting tracked-keyword identity/provenance internals. `sourceGapKeyV2` is composed through a server-internal metadata type and is never added to the broadly serialized `TrackedKeyword` contract.
- Metrics-cache reads return the caller-requested raw keyword, never the diagnostic `raw_keyword` stored on the canonical cache row.

## Phase gates

### K3a contract

- Persisted identity census and v2 policy are committed.
- Roadmap and dependency graph make K4 depend on K3c.
- No runtime or data changes.

### K3b compatibility/backfill

- Red tests cover fresh writes, pre-v2 upgrades, C/C#/C++/F#/.NET coexistence, composed/decomposed/non-Latin identities, deterministic reverse-order collisions, exact-delete isolation, content-gap votes, SERP/local/KCC/analytics joins, idempotence, rollback, K1 evidence/provenance preservation, paged/public reads, and cache versioning.
- Canonical comparison stays v1.
- Staging backfill reports scanned, inserted, updated, already-present, collision, alias, skipped, error, and unresolved-provenance counts without raw values or secrets. A second apply reports zero inserts/updates and zero errors.
- Writer, backfill, and staging-verifier tests require exactly one canonical row for every populated tracked/site v2 group (the partial unique indexes enforce only the upper bound). Re-election demotes or deletes the old canonical before promotion.
- V2-only Unicode rows are covered for fresh write, read, exact delete, report classification, and deliberate rollback unavailability; no blank v1 key is ever written.

### K3c switchover

- Staging backfill is complete and data-integrity checks show zero orphaned feedback, tracked keywords, metrics, or provenance links.
- Canonical/deep-link tests cover composed/decomposed accents, non-Latin scripts, Unicode numbers, compatibility forms, semantic technology tokens, punctuation-only input, determinism, and idempotence.
- Full verification and staging smoke are green before K4 begins.
