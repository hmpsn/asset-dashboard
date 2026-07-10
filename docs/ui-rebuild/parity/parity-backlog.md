# Prototype Parity Backlog

Backlog is ordered by trust risk. Behavior mismatch comes before capability risk, and capability risk comes before visual polish.

Accepted owner directions, circle-back triggers, and remaining risks are tracked in `docs/ui-rebuild/parity/owner-decision-packet.md`.

## P0

1. Rebuilt shell mobile rail squeeze
   - Status: done for the current Cockpit fixture set.
   - Reason: Cockpit mobile smoke showed the full desktop sidebar squeezing the page into an unusable column. The regenerated smoke then exposed a second Cockpit header squeeze, where the client-context line wrapped into vertical word fragments beside the toolbar.
   - Verification: component test covers compact rail plus mobile navigation drawer without changing saved desktop preference. Browser capture `/tmp/asset-dashboard-codex-parity-captures/cockpit-mobile-viewport-fixed.png` shows the loaded mobile Cockpit with compact rail, readable context header, no skeleton, and no horizontal overflow.

## P1

2. Insights Engine single-spine correction
   - Status: calibration accepted for the parity-worker rubric. Joshua and seven fresh Sol review rounds returned `revise`, all recorded findings are corrected, and a final independent Sol Ultra review returned `PASS`. Owner visual re-review remains an open circle-back.
   - Reason: The visible top-level lenses were the original behavior mismatch. The first single-spine implementation fixed that IA but still read as production panels stacked together, triggering the accepted `ODP-001` visual circle-back.
   - Deliverable: current branch now preserves `?lens=` as section focus/open state, uses the prototype's 1180px spine and compact client eyebrow, moves change history above the verdict, expands it for direct and in-place `?lens=changes`, distinguishes comparison errors from empty history, uses a hero value-at-stake cell and four-metric frame, applies prototype POV/signal/move labels, renders a truthfully proportional four-group 34px stance, limits Signals to four initial rows, limits Backing moves to one initial row per archetype with actions stacked until `xl`, filters the unified projection shell to the staged-and-sendable set, renders a locally light horizontal client proof preview, and keeps the canonical operations disclosure available even before strategy generation. Add Recommendation, read-only detail for every move type, truthful bulk Stage, staged-set send, local setup, legacy redirects, and all owning-surface handoffs remain reachable exactly once; cannibalization write controls live only under Operations, keeper state is query-authoritative with optimistic rollback, and discussion attention opens the honest move-review workflow. Do not mark visually accepted until Joshua re-reviews this pass.

3. Content Pipeline lifecycle-board correction
   - Status: `ODP-002 C` Board-first slice implemented, browser-smoked, integration-gated, and independently accepted; item-backed Brief/Draft workspaces and capacity drawer remain later slices.
   - Reason: The prototype is a lifecycle board with Intake, active work columns, mode controls, Brief/Draft workspaces, Published readback, and subscription drawer behavior. The rebuilt surface still uses top-level tab receivers that mount legacy panels inline.
   - Deliverable: bare/default now opens the four-column lifecycle Board with expandable Intake; five prototype modes replace eight receiver peers; aggregate launchers keep existing Briefs/Posts workspaces reachable exactly once; aliases, post state, fix context, Guide, Published proof, and a11y stay green. Full item workspaces and the capacity drawer remain deferred.

4. SEO Editor phased workbench correction
   - Status: `ODP-003 C` source-grouping slice implemented, browser-smoked, integration-gated, and independently accepted; inline editing/review queue remain deferred.
   - Reason: The prototype is a source-grouped write-target workbench with inline spreadsheet editing, page-intelligence detail, sticky selected-row actions, and a keyboard `Review pending` queue. The rebuilt surface preserves the source/write workflows, but still uses a table + drawer shell and lacks the queue.
   - Deliverable: Static, CMS, and Manual rows now render in explicit workbench groups while preserving one existing selected-row action region, exact write semantics, every URL param, and the Detail Drawer. No Approve/Publish/inline-edit/review-queue semantics were added.

