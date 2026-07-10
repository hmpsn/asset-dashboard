# Admin Rebuilt Route Coverage Audit

Status: route, nav, interior-state, and layout accounting pass complete; `ODP-001` through `ODP-012` accepted
Last updated: 2026-07-09
Source of truth files: `src/routes.ts`, `src/lib/navRegistry.tsx`, `src/components/layout/rebuiltSurfaces.ts`, and `hmpsn studio Design System/mockup/nav.js`

This audit answers four questions that the per-surface contracts do not answer by themselves:

- Are all admin `Page` route values accounted for?
- Are all global nav destinations in the rebuilt registry?
- Have interior tabs, lenses, drawers, and modals been checked as part of parity?
- Has each actual layout been graded against the prototype, instead of only token-polished?

## Route Census

| Category | Count | Meaning |
|---|---:|---|
| Admin `Page` union values | 32 | Every admin route id in `src/routes.ts`. |
| `NAV_REGISTRY` entries | 26 | Standalone nav/palette/breadcrumb destinations. |
| `NON_REGISTRY_PAGES` | 6 | Redirect-only, folded, or non-global-nav route ids. |
| `REBUILT_SURFACES` entries | 26 | Routes that mount inside `RebuiltAppChrome` when `ui-rebuild-shell` is on. |
| Parity contract files | 16 | One contract per surface family; Global Ops covers multiple route ids. |

Current census result:

- Every `Page` value is either registered in `NAV_REGISTRY` or intentionally listed in `NON_REGISTRY_PAGES`.
- Every `NAV_REGISTRY` entry maps to a real `Page` value.
- Every currently mounted rebuilt route family has an initial behavior-first parity contract.
- Not every admin page is currently rebuilt.

## Rebuilt Versus Non-Rebuilt

| Route id | Nav status | Rebuilt status | Current parity status |
|---|---|---|---|
| `page-intelligence` | Main nav entry | Not in `REBUILT_SURFACES` | `ODP-012 B` accepted: keep standalone until a later SEO Editor Research/detail slice proves every analyze, edit, job, and handoff capability. No redirect is approved. |
| `content-perf` | Main nav entry | Not in `REBUILT_SURFACES` | `ODP-012 B` accepted: Content Pipeline Published is the proposed receiving home and already consumes shared readback data, but this route remains standalone until a shipping slice proves complete report/deep-link coverage. |
| `competitors` | `NON_REGISTRY_PAGES` | Rebuilt | Still intentionally absent from the global registry, but now surfaced in the rebuilt sidebar's prototype `Strategy & Content` presentation because the rebuilt shell is flag-gated. Contract exists. |
| `workspace-settings` | `NON_REGISTRY_PAGES` | Rebuilt | Intentional per-workspace settings receiver reached from workspace gear/settings paths, not the main sidebar list. Covered by Global Ops contract. |
| `seo-briefs` | `NON_REGISTRY_PAGES` | Not rebuilt | Folded into `content-pipeline?tab=briefs`. |
| `content` | `NON_REGISTRY_PAGES` | Not rebuilt | Folded into `content-pipeline?tab=posts`. |
| `calendar` | `NON_REGISTRY_PAGES` | Not rebuilt | Redirects to `content-pipeline?tab=calendar`. |
| `subscriptions` | `NON_REGISTRY_PAGES` | Not rebuilt | Preserved standalone legacy `ContentSubscriptions` receiver. Separately, `content-pipeline?tab=subscriptions` aliases to the rebuilt pipeline's publish/capacity state. |

Practical answer: the current contracts cover the rebuilt build, not the entire admin route universe. `page-intelligence` and `content-perf` are the two true nav routes still outside the rebuilt registry.

## Nav Bar Audit

Prototype reference: `hmpsn studio Design System/mockup/nav.js`.

Prototype nav model:

