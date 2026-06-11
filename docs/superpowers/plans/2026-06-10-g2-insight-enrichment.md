# G2 — Insight Enrichment + Renderers + State Machine Wiring (absorbed 5b/5c)

> Lane G, Wave 2 (PR #G2). Branch: `claude/core-g2-insight-enrichment`.
> Master plan: `2026-06-10-core-features-remediation-master.md` §G2.
> **Prerequisite: G1 merged** (same files; contract test covers `lost_visibility` from G1).

---

## Problem

1. **`competitor_alert` upsert** in `server/intelligence-crons.ts:155` calls raw `upsertInsight` without
   passing `impactScore` or `domain`. Sibling types (competitor_gap, ranking_opportunity) go through
   `enrichAndUpsert()` or set those fields inline. Alerts surface in the feed with `impactScore=0` and
   `domain=undefined`, losing priority in the ranked feed.

2. **`anomaly_digest` stale-insight pruning** is missing from the anomaly detection write path.
   `deleteStaleInsightsByType()` is called for `competitor_alert` at the workspace level but there is no
   equivalent call for `anomaly_digest`. Stale anomaly rows remain in the feed after anomalies clear,
   because `anomaly_digest` rows with `bridge_source IS NULL` are NOT immune to stale cleanup — the
   bridge-source immunity only applies to bridge-authored rows. The anomaly detection cron is the
   authoritative writer; it must also own the cleanup.

3. **9 default-falling InsightTypes** in `src/hooks/admin/useInsightFeed.ts:transformToFeedInsight`:
   `keyword_cluster`, `competitor_gap`, `strategy_alignment`, `anomaly_digest`, `site_health`,
   `emerging_keyword`, `competitor_alert`, `freshness_alert`, `milestone_attribution` all fall through to
   the default branch producing `headline = insightType.replace(/_/g, ' ')`. These are real admin insight
   types with defined data shapes — they should surface useful, human-readable headlines.

4. **InsightsDigest.tsx** uses `INSIGHT_TYPE_ICONS` and `INSIGHT_TYPE_ACTIONS` maps (all 19 types
   registered), but `mapServerInsights()` uses those maps uniformly — no per-type headline/body
   customization is applied. The contract test must verify that both surfaces have non-generic rendering
   paths (icon + action + narrative headline/body in InsightsDigest via the narrative field from the
   server, icon not falling back to `Sparkles`).

5. **`REQUEST_TRANSITIONS`** and **`MATRIX_CELL_TRANSITIONS`** in `server/state-machines.ts` (lines ~238
   and ~222) have zero consumers: `updateRequest()` in `server/requests.ts` and `updateMatrixCell()` in
   `server/content-matrices.ts` accept any status value. The six already-wired machines are enforced at the
   store layer, not the route layer. These two should match that pattern.

---

## Scope (re-verified against staging head 2026-06-10)

### Task 1 — competitor_alert enrichment
- Add `impactScore` and `domain: 'search'` to the `upsertInsight` call in `intelligence-crons.ts:155-170`.
- `impactScore` formula: use `computeImpactScore(severity, data)` from `server/insight-enrichment.ts`
  (already imported pattern in `analytics-intelligence.ts`; add import here).
- `domain`: `'search'` — matches `classifyDomain('competitor_alert')` which returns `'search'` (line 86
  in `insight-enrichment.ts` — `competitor_alert` is in the `searchTypes` array).

### Task 2 — anomaly_digest pruning / auto-resolve loop
- In `server/anomaly-detection.ts`, after the workspace's anomaly insight write loop (~line 702), add:
  `deleteStaleInsightsByType(ws.id, 'anomaly_digest', cycleStart)` — unconditional, outside the try block
  (mirrors the `competitor_alert` cleanup pattern and analytics-insights.md §8.2 rule).
- Already imported: `deleteStaleInsightsByType` is used in `analytics-intelligence.ts`; add import to
  `anomaly-detection.ts` or verify it's already there.
- The boost-reversal loop (`reverseAnomalyBoostIfNoneRemain`, run-anomaly-scan reversal loop) already
  handles score cleanup — Task 2 is strictly the digest-row stale cleanup.

### Task 3 — Admin renderer cases (useInsightFeed.ts)
Add `case` branches in `transformToFeedInsight` for the 9 default-falling types.
Each must produce a specific `headline` and at least one `contextParts` entry:

| InsightType | headline formula | contextParts |
|---|---|---|
| `keyword_cluster` | `"${data.queries?.length ?? data.label} queries clustered under "${data.label}"` | `Avg position ${data.avgPosition?.toFixed(1)}` if present |
| `competitor_gap` | `"${data.keyword}" — competitor at #${data.competitorPosition}` | `Our position: ${data.ourPosition ?? 'not ranking'}` |
| `strategy_alignment` | `"${data.alignedCount} aligned, ${data.misalignedCount} misaligned pages"` | `${data.untrackedCount} untracked` if > 0 |
| `anomaly_digest` | `"${data.anomalyType.replace(/_/g,' ')} — ${Math.abs(data.deviationPercent)}% deviation"` | `${data.durationDays} day${data.durationDays !== 1 ? 's' : ''} ongoing` |
| `site_health` | `"Site health: ${data.siteScore}/100"` | delta if `data.scoreDelta` present: `${delta > 0 ? '+' : ''}${delta} from last audit` |
| `emerging_keyword` | `"${data.keyword}" — rising trend` | `Vol. ${data.volume}` if present; `Difficulty: ${data.difficulty}` |
| `competitor_alert` | `"${data.competitorDomain} ${data.alertType.replace(/_/g,' ')}"` | keyword if present; position change if present |
| `freshness_alert` | `"Content last analyzed ${data.daysSinceLastAnalysis}d ago"` | `${data.impressions ? fmtNum(data.impressions)+' impressions at risk' : ''}` |
| `milestone_attribution` | `"Brief delivered ${data.daysSinceDelivery}d ago crossed ${data.thresholdCrossed.replace(/_/g,' ')}"` | `${data.currentClicks} clicks tracked` |

### Task 4 — Renderer-coverage contract test
New file: `tests/contract/insight-renderer-coverage.test.ts`

Test 1 — **Admin feed (useInsightFeed.ts)**: every `InsightDataMap` key has a named `case` in
`transformToFeedInsight` (not just the default branch). Verify by reading the source file and asserting
`source.includes("case '${type}'")`  for each key.

Test 2 — **InsightsDigest.tsx**: every `InsightType` value appears as a key in `INSIGHT_TYPE_ICONS`
(non-Sparkles value) and in `INSIGHT_TYPE_ACTIONS` (explicit entry with a real tab label). Verify by
reading the source file.

### Task 5 — REQUEST_TRANSITIONS + MATRIX_CELL_TRANSITIONS wiring

**Mutation sites (grep-verified 2026-06-10):**

| Entity | File | Function | Pattern |
|---|---|---|---|
| `request` | `server/requests.ts:151` | `updateRequest()` — the function itself | Add `validateTransition('request', REQUEST_TRANSITIONS, existing.status, merged.status)` at line ~160 before the `stmts().update.run()` call |
| `request` (bulk route) | `server/routes/requests.ts:151` | bulk-update passes status unchecked | Validated upstream by `requestStatusSchema`; the store-layer guard in `updateRequest` covers this path |
| `matrix_cell` | `server/content-matrices.ts:304` | `updateMatrixCell()` — the function itself | Add `validateTransition('matrix_cell', MATRIX_CELL_TRANSITIONS, cell.status, updates.status)` at line ~304 inside the `if (updates.status && updates.status !== cell.status)` block, before history push |

**Guard placement rule:** store-layer, not route-layer (matches the six existing wired machines).

**GUARD_SIGNALS additions** (for the contract test):
```typescript
{ entity: 'request',     file: 'server/requests.ts',        transitionToken: 'REQUEST_TRANSITIONS' },
{ entity: 'matrix_cell', file: 'server/content-matrices.ts', transitionToken: 'MATRIX_CELL_TRANSITIONS' },
```

**Error handling:** `validateTransition` throws `InvalidTransitionError` (already exported from
`server/state-machines.ts`). Callers:
- `updateRequest` should catch and return `null` (matches the existing null-on-not-found contract).
- `updateMatrixCell` should re-throw (the route handler catches errors and returns 500 — consistent with
  the `mutationError(404, ...)` pattern).

---

## Tests

### Contract test (TDD — write first, make red, then implement)

`tests/contract/insight-renderer-coverage.test.ts` — two `it()` blocks:
1. "every InsightDataMap key has a named case in transformToFeedInsight" — reads source, asserts.
2. "every InsightType has a non-default icon and an explicit action in InsightsDigest" — reads source,
   asserts non-Sparkles icon and explicit `INSIGHT_TYPE_ACTIONS` entry.

### Guard tests

Extend `tests/contract/state-machine-guard-coverage-contract.test.ts` by adding the two new
`GUARD_SIGNALS` entries. The existing test loop handles them automatically.

Add unit tests in a new `tests/unit/request-transition-guard.test.ts`:
- `updateRequest(wsId, id, { status: 'closed' })` when current status is `'new'` → returns `null` (guard
  rejects, function catches and returns null).
- `updateRequest(wsId, id, { status: 'in_review' })` when current status is `'new'` → succeeds (valid
  transition).
- `updateMatrixCell(wsId, matrixId, cellId, { status: 'published' })` when current status is `'planned'`
  → throws `InvalidTransitionError` (illegal skip).
- `updateMatrixCell(wsId, matrixId, cellId, { status: 'keyword_validated' })` when current status is
  `'planned'` → succeeds.

### Enrichment integration test

Add a `describe` block in `tests/integration/competitor-alert-enrichment.test.ts` (new file):
- Seed a workspace, invoke the competitor-alert upsert path directly with a mock alert, assert that the
  resulting insight has `impactScore > 0` and `domain === 'search'`.

### Anomaly pruning test

Extend `tests/integration/anomaly-detection.test.ts` (if it exists) or add a focused unit:
- Write an `anomaly_digest` insight row, advance `cycleStart`, call the stale-cleanup path, assert the
  row is gone.

---

## File ownership (OWNS — modify)

- `server/intelligence-crons.ts` — competitor_alert impactScore/domain
- `server/anomaly-detection.ts` — anomaly_digest stale cleanup call
- `src/hooks/admin/useInsightFeed.ts` — 9 renderer cases
- `tests/contract/insight-renderer-coverage.test.ts` (new)
- `tests/contract/state-machine-guard-coverage-contract.test.ts` — 2 new GUARD_SIGNALS
- `server/requests.ts` — validateTransition guard in updateRequest
- `server/content-matrices.ts` — validateTransition guard in updateMatrixCell
- `tests/unit/request-transition-guard.test.ts` (new)

**READS (do NOT modify):**
- `server/state-machines.ts` — imports only
- `shared/types/analytics.ts` — InsightDataMap keys (no new types)
- `server/insight-enrichment.ts` — computeImpactScore import
- `server/analytics-insights-store.ts` — deleteStaleInsightsByType import
- `src/components/client/InsightsDigest.tsx` — verified clean, no modifications needed (maps already
  cover all 19 types; narrative comes from server `ClientInsight.narrative` field)

---

## Verification commands

```bash
npm run typecheck
npx vite build
npx vitest run tests/contract/insight-renderer-coverage.test.ts
npx vitest run tests/contract/state-machine-guard-coverage-contract.test.ts
npx vitest run tests/unit/request-transition-guard.test.ts
npx vitest run
npm run pr-check
npm run verify:feature-flags
grep -r "purple-" src/components/client/   # must be clean
```

---

## Review amendments (post-merge verified review — commit "(review)")

A verified review found 2 Critical + 5 Important + minors. All fixed in the same PR; the
spec deviations they introduced are recorded here (spec-amendment-sync).

### C1 — anomaly_digest prune wired into the wrong branch (`server/anomaly-detection.ts`)
The Task-2 prune was placed INSIDE `if (detected.length > 0)` and inside the per-workspace `try`,
and used a `cycleStart` cutoff. Three defects: (a) a workspace whose anomalies clear
(`detected.length === 0`) never pruned → stale rows lived forever; (b) `alreadyDetected()` suppresses
re-emission for 48h while scans run every 6–12h, so an ONGOING anomaly is absent from `detected` and
its digest row is not re-stamped — a `cycleStart` cutoff in a cycle that fires a *different* anomaly
would delete the still-active row, breaking firstDetected/durationDays continuity; (c) the
no-data-connection `continue` path (M3) never pruned at all.

**Fix (mirrors the competitor precedent, `intelligence-crons.ts:104/109/224-226`):**
- Added `ANOMALY_DEDUP_WINDOW_HOURS = 48` and a `pruneStaleAnomalyDigests(workspaceId, cycleStart)`
  helper using cutoff `cycleStart − 48h` so still-active (within-window) rows survive.
- The prune now runs UNCONDITIONALLY per workspace: on the no-connection `continue` path (M3 wipe)
  AND after the per-workspace `catch` (so it runs for `detected.length === 0` and even when detection
  throws). Removed the in-guard prune. Replaced the false "outside try" comment (M2).

### C2 — client flagging of approved/published cells 500'd (`server/state-machines.ts`, `routes/content-plan-review.ts`)
`MATRIX_CELL_TRANSITIONS` had no `approved→flagged` / `published→flagged` edge, but
`CLIENT_VISIBLE_CELL_STATUSES = {review, flagged, approved, published}` and the client UI
(MatrixProgressView CellPreviewModal) shows the flag form for ALL of them. Flagging an approved or
published cell threw `InvalidTransitionError` → 500.
**Fix:** added `approved→flagged` and `published→flagged` edges (flagging is a legitimate client
review action from any client-visible status), AND mapped `InvalidTransitionError` → 409 in the
public flag route as defense-in-depth.

### Task 5 — final MATRIX_CELL_TRANSITIONS edge set (deviation from "READS-only")
`state-machines.ts` was listed READS-only in the plan but gained edges. Justification per edge below.
The map is the minimal set that ADMITS every transition the real code paths perform:

| From | To | Backing code path |
|---|---|---|
| planned | keyword_validated, brief_generated, draft | keyword validation / brief gen / draft start (updateMatrixCell) |
| planned | review | send-samples admin action (sendSamplesForReview) |
| planned | approved | batch-approve admin action (batchApproveMatrixCells, APPROVABLE set) |
| keyword_validated | brief_generated, draft, planned | pipeline + send-back (updateMatrixCell) |
| keyword_validated | review | send-samples admin action |
| keyword_validated | approved | batch-approve admin action |
| brief_generated | draft, keyword_validated | pipeline + send-back |
| brief_generated | review | send-samples admin action |
| brief_generated | approved | batch-approve admin action |
| draft | review, brief_generated | submit for review / regen brief |
| review | flagged, approved, draft | client flag / approve / send-back |
| flagged | review, draft, approved | re-review / send-back / approve |
| approved | published | publish |
| approved | review | operator pulls an approved cell back to review |
| **approved | flagged** | **client flags an approved cell (G2/C2 — new)** |
| published | **flagged** | **client flags a published cell for changes (G2/C2 — new); otherwise terminal** |

The `approved→review` / `approved→published` / `review→*` / `flagged→*` edges already existed in the
committed map; the two **bold** edges are the C2 additions.

### I1 — contract test client half was vacuous (`tests/contract/insight-renderer-coverage.test.ts`)
The two client-half assertions were file-wide `source.includes('${type}:') && source.includes('INSIGHT_TYPE_ICONS')`
substring checks — mutation-proven vacuous (removing a type from one map still passed because the type
appears in the other map).
**Fix:** (a) the canonical type list is now PARSED from the `InsightDataMap` interface source in
`shared/types/analytics.ts` (hand-maintained `ALL_INSIGHT_TYPES` removed — a future type is auto-caught);
(b) `INSIGHT_TYPE_ICONS` and `INSIGHT_TYPE_ACTIONS` are sliced (balanced-brace, anchored on `=` to skip
the type annotation's inner braces) and membership is asserted PER MAP, so a missing entry in EITHER map
fails. Re-proven by mutation: deleting one entry from each map fails the corresponding assertion.
The "non-Sparkles" claim was dropped (description and code now agree); per M4 `keyword_cluster` was
changed from `Sparkles` (== the fallback icon) to `Layers` so its icon is meaningfully distinct.

### I2 — matrix-level PUT bypassed the cell guard (`server/content-matrices.ts`, `routes/content-matrices.ts`)
`PUT /api/content-matrices/:ws/:matrixId` → `updateMatrix` accepted `updates.cells` wholesale with zero
transition validation (any caller could rewrite every cell status, e.g. published→planned).
**Fix:** `updateMatrix` now validates each incoming cell's status against its stored status (matched by
id, skipping unchanged statuses so the internal `updateMatrixCell` re-save and terminal cells don't
false-trip). Illegal moves throw `InvalidTransitionError`, mapped to 409 by both PUT and PATCH routes
via a shared `mapTransitionError` `mapError` callback.

### I3 — sendSamplesForReview non-atomic under the guard (`server/domains/content-plan/review-mutations.ts`)
The batch was created + mirrored BEFORE the cell-status loop, so a selected terminal cell threw
mid-loop, leaving some cells flipped and an orphaned batch.
**Fix:** all selected cells' transitions to `review` are validated BEFORE `createBatch` (cells already in
`review` are no-op-skipped). An ineligible cell yields a clean 409 with no batch created and no partial flips.

