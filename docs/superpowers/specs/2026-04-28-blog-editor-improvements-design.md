# Blog/Content Generator — Editor & UX Improvements

**Date:** 2026-04-28
**Status:** Approved
**Scope:** Two PRs — Phase 1 (editor + fixes), Phase 2 (AI reviewer fix flow)

---

## Overview

Six improvements to the blog/content generator, split across two PRs:

| # | Improvement | PR |
|---|-------------|-----|
| 1 | Fix bold text invisible in light mode | 1 |
| 2 | Replace raw HTML textarea with TipTap bubble menu editor (admin + client) | 1 |
| 3 | Auto-save with debounce + "Saved" indicator | 1 |
| 4 | Reading time estimate in preview | 1 |
| 5 | Keyboard shortcuts (Cmd+B/I/K — free with TipTap) | 1 |
| 6 | AI reviewer "Fix this" → diff preview → apply | 2 |

---

## Phase 1: Editor + Fixes

### 1. Bold text fix

**Root cause:** `PostEditor.tsx` lines 436 and 485 use hardcoded `[&_strong]:text-white`. White text is invisible on light-mode backgrounds.

**Fix:** Three hardcoded instances, all in `PostEditor.tsx`:
- Line 436: `[&_strong]:text-white` → `[&_strong]:text-[var(--brand-text-bright)]`
- Line 485: `[&_h2]:text-white` → `[&_h2]:text-[var(--brand-text-bright)]`
- Line 485: `[&_strong]:text-white` → `[&_strong]:text-[var(--brand-text-bright)]`

The token resolves to `#e4e4e7` in dark mode and `#0f172a` in light mode — correct in both. `SectionEditor.tsx` line 94 and `PostPreview.tsx` line 32 already use the token correctly.

### 2. RichTextEditor component

**New file:** `src/components/post-editor/RichTextEditor.tsx`

**Dependencies to install:**
```
@tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-bubble-menu
```

**Extensions:**
- `StarterKit` — bold (Cmd+B), italic (Cmd+I), H2, H3, bullet list, ordered list, paragraph, hard break
- `Link` — with `openOnClick: false`; Cmd+K opens inline URL input in the bubble menu
- `BubbleMenu` — appears on text selection

**Bubble menu items:** Bold, Italic, H2, H3, Link (link button reveals a small URL input inline; Enter applies, Escape cancels)

**Props:**
```ts
interface RichTextEditorProps {
  initialValue: string;       // HTML string
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}
```

TipTap manages content state internally. `onChange` fires on every editor change. Auto-save debounce and "Saved" indicator logic live in the **parent components**, not inside `RichTextEditor`. This keeps the component reusable for both auto-save (admin) and explicit-save (not used here, but future-proof) contexts.

**No lodash.debounce — use `useRef<NodeJS.Timeout>`:** There is no existing debounce utility in the codebase. Extract a `useAutoSave(saveFn, delay)` hook to `src/hooks/useAutoSave.ts` to avoid duplicating the timer pattern across 6 call sites. Pattern:
```ts
const timer = useRef<NodeJS.Timeout | null>(null);
// in onChange: clear + reset timer
if (timer.current) clearTimeout(timer.current);
timer.current = setTimeout(() => saveFn(html), delay);
```

Content is stored and returned as HTML — same format as today. No schema migration needed.

### 3. Edit sites to replace (admin)

Three textarea instances in the admin flow:

**`SectionEditor.tsx` line 85:**
- Replace `<textarea>` with `<RichTextEditor>`
- Remove `editBuffer: string` and `onChangeBuffer` props — TipTap holds state internally
- Change `onSaveEdit` signature to `onSaveEdit: (html: string) => void`
- Parent (`PostEditor.tsx`) adds `useMemo(() => debounce(saveSectionEdit, 2000), [])` for auto-save
- Show "Saved" indicator in `SectionEditor` after save callback resolves

**`PostEditor.tsx` intro editing (line 429):**
- Replace `<textarea value={introBuffer}>` with `<RichTextEditor initialValue={post.introduction} onChange={...} />`
- Remove `introBuffer` state
- Debounce the `onChange` callback 2s then call `saveField({ introduction: html })`

**`PostEditor.tsx` conclusion editing (line 478):**
- Same pattern as intro. Remove `conclusionBuffer` state.

### 4. Edit sites to replace (client)

**`PostReviewCard.tsx`** — three textarea instances (intro, sections, conclusion):

