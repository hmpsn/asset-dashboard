# UI Rebuild F4 — Shell Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Single-author, sequential — NOT a parallel-lane phase.

**Goal:** Build the DS-native, `@ds-rebuilt` application shell — a rebuilt sidebar rail + breadcrumb composed into the F3 `AppShell` — wired to the **existing** `navRegistry.tsx`, flag-gated and mounted only by the Keywords pilot. The live admin `App.tsx` chrome is untouched.

**Architecture:** The F3 `AppShell`/`PageContainer`/`Toolbar` primitives exist. F4 adds the nav-chrome layer (`NavItem`, `NavGroup`, a `RebuiltSidebar` composition, a rebuilt `Breadcrumb`) that fills `AppShell`'s `sidebar`/`topbar` slots, plus an app-level `RebuiltAppChrome` composition. **Item identity stays single-sourced from `NAV_REGISTRY` + its exported `resolveNav*` helpers** (W3.4 invariant — never re-derive nav metadata); only the *presentation* is rebuilt. Machinery-dense sub-pieces (NotificationBell, the workspace switcher) are **carried over** (T1), not rebuilt. A new flag `ui-rebuild-shell` gates whether a surface mounts inside the rebuilt chrome; OFF (default) = today's behavior, byte-identical.

**Scope decisions (owner-ratified 2026-07-03):**
- **Mount: parallel + pilot-mounted.** F4 does NOT swap `App.tsx` onto the new shell. The rebuilt chrome ships flag-gated; the Keywords pilot (P) is the first surface to render inside it. A shell bug cannot reach the live admin app.
- **Nav chrome: rebuilt DS-native** (not carried over) — new `@ds-rebuilt` `NavItem`/`NavGroup`/`RebuiltSidebar`/`Breadcrumb` consuming the existing registry.
- **NO IA change.** Current admin groups/order/`needsSite` gating are preserved exactly. The prototype's two-zone rail, its empty BOOK zone, the n→1 consolidations, and their 4 open stop-and-asks are explicitly OUT of F4 (they land per-surface with redirect maps, per STRATEGY "no nav content changes yet").

**Tech Stack:** React 19 + TS strict; F3 primitives (`AppShell`, `PageContainer`, `Toolbar`); tokens (F1); Font Awesome Sharp icons via `<Icon>` (D5 reversed) — registry icons stay lucide-typed and render through `<Icon as={entry.icon}>` (supported during the ~381-file migration; FA-name mapping of registry entries is a ledgered follow-up, not F4). `useRovingTabindex` (F3) for the rail's keyboard nav.

**Platform/Model:** Claude/Anthropic — single agent, **Opus** (touches feature-flags + is the shell every surface composes from; barrier-adjacent).

---

## Pre-requisites & ground rules

