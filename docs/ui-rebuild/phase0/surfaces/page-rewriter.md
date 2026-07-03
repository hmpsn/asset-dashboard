# Phase 0 Surface Ledger — Page Rewriter (zone: Optimization)

Audited at HEAD of `ui-rebuild-phase-0` (== post-Reconcile `origin/staging`). Read-only audit; every claim carries file:line evidence.

- **HEAD entry point:** `Page` value `'rewrite'` (`src/routes.ts:12`), mounted at `src/App.tsx:438` as `<PageRewriteChat>`.
- **Nav:** `navRegistry.tsx:151-152` — label "Page Rewriter", icon WandSparkles, group `optimization`, `needsSite: true`.
- **Server endpoints:** `GET /api/rewrite-chat/:workspaceId/pages` (`server/routes/rewrite-chat.ts:158`), `POST /api/rewrite-chat/:workspaceId/load-page` (`server/routes/rewrite-chat.ts:175`), `POST /api/rewrite-chat/:workspaceId` (`server/routes/rewrite-chat.ts:217`). All behind `requireWorkspaceAccess` (admin-only; no client route, no tier gate).
- **Prototype view:** `hmpsn studio Design System/mockup/rewrite.js` (218 lines).
- **Parity Ledger row:** "Page Rewriter" → `rewrite.js`, status `improved` (Platform Parity Ledger.html, `{nm:'Page Rewriter', comp:'PageRewriteChat · rewrite', ... status:'improved'}`).

## Capability table

Status legend: `preserved` (obvious home, same or better) · `improved` (prototype upgrades it) · `new_proposed` (prototype-only, needs sign-off) · `at_risk` (exists at HEAD, no visible home in prototype).

### Shell / navigation

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 1 | Admin route `'rewrite'`, per-workspace remount (`key`) | `src/routes.ts:12`; `src/App.tsx:438` | preserved | Page Rewriter view (Optimization zone) | Handoff Brief zone map lists Page Rewriter under Optimization. |
| 2 | Full-height two-pane layout (chat left, document right; independent scroll) | `src/App.tsx:248`; `PageRewriteChat.tsx:64-128` | preserved | `rewrite.js` `.rw-panes` (44%/1fr grid) | Prototype mirrors this explicitly (rewrite.js:2-5,25). |
| 3 | Focus mode: header toggle, sidebar collapses to 14px exit strip, Esc exits (editable-target guard), auto-reset on nav away | `src/App.tsx:186-209,458-459`; `Sidebar.tsx:54-55,159-168`; `PageRewriteHeaderBar.tsx:170-186` | preserved | `rewrite.js:158,213` ("Focus mode" button, toast stub) | Prototype stubs it but names the exact behavior ("Hides the rail"). Esc + strip behaviors must carry. |
| 4 | Back button → navigates to `seo-audit`, clears pending page URL | `src/App.tsx:438`; `PageRewriteHeaderBar.tsx:54-63` | preserved | View header | New IA back-target may differ; behavior (escape hatch to audit context) should survive. |
| 5 | `needsSite` lock: nav item disabled until a Webflow site is linked | `navRegistry.tsx:151`; `Sidebar.tsx:234` | preserved | Locked state (Build Conventions four-states rule) | Prototype filters to non-`new` clients only (rewrite.js:79). |
| 6 | `initialPageUrl` prop auto-loads a page on mount (deep-link contract) — **no live caller sets it at HEAD** (only `setRewritePageUrl(null)`) | `src/App.tsx:186,438`; `usePageRewriteChatShell.ts:89-92` | at_risk | none | Vestigial cross-surface deep-link (originally from SEO Audit). See open question Q3. |

