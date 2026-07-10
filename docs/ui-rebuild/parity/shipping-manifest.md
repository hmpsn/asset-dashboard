# UI Parity Integration Baseline Shipping Manifest

Baseline: the integration checkpoint commit that introduces this file on `codex/ui-prototype-alignment`.

This commit is the immutable fork point for the earlier behavior checkpoint. It is intentionally broader than a shipping PR. It does not establish owner-approved visual parity for any surface. Never open it as one PR; extract reviewed cohorts from `staging` in the dependency order below.

## Baseline Verification

- `npm run lint:hooks`
- `npm run typecheck`
- `npx vitest run`: 2,030 files passed; 28,463 tests passed, 1 skipped, 3 todo
- `npx vite build`
- `npm run pr-check`
- `git diff --check`

## Shipping Cohorts

1. **Parity governance**
   - `docs/ui-rebuild/parity/**`
   - Owner decisions, route census, contracts, inventory, backlog, and execution evidence only.

2. **Typography authority**
   - `src/index.css`, `public/styleguide.css`, `tests/contract/typography-token-parity.test.ts`
   - Relevant `BRAND_DESIGN_LANGUAGE.md` and `FEATURE_AUDIT.md` entries.

3. **Rebuilt shell and navigation**
   - `src/App.tsx`, `src/components/layout/**`, rebuilt nav primitives, shell/co typography corrections, and matching component tests.
   - Includes prototype nav zones, global-route chrome context, mobile rail regression floor, and restored global chrome.

4. **Brand & AI modal-first correction**
   - `src/components/brand-ai-rebuilt/**` and its component test.
   - Depends on cohorts 1-3.

5. **Calibrated aligned surfaces**
   - Cockpit, Schema, Links, Performance, Competitors, Keyword Hub, Local Presence, and their matching tests.
   - Extract per surface; do not combine them into one PR.

6. **P1 safe pre-work**
   - Insights Engine, Content Pipeline, SEO Editor, Site Audit, Search & Traffic, Asset Manager, Page Rewriter, and Global Ops current-state cleanup/tests.
   - Each accepted behavior correction lands as a later atomic commit and ships in its own surface PR.

## Extraction Rules

These rules are dormant during the active visual-parity goal. Do not start staging extraction unless Joshua explicitly authorizes it after the owner-approval sequence.

- Create each shipping branch from current `staging`; never cherry-pick this baseline wholesale.
- Apply only the semantic/path cohort being shipped, then run its targeted tests and all final gates.
- Preserve route ids, feature-flag behavior, URL receivers, legacy aliases, and exact-once capability homes.
- Ship dependent cohorts only after their prerequisite PR is merged and verified on staging.
- Keep local `/tmp/asset-dashboard-codex-parity-captures/` screenshots as review evidence; regenerate them for the shipping branch rather than committing local paths as baselines.

## Current Integration Cohorts

The integration sandbox has advanced beyond the baseline through reviewed, surface-scoped commits. Shipping still starts from `staging`; these hashes are semantic extraction references, not a request to cherry-pick the entire stack.

| Cohort | Integration reference | Shipping boundary |
|---|---|---|
| Insights Engine | `588eada03` plus the owner-approved `codex/ui-visual-parity` surface commit | V1–V3 visual composition plus the Engine-owned tests/docs only; retain V4–V6 as explicit approved exceptions. Shipping remains dormant during this goal. |
| SEO Editor | `cb536234b` | Source-grouped worksheet and matching tests only. |
| Site Audit | `3e4cec39e`, `4d1fd9592` | Diagnostic demotion first; canonical Asset repair sender only after Asset receiver work is available. |
| Content Pipeline | `15eec15f3`, `4024ff87e` | Board-first slice and review fixes; keep later item workspaces deferred. |
| Rebuilt focus bridge | `a690f25d3` | Shared shell focus API plus Page Rewriter consumer/tests; ship before any dependent focus consumer. |
| Search & Traffic | `e24cb21a1`, `9bf362d21` | Search-default report first; degraded-provider homes and final color correction in the closeout reference. |
| Performance repair sender | `8cfc4ae78` | Canonical Asset filter sender; pair with the Asset receiver PR dependency. |
| Asset Manager | `241f54a25`, `9bf362d21` | Single Browse workshop first; repair-first placement, overlay precedence, All/weight metrics, and final tests in the closeout reference. |
| PageHeader pilot | `9bf362d21` | Shared opt-in variant plus Performance-only adoption/tests; do not bulk-migrate other surfaces. |
| Final behavior audit | `9bf362d21` | Cockpit, Global Ops, Local Presence, Performance color, route census, docs/roadmap, browser evidence, and an independent behavior-review `PASS`; extract only the owning surface from this mixed closeout commit. This is not an owner visual-parity approval. |

Route-home decision: Content Pipeline Published is the proposed Content Performance receiver because it already consumes shared readback data, but `/content-perf` remains standalone. Page Intelligence remains standalone until a later SEO Editor Research/detail slice proves every capability. No route migration belongs in the current extraction set.
