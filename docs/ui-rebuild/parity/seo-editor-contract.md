# SEO Editor Prototype Parity Contract

Surface: `seo-editor` / SEO Editor  
Owner: optimization / Webflow write-target workflow  
Status: `owner-approved`; Joshua approved the corrected workbench/interior composition and documented exceptions on 2026-07-10
Primary route: `/ws/:workspaceId/seo-editor`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/editor.js`
- Parity ledger source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/Platform Parity Ledger.html`
- Existing rebuilt implementation: `src/components/seo-editor-rebuilt/SeoEditorSurface.tsx`
- State hook: `src/components/seo-editor-rebuilt/useSeoEditorSurfaceState.ts`
- Detail drawer: `src/components/seo-editor-rebuilt/SeoEditorPagePanel.tsx`
- Worksheet: `src/components/seo-editor-rebuilt/SeoEditorWorksheet.tsx`
- Current component test: `tests/component/seo-editor-rebuilt/SeoEditorSurface.test.tsx`

## Required Interaction Model

The prototype is a master-detail SEO workbench for clearing page metadata work at volume. Its opening comment names three layers:

1. List / spreadsheet layer
   - Fast and wide worksheet for 50-60 pages.
   - Source-grouped rows for Static pages, CMS collection items, and Manual URLs.
   - Inline title/meta editing, source-aware status, selection, and a sticky selected-row action bar.
   - Missing-field banner can draft title/meta fixes in one pass.

2. Detail / research layer
   - A selected target opens a persistent detail experience, either as a right-side drill-in or master-detail pane.
   - Detail includes target header, editable title/meta/H1/slug where writable, Google/Facebook previews, on-page score, page intelligence, content gaps, recommendations, AI assist, and workflow footer actions.
   - Static and CMS rows remain writable through their distinct paths.
   - Manual rows are read-only and show redirect / recreate / external-edit options instead of write actions.

3. Review queue layer
   - `Review pending` enters a keyboard triage queue.
   - Queue shows one pending target at a time, progress segments, and footer actions for Request changes, Approve, Send to client, and Publish.
   - Keyboard shortcuts: arrows to move, `A` approve, `S` send, `P` publish, `R` request changes, Escape exits.

The parity ledger also says the former Page Intelligence surface is merged here through an Edit / Research model. Edit is the fast-wide worksheet; Research is the deep per-page intelligence with keyword mapping, content gaps, recommendations, fix-priority read, and Create Brief / Add Schema / View Traffic hand-offs.

## Source-Led Baseline Before Visual Correction

The rebuilt surface has many of the right production ingredients:

- `?tab=edit|research`, `source`, `filter`, `collection`, `page`, and `search` URL state are validated.
- Source filters cover Static, CMS, and Manual targets.
- Manual rows stay visible-only and disable write/send/publish actions.
- Static and CMS write workflows are preserved through the existing workflow props.
- Page detail opens in the shared `Drawer` and mounts exactly once.
- Sent-to-client approvals remain reachable through the reused approvals panel.
- Component tests prove real `useFeatureFlag` loading-to-loaded behavior and a11y.

But the primary interaction model is still different from the prototype:

- The rebuilt page uses a top Edit / Research lens plus separate GroupBlocks rather than one integrated workbench.
- The Edit view is a sortable table summary; it does not yet provide the prototype's inline title/meta spreadsheet editing.
- Research context appears as a separate section and in the drawer, but the prototype's page intelligence, content gaps, recommendations, and hand-off buttons are one cohesive detail flow.
- There is no `Review pending` keyboard queue for approval triage.
- Bulk actions exist, but not the prototype's exact selected-row action bar with Approve, Send to client, Publish, and AI-fix missing in one sticky strip.

Initial grade: `behavior mismatch` plus `capability risk`.

Behavior-checkpoint correction implemented before the visual pass:

- Edit mode now renders explicit `Static pages`, `CMS collection items`, and `Manual URLs` workbench groups using the existing table records and source authority.
- Each group carries truthful source framing and counts; Static stays neutral, CMS uses blue data framing, and Manual uses amber read-only framing.
- All groups continue to feed the existing single sticky selected-row action region. Static/CMS selection callbacks and Manual disabled state are unchanged.
- The existing Detail Drawer, Edit/Research modes, URL params, fix-context handoff, save/analyze/rewrite/send flows, and approval panel remain unchanged and exact once.
- This slice intentionally does not add inline title/meta editing, Approve, Publish, AI-fix, `Review pending`, or keyboard triage semantics.

