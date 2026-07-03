# Phase 0 Audit — Cross-Cutting Platform Readiness

> Shell, nav, URL state, theming, data layer, flags.
> Read-only audit at `ui-rebuild-phase-0` (== post-Reconcile `origin/staging` HEAD), 2026-07-03.
> Every claim carries `file:line` evidence. Ambiguities are recorded as **STOP-AND-ASK**, never resolved unilaterally.

---

## 1. Navigation — HEAD registry vs prototype two-zone rail

### 1.1 Sources

- HEAD: `src/lib/navRegistry.tsx:114-185` (`NAV_REGISTRY`, 25 entries) + `src/lib/navRegistry.tsx:98-107` (`NON_REGISTRY_PAGES`, 7 values) + `src/routes.ts:1-23` (`Page` union, 24 values).
- Prototype: `hmpsn studio Design System/mockup/nav.js` (two-zone rail, Model B) + `mockup/app.js:3-60` (`VIEWS`, 24 views) + `mockup/palette.js:49-52` ("Your book" palette group).
- Kit spec: `Platform Parity Ledger.html` (embedded `GROUPS` array — per-surface status: same/improved/moved/partial/gap/cut) and `UI Rebuild Handoff Brief.html` (18-surface map).

Nav registry consumers at HEAD that the rebuild must keep fed from ONE registry (W3.4 invariant): `src/components/layout/Sidebar.tsx`, `src/components/layout/Breadcrumbs.tsx`, `src/components/CommandPalette.tsx` (all import `NAV_REGISTRY` — verified by grep). Contract test: `tests/contract/nav-registry-completeness.test.ts` (referenced at `src/lib/navRegistry.tsx:22-24`) — every non-redirect `Page` value must have a registry entry or a documented `NON_REGISTRY_PAGES` reason.

### 1.2 Prototype rail structure (nav.js)

Two zones per `mockup/nav.js:1-4`: a BOOK zone (all-clients) above a CLIENT zone headed by the client avatar/name (the in-rail switcher, `nav.js:58-61`) with a gear → `wsettings` (`nav.js:113-117`). **The BOOK zone array is declared empty and never rendered** (`nav.js:14`: `const book = [];` — unused). Bottom utility bar: Inbox (`requests`) + an Admin popover with Roadmap / Business / Settings (`nav.js:70-89`).

CLIENT zone groups (`nav.js:17-46`):

| Group | Items (nav id · label · annotations) |
|---|---|
| (unnamed, mint) | `cockpit` Cockpit · `issue` Insights Engine |
| Strategy & Content (blue) | `keywords` Keywords **(merged 2→1)** · `competitors` Competitors · `pipeline` Content Pipeline · `local` Local Presence |
| Search & Site Health (cyan) | `traffic` Search & Traffic · `audit` Site Audit **(merged 3→1)** · `performance` Performance · `links` Links · `assets` Asset Manager · `aivis` AI Visibility |
| Optimization (purple) | `editor` SEO Editor · `schema` Schema · `rewrite` Page Rewriter · `brand` Brand & AI |
| Client-facing (yellow) | `recs` Recommendations · `portal` Client portal |
| Foot bar | `requests` Inbox · popover: `roadmap` Roadmap · `business` Business · `settings` Settings |

Views that exist in `app.js` but have **no rail entry at all**: `home` (Command Center, reached via logo click — `Keywords &amp; Flows Mockup.html:322-325` — and ⌘K palette `palette.js:49`), `sitehealth` (book-level Site Health, reached via palette `palette.js:50` and home cross-link `home.js:359`), `outcomes` (book-level Action Results, palette `palette.js:51` + home cross-link `home.js:363`), `onboard` (new-client cockpit alias, `app.js:8`, auto-routed by `app.js:87-93`), `diagnostics` (reached from an Insights Engine regression card, `app.js:16`), `wsettings` (gear only, `app.js:58`).

### 1.3 Full mapping: HEAD nav id → prototype home

Statuses cite the Parity Ledger (`Platform Parity Ledger.html`, GROUPS array) which itself says "Fable (implementation): this ledger is the spec."