- Replace textareas with `<RichTextEditor>`
- **Remove the `.replace(/<[^>]+>/g, '')` stripping** when entering edit mode (lines 157, 193, 229) — TipTap renders HTML natively
- `introDraft`, `sectionDraft`, `conclusionDraft` state stays, now holds HTML
- Debounce `onChange` 2s then call existing `saveIntro`/`saveSection`/`saveConclusion` — these already accept HTML strings, no changes needed
- Replace **Save** button with a **Done** button that collapses back to view mode (auto-save already committed the content)
- Remove **Cancel** button (nothing to discard with auto-save)
- Show "Saved" indicator same as admin

### 5. Auto-save indicator

Shared pattern across all 6 edit sites (3 admin, 3 client):

```
saveStatus: 'idle' | 'saving' | 'saved'
```

- `saving` → show spinner + "Saving…" text (small, muted)
- `saved` → show "Saved" text, fade out after 1.5s → return to `idle`
- Displayed inline near the Done/collapse control

### 6. Reading time

**`PostPreview.tsx`:**
```tsx
const readingTime = Math.ceil(post.totalWordCount / 200);
// Display: "~{readingTime} min read"
```

Placed next to the existing word count display. Uses `totalWordCount` already present on `GeneratedPost` — no new data needed.

---

## Phase 2: AI Reviewer "Fix This"

### New backend endpoint

**Route:** `POST /api/content-posts/:workspaceId/:postId/ai-fix`

**Auth:** Same as existing content-posts routes (HMAC token via global gate).

**Request body:**
```ts
{
  issueKey: 'factual_accuracy' | 'brand_voice' | 'internal_links' |
            'no_hallucinations' | 'meta_optimized' | 'word_count_target';
  reason: string;  // the AI's reason from the original review pass
}
```

**What it does:**
1. Fetch the full post from DB (verify workspaceId ownership via `requireWorkspaceAccess`)
2. For `internal_links`: also fetch the associated brief using `post.briefId` to get `internalLinkSuggestions`
3. Build a targeted prompt based on `issueKey` (see prompt strategies below)
4. Call `callAI()` (the unified dispatcher from `server/ai.ts`) — NOT `callOpenAI` directly, per CLAUDE.md convention for new code
5. Parse response into `AiFixResult`

**Response:**
```ts
interface AiFixResult {
  field: 'introduction' | 'section' | 'conclusion' | 'meta';
  sectionIndex?: number;      // only when field === 'section'
  originalText: string;       // the specific HTML fragment being replaced
  suggestedText: string;      // AI's proposed replacement (HTML, or JSON for meta)
  explanation: string;        // 1-sentence plain-English summary of what changed
}
```

**Prompt strategies by issue key:**

| `issueKey` | Target field | Strategy |
|------------|-------------|----------|
| `internal_links` | section (most relevant) | Rewrite one sentence to include a link from `brief.internalLinkSuggestions`. Return `<a href="...">` in HTML. |
| `meta_optimized` | meta | Rewrite `seoTitle` (50–60 chars) and `seoMetaDescription` (150–160 chars). Return as `{ seoTitle, seoMetaDescription }` JSON in `suggestedText`. |
| `word_count_target` | section (shortest) | Expand the shortest section by ~20%. Return full section HTML. |
| `brand_voice` | introduction | Rewrite the intro to better match voice calibration context. Return full intro HTML. |
| `factual_accuracy` | section (flagged) | Identify the suspicious claim and rewrite conservatively. Add note to verify in `explanation`. |
| `no_hallucinations` | section (flagged) | Same as `factual_accuracy`. |

### New API client method

**`src/api/content.ts`:**
```ts
aifix(workspaceId: string, postId: string, body: { issueKey: string; reason: string }): Promise<AiFixResult>
```

Add `AiFixResult` to `shared/types/content.ts`.

### Frontend: "Fix this" button

**`ReviewChecklist.tsx`:**
- Add `onRequestFix?: (issueKey: string, reason: string) => void` prop
- For each failed AI review item (`aiResults[item.key]?.pass === false`), render a **"Fix this"** button next to the "AI: Review" badge
- Button click calls `onRequestFix(item.key, aiResults[item.key].reason)` and enters loading state
- While loading: button shows spinner + "Fixing…", disabled

### New `FixDiffModal` component

**`src/components/post-editor/FixDiffModal.tsx`**

**Props:**
```ts
interface FixDiffModalProps {
  issueLabel: string;        // e.g. "Internal links verified and working"
  result: AiFixResult | null;
  loading: boolean;
  applying: boolean;         // true while apply is in-flight; shows spinner on Apply button
  onApply: (result: AiFixResult) => void;
  onDismiss: () => void;
}
```

**Three states:**

1. **Loading** (`loading === true`) — centered spinner, "Generating fix…"
2. **Ready** (`result !== null`) — two-panel diff:
   - Left panel: original text, red background tint, strikethrough styling
   - Right panel: suggested text, green background tint
   - Below: `result.explanation` in muted text
   - Buttons: **Apply** (teal) and **Dismiss** (ghost)