### Page selection & loading

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 7 | Sitemap page combobox fed by latest audit snapshot (`GET .../pages`), React Query key `admin-rewrite-pages`, 5-min staleTime | `usePageRewriteChatShell.ts:62-66`; `server/routes/rewrite-chat.ts:158-172`; `src/lib/queryKeys.ts:98` | preserved | `rw-picker` + `pick()` (rewrite.js:153-157,212) | Prototype's picker toast says "Search the sitemap or paste a URL". |
| 8 | Filter pages by slug/title; hierarchical indent by slug depth | `usePageRewriteChatShell.ts:209-215`; `pageRewriteChatModel.ts:64-67`; `PageRewriteHeaderBar.tsx:152` | preserved | Page picker | |
| 9 | Paste an arbitrary URL (http/https detection) and load any public page | `pageRewriteChatModel.ts:69-72`; `usePageRewriteChatShell.ts:359-362`; `PageRewriteHeaderBar.tsx:120-132` | preserved | Page picker | Named in prototype pick() copy. |
| 10 | Combobox keyboard nav (ArrowUp/Down, Enter, Escape) + ARIA combobox/option semantics | `usePageRewriteChatShell.ts:231-246`; `PageRewriteHeaderBar.tsx:106-116,142-152` | preserved | Page picker | Prototype has no keyboard model — must be re-specified in the DS combobox. |
| 11 | Empty-sitemap fallback copy ("No sitemap — paste a full URL above") + no-match state | `PageRewriteHeaderBar.tsx:161-165` | preserved | Page picker empty state | |
| 12 | Server page load: `fetchPublicWebText` (15s timeout, follow redirects), returns title/sections/bodyText/preamble/html(50k cap)/issues/slug | `server/routes/rewrite-chat.ts:175-214` | preserved | Backend unchanged | UI rebuild should not touch this contract. |
| 13 | Section extraction handles Webflow div-wrapped copy (balanced-`div` tokenizer), `<li>`/`<blockquote>`, preamble before first heading | `server/routes/rewrite-chat.ts:63-155`; `tests/unit/rewrite-chat-tokenizer.test.ts` | preserved | Backend unchanged | |
| 14 | Per-page audit issues resolved from latest SEO audit snapshot by slug | `server/routes/rewrite-chat.ts:193-201` | preserved | Backend unchanged | Display half is at risk — see #28. |
| 15 | Load states: no-page empty state, loading spinner, fetch error state (502 with HTTP status detail) | `PageRewriteDocumentPane.tsx:50-72`; `server/routes/rewrite-chat.ts:205-212` | preserved | Four-states rule | Prototype shows none of these; conventions require them. |

### Chat pane

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 16 | Chat empty state + 6 quick prompts (only when a page is loaded) | `PageRewriteChatPane.tsx:44-74`; `pageRewriteChatModel.ts:47-54` | improved | `rw-play` playbook chips (rewrite.js:108-114,164) | Prototype upgrades one-shot empty-state prompts to always-visible playbook chips. |
| 17 | Send message: Enter sends / Shift+Enter newline; send disabled while sending or empty; "Analyzing and writing..." indicator | `usePageRewriteChatShell.ts:192-197,154-190`; `PageRewriteChatPane.tsx:146-153,169-177` | preserved | Chat input (rewrite.js:165-168) | |
| 18 | General AI answers rendered as Markdown with Copy button | `PageRewriteChatPane.tsx:120-137` | preserved | Chat bubble | |
| 19 | Rewrite answers parsed via `**Rewriting: X**` label + `BEGIN_REWRITE/END_REWRITE` delimiters → editor-safe prose extraction | `src/lib/rewriteResponse.ts` (whole file); `usePageRewriteChatShell.ts:175-176` | preserved | Chat bubble `.sec` block (rewrite.js:128-135) | Output-format contract co-designed with prompt (rewrite-chat.ts:275-278). Must not regress. |
| 20 | Inline edit of the AI rewrite text *before* applying (contentEditable bubble, `msgEdits`) | `PageRewriteChatPane.tsx:86-97,100`; `usePageRewriteChatShell.ts:44` | at_risk | none visible | Prototype's `.sec` block is static; apply uses canned text (rewrite.js:205-209). |
| 21 | Apply to named section: `data-section` slug match, replaces content under that heading, 2s teal highlight, fallback insert-at-end + info toast | `usePageRewriteChatShell.ts:248-253`; `pageRewriteChatActions.ts` (`applyRewriteToSection`); `PageRewriteChatPane.tsx:98-107` | at_risk | `apply()` (rewrite.js:205-209) | Prototype hardcodes "Apply to intro" / first paragraph only. Arbitrary-section targeting + fallback toast have no demonstrated home. |
| 22 | Copy message / copy rewrite to clipboard with 2s "Copied" state + failure toast | `usePageRewriteChatShell.ts:199-206`; `PageRewriteChatPane.tsx:108-117` | preserved | `copy()` (rewrite.js:210) | |
| 23 | Per-mount session id (`rewrite-{ts}-{rand}`) feeding server chat memory | `pageRewriteChatModel.ts:56-58`; `usePageRewriteChatShell.ts:41` | preserved | Backend contract | Chat transcript itself is ephemeral client state at HEAD (fresh on remount) — same in prototype. |