| HEAD id (navRegistry.tsx) | HEAD label | Prototype home | Ledger status | Notes |
|---|---|---|---|---|
| `home` (l.115) | Home (workspace-scoped) | `cockpit` (per-client) | — (implied) | HEAD `home` is per-workspace ("Workspace overview and quick actions"). Prototype splits it: `cockpit` = per-client, `home` = NEW book-level Command Center. |
| `analytics-hub` (l.119) | Search & Traffic | `traffic` | improved | |
| `outcomes` (l.121) | Action Results (workspace) | `outcomes` view (book-level) | moved | Relocated off primary nav → Command Center "Across your book" + palette. See STOP-AND-ASK Q3. |
| `seo-audit` (l.125) | Site Audit | `audit` | improved | HEAD SeoAudit is 3-in-1: Audit + Content Health (`src/components/SeoAudit.tsx:316`) + AI Search Ready (`SeoAudit.tsx:317`, AeoReview). Prototype **splits**: Content Health → Pipeline "Content Health" tab, AI Search Ready → `aivis`. The rail badge "3→1" marks this consolidation history. |
| `performance` (l.127) | Performance | `performance` | improved | Two tabs: Page Weight + Page Speed. |
| `links` (l.129) | Links | `links` | improved | 4 tabs: Redirects · Internal · Dead · **Architecture** (SiteArchitecture moved here from Page Intelligence — ledger "Site Architecture" row, status moved). |
| `media` (l.131) | Assets | `assets` (Asset Manager) | improved | |
| `seo-strategy` (l.135) | Strategy | `issue` (Insights Engine) | improved | "Reframed as the client-facing Insights Engine (recommendations + the issue merged)." Ledger flags: "Verify the page↔keyword mapping surface is fully represented." |
| `seo-keywords` (l.137) | Keyword Hub | `keywords` | improved | The "2→1" merge — see STOP-AND-ASK Q1 (conflicting merge definitions inside the kit). |
| `page-intelligence` (l.139) | Page Intelligence | `editor` Research mode **or** `keywords` (conflict) | improved (ledger) | Ledger: merged into SEO Editor via Edit⇄Research toggle. `mockup/keywords.js:328`: Keywords "Replaces Keyword Hub · Page Intelligence". **Conflict — STOP-AND-ASK Q1.** |
| `local-seo` (l.141) | Local Presence | `local` (+ local-reviews.js, local-setup.js) | improved | Tabs Overview · Visibility · Reviews · Setup; ledger truth-check confirms no GBP-posts composer / citation tracker exists at HEAD (never built). |
| `seo-editor` (l.145) | SEO Editor | `editor` | improved | Gains Edit⇄Research toggle (absorbs Page Intelligence per ledger). |
| `seo-schema` (l.147) | Schema | `schema` | improved | 5-step workflow (Scan→Validate). |
| `brand` (l.149) | Brand & AI | `brand` | improved | AeoReview + LlmsTxtGenerator relocate to `aivis` per ledger tools rows. |
| `rewrite` (l.151) | Page Rewriter | `rewrite` | improved | |
| `content-pipeline` (l.155) | Pipeline | `pipeline` | improved | Absorbs Content Health tab, Calendar mode, Matrix mode (ContentPlanner), subscription drawer (ContentSubscriptions), brief/draft workspaces. |
| `requests` (l.159) | Requests | `requests` → foot-bar **Inbox** | moved | HEAD registry note (l.157-158): requests must NOT need a site. Prototype `requests` is `scoped:false` crumb `['Inbox']` (`app.js:24`) — a book-level inbox vs HEAD's workspace-scoped surface. **Scope change — STOP-AND-ASK Q4.** |
| `content-perf` (l.161) | Content Perf | `pipeline` Published tab | improved | Ledger says gap closed: clicks/position/impressions read-back + sparkline + engagement + win/flat/early verdict. |
| `outcomes-overview` (l.165) | Team Outcomes | `outcomes` view | improved | Ledger: "Was a dead nav link; now the cross-workspace roll-up." Merges with per-workspace `outcomes` — see Q3. |
| `prospect` (l.167) | Prospect | `business` → Prospects tab | moved | |
| `ai-usage` (l.169) | AI Usage | `business` → Usage tab | moved | |
| `roadmap` (l.171) | Roadmap | `roadmap` (foot popover) | same | |
| `features` (l.173) | Features | `business` → Features tab | moved | Sales library; distinct from feature FLAGS (Settings). |
| `diagnostics` (l.177) | Diagnostics | `diagnostics` view under Insights Engine | **conflicting rows** | Ledger Admin-group row: `to:'unassigned', status:'gap'` ("Diagnostics has no home"). Ledger Non-nav row: `status:'improved'`, built as forensic layer under Insights Engine (`diagnostics.js`, `app.js:16`). **STOP-AND-ASK Q2.** |
| `settings` (l.181) | Settings | `settings` (foot popover) | same | Includes FeatureFlagSettings + McpApiKeysSettings per ledger. |
| `revenue` (l.183) | Revenue | `business` → Revenue tab | moved | |

