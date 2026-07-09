# Keyword Hub Prototype Parity Contract

Surface: `seo-keywords` / Keywords  
Owner: keyword lifecycle / rank intelligence  
Status: aligned enough after pilot contract pass; exact KPI/trend polish remains deferred  
Primary route: `/ws/:workspaceId/seo-keywords`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/keywords.js`
- Phase 0 surface ledger: `docs/ui-rebuild/phase0/surfaces/keywords.md`
- Pilot data-source ledger: `docs/ui-rebuild/pilot/keywords-data-source-ledger.md`
- Pilot DoD walk: `docs/ui-rebuild/pilot/keywords-dod-walk.md`
- Bounded-context rule: `docs/rules/keyword-hub.md`
- Existing rebuilt implementation: `src/components/keywords-rebuilt/KeywordsSurface.tsx`
- Lens/body implementation: `src/components/keywords-rebuilt/KeywordsLenses.tsx`
- Table and bulk actions: `src/components/keywords-rebuilt/KeywordsTable.tsx`
- Detail drawer: `src/components/keywords-rebuilt/KeywordDrawer.tsx`
- URL state receiver: `src/components/keywords-rebuilt/useKeywordsSurfaceState.ts`
- Current component test: `tests/component/keywords-rebuilt/KeywordsSurface.test.tsx`

## Required Interaction Model

The prototype is a unified Keywords surface with five operator lenses:

1. `Rankings` — keyword rows with rank, change/trend intent, volume, and ranking page context.
2. `Opportunities` — upside-focused rows with score, estimated gain, and a recommended fix.
3. `Pages` — keyword groups by ranking page, with cannibalization risk called out.
4. `Clusters` — topic-cluster grouping.
5. `Lifecycle` — stage board for discovered, targeted, published, ranking, and winning keywords.

Prototype-critical behavior:

- The page opens as `Rankings` by default.
- Lens switching is the primary view switcher, not a replacement for lifecycle/status filters.
- Search and filter controls stay above the working set.
- Row, grouped-card, and board-card selection opens a keyword detail drawer.
- The drawer shows rank, opportunity, difficulty, page/cluster context, lifecycle action, SERP/editor handoff, and local-intent handoff.
- Client keyword feedback lives on the Keywords page with requested/declined/approved direction and an `Add to strategy` action.

## Current Parity Grade

Grade: `aligned enough`.

Why:

- The rebuilt pilot already implements all five prototype lenses with `LensSwitcher`.
- `Rankings` and `Opportunities` use distinct table shapes, so the opportunity workflow is not just a re-sorted rankings grid.
- `Pages`, `Clusters`, and `Lifecycle` use grouped/board layouts and open the same detail drawer from cards.
- The detail drawer preserves the prototype's per-keyword open state while carrying production evidence: source, outcome, local visibility, live SERP, protection, pinning, hard delete, and all server-provided next actions.
- The route preserves the existing Hub contracts: `?lens=`, `?filter=`, `?search=`, `?page=`, `?pageSize=`, `?sort=`, `?direction=`, legacy `?tab=` segment links, and `?q=` drawer deep links.
- Component tests already prove flag-on shell mount, URL/deep-link behavior, drawer behavior, grouped lenses, bulk actions, feedback action, live invalidation, loading/error/locked states, no fabricated money, and the rebuilt a11y floor.

Intentional divergence from prototype:

- The prototype omits multi-select, bulk lifecycle operations, protected keywords, hard delete eligibility, pinning, live SERP evidence, local market evidence, and full mutation feedback. These remain visible because they are production safety/capability contracts, not visual embellishments.
- The prototype shows inline row sparklines and 7-day deltas; the rebuilt surface keeps trend evidence in the drawer until a batched history read model exists.
- The prototype's average-position and period-over-period summary KPIs are deferred until server-owned rollups/deltas exist. Do not compute or imply those numbers in the UI.
- The prototype banner says Keywords replaces Page Intelligence. The locked pilot decision says Page Intelligence authoring/scoring belongs in SEO Editor Research mode; in Keywords, `Pages` is lightweight grouping only.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/seo-keywords` opens `Rankings`.
- `?lens=rankings|opportunities|pages|clusters|lifecycle` opens the matching rebuilt lens.
- `?tab=` remains the cross-surface Hub segment/filter receiver. Legacy segment values are treated as filters, not lenses.
- Switching `?lens=` preserves an inbound `?tab=` filter.
- `?q=<keyword>` opens the keyword detail drawer on mount.
- `filter`, `search`, `page`, `pageSize`, `sort`, and `direction` remain validated URL-backed row-query state.

Compatibility requirements:

- Preserve route id `seo-keywords`.
- Preserve the Hub deep-link sender/receiver helpers.
- Preserve the `local_candidates` initial-view exception: that filter must bypass the combined initial view and use the skinny local-candidate rows path.
- Do not add backend APIs, migrations, shared types, route ids, or feature flags for visual alignment in this contract pass.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Summary, rows, detail, and fallback reads from the keyword command-center endpoints.
- Skinny initial view for normal first paint and skinny local-candidate projection for `local_candidates`.
- Search, primary filters, advanced filters, sort controls, pagination, and display-cap honesty.
- Keyword rows with lifecycle status, intent, rank, clicks, volume, difficulty, opportunity, value, provenance badges, and local posture.
- Multi-select and bulk lifecycle actions with protected-row confirmation and result feedback.
- Manual keyword add.
- Detail drawer opened from row/card click and `?q=`.
- Server-provided next actions, including SEO Editor and Content Pipeline handoffs.
- Hard-delete channel for eligible manual rows only.
- Protected keyword explanation and force-confirm flow.
- Outcome readback, value reasons, source labels, rank history, pin/unpin, live SERP / AI Overview evidence, local visibility evidence, and local/national refresh controls.
- Client keyword feedback panel and `Add to strategy` action.
- Workspace events for `RANK_TRACKING_UPDATED`, `SERP_SNAPSHOTS_REFRESHED`, and `STRATEGY_UPDATED`.