5. Site Audit diagnostic-lens demotion
   - Status: `ODP-004 A` implemented, browser-smoked, integration-gated, and independently accepted.
   - Reason: The prototype has `Site Audit` and `History` as visible sub-tabs, while the rebuilt surface exposes `AI Search Ready`, `Content Health`, and `Guide` as peer lenses. The core audit workflow is present, but the top-level IA gives diagnostic evidence equal weight.
   - Deliverable: only Site Audit and History remain visible peers; AI Search Ready, Content Health, and Audit Guide now live in one evidence group and their `?sub=` compatibility URLs open the intended disclosure without replacing the audit console.

6. Analytics Hub Search-default correction
   - Status: `ODP-005 A + C` accepted; Search performance default and Overview content rehome approved.
   - Reason: The prototype's per-client default is `Search performance` with `Site traffic` and `Annotations` as the other report modes. The rebuilt surface still defaults to a peer `Overview` lens that preserves cross-source trend, Demand mix, and Priority insights from the current product.
   - Deliverable: default `/analytics-hub` to Search performance, preserve `?lens=overview`, and give Demand mix/Priority insights explicit lower-band or Insights Engine homes before removing the visible Overview peer.

7. Media phased single-workshop correction
   - Status: `ODP-006 C` accepted; Browse-default, toolbar Upload, and compact Audit correction approved.
   - Reason: The prototype is a single Asset Manager workshop with filters and bulk repair actions as the navigation surface. The rebuilt surface keeps Browse, Audit, and Upload as peer lenses, which preserves live production capabilities but does not match the prototype IA.
   - Deliverable: phase Browse/Audit/Upload into one workshop while preserving `?tab=audit`, `?tab=upload`, `filter`, `search`, `view`, `sort`, and `asset` as compatibility state; prove the Performance/Site Audit repair handoffs before full collapse.

8. Page Rewriter focus bridge
   - Status: `ODP-007 A` accepted; shell focus bridge approved and export-only v1 retained.
   - Reason: The prototype and legacy Page Rewriter both include Focus mode, but the rebuilt shell currently has no surface-level focus-mode bridge. The prototype also shows Save draft / Publish rewrite / push-to-draft, which are new write-spine capabilities absent from the current backend.
   - Deliverable: add one sanctioned `AppShell` focus bridge without forking shell behavior; keep Save draft / Publish rewrite absent until a separately approved backend write spine exists.

9. Local Presence real-data v1
   - Status: `ODP-008 A` accepted; current real-data/manual-refresh v1 retained.
   - Reason: The prototype's local rank grid, profile views, and calls/directions require data sources that do not exist today: 49-point geo-grid scan nodes and GBP Performance API ingestion. The safe slice now keeps real current market posture, local visibility evidence, review operations, and setup drawer behavior aligned without fabricating unavailable metrics.
   - Deliverable: keep the current v1 and manual refresh controls; track geo-grid and GBP Performance as explicit backend capability work rather than frontend parity polish.

10. Brand & AI modal-first correction
   - Status: implemented and verified in this branch; generator and bespoke-flow modal interior polish added.
   - Reason: Prototype opens Brand pieces as modal workflows; current rebuilt slice uses inline active panels.
   - Deliverable: modal state, grouped context overview, no top tab strip, Voice-only Brand identity generators, `?tab=` alias preservation, generator workflow framing in the Brand identity modal, bespoke Discovery/Brandscript/Trust evidence/Business facts workflow framing, remaining Context/Voice/Strategy Intelligence workflow framing, and exact-once child panel mounting are covered by `tests/component/brand-ai-rebuilt/BrandAiSurface.test.tsx`.