`NON_REGISTRY_PAGES` (`src/lib/navRegistry.tsx:98-107`) mapping: `brief` → `brief-workspace.js` (full-page workspace in Pipeline, ledger improved) · `seo-briefs`/`content`/`calendar`/`subscriptions` → `pipeline` (already folded at HEAD, W3.3) · `workspace-settings` → `wsettings` (gear next to client switcher, ledger improved) · `competitors` → `competitors` — **promoted from flag-gated deep-link-only page at HEAD to a first-class rail entry** (ledger improved).

### 1.4 Consolidations (n→1) — the merge list

1. **Business (4→1)**: `prospect` + `ai-usage` + `features` + `revenue` → `business` (`mockup/business.js`, `app.js:54`). All four are `GLOBAL_TABS` at HEAD (`src/routes.ts:37`) with their own top-level URLs (`/prospect`, `/ai-usage`, `/features`, `/revenue`).
2. **Keywords (2→1)** (`nav.js:24` badge): definition conflicts inside the kit — see Q1.
3. **Site Audit (3→1)** (`nav.js:30` badge): HEAD `SeoAudit.tsx` sub-tabs Audit / Content Health (l.316) / AI Search Ready (l.317) — the prototype keeps `audit` pure and relocates Content Health → Pipeline tab, AI Search Ready → `aivis`. (So the prototype is actually a 1→3 split of the HEAD 3-in-1; the badge documents lineage.)
4. **Outcomes (2→1)**: `outcomes` (workspace) + `outcomes-overview` (Team Outcomes, global) → one book-level `outcomes` view (palette-only). See Q3.
5. **Page Intelligence (fold)**: → SEO Editor Research mode per ledger (or Keywords per keywords.js). Q1.
6. **AI-visibility (3→1, new surface)**: `aivis` gathers AeoReview (HEAD in SeoAudit tab, `SeoAudit.tsx:42,317,370`), LlmsTxtGenerator (HEAD in Brand & AI per ledger), AiVisibilityPanel (HEAD in `src/components/strategy/`), + retired `ai-visibility` flag's KPI layer (now unconditional — `shared/types/feature-flags.ts:60-65` comment).
7. **Pipeline absorbs**: content-perf (Published tab), ContentDecay (Content Health tab), ContentPlanner (Matrix mode), ContentSubscriptions (drawer), brief/draft full-page workspaces.
8. **Links absorbs**: SiteArchitecture as 4th tab (from Page Intelligence).

### 1.5 HEAD entries with NO in-rail home (nav demotions the rebuild must not turn into losses)

