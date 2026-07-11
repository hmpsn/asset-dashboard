# Prototype Parity Backlog

Backlog is ordered by the active surface sequence and trust risk. A technically safe behavior checkpoint remains `behavior-safe / visual-unverified` until Joshua explicitly approves its paired desktop comparison or an exception.

Accepted owner directions, circle-back triggers, and remaining risks are tracked in `docs/ui-rebuild/parity/owner-decision-packet.md`.

## P0

1. Rebuilt shell mobile rail squeeze
   - Status: `owner-approved`; the corrected Cockpit passes the desktop comparison and mobile usability floor.
   - Reason: Cockpit mobile smoke showed the full desktop sidebar squeezing the page into an unusable column. The regenerated smoke then exposed a second Cockpit header squeeze, where the client-context line wrapped into vertical word fragments beside the toolbar.
   - Verification: component test covers compact rail plus mobile navigation drawer without changing saved desktop preference. Browser capture `/tmp/asset-dashboard-codex-parity-captures/cockpit-mobile-viewport-fixed.png` shows the loaded mobile Cockpit with compact rail, readable context header, no skeleton, and no horizontal overflow.

## P1

2. Insights Engine single-spine correction
   - Status: `owner-approved`. Joshua approved `ODP-001-V1` through `ODP-001-V6` as recommended on 2026-07-10; V1–V3 are implemented and V4–V6 are explicit exceptions.
   - Reason: The visible top-level lenses were the original behavior mismatch. The first single-spine implementation fixed that IA but still read as production panels stacked together, triggering the accepted `ODP-001` visual circle-back.
   - Deliverable: complete. The branch preserves `?lens=` as section focus/open state, uses the prototype's 1180px spine and compact client eyebrow, moves change history above the verdict, expands it for direct and in-place `?lens=changes`, distinguishes comparison errors from empty history, uses a hero value-at-stake cell and four-metric frame, applies prototype POV/signal/move labels, renders a truthfully proportional four-group 34px stance, limits Signals to four initial rows, limits Backing moves to one initial row per archetype, filters the unified projection shell to the staged-and-sendable set, renders a locally light horizontal client proof preview, and keeps the canonical operations disclosure available even before strategy generation. V1 adds the compact POV/full-editor Drawer; V2 portals actions exact-once to the rebuilt topbar; V3 keeps Details/Stage inline and discloses Edit/Fix/Park. Final paired/interior evidence passed fresh Sol review with no safe-local defects.

3. Content Pipeline lifecycle-board correction
   - Status: `owner-approved`; corrected Board and every important workspace/lens state passed fresh Sol review and owner approval on 2026-07-10.
   - Reason: The behavior-first Board preserved capabilities, but five opening KPIs and one aggregate launcher per stage still replace the prototype's real-card lifecycle and focused workspaces.
   - Deliverable: complete and owner-approved. Compact capped composition; truthful deduplicated request/brief/post cards; full-screen blank/filled Brief and `?post=` Draft/Review workspaces; 440px capacity Drawer; compact secondary lenses; exact-once production actions/aliases; explicit unsupported-action exceptions. Evidence: `/tmp/asset-dashboard-codex-visual-parity/content-pipeline/final-pass2/`.

4. SEO Editor phased workbench correction
   - Status: `owner-approved`; corrected default, selected, 600/860px Research, Manual, and mobile states passed fresh Sol review and owner approval on 2026-07-10.
   - Reason: The mounted prototype is the full-width source-grouped sheet; its dead Edit/Research toggle and unsupported keyboard queue are not valid visual or behavior authorities.
   - Deliverable: complete and owner-approved. Inline Static/CMS title/meta fields, read-only Manual rows, compact source/collection/quick filters, mutually exclusive missing/selected bands, truthful leading source checkboxes, and 600/860px Research Drawer preserve every existing URL and write contract. Review-queue semantics remain an explicit future-workflow exception.

5. Site Audit diagnostic-lens demotion
   - Status: `owner-approved`; the source-led 1120px audit decision spine and important interior states passed fresh Sol review and owner approval on 2026-07-10.
   - Reason: The prototype has `Site Audit` and `History` as visible sub-tabs, while the rebuilt surface exposes `AI Search Ready`, `Content Health`, and `Guide` as peer lenses. The core audit workflow is present, but the top-level IA gives diagnostic evidence equal weight.
   - Deliverable: only Site Audit and compact History remain visible peers; hero, categories, CWV, utility, bulk, Broken Links, and issues follow prototype order. AI Search Ready, Content Health, and Audit Guide remain exact-once: deep links open the group after CWV, while bare Audit keeps the collapsed group below the primary repair flow.