- Branch: `ui-rebuild-f4-shell` (already created off staging; F1–F3 + D5-icon all merged there). `git status` + branch check before any git write; stage explicitly by path; controller (executor) commits.
- Decisions are LOCKED: [PHASE_D_DECISIONS.md](../../ui-rebuild/phase0/PHASE_D_DECISIONS.md). Nav findings + the IA-conflict inventory this plan deliberately defers: [cross-platform.md §1](../../ui-rebuild/phase0/cross-platform.md).
- Every new file's first line: `// @ds-rebuilt` — the seven F2a `ds-*` rules apply at error severity (tokens-only, `var(--dur-*)` motion, `var(--z-*)`, no raw hex/palette, FA-not-emoji icons). Read [ui-rebuild-consistency.md](../../rules/ui-rebuild-consistency.md) for the rule-trap list.
- **Read-before-write** (the #1 bug class): before each component read the kit spec (`hmpsn studio Design System/components/layout/<Name>.jsx`) AND the HEAD counterpart it preserves behavior from (`src/components/layout/Sidebar.tsx`, `Breadcrumbs.tsx`). Never guess a registry field or helper signature.
- **Single source, do not fork:** consume `NAV_REGISTRY`, `NAV_REGISTRY_BY_ID`, and `resolveNavLabel`/`resolveNavDescription`/`isNavEntryHidden`/`resolveNavLabelById` from `src/lib/navRegistry.tsx`. Do NOT copy nav metadata into F4 files. The `tests/contract/nav-registry-completeness.test.ts` invariant must stay green.
- Docs + `npm run rules:generate` (only if a pr-check rule is touched) are part of DoD.

## Task dependency graph

```
F4.0 flag + barrel stubs (blocks nothing downstream but lands first)
  → F4.1 NavItem → F4.2 NavGroup → F4.3 RebuiltSidebar (consumes 1+2)
  → F4.4 Breadcrumb  (independent of the sidebar; can follow 4.3)
  → F4.5 RebuiltAppChrome (composes AppShell + Sidebar + Toolbar + Breadcrumb + PageContainer) + pilot mount hook
  → F4.6 barrel exports, harness demo, docs
  → F4.7 review + full gates + PR
```

## File ownership (this plan owns exclusively)

- Create: `src/components/ui/layout/NavItem.tsx`, `NavGroup.tsx`, `src/components/layout/RebuiltSidebar.tsx`, `src/components/layout/RebuiltBreadcrumb.tsx`, `src/components/layout/RebuiltAppChrome.tsx`, tests under `tests/component/ui/` + `tests/component/layout/`
- Modify: `src/components/ui/layout/index.ts` (barrel), `shared/types/feature-flags.ts` (one flag), `public/styleguide.html` + the F3 `/__ds-harness` route (demo), `data/ui-rebuild-deferred-ledger.json` (ledger rows), `BRAND_DESIGN_LANGUAGE.md`, `CLAUDE.md`, `FEATURE_AUDIT.md`
- **Do NOT modify** `src/components/layout/Sidebar.tsx`, `Breadcrumbs.tsx`, `App.tsx`, or `src/lib/navRegistry.tsx` — F4 is additive; the live chrome and the registry stay as-is.

---

### Task F4.0 — Feature flag + barrel stubs

**Files:** Modify `shared/types/feature-flags.ts`, `src/components/ui/layout/index.ts`

- [ ] **0.1** **Roadmap item first** — `verify:feature-flags` FAILS if a flag's `linkedRoadmapItemId` isn't found in `data/roadmap.json` (`scripts/feature-flag-lifecycle.ts:222`), and no ui-rebuild-shell roadmap item exists yet. Add one to `data/roadmap.json` (a real item for the F4 shell; run `npx tsx scripts/sort-roadmap.ts` after) and note its id.
- [ ] **0.2** Add a **new** `FeatureFlagGroupLabel` — this is the FIRST ui-rebuild flag, and none of the 6 existing labels (`FEATURE_FLAG_GROUP_LABELS`, `:164`) fits. Add e.g. `'UI Rebuild'` to that union. (The catalog entry's `group` must equal the group used in `FEATURE_FLAG_GROUPS` — lockstep, enforced by `tests/.../feature-flag-lifecycle.test.ts:100`.)
- [ ] **0.3** Add the flag `ui-rebuild-shell` in all THREE places: (a) `FEATURE_FLAGS` object (`:12`), default `false`; (b) `FEATURE_FLAG_CATALOG` (`:190`) with its own entry — `label`, `group: 'UI Rebuild'`, a `rolloutTarget` from `FEATURE_FLAG_ROLLOUT_TARGETS`, an `auditCadence`, and a **complete `FeatureFlagLifecycleMeta`** (`:149`): `lifecycle: 'active'`, `removalCondition` (e.g. "retired when the rebuilt admin shell ships unflagged after the Keywords pilot + Phase A"), `linkedRoadmapItemId` (the id from 0.1), `lastReviewedAt: '2026-07-05'`; (c) `FEATURE_FLAG_GROUPS` (`:457`) — a group entry `{ label: 'UI Rebuild', keys: ['ui-rebuild-shell'] }`.
- [ ] **0.4** `npm run verify:feature-flags` passes; also mock this flag in any component test that renders a gated tree (the `vi.mock` CI trap — `feedback_feature_flag_addition_ci_gotchas`). Commit: `feat(ui-rebuild/f4): ui-rebuild-shell feature flag + roadmap link + UI Rebuild flag group`.

### Task F4.1 — NavItem (`@ds-rebuilt`)

**Files:** Create `src/components/ui/layout/NavItem.tsx`, `tests/component/ui/NavItem.test.tsx`

Kit spec: `components/layout/NavItem.jsx` (icon + label row; active = teal tint `var(--brand-mint-dim)` bg + `var(--brand-mint-hover)` text + a 3px `var(--teal)` left accent bar; optional trailing `badge`; optional mono `meta`). Behavior HEAD preserves (`Sidebar.tsx`): a `needsSite` item with no linked site renders **disabled** (not hidden); a `content-pipeline`-style pending count renders as the trailing badge.

- [ ] **1.1** Interface (frozen): `{ icon?: LucideIcon; label: string; active?: boolean; disabled?: boolean; badge?: ReactNode; meta?: string; accent?: string; href?: string; onClick?: () => void; title?: string; className?: string; id?: string; style?: CSSProperties }`. **Add `import type { LucideIcon } from 'lucide-react';`** — this type import is REQUIRED for the `icon` prop and is safe: the current `ds-icon-discipline` rule (`scripts/pr-check.ts:7145`, post-D5-reversal) flags ONLY emoji glyphs, NOT lucide imports (verified — `Icon.tsx:2` and 8 shipped F3 `@ds-rebuilt` primitives already import from `lucide-react`). Render the icon via `<Icon as={icon} size="sm" />` from `src/components/ui/Icon`.
- [ ] **1.2** Render per kit spec, **all styling as token-backed inline styles (`var(--…)`), never Tailwind palette classes** (`ds-tailwind-palette-bypass` fires on every `@ds-rebuilt` file regardless of path — `bg-blue-500`/`text-teal-300`/etc. are errors). Color derives from ONE `accent` prop (a hue token the group passes, e.g. `var(--teal)`/`var(--blue)`/`var(--emerald)`/`var(--brand-yellow)`): active bg = `color-mix(in srgb, var(--accent-or-fallback) 12%, transparent)`, active text/icon/left-accent-bar = the accent token directly, inactive icon = `var(--brand-text-dim)` (mirrors the kit `NavItem.jsx` inline-var approach — that file uses zero palette classes). Disabled state (`aria-disabled`, `pointer-events:none`, `opacity` via token, `title` explains why — e.g. "Connect a site first"), badge slot, `aria-current={active ? 'page' : undefined}`. Motion `var(--dur-fast) var(--ease-out)`. ≥44px effective hit target (padding).
- [ ] **1.3** Tests: renders label+icon; `active` sets `aria-current="page"` + accent bar present; `disabled` sets `aria-disabled` and suppresses `onClick`; badge renders; keyboard Enter/Space fires `onClick` when it's a button.
- [ ] **1.4** `npm run typecheck && npx vitest run tests/component/ui/NavItem.test.tsx && npx tsx scripts/pr-check.ts`. Commit.

### Task F4.2 — NavGroup (`@ds-rebuilt`, collapsible)

**Files:** Create `src/components/ui/layout/NavGroup.tsx`, `tests/component/ui/NavGroup.test.tsx`

Kit spec: `components/layout/NavGroup.jsx` (uppercase mono label + trailing hairline, `accent` tint, children below). Behavior HEAD preserves: groups are **collapsible**, collapse state persists to `localStorage['admin-sidebar-collapsed']` (a Set of group labels), and the group containing the active item auto-expands.

- [ ] **2.1** Interface: `{ label: string; accent?: string; collapsed?: boolean; onToggleCollapse?: () => void; children: ReactNode; className?: string; id?: string; style?: CSSProperties }`. The header is a `<button>` with `aria-expanded={!collapsed}` controlling a region (`aria-controls`); collapsed hides the children region. An empty `label` renders no header (the `home` group).
- [ ] **2.2** Tokens-only per kit spec; `accent` tints the label + hairline (used for the per-group color the rebuilt sidebar passes). Collapse chevron uses `<Icon name="…">` (FA) — pick the FA chevron from `ICON_NAMES`.
- [ ] **2.3** Tests: header toggles `aria-expanded`; collapsed hides children; empty label → no header; accent applies.
- [ ] **2.4** Gates + commit.

### Task F4.3 — RebuiltSidebar (registry-driven composition)

**Files:** Create `src/components/layout/RebuiltSidebar.tsx`, `tests/component/layout/RebuiltSidebar.test.tsx`

The DS-native equivalent of `Sidebar.tsx`, consuming the SAME registry + helpers. Preserve every behavior below (verify each against `Sidebar.tsx`); rebuild only presentation.

- [ ] **3.1** Props: mirror the parts of `SidebarProps` the shell needs — `{ workspaces, selected, tab, theme, pendingContentRequests, onCreate, onDelete, onLinkSite, onUnlinkSite, toggleTheme, onLogout }` (read `Sidebar.tsx:42-58` for exact types). Add `// @ds-rebuilt`.
- [ ] **3.2** Nav model — consume the registry directly (do NOT fork): build groups from `NAV_REGISTRY` filtered by group key, in the same group ORDER as `Sidebar.tsx`'s `GROUP_PRESENTATION` (home, monitoring, site-health, seo-strategy, optimization, content, admin), resolving each item's label/description/hidden via `resolveNavLabel`/`resolveNavDescription`/`isNavEntryHidden` (pass `isFlagEnabled` from `useFeatureFlag`). Define a DS-native group-presentation map local to this file: `{ key: NavGroupKey; label: string; accent: string }` — **ONE hue token per group** (monitoring→`var(--blue)`, site-health→`var(--emerald)`, seo-strategy/optimization→`var(--teal)`, content→`var(--brand-yellow)`, admin→neutral/`var(--brand-text)`; home→no label). NavItem/NavGroup derive all active/hover/icon tints from this single accent (F4.1.2) — do NOT reproduce Sidebar's six palette-class slots. **Group labels MUST match `Sidebar.tsx`'s `ALL_GROUP_LABELS` strings exactly** (`MONITORING`/`SITE HEALTH`/`STRATEGY`/`OPTIMIZATION`/`CONTENT`/`ADMIN`) so the shared `localStorage['admin-sidebar-collapsed']` key stays compatible with the legacy Sidebar. **Presentation-map completeness test:** assert the map covers every non-`utility` `NavGroupKey` (guards P3-B drift when a group is added).
- [ ] **3.3** Render: each group → `<NavGroup accent={…} collapsed={…} onToggleCollapse={…}>` containing `<NavItem accent={groupAccent}>` per non-hidden entry. Wire — **replicate `Sidebar.tsx:234,238` EXACTLY, do not simplify** (a simplified formula is a route-breaking regression): let `isGlobal = GLOBAL_TABS.has(item.id)` (`import { GLOBAL_TABS } from '../../routes'`); `active = tab === item.id`; `disabled = isGlobal ? false : (!selected || (item.needsSite && !selected.webflowSiteId))`; `onClick` = `isGlobal ? navigate('/' + item.id) : (selected && navigate(adminPath(selected.id, item.id)))` — mirror Sidebar's exact branching so a non-`needsSite` non-global item never navigates with an undefined workspace. `content-pipeline` pending badge (`Sidebar.tsx` badge block) passed as `<NavItem badge={…}>`. Collapse state via `useToggleSet` + the SAME `localStorage['admin-sidebar-collapsed']` key + the active-group-auto-expand effect (`Sidebar.tsx:127-148`). Roving-tabindex/arrow-key movement across items via `useRovingTabindex` (F3).
- [ ] **3.4** Footer — **carry over, do not rebuild** (T1): mount the existing `NotificationBell` (`src/components/NotificationBell`) and the existing **`WorkspaceSelector`** (`src/components/WorkspaceSelector.tsx`, imported at `Sidebar.tsx:11` as `from '../WorkspaceSelector'` — reuse this exact component, thread the `onCreate/onDelete/onLinkSite/onUnlinkSite` props straight through; do NOT fork its logic), plus Revenue/Settings/theme-toggle/logout `IconButton`s as `Sidebar.tsx:265-315`. **`RebuiltSidebar` itself (a `layout/` file — outside the `src/components/ui/` rule exclusion) must contain ZERO raw `<button>`, badge-`<span>`, or palette-accent class** — all interactive/colored/badge elements live inside `NavItem`/`NavGroup`/`IconButton`/`NotificationBell`/`WorkspaceSelector` (existing primitives or ui/-exempt); RebuiltSidebar is pure composition (`aside` + the primitives). Ledger row `DEF-shell-001` (see F4.6.3).
- [ ] **3.5** Tests (real render with a `QueryClient` + router + a mock `useFeatureFlag`-backing `QueryClient`, per the flag-transition test convention): renders all registry groups in order; a `needsSite` item is disabled when `selected.webflowSiteId` is null and enabled when set; the active tab's item has `aria-current` and its group is auto-expanded; a group toggle persists to localStorage; hidden entries (flag-hidden) don't render. **Do NOT mock the nav registry** — import the real one so a registry change is caught.
- [ ] **3.6** Gates + commit.

### Task F4.4 — RebuiltBreadcrumb (`@ds-rebuilt`)

**Files:** Create `src/components/layout/RebuiltBreadcrumb.tsx`, `tests/component/layout/RebuiltBreadcrumb.test.tsx`

Kit spec: `components/layout/Breadcrumb.jsx`. Behavior HEAD preserves (`Breadcrumbs.tsx`): labels resolve from `NAV_REGISTRY_BY_ID` (with the documented fallback map for redirect-only/legacy-folded pages); the `?tab=` deep-link segments render where applicable.

- [ ] **4.1** Props mirror `BreadcrumbsProps` (`Breadcrumbs.tsx:24-30`). Resolve tab labels via `NAV_REGISTRY_BY_ID` + `resolveNavLabelById`. The fallback-label map (`LEGACY_TAB_LABELS`, `Breadcrumbs.tsx:14`) is **NOT exported** and `Breadcrumbs.tsx` is off-limits — **replicate** it in this file with a `// nav-registry-ok — fallback for redirect-only/legacy-folded Pages, mirrors Breadcrumbs.tsx:14` note (do not import, do not export from Breadcrumbs). Tokens-only, FA separators via `<Icon name="…">`.
- [ ] **4.2** Tests: label resolves from registry for a real Page; fallback label for a redirect-only Page; separator renders.
- [ ] **4.3** Gates + commit.

### Task F4.5 — RebuiltAppChrome + pilot mount hook

**Files:** Create `src/components/layout/RebuiltAppChrome.tsx`, `tests/component/layout/RebuiltAppChrome.test.tsx`

- [ ] **5.1** Compose: `<AppShell sidebar={<RebuiltSidebar …/>} topbar={<Toolbar><RebuiltBreadcrumb …/></Toolbar>}><PageContainer>{children}</PageContainer></AppShell>`. Props = the shell inputs (workspaces/selected/tab/theme/handlers) + `children`. `// @ds-rebuilt`. This is the frame a rebuilt surface renders inside.
- [ ] **5.2** Mount contract (the pilot uses this, NOT App.tsx): export a small helper/'`useRebuildShellEnabled()`' reading `useFeatureFlag('ui-rebuild-shell')` so a surface can choose `RebuiltAppChrome` vs today's chrome at its own mount point. Document in the file header: "F4 does not mount this anywhere; the Keywords pilot (P) is the first caller, flag-gated. App.tsx is untouched." Do NOT edit App.tsx.
- [ ] **5.3** Tests (real flag hook, loading→loaded transition per `feedback_mocked_hook_hides_rules_of_hooks` — mock `src/api/misc` `featureFlags.list`, NOT `useFeatureFlag`, backed by a real `QueryClient`, per `OverviewTab.flagTransition.test.tsx`): `RebuiltAppChrome` renders sidebar + breadcrumb + children without throwing across the flag query resolving loading→loaded; skip-to-content link from AppShell present. **Do NOT assert CSS-variable/theme resolution in jsdom** — it does not resolve custom properties or cascade stylesheets (no F3 test does this); theme correctness is verified only in the F4.7 browser smoke.
- [ ] **5.4** Gates + commit.

### Task F4.6 — Barrel, harness demo, docs

- [ ] **6.1** `src/components/ui/layout/index.ts`: export the `NavItem`/`NavGroup` **components** + their prop types (`NavItemProps`/`NavGroupProps`). Note the name overload: `Sidebar.tsx:325` already exports `type { NavItem, NavGroup }` (local interfaces) — different module, no clash today, but do NOT re-export Sidebar's nav types through the `ui` barrel, and keep the new exports value-only + `Props`-suffixed types to avoid a future collision. RebuiltSidebar/Breadcrumb/AppChrome live in `src/components/layout/` (imported by path; no ui barrel entry).
- [ ] **6.2** Demo: add the rebuilt shell to the F3 `/__ds-harness` dev route (real interactive render — collapse a group, keyboard-walk the rail) and a static specimen to `public/styleguide.html` §05 (token-prose only — mind the `rounded-*`/`Npx Npx` static-styleguide trap). The harness is the F4.7 keyboard-walk target.
- [ ] **6.3** Docs: `CLAUDE.md` "UI Primitives" list gains `NavItem`/`NavGroup`; note the rebuilt shell + `ui-rebuild-shell` flag under UI Rebuild conventions; `BRAND_DESIGN_LANGUAGE.md` nav/shell section; `FEATURE_AUDIT.md` entry. Add BOTH ledger rows — note the verifier's `surface` field is an **enum** (`verify-deferred-ledger.ts:15`) that has **no `'shell'` value**, so use `surface: 'foundation'` (the `DEF-shell-*` id string is still valid). Full rows (all required fields):
  - `{ "id": "DEF-shell-001", "surface": "foundation", "item": "rebuilt-sidebar footer utilities (NotificationBell, WorkspaceSelector, Revenue/Settings/theme/logout IconButtons) carried over from legacy Sidebar; DS-native restyle deferred", "decision": "T1 carry-over — machinery-dense, zero capability loss; visual seam accepted", "class": "primitive", "upgradeTrigger": "Phase A admin fan-out reaches the shell chrome", "owner": "josh", "status": "open", "roadmapItemId": null, "createdAt": "2026-07-05", "reviewBy": "2026-09-30" }`
  - `{ "id": "DEF-shell-002", "surface": "foundation", "item": "NAV_REGISTRY icons render as lucide via <Icon as>; FA-name mapping of registry entries deferred", "decision": "D5 keeps <Icon as={LucideIcon}> during the ~381-file lucide→FA migration; remapping 25 registry entries now is out of F4 scope", "class": "token", "upgradeTrigger": "the lucide→FA call-site migration reaches navRegistry", "owner": "josh", "status": "open", "roadmapItemId": null, "createdAt": "2026-07-05", "reviewBy": "2026-09-30" }`
  - `npm run verify:deferred-ledger` green.
- [ ] **6.4** Commit.

### Task F4.7 — Review + gates + PR

- [ ] **7.1** `superpowers:requesting-code-review` (single-agent, single-domain — scaled-code-review is not required since this is not a parallel-lane phase). Fix Critical/Important; improvements → ledger.
- [ ] **7.2** Full gates, sequential: `npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts && npm run lint:hooks && npm run verify:feature-flags && npm run verify:deferred-ledger && npm run verify:coverage-ratchet && npx vitest run` (FULL suite — nav-registry-completeness + tab-deep-link contract tests must stay green).
- [ ] **7.3** Real-render smoke (`preview_*`) — the `/__ds-harness` dev route renders the components directly (it is dev-only, `import.meta.env.DEV`, and is NOT itself flag-gated), so this validates COMPONENT behavior + theming, not the flag→mount path (that's covered by the F4.5.3 unit test and lands for real at pilot time): collapse/expand groups (persist across reload via the shared localStorage key), keyboard-walk the rail (roving tabindex + Enter activate), a `needsSite` item disabled with no site then enabled with one, both dark + `.dashboard-light`. Separately assert `FEATURE_FLAGS['ui-rebuild-shell'] === false` (defaults OFF → App.tsx untouched → live admin app unchanged).
- [ ] **7.4** PR to `staging`: "UI Rebuild F4 — DS-native admin shell (flag-gated, pilot-mounted)". Body: the scope boundary (no IA change, no App.tsx swap), the `ui-rebuild-shell` flag, carried-over vs rebuilt inventory, DEF-shell-001/002. **Verify CI actually ran** (Actions billing history).

---

## Cross-phase contracts (F4 → Keywords pilot / Phase A)

- `RebuiltAppChrome` + `useRebuildShellEnabled()` are the pilot's mount surface — the pilot wraps its Keywords surface in `RebuiltAppChrome` gated on `ui-rebuild-shell`.
- Nav identity stays 100% in `NAV_REGISTRY`; F4 added zero nav metadata. Consolidations/redirect-maps are per-surface work in Phase A, not owed here.
- Carried-over pieces (footer utilities, workspace switcher, registry icons) are ledgered (`DEF-shell-001/002`) for their DS-native rebuild during the fan-out.

## Systemic improvements

- `NavItem`/`NavGroup` become the reusable rail primitives every future nav surface composes (client shell in Phase C included) — no more hand-rolled nav rows.
- Proves the F3 `AppShell`/`Toolbar`/`PageContainer` slots against a real, stateful composition before the pilot depends on them.

## Risks

- **Nav-model drift** between `RebuiltSidebar` and live `Sidebar` → item identity is single-sourced (`NAV_REGISTRY` + `resolveNav*`), but group ORDER/presentation is duplicated. Mitigated by the F4.3.2 completeness test (every non-`utility` `NavGroupKey` covered). No pr-check backstop exists on the Rebuilt* files (`Hardcoded nav metadata` rule is filename-pinned to Sidebar/CommandPalette/Breadcrumbs) — enforcement is the completeness test + review. Optional hardening (F4.6): add `RebuiltSidebar.tsx`/`RebuiltBreadcrumb.tsx` to that rule's consumer suffix list — but that rule edit carries the F2a customCheck-registry/`rules:generate` obligations, so only if cheap.
- **`ds-tailwind-palette-bypass` on group colors** (the biggest execution trap) → the single-accent-token scheme (F4.1.2/F4.3.2) collapses Sidebar's ~36 palette classes to 6 hue tokens rendered as `var()`/`color-mix` inline styles; zero palette classes → no hits. If a stray palette class is needed, `// palette-ok` with justification.
- **Layout-file rule exposure** → RebuiltSidebar/Breadcrumb/AppChrome sit in `src/components/layout/` (outside the `src/components/ui/` exclusion), so raw `<button>`/badge-`<span>`/blue-accent rules fire at error severity. Mitigated by keeping ALL such elements inside the ui/-exempt primitives (F4.3.4); the layout files are pure composition.
- **Carried-over footer visual seam** (legacy IconButtons inside a rebuilt rail) → accepted, ledgered `DEF-shell-001`; visual-only, zero capability loss.
- **`disabled`/`onClick` regression** → the full `isGlobal ? … : (!selected || …)` formula (F4.3.3) is mandatory; the simplified form navigates global/no-workspace items to broken routes.

## Definition of done

- [ ] `NavItem`, `NavGroup`, `RebuiltSidebar`, `RebuiltBreadcrumb`, `RebuiltAppChrome` built, each `// @ds-rebuilt`, tokens-only, both themes, FA icons
- [ ] Nav identity 100% from `NAV_REGISTRY` (no forked metadata); `nav-registry-completeness` + `tab-deep-link` contract tests green
- [ ] `needsSite` gating, flag-hidden entries, collapsible-group persistence, active-group auto-expand all preserved and tested
- [ ] `ui-rebuild-shell` flag added (3 places), defaults OFF, `verify:feature-flags` green; App.tsx untouched (flag-OFF = byte-identical live app)
- [ ] Footer utilities + workspace switcher carried over (not rebuilt); `DEF-shell-001/002` ledgered
- [ ] requesting-code-review run; all gates green; flag-ON harness smoke passed; PR to `staging` with CI that ran
