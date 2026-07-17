# Prototype Parity Contracts

This folder is the recovery track for the rebuilt admin UI. It makes the hmpsn studio prototype an executable contract instead of a mood board.

Behavior safety is the floor, not visual parity. A rebuilt surface must preserve the prototype's interaction model, IA, route state, and capability homes, then match its desktop composition through direct source-and-browser comparison. A surface is complete only when Joshua explicitly records `owner-approved` or explicitly approves a documented exception.

Owner-gated choices are collected in `owner-decision-packet.md`. Use that file when a correction would change IA, route meaning, backend scope, shared contracts, feature flags, or a high-trust production workflow.

## Contract Format

Each surface contract should include:

1. Prototype references
   - Mockup files, harness entries, and screenshots.
   - The exact prototype behavior being treated as canonical.

2. Required interaction model
   - Default overview structure.
   - Selector/filter behavior.
   - Drawer, modal, dialog, and detail-opening rules.
   - Which interactions are prototype-critical vs visual polish.

3. URL and deep-link behavior
   - Default route.
   - `?tab=` receivers and aliases.
   - Any secondary params such as `focus`, `stream`, `item`, or modal state.

4. Carry-over homes
   - Legacy components that remain mounted.
   - Whether they mount inline, in a drawer, in a modal, or as an overflow action.
   - The test proving each is reachable exactly once.

5. Moved or excluded capabilities
   - Capabilities intentionally owned by another surface.
   - Capabilities deferred to a ledger row.
   - Zombie routes or labels that must not reappear.

6. Browser smoke checklist
   - Desktop overview.
   - Mobile overview as a light regression floor only: catch unusable overlap, blank panels, shell squeeze, or horizontal overflow, but do not optimize exact mobile parity unless the surface is explicitly expected to be used on phones.
   - One open drawer, modal, or dialog state.
   - One deep link.
   - Console clean enough to distinguish auth fixture noise from real page errors.

7. Automated test floor
   - Flag-on mount survives the real `useFeatureFlag` loading-to-loaded transition.
   - Prototype-critical interactions open the expected overlay.
   - Deep links initialize the intended state.
   - Legacy capabilities remain reachable exactly once.
   - Internal rebuild/migration labels are absent.
   - Rebuilt a11y floor passes.

## Visual Status And Order

Use only `behavior-safe / visual-unverified`, `visual revision in progress`, `awaiting owner approval`, and `owner-approved` as surface statuses. Automated review verdicts and green gates are evidence, not owner approval.

The completed surface sequence was Insights Engine; Brand & AI; Content Pipeline; SEO Editor; Search & Traffic; the Asset Manager / Performance / Site Audit repair-flow cluster; Schema / Links / Competitors / Keyword Hub; Cockpit / Local Presence / Global Ops; Page Intelligence / Content Performance receiving-home decisions; then the registry-wide final visual audit. The active follow-on is the post-parity functionality, wiring, AI-intelligence, and optimization audit in `post-parity-functionality-wiring-ai-audit.md`. Do not convert its reviewer evidence into approval of the seven new owner circle-backs.

## Sol Ultra Review Checkpoints

When GPT-5.6 Sol Ultra is available in Codex, use it as the independent parity reviewer at high-leverage checkpoints rather than for routine edits or command execution.

1. Before a high-impact correction, have Sol Ultra read the real prototype source, current surface contract, production implementation, route state, and capability map. Its output must be a discrepancy list split into behavior, IA, capability, visual, and evidence gaps.
2. After each P1 implementation slice, have Sol Ultra review the diff plus desktop overview, deep-link, and open-overlay screenshots. It returns `pass`, `revise`, or `needs owner circle-back`, with contract clauses and file references for every blocker.
3. After every three P1 surfaces, run a portfolio review across nav placement, typography hierarchy, shared wrappers, modal/drawer behavior, and cross-surface capability homes. This catches local fixes that drift apart when viewed as a product.
4. Before staging, run one branch-wide release review focused on hidden capabilities, route/deep-link compatibility, duplicate mounts, misleading controls, internal migration language, styleguide violations, and unverified decision assumptions.

Use the normal implementation model for test-first edits, local refactors, routine gates, and deterministic fixes. Sol Ultra should spend its additional reasoning depth on ambiguity, cross-file synthesis, visual judgment, and adversarial review. It does not override accepted `ODP-*` decisions silently; a conflicting recommendation becomes a documented circle-back with evidence.

## Current Local Smoke Artifacts

This branch captured Cockpit smoke screenshots in:

`/tmp/asset-dashboard-codex-parity-captures/`

Those files are local evidence, not source-controlled baselines. They should be regenerated when a surface contract moves from "draft" to "accepted."