## Deferrals And Owner Decisions

Owner-decision / deferred items:

- `DEF-kw-001`: Inline row sparkline and 7-day rank delta require a batched history-by-keyword read model. Recommended default: keep trend in the drawer until the read model exists.
- `DEF-kw-002`: Average-position, winning delta, and period-over-period KPI variants require server-owned rollups/deltas. Recommended default: keep the current count/value KPIs and do not compute these client-side.
- Exact prototype `Intent` / `Stage` toolbar filters remain deferred because the current server filter taxonomy is broader and protects real lifecycle/local/client-feedback workflows.
- Exact SERP external-link button remains optional; current production evidence and refresh controls already preserve the paid SERP workflow.

Judgment call made in this pass:

- Replaced visible empty-value/internal wording in the rebuilt drawer and permission state: missing money now renders as `—`, the fallback drawer subtitle is `Keyword detail`, empty provenance says `No sources linked`, and locked access copy no longer says `command-center`. These are local, reversible copy alignments with the prototype's user-facing vocabulary.
- Let the add-keyword header controls wrap under the page title on mobile. Browser smoke found the shared header row squeezing `Keywords` to a zero-width text box at 390px; this local class adjustment keeps the desktop header row while making the mobile title visible.
- Promoted important evidence/client-direction copy out of caption-only roles: client feedback keywords use `.t-ui`, feedback reasons and measurement disclosures use `.t-body`, and drawer SERP/local evidence uses `.t-ui` / `.t-body`. This is a styleguide-role alignment only; it does not change the deferred trend/KPI data model decisions.

## Browser Smoke Evidence

Smoke states captured:

- Desktop empty overview: `/tmp/asset-dashboard-codex-parity-captures/keywords-smoke-demo-overview.png` from `/ws/ws_demo_premium/seo-keywords`.
- Desktop empty Opportunities deep link: `/tmp/asset-dashboard-codex-parity-captures/keywords-smoke-demo-opportunities.png` from `/ws/ws_demo_premium/seo-keywords?lens=opportunities`.
- Populated Clusters lens: `/tmp/asset-dashboard-codex-parity-captures/keywords-smoke-populated-clusters.png` from `/ws/ws_2ceaeb6c-0820-4da5-941e-ad9eae643993/seo-keywords?lens=clusters`.
- Populated drawer deep link: `/tmp/asset-dashboard-codex-parity-captures/keywords-smoke-populated-drawer.png` from `/ws/ws_2ceaeb6c-0820-4da5-941e-ad9eae643993/seo-keywords?q=dental+marketing+sarasota+fl`.
- Mobile empty overview: `/tmp/asset-dashboard-codex-parity-captures/keywords-smoke-demo-mobile.png` at 390px from `/ws/ws_demo_premium/seo-keywords`.
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/keywords-smoke-state.json`.
- Typography-role smoke state: `/tmp/asset-dashboard-codex-parity-captures/keywords-typography-role-smoke-state.json`.
- Typography-role desktop Rankings capture: `/tmp/asset-dashboard-codex-parity-captures/keywords-typography-rankings-desktop.png`.
- Typography-role drawer capture: `/tmp/asset-dashboard-codex-parity-captures/keywords-typography-drawer-desktop.png`.

Result:

- No blank page or blank lens body.
- No duplicate detail drawer/panel.
- No horizontal page overflow.
- No visible internal rebuild/migration labels.
- No fabricated money values such as `$0` or `No CPC`.
- No console errors or failed local 400/500 responses.
- Mobile title is visible after the header wrapping fix.
- Browser smoke captures Rankings plus a row-click detail drawer with live measurement context at `.t-body`, no internal labels, and no horizontal overflow. Component tests cover the optional client feedback, live SERP proof, top local-result evidence, and local visibility explanation role samples because the populated browser row selected for smoke did not include those optional evidence slices.

## Automated Test Floor

Current branch coverage proves:

- `?lens=`, `?filter=`, `?search=`, `?page=`, and `?q=` initialize the rebuilt surface and drawer.
- Legacy `?tab=` segment links are preserved as filters and survive lens switching.
- `local_candidates` uses the rows path rather than the combined initial view.
- Rows render provenance, local posture, opportunity, display-only money, display cap, and metric-window disclosure.
- `Opportunities` has its own `Est. gain` and `Fix` shape.
- Sort, pagination, add keyword, advanced filters, select-visible, and client feedback actions work.
- All five lenses render and keep the rebuilt a11y floor.
- Detail drawer opens from row click and `?q=`, carries value/provenance/outcome/local/SERP context, and avoids old internal empty labels.
- Client feedback, metric-window disclosure, SERP proof, and local evidence carry styleguide typography-role assertions.
- Workspace events invalidate the keyword command-center query prefix.
- Loading shimmers avoid zero-value metrics; empty, filtered-empty, stale-error, and locked states are action-oriented.
- Hard delete, protected bulk confirmation, and non-protected bulk actions remain covered.
- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts the rebuilt shell without the legacy Keyword Hub.