### AI generation (server)

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 24 | Chat endpoint: `callAI` gpt-5.4, temp 0.6, maxTokens 4000, `feature: 'rewrite-chat'`; 400 when `OPENAI_API_KEY` missing | `server/routes/rewrite-chat.ts:226-227,296-304` | preserved | Backend unchanged | |
| 25 | System prompt: SEO copywriter persona + AEO principles + rewrite output contract (label + delimiters, plain prose inside) | `server/routes/rewrite-chat.ts:264-287` | preserved | Backend unchanged | |
| 26 | Page-assist intelligence context: keyword, brand voice, personas, knowledge, page profile, and **playbook** blocks (`buildPageAssistContext`, `includeContentPipeline: true`) | `server/routes/rewrite-chat.ts:240-244,287`; `server/intelligence/page-assist-context-builder.ts:33-53,98-152` | preserved | Backend unchanged | Parity Ledger's "Playbook / instruction presets" func maps here + to quick prompts (#16). |
| 27 | Voice DNA layering via `buildSystemPrompt`; loaded page content (6k cap) + first 20 audit issues injected; conversation history (last 12) + prior-context summary; message persistence; auto session summary at ≥6 messages; `chat_session` activity log on start | `server/routes/rewrite-chat.ts:230-238,246-262,289-294,308-318` | preserved | Backend unchanged | No WS broadcasts, no background jobs on this surface. |

### Document pane

