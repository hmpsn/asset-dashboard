# Admin Rebuilt Route Coverage Audit

Audit state: route, nav, interior-state, and layout accounting complete; all 26 mounted rebuilt route homes owner-approved on 2026-07-10 with documented exceptions
Last updated: 2026-07-10
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
| `page-intelligence` | Main nav entry | Not in `REBUILT_SURFACES` | `ODP-012 B` proof complete: preserve as a standalone documented exception. SEO Editor omits strategy-only pages and does not receive Page Intelligence's research, job, keyword-edit, rank, local, queue, guide, or handoff contracts. No redirect is approved. |
| `content-perf` | Main nav entry | Not in `REBUILT_SURFACES` | `ODP-012 B` proof complete: Pipeline Published is the intended future compatibility receiver, but the standalone route remains until aggregate impressions/sessions, impressions trend, item URL initialization, honest matrix trend handling, refresh behavior, flag-aware routing, and populated evidence are proved. |
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
- Current sizing is styleguide-compliant by test and smoke. The `ODP-010 C` Performance comparison concluded that the 28px pilot was too tall for the prototype; Performance returned to the compact shared header and no broader variant migration is authorized.

New test coverage:

- `tests/component/layout/RebuiltSidebar.test.tsx` now asserts the prototype zone order, local sidebar labels, Competitors sidebar presence, `.t-label` group headers, `.t-ui` nav rows, and token-backed group/item accents.
- Existing primitive tests assert `NavGroup`, `NavItem`, and `RebuiltBreadcrumb` keep the styleguide roles and accessibility floor.

Browser smoke evidence:

- Desktop Brand route with rebuilt sidebar zones: `/tmp/asset-dashboard-codex-parity-captures/sidebar-prototype-zone-brand-desktop.png`.
- State file: `/tmp/asset-dashboard-codex-parity-captures/sidebar-prototype-zone-brand-state.json`.
- Result: expected labels present, prototype zone order passed, sampled group headers computed at 11.5px, sampled nav rows computed at 13.5px, and accents resolved to `var(--blue)`, `var(--cyan)`, `var(--teal)`, and `var(--brand-yellow)`. Console noise was limited to local Vite/WebSocket disconnect warnings.

## Interior State Coverage

Interior state has been checked in contracts, component tests, and smoke for the rebuilt route families. The remaining question is not whether tabs/lenses exist, but whether each surface's visible navigation model should keep matching production or collapse further toward the prototype.