- `home`(book Command Center)/`sitehealth`/`outcomes`: palette + logo + cross-links ONLY (`palette.js:49-51`, mockup HTML l.322-325, `home.js:359,363`). The empty BOOK zone (`nav.js:14`) means no book-level destination is ever visible in the rail. **Q3.**
- `diagnostics`: deep-link only (matches HEAD, where it IS a registry entry with a sidebar presence — `navRegistry.tsx:177`; prototype demotes it to NON_REGISTRY-style. Ledger self-conflicts. **Q2.**
- `prospect`/`ai-usage`/`features`/`revenue`: inside Business tabs — capability preserved, URL redirects needed (**Q5**).

### 1.6 New prototype surfaces with no HEAD nav id (candidate NEW functionality — need sign-off per mandate)

- `cockpit` (per-client overview distinct from book home) — closest HEAD analog is `home`/WorkspaceHome.
- `home` as **book-level Command Center** — no HEAD equivalent (HEAD `/` is workspace selection inside AdminApp, `src/App.tsx:134`).
- `sitehealth` — book-level cross-client site health. No HEAD surface.
- `aivis` — AI Visibility as standalone surface (constituents exist at HEAD, the surface does not).
- `recs` — Recommendations as standalone "Client-facing" surface with auto-share rules (`app.js:20-21`); at HEAD recommendation curation lives inside Strategy cockpit (strategy-v3).
- `portal` — Client portal preview surface (`app.js:22-23`, "Open live portal"); at HEAD the client dashboard is a separate app shell (`/client/:workspaceId`) and admin-side config lives in `src/components/settings/ClientDashboardTab.tsx`.
- `business` — the 4→1 consolidation page itself.
- `onboard` — dedicated new-client setup view with auto-routing coherence rules (`app.js:84-97`).

---

## 2. URL state — what the rebuild MUST preserve

The prototype has **no URL routing at all**: view state persists in `localStorage('hmpsn_mockup_view')` (`app.js:113,125`) and client selection in `localStorage('hmpsn_active_client')`. This is mockup convenience, not spec. HEAD's URL contracts are the spec:

1. **Route shells** (`src/App.tsx:130-134`): `/welcome`, `/styleguide`, `/client/beta/:workspaceId/*`, `/client/:workspaceId/*`, catch-all `AdminApp`.
2. **Path builders** (`src/routes.ts:40-53`): `adminPath(workspaceId, tab)` — global tabs (`GLOBAL_TABS`, `routes.ts:37`: settings, roadmap, prospect, ai-usage, revenue, features, outcomes-overview) render at `/{tab}` with no workspace; workspace tabs at `/ws/:workspaceId/:tab?`. `clientPath(workspaceId, tab, betaMode)` at `/client[/beta]/:workspaceId/:tab?`.
3. **Client inbox aliases** (`src/routes.ts:26-34, 55-58`): `approvals→decisions`, `requests→conversations`, `content→reviews`, `schema-review→reviews`; `clientPath` rewrites alias tabs to `/inbox?tab=<InboxFilter>`. Old bookmarks must keep working.
4. **`?tab=` two-halves contract**: 23 `searchParams.get('tab')` call sites at HEAD (repo grep). Receivers include `WorkspaceSettings`, `KeywordStrategy`, `ContentPipeline`, `WorkspaceHome`, `LinksPanel`, `BrandHub`, `SchemaSuggester`, `Performance`, `KeywordHub`, `brand/BlueprintDetail`, `client/InboxTab`, `client/StrategyTab`, `local-seo/LocalPresencePage`. Enforced twice: statically by `tests/contract/tab-deep-link-wiring.test.ts:1-13` (parses App.tsx/ClientDashboard.tsx route tables, finds every `?tab=` sender, asserts the target component reads the param) and by pr-check "TabBar component without ?tab= deep-link support" (`scripts/pr-check.ts:4198-4226`, escape hatch `tab-deeplink-ok`). Any rebuilt tabbed surface must keep both halves or both gates fail.
5. **Other live query params** (repo grep): `?focus=` field-level deep-link (`src/hooks/useDeepLinkFocus.ts:1-25` — senders link `?tab=<tab>&focus=<fieldId>`, receiver scrolls/focuses `data-schema-deeplink` elements; used by WorkspaceSettings + settings tabs), `?sub=` (`src/components/SeoAudit.tsx`, `client/DeepDiveTab.tsx`), `?post=` (`admin/useAdminPostWorkflow.ts`, DiagnosticReportPage), `?report=` (`admin/DiagnosticReport/DiagnosticReportPage.tsx`).
6. **Keyboard nav**: number-key tab jumps + `,`→settings (`src/App.tsx:260-261`), ⌘K palette (CommandPalette, registry-driven). The prototype keeps ⌘K (`app.js:78`).
7. **Cross-surface deep-links that encode consolidations**: e.g. SeoAudit → `adminPath(ws,'links') + '?tab=dead-links'` (`src/components/SeoAudit.tsx:536`). Every consolidation in §1.4 moves a deep-link target; the route-removal checklist (`docs/rules/route-removal-checklist.md`) applies to every renamed/removed `Page` value: routes.ts + App.tsx + navRegistry entry + navigation-literal call sites + nav/deep-link contract tests, one commit.

---

## 3. Theming — HEAD already ships both themes

**Answer to "does HEAD ship a light theme": YES, fully.**

- Token layer: `src/tokens.css:151` — `.dashboard-light, .light { ... }` overrides every category (surfaces, text, brand bg, mint, borders, shadows, scrollbar, charts, overlays, inverted zinc scale, WCAG-darkened accent hues, blue scale, chart tokens) through `tokens.css:239`. Dark is the `:root` default (`tokens.css:16`).
- App wiring: admin toggle at `src/App.tsx:142-158` (localStorage key `admin-theme`, wraps the app in `.dashboard-light`); client toggle at `src/components/ClientDashboard.tsx:93-97,673` (**separate** localStorage key `dashboard-theme`).
- Compat layer: ~253 `.dashboard-light` rules in `src/index.css` (count via grep) remapping raw Tailwind classes (`.bg-zinc-900`, `.text-teal-400`, …) with `!important` (`src/index.css:637-700+`) — this exists because legacy components hardcode zinc/accent utility classes instead of tokens.
- Styleguide: `.light` is the public styleguide's toggle class (`tokens.css:150` comment); `public/tokens.css` is a build-time mirror via `copyTokensPlugin()` in `vite.config.ts` (per CLAUDE.md token authority); pr-check enforces `styleguide-token-parity`, `styleguide-typography-parity`, `styleguide-css-must-import-public-tokens`, `src-index-css-no-token-declarations`.

**Kit alignment**: the Design System kit uses the SAME canonical token names and theme classes — `tokens/colors.css:99-100` declares `.dashboard-light, .light` with `--surface-1/2/3`, `--brand-text*`, `--brand-mint*`, zinc scale, accent hues (verified by extraction). The mockup's per-view CSS uses shorthand aliases (`--s1`, `--bd`, `--mint`, `--r-lg` — `mockup/keywords.js`) which are mockup-local; the Primitive Reuse Audit says not to copy them.

**"Both themes from first commit" therefore requires:**
1. Token-only styling in every rebuilt component (kit CLAUDE.md rule 2/3) — this is what lets the ~253-rule `!important` compat layer in `src/index.css` retire instead of grow. Retiring it is only safe per-surface as raw zinc/accent classes disappear from that surface.
2. Every NEW token added to **both** scopes — `:root` and `.dashboard-light, .light` — in `src/tokens.css` only (never elsewhere; pr-check enforced).
3. Keep both class names: `.dashboard-light` (React app) and `.light` (styleguide), or migrate both simultaneously.
4. Keep the theme toggles working during the incremental-behind-flags rollout (owner direction 2026-07-02: incremental, not big-bang) — a rebuilt surface renders inside the existing `.dashboard-light` wrapper, so a token-only surface inherits both themes by construction.
5. Light-mode contrast re-check on accents (kit house rule 7); HEAD already ships WCAG-darkened light accents (`tokens.css:216-227`).
6. Typography: 14 `.t-*` utility classes live in `src/index.css` (CLAUDE.md token authority); kit adds DIN Pro/Inter split (`tokens/fonts.css`, `tokens/typography.css`) — **new fonts are additive; nothing at HEAD uses DIN Pro** (STOP-AND-ASK Q6 covers the type-system swap).

---

## 4. Data layer — the live-update contract every rebuilt surface must wire

### 4.1 The broadcast → invalidate loop (both halves mandatory)

- **Server half**: every workspace-data mutation calls `broadcastToWorkspace()` (349 call sites in `server/` per grep) with an event constant from `server/ws-events.ts` — never inline strings. `WS_EVENTS` currently defines ~79 workspace-scoped events (`server/ws-events.ts:14-186`), `ADMIN_EVENTS` 10 global events (`ws-events.ts:191-202`).
- **Frontend half**: `useWorkspaceEvents(workspaceId, handlers)` (`src/hooks/useWorkspaceEvents.ts:13-47`) subscribes over the shared socket (`src/hooks/workspaceEventBus.ts`) — it sends the `subscribe` action the server's workspace filter requires. `useGlobalAdminEvents` (`src/hooks/useGlobalAdminEvents.ts`) does NOT subscribe and is reserved for `ADMIN_EVENTS.*` + `presence:update` only (CLAUDE.md data-flow rule 2).
- **Centralized invalidation**: `useWsInvalidation(workspaceId)` (`src/hooks/useWsInvalidation.ts:17`) is mounted ONCE at the admin shell (`src/App.tsx:329`) and maps every WS event → query-key sets via the registry `src/lib/wsInvalidation.ts` (scopes: `admin`, `admin-deliverables`, `client-dashboard`, `client-unified-inbox`, `client-copy-review` — `wsInvalidation.ts:6-11`). A rebuilt shell must keep this single mount; a rebuilt surface generally needs NO per-component invalidation wiring **if** its query keys come from the factory and its events are in the registry.
- **Direct subscribers**: 22 files additionally use `useWorkspaceEvents` for surface-specific handlers (e.g. `KeywordHub.tsx`, `ClientDashboard.tsx`, `client/inbox/UnifiedInbox.tsx`, `editor/useSeoEditorBulkWorkflow.ts`, several `hooks/admin/*`). Each rebuilt surface must carry over its direct subscriptions or fold them into the registry.

### 4.2 Query keys

- Single factory: `src/lib/queryKeys.ts` (211 factory functions; header contract `queryKeys.ts:1-16`). Hierarchical `['admin-…', wsId, …]` / `['client-…', wsId, …]` keys enable prefix invalidation. New surfaces add factories here — never literal arrays (the near-zero literal-key grep count confirms the convention holds at HEAD).
- All data via typed wrappers in `src/api/` + React Query hooks in `src/hooks/admin/` / `src/hooks/client/` — no raw `fetch()` in components (CLAUDE.md).

### 4.3 Intelligence reads

- Server assembly: `server/workspace-intelligence.ts` facade over 15 `server/intelligence/*-slice.ts` slices (count verified); consumers never call slices directly (CLAUDE.md data-flow rule 6; `docs/rules/workspace-intelligence.md`).
- Frontend read paths: admin `queryKeys.admin.intelligence(wsId, slices, pagePath, learningsDomain)` (`src/lib/queryKeys.ts:225-227`); client `['client-intelligence', wsId]` (`queryKeys.ts:310`) ← `GET /api/public/intelligence/:workspaceId` (`src/api/analytics.ts:154`). Invalidation flows through `intelligenceAll(wsId)` inside the wsInvalidation key-sets (e.g. `wsInvalidation.ts:26,58`).
- A rebuilt surface that surfaces "intelligence" data must read these endpoints/keys, not invent parallel reads.

### 4.4 What a rebuilt surface must wire to not regress live updates (checklist)

1. Query keys from `src/lib/queryKeys.ts` factories with `admin-*`/`client-*` prefixes.
2. Reads through `src/api/*` typed wrappers.
3. Mutations: server route already broadcasts (do not remove); verify the event is in `src/lib/wsInvalidation.ts`'s map and covers the surface's new keys — if not, extend the registry (not ad-hoc handlers).
4. Workspace-scoped events → `useWorkspaceEvents`/`useWsInvalidation`; never `useGlobalAdminEvents`.
5. Preserve the 22 direct `useWorkspaceEvents` subscriptions when porting their host surfaces.
6. Client dashboard surfaces: same contract with `client-*` scopes (ClientDashboard mounts its own subscription — `ClientDashboard.tsx` grep hit).
7. Prototype interactivity (`mockup/store.js`, `hmpsn-thread` window events, `nav.js:10-11` badge) is localStorage theater — the production analog is exactly this WS + React Query loop.

---

## 5. Feature flags gating UI surfaces

Catalog: `shared/types/feature-flags.ts` (`FEATURE_FLAGS` defaults `:20-115`, `FEATURE_FLAG_CATALOG` `:190-…`). **20 active keys** after the 2026-07-03 flag sunset (29→20; `ai-visibility` retired to unconditional — comment at `feature-flags.ts:60-65`). All defaults are `false` (dark-launched).

| Flag | Gates | Rebuild disposition (proposed — owner confirms) |
|---|---|---|
| `strategy-command-center` | Admin Strategy v2 IA (`KeywordStrategy.tsx` reads it) | The rail's `issue` surface IS the successor. Rebuild builds flag-ON as the target; flag retires when Insights Engine ships (removalCondition `feature-flags.ts:305`). |
| `strategy-the-issue` | The Issue cockpit + client feed; composes `theIssueEnabled = commandCenterEnabled && this` (`feature-flags.ts:86-89`); also the client mount gate + the `competitors` page gate (`navRegistry.tsx:105-106`) | Same: prototype `issue` + `competitors` are its flag-ON form. |
| `strategy-trust-ladder-autosend` | Auto-send leg of weekly cron (behavior, not render) | Keep; owner-decision flag — never auto-enable (`feature-flags.ts:91-95`). |
| `strategy-keywords-managed-set` / `strategy-competitor-send` / `strategy-signal-fold` | Strategy redesign children (managed set UI, competitor send, signal fold) | Respect during rebuild of Keywords/Insights Engine; prototype assumes all ON (KeywordsView shows managed lifecycle; nav shows Competitors). |
| `strategy-divergence-sweep` | Read-only cron report | Backend-only; untouched by UI rebuild. |
| `the-issue-client-spine` / `the-issue-client-measured-capture` / `the-issue-client-return-hook` / `the-issue-client-next-bets` / `client-ia-v2` | Client dashboard shell + Issue client page (`TheIssueClientPage.tsx`, `OverviewTab.tsx`, `InsightsEngine.tsx` read them) | **Deliberately kept for this rebuild** (P2 owner direction: rebuild retires UI-shell flags; backend flags stay on lifecycle). Client-facing build is gated on the client-dashboard decision anyway (Handoff Brief GATE). |
| `client-briefing-v2` / `client-briefing-v2-ai-polish` / `client-work-feed` | Client overview briefing variants | Same client-shell family — resolve in the client dashboard decision. |
| `national-serp-tracking`, `local-gbp`, `gbp-auth-connection`, `gbp-auth-reviews`, `gbp-review-responses` | SEO Decision Engine data layers + GBP OAuth/review UI (`LocalPresencePage.tsx`, `GbpReviewsPanel.tsx` read the GBP ones) | Respect: prototype Local Presence Reviews pipeline is the flag-ON form of `gbp-review-responses`; rebuilt Local Presence must keep OFF-states rendering correctly. |

Hard constraints the rebuild inherits:

- **`useFeatureFlag` resolves GLOBAL flags only** (`src/hooks/useFeatureFlag.ts:16-25` fetches `/api/feature-flags`); per-workspace overrides gate the server but never the client render path (CLAUDE.md). Piloting a rebuilt client surface per-workspace requires either a global flip or making the specific gate workspace-aware.
- **Hooks unconditional** + real `loading→loaded` flag-transition test per gated component (pattern: `tests/component/client/OverviewTab.flagTransition.test.tsx`; static backstop `npm run lint:hooks`). Mocked-hook tests cannot catch rules-of-hooks crashes.
- **Flag-ON real-render smoke** before any user-facing flag ships (CLAUDE.md UI/UX rule 13).
- Nav-level flag behavior belongs in `NavFlagBehavior` on the registry entry (`navRegistry.tsx:63-72`) — one place, not per-surface.
- Gates: `npm run verify:feature-flags` + `verify:coverage-ratchet` (zero-ratchet constraint).

---

## 6. STOP-AND-ASK — questions requiring owner decisions

**Q1 — Page Intelligence has two conflicting homes inside the kit.** Parity Ledger ("Page Intelligence" row): merged into **SEO Editor** via Edit⇄Research toggle ("One page-centric surface instead of two"). But `mockup/keywords.js:328` prints "Replaces **Keyword Hub · Page Intelligence**" under the Keywords title, and the Handoff Brief's worked example says Keywords 2→1 merges "the former standalone keyword-picking and keyword-recommendation screens" (a third definition). Which merge is the decision? Page Intelligence capabilities (per-page keyword analysis, metrics, optimization recs, Create-Brief/Add-Schema/View-Traffic hand-offs — `navRegistry.tsx:139-140`) must have exactly one owning surface before its ticket is written.

**Q2 — Diagnostics: the ledger contradicts itself.** Admin-group row: `to:'unassigned', status:'gap'` ("decide whether it belongs in Settings/Admin, or is intentionally cut"). Non-nav-routes row: `status:'improved'`, built under Insights Engine → "Deep diagnostic" (`mockup/diagnostics.js`, `app.js:16`). At HEAD, `diagnostics` is a real sidebar entry (`navRegistry.tsx:177`). Confirm: (a) the Insights-Engine-deep-link home is the decision, (b) the standalone nav entry is intentionally demoted, and (c) direct URL `/ws/:id/diagnostics` + `?report=` deep-links (`DiagnosticReportPage.tsx`) survive.

**Q3 — Book-level views are palette/logo-only; the BOOK zone is empty.** `nav.js:14` declares `const book = []` and never renders it, so Command Center, book Site Health, and Action Results have zero rail presence (`palette.js:49-51` is their main entry). (a) Is rail-invisibility intentional or is the empty book array an unfinished prototype artifact? (b) HEAD has BOTH per-workspace `outcomes` and global `outcomes-overview`; the prototype shows one book-level `outcomes` view. Does the per-workspace Action Results lens survive (e.g. inside Cockpit), or is workspace-level outcomes reporting intentionally folded up? Losing the per-workspace lens would be a capability loss.

**Q4 — Inbox scope change.** HEAD `requests` is workspace-scoped (`Page` value, `/ws/:id/requests`) and deliberately not site-gated (`navRegistry.tsx:157-160`). Prototype Inbox is `scoped:false` (book-level, `app.js:24`) in the foot bar. Confirm the target: one cross-client inbox (new functionality — needs sign-off) vs per-workspace threads (parity). Also confirm the client-side Inbox (`ClientTab 'inbox'` + `InboxFilter` aliases, `routes.ts:25-34`) is untouched by this rename.

**Q5 — URL scheme + redirect map for consolidated/new surfaces.** The prototype has no URLs (`app.js:113`). Decisions needed before any build: (a) routes for new surfaces (`/business`, `/ws/:id/aivis`, `/ws/:id/competitors` unflagged, cockpit-vs-home, `/sitehealth`, `/ws/:id/recs`, `/ws/:id/portal`, book `/outcomes`); (b) redirects for every demoted `Page` value (`prospect`→`/business?tab=prospects`, `ai-usage`, `features`, `revenue`, `page-intelligence`→its Q1 home, `content-perf`→`content-pipeline?tab=published`, …) following `docs/rules/route-removal-checklist.md`; (c) which `Page` values move to `NON_REGISTRY_PAGES` vs get deleted. Old bookmarks/deep-links must keep resolving (the existing pattern: `calendar` → `content-pipeline?tab=calendar`, `navRegistry.tsx:102`).

**Q6 — Type system swap (DIN Pro/Inter) is a new dependency.** Kit house rule 6 fixes DIN Pro for headings/numerals/UI chrome + Inter for body; HEAD ships neither (14 `.t-*` classes in `src/index.css` on the current stack). Fonts are additive but licensing, loading strategy, and the `.t-*` ↔ kit `type-scale.css` mapping need an explicit decision before the shell ticket.

**Q7 — Theme toggle unification.** HEAD keeps two independent localStorage keys: `admin-theme` (`App.tsx:143`) and `dashboard-theme` (`ClientDashboard.tsx:94`). Does the rebuilt shell unify them, and does the light theme become client-visible by default? (Client dashboard decision dependency.)

**Q8 — Icon system swap.** Kit mandates Font Awesome Sharp Regular via `Icon` + `ICON_NAMES`, "no Lucide" (kit CLAUDE.md); HEAD's registry and every surface use lucide-react (`navRegistry.tsx:26-32`). Confirm the swap is in scope for the shell phase (it touches every surface + the nav registry's `IconType`), and whether lucide remains during the incremental rollout (mixed-icon interim state).

