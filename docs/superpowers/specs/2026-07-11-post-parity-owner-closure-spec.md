# Post-Parity Owner Closure — Feature Spec

**Date:** 2026-07-11
**Status:** OWNER-APPROVED / IMPLEMENTATION COMMITTED / P5 VERIFIED LOCALLY
**Authority:** `AUD-D1`–`AUD-D7` and `AUD-B1` in `docs/ui-rebuild/parity/owner-decision-packet.md`

## 1. Ownership Snapshot

- Feature family: post-parity capability, truthfulness, and shell closure
- Primary bounded context: `analytics-intelligence`
- Secondary integrations: `workspace-command-center`, `content-pipeline`, `brand-engine`, `platform-foundation`
- Behavior type: protected-behavior preservation plus owner-approved additive behavior
- Personas: a busy operator deciding what to act on, a client reading a truthful monthly result, and an owner verifying that rebuilt composition did not hide production capability

## 2. Route / API Surface

- Strategy POV: existing `GET`, `POST /generate`, `POST /regenerate`, and `PATCH /api/workspaces/:workspaceId/strategy-pov`
- Monthly digest: existing `GET /api/public/insights/:workspaceId/digest`
- No new route ids, aliases, URL parameters, endpoints, or feature flags
- Existing `ui-rebuild-shell` gating remains unchanged

## 3. Shared Contracts

- `shared/types/strategy-pov.ts`
  - `StrategyPovResponse`
  - `refreshAvailable` is server-owned and compares the stored canonical prompt fingerprint with current effective prompt inputs
  - operator edits are replaced only by explicit regeneration
- `shared/types/narrative.ts`
  - `MonthlyDigestAvailability = 'ready' | 'no_data'`
  - `MonthlyDigestData.availability`
  - the operational digest represents the current UTC month only
- No new database column is required. The POV store keeps its canonical hash and version as the concurrency boundary.

## 4. Implementation Record

All eight owner decisions have committed implementations. These records do not constitute P5 acceptance or a new visual approval.

| Decision | Status | Implementation references |
|---|---|---|
| `AUD-B1` | owner-approved; implementation committed; P5 verified | `d611db84d` |
| `AUD-D2` | owner-approved; implementation committed; P5 verified | `1c0f40ee3` |
| `AUD-D5` | owner-approved; implementation committed and repaired; P5 verified | `8892adc0d`, `a3efae499` |
| `AUD-D6` backend | owner-approved; implementation committed; P5 verified | `1451f78e2` |
| `AUD-D4` | owner-approved; implementation committed and repaired; P5 verified | `c1dafb697`, `1229e48ff` |
| `AUD-D7` | owner-approved; implementation committed; P5 verified | `1243b713d` |
| `AUD-D1` / `AUD-D6` UI | owner-approved; implementation committed and repaired; P5 verified | `29bac116a`, `833c26a9b` |
| `AUD-D3` | owner-approved; implementation committed and repaired; P5 verified | `f46d4cfcd`, `f8d75d60e`, `43aec6960` |

The shell, Pipeline, and Engine post-implementation hardening hashes are `43aec6960`, `1229e48ff`, and `833c26a9b`, respectively. Structured AI and effective-trial metering hardening is committed in `eee07ed51`, `d686d8030`, `a3efae499`, and `58a7068d5`; the intelligence-consumer census and executable inventory are reconciled in `fe5d5ff58`.

## 5. Query Cache + Real-Time Contract

- Strategy POV reads keep `queryKeys.admin.strategyPov(workspaceId)`.
- `WS_EVENTS.STRATEGY_POV_GENERATED` refreshes saved POV state.
- `WS_EVENTS.INTELLIGENCE_CACHE_UPDATED` also refreshes POV freshness because evidence or effective voice may have changed.
- Digest reads keep `queryKeys.client.monthlyDigest(workspaceId)` and existing producer invalidations.
- D1, D2, D3, D4, and D7 add no mutation and therefore add no event.

## 6. Test Ownership

- D1/D6: strategy POV unit/integration/cron coverage plus Engine component coverage
- D2: Cockpit component coverage
- D3: rebuilt chrome and registry-wide shell coverage
- D4: Content Pipeline Published component coverage
- D5: digest unit/integration/public-read/UI coverage
- D7: Tooltip and stacked-overlay component coverage
- Critical failures: hidden recommendation states, automatic loss of operator edits, stale prompt reuse after evidence/voice change, mixed-period client claims, false no-data/zero claims, duplicate provider KPIs, and tooltips below the active Drawer

## 7. Verification Commands And Current Evidence

- Focused red/green tests in every lane
- `npm run lint:hooks`
- `npm run typecheck`
- `npx vite build`
- `npm run pr-check`
- `npm run verify:bundle-budget`
- `npm run verify:deferred-ledger`
- `npx vitest run`
- Fixed desktop browser checks at `1440x900` and `1600x1000`

Final P5 evidence:

- full suite: 2,077 files and 29,063 tests passed, with one skip and three todos;
- production build: 269 assets totaling 1.72 MiB gzip, with 73 new sub-50 KiB warning-only assets;
- committed owner-approved baselines: CSS 37,307 B, Page Rewriter 8,819 B, aggregate 1,720,000 B;
- fresh independent review: `PASS` after repair of all findings;
- live fixed-viewport review: required 1440×900 and 1600×1000 changed-surface checks pass without overflow or current dev-server warnings/errors;
- final combined gates: typecheck, hooks lint, build, PR checks, bundle/deferred/feature-flag/lexicon verifiers, and `verify:platform:quick` pass.

P5 is complete locally from this combined evidence. It is not a release-readiness or staging-verification claim.

## 8. Open Questions / Risks

- Durable historical digest snapshots are explicitly deferred; current code must not reconstruct historical operational claims from mutable stores.
- Live-provider verification remains outside scope without separate staging authority and credentials.
- The single-row admin/client Strategy POV storage model is pre-existing and is not widened into a migration in this closure.
- Direction approval and committed implementation did not substitute for final P5 review or rendered evidence; those gates are now recorded above.
- No push, PR, staging extraction, live-provider spend, or new visual approval is authorized by this spec.
