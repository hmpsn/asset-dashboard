# Client IA — P2: Collapse to the 4-Tab Two-Speed Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Controller commits; subagents never git-write.

**Goal:** When `client-ia-v2` is ON, the client dashboard nav collapses from ~11 tabs to **Overview · Inbox · Results · Deep Dive** (+ a reachable **Settings** home), where Deep Dive folds performance/search/analytics + strategy(rankings) + the site-health fix-list behind named sub-tabs, and Results is the promoted ROI surface. When `client-ia-v2` is OFF, the nav is **byte-identical** to today's 11-tab layout.

**Architecture:** `buildClientDashboardNav` branches on `client-ia-v2`: OFF → the existing array (unchanged); ON → the 4-tab set + Settings. New `ClientTab` values `deep-dive`, `results`, `settings` are added to the union, `KNOWN_CLIENT_TABS`, the `panels` map, and `resolveClientTab` (with a `roi → results` alias so old URLs survive). `DeepDiveTab` composes the EXISTING tab components (no behavior rewrite) under `Analytics`/`Rankings` sub-tabs and reads `?tab=` per the two-halves contract. A new contract test asserts `KNOWN_CLIENT_TABS` matches the `panels` keys so the collapse can't silently drop a tab.

**Tech Stack:** React 19 + React Router DOM 7 (`useSearchParams`), Vitest. Flag gate: `client-ia-v2` (already declared in P1).

**Scope source of truth:** `docs/superpowers/audits/2026-06-21-client-ia-preplan-audit.md` §"Later-phase scope (P2)" + §"Current IA". **Depends on:** P1 merged to staging.

**Owner decisions baked in:** depth tab label = **"Deep Dive"**; **build a real Settings home** for brand+plans; merge to staging when CI green.

---

## Reference: current contract (verified)

- `ClientTab` union — [`src/routes.ts:25`](../../../src/routes.ts): `overview · performance · search · health · strategy · analytics · inbox · plans · roi · content-plan · brand`.
- `KNOWN_CLIENT_TABS` + `resolveClientTab` — [`src/lib/client-dashboard-tab.ts:28-53`](../../../src/lib/client-dashboard-tab.ts) (search/analytics → performance alias).
- Nav builder — [`src/components/client/client-dashboard/clientDashboardNav.ts:21-54`](../../../src/components/client/client-dashboard/clientDashboardNav.ts) (returns `ClientNavItem[]`).
- Panels + lazy imports — [`src/components/ClientDashboard.tsx`](../../../src/components/ClientDashboard.tsx) (lazy `:70-79`, `panels` `:693-762`).
- Nav render — [`src/components/client/ClientHeader.tsx:242-292`](../../../src/components/client/ClientHeader.tsx).
- Routing + redirects — [`src/App.tsx:111-139`](../../../src/App.tsx); `clientPath` [`src/routes.ts:47-53`](../../../src/routes.ts).
- Deep-link contract test — [`tests/contract/tab-deep-link-wiring.test.ts`](../../../tests/contract/tab-deep-link-wiring.test.ts) (every `?tab=` sender needs a receiver that reads `searchParams.get('tab')`).
- Tabs being folded into **Deep Dive**: `PerformanceTab` (sub-tabs Search/Analytics, [`:27-165`](../../../src/components/client/PerformanceTab.tsx)), `StrategyTab` (interior tabs, [`:54-970`](../../../src/components/client/StrategyTab.tsx)), `HealthTab` fix-list ([`health-tab/*`](../../../src/components/client/health-tab/)). Promoted to **Results**: `ROIDashboard` ([`:84+`](../../../src/components/client/ROIDashboard.tsx)). Moved to **Settings**: `BrandTab`, `PlansTab`.

**Hard rule — flag-OFF byte-identical:** the new union members, nav branch, and components must be invisible when `client-ia-v2` is OFF. The `roi → results` alias and the new panels exist regardless (additive), but the NAV only surfaces the new shell when the flag is ON.

---

## Task 0: Contracts first (commit before any consumer)

**Files:** `src/routes.ts`, `src/lib/client-dashboard-tab.ts`, `src/components/ClientDashboard.tsx` (panel keys + lazy imports as stubs), `tests/contract/client-tab-panel-lockstep.test.ts` (new), `tests/unit/client-dashboard-tab-routing.test.ts` (extend).

