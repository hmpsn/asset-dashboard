# Page Intelligence Prototype Parity Contract

Surface: `page-intelligence` / Page Intelligence
Route: `/ws/:workspaceId/page-intelligence`
Status: `owner-approved`; Joshua explicitly approved the Page Intelligence / Content Performance receiving-home bundle on 2026-07-11 after its rendered TL;DR

## Prototype And Production Authority

- Prototype source: `hmpsn studio Design System/mockup/editor.js`, especially the live Research detail and pinned-drawer composition.
- Prototype harness route: `hmpsn studio Design System/mockup/app.js` `editor` entry.
- Prototype navigation context: `hmpsn studio Design System/mockup/nav.js` and `palette.js`.
- Rebuilt implementation: `src/components/page-intelligence-rebuilt/PageIntelligenceSurface.tsx` and `PageIntelligenceDetailPane.tsx`.
- Route-state authority: `src/components/page-intelligence-rebuilt/pageIntelligenceRouting.ts`.
- Direct mount: `src/components/layout/rebuiltSurfaces.ts` `REBUILT_SURFACES['page-intelligence']`.
- Existing production capability sources remain under `src/components/page-intelligence/` and the established admin hooks/APIs; the rebuilt surface composes them rather than defining a second write model.

The prototype's live SEO Editor Research detail and pinned-drawer composition is the visual authority, not a route-retirement instruction or proof that the prototype mounts a permanent master/detail workspace. Its retained `workMode` toggle is a no-op/dead path. Capability proof under final `ODP-012 B` showed that folding Page Intelligence into SEO Editor would omit a strategy-only page and the broader analysis-job, evidence, keyword-edit, rank, local, queue, Guide, SEO-copy, and handoff contracts. Page Intelligence therefore remains standalone, and Joshua approved the permanent master/detail arrangement as the production adaptation.

## Required Interaction And Composition

1. Compact page context and controls use the approved 22px hierarchy and a bounded desktop workbench.
2. `Pages` uses the Joshua-approved permanent master/detail adaptation of the prototype's live Research detail/pinned-drawer composition:
   - dense searchable/sortable/fix-first page rail;
   - deliberate empty selection rather than silently selecting the first page;
   - sticky selected-target context;
   - independently scrolling evidence/detail body;
   - sticky footer containing only real production actions.
3. `Architecture` and `Guide` remain peer receivers and retain their established production content.
4. Single and bulk page analysis preserve progress and cancellation.
5. Keyword assignment/editing, rank tracking, provider metrics, local visibility, persisted/live analysis, content/readability evidence, fix priority, and SEO-copy generation remain reachable exactly once.
6. Brief, Schema, and SEO Editor handoffs remain exact-once production actions; the surface does not invent prototype-only writes.
7. Loading, empty, unavailable-provider, and error states stay truthful and use the shared design-system primitives.

## URL And Deep-Link Contract

- Bare route opens `Pages` with no implicit first-row selection.
- `?tab=pages|architecture|guide` initializes the matching receiver; invalid values fall back safely.
- `?page=<id|slug|normalized-path>` selects a valid page after data resolves and remains refreshable.
- URL page identity takes precedence over `location.state.fixContext`.
- A valid Page Intelligence fix context may initialize selection only when no URL page identity is present.
- Clearing router state after replace-navigation must not clear a page already selected from that state.
- Invalid or absent page identity leaves the intentional empty-selection state rather than choosing another record.
- Flag-off continues rendering the legacy Page Intelligence component with its existing route meaning.

## Capability And Data Boundaries

- Do not redirect Page Intelligence into SEO Editor or Keyword Hub based on visual similarity.
- Keyword Hub owns keyword lifecycle; Page Intelligence owns page-first analysis and page-scoped keyword evidence/edit handoffs.
- SEO Editor owns static/CMS metadata writes; Page Intelligence may hand off but must not duplicate that write authority.
- Do not fabricate provider metrics, local visibility, analysis results, or page mappings to populate a screenshot.
- No new backend API, migration, shared type, route id, or feature flag was introduced for the visual composition.

## Desktop Visual Result

Captured evidence is under:

- `/tmp/asset-dashboard-codex-visual-parity/page-intelligence/`

The rebuilt capture set currently contains:

- `rebuilt-1440-empty.png`;
- `rebuilt-1440-detail.png`;
- `rebuilt-1600-empty.png`;
- `rebuilt-1600-detail.png`;
- `rebuilt-390-empty.png`;
- `rebuilt-390-detail.png`.

The directory also retains the actual prototype references captured for Research at 1440×900 and 1600×1000 and the 1600×1000 Page Intelligence reference cards. The completed light mobile usability floor uses a list-to-detail flow: selecting a page replaces the rail at 390px, `Back to pages` restores it, the desktop master/detail composition remains unchanged at `md` and above, sort controls stay contained, and footer actions wrap without document or workbench overflow. The captured workbench uses the approved design-system roles, Font Awesome semantic icons, teal actions, blue read-only data, and canonical score colors.

Joshua's explicit 2026-07-11 approval establishes `owner-approved` status. The independent rendered review and automated gates support that decision but do not replace it.

## Automated Test Floor

Currently proved:

- registry presence for `REBUILT_SURFACES['page-intelligence']`;
- pure valid/invalid tab resolution and page matching by id, slug, and normalized path;
- URL precedence, cold-load and cached-background-refresh selection after page data resolves, fix-context retention after router-state clearing, and deliberate no-selection behavior;
- a real `ui-rebuild-shell` loading-to-ON transition and the flag-off legacy receiver;
- exact-once analysis, keyword edit/tracking, SEO-copy, Brief, Schema, SEO Editor, and traffic handoffs;
- desktop and 390px list-to-detail/back behavior, Back focus transfer and originating-row restoration, contained sort/footer controls, document/workbench overflow floors, and rebuilt accessibility semantics;
- absence of internal rebuild or migration labels in rendered copy.

## Post-Approval Audit Boundary

The 2026-07-11 functionality/wiring audit hardened workspace-owned state and Page Intelligence route-state isolation in `476db936a`. The post-approval closure pass in `3b7f4343f` then pinned the real flag transition/OFF receiver, exact-once capability homes, cold `?page=` initialization, and the light mobile list-to-detail floor. Fresh independent review found and resolved two final edges in `e4b12beb7`: cached partial inventories now wait for their background refresh before consuming a requested identity, and the mobile flow transfers/restores focus across the hidden list. Those safe repairs do not alter this visual approval. None of `AUD-D1` through `AUD-D7` changes the Page Intelligence receiving-home decision.
