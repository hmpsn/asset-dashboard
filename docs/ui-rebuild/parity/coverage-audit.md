# Admin Rebuilt Route Coverage Audit

Audit state: route, nav, interior-state, and layout accounting complete; 27 direct rebuilt mounts plus the folded Content Performance receiving home are owner-approved, and the 28th direct mount (AI Visibility) awaits owner review under W3.1's embedded default
Last updated: 2026-07-17
Source of truth files: `src/routes.ts`, `src/lib/navRegistry.tsx`, `src/components/layout/rebuiltSurfaces.ts`, and `hmpsn studio Design System/mockup/nav.js`

This audit answers four questions that the per-surface contracts do not answer by themselves:

- Are all admin `Page` route values accounted for?
- Are all global nav destinations in the rebuilt registry?
- Have interior tabs, lenses, drawers, and modals been checked as part of parity?
- Has each actual layout been graded against the prototype, instead of only token-polished?

## Route Census

| Category | Count | Meaning |
|---|---:|---|
| Admin `Page` union values | 33 | Every admin route id in `src/routes.ts`. |
| `NAV_REGISTRY` entries | 27 | Standalone nav/palette/breadcrumb destinations. |
| `NON_REGISTRY_PAGES` | 6 | Redirect-only, folded, or non-global-nav route ids. |
| `REBUILT_SURFACES` entries | 28 | Routes that mount directly inside `RebuiltAppChrome` when `ui-rebuild-shell` is on. |
| Parity contract files | 18 | One contract per directly mounted surface family; Global Ops covers multiple route ids. |

Current census result:

- Every `Page` value is either registered in `NAV_REGISTRY` or intentionally listed in `NON_REGISTRY_PAGES`.
- Every `NAV_REGISTRY` entry maps to a real `Page` value.
- Every currently mounted rebuilt route family has an initial behavior-first parity contract.
- Not every admin page is currently rebuilt.

## Rebuilt Versus Non-Rebuilt

| Route id | Nav status | Rebuilt status | Current parity status |
|---|---|---|---|
| `ai-visibility` | Rebuilt-only main nav entry | Rebuilt | `awaiting owner approval`: W3.1's embedded default gives the existing aggregate LLM-mention panel a dedicated lightweight Search & Site Health home; flag-off Keyword Hub remains byte-identical. |
| `page-intelligence` | Main nav entry | Rebuilt | `owner-approved` under final `ODP-012 B`: a standalone master/detail Research workbench preserves the broader analysis, job, keyword-edit, rank, local, queue, guide, and handoff contracts while flag-off keeps the legacy receiver. |
| `content-perf` | Main nav compatibility entry | Flag-on folded receiver; flag-off legacy | `owner-approved` under final `ODP-012 B`: Pipeline Published owns the rebuilt four-stat/result-card/readback composition, stable `?item=` initialization, typed trend availability, and bounded refetch. `/content-perf` and its nav identity remain for flag-off compatibility. |
| `competitors` | `NON_REGISTRY_PAGES` | Rebuilt | Still intentionally absent from the global registry, but now surfaced in the rebuilt sidebar's prototype `Strategy & Content` presentation because the rebuilt shell is flag-gated. Contract exists. |
| `workspace-settings` | `NON_REGISTRY_PAGES` | Rebuilt | Intentional per-workspace settings receiver reached from workspace gear/settings paths, not the main sidebar list. Covered by Global Ops contract. |
| `seo-briefs` | `NON_REGISTRY_PAGES` | Not rebuilt | Folded into `content-pipeline?tab=briefs`. |
| `content` | `NON_REGISTRY_PAGES` | Not rebuilt | Folded into `content-pipeline?tab=posts`. |
| `calendar` | `NON_REGISTRY_PAGES` | Not rebuilt | Redirects to `content-pipeline?tab=calendar`. |
| `subscriptions` | `NON_REGISTRY_PAGES` | Not rebuilt | Preserved standalone legacy `ContentSubscriptions` receiver. Separately, `content-pipeline?tab=subscriptions` aliases to the rebuilt pipeline's publish/capacity state. |

Practical answer: 28 routes mount directly through the rebuilt registry. The first 27 are owner-approved; AI Visibility is the 28th and awaits review of the embedded dedicated-home decision. Content Performance remains a main-nav compatibility route without a direct entry, by deliberate compatibility design: it folds into the already-mounted Pipeline Published receiver only while the rebuilt flag is on. SEO Briefs, Content, and Calendar remain redirect/fold aliases, and Subscriptions remains a flag-off legacy receiver with a Pipeline query alias.

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
- `ai-visibility` is a registry-backed Search & Site Health destination hidden flag-OFF and visible flag-ON, so legacy navigation remains unchanged.
- Typography is styleguide-aligned: `NavGroup` headers use `.t-label`, `NavItem` labels use `.t-ui`, nav badges/meta use `.t-mono`, and breadcrumbs use `.t-ui`.
- Current group accents are DS token values: top Cockpit/Insights `var(--teal)`, Strategy & Content `var(--blue)`, Search & Site Health `var(--cyan)`, Optimization `var(--teal)`, Client-facing `var(--brand-yellow)`, Admin `var(--brand-text)`.