### M1 — illegal transitions surfaced wrong status codes
- `updateRequest` now THROWS `InvalidTransitionError` (was: catch→null, which the route mapped to 404).
  `PATCH /api/requests/:id` maps it to 409 with the machine message; 404 stays reserved for not-found.
- `PATCH /api/content-matrices/.../cells/:cellId` and the matrix PUT map `InvalidTransitionError` → 409
  (was generic 500).

### Tests added/changed
- `tests/integration/competitor-alert-enrichment.test.ts` (I4) — asserts `impactScore > 0`,
  `domain === 'search'` post-enrichment; `classifyDomain('competitor_alert') === 'search'`.
- `tests/integration/anomaly-digest-pruning.test.ts` (I4/C1) — seeds a stale + an active (within-window)
  `anomaly_digest` row on a no-connection workspace, runs `runAnomalyDetection(true)`, asserts the stale
  row is pruned AND the active row survives. Verified to FAIL against pre-C1-fix code.
- `content-plan-review-lifecycle.test.ts` — C2 cases (flag approved/published → 200; FAIL pre-fix) and
  I3 atomicity case (ineligible cell → 409, no orphaned batch).
- `content-matrices-routes.test.ts` — I2 PUT-bypass → 409 (status unchanged) and M1 PATCH illegal → 409.
- `requests-admin-lifecycle.test.ts` — M1 closed→new illegal → 409, row stays closed.
- `insight-renderer-coverage.test.ts` — rewritten per I1 (source-parsed types, per-map slicing).

### File ownership expansion (justified by findings)
Beyond the original OWNS set, the review touched: `server/routes/content-plan-review.ts`,
`server/routes/content-matrices.ts`, `server/routes/requests.ts`, `server/content-matrices.ts`,
`server/domains/content-plan/review-mutations.ts`, `src/components/client/InsightsDigest.tsx`,
and the integration test files above. `server/state-machines.ts` moved from READS-only to OWNS (C2 edges).

---

## Definition of done

- [ ] Contract test: insight-renderer-coverage — both assertions green
- [ ] GUARD_SIGNALS extended — state-machine-guard-coverage-contract passes
- [ ] `competitor_alert` insights written with `impactScore > 0` and `domain === 'search'`
- [ ] `anomaly_digest` stale rows cleaned on each detection cycle
- [ ] 9 default-falling types all have explicit `case` branches in `transformToFeedInsight`
- [ ] `updateRequest` rejects illegal transitions; `updateMatrixCell` throws for illegal status
- [ ] Transition guard unit tests: 4 cases pass
- [ ] `npm run typecheck && npx vite build` green
- [ ] Full test suite green
- [ ] pr-check clean
- [ ] No purple in client components