## Coverage Audit

The rebuilt-surface contracts cover every route family currently mounted through `REBUILT_SURFACES`; they do not imply that every admin `Page` route has been rebuilt. `coverage-audit.md` is the route/nav/interior-state census for that distinction.

Current coverage finding:

- `src/routes.ts` has 33 admin `Page` values.
- `NAV_REGISTRY` has 27 global nav destinations, and `NON_REGISTRY_PAGES` explicitly accounts for the other 6 redirects, folded routes, standalone workspace receivers, and rebuilt-sidebar-only entries.
- `REBUILT_SURFACES` has 28 directly mounted workspace/global `Page` routes. Page Intelligence is the 27th owner-approved direct mount; AI Visibility is the 28th and is awaiting owner review under W3.1's embedded dedicated-home default. W4.1b adds the separately registered `BOOK_REBUILT_SURFACE` at `/`; its `command-center-contract.md` packet is implementation-complete and awaiting owner visual review without changing the 28-route `Page` census.
- `content-perf` is deliberately not a direct mount: with `ui-rebuild-shell` on, its compatibility route resolves to `content-pipeline?tab=published`; with the flag off, the legacy Content Performance route and nav remain intact.
- `competitors` is still globally `NON_REGISTRY_PAGES`, but the rebuilt sidebar now surfaces it in the prototype `Strategy & Content` zone because the rebuilt shell is flag-gated. `workspace-settings` remains a per-workspace settings receiver, not a main sidebar item.

Use `coverage-audit.md` before claiming a page is "accounted for." `ODP-011` is approved for the rebuilt shell: sidebar presentation follows the prototype zones while preserving route ids and global registry semantics. `ODP-012 B` is complete with a conservative split: Page Intelligence has an owner-approved standalone rebuilt Research workbench, while Content Pipeline Published is the owner-approved flag-on Content Performance receiver. Both route ids and both `NAV_REGISTRY` identities remain intact for compatibility; only the flag-on Content Performance presentation folds.

## Typography Calibration

The rebuilt parity sweep uses the documented design-system type scale, not the drifted compact utility values that briefly made rebuilt surfaces feel undersized. `src/index.css` and `public/styleguide.css` now match the token sizes in `src/tokens.css`; `tests/contract/typography-token-parity.test.ts` guards that relationship.

When grading visual polish, treat page-level explanatory copy, modal framing, report context, and workflow body text as needing `.t-page`, `.t-body`, `.t-ui`, or `.t-caption` according to hierarchy. `.t-caption-sm` is still valid for metadata and compact chrome, but it is no longer an 11px escape hatch and should not carry important page-level instructions. The rebuilt shared shell now uses styleguide roles too: sidebar group headers use `.t-label`, nav item labels and breadcrumbs use `.t-ui`, nav badge/meta text uses `.t-mono`, and stream-card descriptions use `.t-body`. Brand & AI applies this role split explicitly: operator row labels use `.t-ui`, row/modal/rail explanation copy uses `.t-body`, and caption roles stay on counts, timestamps, badges, and compact controls. Cockpit now applies the same standard to the calibration primitives: stream numbers use `.t-h1`, evidence rail work labels use `.t-ui`, client-thread messages use `.t-body`, compact metadata stays `.t-caption-sm`, and tiny raw pixel text classes are absent from the rebuilt Cockpit path. Schema follows the structured-data workflow rule: guide phase descriptions, pipeline safeguards, client handoff, measurement copy, Drawer JSON-LD guidance, Drawer publish/send guidance, and empty setup instructions use `.t-body`; guide action and safeguard rows use `.t-ui`. Links follows the workshop-instruction rule: redirect apply guidance, internal-link implementation guidance, dead-link repair guidance, architecture next steps/gap explanations, and measured-outcome framing use `.t-body`; path snippets, crawl status, and compact table metadata stay on caption roles. Performance follows the detect/repair rule: Page Weight stale/repair guidance, Page Weight drawer compression context, PageSpeed score context, bulk-test guidance, and Asset Manager speed-loop handoff copy use `.t-body`. Search & Traffic follows the same report rule: date/window controls, row counts, source labels, and action links use `.t-ui`; report explanations and collapsed conversion context use `.t-body`. SEO Editor follows the workbench rule: worksheet status and primary page/SEO values use `.t-ui`, secondary row summaries use `.t-caption`, drawer/research guidance uses `.t-body`, and field labels use `.t-label`. Site Audit follows the decision-console rule: score context, schedule guidance, issue-drawer recommendations, and proof framing use `.t-body`; audit table and drawer work labels use `.t-ui`; compact issue recommendations remain `.t-caption`. Insights Engine uses `.t-h1` for the operator verdict, hero `StatCard` / `.t-stat-lg` for value at stake, `.t-body` for section explanations, and `.t-ui` for compact section/row labels; the nested client trust preview deliberately keeps its smaller `.t-page` verdict and `.t-body` proof copy. Content Pipeline follows the published-proof rule: proof queue framing uses `.t-ui`, the graduation explanation uses `.t-body`, and readback/win counts stay in DS stat primitives. Competitors follows the alert-feed rule: alert domains use `.t-body`, alert keywords/actions use `.t-ui`, and movement/date metadata uses `.t-caption-sm`. Page Rewriter follows the two-pane drafting rule: assistant guidance, generated rewrite text, document body text, and export status explanations use `.t-body`; page picker paths, document controls, live-page links, loading copy, and export status labels use `.t-ui`. Local Presence follows the rank/profile evidence rule: setup, GBP, empty-state, and trend explanations use `.t-body`; competitor/market/suggested-keyword labels and share-of-voice values use `.t-ui`; read-only local visibility counts use blue data accents, not teal action accents. Asset Manager follows the source-fix workshop rule: Webflow/CMS repair explanations and measured-proof graduation copy use `.t-body`; read-only media counts stay blue, active repair buttons stay teal, and measured proof framing uses emerald. Keyword Hub follows the dense-evidence rule: client feedback labels and SERP/local proof use `.t-ui`, feedback reasons and measurement/local explanations use `.t-body`, and trend/KPI gaps remain deferred until server-owned read models exist.