6. Analytics Hub Search-default correction
   - Status: `owner-approved`; the source-led 1120px report composition and important interior states passed fresh Sol review and owner approval on 2026-07-10.
   - Reason: The prototype's per-client default is `Search performance` with `Site traffic` and `Annotations` as the other report modes. The prior rebuilt surface instead defaulted to a peer `Overview` lens that preserved cross-source trend, Demand mix, and Priority insights from the current product.
   - Deliverable: bare `/analytics-hub` now defaults to Search performance with exactly three visible reports; `?lens=overview` remains a hidden compatibility receiver; Demand mix and Priority insights live in a shared lower Search report band and mount exactly once, including truthful unconfigured/empty/error GSC states. The corrected canvas, compact report/date chrome, narrative hierarchy, Search/Traffic section order, and contextual Annotations timeline match the prototype without inventing proof-stage or provider data. Annotations remains usable without analytics providers and branded data uses blue.

7. Media phased single-workshop correction
   - Status: `owner-approved`; the source-led 1180px workshop and important interior states passed fresh Sol review and owner approval on 2026-07-10.
   - Reason: The prototype is a single Asset Manager workshop with filters and bulk repair actions as the navigation surface. The prior rebuilt surface kept Browse, Audit, and Upload as peer lenses, which preserved live production capabilities but did not match the prototype IA.
   - Deliverable: Browse is always rendered with no peer lenses; four metrics, source proof, compact controls, 132px cards, and contextual two-action cards match the prototype. Repair results opens once as the first actionable area above Browse controls/grid; Upload opens once in the shared Drawer; valid asset detail still wins overlay precedence.

8. Page Rewriter focus bridge
   - Status: `owner-approved`; the full source-led correction, export-only v1, and retained 62px Focus rail were approved on 2026-07-10.
   - Reason: The prototype and legacy Page Rewriter both include Focus mode, but the rebuilt shell currently has no surface-level focus-mode bridge. The prototype also shows Save draft / Publish rewrite / push-to-draft, which are new write-spine capabilities absent from the current backend.
   - Deliverable: complete and owner-approved. One controlled `AppShell` focus bridge reaches Page Rewriter, preserves loaded `pageUrl`/editor state, and exits through Escape; Save draft / Publish rewrite remain absent until a separately approved backend write spine exists. The retained 62px collapsed rail in Focus is approved.

9. Local Presence real-data v1
   - Status: `owner-approved`; `ODP-008 A` retains the real-data/manual-refresh v1, and the corrected desktop composition was approved on 2026-07-10.
   - Reason: The prototype's local rank grid, profile views, and calls/directions require data sources that do not exist today: 49-point geo-grid scan nodes and GBP Performance API ingestion. The safe slice now keeps real current market posture, local visibility evidence, review operations, and setup drawer behavior aligned without fabricating unavailable metrics.
   - Deliverable: complete and owner-approved; keep the corrected v1 and manual refresh controls, and track geo-grid and GBP Performance as explicit backend capability work rather than frontend parity polish.

10. Brand & AI modal-first correction
   - Status: `owner-approved` on 2026-07-10; V1–V7 are the accepted decisions and exceptions, with finer feedback deferred to the registry-wide pass.
   - Reason: The source-led pass restores the prototype's modal-first grouped cockpit while retaining truthful production editors, actions, URLs, and exact-once capability homes.
   - Deliverable: all 17 generators render exactly once in the source-exact 7 / 2 / 5 / 3 group mapping; Identity and Brandscript have focused receivers; every Brand workflow uses the approved 680px modal; truthful production interiors and V5–V7 exceptions remain explicit. The 218-test floor, final browser evidence in `/tmp/asset-dashboard-codex-visual-parity/brand-ai/final-v1-v7/`, and a fresh Sol `PASS` support Joshua's visual approval.

11. Cockpit overlay smoke completion
   - Status: `owner-approved`; corrected overview, Activity Drawer, work-order overlay, mobile floor, and Risk receiver passed fresh Sol review and owner approval on 2026-07-10.
   - Reason: Cockpit is the calibration surface, so overview, stream, activity, and work-order states all need browser evidence before it can serve as the rubric.
   - Deliverable: the source-led 1168px spine, compact context/topbar, verdict hero, stream band, 702/434 work/evidence split, and weekly evidence order are captured at both required desktop viewports under `/tmp/asset-dashboard-codex-visual-parity/batch8/cockpit/`. Activity and work-order overlays mount exactly once. Prototype-only Send update and Promote-to-signal controls remain explicit unsupported/deferred exceptions rather than simulated actions.

