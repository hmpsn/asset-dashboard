# Page Rewriter UI — Design Spec

**Date:** 2026-04-09
**Status:** Ready for implementation planning

---

## Overview

Four concrete improvements to `PageRewriteChat.tsx`:

1. **Sitemap combobox** — replace the raw URL input with a searchable page picker that browses the site's audit snapshot
2. **Editable document panel** — replace the raw text dump on the right with a properly formatted, directly editable document view including a light formatting toolbar
3. **Apply + Export** — AI suggestions are editable before applying; applying patches the document in-place with a visual highlight; Export generates clean markdown
4. **Focus mode** — collapse the dashboard sidebar so the rewriter (chat + document, layout unchanged) fills the full browser width

These changes make the page rewriter feel like a real editing environment rather than a chat with a preview pane.

---

## Out of Scope

- **Inline text selection → bot targeting** — highlighting a paragraph to target the AI at a specific section. That interaction belongs to the upcoming Copy & Brand Engine and should be designed there with this feature's document panel as a reference point.
- **Track changes / revision history** — no undo beyond the browser's native contenteditable undo stack
- **Collaborative editing** — single-user only
- **Full rich text editor** — no tables, images, or block types beyond headings and inline bold/italic

---

## 1. Sitemap Combobox

### Replaces
The current `<input type="url">` + "Load Page" button at the top of the left panel.

### Behavior

**Closed (no page loaded):** Single input line reading `Search pages or paste a URL…`

**Open:** Typing filters the sitemap list by slug or page title. Pasting a full URL (detected by `https://` prefix) bypasses the list and loads the URL directly — preserving the existing flow for pages not in the sitemap. Pages are grouped with visual indentation matching their URL depth (e.g. `/blog/*` children are indented under `/blog`).

**Closed (page loaded):** Collapses to a single line showing the page slug and a `Change` link that reopens the picker. The picker does not re-open on click anywhere else — only on the `Change` link or when the user clears the field.

### Data source
A new endpoint `GET /api/rewrite-chat/:workspaceId/pages` returns the page list from the workspace's latest audit snapshot (`getLatestSnapshot`). Returns `{ slug, title }[]` sorted alphabetically by slug. If no snapshot exists, returns `[]` and the combobox shows only the URL paste fallback.

### UX notes
- Keyboard navigation: arrow keys move through the list, Enter selects, Escape closes
- Max list height: 240px with scroll
- No loading state needed — snapshot is in-process memory, response is instant

---

## 2. Editable Document Panel

### Replaces
The current four-section right panel (title, collapsible audit issues, heading structure list, raw body text).

### Structure (top to bottom)

**Panel header bar:**
- Page slug as a link that opens the live page in a new tab (↗)
- `Export brief` button (right-aligned) — see section 3

**Audit issue chips:**
- Pinned below the header, above the document body
- One chip per issue: `[severity icon] message` — red for errors, amber for warnings
- Chips are read-only and non-collapsible (always visible as a quick reference while editing)
- Only shown if issues exist; hidden otherwise

**Document body (contenteditable):**
- The full page content rendered as a formatted document
- Heading hierarchy:
  - H1: 20px bold, full color (`text-slate-100`)
  - H2: 15px semibold, slightly muted (`text-slate-300`), no indent
  - H3: 12px medium, muted (`text-slate-400`), 12px left indent + 2px left border (`border-slate-700`)
  - H4+: same as H3, additional 12px indent per level
- Body text: 13px, `text-slate-500`, line-height 1.7, paragraphs separated by 12px margin
- The entire body is `contenteditable="true"` — clicking anywhere places a cursor and enables typing

### Formatting toolbar

A floating toolbar that appears above any text selection within the document panel. Disappears when selection is cleared.

**Buttons:** Bold (`B`) · Italic (`I`) · `H2` · `H3` · Clear formatting (×)

Implementation: `document.execCommand` for bold/italic (sufficient for this use case, no library needed). H2/H3 buttons wrap the selected block in the appropriate heading element. Clear formatting strips all inline styles and heading wrappers from the selection.