11. Cockpit overlay smoke completion
   - Status: done for the current fixture set.
   - Reason: Cockpit is the calibration surface, so overview, stream, activity, and work-order states all need browser evidence before it can serve as the rubric.
   - Deliverable: desktop overview, loaded mobile overview, activity drawer, work-order modal, and `stream=send` deep-link captures now live in `/tmp/asset-dashboard-codex-parity-captures/`. Work-order smoke uses seeded `ws_demo_growth`; the default premium demo workspace has no work-order queue row.

12. Registry-wide contract packets
   - Status: current prioritized rebuilt admin surfaces have initial behavior-first contracts.
   - Reason: Behavior-first contracts now exist for the currently prioritized rebuilt admin surfaces; new rebuilt routes still need a packet before styling corrections.
   - Deliverable: keep adding one contract per surface before styling corrections as new rebuilt routes are mounted in `REBUILT_SURFACES`.

13. Rebuilt sidebar zone/color parity decision
   - Status: done for the rebuilt shell; `ODP-011` accepted 2026-07-09.
   - Reason: The prototype nav groups pages as Cockpit/Insights, Strategy & Content, Search & Site Health, Optimization, and Client-facing. The rebuilt sidebar now mirrors those zones locally while preserving route ids and global registry semantics.
   - Deliverable: `RebuiltSidebar` uses prototype zones, local sidebar labels, a rebuilt-sidebar-only Competitors item, DS-safe Optimization teal instead of prototype purple, and token-backed group/item accents. Component coverage asserts zone order, labels, keyboard navigation, disabled-route skipping, collapsed-group persistence, content-pipeline badge survival, and a11y.

14. Non-rebuilt route receiving-home mapping
   - Status: `ODP-012 B` accepted; route/nav census complete and parent-workflow mapping approved.
   - Reason: `page-intelligence` and `content-perf` are real standalone nav entries but are not in `REBUILT_SURFACES`, so they are not covered by the rebuilt parity contracts or smoke evidence. `seo-briefs`, `content`, `calendar`, and `subscriptions` are folded/redirect-only and accounted for separately.
   - Deliverable: map Page Intelligence into SEO Editor / Insights Engine and Content Perf into Content Pipeline Published / Analytics Hub during those parent contracts; preserve old route ids as receivers until staging verifies the final homes.

## P2

15. Cross-surface typography token calibration
   - Status: done for the current rebuilt-surface sweep; Cockpit, Brand & AI, Schema, Links, Performance, Search & Traffic, SEO Editor, Site Audit, Competitors, Page Rewriter, Local Presence, Asset Manager, and Keyword Hub role cleanup added. Rebuilt page-header perceived scale is tracked separately in `ODP-010`.
   - Reason: Browser inspection confirmed the rebuilt pages were using the current styleguide/app utilities, but those utilities had drifted below the token and `DESIGN_SYSTEM.md` scale. This made subtitles, banners, small controls, and body copy feel exceptionally small even when surfaces used DS classes correctly.
   - Verification: `.t-*` utility sizes in `src/index.css` and `public/styleguide.css` now match `src/tokens.css`; `tests/contract/typography-token-parity.test.ts` prevents future utility/token drift. Brand & AI, Cockpit, Schema, Links, Performance, Search & Traffic, SEO Editor, Site Audit, Competitors, Page Rewriter, Local Presence, Asset Manager, and Keyword Hub now assert important page/rail/modal/report/workbench/audit/feed/rewrite/rank-profile/source-fix/keyword-proof copy uses the right typography roles instead of raw pixel or caption-only sizing. Browser smoke evidence: `/tmp/asset-dashboard-codex-parity-captures/post-typography-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/post-typography-cockpit-desktop-overview.png`, `/tmp/asset-dashboard-codex-parity-captures/post-typography-brand-desktop.png`, `/tmp/asset-dashboard-codex-parity-captures/post-typography-performance-desktop.png`, `/tmp/asset-dashboard-codex-parity-captures/brand-ai-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/cockpit-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/schema-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/search-traffic-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/seo-editor-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/site-audit-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/competitors-alert-feed-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-typography-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/media-source-proof-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/keywords-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/performance-typography-role-smoke-state.json`, and `/tmp/asset-dashboard-codex-parity-captures/links-typography-role-smoke-state.json`.