3. **Applying** — brief spinner after Apply clicked before modal closes

For `field === 'meta'`: render the two meta fields as labelled text rows rather than HTML diff panels.

Modal is rendered as an overlay in `PostEditor.tsx` (not inside `ReviewChecklist` — keeps the checklist component clean).

### Wiring in `PostEditor.tsx`

**State:**
```ts
const [fixLoading, setFixLoading] = useState(false);
const [fixResult, setFixResult] = useState<AiFixResult | null>(null);
const [fixIssueLabel, setFixIssueLabel] = useState('');
```

**`handleRequestFix(issueKey, reason)`:**
1. Set `fixLoading = true`, `fixIssueLabel = label for issueKey`
2. Call `contentPosts.aifix(workspaceId, postId, { issueKey, reason })`
3. Set `fixResult = result`, `fixLoading = false`

**`handleApplyFix(result)`:**
- `field === 'introduction'` → `saveField({ introduction: result.suggestedText })`
- `field === 'section'` → update `post.sections[result.sectionIndex!].content = result.suggestedText`, call patch API
- `field === 'conclusion'` → `saveField({ conclusion: result.suggestedText })`
- `field === 'meta'` → parse `result.suggestedText` as JSON, call `saveField({ seoTitle, seoMetaDescription })`
- After apply: set `fixResult = null`, invalidate React Query cache

**`<FixDiffModal>`** is rendered at the bottom of `PostEditor.tsx` JSX, always mounted, hidden when `!fixLoading && !fixResult`.

---

## Pre-existing bug fix (Phase 1)

The PATCH `/api/content-posts/:workspaceId/:postId` route does not currently broadcast `POST_UPDATED` after saves — CLAUDE.md requires every mutating endpoint to broadcast. Fix in Phase 1 when touching `server/routes/content-posts.ts`:

1. Add `broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: req.params.postId })` after successful save in the PATCH handler.
2. In `src/hooks/useWsInvalidation.ts`, add `queryKeys.admin.post(workspaceId, postId)` invalidation alongside the existing list invalidation in the `POST_UPDATED` handler.

---

## Files changed

### Phase 1

| File | Change |
|------|--------|
| `package.json` | Add `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-bubble-menu` |
| `src/hooks/useAutoSave.ts` | **New** — `useAutoSave(saveFn, delay)` hook using `useRef<NodeJS.Timeout>` |
| `src/components/post-editor/RichTextEditor.tsx` | **New** — TipTap editor with bubble menu |
| `src/components/PostEditor.tsx` | Replace intro/conclusion textareas; add auto-save debounce + indicator; bold fix; broadcast fix wiring |
| `src/hooks/useWsInvalidation.ts` | Add single-post query invalidation to `POST_UPDATED` handler |
| `server/routes/content-posts.ts` | Add `broadcastToWorkspace` to PATCH handler (pre-existing bug fix) |
| `src/components/post-editor/SectionEditor.tsx` | Replace textarea; simplify props; add auto-save |
| `src/components/post-editor/PostPreview.tsx` | Add reading time; fix any `text-white` on inline elements |
| `src/components/client/PostReviewCard.tsx` | Replace 3 textareas; remove HTML stripping; add auto-save; Done button |

### Phase 2

| File | Change |
|------|--------|
| `shared/types/content.ts` | Add `AiFixResult` interface |
| `src/api/content.ts` | Add `aifix()` method |
| `server/routes/content-posts.ts` | Add `POST /:workspaceId/:postId/ai-fix` route |
| `src/components/post-editor/FixDiffModal.tsx` | **New** — diff preview modal |
| `src/components/post-editor/ReviewChecklist.tsx` | Add `onRequestFix` prop; "Fix this" buttons |
| `src/components/PostEditor.tsx` | Add fix state + handlers; render `<FixDiffModal>` |

---

## Quality gates

**Phase 1:**
- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — builds successfully
- [ ] `npx tsx scripts/pr-check.ts` — zero errors
- [ ] Bold text visible in both light and dark mode
- [ ] Bubble menu appears on text selection in all 6 edit sites (admin + client)
- [ ] Auto-save fires 2s after last keystroke; "Saved" indicator appears and fades
- [ ] Reading time shows in preview
- [ ] Cmd+B, Cmd+I, Cmd+K work in editor

**Phase 2:**
- [ ] "Fix this" button visible on failed AI review items only
- [ ] Spinner shown while fix is loading
- [ ] Diff modal shows original vs. suggested text correctly
- [ ] Apply updates the correct field in the post
- [ ] Dismiss closes without changes
- [ ] React Query cache invalidated after apply