12. Registry-wide contract packets
   - Checkpoint: current prioritized rebuilt admin surfaces have initial behavior contracts.
   - Reason: Behavior-first contracts now exist for the currently prioritized rebuilt admin surfaces; new rebuilt routes still need a packet before styling corrections.
   - Deliverable: keep adding one contract per surface before styling corrections as new rebuilt routes are mounted in `REBUILT_SURFACES`.

13. Rebuilt sidebar zone/color parity decision
   - Checkpoint: rebuilt-shell behavior direction `ODP-011` was accepted 2026-07-09 and the full mounted registry was owner-approved on 2026-07-10.
   - Reason: The prototype nav groups pages as Cockpit/Insights, Strategy & Content, Search & Site Health, Optimization, and Client-facing. The rebuilt sidebar now mirrors those zones locally while preserving route ids and global registry semantics.
   - Deliverable: `RebuiltSidebar` uses prototype zones, local sidebar labels, a rebuilt-sidebar-only Competitors item, DS-safe Optimization teal instead of prototype purple, and token-backed group/item accents. Component coverage asserts zone order, labels, keyboard navigation, disabled-route skipping, collapsed-group persistence, content-pipeline badge survival, and a11y.

14. Non-rebuilt route receiving-home mapping
   - Checkpoint: complete under accepted `ODP-012 B`; source, live-fixture, API, job, route, and deep-link proof now defines both exceptions.
   - Reason: `page-intelligence` and `content-perf` are real standalone nav entries but are not in `REBUILT_SURFACES`, so they are not covered by the rebuilt parity contracts or smoke evidence. `seo-briefs`, `content`, and `calendar` are folded/redirect-only; `/subscriptions` is a preserved standalone legacy receiver while `content-pipeline?tab=subscriptions` is the folded query alias.
   - Deliverable: preserve both standalone route ids. Page Intelligence remains standalone because SEO Editor omits a strategy-only page in the Rinse fixture and does not receive its analysis job, research, keyword edit, rank tracking, local evidence, fix queue, Guide, or handoffs. Content Pipeline Published remains the future Content Performance receiver only after restoring impressions/sessions and impressions trend, adding item URL initialization, replacing the unsupported refresh POST, handling matrix trend honestly, making routing flag-aware, and proving a populated fixture.

## P2

15. Cross-surface typography token calibration
   - Checkpoint: rebuilt-surface role cleanup is implemented and owner-approved. The historical 28px Performance `ODP-010 C` pilot was superseded by the source-led compact shared header; no broader variant migration is authorized.
   - Reason: Browser inspection confirmed the rebuilt pages were using the current styleguide/app utilities, but those utilities had drifted below the token and `DESIGN_SYSTEM.md` scale. This made subtitles, banners, small controls, and body copy feel exceptionally small even when surfaces used DS classes correctly.
   - Verification: `.t-*` utility sizes in `src/index.css` and `public/styleguide.css` now match `src/tokens.css`; `tests/contract/typography-token-parity.test.ts` prevents future utility/token drift. Brand & AI, Cockpit, Schema, Links, Performance, Search & Traffic, SEO Editor, Site Audit, Competitors, Page Rewriter, Local Presence, Asset Manager, and Keyword Hub now assert important page/rail/modal/report/workbench/audit/feed/rewrite/rank-profile/source-fix/keyword-proof copy uses the right typography roles instead of raw pixel or caption-only sizing. Browser smoke evidence: `/tmp/asset-dashboard-codex-parity-captures/post-typography-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/post-typography-cockpit-desktop-overview.png`, `/tmp/asset-dashboard-codex-parity-captures/post-typography-brand-desktop.png`, `/tmp/asset-dashboard-codex-parity-captures/post-typography-performance-desktop.png`, `/tmp/asset-dashboard-codex-parity-captures/brand-ai-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/cockpit-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/schema-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/search-traffic-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/seo-editor-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/site-audit-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/competitors-alert-feed-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-typography-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/local-seo-typography-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/media-source-proof-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/keywords-typography-role-smoke-state.json`, `/tmp/asset-dashboard-codex-parity-captures/performance-typography-role-smoke-state.json`, and `/tmp/asset-dashboard-codex-parity-captures/links-typography-role-smoke-state.json`.