Accepted nav parity correction:

- `ODP-011` is accepted for the rebuilt shell: use prototype zones while preserving route ids and global registry semantics.
- The prototype's `Optimization` uses `var(--purple)`, but the rebuilt implementation keeps Optimization on `var(--teal)` per the current design-system rule that purple is reserved for admin AI-only surfaces.
- The prototype has explicit `Client-facing` destinations. The current rebuilt admin nav maps Action Results and Requests into that zone. Content Performance no longer appears as a duplicate flag-on destination because Pipeline Published is its receiving home.
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
| Cockpit | `home` | Verdict spine, unique-decision band, stream selector, work queue, evidence rail, activity Drawer, work-order modal, `stream=` deep link | `owner-approved`; corrected 1168px desktop composition and important overlays approved with unsupported prototype Send/Promote actions retained as explicit exceptions; `AUD-D2` is committed and P5-verified |
| Brand & AI | `brand` | Grouped overview, modal workflows, `?tab=`/focused receivers, all 17 generators across four groups | `owner-approved`; truthful production interiors/actions and V5–V7 remain explicit exceptions |
| Schema | `seo-schema` | Generator, Workflow Guide, site-plan disclosure, page detail Drawer, publish/send/history | `owner-approved`; corrected 1080/1020 generator and guide composition approved with the production Drawer retained as an explicit exception |
| Links | `links` | Redirects, Internal Links, Dead Links, Architecture, detail Drawers, legacy alias | `owner-approved`; corrected 1120/1060 four-lens workshop approved with copy/send retained until a real Insert write target exists |
| Performance | `performance` | Page Weight, paired single-page Mobile/Desktop results, isolated Bulk mode, weight/speed Drawers, Asset handoff | `owner-approved`; corrected fixed-viewport composition approved with live PageSpeed data unavailable and Drawer/Bulk workflows retained as explicit exceptions |
| Competitors | `competitors` | Competitive stack, alert feed, setup states, detail Drawer, Hub/brief/send actions | `owner-approved`; corrected 1120/1060 stack and honest provider setup state approved with populated composition fixture-backed |
| Keyword Hub | `seo-keywords` | Rankings, Opportunities, Pages, Clusters, bounded Lifecycle, detail Drawer | `owner-approved`; corrected 1128px five-lens workbench approved with unsupported trends/deltas retained as no-fabrication exceptions |
| Insights Engine | `seo-strategy` | Spine, changes, signals, compact POV/full-editor Drawer, moves/More menu, projections, client preview, collapsed operations/history, POV freshness, staged topbar send | `owner-approved`; V1–V3 implemented, V4–V6 approved exceptions; `AUD-D1` / `AUD-D6` are committed and P5-verified |
| Content Pipeline | `content-pipeline` | Item-backed Board/Intake, focused Brief/Draft/Review workspaces, Calendar, Published aggregate evidence, Content Health, Matrix, capacity/guide overlays | `owner-approved`; unsupported backend operations remain documented exceptions; `AUD-D4` is committed and P5-verified |
| SEO Editor | `seo-editor` | Inline Static/CMS worktable, Manual read-only rows, source/quick filters, selected toolbar, 600/860px Research Drawer, URL state | `owner-approved`; keyboard review queue remains an explicit workflow exception |
| Site Audit | `seo-audit` | Site Audit, compact History, state-aware compatibility evidence, schedule/issue/report overlays | `owner-approved`; Drawers and richer production operations remain explicit exceptions |
| Search & Traffic | `analytics-hub` | Search Performance, Site Traffic, Annotations, hidden Overview receiver, Breakdowns Drawer | `owner-approved`; unavailable live providers and unsupported proof-stage action remain explicit exceptions |
| Assets | `media` | Dense Browse workshop, compact Repair results, Upload/asset/organize overlays, bulk and repair handoffs, overlay-aware shared Tooltip | `owner-approved`; production Drawers and DS color semantics remain explicit exceptions; `AUD-D7` is committed and P5-verified |
| Page Rewriter | `rewrite` | Two-pane workspace, shell focus mode, page picker, export menu, `?pageUrl=` | `owner-approved`; export-only v1 and retained 62px Focus rail approved, while draft/publish remains separate backend scope |
| Local Presence | `local-seo` | Rank/profile, Reviews/replies, setup Drawer, legacy visibility receiver | `owner-approved`; geo-grid/GBP Performance remain explicit backend exceptions |
| AI Visibility | `ai-visibility` | Share of voice, mention volume/trend, competitors, cited source domains, manual Refresh | `awaiting owner approval`; W3.1 composes the established aggregate panel exactly once and preserves the flag-off Keyword Hub home |
| Page Intelligence | `page-intelligence` | Pages master/detail Research workbench, Architecture, Guide, single/bulk analysis, keyword edit/tracking, local/rank context, SEO copy, `?tab=`/`?page=` | `owner-approved`; standalone receiving-home decision preserves the flag-off legacy route and every established capability |
| Content Performance | `content-perf` / `content-pipeline?tab=published` | Four-stat summary, result cards, filters/sort, paired trend Drawer, coverage/joinback, `?item=`, flag-aware redirect | `owner-approved`; flag-on folds into Published while flag-off preserves the legacy route/nav |
| Global Ops | `settings`, `workspace-settings`, `roadmap`, `revenue`, `ai-usage`, `features`, `prospect`, `outcomes-overview`, `outcomes`, `diagnostics`, `requests` | Global settings, workspace settings tabs, roadmap views, business tabs, outcomes, diagnostics, requests tabs | `owner-approved`; all 11 route homes approved with explicit `GO-*` exceptions retained |

