# Post-Parity Owner Closure — Implementation Plan

> Controller: Sol. Read-only inventories: Luna. Isolated implementation: Terra high/xhigh. Maximum three concurrent write lanes; one visual surface per writer; exclusive file ownership.

**Goal:** Implement owner-approved `AUD-D1`–`AUD-D7` and `AUD-B1` without changing route meaning, exact-once capability homes, `ui-rebuild-shell` gating, or the settled parity baseline.

**Authority:** `docs/ui-rebuild/parity/owner-decision-packet.md` → `docs/superpowers/specs/2026-07-11-post-parity-owner-closure-spec.md` → `docs/rules/post-parity-owner-closure.md` → this plan.

## Dependency Graph

```text
P0 owner record + shared contracts + B1
 ├─ P1a D6 POV backend ───────────────┐
 ├─ P1b D5 current-month digest       │
 └─ P1c D2 Cockpit decision band      │
                                       ├─ P2 review + integration checkpoint
P1a ──> P3a D1 Engine + D6 frontend ──┤
P0  ──> P3b D4 Pipeline Published ────┤
P0  ──> P3c D7 shared Tooltip ─────────┘
P2/P3 ──> P4 D3 rebuilt-shell health footer (shared shell last)
P4 ──> P5 registry smoke + full verification + acceptance records
```

`EngineSurface.tsx` is owned by one visual lane for D1 and D6 frontend integration. D3 is last because it affects every rebuilt route. D5 is independent but contract-heavy. D2/D4 reuse existing read models and add no server work.

## P0 — Contracts, Decision Record, and Bundle Ratchet

**Owner:** Sol
**Bounded contexts:** analytics-intelligence primary; platform-foundation secondary

Files:

- `shared/types/strategy-pov.ts`
- `shared/types/narrative.ts`
- `data/bundle-budget-baseline.json`
- owner/spec/rule/plan documents

Acceptance:

- Add `StrategyPovResponse` with server-owned `refreshAvailable`.
- Add `MonthlyDigestAvailability` and `MonthlyDigestData.availability`.
- Set only CSS to `37,307` and Page Rewriter to `8,819`; keep total `1,720,000`.
- `npm run typecheck`, focused contract tests, production build, and bundle verifier pass.
- Commit before write-lane dispatch.

## P1a — Evidence-Aware, Edit-Safe Strategy POV Backend

**Model:** Terra xhigh
**Owner files:**

- `server/strategy-pov-generator.ts`
- `server/strategy-pov-store.ts`
- `server/routes/strategy-pov.ts`
- `server/strategy-issue-cron.ts`
- POV unit/integration/cron tests only

Test-first acceptance:

- Hash changes for every rendered evidence/effective-voice/custom-prompt change and is stable for identical inputs.
- Only `seoContext`, `learnings`, `siteHealth`, and `clientSignals` are assembled.
- Effective voice is injected exactly once; calibrated/no-sample profiles never receive a contradictory no-voice statement.
- Nonce bypasses cache but persisted hash remains canonical.
- GET exposes freshness; normal generate and scheduler preserve edited stale POVs.
- Explicit Regenerate replaces the draft and clears freshness.
- Version-conditional save discards an in-flight result after an operator edit.
- Missing learnings stay unavailable, tracked wins preserve attribution without an unbounded “recent” label, generation is per-workspace single-flight, and delayed PATCH responses return the latest committed version.

## P1b — Current-Month, Honest-No-Data Digest

**Model:** Terra xhigh
**Owner files:**

- `server/monthly-digest.ts`
- `server/client-insight-digest-view-model.ts`
- bounded ROI highlight window work in `server/outcome-tracking.ts`
- `src/hooks/client/useClientInsightViewModel.ts`
- `src/components/client/MonthlyDigest.tsx`
- digest unit/integration/component tests only

Test-first acceptance:

- Public query parameters cannot select a historical month.
- GSC, GA4, insights, approvals, work orders, and measured outcomes use one declared current-UTC-month reporting window.
- Evidence-free output is `no_data`, makes no AI call, and never claims performance held steady.
- Fulfilled zero-valued provider evidence remains `ready`.
- Negative evidence remains evidence; lifetime learnings are excluded; AI-failure copy follows measured direction; ROI execution attribution reaches prompt and client UI.
- Durable historical snapshots are not simulated.

## P1c — Cockpit Unique-Decision Band

