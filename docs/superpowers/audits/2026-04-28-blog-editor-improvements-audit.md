# Blog Editor Improvements — Pre-Plan Audit

**Date:** 2026-04-28
**Spec:** docs/superpowers/specs/2026-04-28-blog-editor-improvements-design.md
**Total findings:** 22 instances across 4 files requiring changes

---

## Findings by Category

### HARDCODED_WHITE — Bold/formatting fix (3 instances, 1 file)

| File | Line | Value | Context |
|------|------|-------|---------|
| `components/PostEditor.tsx` | 436 | `[&_strong]:text-white` | Introduction view — strong tag color |
| `components/PostEditor.tsx` | 485 | `[&_h2]:text-white` | Conclusion view — h2 tag color |
| `components/PostEditor.tsx` | 485 | `[&_strong]:text-white` | Conclusion view — strong tag color |

**Spec gap found:** The spec only mentioned `[&_strong]:text-white` on line 485. It missed `[&_h2]:text-white` on the same line. Both must be fixed.

**Already correct (no change needed):**
- `SectionEditor.tsx` line 94: `[&_strong]:text-[var(--brand-text-bright)]` ✓
- `PostPreview.tsx` line 32: `[&_strong]:text-[var(--brand-text-bright)]` ✓

---

### TEXTAREA_REPLACE — Content editing textareas to swap for TipTap (6 instances, 3 files)

| File | Line | Context | State variable(s) to remove |
|------|------|---------|------------------------------|
| `components/PostEditor.tsx` | 429 | Intro editing | `introBuffer`, `setIntroBuffer` |
| `components/PostEditor.tsx` | 478 | Conclusion editing | `conclusionBuffer`, `setConclusionBuffer` |
| `components/post-editor/SectionEditor.tsx` | 85 | Section editing | `editBuffer` prop, `onChangeBuffer` prop |
| `components/client/PostReviewCard.tsx` | 166 | Client intro editing | `introDraft`, `setIntroDraft` |
| `components/client/PostReviewCard.tsx` | 202 | Client section editing | `sectionDraft`, `setSectionDraft` |
| `components/client/PostReviewCard.tsx` | 238 | Client conclusion editing | `conclusionDraft`, `setConclusionDraft` |

**All other 35 textarea instances in the codebase are KEEP — confirmed out of scope.**

---

### HTML_STRIP — HTML stripping to remove (3 instances, 1 file)

| File | Line | Code |
|------|------|------|
| `components/client/PostReviewCard.tsx` | 157 | `setIntroDraft(post.introduction.replace(/<[^>]+>/g, ''))` |
| `components/client/PostReviewCard.tsx` | 193 | `setSectionDraft(section.content.replace(/<[^>]+>/g, ''))` |
| `components/client/PostReviewCard.tsx` | 229 | `setConclusionDraft(post.conclusion.replace(/<[^>]+>/g, ''))` |

All three removed when TipTap is wired in. TipTap accepts and renders HTML natively.

---

### PROP_CHANGE — SectionEditor interface changes (4 instances, 2 files)

| File | Line | Change |
|------|------|--------|
| `components/post-editor/SectionEditor.tsx` | 33 | Remove `editBuffer: string` from interface |
| `components/post-editor/SectionEditor.tsx` | 38 | Change `onSaveEdit: () => void` → `onSaveEdit: (html: string) => void` |
| `components/post-editor/SectionEditor.tsx` | 41 | Remove `onChangeBuffer: (value: string) => void` from interface |
| `components/PostEditor.tsx` | 452 | Update `onSaveEdit={saveSectionEdit}` — `saveSectionEdit` must accept `(html: string)` |
| `components/PostEditor.tsx` | 447 | Remove `editBuffer={editBuffer}` prop |
| `components/PostEditor.tsx` | 455 | Remove `onChangeBuffer={setEditBuffer}` prop |

---

## Spec Corrections Required

### 1. Additional hardcoded white on conclusion (h2)
**Missed in spec.** `PostEditor.tsx` line 485 has `[&_h2]:text-white` in addition to `[&_strong]:text-white`. Both must be changed to `text-[var(--brand-text-bright)]`.

### 2. AI review uses `callOpenAI`, not `callAI`
**Spec said:** use `callAI()` for the new `/ai-fix` endpoint.
**Reality:** The existing `/ai-review` endpoint at line 333 uses `callOpenAI({ model: 'gpt-4.1-mini', ... })` directly. CLAUDE.md says new code should use `callAI()`. The new `/ai-fix` endpoint should use `callAI()` (the unified dispatcher), consistent with CLAUDE.md and distinct from the legacy review endpoint.

### 3. No debounce utility exists in the codebase
**Spec assumed debounce is available.** Grep confirmed zero debounce usage anywhere in `src/`. The implementation must either:
- Install `lodash.debounce` + `@types/lodash.debounce`, OR
- Implement with `useRef<ReturnType<typeof setTimeout>>` + `clearTimeout` inline

Recommend: inline `useRef<NodeJS.Timeout>` approach to avoid a new dependency. Pattern:
```ts
const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);
// in onChange handler:
if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
autoSaveTimer.current = setTimeout(() => { /* save */ }, 2000);
```

### 4. PATCH route missing `broadcastToWorkspace`
**CLAUDE.md rule:** every PATCH that changes workspace data must call `broadcastToWorkspace()`. The existing PATCH `/api/content-posts/:workspaceId/:postId` (line 168) does not broadcast `POST_UPDATED` on regular saves — only voice scoring does (line 401). This is a pre-existing bug that CLAUDE.md requires we fix when we touch this file.

