# Feature Flag Lifecycle Management

Every flag in `shared/types/feature-flags.ts` must include lifecycle metadata in `FEATURE_FLAG_CATALOG`.

Required lifecycle fields:
- `owner`
- `createdAt` (`YYYY-MM-DD`)
- `rolloutTarget`
- `removalCondition`
- `linkedRoadmapItemId`
- `staleAuditCadence`
- `lastReviewedAt`

## Per-workspace resolution

`isFeatureEnabled(flag, workspaceId?)` resolves a flag. The `workspaceId` is
**optional** and **backward-compatible** — omitting it is byte-identical to the
pre-P0 behavior:

Resolution priority (highest → lowest):
1. **Per-workspace DB override** — only consulted when a `workspaceId` is passed
   (`feature_flag_workspace_overrides`, migration 114). Set/clear via
   `setWorkspaceFlagOverride(key, workspaceId, enabled | null)` (pass `null` to remove).
2. **Global DB override** (`feature_flag_overrides`) — set via `setFlagOverride`.
3. **Env var** (`FEATURE_<FLAG>=true`).
4. **Hardcoded default** in `FEATURE_FLAGS`.

When no `workspaceId` is passed, the per-workspace layer is skipped entirely and
resolution is the global chain (steps 2–4) — the hot path is unchanged. This is the
runtime substrate for `rolloutTarget` staged rollout: `rolloutTarget` is static catalog
metadata, and the per-workspace override is the mechanism that actually enables a flag for
one client (canary) before all (e.g. the Opportunity Value scorer / SEO generation-quality
phases). Both override layers are cached in-memory (10s TTL) and invalidated immediately on
write.

## Source-of-truth contract

`shared/types/feature-flags.ts` is the only source of truth for:
- default values (`FEATURE_FLAGS`)
- labels + grouping (`FEATURE_FLAG_CATALOG`, `FEATURE_FLAG_GROUPS`)
- lifecycle metadata (`FEATURE_FLAG_CATALOG[key].lifecycle`)

Do not duplicate labels/groups/lifecycle metadata in component-local constants.

## Admin/API contract

`GET /api/admin/feature-flags` must return each flag with:
- value source metadata (`db`/`env`/`default`)
- catalog metadata (`label`, `group`)
- lifecycle metadata (`lifecycle`)

This keeps rollout and cleanup context visible where operators actually flip flags.

## Audit cadence

Run:

```bash
npm run verify:feature-flags
npm run verify:feature-flags -- --json
npm run verify:feature-flags -- --as-of 2026-05-15
```

The audit script validates:
- lifecycle metadata date integrity
- linked roadmap references (real roadmap item id or explicit `legacy-*` reference)
- review-due/stale-candidate queue based on cadence + last review date
- dated burn-down done-targets (see below)

Exit behavior:
- **fails** when lifecycle contract gaps exist (invalid dates, broken roadmap link)
- **passes with advisory output** when review-due flags or past-due-target flags are present

## Dated burn-down done-targets (R12b)

Every non-exempt, non-reserved flag gets a computed `doneTarget` (`YYYY-MM-DD`) in the
lifecycle report — the date by which the flag should reach a removal decision (promote
to default and delete the flag, or explicitly re-scope with an updated `removalCondition`
and `lastReviewedAt`). This turns the flag burn-down into a trackable, dated queue instead
of an open-ended "someday" list.

`doneTarget = lastReviewedAt + (cadenceDays × 3)`, where `cadenceDays` comes from
`staleAuditCadence` (`weekly` = 7, `monthly` = 30, `quarterly` = 90). The ×3 multiplier
mirrors the existing `staleCandidate` burn-down horizon, so "past done-target" and
"stale candidate" agree on what counts as overdue. The computation is pure/deterministic
(`addDaysToIsoDate` in `scripts/feature-flag-lifecycle.ts`, UTC-based, no `Date.now()`),
so tests can pass a fixed `asOf` anchor and assert stable results.

`doneTarget` is `null` for:
- **Reserved flags** (`lifecycle.status === 'reserved'`) — the gating code isn't wired
  yet, so a burn-down date would be meaningless until the feature ships.
- **Permanently exempt flags** (see below) — a deliberate indefinite gate has no
  removal date by design.

The report surfaces `pastDoneTargetCount` (report-level) and `pastDoneTarget` (per-row)
plus a `## Burn-Down Done Targets` markdown section listing every flag's target sorted
soonest-first. A past-due target does not fail the script (advisory only, same as
`reviewDue`) — it is a planning signal for the next platform-health cadence, not a CI gate.

## Permanent retirement exemptions

`PERMANENTLY_EXEMPT_FLAGS` in `scripts/feature-flag-lifecycle.ts` is a small allow-list of
flags that must **never** appear in the review-due queue, the stale-candidate list, or the
done-target burn-down — because they are deliberate, indefinite safety gates, not rollout
scaffolding with an expected sunset date.

Current members:
- `strategy-trust-ladder-autosend` — auto-send is intentionally never-on until a
  decoupled-tick auto-send with an operator veto/review window ships. Flipping this flag
  on without that mechanism reintroduces the exact hazard it was added to prevent (auto-send
  firing in the same tick that rings the operator doorbell, with no review window). Removing
  this flag from the exemption list requires a signed-off replacement safety mechanism, not
  just a stale-audit pass.

Adding a flag to `PERMANENTLY_EXEMPT_FLAGS` should be rare and deliberate — it opts a flag
out of the burn-down accountability this whole system exists to enforce. Prefer a normal
`removalCondition` + dated `doneTarget` for anything with a plausible sunset path.
