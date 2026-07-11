# Page Rewriter Prototype Parity Contract

Surface: `rewrite` / Page Rewriter  
Owner: optimization / AI rewrite workspace  
Status: `owner-approved`; Joshua approved the export-only v1, documented backend exceptions, and retained 62px Focus rail on 2026-07-10
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

## First Visual Correction Pass — 2026-07-10

| Prototype discrepancy | Correction in this pass | Protected production behavior |
|---|---|---|
| Generic page header and unconstrained page pushed the drafting workspace below the first viewport. | Replaced the large header with a compact purple AI context row; centered the workspace on `--page-max`; made the desktop grid viewport-contained with independent pane scroll. | Back to audit and the controlled shell Focus action remain reachable exactly once. |
| Picker showed path before title and confined selection to a small trailing button. | Made the page title primary, domain/path monospace secondary, added the purple file-identity tile, and made the full row the accessible listbox trigger. | Sitemap search, arbitrary URL load, indentation, keyboard selection, loading/error/no-match states remain intact. |
| Chat ordered playbooks before the transcript and opened with a generic empty panel. | Restored header → transcript → short playbook controls → compact composer; seeded a page-specific AI greeting and added AI/user avatars. | All six production prompt instructions remain available behind short labels; editable response, named-section Apply, Copy, Markdown, loading, and quota behavior remain intact. |
| Document header was page-title-led and mixed formatting into the same row; export lived in the footer. | Restored `Live document`, kept the page H1 inside the editor, moved Export to the document header exactly once, and separated the fixed formatting toolbar. | Open live page and all five export formats remain reachable exactly once. |
| Four large metric cards plus a separate issue row consumed most of the document pane. | Compressed keyword, rank, traffic, optimization, and every audit issue into one fixed evidence band above the independently scrolling document. | No metric or issue was removed or fabricated; unavailable optimization stays `—`. |
| Footer was action-heavy for an export-only artifact. | Reduced it to a compact honest status line: `Export-only draft`, `Not live`, and `Not saved or published to the CMS.` | Save draft and Publish rewrite remain absent under `ODP-007 A`. |
| Picker selection could be loaded again when its successful URL write reached the deep-link effect. | The selected validated URL is marked before mutation, so the receiver effect does not duplicate the load. | Direct `?pageUrl=` initialization, retry, and URL synchronization remain unchanged. |

## Current Parity Grade

Visual status: `owner-approved` for the accepted export-only v1.

Why:

- The first source-led correction pass now follows the prototype's compact one-workspace composition: context row, full-row picker, 44/56 chat-document split, fixed pane headers, independently scrolling transcript/document, short playbooks, compact composer, fixed evidence band, and compact export-only footer.
- The previous rebuilt view-mode switcher (`Split` / `Chat` / `Document`) is removed from the default page body so the prototype two-pane workspace is the visible navigation model.
- The document pane now carries Export once in the `Live document` header and a compact honest footer/status bar. The UI says `Export-only draft`, `Not live`, and `Not saved or published to the CMS.` instead of implying persistence or CMS publication.
- The current workspace maps compact assistant transcript and controls to `.t-ui`, page address to `.t-mono`, document prose to `.t-page`, and footer metadata to caption roles.
- Existing production carry-over remains preserved: keyboard-operable page picker, arbitrary URL load, deep-link validation, audit issue chips, editable rewrite answers, named-section apply, live-page link, Markdown / HTML / `.md` / `.docx` / PDF export, quota handling, and a11y floor.
- Focus mode is restored through the rebuilt shell's controlled context. Page Rewriter can enter and exit focus without remounting the editor, and Escape remains owned by `AppShell` on rebuilt routes.
- Save draft / Publish rewrite / push-to-draft are prototype-only write-spine affordances. They are deliberately not implemented in this slice because there is no current full-page Webflow write path, draft table, migration, lifecycle, activity log, or broadcast contract.
- Required 1440×900 and 1600×1000 paired captures are complete. Fresh Sol review returned `PASS` across loaded, empty, picker, export, Focus, and mobile states; Joshua explicitly owner-approved the surface and retained Focus rail on 2026-07-10.