- [ ] **Step 1: Extend the `ClientTab` union** ([`src/routes.ts:25`](../../../src/routes.ts)) — add `'deep-dive' | 'results' | 'settings'`:

```typescript
export type ClientTab = 'overview' | 'performance' | 'search' | 'health' | 'strategy' | 'analytics' | 'inbox' | 'plans' | 'roi' | 'content-plan' | 'brand' | 'deep-dive' | 'results' | 'settings';
```

- [ ] **Step 2: Add a `roi → results` alias + new known tabs** in `client-dashboard-tab.ts`. Add `'deep-dive'`, `'results'`, `'settings'` to `KNOWN_CLIENT_TABS`, and in `resolveClientTab` map the legacy `'roi'` to `'results'` (old bookmarks survive):

```typescript
export const KNOWN_CLIENT_TABS: readonly ResolvedClientTab[] = [
  'overview', 'performance', 'health', 'strategy', 'inbox', 'plans', 'roi',
  'content-plan', 'brand', 'deep-dive', 'results', 'settings',
];
// in resolveClientTab, before the KNOWN check:
if (t === 'search' || t === 'analytics') return 'performance';
if (t === 'roi') return 'results';
```

Write the failing unit test in `client-dashboard-tab-routing.test.ts` first (`resolveClientTab('roi') === 'results'`, `'deep-dive'`/`'results'`/`'settings'` pass through, unknown → overview), run it red, then implement, run green.

- [ ] **Step 3: Add lazy imports + panel entries** in `ClientDashboard.tsx` for `DeepDiveTab`, `ResultsTab` (thin wrapper over `ROIDashboard`), `SettingsTab`. For Task 0, create minimal stub components (`export function DeepDiveTab(){ return null }`, etc.) so the panels map compiles; real bodies land in Tasks 1–3. Map panel keys: `'deep-dive' → DeepDiveTab`, `'results' → ResultsTab`, `'settings' → SettingsTab`. Keep `'roi'` panel pointing at `ROIDashboard` (back-compat for direct mounts) — `resolveClientTab` redirects `roi → results` so the nav never shows it under IA v2.

- [ ] **Step 4: Write the lockstep contract test** `tests/contract/client-tab-panel-lockstep.test.ts` — assert every entry in `KNOWN_CLIENT_TABS` has a corresponding key in the `panels` object built by `ClientDashboard` (and vice-versa, modulo the documented alias-only `search`/`analytics`). This catches the lazy-import / panel / nav drift that an 11→4 collapse risks. (Parse `ClientDashboard.tsx` statically or export the panel-key set for testing; mirror the parse approach in `tab-deep-link-wiring.test.ts`.) Run red (the new stubs not yet wired) → wire → green.

- [ ] **Step 5: typecheck + the two tests + commit**

Run: `npm run typecheck && npx vitest run tests/unit/client-dashboard-tab-routing.test.ts tests/contract/client-tab-panel-lockstep.test.ts tests/contract/tab-deep-link-wiring.test.ts`
```bash
git add src/routes.ts src/lib/client-dashboard-tab.ts src/components/ClientDashboard.tsx tests/contract/client-tab-panel-lockstep.test.ts tests/unit/client-dashboard-tab-routing.test.ts
git commit -m "feat(client-ia): P2 contracts — deep-dive/results/settings tabs + lockstep test (P2 Phase 0)"
```

---

## Task 1: Results tab (promote ROI)

**Files:** `src/components/client/ResultsTab.tsx` (new — thin wrapper), `src/components/ClientDashboard.tsx` (panel already wired in Task 0), `tests/component/client/ResultsTab.test.tsx` (new).

- [ ] **Step 1:** Write `ResultsTab.tsx` as a thin wrapper that renders `<ROIDashboard workspaceId tier evergreen />` with the "Results" framing (the existing ROI surface is the body; per-piece attribution is P4, not here). It must read no `?tab=` (single-surface). Keep `ROIDashboard` unchanged.
- [ ] **Step 2:** Component test: renders the ROI content; tier-gates as `ROIDashboard` does. Run red→green.
- [ ] **Step 3: Commit** `feat(client-ia): Results tab (promoted ROI) (P2)`.

---

## Task 2: Deep Dive tab (fold performance + strategy + health fix-list)