| Contract | Route ids covered | Interior states accounted for | Visual status / constraint |
|---|---|---|---|
| Cockpit | `home` | Verdict spine, stream selector, work queue, evidence rail, activity Drawer, work-order modal, `stream=` deep link | `owner-approved`; corrected 1168px desktop composition and important overlays approved with unsupported prototype Send/Promote actions retained as explicit exceptions |
| Brand & AI | `brand` | Grouped overview, modal workflows, `?tab=`/focused receivers, all 17 generators across four groups | `owner-approved`; truthful production interiors/actions and V5–V7 remain explicit exceptions |
| Schema | `seo-schema` | Generator, Workflow Guide, site-plan disclosure, page detail Drawer, publish/send/history | `owner-approved`; corrected 1080/1020 generator and guide composition approved with the production Drawer retained as an explicit exception |
| Links | `links` | Redirects, Internal Links, Dead Links, Architecture, detail Drawers, legacy alias | `owner-approved`; corrected 1120/1060 four-lens workshop approved with copy/send retained until a real Insert write target exists |
| Performance | `performance` | Page Weight, paired single-page Mobile/Desktop results, isolated Bulk mode, weight/speed Drawers, Asset handoff | `owner-approved`; corrected fixed-viewport composition approved with live PageSpeed data unavailable and Drawer/Bulk workflows retained as explicit exceptions |
| Competitors | `competitors` | Competitive stack, alert feed, setup states, detail Drawer, Hub/brief/send actions | `owner-approved`; corrected 1120/1060 stack and honest provider setup state approved with populated composition fixture-backed |
| Keyword Hub | `seo-keywords` | Rankings, Opportunities, Pages, Clusters, bounded Lifecycle, detail Drawer | `owner-approved`; corrected 1128px five-lens workbench approved with unsupported trends/deltas retained as no-fabrication exceptions |
| Insights Engine | `seo-strategy` | Spine, changes, signals, compact POV/full-editor Drawer, moves/More menu, projections, client preview, collapsed operations, staged topbar send | `owner-approved`; V1–V3 implemented, V4–V6 approved exceptions |
| Content Pipeline | `content-pipeline` | Item-backed Board/Intake, focused Brief/Draft/Review workspaces, Calendar, Published, Content Health, Matrix, capacity/guide overlays | `owner-approved`; unsupported backend operations remain documented exceptions |
| SEO Editor | `seo-editor` | Inline Static/CMS worktable, Manual read-only rows, source/quick filters, selected toolbar, 600/860px Research Drawer, URL state | `owner-approved`; keyboard review queue remains an explicit workflow exception |
| Site Audit | `seo-audit` | Site Audit, compact History, state-aware compatibility evidence, schedule/issue/report overlays | `owner-approved`; Drawers and richer production operations remain explicit exceptions |
| Search & Traffic | `analytics-hub` | Search Performance, Site Traffic, Annotations, hidden Overview receiver, Breakdowns Drawer | `owner-approved`; unavailable live providers and unsupported proof-stage action remain explicit exceptions |
| Assets | `media` | Dense Browse workshop, compact Repair results, Upload/asset/organize overlays, bulk and repair handoffs | `owner-approved`; production Drawers and DS color semantics remain explicit exceptions |
| Page Rewriter | `rewrite` | Two-pane workspace, shell focus mode, page picker, export menu, `?pageUrl=` | `owner-approved`; export-only v1 and retained 62px Focus rail approved, while draft/publish remains separate backend scope |
| Local Presence | `local-seo` | Rank/profile, Reviews/replies, setup Drawer, legacy visibility receiver | `owner-approved`; geo-grid/GBP Performance remain explicit backend exceptions |
| Global Ops | `settings`, `workspace-settings`, `roadmap`, `revenue`, `ai-usage`, `features`, `prospect`, `outcomes-overview`, `outcomes`, `diagnostics`, `requests` | Global settings, workspace settings tabs, roadmap views, business tabs, outcomes, diagnostics, requests tabs | `owner-approved`; all 11 route homes approved with explicit `GO-*` exceptions retained |

## Layout Coverage

The behavior checkpoint accounted for layout and route state across every mounted rebuilt route family. It did not complete side-by-side owner-approved visual parity, and it did not rebuild or visually audit the two non-rebuilt main-nav routes (`page-intelligence`, `content-perf`).

Current layout buckets:

- `owner-approved`: all 26 mounted rebuilt route homes, including every documented production/backend/design-system exception. Joshua approved the final 24-route batch and retained Page Rewriter Focus rail on 2026-07-10.
- `awaiting owner approval`: none among mounted rebuilt route homes.
- `behavior-safe / visual-unverified`: none among the 26 mounted rebuilt route homes. The two non-rebuilt main-nav routes remain documented receiving-home exceptions, not mounted-surface parity claims.
- Consolidated owner-review packet and measured registry-closeout evidence: `docs/ui-rebuild/parity/registry-final-owner-review.md` and `/tmp/asset-dashboard-codex-visual-parity/registry-final/`.
- Receiving-home proof complete: Page Intelligence stays standalone under the owner-accepted `ODP-012 B` routing exception; this is not a mounted-surface visual approval. Content Pipeline Published is the future Content Performance compatibility receiver only after the six named frontend gaps and populated browser evidence are closed. Both route ids remain intact in this goal.
- Redirect/folded only: SEO Briefs, Content, and Calendar.
- Preserved legacy standalone receiver: Subscriptions; its Content Pipeline query alias is accounted for separately.

## Accepted Scope Direction

Accepted on 2026-07-09:

- Keep the accepted rebuilt sidebar prototype-zone grouping. Continue small token/type/accessibility fixes without changing route ids or global registry semantics.
- Keep `page-intelligence` standalone until SEO Editor Research/detail proves complete capability parity. Treat Content Pipeline Published as the proposed `content-perf` receiving home while preserving the standalone route until a surface-scoped shipping PR proves every report and deep link on staging.
- Continue resolving P1 behavior mismatches first; do not spend broad visual polish time on pages whose IA is still known to disagree with the prototype.