Accepted direction:

- Implemented: one sanctioned controlled focus bridge runs from `App` through `RebuiltAppChrome` to Page Rewriter.
- Keep export-only v1 and do not show Save draft / Publish until the backend write target and draft lifecycle exist.
- Circle back on draft/publish only as a separately scoped backend lifecycle project.
- The prototype hides navigation in Focus mode, while the accepted shared rebuilt shell retains its 62px collapsed rail. Joshua explicitly approved retaining the rail on 2026-07-10; removal is no longer an open circle-back.

## URL and Deep Links

Current route/state behavior:

- `/ws/:workspaceId/rewrite` opens the Page Rewriter workspace with no page loaded.
- `?pageUrl=https://...` is validated and auto-loads the page exactly once.
- Invalid `?pageUrl=` values are ignored with user-facing copy.
- Selecting a page or loading a typed URL writes the validated `pageUrl` back to the URL.
- The Back to audit action navigates to `/ws/:workspaceId/seo-audit` without carrying the page URL.
- Focus mode is local shell state. Enter, exit, and Escape preserve the current route, validated `pageUrl`, loaded document, and editor identity.
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
- Surface focus control backed by the rebuilt shell; focus collapse and Escape exit preserve the current editor and `pageUrl` state.
- Export modes: copy Markdown, copy HTML, download Markdown, download DOCX, and download PDF.

## Safe Work Completed

- Removed the visible `Split` / `Chat` / `Document` view switcher from the default page body so the prototype two-pane workspace is the primary model.
- Kept chat and document panes mounted together, preserving the prototype's side-by-side flow on desktop and stacked flow on smaller screens; desktop panes now share a viewport-contained `min-h-0` grid and own their scroll independently.
- Replaced the generic PageHeader with the prototype's compact AI context/action row while preserving Back and controlled Focus.
- Reordered the full-row page picker to page title → domain/path, gave it the prototype's purple file identity, and kept the searchable listbox keyboard-operable.
- Added a page-specific seeded AI greeting plus AI/user avatars, then placed short production-backed playbook controls between transcript and composer.
- Replaced visible `page-keyword projection` fallback copy with operator-facing optimization-score copy.
- Treated target keyword and primary-keyword metrics as blue read-only data instead of teal action state.
- Compressed all four page metrics and audit issues into one fixed evidence band; the document body now owns the remaining pane scroll.
- Restored a distinct `Live document` header, formatting toolbar, and page H1 hierarchy. Export lives in the document header exactly once; the footer carries status only.
- Wrapped compact playbook labels into a contained two-row control band while retaining the full production prompt as the control title.
- Fixed the rebuilt document pane's mixed loaded/pending state so a loaded page exits skeleton mode and shows the editor/footer even if the mutation pending flag lingers during local StrictMode/browser smoke.
- Prevented a picker selection from causing a second load when the successful selection writes its `pageUrl` search param.
- Mapped Page Rewriter's picker path, compact transcript, generated rewrite blocks, document controls/body, and export status to `.t-mono`, `.t-ui`, `.t-page`, and caption roles according to hierarchy.
- Added the controlled rebuilt focus context, wired it through `AppShell`, and exposed one Page Rewriter enter/exit control. The real sidebar and shell grid collapse together; Escape exits focus only through the rebuilt shell authority.
- Twenty component tests assert the real flag transition, `?pageUrl=` receiver, invalid URL guard, exact-once picker load, seeded greeting/avatars, HTML-entity decoding, pane-local transcript scrolling, hierarchy/order, evidence/export homes, empty/error/quota states, contained playbooks, no top view switcher, editable rewrite apply, Back, Focus, and the rebuilt a11y floor.