**Model:** Terra high
**Owner files:**

- `src/components/cockpit-rebuilt/CockpitSurface.tsx`
- optional `CockpitDecisionBand.tsx`
- `tests/component/cockpit-rebuilt/CockpitSurface.test.tsx`

Test-first acceptance:

- One compact band after verdict and before work streams.
- Organic value, content velocity, and overall health only.
- No duplicated clicks, impressions, users, or sessions.
- Null values render honest establishing/unavailable states, never fabricated zeroes.

## P2 — Parallel-Batch Review Checkpoint

**Owner:** Sol

- Review every diff and grep for duplicate contracts/predicates.
- Confirm exclusive ownership and no route/flag/API drift.
- Run focused suites, hooks lint, typecheck, build, PR check, bundle verifier, deferred-ledger verifier.
- Commit coherent families separately before the next write batch.

## P3a — Engine Capability Homes and POV Freshness UI

**Model:** Terra xhigh; one surface owner
**Owner files:**

- `src/hooks/admin/useEngineRebuilt.ts`
- `src/api/strategyPov.ts`
- `src/hooks/admin/useStrategyPov.ts`
- `src/components/engine-rebuilt/EngineSurface.tsx`
- `src/components/engine-rebuilt/EngineOperations.tsx`
- new `EngineRecommendationHistory.tsx`
- Engine/history component tests

Test-first acceptance:

- Primary Backing Moves equals canonical `isActiveRec`; its full complement appears in history.
- Weekly Briefings, history, and SEO Change Impact are default-collapsed, lazy-mounted, and exact-once.
- History preserves full OV/EMV detail and un-dismiss for dismissed rows.
- Freshness banner explains that evidence/voice changed and edits were preserved; only explicit Regenerate replaces them.

## P3b — Pipeline Published Aggregate Evidence

**Model:** Terra high
**Owner files:** `PublishedContentLens.tsx` and its existing Content Pipeline component test

Acceptance:

- Compact impressions/sessions row follows the primary summary and precedes controls.
- Uses the existing authoritative summary.
- Empty output omits the row; unavailable providers render `—`, not zero.
- Existing `?item=` and Drawer behavior stay unchanged.

## P3c — Overlay-Aware Shared Tooltip

**Model:** Terra high
**Owner files:**

- `src/components/ui/overlay/Tooltip.tsx`
- `src/components/ui/overlay/overlayUtils.ts`
- Tooltip/stacked-overlay component tests

Acceptance:

- A Tooltip triggered inside the topmost canonical Drawer/Modal appears above it.
- A background or ordinary page Tooltip keeps the normal tooltip layer.
- ARIA linkage, hover/focus timing, viewport clamping, and reduced motion remain intact.

## P4 — Rebuilt-Shell Connection Health, Last

**Model:** Terra high or Sol
**Owner files:**

- `src/components/layout/RebuiltAppChrome.tsx`
- `src/components/ui/layout/AppShell.tsx`
- optional new shell health component
- `src/App.tsx` prop wiring
- rebuilt chrome/AppShell/App component tests
- `data/ui-rebuild-deferred-ledger.json` (`DEF-shell-005` → done)

Acceptance:

- Existing health query supplies HTTP, OpenAI, Webflow, and workspace-count state once.
- Compact footer is present across every rebuilt route and does not duplicate Settings controls.
- Rail, focus mode, mobile Drawer, topbar actions, Command Palette, and Admin Chat remain exact-once.

## P5 — Independent Review and Final Evidence

**Owner:** Sol; fresh Luna read-only reviewers

- Fresh diff review per bounded context and a separate functionality/wiring sweep.
- Browser smoke every changed surface at `1440x900` and `1600x1000`; inspect overflow, computed type, Drawer/Tooltip stacking, and shell footer persistence.
- Run full `npx vitest run`, hooks lint, typecheck, production build, PR check, bundle/deferred/feature-flag/platform verifiers.
- Update `FEATURE_AUDIT.md`, `BRAND_DESIGN_LANGUAGE.md`, parity contracts, decision records, and `data/roadmap.json` only to the implementation truth.
- Commit each completed family separately. Do not push, open a PR, or begin staging extraction.

## Deferred by Design

- Immutable historical digest snapshots
- Single-row admin/client POV storage migration
- Live-provider/staging proof
- Deeper provider telemetry and generic performance refactors
- Route, alias, feature-flag, or capability-home retirement