| # | Capability | Evidence (HEAD) | Status | Home in new IA | Notes |
|---|-----------|-----------------|--------|----------------|-------|
| 28 | Audit issue chips strip on the loaded document (first 20, severity-coded error/warning/info) | `PageRewriteDocumentPane.tsx:128-145` | at_risk | none | Prototype document pane has no issues display at all. |
| 29 | Document rendered from extracted sections with `data-section` slugs + preamble; pageKey guard prevents re-init clobbering user edits | `pageRewriteChatDocument.ts:29-52`; `usePageRewriteChatShell.ts:364-371` | preserved | `rw-doc` block model (rewrite.js:141-144,180-183) | Prototype uses per-block contenteditable; HEAD uses one contenteditable body. Either preserves editing. |
| 30 | contentEditable document (`role=textbox`, spellcheck, aria-label) | `PageRewriteDocumentPane.tsx:147-156` | preserved | `rw-doc` | |
| 31 | Formatting: Bold / Italic / H2 / H3 (H2/H3 re-assign `data-section` slug on the new heading) | `pageRewriteChatActions.ts` (`execFormatCommand`, `wrapSelectionHeading`); `PageRewriteDocumentPane.tsx:164-174` | improved | Fixed toolbar (rewrite.js:173-179) | Prototype promotes the floating selection toolbar to an always-visible toolbar — a discoverability upgrade. `data-section` re-slugging must carry (feeds #21). |
| 32 | Clear formatting action (`removeFormat` + reset block to `p`) | `pageRewriteChatActions.ts` (`clearFormattingSelection`); `PageRewriteDocumentPane.tsx:176-178` | at_risk | none | Prototype toolbar has B/I/H2/H3 only. |
| 33 | Floating selection toolbar positioned via `selectionchange` (clamped to panel) | `usePageRewriteChatShell.ts:105-122`; `PageRewriteDocumentPane.tsx:158-180` | improved | Superseded by fixed toolbar | Mechanism replaced, function (formatting access) kept — acceptable if #31/#32 carry. |
| 34 | Open live page in new tab (`target=_blank` link on slug) | `PageRewriteDocumentPane.tsx:77-85` | at_risk | none | Prototype header shows the URL as text only (rewrite.js:155). |
| 35 | Export: Copy as Markdown + Download .md | `usePageRewriteChatShell.ts:337-351`; `pageRewriteChatDocument.ts:54` (`serializeDocToMarkdown`); `PageRewriteDocumentPane.tsx:99-110` | preserved | `export()` (rewrite.js:214: "Copy as HTML, Markdown…") | |
| 36 | Export: Download .docx (docx lib, styled H1-H4, letter-size doc) | `usePageRewriteChatShell.ts:283-335`; `pageRewriteChatDocument.ts:118` (`serializeDocToDocx`) | at_risk | none | Not in prototype export toast. FEATURE_AUDIT #449 confirms md/docx/pdf all shipped. |
| 37 | Export: Download PDF (hidden print root, scoped print CSS, `window.print`, afterprint cleanup) | `usePageRewriteChatShell.ts:257-281`; `pageRewriteChatDocument.ts:100` (`buildPrintableDocHtml`) | at_risk | none | FEATURE_AUDIT.md:1271-1279 ("449. Page Rewriter PDF Export"). |
| 38 | Export popover interactions: outside-click close + Escape close (with editable-target guard) | `usePageRewriteChatShell.ts:124-152` | preserved | Export menu | |

### Prototype-only proposals (need owner sign-off)

| # | Capability | Evidence (prototype) | Status | Notes |
|---|-----------|----------------------|--------|-------|
| 39 | **Save draft** — persist the rewritten document as a draft ("Rewrite stored — not yet live") | rewrite.js:186,215 | new_proposed | No draft persistence exists at HEAD for this surface; document edits are lost on unmount. Needs a storage decision (see Q1/Q4). |
| 40 | **Publish rewrite** — push the rewritten copy live to Webflow | rewrite.js:187,216 | new_proposed | **No CMS write-back exists at HEAD in Page Rewriter** (`server/routes/rewrite-chat.ts` has zero Webflow writes; exports only). The Parity Ledger's funcs list ("Apply back to CMS") overstates HEAD. See Q1. |
| 41 | Draft-status line ("Draft — not yet published to Webflow") | rewrite.js:184-185 | new_proposed | Depends on #39/#40. |
| 42 | Export target "push to a new draft" (into content pipeline?) | rewrite.js:214 | new_proposed | Undefined destination; needs scoping. |
| 43 | Proactive seeded AI greeting naming the page's target keyword ("Its target is 'kw'") | rewrite.js:118-123 | new_proposed | HEAD injects keywords server-side into the prompt only (#26); surfacing the target keyword in the UI is new. Data exists (keyword strategy pageMap). |

**Counts:** 43 capabilities — preserved 27, improved 3, new_proposed 5, at_risk 8.

## Prototype coverage notes

`mockup/rewrite.js` self-describes as "Mirrors PageRewriteChat.tsx" (lines 2-5). It demonstrates the two-pane workspace, page picker (stub), playbook chips, chat-driven rewrite loop with apply/copy, focus mode (stub), fixed formatting toolbar, editable document blocks, export (stub), and adds a save-draft/publish spine that HEAD lacks. It uses purple as the AI accent — permitted (admin-AI surface).

Notable omissions (the at_risk set): audit issue chips, open-live-page link, docx/pdf export, edit-before-apply, arbitrary `data-section` apply targeting (prototype hardcodes intro), clear-formatting, and the dead-but-present `initialPageUrl` deep-link contract. Loading/error/empty/locked states are absent from the prototype but mandated by Build Conventions (four-states rule), so they are counted preserved, not at_risk.

## Parity Ledger reconciliation

- Row: `Page Rewriter → rewrite.js`, status **improved**. No `Gap` or `Partial` rows exist for this surface in the ledger — nothing to resolve.
- **Discrepancy found:** the ledger's `funcs` list for the live platform includes "Apply back to CMS". That function does **not** exist at HEAD — `server/routes/rewrite-chat.ts` performs no Webflow/CMS writes; the only "apply" is into the local contenteditable document, and the only egress is export (md/docx/pdf/clipboard). The mockup's Save draft / Publish rewrite are therefore **new functionality requiring sign-off**, not parity carry-over. (Webflow meta-field writes live on the SEO Editor surface — `server/routes/webflow-seo-apply.ts`, `webflow-seo-rewrite.ts` — a different surface's audit.)

## Trade-offs (quick win vs full)

| Item | Quick win | Full version | Risk of quick win |
|------|-----------|--------------|-------------------|
| Publish to Webflow (#40) | Ship parity: export-only egress (keep all four HEAD export modes), hide Save draft/Publish buttons behind a flag | Server write-target for full-page copy (static DOM vs CMS-field resolution, cf. `docs/rules/seo-editor-write-targets.md`), draft/publish lifecycle + activity log + broadcast | Mockup promises a publish spine; operators may expect it on day one. Ledger already (incorrectly) claims it exists. |
| Playbook chips (#16) | Render HEAD's static `QUICK_PROMPTS` as always-visible chips (pure UI change) | Chips sourced from the workspace's actual playbook patterns (already fetched server-side via `playbookBlock`, `page-assist-context-builder.ts:152`) — needs a small read endpoint | Static chips can contradict the workspace playbook the AI is actually following. |
| Save draft (#39) | Client-side persistence (localStorage keyed by workspace+slug) | Server-persisted rewrite drafts (new table + migration, lifecycle states, resume-on-return) | Local drafts silently lost across devices/browsers; "Draft saved" toast would over-promise. |
| Apply-to-section (#21) | Port HEAD's `data-section` mechanism unchanged under the new UI | Per-block apply targets like the mockup's block model (block-level contenteditable with per-block ids) | None material — quick win is full parity; full version is UX polish. |
| Exports (#35-37) | Keep the HEAD export menu verbatim (md copy/.md/.docx/.pdf) and add "Copy as HTML" | Add "push to a new draft" pipeline hand-off (#42) once its destination is defined | Dropping docx/pdf to match the mockup toast would be a hard-stop capability loss. |

## Open questions (stop-and-ask)

1. **Q1 — Publish/Save-draft spine (new capability):** The prototype adds Save draft + Publish-to-Webflow for full-page copy. HEAD has no full-page copy write path (SEO Editor writes meta fields only; content posts publish to CMS collections). Building it is a new server capability with a hard write-target problem (static-page DOM vs CMS item fields). Approve scope, or ship export-only parity first? Note the Parity Ledger mislabels this as an existing live function — ledger row should be corrected either way.
2. **Q2 — Export modes:** Prototype export toast says "Copy as HTML, Markdown, or push to a new draft"; HEAD ships Markdown copy, .md, .docx, .pdf. Additive mandate says keep all four — confirm .docx/.pdf stay in the new export menu, and define what "push to a new draft" targets (content pipeline post? rewrite draft from Q1?).
3. **Q3 — `initialPageUrl` deep-link:** The prop and auto-load path exist (`App.tsx:438`, shell:89-92) but no caller sets a non-null value at HEAD — the SEO-Audit-era entry point is dead. Carry a "Rewrite this page" deep-link into the new IA (e.g. from SEO Audit / Page Intelligence rows) or formally retire the contract? Retiring by omission is not allowed without sign-off.
4. **Q4 — Document persistence expectation:** HEAD loses all document edits on unmount (fresh remount per workspace, pageKey re-init). The prototype's draft-status line implies persistence. If Q1's full version is deferred, is losing edits on navigation acceptable for v1 (status quo), or is the localStorage quick win required?
5. **Q5 — At-risk micro-features:** Confirm homes for the 8 at_risk rows (#6, #20, #21, #28, #32, #34, #36, #37) — especially audit issue chips (#28) and edit-before-apply (#20), which shape the core review loop and have no visual slot in the prototype's panes.