The first 27 directly mounted rebuilt route homes are `owner-approved`. Joshua first approved Insights Engine (`ODP-001-V1` through `V6`) and Brand & AI (`V1` through `V7`), then approved the remaining 24 original route homes as one registry batch with every documented production/data/backend exception and the Page Rewriter 62px Focus rail retained. Joshua later explicitly approved the Page Intelligence / Content Performance receiving-home bundle after its rendered TL;DR: Page Intelligence is the 27th direct mount, and Content Performance is an owner-approved folded receiver rather than another direct mount. AI Visibility is the 28th direct mount and remains `awaiting owner approval` under W3.1's embedded dedicated-home default. Final evidence for the approved set lives in the surface archives, `/tmp/asset-dashboard-codex-visual-parity/registry-final/`, `/tmp/asset-dashboard-codex-visual-parity/page-intelligence/`, and `/tmp/asset-dashboard-codex-visual-parity/content-performance/`; the consolidated decision record is `registry-final-owner-review.md`.

This settled visual approval is not yet a claim that the post-parity audit implementation is closed. Safe functionality, state, cache, overlay, AI-context, and performance repairs have landed, and the clean current all-project suite passed 2,065 files / 28,834 tests. Joshua approved the seven newly surfaced capability/semantic/design-system choices and the two measured per-file ratchets on 2026-07-11. `AUD-B1` is applied without increasing the aggregate baseline; `AUD-D1` through `AUD-D7` execute under the owner-closure plan.

The historical Wave 2 checkpoint used Engine only as a behavior-safety reference, not an owner-approved visual rubric. Its old `behavior-safe / visual-unverified` classifications for Content Pipeline, SEO Editor, and Site Audit are superseded by their source-led correction and 2026-07-10 owner-approval records.

Wave 3 corrects Search & Traffic, focus, and the media repair loop. Search performance is now the bare-route default with exactly three visible reports; `?lens=overview` remains a hidden cross-source receiver, and Demand mix plus Priority insights have a lower Search report home. Page Rewriter consumes one controlled shell focus bridge and preserves its loaded editor and `pageUrl` through enter, exit, and Escape. Performance and Site Audit now send canonical filter-only Asset Manager URLs. Asset Manager is one Browse workshop with no peer lenses: Repair results opens Audit once in-flow, Upload opens once in a Drawer, and legacy receiver/detail states remain exact-once. Browser state is recorded in `/tmp/asset-dashboard-codex-parity-captures/wave3-search-focus-smoke-state.json`.

Token compliance is necessary but not sufficient. The compact `PageHeader` default remains title `.t-h2` / 22px and subtitle `.t-caption-sm` / 13.5px with unchanged DOM/classes. The earlier `ODP-010 C` 28px Performance pilot was rechecked against the actual source and proved too tall; Performance returned to the compact shared header. No broader `rebuilt-admin` header migration is authorized, and every surface remains governed by its own source-led composition review.

Post-calibration desktop smoke evidence lives in:

- `/tmp/asset-dashboard-codex-parity-captures/post-typography-cockpit-desktop-overview.png`
- `/tmp/asset-dashboard-codex-parity-captures/post-typography-brand-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/post-typography-performance-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/post-typography-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/shell-typography-command-center-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/shell-typography-styleguide-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/search-traffic-typography-role-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/seo-editor-typography-role-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/site-audit-typography-role-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/engine-trust-spine-preview-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/engine-trust-spine-preview-scrolled-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/content-pipeline-published-proof-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/content-pipeline-published-proof-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/competitors-alert-feed-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/competitors-alert-feed-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/competitors-alert-feed-drawer-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-typography-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-typography-loaded-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-typography-export-open.png`
- `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-typography-loaded-mobile.png`
- `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-rank-profile-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-visibility-deeplink.png`
- `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-setup-drawer.png`
- `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-rank-profile-mobile.png`
- `/tmp/asset-dashboard-codex-parity-captures/media-source-proof-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/media-source-proof-browse-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/keywords-typography-role-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/keywords-typography-rankings-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/keywords-typography-drawer-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/schema-typography-role-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/schema-typography-guide-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/schema-typography-drawer-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/performance-typography-role-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/performance-typography-weight-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/performance-typography-weight-drawer-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/performance-typography-speed-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/links-typography-role-smoke-state.json`
- `/tmp/asset-dashboard-codex-parity-captures/links-typography-redirects-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/links-typography-internal-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/links-typography-dead-drawer-desktop.png`
- `/tmp/asset-dashboard-codex-parity-captures/links-typography-architecture-desktop.png`

The smoke confirms `.t-body` at 15.5px, `.t-ui`/`.t-caption`/`.t-caption-sm` at 13.5px, no horizontal overflow, and no internal rebuild/migration labels across the calibrated desktop routes. Shared-shell smoke on Command Center confirms `NavGroup` headers at `.t-label`/11.5px, breadcrumbs at `.t-ui`/13.5px, and no substantive visible text below 13px outside true label/mono/initial cases. Schema smoke captured the guide deep link and one page-detail Drawer with live `.t-body` workflow samples, `.t-ui` action/safeguard rows, exactly one dialog, no internal labels, and no overflow on desktop plus a light mobile guide check. Wave 2 smoke adds Content Pipeline Board/Intake/capacity/Guide, SEO Editor's 503-row grouped worksheet/selection/Research Drawer, and Site Audit's two-mode/evidence/History/Schedule states with clean overflow and console results. Insights Engine's current smoke covers the single-spine overview, anchored Signals/Moves/Operations receivers, one projection control, one move Drawer, one Add Recommendation modal, collapsed default operations, no internal labels, no horizontal overflow, and a clean console; Competitors alert-feed smoke captured the prototype-style alert list plus the existing detail Drawer with no overflow/internal labels and exactly one dialog; Page Rewriter smoke captured the loaded two-pane workspace, shell focus enter/exit/Escape, export menu, and light mobile loaded state with one editor, no skeleton, no overflow, no internal labels, and Save draft / Publish rewrite still absent; Local Presence smoke captured rank/profile, legacy visibility deep link, setup drawer, and light mobile states with live `.t-body`/`.t-ui` samples and no internal labels or horizontal overflow; Asset Manager smoke captured the single Browse workshop, canonical repair filter, in-flow Repair results, Upload Drawer, and asset detail Drawer with exact-once mounts, no peer lenses, no internal labels, and no horizontal overflow; Keyword Hub smoke captured Rankings plus a row-click detail drawer with live measurement context at `.t-body`, no internal labels, and no horizontal overflow; Performance smoke captured Page Weight overview, Page Weight drawer, PageSpeed deep link, canonical repair handoff, and the now-superseded rebuilt-admin header pilot; Links smoke captured Redirects, Internal Links, Dead Links drawer, Architecture, and light mobile Internal Links states with measured-outcome and dead-link repair guidance at `.t-body`. Keyword Hub's client feedback, SERP proof, local proof role samples, Performance's PageSpeed score-context sample, and Links' optional redirect/internal/architecture instruction samples are component-test evidence because the populated browser states did not include those optional slices. Local preview console noise was limited to Vite WebSocket disconnect warnings, route-change-aborted intelligence refreshes, notification fetch noise when the backend stack was not attached, and a favicon/resource 404.

The preceding Insights Engine clause describes the historical behavior-checkpoint smoke. Final owner-approved paired and interior-state evidence is under `/tmp/asset-dashboard-codex-visual-parity/insights/final-approved-pass/`; it has no React page error or horizontal overflow at 1440×900, 1600×1000, or the 390×844 floor. The separately classified Lost visibility request still returns `401` and remains the owner-approved `ODP-001-V6` backend exception.
