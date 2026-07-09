# SEO Editor Prototype Parity Contract

Surface: `seo-editor` / SEO Editor  
Owner: optimization / Webflow write-target workflow  
Status: `ODP-003 C` accepted 2026-07-09; phased workbench correction approved  
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

## Current Rebuilt Gap

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

Initial grade: `behavior mismatch` plus `capability risk`, with the phased workbench correction approved and queued.

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

Recommended parity direction, if approved:

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

## Needs Owner Decision

Decision: should the rebuilt SEO Editor move from the current table + drawer shell into the prototype workbench model now?

Options:

- Recommended: keep the current URL contract, but make the default surface a prototype-style write-target workbench with source-grouped spreadsheet rows, inline title/meta editing, selected-row sticky actions, page-intelligence detail drawer, and a `Review pending` keyboard queue.
- Conservative: keep the current table + drawer structure for now, continue safe copy/style cleanup, and defer the workbench/queue rewrite until SEO editing has a dedicated implementation slice.

Risk if wrong:

- Implementing the queue/workbench without approval could change how operators save, send, approve, and publish SEO edits, which is a high-trust production workflow.
- Keeping the current shell leaves the largest prototype mismatch unresolved and risks a surface that looks cleaner but still does not match the prototype's operating model.

Safe work completed while awaiting decision:

- Visible raw URL enum labels such as `cms-item` and `needs-meta` were replaced with operator-facing labels in the worksheet summary.
- Visible implementation phrases such as `existing`, `server-backed`, `endpoint`, `v1`, `PATCH route`, and `projection` were removed from the loaded worksheet and detail drawer.
- Header actions now stack on narrow viewports and the subtitle can wrap instead of truncating.
- Source tinting now follows the prototype intent: Static neutral, CMS blue, Manual amber. Teal remains reserved for actions/active states.
- Singular row counts now render as `1 row` rather than `1 rows`.
- The rebuilt admin hook now reads recommendations through the admin recommendations endpoint, so SEO Editor smoke no longer hits the client-gated public recommendations route.
- Styleguide typography roles now distinguish primary workbench content from metadata: worksheet counts and primary page/SEO values use `t-ui`, secondary summaries use `t-caption`, drawer/research guidance uses `t-body`, and field labels use `t-label`.

Safe work still available while awaiting decision:

- More responsive polish for table controls and drawer footer actions.
- Better detail-pane copy and handoff buttons using existing routes, as long as the workbench model is not implied before it exists.

## Browser Smoke Checklist

Baseline smoke for the current shell:

- Desktop `/ws/ws_demo_premium/seo-editor`.
- Mobile `/ws/ws_demo_premium/seo-editor`.
- Deep link `/ws/ws_demo_premium/seo-editor?tab=research&page=<seeded-page-id>` when seeded rows are available.
- Source/filter deep link such as `/ws/ws_demo_premium/seo-editor?source=cms-item`.
- Manual row detail open.
- Static or CMS detail drawer open.
- No blank table, duplicate drawer, hidden write target, visible internal rebuild labels, raw enum labels, text overlap, or console errors.

Current-state smoke evidence:

- Empty demo-shell baseline captured at `/tmp/asset-dashboard-codex-parity-captures/seo-editor-desktop-current.png`, `/tmp/asset-dashboard-codex-parity-captures/seo-editor-cms-source-deeplink-current.png`, and `/tmp/asset-dashboard-codex-parity-captures/seo-editor-mobile-current.png`.
- Rowful desktop/mobile smoke captured against `ws_1772641235973` at `/tmp/asset-dashboard-codex-parity-captures/seo-editor-estateably-desktop-current.png` and `/tmp/asset-dashboard-codex-parity-captures/seo-editor-estateably-mobile-current.png`.
- Source deep-link smoke captured at `/tmp/asset-dashboard-codex-parity-captures/seo-editor-estateably-cms-source-current.png`.
- Detail drawer smoke captured at `/tmp/asset-dashboard-codex-parity-captures/seo-editor-estateably-detail-current.png`; state file `/tmp/asset-dashboard-codex-parity-captures/seo-editor-estateably-detail-state.json` recorded one dialog, no internal labels, no page-level horizontal overflow, no console errors, and no failed responses.
- Typography-role smoke captured against `ws_1772610244629` at `/tmp/asset-dashboard-codex-parity-captures/seo-editor-typography-role-overview-desktop.png` and `/tmp/asset-dashboard-codex-parity-captures/seo-editor-typography-role-detail-desktop.png`; state file `/tmp/asset-dashboard-codex-parity-captures/seo-editor-typography-role-smoke-state.json` recorded 145 loaded rows, one detail dialog, no page-level horizontal overflow, no internal labels, `t-ui` row status at 13.5px/500, and `t-body` copy at 15.5px/500. Local preview console noise was limited to Vite WebSocket disconnect warnings plus a route-change-aborted intelligence refresh.

Post-correction smoke, if the workbench/queue direction is approved:

- Desktop workbench with source-grouped spreadsheet rows.
- Mobile workbench with controls readable and no page-level horizontal overflow outside the intended table scroll.
- Selected-row sticky action bar.
- Detail drawer/pane with page intelligence and handoffs.
- `Review pending` queue with keyboard triage actions.
- Deep links initialize edit/research/source/filter/page state.

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

Required future coverage if the workbench/queue correction is approved:

- Default edit mode renders source-grouped spreadsheet rows with inline writable title/meta controls.
- Selected rows open one sticky action bar with AI-fix, approve, send, publish, and clear actions.
- `Review pending` opens exactly one queue state and keyboard shortcuts invoke the expected actions.
- `?page=` initializes the selected detail state without duplicate drawers.
- Static/CMS/Manual write-target distinctions remain enforced in both worksheet and detail views.