Source-led visual correction implemented 2026-07-10:

- The default surface is the prototype's full-width sheet/worktable, not an Edit/Research card lens. The historical `?tab=` values remain compatibility state without duplicating the visible hierarchy.
- Static and CMS title/meta fields use the existing production save paths inline. Manual rows remain amber read-only snapshots with disabled selection and truthful remediation in Research.
- Source, CMS collection, and quick filters share one compact 39px row. Quick-filter `All` is label-only; other filters show their useful counts.
- The missing-metadata band appears only when no rows are selected. Selection replaces it with one 40px, scroll-safe action toolbar.
- Source bands use a truthful leading `Select all …` checkbox and reflect visible selection rather than a disconnected right-side button.
- The worktable begins at x232 and uses the full rebuilt main canvas. Its single header, source bands, inline fields, and row density match the mounted prototype sheet.
- Research opens the real detail workflow in the existing Drawer at 600px or 860px. Static/CMS write paths, previews, analysis, generation, save, send, and Keyword Hub handoff remain reachable exactly once.
- H1 and slug stay read-only because no writable production field exists. Keyword assignment stays in Keyword Hub. The prototype keyboard review queue is not simulated because current callbacks do not support Approve/Request changes semantics.
- Page Intelligence remains a standalone production route; this pass does not retire or redirect it based on visual similarity.
- Fresh Sol review returned `PASS` with no safe-local visual defects. This does not constitute Joshua's visual approval.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/seo-editor` opens `tab=edit`.
- `?tab=research` opens the research lens.
- Invalid `?tab=` falls back to edit.
- `?source=all|static-page|cms-item|manual` filters source rows.
- `?filter=all|needs-title|needs-meta|needs-review|unsaved` filters worksheet rows.
- `?collection=<collectionId>` narrows CMS collection rows.
- `?page=<rowId/pageId/itemId/path>` opens the detail drawer.
- `?search=<query>` hydrates the search field.
- Fix-context navigation can open the matching row when page slug or page id matches.

Later owner-gated parity direction:

- Keep all current URL params valid.
- Keep `?tab=edit` as the fast-wide worksheet mode and `?tab=research` as a deep per-page focus mode.
- Treat `?page=` as selected target / drawer-open state.
- Add a queue-open state only if it can be mapped without breaking existing deep links. A future param such as `queue=review` is acceptable only if the implementation preserves the current `?tab=` behavior.
- Keep source, collection, filter, and search params exactly as compatibility state, but visible copy must render user-facing labels, not raw enum values.

## Carry-Over Homes

Keep these production capabilities reachable exactly once:

- Static page title/meta save, draft save, page-title rename, analyze, AI rewrite, send-to-client, and clear tracking.
- CMS item field edit, save draft, publish collection, AI rewrite, and approval selection.
- Manual row inspection with all write actions disabled.
- Bulk static missing-title/missing-meta fixes, analyze remaining, pattern preview/apply, and suggestion application.
- Bulk CMS rewrite actions.
- `PendingApprovals` for sent SEO batches.
- Keyword Hub handoff for keyword assignment ownership.
- `fixContext` handoff into the correct row.

## Moved, Excluded, or Deferred

- Keyword assignment ownership stays in Keyword Hub for now; SEO Editor should deep-link or hand off rather than become a second keyword-management surface.
- Schema generation belongs in `seo-schema`; SEO Editor should hand off to Add Schema rather than duplicate schema editing.
- Traffic readback belongs in Analytics / Search Traffic unless the approved detail pane adds a read-only handoff.
- Do not add backend APIs, migrations, shared types, route ids, or new feature flags for this parity slice.
- Do not delete or materially rewrite legacy write workflows in the parity pass; re-home or wrap them first.

## Implemented Owner Decision

Decision `ODP-003 C` remains the capability boundary. The source-led pass advances its safe portion to the real inline workbench because Static/CMS save paths already exist; the keyboard review queue remains deferred because Approve/Request changes callbacks do not.

Options:

- Implemented recommendation: keep the current URL contract and use the prototype-style source-grouped inline worksheet plus selected-row toolbar and Research Drawer.
- Deferred recommendation: add a keyboard review queue only after real Approve, Request changes, Send, and Publish contracts exist and Joshua approves that workflow.

Risk if wrong:

- Implementing the queue/workbench without approval could change how operators save, send, approve, and publish SEO edits, which is a high-trust production workflow.
- Keeping the current shell leaves the largest prototype mismatch unresolved and risks a surface that looks cleaner but still does not match the prototype's operating model.

Pre-decision safe work completed:

- Visible raw URL enum labels such as `cms-item` and `needs-meta` were replaced with operator-facing labels in the worksheet summary.
- Visible implementation phrases such as `existing`, `server-backed`, `endpoint`, `v1`, `PATCH route`, and `projection` were removed from the loaded worksheet and detail drawer.
- Header actions now stack on narrow viewports and the subtitle can wrap instead of truncating.
- Source tinting now follows the prototype intent: Static neutral, CMS blue, Manual amber. Teal remains reserved for actions/active states.
- Singular row counts now render as `1 row` rather than `1 rows`.
- The rebuilt admin hook now reads recommendations through the admin recommendations endpoint, so SEO Editor smoke no longer hits the client-gated public recommendations route.
- Styleguide typography roles now distinguish primary workbench content from metadata: worksheet counts and primary page/SEO values use `t-ui`, secondary summaries use `t-caption`, drawer/research guidance uses `t-body`, and field labels use `t-label`.

Later low-risk polish:

- More responsive polish for table controls and drawer footer actions.
- Better detail-pane copy and handoff buttons using existing routes, as long as the workbench model is not implied before it exists.

## Browser Smoke Checklist

Final source-led browser result:

- Rinse validates the truthful Manual-only state; Estateably resolves 507 targets into 25 Static, 217 CMS, and 265 Manual after source reads settle.
- At 1440×900, heading y108, filters y167/h39, conditional banner or selected toolbar y218/h40, and worktable y294 closely match the prototype. At 1600×1000 the worktable remains full-width without document overflow.
- Default populated evidence: `/tmp/asset-dashboard-codex-visual-parity/seo-editor/pass1/rebuilt-estateably-1440-after-review.png` and `rebuilt-estateably-1600-final.png`.
- Final selected evidence: `rebuilt-selected-1440-v2.png`; browser audit recorded zero alerts, one selected toolbar, label-only `All`, and one leading `Select all Static pages` checkbox.
- Research evidence: `rebuilt-static-drawer-600.png`, `rebuilt-static-drawer-860-final.png`, and `rebuilt-manual-drawer-1440.png`. The wide Drawer audited x580/w860/h900 at 1440×900 with document width 1440.
- Mobile evidence: `rebuilt-estateably-mobile-390.png`; the document remains 390px wide and worksheet scrolling stays internal.
- Deep-link, source/filter/search/page, overlay, and exact-once action tests remain green. Fresh Sol review returned `PASS`.

## Registry Closeout Evidence

The measured registry archive adds exact prototype pairs at both required viewports for the default worktable, selected toolbar, Manual rows, static/CMS Research, and both 600px and 860px Research widths under `/tmp/asset-dashboard-codex-visual-parity/registry-final/prototype/`. Matching rebuilt 1600x1000 states are under `/tmp/asset-dashboard-codex-visual-parity/registry-final/rebuilt/`; the previously reviewed exact 1440x900 evidence remains authoritative. The keyboard review queue remains a named workflow exception, not a hidden visual omission.

## Automated Test Floor

Existing/current branch coverage proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts SEO Editor.
- Tab, source, filter, page, and search URL state are read and validated.
- Invalid URL state falls back safely.
- `?tab=research&page=...` opens the matching detail drawer.
- Source filtering preserves manual rows as visible-only and disables write actions.
- Static and CMS saves route through their workflow props.
- Visible source/filter state uses operator-facing labels instead of raw URL enum values.
- Important worksheet, research, and drawer copy uses the expected styleguide typography roles.
- Implementation language is absent from the loaded worksheet and detail drawer.
- The rebuilt a11y floor passes.

The source-led pass additionally proves:

- Default renders one full-width source-grouped worksheet with inline Static/CMS title/meta controls and read-only Manual rows.
- Missing metadata and selected actions are mutually exclusive; selected actions remain one 40px toolbar.
- Source bands expose truthful leading select-all checkboxes, and quick-filter `All` has no duplicated total.
- Research renders at 600px and 860px, preserves write authority, and keeps Manual remediation read-only.

Still owner-gated as a separate future workflow slice: a real Review queue with Approve/Request changes/keyboard semantics. Joshua explicitly owner-approved the current visual pass with that exception on 2026-07-10.
