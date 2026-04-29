# Pre-Existing Test Failures Audit

**Date:** 2026-04-29
**Triggered by:** schema-yoast-parity-fields PR1 full-suite run on commit `67d68bef`
**Scope:** 8 failures across 4–5 test files unrelated to schema work
**Branch:** `claude/schema-yoast-parity-fields-pr1b`

## Summary

Of the original 8 failures cataloged when the PR1a full-suite run reported red:

- **2 files fixed by PR #374** (orphan-server feedback loop): `bulk-analysis-semrush-prefetch.test.ts`, `tier-gate-enforcement.test.ts`
- **3 files remain flaky in full-suite mode but pass in isolation**: `brandscript-hardening.test.ts > I14 burst-cap`, `deep-diagnostic-jobs.test.ts`, `content-decay-routes.test.ts`
- **All 3 remaining failures pass when run in isolation** (verified on commit `fb32a5f1`)

The remaining failures are **test-infrastructure flakes**, not real bugs. They share a common signature: pass alone, fail under full-suite parallel execution.

## Per-failure findings

### `tests/integration/brandscript-hardening.test.ts > I14 – aiLimiter burst cap`

| Property | Value |
|---|---|
| Category | **API_SIMULATION_BROKEN** (rate-limiter timing flake) |
| Reproducible in isolation? | NO — passes 4/4 |
| Reproducible in full suite? | YES — fails as the 4th request returns ≠ 429 |
| Root cause hypothesis | The `aiLimiter` is module-scoped state. When parallel test files run concurrently, requests from other test files consume the limiter's capacity, leaving fewer slots for this file's "first 3 requests + 4th = 429" assertion. |
| Last touch to SUT | `656eca41` ("fix(brandscript+tests): harden /import AI route + fix port collisions (review feedback)") — itself a previous attempt to stabilize this category |
| Recommended action | Reset the `aiLimiter` state in `beforeEach`. If the limiter is a singleton, expose a `__resetForTest()` method behind a test-only export. |
| Effort | ~30 min |

### `tests/integration/deep-diagnostic-jobs.test.ts`

| Property | Value |
|---|---|
| Category | **MOCK_INCOMPLETE** (drift between SUT exports and mock factory) |
| Reproducible in isolation? | NO — passes 7/7 |
| Reproducible in full suite? | YES — surfaces with `No "getActionsByWorkspace"/"getPendingActions"/"getTopWinsFromActions" export is defined on the "../../server/outcome-tracking.js" mock` |
| Root cause hypothesis | `server/outcome-tracking.js` was extended with new exports after `tests/mocks/outcome-tracking.ts` (or inline `vi.mock(...)` factory) was last updated. In isolation, vitest may resolve to the real module via top-level hoisting; in full suite, mock state collisions force the partial mock to apply, surfacing the missing exports. |
| Last touch to SUT (`server/outcome-tracking.ts`) | (verify with `git log -3 -- server/outcome-tracking.ts`) |
| Recommended action | Audit `tests/mocks/outcome-tracking.ts` (or the inline `vi.mock` factory in this test file) and add the missing exports as `vi.fn()` stubs. Pattern: each export the SUT defines must appear in the mock. |
| Effort | ~15 min |

### `tests/integration/content-decay-routes.test.ts`

| Property | Value |
|---|---|
| Category | **API_SIMULATION_OK or SEED_FLAKE** (timeout on a graceful-degradation test) |
| Reproducible in isolation? | NO — passes 32/32 |
| Reproducible in full suite? | YES — `Test timed out in 60_000ms` on "returns 200 with fallback recommendations when AI call fails" |
| Root cause hypothesis | The test mocks the AI call to reject, then asserts the route returns 200 with fallback content. In full-suite mode, the AI mock may collide with another file's mock state, causing the call to hang past 60s instead of rejecting cleanly. |
| Last touch to SUT | (verify with `git log -3 -- server/routes/content-decay.ts`) |
| Recommended action | Two options: (a) reduce timeout from 60s to 5s if the assertion is "rejection should fail fast"; (b) ensure `vi.mock(...)` for the AI helper is hoisted at top of file, with an explicit `mockImplementation(() => Promise.reject(...))` in `beforeEach`. The orphan-server fix from PR #374 doesn't apply here because this test doesn't spawn a child process. |
| Effort | ~30 min |

## Aggregate root causes

| Root cause | Count |
|---|---|
| `aiLimiter` state pollution across test files | 1 (`brandscript-hardening I14`) |
| `vi.mock` factory drift / missing exports | 1 (`deep-diagnostic-jobs`) |
| Timeout under suite-mode mock contention | 1 (`content-decay-routes`) |
| Orphan-server feedback loop | 0 (fixed by PR #374) |

## Recommended remediation

1. **Quick wins (mechanical, ~45 min total):**
   - Add missing exports to `outcome-tracking.js` mock (15 min)
   - Reset `aiLimiter` in `beforeEach` for `brandscript-hardening` (30 min)

2. **Investigation needed (~30-60 min):**
   - Reduce or fix the AI-mock timeout in `content-decay-routes` — verify the test's intent (graceful degradation when AI fails fast) matches the assertion path

3. **Confirm-and-document (no code change):**
   - None — all 3 remaining items have actionable fixes

## Out of scope for this audit

- Test suite parallelization strategy (e.g., `--no-parallel`, vitest `pool` settings) — would mask the symptom rather than fix the root cause
- Refactoring rate limiters to be DI-based instead of module-scoped — too invasive for a flake fix; file separately if the team wants to harden against this category

## Roadmap entries to file

| ID | Title | Priority | Sprint |
|---|---|---|---|
| `test-flake-aiLimiter-state-pollution` | Reset aiLimiter in beforeEach for brandscript-hardening I14 | P2 | Future |
| `test-flake-outcome-tracking-mock-drift` | Add missing exports to outcome-tracking.js mock | P2 | Future |
| `test-flake-content-decay-ai-mock-timeout` | Investigate + fix content-decay-routes graceful-degradation timeout | P2 | Future |

(Filed in `data/roadmap.json` as part of this Task 17 commit.)

## Appendix: PR #374 (already merged)

PR #374 ("fix(tests): null-guard afterAll cleanup to break the orphan-server feedback loop") shipped before this audit completed. It fixed the orphan-server feedback loop in `bulk-analysis-semrush-prefetch.test.ts` and `tier-gate-enforcement.test.ts`. Mechanism: `afterAll` cleanup was crashing on a `beforeAll`-failure path before `ctx.stopServer()` could fire, leaving Node child processes (PPID=1) holding the test port. The next run of the same test then hit `EADDRINUSE` at `startServer` and crashed the same way, compounding the leak.

The 3 remaining flakes do NOT share this root cause — they're independent test-infrastructure issues. Filing as separate roadmap entries.
