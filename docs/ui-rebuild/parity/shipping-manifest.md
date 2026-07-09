# UI Parity Integration Baseline Shipping Manifest

Baseline: the integration checkpoint commit that introduces this file on `codex/ui-prototype-alignment`.

This commit is the immutable fork point for the parallel parity goal. It is intentionally broader than a shipping PR. Never open it as one PR; extract reviewed cohorts from `staging` in the dependency order below.

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

- Create each shipping branch from current `staging`; never cherry-pick this baseline wholesale.
- Apply only the semantic/path cohort being shipped, then run its targeted tests and all final gates.
- Preserve route ids, feature-flag behavior, URL receivers, legacy aliases, and exact-once capability homes.
- Ship dependent cohorts only after their prerequisite PR is merged and verified on staging.
- Keep local `/tmp/asset-dashboard-codex-parity-captures/` screenshots as review evidence; regenerate them for the shipping branch rather than committing local paths as baselines.