16. Global Ops route-family capability decisions
   - Status: `owner-approved`; all 11 route homes were approved on 2026-07-10 while `ODP-009 A` and `GO-001` through `GO-008` preserve the explicit capability constraints.
   - Reason: Global Ops is a fan-out route family, not one surface. The current rebuilt shell preserves route receivers and live operator homes, but exact prototype collapse would affect Requests, Outcomes, Diagnostics, Business aliases, Workspace Settings grouping, client onboarding, and LLMs.txt ownership.
   - Deliverable: complete and owner-approved; revisit each `GO-*` move only when its named receiving workflow or server contract exists. Final evidence is grouped under `/tmp/asset-dashboard-codex-visual-parity/batch8/global/`.

17. Schema exact-card decision
   - Status: `owner-approved`; the corrected 1080/1020 Generator and five-row Guide were approved on 2026-07-10, with the current Drawer retained as the explicit production exception.
   - Reason: The prototype uses expandable page cards, while the rebuilt surface uses the shared Drawer for heavy page review/edit/publish/history workflows.
   - Deliverable: keep Drawer detail because production publish/send/history actions stay safer there; circle back only with evidence that exact inline cards improve the workflow.

18. Links row-level Insert decision
   - Status: `owner-approved`; the corrected 1120/1060 four-lens workshop was approved on 2026-07-10, with copy/send retained until a real write target exists.
   - Reason: The Links prototype shows row-level `Insert` for internal-link suggestions. The rebuilt surface uses HTML copy plus client-send, which preserves real current capabilities without pretending to publish/stage a link.
   - Deliverable: keep copy/send until the write destination and mutation semantics are explicit. Safe parity polish now adds the prototype's repair-to-measured-outcome footer so Links stays framed as the workshop while proven wins graduate to Insights Engine, and maps workshop instruction copy to `.t-body` without changing compact path/crawl metadata.

19. Performance exact speed-layout decision
   - Status: `owner-approved`; the source-led 1080px Page Weight/Page Speed composition was approved on 2026-07-10.
   - Reason: The prototype shows inline Page Weight expansion and paired mobile/desktop PageSpeed cards. The corrected surface implements the paired selected-page spine while retaining production Drawers, Single/Bulk, and full evidence.
   - Deliverable: metrics-first Page Weight with dense rows and one Asset handoff; selected-page paired Mobile/Desktop PageSpeed cards; mutually exclusive Single/Bulk bodies; Top-N only in Bulk; workspace/site/page state isolation. Drawer detail and unsupported direct fixes remain explicit exceptions.

20. Keyword Hub exact trend/KPI read models
   - Status: `owner-approved`; the corrected 1128px five-lens workbench was approved on 2026-07-10, while the data-backed trend/KPI exceptions remain deferred.
   - Reason: The Keywords prototype shows inline row sparklines, 7-day rank deltas, average-position rollups, and period-over-period KPI deltas. The rebuilt pilot correctly preserves keyword workflow parity but does not fabricate those numbers client-side.
   - Deliverable: build a batched history-by-keyword read model for row trends and server-owned summary rollups/deltas before tightening those prototype visuals.

21. Competitors provider-state evidence
   - Status: `owner-approved`; the corrected 1120/1060 single-stack composition and honest provider setup state were approved on 2026-07-10.
   - Reason: The local Rinse workspace has saved competitor domains but no configured DataForSEO provider, so a live browser cannot truthfully display the populated Alerts / Share of Voice / Head-to-head / Keyword gaps / Backlinks stack.
   - Deliverable: keep the real setup state in live evidence and protect the complete populated composition with realistic component fixtures; do not invent provider results for a screenshot.

22. Visual-only polish queue
   - Checkpoint: complete for the mounted registry; later fine feedback is a separate refinement pass.
   - Reason: overlays, route state, and capability homes remain protected behavior floors while each surface receives direct visual comparison.
   - Deliverable: one discrepancy matrix, corrected evidence set, fresh review, and explicit Joshua decision per surface.

## Visual Parity Acceptance For A Surface

- Contract exists and names prototype references.
- Component tests cover flag transition, critical overlay, deep link, exact-once carry-over, no internal labels, and a11y.
- Browser smoke covers desktop, mobile, overlay, and deep link.
- `npm run lint:hooks`, `npm run typecheck`, `npx vite build`, and `npm run pr-check` pass for the implementation slice.
- Paired prototype/rebuilt captures cover every meaningful interior state at 1600x1000 and 1440x900.
- Joshua explicitly records `owner-approved`, or explicitly approves a documented exception. Automated review and green gates cannot satisfy this criterion.