- A client-zone header doubles as the client switcher.
- Top rail items: `Cockpit` and `Insights Engine`.
- Group: `Strategy & Content` with Keywords, Competitors, Content Pipeline, and Local Presence.
- Group: `Search & Site Health` with Search & Traffic, Site Audit, Performance, Links, Asset Manager, and AI Visibility.
- Group: `Optimization` with SEO Editor, Schema, Page Rewriter, and Brand & AI.
- Group: `Client-facing` with Recommendations and Client portal.
- Footer utility bar owns Requests/Inbox and Admin/settings access.

Current rebuilt nav model:

- Route identity, labels, and descriptions come from `NAV_REGISTRY`.
- Sidebar presentation groups are local to `RebuiltSidebar` and now mirror the prototype zones: top Cockpit/Insights, Strategy & Content, Search & Site Health, Optimization, Client-facing, and Admin.
- Prototype-facing label overrides are local to the rebuilt sidebar: `home` renders as Cockpit, `seo-strategy` as Insights Engine, `seo-keywords` as Keywords, `content-pipeline` as Content Pipeline, and `media` as Asset Manager.
- `competitors` is added as a rebuilt-sidebar-only presentation item without adding it back to `NAV_REGISTRY`.
- Typography is styleguide-aligned: `NavGroup` headers use `.t-label`, `NavItem` labels use `.t-ui`, nav badges/meta use `.t-mono`, and breadcrumbs use `.t-ui`.
- Current group accents are DS token values: top Cockpit/Insights `var(--teal)`, Strategy & Content `var(--blue)`, Search & Site Health `var(--cyan)`, Optimization `var(--teal)`, Client-facing `var(--brand-yellow)`, Admin `var(--brand-text)`.

Accepted nav parity correction:

- `ODP-011` is accepted for the rebuilt shell: use prototype zones while preserving route ids and global registry semantics.
- The prototype's `Optimization` uses `var(--purple)`, but the rebuilt implementation keeps Optimization on `var(--teal)` per the current design-system rule that purple is reserved for admin AI-only surfaces.
- The prototype has explicit `Client-facing` destinations. The current rebuilt admin nav maps production equivalents into that zone: Action Results, Requests, and Content Perf.
- Current sizing is styleguide-compliant by test and smoke; `ODP-010 C` approves a rebuilt-admin header variant pilot without changing the default primitive.

New test coverage:

- `tests/component/layout/RebuiltSidebar.test.tsx` now asserts the prototype zone order, local sidebar labels, Competitors sidebar presence, `.t-label` group headers, `.t-ui` nav rows, and token-backed group/item accents.
- Existing primitive tests assert `NavGroup`, `NavItem`, and `RebuiltBreadcrumb` keep the styleguide roles and accessibility floor.

Browser smoke evidence:

- Desktop Brand route with rebuilt sidebar zones: `/tmp/asset-dashboard-codex-parity-captures/sidebar-prototype-zone-brand-desktop.png`.
- State file: `/tmp/asset-dashboard-codex-parity-captures/sidebar-prototype-zone-brand-state.json`.
- Result: expected labels present, prototype zone order passed, sampled group headers computed at 11.5px, sampled nav rows computed at 13.5px, and accents resolved to `var(--blue)`, `var(--cyan)`, `var(--teal)`, and `var(--brand-yellow)`. Console noise was limited to local Vite/WebSocket disconnect warnings.

## Interior State Coverage

Interior state has been checked in contracts, component tests, and smoke for the rebuilt route families. The remaining question is not whether tabs/lenses exist, but whether each surface's visible navigation model should keep matching production or collapse further toward the prototype.

