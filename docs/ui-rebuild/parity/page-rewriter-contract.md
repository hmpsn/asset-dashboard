# Page Rewriter Prototype Parity Contract

Surface: `rewrite` / Page Rewriter  
Owner: optimization / AI rewrite workspace  
Status: `ODP-007 A` accepted 2026-07-09; shell focus bridge approved, export-only v1 retained  
Primary route: `/ws/:workspaceId/rewrite`

## Prototype References

- Prototype source: `/Users/joshuahampson/CascadeProjects/asset-dashboard/hmpsn studio Design System/mockup/rewrite.js`
- Phase 0 surface ledger: `docs/ui-rebuild/phase0/surfaces/page-rewriter.md`
- Phase A build ticket: `docs/ui-rebuild/phase-a/tickets/page-rewriter.md`
- Existing rebuilt implementation: `src/components/page-rewriter-rebuilt/PageRewriterSurface.tsx`
- Route-state hook: `src/components/page-rewriter-rebuilt/usePageRewriterSurfaceState.ts`
- Page picker: `src/components/page-rewriter-rebuilt/PageRewriterPagePicker.tsx`
- Chat pane: `src/components/page-rewriter-rebuilt/PageRewriterChatPane.tsx`
- Document pane: `src/components/page-rewriter-rebuilt/PageRewriterDocumentPane.tsx`
- Current component test: `tests/component/page-rewriter-rebuilt/PageRewriterSurface.test.tsx`

## Required Interaction Model

The prototype is a single two-pane AI rewrite workspace:

1. Pick or paste a live page from the workspace.
2. Use the left rewrite assistant to ask for section rewrites, prompt from playbook chips, and edit AI rewrite text before applying it.
3. Apply rewrite blocks into the right-side live document.
4. Edit the document inline with a fixed formatting toolbar.
5. Export the edited document.
6. Keep draft/publish wording honest unless the write spine exists.

Prototype-critical structure:

- No top-level workflow tabs are needed for the default desktop experience. The page should open directly into the chat + document workspace.
- Page selection is an inline workspace header/combobox, not a separate page or modal.
- Rewrite suggestions land as editable assistant blocks with Apply / Copy affordances.
- The document pane owns audit issue chips, page metrics, formatting, live-page link, and export.

## Current Parity Grade

Grade: `capability risk`.

Why:

- The rebuilt surface now matches the prototype's core interaction model closely enough: one route, one workspace, page picker, rewrite assistant, always-visible playbook chips, editable rewrite block, section apply, copy, document editor, formatting toolbar, export menu, and `?pageUrl=` deep-link receiver.
- The previous rebuilt view-mode switcher (`Split` / `Chat` / `Document`) is removed from the default page body so the prototype two-pane workspace is the visible navigation model.
- The document pane now carries a prototype-style footer/status bar: export lives with the document, the draft state is explicit, and the UI says `Export-only draft`, `Not live`, and `Not saved or published to the CMS.` instead of implying persistence or CMS publication.
- The current export-only workspace now maps working copy to the styleguide type roles: assistant guidance and generated rewrite text use `.t-body`, page picker/document controls use `.t-ui`, and true metadata remains in caption roles.
- Existing production carry-over remains preserved: keyboard-operable page picker, arbitrary URL load, deep-link validation, audit issue chips, editable rewrite answers, named-section apply, live-page link, Markdown / HTML / `.md` / `.docx` / PDF export, quota handling, and a11y floor.
- The missing Focus mode is an unresolved capability risk. Legacy Page Rewriter and the prototype both include Focus mode, but the rebuilt shell currently does not expose a surface-level way for `PageRewriterSurface` to toggle `AppShell` focus mode.
- Save draft / Publish rewrite / push-to-draft are prototype-only write-spine affordances. They are deliberately not implemented in this slice because there is no current full-page Webflow write path, draft table, migration, lifecycle, activity log, or broadcast contract.

Accepted direction:

- Restore Focus mode through one sanctioned shell context or prop bridge from `RebuiltAppChrome` to rebuilt surfaces, then let Page Rewriter consume it.
- Keep export-only v1 and do not show Save draft / Publish until the backend write target and draft lifecycle exist.
- Circle back on draft/publish only as a separately scoped backend lifecycle project.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/rewrite` opens the Page Rewriter workspace with no page loaded.
- `?pageUrl=https://...` is validated and auto-loads the page exactly once.
- Invalid `?pageUrl=` values are ignored with user-facing copy.
- Selecting a page or loading a typed URL writes the validated `pageUrl` back to the URL.
- The Back to audit action navigates to `/ws/:workspaceId/seo-audit` without carrying the page URL.
- This surface intentionally does not use `?tab=` because the prototype is a single workspace.

Compatibility requirements:

- Preserve the dedicated `pageUrl` param until an owner-ratified route contract replaces it.
- Do not overload `?tab=` for page URLs.
- Do not add backend APIs, migrations, shared types, route ids, or feature flags in this parity slice.
- Do not claim draft persistence, push-to-draft, or Webflow publish until those write paths exist.

## Carry-Over Homes

Keep these capabilities reachable exactly once:

- Page picker with sitemap list, typed URL load, slug/title search, hierarchy indentation, keyboard navigation, empty/no-match states, loading and error states.
- Rewrite assistant with playbook chips, prompt input, Enter/Shift+Enter behavior, loading response state, Markdown answers, editable rewrite blocks, Apply to named section, Copy, quota lock, and first-429 banner.
- Document pane with page metrics, target keyword, rank, traffic, optimization score, audit issue chips, live-page link, contenteditable document body, B/I/H2/H3/Clear formatting, export-only footer/status, export menu, and no-page empty state.
- Export modes: copy Markdown, copy HTML, download Markdown, download DOCX, and download PDF.

## Safe Work Completed

- Removed the visible `Split` / `Chat` / `Document` view switcher from the default page body so the prototype two-pane workspace is the primary model.
- Kept chat and document panes mounted together, preserving the prototype's side-by-side flow on desktop and stacked flow on smaller screens.
- Replaced visible `page-keyword projection` fallback copy with operator-facing optimization-score copy.
- Treated target keyword and primary-keyword metrics as blue read-only data instead of teal action state.
- Wrapped the loaded header copy/actions on narrow viewports.
- Let long rewrite playbook prompt chips wrap inside narrow assistant panes so mobile text is not clipped.
- Moved the export menu from the top toolbar into a document footer that labels the current artifact as an export-only draft, shows `Not live`, and keeps Save draft / Publish rewrite absent until a real write spine exists.
- Fixed the rebuilt document pane's mixed loaded/pending state so a loaded page exits skeleton mode and shows the editor/footer even if the mutation pending flag lingers during local StrictMode/browser smoke.
- Promoted Page Rewriter's page picker path, assistant guidance, empty assistant state, generated rewrite blocks, document controls, document body, loading copy, and export-only footer explanation to the appropriate `.t-ui` / `.t-body` roles.
- Component tests assert the real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition, `?pageUrl=` receiver, invalid URL guard, no top view switcher, no visible internal rebuild/projection terms, page picker keyboard load, editable rewrite apply, quota lock, Back to audit behavior, and rebuilt a11y.

## Browser Smoke Evidence

Clean fixture target: `ws_1772610244629`, page `https://swish-dental-2023.webflow.io/`.

- Desktop overview / no-page state: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-swish-empty-desktop.png`
- Loaded `?pageUrl=` deep link: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-swish-loaded-desktop.png`
- Export popover open state: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-swish-export-open.png`
- Mobile loaded workspace: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-swish-mobile-loaded.png`
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-swish-smoke-state.json`

Earlier result: clean. The smoke recorded no console errors, no failed local responses, no page-level horizontal overflow, no visible internal rebuild/projection terms, and no leftover `Split` / `Chat` / `Document` view switcher.

Footer-polish follow-up smoke:

- Target: `/ws/ws_1772610244629/rewrite?pageUrl=https://swish-dental-2023.webflow.io/`
- Desktop loaded footer: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-footer-loaded-desktop.png`
- Export popover open: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-footer-export-open.png`
- Mobile loaded footer: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-footer-loaded-mobile.png`
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-footer-smoke-state.json`

Result: clean after fixing the loaded/pending state. The smoke recorded the rebuilt document editor exactly once, `Export-only draft`, `Not live`, `Not saved or published to the CMS.`, zero loading skeletons, no page-level horizontal overflow on desktop or mobile, export menu items present, and no console warnings/errors.

Typography-role follow-up smoke:

- Target: `/ws/ws_1772610244629/rewrite?pageUrl=https%3A%2F%2Fswish-dental-2023.webflow.io%2F`
- Desktop loaded workspace: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-typography-loaded-desktop.png`
- Export popover open: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-typography-export-open.png`
- Light mobile loaded workspace: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-typography-loaded-mobile.png`
- Smoke state: `/tmp/asset-dashboard-codex-parity-captures/page-rewriter-typography-smoke-state.json`

Result: clean. The smoke recorded one document editor, zero loading skeletons, no horizontal overflow on desktop or the 390px light mobile check, no internal migration/rebuild labels, `Export-only draft`, `Not live`, `Not saved or published to the CMS.`, and no Save draft / Publish rewrite affordances. Refined typography samples confirmed assistant copy and footer explanation at `.t-body` / 15.5px, with page picker and export status labels at `.t-ui` / 13.5px. Export opens one menu with all export actions and no console warnings/errors.

## Automated Test Floor

Existing/current branch coverage proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Page Rewriter.
- `?pageUrl=` validates and auto-loads the page.
- Invalid `?pageUrl=` values do not call the load-page endpoint.
- The default page has no top view radiogroup and shows both prototype panes.
- The loaded document pane shows `Export-only draft`, `Not live`, and `Not saved or published to the CMS.`, clears the loading skeleton, and keeps Save draft / Publish rewrite absent.
- The workspace maps important assistant, page picker, generated rewrite, and export status copy to styleguide typography roles.
- Internal rebuild/projection terms are absent from visible loaded states.
- Sitemap picker keyboard load calls the load-page endpoint.
- Editable AI rewrite text applies to the named document section.
- First-429 quota state disables AI actions.
- Back to audit clears the pageUrl handoff.
- The rebuilt a11y floor passes.