The toolbar is absolutely positioned relative to the selection using `window.getSelection().getRangeAt(0).getBoundingClientRect()`. It appears above the selection with a small vertical offset and stays within the panel bounds.

### Section identification (for Apply)

Each heading in the document body is given a `data-section` attribute set to a normalized slug of the heading text (e.g. `"why-saas-seo-is-different"`). This is used by the Apply mechanism to locate the correct section without relying on DOM position.

---

## 3. Apply & Export

### Apply flow

When the AI returns a rewrite response:

1. **The AI message is editable.** The response text renders in a lightly styled editable block (a `contenteditable` div with a subtle border). The user can tweak the copy before applying.

2. **"Apply to [section]" button** appears below the editable block. The section label is derived from the heading context the user provided in their message (or inferred by the AI from the prompt). The button label shows which section it targets: `Apply to intro`, `Apply to Why SaaS SEO Is Different`, etc.

3. **On click:** The Apply handler finds the matching `data-section` heading in the document panel, replaces the text nodes between that heading and the next sibling heading with the (possibly user-edited) suggestion text, then briefly highlights the affected block with a teal left border + background (`bg-teal-950/40 border-l-2 border-teal-500`) that fades out after 2 seconds via CSS transition.

4. If no matching section is found, Apply falls back to appending the suggestion at the cursor position (or end of document if no cursor).

5. A `Copy` button always appears alongside Apply for cases where the user prefers to paste manually.

### Section context in chat messages

The AI prompt is updated to instruct the model to prefix rewrite responses with a short section label in the format `**Rewriting: [Heading Name]**` on the first line. The Apply handler strips this prefix before inserting into the document.

### Export

The `Export brief` button in the panel header triggers a small two-button popover:

- **Copy as Markdown** — serializes the current document DOM to Markdown (headings → `#`/`##`/`###`, bold → `**`, italic → `*`, paragraphs → newline-separated), prepends the audit issues as a `## Issues` block, and copies to clipboard
- **Download .md** — same content, downloaded as `[page-slug]-brief.md`

No server round-trip needed — serialization runs client-side on the live document body.

---

## 4. Focus Mode

A **focus mode toggle button** (⤢ icon) in the page rewriter header collapses the dashboard sidebar — the workspace icon rail and the tab navigation — so the rewriter fills the full browser width. The internal 50/50 split between chat and document panel is unchanged; both panels simply get wider.

**Behavior:**
- Toggle button lives in the top-right of the rewriter header
- Clicking collapses the sidebar; clicking again (or pressing Escape) restores it
- State is a `focusMode` boolean in `App.tsx`, passed to the sidebar via the existing layout props/context — no routing change, no new pages
- A slim exit affordance (narrow strip or `◀` chevron) remains at the left edge in focus mode so the user can exit without hunting for the button
- Focus mode is local to the rewriter page; navigating away resets it to off

---

## Component Changes

| File | Change |
|------|--------|
| `src/components/PageRewriteChat.tsx` | Replace URL input with combobox; replace right panel with editable document view; add toolbar; add Apply logic; add Export; add focus mode toggle button |
| `src/components/layout/Sidebar.tsx` | Accept `hidden` prop; renders a slim exit strip when hidden |
| `src/App.tsx` | Add `focusMode` state; pass to Sidebar and PageRewriteChat |
| `server/routes/rewrite-chat.ts` | Add `GET /:workspaceId/pages` endpoint returning slug+title list from latest snapshot |

The pages fetch is made directly from the component via the existing `post`/`get` helper (same pattern as the current `load-page` and chat calls — no separate API module needed).

No changes to the chat backend, intelligence assembly, or prompt construction beyond the section label instruction addition.

---

## Design Handoff Notes for Copy Engine

The document panel introduced here (contenteditable + formatting toolbar + section identification via `data-section`) is the natural foundation for the copy engine's inline targeting interaction. When the copy engine designs "select text → target bot at this section," it should extend this component rather than build a parallel editor. The `data-section` attribute system and the Apply handler are the integration points.