**Files:** `src/components/client/DeepDiveTab.tsx` (new), `tests/component/client/DeepDiveTab.test.tsx` (new). Compose the EXISTING components — do NOT rewrite their bodies.

- [ ] **Step 1:** Build `DeepDiveTab` with a `TabBar` of two sub-tabs **Analytics** and **Rankings**:
  - **Analytics** sub-tab → renders the existing `PerformanceTab` content (which itself holds Search/Analytics) PLUS the site-health fix-list (`HealthTab`'s `HealthTopFixesSection`/fix-list sections, pinned). Reuse the components; do not duplicate their logic.
  - **Rankings** sub-tab → renders `StrategyTab`'s rankings/keyword surfaces (page→keyword map, validate/decline, content gaps, authority) + the demoted content-plan roadmap VIEW (default-collapsed).
- [ ] **Step 2 (deep-link, two-halves contract):** `DeepDiveTab` MUST read the top-level `?tab=` to know it's the active tab, and manage the sub-tab via internal state seeded from a `subTab` search param (or mark the internal sub-tab bar `/* tab-deeplink-ok */` exactly as `PerformanceTab` does at [`:134-203`](../../../src/components/client/PerformanceTab.tsx)). Pattern to follow verbatim is `PerformanceTab`'s `initialSubTab` + `useSearchParams`. The deep-link contract test must stay green — Overview "see detail" links will target `?tab=deep-dive`.
- [ ] **Step 3:** Component test: both sub-tabs render their folded content; `?tab=deep-dive` activates the tab; sub-tab switch works; the health fix-list is present under Analytics. Assert the lever lists (GSC query/page tables) are present (not Premium-emptied). Run red→green.
- [ ] **Step 4: Commit** `feat(client-ia): Deep Dive tab — Analytics + Rankings sub-tabs (P2)`.

---

## Task 3: Settings home (brand + plans)

**Files:** `src/components/client/SettingsTab.tsx` (new), `tests/component/client/SettingsTab.test.tsx` (new).

- [ ] **Step 1:** Build `SettingsTab` as a simple two-section account home composing the EXISTING `BrandTab` (business/NAP) and `PlansTab` (billing) bodies under section headers ("Brand" / "Plans & billing"). Reuse the components. Respect the existing plans gating (`betaMode`/`isExternalBilling` hide billing — mirror the nav guard).
- [ ] **Step 2:** Component test: both sections render; billing section hidden when `betaMode`/external billing. Run red→green.
- [ ] **Step 3: Commit** `feat(client-ia): Settings home (brand + plans) (P2)`.

---

## Task 4: Nav builder — flag-branch to the 4-tab shell

**Files:** `src/components/client/client-dashboard/clientDashboardNav.ts`, `src/components/ClientDashboard.tsx` (pass the flag in), `tests/component/client/clientDashboardNav.test.ts` (new or extend).

- [ ] **Step 1:** Add `clientIaV2: boolean` to `BuildClientDashboardNavOptions`. When `clientIaV2` is true, return the 4-tab set:

```typescript
if (clientIaV2) {
  return [
    { id: 'overview', label: 'Overview', icon: Sparkles, locked: false },
    ...(isPaid ? [{ id: 'inbox' as const, label: 'Inbox', icon: Zap, locked: false }] : []),
    ...(isPaid && !betaMode && strategyData ? [{ id: 'results' as const, label: 'Results', icon: Trophy, locked: false }] : []),
    { id: 'deep-dive', label: 'Deep Dive', icon: LineChart, locked: false },
    { id: 'settings', label: 'Settings', icon: Building2, locked: false },
  ];
}
// else: existing array unchanged (byte-identical when flag OFF)
```
(Overview label flips "Insights" → "Overview" only under IA v2; the OFF path keeps "Insights".)

- [ ] **Step 2:** In `ClientDashboard.tsx`, read `useFeatureFlag('client-ia-v2')` (unconditional, top-level — Rules of Hooks) and pass `clientIaV2` into `buildClientDashboardNav`. Update `hasClientTabData` so the new tabs report data-present appropriately (deep-dive/results/settings → always renderable).
- [ ] **Step 3:** Tests: nav builder returns 4-tab set + settings when `clientIaV2` true; returns the EXACT existing array when false (snapshot/byte-identical assertion); paid/free/beta/external-billing variants. Run red→green.
- [ ] **Step 4: Commit** `feat(client-ia): flag-branch client nav to the 4-tab shell (P2)`.

---

## Task 5: Route-removal-checklist sweep + Overview deep-links

**Files:** per [`docs/rules/route-removal-checklist.md`](../../../docs/rules/route-removal-checklist.md): `src/App.tsx` (ensure `roi`/`performance`/`health`/`strategy`/`brand`/`plans` URLs still resolve under IA v2 — they redirect or render via the folded surfaces), nav-literal call sites (grep `clientPath(.*'roi'|'performance'|'health'|'strategy'|'brand'|'plans')`), and any Overview "see detail" links.

- [ ] **Step 1:** Grep every client nav literal: `grep -rnE "clientPath\([^)]*'(roi|performance|search|analytics|health|strategy|brand|plans|content-plan)'" src/`. For each under IA v2, retarget to the folded destination (`roi`→`results`; `performance`/`search`/`analytics`/`health`/`strategy`→`deep-dive` with the right sub-tab; `brand`/`plans`→`settings`). Keep OFF-path links unchanged (they still work via the legacy nav). Where a link must differ by flag, branch on `client-ia-v2`.
- [ ] **Step 2:** Wire Overview "see detail" / "see insights" links to `clientPath(ws, 'deep-dive', beta)` (+ sub-tab param) so the two-speed promise (Overview → depth) holds.
- [ ] **Step 3:** Run the deep-link contract test + the route/nav contract tests. Run red→green for any newly-added `?tab=` senders.
- [ ] **Step 4: Commit** `feat(client-ia): retarget client nav links to the folded IA v2 surfaces (P2)`.

---

## Task 6: Verification gate (before PR)

- [ ] **Step 1: Flag-OFF byte-identical** — render the dashboard with `client-ia-v2` OFF; nav + every tab identical to pre-branch. The nav builder false-branch snapshot test (Task 4) + the existing client tab tests prove it.
- [ ] **Step 2: Flag-ON smoke** — with `client-ia-v2` ON: nav shows exactly Overview · Inbox · Results · Deep Dive · Settings; Deep Dive sub-tabs render the folded content with lever lists intact; `?tab=deep-dive`, `?tab=results`, `?tab=settings`, and legacy `?tab=roi`→results all resolve.
- [ ] **Step 3: Full gate** — `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts && npm run lint:hooks && npm run verify:feature-flags && npm run verify:coverage-ratchet`.
- [ ] **Step 4: scaled-code-review** (multi-agent) → fix Critical/Important.
- [ ] **Step 5: Docs** — `FEATURE_AUDIT.md` (P2 entry), `data/roadmap.json` (`client-dashboard-ia-restructure` notes → P2 built; `sort-roadmap`), `BRAND_DESIGN_LANGUAGE.md` (Deep Dive/Results/Settings chrome), and update the route-removal-checklist note if a client tab was effectively retired from nav.
- [ ] **Step 6: PR → staging**, CI green, merge. Do not start P3 until P2 is merged green.

---

## Self-Review

- **Spec coverage:** Deep Dive (Task 2) folds performance/search/analytics/strategy/health-fixlist; Results (Task 1) promotes ROI; Settings (Task 3) takes brand+plans; nav collapse (Task 4); link retargeting + deep-links (Task 5). Lockstep + deep-link contracts (Task 0, Task 5).
- **Flag-OFF parity:** nav builder false-branch returns the exact existing array; new tabs only surfaced under the flag; `roi→results` alias is additive (old URLs survive both ways).
- **Two-halves deep-link:** DeepDiveTab reads `?tab=` (Task 2 Step 2); senders retargeted (Task 5). Contract test gates both halves.
- **No silent tab drop:** the new lockstep contract test (Task 0 Step 4) fails if `KNOWN_CLIENT_TABS` and `panels` diverge.
- **Composition not rewrite:** Deep Dive / Results / Settings COMPOSE existing components — no behavior rewrite, lower risk.

## Execution Handoff

Subagent-driven. Sequence: Task 0 (contracts, controller) → Tasks 1/2/3 can parallelize (separate new files: ResultsTab / DeepDiveTab / SettingsTab) → Task 4 (nav, depends on the three components existing) → Task 5 (link sweep) → Task 6 (gate + PR). P2 is one PR into staging.