| Contract | Route ids covered | Interior states accounted for | Grade |
|---|---|---|---|
| Cockpit | `home` | Stream selector, work queue, activity drawer, work-order modal, `stream=` deep link | Aligned enough |
| Brand & AI | `brand` | Overview sections, modal workflows, `?tab=` aliases, Voice-only generators | Aligned enough |
| Schema | `seo-schema` | Generator, Workflow Guide, page detail Drawer, publish/send/history | Aligned enough |
| Links | `links` | Redirects, Internal Links, Dead Links, Architecture, detail Drawer, legacy alias | Aligned enough |
| Performance | `performance` | Page Weight, Page Speed, weight Drawer, speed handoff | Aligned enough |
| Competitors | `competitors` | Competitive stack, alert feed, detail Drawer, Hub/brief/send actions | Aligned enough |
| Keyword Hub | `seo-keywords` | Rankings, Opportunities, Pages, Clusters, Lifecycle, detail Drawer | Aligned enough |
| Insights Engine | `seo-strategy` | Spine, changes, signals, POV, moves, operations | Aligned enough behavior; owner visual circle-back remains open |
| Content Pipeline | `content-pipeline` | Board, Intake, Calendar, Published, Content Health, Matrix, Briefs/Posts/capacity/guide receiver state | Aligned enough first phase; item-backed workspaces and capacity Drawer deferred |
| SEO Editor | `seo-editor` | Static/CMS/Manual source groups, table filters, selection actions, page Drawer, URL filters | Aligned enough first phase; inline editing/review queue deferred |
| Site Audit | `seo-audit` | Site Audit, History, compatibility evidence disclosures, schedule/issue drawers | Aligned enough |
| Search & Traffic | `analytics-hub` | Search Performance, Site Traffic, Annotations, hidden Overview receiver, Breakdowns Drawer | Aligned enough |
| Assets | `media` | Browse workshop, repair filters/results, Upload and asset Drawers, repair handoffs | Aligned enough |
| Page Rewriter | `rewrite` | Two-pane workspace, shell focus mode, page picker, export menu, `?pageUrl=` | Aligned enough for export-only v1; draft/publish remains a separate backend project |
| Local Presence | `local-seo` | Rank/profile, Reviews/replies, setup Drawer, legacy visibility receiver | Capability risk: geo-grid and GBP Performance data not available |
| Global Ops | `settings`, `workspace-settings`, `roadmap`, `revenue`, `ai-usage`, `features`, `prospect`, `outcomes-overview`, `outcomes`, `diagnostics`, `requests` | Global settings, workspace settings tabs, roadmap views, business tabs, outcomes, diagnostics, requests tabs | Capability risk: accepted additive shell with explicit `GO-*` deferrals |

## Layout Coverage

The current parity sweep has looked at actual layout for every mounted rebuilt route family enough to assign a behavior-first grade. It has not completed side-by-side visual parity for every interior state, and it has not rebuilt or visually audited the two non-rebuilt main-nav routes (`page-intelligence`, `content-perf`).

Current layout buckets:

- Aligned enough: Cockpit, Brand & AI, Schema, Links, Performance, Competitors, Keyword Hub, Content Pipeline first phase, SEO Editor first phase, Site Audit, Search & Traffic, Assets, and Page Rewriter export-only v1.
- Owner visual circle-back: Insights Engine behavior is accepted, but Joshua has not accepted the final composition as visually matched.
- Capability risk: Local Presence and the Global Ops route family.
- Receiving-home proof pending: Page Intelligence stays standalone; Content Pipeline Published is the proposed Content Performance receiver. Both standalone route ids remain intact.
- Redirect/folded only: SEO Briefs, Content, and Calendar.
- Preserved legacy standalone receiver: Subscriptions; its Content Pipeline query alias is accounted for separately.

## Accepted Scope Direction

Accepted on 2026-07-09:

- Keep the accepted rebuilt sidebar prototype-zone grouping. Continue small token/type/accessibility fixes without changing route ids or global registry semantics.
- Keep `page-intelligence` standalone until SEO Editor Research/detail proves complete capability parity. Treat Content Pipeline Published as the proposed `content-perf` receiving home while preserving the standalone route until a surface-scoped shipping PR proves every report and deep link on staging.
- Continue resolving P1 behavior mismatches first; do not spend broad visual polish time on pages whose IA is still known to disagree with the prototype.