## Final Source-Led Browser Evidence — 2026-07-10

Final comparison root: `/tmp/asset-dashboard-codex-visual-parity/batch9/page-rewriter/`.

Prototype baselines:

- Loaded, 1440×900: `prototype/page-rewriter-loaded-1440.png`
- Loaded, 1600×1000: `prototype/page-rewriter-loaded-1600.png`

Corrected rebuilt states:

- Loaded: `rebuilt/page-rewriter-loaded-1440-final.png`, `rebuilt/page-rewriter-loaded-1600-final.png`
- Picker open: `rebuilt/page-rewriter-picker-open-1440-final.png`, `rebuilt/page-rewriter-picker-open-1600-final.png`
- Export open: matching `rebuilt/page-rewriter-export-open-*-final.png` captures in the evidence root
- Focus: matching `rebuilt/page-rewriter-focus-*-final.png` captures in the evidence root
- Empty: matching `rebuilt/page-rewriter-empty-1440-final.png`, `rebuilt/page-rewriter-empty-1600-final.png`
- Mobile floor: `rebuilt/page-rewriter-loaded-mobile-390-final2.png`
- Computed geometry/typography: `rebuilt/page-rewriter-computed-1600.json`

Result: fresh Sol `PASS`. At both required desktop viewports the corrected surface uses the capped design-system spine, compact context/picker, 44/56 workspace split, fixed pane headers, pane-local scrolling, seeded transcript, contained two-row playbooks, compact composer, `Live document` hierarchy, fixed evidence/formatter bands, and honest export-only footer. Picker and export overlays stay contained; the mobile state opens at the context header and stacks without page overflow. Joshua explicitly owner-approved the retained 62px Focus rail and the complete visual pass on 2026-07-10.

## Historical Browser Smoke Evidence

The captures below are behavior-checkpoint baselines from before the 2026-07-10 source-led composition pass. They are retained for regression history but do not verify the final visual pass above.

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

Focus-bridge follow-up: `/tmp/asset-dashboard-codex-parity-captures/wave3-search-focus-smoke-state.json`. Entering focus collapsed the actual rebuilt sidebar and shell grid, preserved the loaded editor text and `pageUrl`, and showed one exit control. Escape restored the normal shell with the same URL, page key, and document length. Save draft and Publish remained absent, with no horizontal overflow or fresh console errors.

## Automated Test Floor

Existing/current branch coverage proves:

- Real `useFeatureFlag('ui-rebuild-shell')` loading-to-loaded transition mounts Page Rewriter.
- `?pageUrl=` validates and auto-loads the page.
- Selecting a sitemap page performs one load even after the successful selection writes `pageUrl` back to the URL.
- Invalid `?pageUrl=` values do not call the load-page endpoint.
- The default page has no top view radiogroup and shows both prototype panes.
- The context, picker, pane order, seeded page-specific greeting, and AI/user avatars are present.
- Chat DOM order is header → independently scrolling transcript → short playbook row → compact composer.
- The document owns one `Live document` header, one formatting toolbar, one compact evidence band, one live-page link, and one Export trigger; page H1 elements remain inside the editor.
- No-page and 502 failure states stay honest and do not expose Export.
- The loaded document pane shows `Export-only draft`, `Not live`, and `Not saved or published to the CMS.`, clears the loading skeleton, and keeps Save draft / Publish rewrite absent.
- The workspace maps important assistant, page picker, generated rewrite, and export status copy to styleguide typography roles.
- Internal rebuild/projection terms are absent from visible loaded states.
- Sitemap picker keyboard load calls the load-page endpoint.
- Editable AI rewrite text applies to the named document section.
- First-429 quota state disables AI actions.
- Back to audit clears the pageUrl handoff.
- Enter/exit focus state is controlled by the rebuilt shell; Escape exits focus while preserving the loaded editor and route state.
- The rebuilt a11y floor passes.
