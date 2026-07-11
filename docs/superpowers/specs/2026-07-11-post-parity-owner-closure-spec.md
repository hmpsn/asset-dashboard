# Post-Parity Owner Closure — Feature Spec

**Date:** 2026-07-11
**Status:** OWNER-APPROVED / IMPLEMENTATION IN PROGRESS
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

## 4. Query Cache + Real-Time Contract

- Strategy POV reads keep `queryKeys.admin.strategyPov(workspaceId)`.
- `WS_EVENTS.STRATEGY_POV_GENERATED` refreshes saved POV state.
- `WS_EVENTS.INTELLIGENCE_CACHE_UPDATED` also refreshes POV freshness because evidence or effective voice may have changed.
- Digest reads keep `queryKeys.client.monthlyDigest(workspaceId)` and existing producer invalidations.
- D1, D2, D3, D4, and D7 add no mutation and therefore add no event.

## 5. Test Ownership

- D1/D6: strategy POV unit/integration/cron coverage plus Engine component coverage
- D2: Cockpit component coverage
- D3: rebuilt chrome and registry-wide shell coverage
- D4: Content Pipeline Published component coverage
- D5: digest unit/integration/public-read/UI coverage
- D7: Tooltip and stacked-overlay component coverage
- Critical failures: hidden recommendation states, automatic loss of operator edits, stale prompt reuse after evidence/voice change, mixed-period client claims, false no-data/zero claims, duplicate provider KPIs, and tooltips below the active Drawer

## 6. Verification Commands

- Focused red/green tests in every lane
- `npm run lint:hooks`
- `npm run typecheck`
- `npx vite build`
- `npm run pr-check`
- `npm run verify:bundle-budget`
- `npm run verify:deferred-ledger`
- `npx vitest run`
- Fixed desktop browser checks at `1440x900` and `1600x1000`

## 7. Open Questions / Risks

- Durable historical digest snapshots are explicitly deferred; current code must not reconstruct historical operational claims from mutable stores.
- Live-provider verification remains outside scope without separate staging authority and credentials.
- The single-row admin/client Strategy POV storage model is pre-existing and is not widened into a migration in this closure.
- Direction approval does not substitute for implementation review or final rendered evidence.