**Q9 — Client-facing zone surfaces (`recs`, `portal`) have no HEAD-nav analog.** Their capabilities exist (strategy-v3 curation/send spine; client dashboard + `ClientDashboardTab` settings) but re-homing them as admin rail destinations is a candidate NEW functionality per the mandate — propose + sign-off before scoping tickets.

**Q10 — `merged` badges in production?** `nav.js:49-53` renders "2→1"/"3→1" badges and `keywords.js:328` renders "Replaces …" chips. Confirm these are prototype-only annotations (migration storytelling), not production UI.

---

## 7. Cross-cutting parity ledger (this topic's four marks)

| Capability at HEAD | Mark | Evidence / new home |
|---|---|---|
| Registry-driven nav (one source → Sidebar/Palette/Breadcrumbs) + completeness contract test | preserved (must carry) | `navRegistry.tsx:1-24`; consumers grep; prototype has no registry — production rebuild must keep one |
| ⌘K command palette incl. book-level destinations | preserved | `CommandPalette.tsx`; `palette.js:49-52` |
| needsSite gating per entry (requests exempt) | preserved (must carry) | `navRegistry.tsx:83,157-160`; prototype has no gating concept — port it |
| NavFlagBehavior (flag relabel/hide in one place) | preserved (must carry) | `navRegistry.tsx:63-72` |
| URL routing: adminPath/clientPath, GLOBAL_TABS, client inbox aliases | at risk (prototype is localStorage-only) → **must re-assert as spec** | `routes.ts:37-58`; `app.js:113` |
| `?tab=` two-halves + contract test + pr-check rule; `?focus=`, `?sub=`, `?post=`, `?report=` | preserved (must carry) | §2 items 4-5 |
| Keyboard shortcuts (number keys, `,`, ⌘K) | preserved | `App.tsx:260-261` |
| Dark + light themes, token-only light block, styleguide parity gates | preserved — HEAD already ships both | §3 |
| `.dashboard-light` Tailwind compat layer (~253 rules) | improved (retires per-surface as token-only components land) | `src/index.css:637+` |
| broadcast→invalidate loop (WS_EVENTS, useWsInvalidation registry, workspaceEventBus) | preserved (must carry) | §4.1 |
| queryKeys factory (211 keys) + api wrappers | preserved (must carry) | §4.2 |
| Intelligence slice reads (admin + client endpoints) | preserved (must carry) | §4.3 |
| 20 feature flags incl. client-shell family kept for rebuild | preserved / lifecycle-managed | §5 |
| Per-workspace `outcomes` lens | **at risk** | Q3 |
| Standalone Diagnostics nav entry | **at risk** (demote decision pending) | Q2 |
| Page Intelligence surface | **at risk** (conflicting homes) | Q1 |
| Workspace-scoped Requests | **at risk** (scope change) | Q4 |
| Book Command Center, book Site Health, `aivis`, `recs`, `portal`, `business`, `onboard`, cockpit/home split | new (proposed) | §1.6, Q9 |