## Layout Coverage

The behavior checkpoint accounted for layout and route state across the original rebuilt families but did not itself establish visual parity. The later visual pass owner-approved the original 26 routes, then added and owner-approved the standalone Page Intelligence mount plus the folded Content Performance receiving home. W3.1 later added the lightweight AI Visibility mount under an embedded decision that awaits owner review.

Current layout buckets:

- `owner-approved`: the first 27 directly mounted rebuilt route homes, including Page Intelligence, plus the folded Content Performance receiving home. The original 26-route approval remains the historical batch; Joshua separately approved the later receiving-home bundle.
- `awaiting owner approval`: AI Visibility's dedicated lightweight home, the W3.1 embedded default. The owner may veto it at PR review in favor of a temporary Keywords mount.
- `behavior-safe / visual-unverified`: none among the currently mounted or folded receiving homes.
- Consolidated owner-review packet and measured registry-closeout evidence: `docs/ui-rebuild/parity/registry-final-owner-review.md` and `/tmp/asset-dashboard-codex-visual-parity/registry-final/`.
- Receiving-home proof and owner review complete: Page Intelligence stays standalone under `ODP-012 B`; Content Pipeline Published is the flag-on Content Performance receiver. Both route ids remain intact, and both follow-ons are owner-approved.
- Redirect/folded only: SEO Briefs, Content, and Calendar.
- Preserved legacy standalone receiver: Subscriptions; its Content Pipeline query alias is accounted for separately.

Post-parity implementation coverage:

| Closure item | Current status | Implementation commits |
|---|---|---|
| `AUD-D1` | `decision owner-approved; implementation committed; P5 verified locally` | `29bac116a`, `833c26a9b` |
| `AUD-D2` | `decision owner-approved; implementation committed; P5 verified locally` | `1c0f40ee3` |
| `AUD-D3` | `decision owner-approved; implementation committed; P5 verified locally` | `f46d4cfcd`, `f8d75d60e`, `43aec6960` |
| `AUD-D4` | `decision owner-approved; implementation committed; P5 verified locally` | `c1dafb697`, `1229e48ff` |
| `AUD-D5` | `decision owner-approved; implementation committed; P5 verified locally` | `8892adc0d`, `a3efae499` |
| `AUD-D6` | `decision owner-approved; implementation committed; P5 verified locally` | Backend `1451f78e2`; UI `29bac116a`, `833c26a9b` |
| `AUD-D7` | `decision owner-approved; implementation committed; P5 verified locally` | `1243b713d` |
| `AUD-B1` | `decision owner-approved; implementation committed; P5 verified locally` | `d611db84d` |

Structured-AI, persistence, and effective-tier usage hardening is committed in `eee07ed51`, `d686d8030`, and `58a7068d5`; `fe5d5ff58` reconciles the intelligence-consumer census. P5 evidence is 2,077 files / 29,063 tests passed, 1 skipped, 3 todo; 269 bundle assets / 1.72 MiB gzip with 73 sub-50KiB assets warn-only; fresh independent `PASS`; fixed-viewport changed-surface review without overflow/current dev-server errors; and a passing 13-step quick platform verifier. Approved baselines remain CSS 37,307 B, Page Rewriter 8,819 B, and aggregate 1,720,000 B.

Provider evidence follow-on: `ws_demo_provider_rich` now supplies deterministic development-only GSC, GA4, PageSpeed, SEO-provider, and local-search evidence when `LOCAL_FAKE_PROVIDERS=true`. Integration health distinguishes configured, connected, verified, provider mode, and supported capabilities. This closes local evidence repeatability, not the authenticated-provider exceptions: GBP OAuth/reviews and live staging verification still require dedicated credentials, and the bounded read-only staging smoke has not been run. No push, PR, staging extraction/verification, or live-provider spend is authorized by this record.

## Accepted Scope Direction

Accepted on 2026-07-09:

- Keep the accepted rebuilt sidebar prototype-zone grouping. Continue small token/type/accessibility fixes without changing route ids or global registry semantics.
- Keep the owner-approved standalone Page Intelligence workbench. Keep Pipeline Published as the flag-on Content Performance receiver while preserving `/content-perf` and its nav identity for flag-off compatibility. Any later route retirement still requires a surface-scoped staging PR and the route-removal checklist; no staging work is authorized by this decision.
- Continue resolving P1 behavior mismatches first; do not spend broad visual polish time on pages whose IA is still known to disagree with the prototype.