16. Global Ops route-family capability decisions
   - Status: `ODP-009 A` and `GO-001` through `GO-008` accepted; additive shell retained with explicit revisit triggers.
   - Reason: Global Ops is a fan-out route family, not one surface. The current rebuilt shell preserves route receivers and live operator homes, but exact prototype collapse would affect Requests, Outcomes, Diagnostics, Business aliases, Workspace Settings grouping, client onboarding, and LLMs.txt ownership.
   - Deliverable: implement only the accepted additive-shell polish; revisit each `GO-*` move when its named receiving workflow or server contract exists.

17. Schema exact-card decision
   - Status: aligned enough; accepted default is the current Drawer. Safe guide polish now aligns the primary Workflow Guide phases to Scan / Review / Edit / Publish / Validate, with guide/drawer workflow explanations on `.t-body` and guide action rows on `.t-ui`.
   - Reason: The prototype uses expandable page cards, while the rebuilt surface uses the shared Drawer for heavy page review/edit/publish/history workflows.
   - Deliverable: keep Drawer detail because production publish/send/history actions stay safer there; circle back only with evidence that exact inline cards improve the workflow.

18. Links row-level Insert decision
   - Status: aligned enough; accepted default is copy/send until a real write target exists.
   - Reason: The Links prototype shows row-level `Insert` for internal-link suggestions. The rebuilt surface uses HTML copy plus client-send, which preserves real current capabilities without pretending to publish/stage a link.
   - Deliverable: keep copy/send until the write destination and mutation semantics are explicit. Safe parity polish now adds the prototype's repair-to-measured-outcome footer so Links stays framed as the workshop while proven wins graduate to Insights Engine, and maps workshop instruction copy to `.t-body` without changing compact path/crawl metadata.

19. Performance exact speed-layout decision
   - Status: aligned enough; accepted default is the current production workflow until the Asset Manager handoff is proven.
   - Reason: The Performance prototype shows inline Page Weight row expansion and side-by-side mobile/desktop PageSpeed cards for a selected page. The rebuilt surface keeps the same two-mode workflow but uses Drawer detail, single/bulk controls, a strategy selector, and saved mobile/desktop snapshot cards.
   - Deliverable: Joshua decision only if Performance needs exact prototype inline row expansion and side-by-side speed cards. Recommended default is to keep the current production workflow until Media/Asset Manager parity confirms the direct fix destination. Safe parity polish now makes the PageSpeed-to-Asset-Manager handoff visible in the workflow body without simulating direct row-level fixes.

20. Keyword Hub exact trend/KPI read models
   - Status: aligned enough; deferred data-backed polish.
   - Reason: The Keywords prototype shows inline row sparklines, 7-day rank deltas, average-position rollups, and period-over-period KPI deltas. The rebuilt pilot correctly preserves keyword workflow parity but does not fabricate those numbers client-side.
   - Deliverable: build a batched history-by-keyword read model for row trends and server-owned summary rollups/deltas before tightening those prototype visuals.

21. Visual-only polish queue
   - Status: blocked by behavior contracts.
   - Reason: Do not spend polish time until overlays, route state, and capability homes are correct.
   - Deliverable: per-surface visual punch list only after a contract passes.

## Done Criteria For A Surface

- Contract exists and names prototype references.
- Component tests cover flag transition, critical overlay, deep link, exact-once carry-over, no internal labels, and a11y.
- Browser smoke covers desktop, mobile, overlay, and deep link.
- `npm run lint:hooks`, `npm run typecheck`, `npx vite build`, and `npm run pr-check` pass for the implementation slice.