**Fix:** Add `broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: req.params.postId })` after line 257 (after successful save) in the PATCH handler.

**Frontend handler exists:** `useWsInvalidation.ts` line 237 handles `POST_UPDATED` — it invalidates `queryKeys.admin.posts(workspaceId)`. Also add `queryKeys.admin.post(workspaceId, postId)` invalidation so the single post view refreshes.

### 5. Phase 2 brief fetch for `internal_links` fix
**Spec assumed** `brief.internalLinkSuggestions` is available in the route handler. The `/ai-fix` endpoint fetches the post from DB but does not automatically have the brief. The handler must also fetch the associated brief (using `briefId` from the post) to get `internalLinkSuggestions`.

---

## Existing Coverage

**CSS overrides:** Not applicable — this feature uses Tailwind arbitrary-value selectors, not a CSS override system.

**Broadcast events:** `CONTENT_PUBLISHED` and `POST_UPDATED` defined in `server/ws-events.ts`. `POST_UPDATED` handler in `useWsInvalidation.ts` but only invalidates post list, not single post query.

**Prevention checks (pr-check.ts):** One related rule found — keydown handlers must early-return for `textarea`/`contenteditable` targets. The new TipTap editor uses `contenteditable` internally, so any global keydown handlers in the app must already guard against it. No new pr-check rule needed.

**No existing debounce patterns** — zero instances in `src/`.

---

## Infrastructure Recommendations

1. **Inline debounce via `useRef<NodeJS.Timeout>`** — 3 identical auto-save call sites (intro, conclusion, sections in PostEditor; same in PostReviewCard). Extract to a `useAutoSave(saveFn, delay)` hook to avoid duplicating the timer logic 6 times. Lives in `src/hooks/useAutoSave.ts`.

2. **`broadcastToWorkspace` on PATCH** — pre-existing gap, fix in Phase 1 since we're already touching `server/routes/content-posts.ts` for Phase 2's new endpoint.

3. **`POST_UPDATED` single-post invalidation** — add `queryKeys.admin.post(workspaceId, postId)` to the WS handler. Currently only the list is invalidated; a refresh triggered by another client (e.g. apply-fix from a second tab) wouldn't update an open PostEditor.

4. **No new pr-check rule needed** — the changes are additive (new component, new endpoint, prop changes). Existing rules cover the file patterns involved.

---

## Parallelization Strategy

### Phase 0 — Shared contracts (sequential, must commit before dispatching agents)

1. Add `AiFixResult` interface to `shared/types/content.ts`
2. Add `aifix()` method signature to `src/api/content.ts` (stub — no implementation yet)
3. Add `useAutoSave` hook to `src/hooks/useAutoSave.ts`
4. Install TipTap deps: `npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-bubble-menu`

### Phase 1A — Independent tasks (parallel, 2 agents)

**Agent 1 — `RichTextEditor` component (Sonnet)**
- Owns: `src/components/post-editor/RichTextEditor.tsx` (new file)
- Creates TipTap editor with bubble menu (Bold, Italic, H2, H3, Link)
- Exports `RichTextEditorProps` interface for downstream agents

**Agent 2 — CSS + preview fixes (Haiku)**
- Owns: `components/PostEditor.tsx` (bold fix only — lines 436, 485), `components/post-editor/PostPreview.tsx` (reading time + any white fixes)
- Mechanical: replace `text-white` with `text-[var(--brand-text-bright)]`, add reading time

### Phase 1B — Editor wiring (parallel, 2 agents; depend on 1A completing)

**Agent 3 — Admin wiring (Sonnet)**
- Owns: `components/PostEditor.tsx` (intro/conclusion TipTap, auto-save, prop updates), `components/post-editor/SectionEditor.tsx` (replace textarea, update props)
- Must NOT touch: `PostReviewCard.tsx`

**Agent 4 — Client wiring (Sonnet)**
- Owns: `components/client/PostReviewCard.tsx` (replace 3 textareas, remove HTML stripping, auto-save, Done button)
- Must NOT touch: `PostEditor.tsx`, `SectionEditor.tsx`

### Phase 1C — Backend broadcast fix (Sonnet, sequential after 1B)
- Owns: `server/routes/content-posts.ts` (add broadcast to PATCH handler), `src/hooks/useWsInvalidation.ts` (add single-post invalidation)

### Phase 2A — AI fix backend (Sonnet)
- Owns: `server/routes/content-posts.ts` (new `/ai-fix` route), brief fetch logic

### Phase 2B — AI fix frontend (Sonnet; depends on 2A for final type shape)
- Owns: `src/components/post-editor/FixDiffModal.tsx` (new), `src/components/post-editor/ReviewChecklist.tsx` (Fix this button), `src/components/PostEditor.tsx` (fix state + handlers)

---

## Model Assignments

| Task | Model | Reasoning |
|------|-------|-----------|
| `RichTextEditor.tsx` creation | Sonnet | Needs TipTap API knowledge, bubble menu wiring |
| Bold/white CSS fix + reading time | Haiku | Mechanical token replacement, no logic |
| Admin editor wiring (PostEditor, SectionEditor) | Sonnet | Interface changes, prop restructure, auto-save logic |
| Client editor wiring (PostReviewCard) | Sonnet | Interface changes, HTML strip removal, auto-save |
| Backend broadcast fix | Haiku | Single `broadcastToWorkspace` call + one invalidation line |
| AI fix backend endpoint | Sonnet | New route, prompt construction per issue type, brief fetch |
| FixDiffModal + ReviewChecklist wiring | Sonnet | New component, multi-state UI, apply logic |
| Verification pass | Sonnet | Full context needed to verify quality gates |
