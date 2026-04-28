# Blog/Content Generator — Editor & UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the blog/content editor with TipTap rich text editing (admin + client), auto-save, reading time, bold-text visibility fix, and a Phase 2 AI "Fix this" diff-preview flow.

**Architecture:** Phase 1 installs TipTap and replaces 6 textarea instances with a shared `RichTextEditor` component wired to a `useAutoSave` hook; Phase 2 adds a backend `/ai-fix` endpoint plus `FixDiffModal` + `ReviewChecklist` wiring. All new server code uses `callAI()` (the unified dispatcher). Auto-save uses `useRef<NodeJS.Timeout>` debounce, no lodash dependency.

**Tech Stack:** `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-bubble-menu`, React 19, Express + TypeScript, `callAI()` from `server/ai.ts`, vitest + `@testing-library/react` for tests.

---

## Dependency Graph

```
Task 1 (shared contracts) → Tasks 2, 3, 8, 9 (all parallel)
Task 3 (RichTextEditor) → Tasks 4, 7 (parallel)
Task 4 (SectionEditor) → Task 5 (PostEditor admin)
Tasks 8 + 9 → Task 10 (Phase 2 wiring)
Task 6 (WS invalidation) → standalone, any time
```

**Parallelization:**
- After Task 1 commits: run Tasks 2, 3, 8, 9 in parallel (four agents)
- After Task 3 commits: run Tasks 4, 7 in parallel (two agents)
- After Task 4 commits: run Task 5
- After Task 5 and 6 and 7 commit: Phase 1 done → verification pass
- After Tasks 8 and 9 commit: run Task 10
- Final verification pass covers Phase 2

---

## File Map

| File | Action |
|------|--------|
| `package.json` | Add TipTap deps |
| `shared/types/content.ts` | Add `AiFixResult` interface |
| `src/api/content.ts` | Add `aifix()` method |
| `src/hooks/useAutoSave.ts` | **New** |
| `tests/unit/useAutoSave.test.ts` | **New** |
| `src/components/post-editor/RichTextEditor.tsx` | **New** |
| `src/components/post-editor/SectionEditor.tsx` | Swap textarea → RichTextEditor; update props |
| `src/components/PostEditor.tsx` | Auto-save wiring; bold fix; Phase 2 fix handlers |
| `src/hooks/useWsInvalidation.ts` | Add single-post invalidation to POST_UPDATED |
| `server/routes/content-posts.ts` | Add broadcast to PATCH; add `/ai-fix` route |
| `src/components/post-editor/PostPreview.tsx` | Add reading time |
| `src/components/client/PostReviewCard.tsx` | Swap textareas; remove HTML stripping; auto-save |
| `src/components/post-editor/FixDiffModal.tsx` | **New** |
| `src/components/post-editor/ReviewChecklist.tsx` | Export `CHECKLIST_ITEMS`; add `onRequestFix` + "Fix this" buttons |
| `tests/integration/content-posts-ai-fix.test.ts` | **New** — port 13329 |

---

## Task 1: Shared Contracts

**Sequential — must commit before any other task starts.**

**Files:**
- Modify: `shared/types/content.ts`
- Modify: `src/api/content.ts`
- Create: `src/hooks/useAutoSave.ts`
- Create: `tests/unit/useAutoSave.test.ts`
- Modify: `package.json`

### Step 1.1: Add `AiFixResult` to shared types

- [ ] Open `shared/types/content.ts`. After the last interface in the file, add:

```ts
export interface AiFixResult {
  field: 'introduction' | 'section' | 'conclusion' | 'meta';
  sectionIndex?: number;
  originalText: string;
  suggestedText: string;
  explanation: string;
}
```

### Step 1.2: Add `aifix()` to the API client

- [ ] Open `src/api/content.ts`. Add the import at the top (update the existing `import type { ... } from '../../shared/types/content'` line to include `AiFixResult`):

```ts
import type { ContentBrief, GeneratedPost, ContentTopicRequest, ContentTemplate, ContentMatrix, KeywordCandidate, AiFixResult } from '../../shared/types/content';
```

- [ ] In the `contentPosts` object, add after `scoreVoice` and before the closing `}`:

```ts
  aifix: (wsId: string, postId: string, body: { issueKey: string; reason: string }) =>
    post<AiFixResult>(`/api/content-posts/${wsId}/${postId}/ai-fix`, body),
```

### Step 1.3: Write the failing test for `useAutoSave`

- [ ] Create `tests/unit/useAutoSave.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoSave } from '../../src/hooks/useAutoSave';

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls saveFn after delay', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => { result.current.scheduleAutoSave('<p>hello</p>'); });
    expect(saveFn).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(500); });
    expect(saveFn).toHaveBeenCalledWith('<p>hello</p>');
  });

  it('debounces rapid calls — only fires the last value', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    act(() => {
      result.current.scheduleAutoSave('<p>v1</p>');
      result.current.scheduleAutoSave('<p>v2</p>');
      result.current.scheduleAutoSave('<p>v3</p>');
    });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('<p>v3</p>');
  });

  it('flush fires immediately and prevents duplicate timer fire', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 2000));

    act(() => { result.current.scheduleAutoSave('<p>pending</p>'); });
    await act(async () => { await result.current.flush(); });
    expect(saveFn).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(saveFn).toHaveBeenCalledTimes(1); // no second fire
  });

  it('flush is a no-op when nothing is pending', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave(saveFn, 500));

    await act(async () => { await result.current.flush(); });
    expect(saveFn).not.toHaveBeenCalled();
  });
});
```

- [ ] Run test — expect FAIL with "Cannot find module":

```bash
npx vitest run tests/unit/useAutoSave.test.ts
```

Expected: FAIL — module not found.

### Step 1.4: Implement `useAutoSave`

- [ ] Create `src/hooks/useAutoSave.ts`:

```ts
import { useRef, useState, useCallback } from 'react';

type SaveStatus = 'idle' | 'saving' | 'saved';

export function useAutoSave(
  saveFn: (html: string) => Promise<void> | void,
  delay = 2000,
) {
  const saveFnRef = useRef(saveFn);
  saveFnRef.current = saveFn; // always-current ref — no stale closure issues

  const timer = useRef<NodeJS.Timeout | null>(null);
  const pendingHtml = useRef<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const doSave = useCallback(async (html: string) => {
    setSaveStatus('saving');
    try {
      await saveFnRef.current(html);
      pendingHtml.current = null;
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 1500);
    } catch {
      setSaveStatus('idle');
    }
  }, []);

  const scheduleAutoSave = useCallback((html: string) => {
    pendingHtml.current = html;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { doSave(html); }, delay);
  }, [doSave, delay]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pendingHtml.current !== null) await doSave(pendingHtml.current);
  }, [doSave]);

  return { scheduleAutoSave, flush, saveStatus };
}
```

### Step 1.5: Run tests — expect PASS

- [ ] Run:

```bash
npx vitest run tests/unit/useAutoSave.test.ts
```

Expected: 4 tests pass.

### Step 1.6: Install TipTap dependencies

- [ ] Run:

```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-bubble-menu
```

Expected: packages added to `package.json` and `package-lock.json`.

### Step 1.7: Typecheck and commit

- [ ] Run:

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] Commit:

```bash
git add shared/types/content.ts src/api/content.ts src/hooks/useAutoSave.ts tests/unit/useAutoSave.test.ts package.json package-lock.json
git commit -m "feat: shared contracts — AiFixResult type, aifix() API method, useAutoSave hook, TipTap deps"
```

---

## Task 2: Bold Text Fix + Reading Time

**Parallel with Task 3. Depends on Task 1 completing.**

**Files:**
- Modify: `src/components/PostEditor.tsx` (3 text-white instances only)
- Modify: `src/components/post-editor/PostPreview.tsx`

### Step 2.1: Fix hardcoded `text-white` in PostEditor.tsx

- [ ] In `src/components/PostEditor.tsx`, find line 436 (introduction view HTML rendering). Replace:

```
[&_strong]:text-white
```

with:

```
[&_strong]:text-[var(--brand-text-bright)]
```

- [ ] On line 485 (conclusion view HTML rendering), the className has `[&_h2]:text-white` AND `[&_strong]:text-white`. Replace both:

```
[&_h2]:text-white
```
→
```
[&_h2]:text-[var(--brand-text-bright)]
```

```
[&_strong]:text-white
```
→
```
[&_strong]:text-[var(--brand-text-bright)]
```

That's 3 total replacements (1 on line 436, 2 on line 485).

### Step 2.2: Add reading time to `PostPreview.tsx`

- [ ] Open `src/components/post-editor/PostPreview.tsx`. Add `totalWordCount` to the local `GeneratedPost` interface (after `conclusion`):

```ts
interface GeneratedPost {
  title: string;
  introduction: string;
  sections: PostSection[];
  conclusion: string;
  totalWordCount: number;
}
```

- [ ] Add `totalWordCount` to `PostPreviewProps`:

```ts
export interface PostPreviewProps {
  post: GeneratedPost;
}
```

(No change needed — `post` already covers it via the updated interface.)

- [ ] In the JSX, after the `<h1>` tag (line 33), add the reading time display:

```tsx
<h1 className="text-xl font-bold text-[var(--brand-text-bright)] mb-4">{post.title}</h1>
<div className="flex items-center gap-3 mb-4 t-caption text-[var(--brand-text-muted)]">
  <span>{post.totalWordCount.toLocaleString()} words</span>
  <span>·</span>
  <span>~{Math.ceil(post.totalWordCount / 200)} min read</span>
</div>
```

- [ ] Find the call site in `PostEditor.tsx` where `<PostPreview>` is rendered and verify `post` is passed (it already carries `totalWordCount` in PostEditor's own `GeneratedPost` interface at line 39) — no prop change needed.

### Step 2.3: Typecheck and commit

- [ ] Run:

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] Commit:

```bash
git add src/components/PostEditor.tsx src/components/post-editor/PostPreview.tsx
git commit -m "fix: bold text visible in both modes; add reading time to preview"
```

---

## Task 3: RichTextEditor Component

**Parallel with Task 2. Depends on Task 1 completing.**

**Files:**
- Create: `src/components/post-editor/RichTextEditor.tsx`

### Step 3.1: Create the component

- [ ] Create `src/components/post-editor/RichTextEditor.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

export interface RichTextEditorProps {
  initialValue: string;
  onChange: (html: string) => void;
  className?: string;
}

export function RichTextEditor({ initialValue, onChange, className }: RichTextEditorProps) {
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
    ],
    content: initialValue,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (showLinkInput) {
      setTimeout(() => linkInputRef.current?.focus(), 0);
    }
  }, [showLinkInput]);

  const applyLink = () => {
    if (!editor) return;
    if (linkUrl) {
      editor.chain().focus().setLink({ href: linkUrl }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setShowLinkInput(false);
    setLinkUrl('');
  };

  return (
    <div className={`relative ${className ?? ''}`}>
      {editor && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100 }}
          className="flex items-center gap-0.5 bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg shadow-xl p-1 z-40"
        >
          {showLinkInput ? (
            <div className="flex items-center gap-1 px-1">
              <input
                ref={linkInputRef}
                type="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                  if (e.key === 'Escape') { setShowLinkInput(false); setLinkUrl(''); }
                }}
                placeholder="https://..."
                className="w-44 bg-transparent text-[var(--brand-text)] text-xs px-1 py-0.5 focus:outline-none border-b border-teal-500/50"
              />
              <button
                onMouseDown={e => { e.preventDefault(); applyLink(); }}
                className="t-caption-sm text-teal-300 hover:text-teal-200 px-1 py-0.5"
              >
                OK
              </button>
              <button
                onMouseDown={e => { e.preventDefault(); setShowLinkInput(false); setLinkUrl(''); }}
                className="t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] px-1 py-0.5"
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <button
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleBold().run(); }}
                className={`px-2 py-1 rounded text-xs font-bold transition-colors ${editor.isActive('bold') ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
              >
                B
              </button>
              <button
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleItalic().run(); }}
                className={`px-2 py-1 rounded text-xs italic transition-colors ${editor.isActive('italic') ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
              >
                I
              </button>
              <button
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${editor.isActive('heading', { level: 2 }) ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
              >
                H2
              </button>
              <button
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 3 }).run(); }}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors ${editor.isActive('heading', { level: 3 }) ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
              >
                H3
              </button>
              <button
                onMouseDown={e => {
                  e.preventDefault();
                  const href = editor.getAttributes('link').href as string | undefined;
                  if (href) setLinkUrl(href);
                  setShowLinkInput(true);
                }}
                className={`px-2 py-1 rounded text-xs transition-colors ${editor.isActive('link') ? 'bg-teal-500/20 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
                title="Link (Cmd+K)"
              >
                🔗
              </button>
            </>
          )}
        </BubbleMenu>
      )}
      <EditorContent
        editor={editor}
        className={[
          '[&_.ProseMirror]:min-h-[120px] [&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2',
          '[&_.ProseMirror]:bg-[var(--surface-1)] [&_.ProseMirror]:border [&_.ProseMirror]:border-[var(--brand-border)]',
          '[&_.ProseMirror]:rounded-[var(--radius-lg)] [&_.ProseMirror]:text-xs [&_.ProseMirror]:text-[var(--brand-text)]',
          '[&_.ProseMirror]:focus:border-teal-500/50 [&_.ProseMirror]:focus:outline-none',
          '[&_.ProseMirror_p]:mb-2 [&_.ProseMirror_strong]:text-[var(--brand-text-bright)]',
          '[&_.ProseMirror_h2]:text-sm [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-[var(--brand-text-bright)] [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-2',
          '[&_.ProseMirror_h3]:text-xs [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-[var(--brand-text-bright)] [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1',
          '[&_.ProseMirror_ul]:pl-4 [&_.ProseMirror_ul]:mb-2 [&_.ProseMirror_ol]:pl-4 [&_.ProseMirror_ol]:mb-2',
          '[&_.ProseMirror_li]:mb-1 [&_.ProseMirror_a]:text-teal-400 [&_.ProseMirror_a]:underline',
        ].join(' ')}
      />
    </div>
  );
}
```

### Step 3.2: Typecheck and commit

- [ ] Run:

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] Commit:

```bash
git add src/components/post-editor/RichTextEditor.tsx
git commit -m "feat: RichTextEditor component with TipTap bubble menu (B/I/H2/H3/Link)"
```

---

## Task 4: SectionEditor Wiring

**Depends on Task 3. Can run in parallel with Task 7.**

**Files:**
- Modify: `src/components/post-editor/SectionEditor.tsx`

The full interface change: remove `editBuffer`, `onChangeBuffer`, `onSaveEdit`, `onCancelEdit`; add `onChange`, `onDone`, `saveStatus`; change `onStartEdit` signature to remove `content` param.

### Step 4.1: Update `SectionEditorProps` interface

- [ ] In `src/components/post-editor/SectionEditor.tsx`, replace the entire `SectionEditorProps` interface (lines 29–42) and destructure in the function signature:

```tsx
export interface SectionEditorProps {
  section: PostSection;
  expanded: boolean;
  editing: boolean;
  regenerating: boolean;
  isGenerating: boolean;
  saveStatus: 'idle' | 'saving' | 'saved';
  onToggleExpand: (index: number) => void;
  onStartEdit: (index: number) => void;
  onChange: (html: string) => void;
  onDone: () => Promise<void>;
  onRegenerate: (index: number) => void;
}

export function SectionEditor({
  section, expanded, editing, regenerating, isGenerating, saveStatus,
  onToggleExpand, onStartEdit, onChange, onDone, onRegenerate,
}: SectionEditorProps) {
```

### Step 4.2: Add RichTextEditor import

- [ ] At the top of `SectionEditor.tsx`, after the existing imports, add:

```tsx
import { RichTextEditor } from './RichTextEditor';
import { useAutoSave } from '../../hooks/useAutoSave';
```

Wait — `useAutoSave` is NOT used inside SectionEditor itself. The hook lives in the parent (PostEditor). SectionEditor only receives `onChange` and `onDone` as props. Remove the `useAutoSave` import from this step.

- [ ] Only add:

```tsx
import { RichTextEditor } from './RichTextEditor';
```

### Step 4.3: Replace the editing branch JSX

- [ ] Find the `editing ? (` branch (the `<div className="space-y-2">` block that starts at line 84) and replace the entire editing branch:

```tsx
          ) : editing ? (
            <div className="space-y-2">
              <RichTextEditor
                initialValue={section.content}
                onChange={onChange}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={onDone}
                  className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"
                >
                  <Check className="w-3 h-3" /> Done
                </button>
                {saveStatus === 'saving' && (
                  <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                  </span>
                )}
                {saveStatus === 'saved' && (
                  <span className="t-caption-sm text-emerald-400/70">Saved</span>
                )}
              </div>
            </div>
```

### Step 4.4: Update the `onStartEdit` call in the view branch

- [ ] Find `onClick={() => onStartEdit(section.index, section.content)}` (line 96) and change to:

```tsx
onClick={() => onStartEdit(section.index)}
```

### Step 4.5: Typecheck

- [ ] Run:

```bash
npm run typecheck
```

Expected: errors in `PostEditor.tsx` because the call site hasn't been updated yet — that's expected and will be fixed in Task 5. If there are errors ONLY in PostEditor.tsx, proceed. If errors are in SectionEditor.tsx itself, fix them first.

### Step 4.6: Commit

```bash
git add src/components/post-editor/SectionEditor.tsx
git commit -m "feat: SectionEditor — replace textarea with RichTextEditor, Done button + saved indicator"
```

---

## Task 5: PostEditor Admin Wiring + Server Broadcast Fix

**Depends on Tasks 3 and 4. Owns PostEditor.tsx and server/routes/content-posts.ts.**

**Files:**
- Modify: `src/components/PostEditor.tsx`
- Modify: `server/routes/content-posts.ts`

### Step 5.1: Add new imports to PostEditor.tsx

- [ ] In `src/components/PostEditor.tsx`, update the existing imports section. Add to the existing React import:

```tsx
import { useState, useEffect, useRef } from 'react';
```

(Add `useRef` if not already there — check the existing import at line 1.)

- [ ] After the existing `import { ReviewChecklist } from './post-editor/ReviewChecklist';` line, add:

```tsx
import { RichTextEditor } from './post-editor/RichTextEditor';
import { useAutoSave } from '../hooks/useAutoSave';
```

### Step 5.2: Remove buffer states, add auto-save hooks

- [ ] In `PostEditor.tsx`, remove these three state declarations (lines 97, 99, 101):

```tsx
const [editBuffer, setEditBuffer] = useState('');
const [introBuffer, setIntroBuffer] = useState('');
const [conclusionBuffer, setConclusionBuffer] = useState('');
```

- [ ] In their place, add three `useAutoSave` hook calls (place right after the `const [editingConclusion, setEditingConclusion] = useState(false);` line):

```tsx
const saveSectionContent = async (html: string) => {
  if (editingSection === null || !post) return;
  const sections = [...post.sections];
  sections[editingSection] = { ...sections[editingSection], content: html };
  await saveField({ sections });
};
const { scheduleAutoSave: scheduleSectionSave, flush: flushSection, saveStatus: sectionSaveStatus } = useAutoSave(saveSectionContent);

const { scheduleAutoSave: scheduleIntroSave, flush: flushIntro, saveStatus: introSaveStatus } = useAutoSave(
  async (html: string) => { await saveField({ introduction: html }); },
);

const { scheduleAutoSave: scheduleConclusionSave, flush: flushConclusion, saveStatus: conclusionSaveStatus } = useAutoSave(
  async (html: string) => { await saveField({ conclusion: html }); },
);
```

**Important:** `saveSectionContent` closes over `editingSection` and `post`. Because `useAutoSave` uses `saveFnRef.current = saveFn` on every render, this closure is always fresh — no stale data.

### Step 5.3: Remove old save functions

- [ ] Delete the `saveSectionEdit` function (lines 163–173) and `saveIntroEdit` (lines 175–178) and `saveConclusionEdit` (lines 181–184). These are replaced by the auto-save hooks.

### Step 5.4: Replace the intro textarea with RichTextEditor

- [ ] Find the intro editing branch in PostEditor.tsx (around line 427–434). Replace:

```tsx
              ) : editingIntro ? (
                <div className="space-y-2">
                  <textarea value={introBuffer} onChange={e => setIntroBuffer(e.target.value)} className="w-full bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg px-3 py-2 text-xs text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none resize-y min-h-[100px]" rows={6} />
                  <div className="flex items-center gap-2">
                    <button onClick={saveIntroEdit} className="px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"><Icon as={Check} size="sm" /> Save</button>
                    <button onClick={() => setEditingIntro(false)} className="px-3 py-1.5 rounded-lg t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">Cancel</button>
                  </div>
                </div>
```

with:

```tsx
              ) : editingIntro ? (
                <div className="space-y-2">
                  <RichTextEditor
                    initialValue={post.introduction}
                    onChange={scheduleIntroSave}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => { await flushIntro(); setEditingIntro(false); }}
                      className="px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"
                    >
                      <Icon as={Check} size="sm" /> Done
                    </button>
                    {introSaveStatus === 'saving' && (
                      <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                        <Icon as={Loader2} size="sm" className="animate-spin" /> Saving…
                      </span>
                    )}
                    {introSaveStatus === 'saved' && (
                      <span className="t-caption-sm text-emerald-400/70">Saved</span>
                    )}
                  </div>
                </div>
```

- [ ] Remove the "Edit" button's `onClick` that set `introBuffer` — replace with just `setEditingIntro(true)`:

Find:
```tsx
onClick={() => { setEditingIntro(true); setIntroBuffer(post.introduction); }}
```
Replace with:
```tsx
onClick={() => setEditingIntro(true)}
```

### Step 5.5: Replace the conclusion textarea with RichTextEditor

- [ ] Find the conclusion editing branch (around line 476–483). Replace:

```tsx
              ) : editingConclusion ? (
                <div className="space-y-2">
                  <textarea value={conclusionBuffer} onChange={e => setConclusionBuffer(e.target.value)} className="w-full bg-[var(--surface-1)] border border-[var(--brand-border)] rounded-lg px-3 py-2 text-xs text-[var(--brand-text-bright)] focus:border-teal-500/50 focus:outline-none resize-y min-h-[80px]" rows={4} />
                  <div className="flex items-center gap-2">
                    <button onClick={saveConclusionEdit} className="px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"><Icon as={Check} size="sm" /> Save</button>
                    <button onClick={() => setEditingConclusion(false)} className="px-3 py-1.5 rounded-lg t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">Cancel</button>
                  </div>
                </div>
```

with:

```tsx
              ) : editingConclusion ? (
                <div className="space-y-2">
                  <RichTextEditor
                    initialValue={post.conclusion}
                    onChange={scheduleConclusionSave}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => { await flushConclusion(); setEditingConclusion(false); }}
                      className="px-3 py-1.5 rounded-lg t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors flex items-center gap-1"
                    >
                      <Icon as={Check} size="sm" /> Done
                    </button>
                    {conclusionSaveStatus === 'saving' && (
                      <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                        <Icon as={Loader2} size="sm" className="animate-spin" /> Saving…
                      </span>
                    )}
                    {conclusionSaveStatus === 'saved' && (
                      <span className="t-caption-sm text-emerald-400/70">Saved</span>
                    )}
                  </div>
                </div>
```

- [ ] Remove the `setConclusionBuffer` call from the conclusion "Edit" button:

Find:
```tsx
onClick={() => { setEditingConclusion(true); setConclusionBuffer(post.conclusion); }}
```
Replace with:
```tsx
onClick={() => setEditingConclusion(true)}
```

### Step 5.6: Update SectionEditor call sites

- [ ] Find the `<SectionEditor ... />` JSX block (around line 443–456). Replace with:

```tsx
            <SectionEditor
              key={section.index} section={section}
              expanded={expandedSections.has(section.index)}
              editing={editingSection === section.index}
              regenerating={regenerating === section.index}
              isGenerating={isGenerating}
              saveStatus={editingSection === section.index ? sectionSaveStatus : 'idle'}
              onToggleExpand={toggleSection}
              onStartEdit={(index) => setEditingSection(index)}
              onChange={scheduleSectionSave}
              onDone={async () => { await flushSection(); setEditingSection(null); }}
              onRegenerate={handleRegenerate}
            />
```

### Step 5.7: Add broadcast to the PATCH handler in content-posts.ts

- [ ] In `server/routes/content-posts.ts`, find line 257:

```ts
  res.json(updated);
```

Insert before it (note: this is inside the PATCH handler, after the auto-publish block):

```ts
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: req.params.postId });
  res.json(updated);
```

(`broadcastToWorkspace` and `WS_EVENTS` are already imported at lines 10 and 35.)

### Step 5.8: Add `callAI` import to content-posts.ts

- [ ] In `server/routes/content-posts.ts`, add to the existing imports after `callOpenAI`:

```ts
import { callAI } from '../ai.js';
```

### Step 5.9: Typecheck and commit

- [ ] Run:

```bash
npm run typecheck && npx vite build
```

Expected: zero errors, successful build.

- [ ] Run:

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors.

- [ ] Commit:

```bash
git add src/components/PostEditor.tsx server/routes/content-posts.ts
git commit -m "feat: PostEditor admin wiring — RichTextEditor, auto-save (intro/conclusion/sections), broadcast fix"
```

---

## Task 6: useWsInvalidation Single-Post Fix

**Standalone — no dependencies. Can run any time after Task 1.**

**Files:**
- Modify: `src/hooks/useWsInvalidation.ts`

### Step 6.1: Update `POST_UPDATED` handler

- [ ] In `src/hooks/useWsInvalidation.ts`, find the `POST_UPDATED` handler (lines 237–240):

```ts
    [WS_EVENTS.POST_UPDATED]: () => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) });
    },
```

Replace with:

```ts
    [WS_EVENTS.POST_UPDATED]: (payload: { postId: string }) => {
      if (!workspaceId) return;
      qc.invalidateQueries({ queryKey: queryKeys.admin.posts(workspaceId) });
      if (payload?.postId) {
        qc.invalidateQueries({ queryKey: queryKeys.admin.post(workspaceId, payload.postId) });
      }
    },
```

### Step 6.2: Typecheck and commit

- [ ] Run:

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] Commit:

```bash
git add src/hooks/useWsInvalidation.ts
git commit -m "fix: POST_UPDATED WS handler — also invalidate single-post cache"
```

---

## Task 7: PostReviewCard Client Wiring

**Parallel with Task 4. Depends on Task 3. Owns PostReviewCard.tsx.**

**Files:**
- Modify: `src/components/client/PostReviewCard.tsx`

### Step 7.1: Add imports

- [ ] At the top of `src/components/client/PostReviewCard.tsx`, add after existing imports:

```tsx
import { RichTextEditor } from '../post-editor/RichTextEditor';
import { useAutoSave } from '../../hooks/useAutoSave';
import { Loader2 } from 'lucide-react';
```

(Check existing imports first with `grep -n '^import' src/components/client/PostReviewCard.tsx` — only add what isn't already imported.)

### Step 7.2: Add three auto-save hooks

- [ ] After the state declarations for `introDraft`, `sectionDraft`, `conclusionDraft`, add three `useAutoSave` hooks.

First, verify the `saveIntro`, `saveSection`, `saveConclusion` function signatures in PostReviewCard (they already accept HTML strings — no change needed).

Add these hooks after the state declarations:

```tsx
const { scheduleAutoSave: scheduleIntroSave, flush: flushIntro, saveStatus: introSaveStatus } = useAutoSave(
  async (html: string) => { await saveIntro(html); },
);

const saveSectionContent = (html: string) => {
  if (editingSection === null) return;
  return saveSection(editingSection, html);
};
const { scheduleAutoSave: scheduleSectionSave, flush: flushSection, saveStatus: sectionSaveStatus } = useAutoSave(saveSectionContent);

const { scheduleAutoSave: scheduleConclusionSave, flush: flushConclusion, saveStatus: conclusionSaveStatus } = useAutoSave(
  async (html: string) => { await saveConclusion(html); },
);
```

### Step 7.3: Replace the intro textarea

- [ ] Find the intro editing branch (textarea at line 166). Replace the entire `<div className="space-y-2">` editing block:

```tsx
        {editingIntro ? (
          <div className="space-y-2">
            <RichTextEditor
              initialValue={post.introduction}
              onChange={scheduleIntroSave}
            />
            <div className="flex gap-2 items-center">
              <button
                onClick={async () => { await flushIntro(); setEditingIntro(false); }}
                className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors"
              >
                Done
              </button>
              {introSaveStatus === 'saving' && (
                <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </span>
              )}
              {introSaveStatus === 'saved' && (
                <span className="t-caption-sm text-emerald-400/70">Saved</span>
              )}
            </div>
          </div>
```

- [ ] Remove the `.replace(/<[^>]+>/g, '')` from the intro "Edit" button onClick (line 157):

Find:
```tsx
onClick={() => { setIntroDraft(post.introduction.replace(/<[^>]+>/g, '')); setEditingIntro(true); }}
```
Replace with:
```tsx
onClick={() => setEditingIntro(true)}
```

(The `introDraft` state is no longer used for the intro — can be removed later, but TypeScript won't error if it's just unused. To keep things clean, remove `introDraft` and `setIntroDraft` if they're only used for intro. If they serve other purposes, leave them.)

### Step 7.4: Replace the section textarea

- [ ] Find the section editing branch (textarea at line 202). Replace the entire editing block:

```tsx
          {editingSection === section.index ? (
            <div className="space-y-2">
              <RichTextEditor
                initialValue={section.content}
                onChange={scheduleSectionSave}
              />
              <div className="flex gap-2 items-center">
                <button
                  onClick={async () => { await flushSection(); setEditingSection(null); }}
                  className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors"
                >
                  Done
                </button>
                {sectionSaveStatus === 'saving' && (
                  <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                  </span>
                )}
                {sectionSaveStatus === 'saved' && (
                  <span className="t-caption-sm text-emerald-400/70">Saved</span>
                )}
              </div>
            </div>
```

- [ ] Remove the `.replace(/<[^>]+>/g, '')` from the section "Edit" button (line 193):

Find:
```tsx
onClick={() => { setSectionDraft(section.content.replace(/<[^>]+>/g, '')); setEditingSection(section.index); }}
```
Replace with:
```tsx
onClick={() => setEditingSection(section.index)}
```

### Step 7.5: Replace the conclusion textarea

- [ ] Find the conclusion editing branch (textarea at line 238). Replace the entire editing block:

```tsx
        {editingConclusion ? (
          <div className="space-y-2">
            <RichTextEditor
              initialValue={post.conclusion}
              onChange={scheduleConclusionSave}
            />
            <div className="flex gap-2 items-center">
              <button
                onClick={async () => { await flushConclusion(); setEditingConclusion(false); }}
                className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 t-caption-sm text-teal-300 hover:bg-teal-600/30 transition-colors"
              >
                Done
              </button>
              {conclusionSaveStatus === 'saving' && (
                <span className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </span>
              )}
              {conclusionSaveStatus === 'saved' && (
                <span className="t-caption-sm text-emerald-400/70">Saved</span>
              )}
            </div>
          </div>
```

- [ ] Remove the `.replace(/<[^>]+>/g, '')` from the conclusion "Edit" button (line 229):

Find:
```tsx
onClick={() => { setConclusionDraft(post.conclusion.replace(/<[^>]+>/g, '')); setEditingConclusion(true); }}
```
Replace with:
```tsx
onClick={() => setEditingConclusion(true)}
```

### Step 7.6: Clean up unused draft state variables

- [ ] Remove `introDraft`/`setIntroDraft`, `sectionDraft`/`setSectionDraft`, `conclusionDraft`/`setConclusionDraft` state declarations if they are now entirely unused. Verify with TypeScript errors after removal. If any remain used in other spots, keep them.

### Step 7.7: Typecheck and commit

- [ ] Run:

```bash
npm run typecheck && npx vite build
```

Expected: zero errors.

- [ ] Run:

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors.

- [ ] Commit:

```bash
git add src/components/client/PostReviewCard.tsx
git commit -m "feat: PostReviewCard — TipTap editor, auto-save, Done button, remove HTML stripping"
```

---

## Task 8: /ai-fix Backend Endpoint

**Parallel with Task 9. Depends on Task 1. Owns server/routes/content-posts.ts (ai-fix section only).**

**Files:**
- Modify: `server/routes/content-posts.ts`
- Create: `tests/integration/content-posts-ai-fix.test.ts`

### Step 8.1: Write the failing test first

- [ ] Create `tests/integration/content-posts-ai-fix.test.ts`:

```ts
/**
 * Integration tests for POST /api/content-posts/:workspaceId/:postId/ai-fix
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupOpenAIMocks, mockOpenAIJsonResponse, mockOpenAIResponse, resetOpenAIMocks } from '../mocks/openai.js';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { savePost } from '../../server/content-posts.js';
import { savePost as saveBrief } from '../../server/content-brief.js';

setupOpenAIMocks();

const ctx = createTestContext(13329);
const { authPostJson } = ctx;

let wsId = '';
let postId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('AI Fix Test Workspace');
  wsId = ws.id;

  const post = savePost(wsId, {
    id: `post_test_aifix`,
    briefId: 'brief_none',
    targetKeyword: 'test keyword',
    title: 'Test Post',
    metaDescription: 'A test post',
    seoTitle: 'Test Post',
    seoMetaDescription: 'A test post description',
    introduction: '<p>This is the introduction.</p>',
    sections: [
      { index: 0, heading: 'Section One', content: '<p>Section one content here.</p>', wordCount: 5, targetWordCount: 100, keywords: [], status: 'done' },
    ],
    conclusion: '<p>This is the conclusion.</p>',
    totalWordCount: 20,
    targetWordCount: 500,
    status: 'draft',
  });
  postId = post.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(wsId);
  ctx.stopServer();
});

describe('POST /api/content-posts/:wsId/:postId/ai-fix', () => {
  it('returns 400 for unknown issueKey', async () => {
    const res = await authPostJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'not_a_real_key',
      reason: 'test',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when reason is missing', async () => {
    const res = await authPostJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'brand_voice',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown post', async () => {
    mockOpenAIResponse('content-fix', '<p>Fixed</p>');
    const res = await authPostJson(`/api/content-posts/${wsId}/not_a_real_post/ai-fix`, {
      issueKey: 'brand_voice',
      reason: 'voice mismatch',
    });
    expect(res.status).toBe(404);
  });

  it('brand_voice — returns AiFixResult targeting introduction', async () => {
    mockOpenAIResponse('content-fix', '<p>Improved introduction.</p>');
    const res = await authPostJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'brand_voice',
      reason: 'Brand voice too informal',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.field).toBe('introduction');
    expect(body.suggestedText).toContain('Improved introduction');
    expect(body.originalText).toBe('<p>This is the introduction.</p>');
    expect(typeof body.explanation).toBe('string');
  });

  it('word_count_target — returns AiFixResult targeting a section', async () => {
    mockOpenAIResponse('content-fix', '<p>Expanded section content here with more words.</p>');
    const res = await authPostJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'word_count_target',
      reason: 'Word count too low',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.field).toBe('section');
    expect(body.sectionIndex).toBe(0);
    expect(body.suggestedText).toContain('Expanded');
  });

  it('meta_optimized — returns AiFixResult with JSON suggestedText', async () => {
    mockOpenAIJsonResponse('content-fix', {
      seoTitle: 'Optimized Test Post Title',
      seoMetaDescription: 'An optimized meta description for the test post that is 150 characters long and includes the keyword.',
    });
    const res = await authPostJson(`/api/content-posts/${wsId}/${postId}/ai-fix`, {
      issueKey: 'meta_optimized',
      reason: 'Meta description too short',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.field).toBe('meta');
    const parsed = JSON.parse(body.suggestedText);
    expect(parsed).toHaveProperty('seoTitle');
    expect(parsed).toHaveProperty('seoMetaDescription');
  });
});
```

- [ ] Run — expect FAIL (route doesn't exist yet):

```bash
npx vitest run tests/integration/content-posts-ai-fix.test.ts
```

Expected: 404 or connection errors.

### Step 8.2: Add the `/ai-fix` route

- [ ] In `server/routes/content-posts.ts`, add the import for `AiFixResult` after the existing imports (at the top):

```ts
import type { AiFixResult } from '../../shared/types/content.js';
```

- [ ] After the `/ai-review` route (after line 354, before the `// --- Version History ---` comment), add the new route:

```ts
// AI fix — generates a targeted fix for a specific failed review item
router.post('/api/content-posts/:workspaceId/:postId/ai-fix',
  requireWorkspaceAccess('workspaceId'),
  validate(z.object({
    issueKey: z.enum(['factual_accuracy', 'brand_voice', 'internal_links', 'no_hallucinations', 'meta_optimized', 'word_count_target']),
    reason: z.string().min(1).max(500),
  })),
  async (req, res) => {
    const { issueKey, reason } = req.body as { issueKey: string; reason: string };
    const post = getPost(req.params.workspaceId, req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    let field: AiFixResult['field'];
    let sectionIndex: number | undefined;
    let originalText: string;
    let userPrompt: string;

    switch (issueKey) {
      case 'internal_links': {
        const targetSection = post.sections.find(s => !s.content.includes('<a href'))
          ?? post.sections[0];
        if (!targetSection) return res.status(422).json({ error: 'No sections available' });
        const brief = getBrief(req.params.workspaceId, post.briefId);
        const suggestions = brief?.internalLinkSuggestions ?? [];
        field = 'section';
        sectionIndex = targetSection.index;
        originalText = targetSection.content;
        userPrompt = `Rewrite ONE sentence in this HTML section to include a relevant internal link using <a href="URL">anchor text</a>.
Available internal link suggestions: ${suggestions.length > 0 ? suggestions.join(', ') : 'Use a plausible internal link like /blog or /services'}.
Return the FULL SECTION HTML with exactly one new <a href="..."> tag added. Do not change any other content.

Issue reason: ${reason}

Section HTML:
${originalText}`;
        break;
      }
      case 'meta_optimized': {
        field = 'meta';
        originalText = JSON.stringify({
          seoTitle: post.seoTitle || post.title,
          seoMetaDescription: post.seoMetaDescription || post.metaDescription,
        });
        userPrompt = `Rewrite the SEO meta title and meta description for this blog post.
Target keyword: "${post.targetKeyword}"
Current title: "${post.seoTitle || post.title}"
Current description: "${post.seoMetaDescription || post.metaDescription}"
Requirements: Title 50-60 characters, description 150-160 characters, both include the target keyword.

Issue reason: ${reason}

Return ONLY valid JSON with no surrounding text:
{ "seoTitle": "...", "seoMetaDescription": "..." }`;
        break;
      }
      case 'word_count_target': {
        const doneSections = post.sections.filter(s => s.status === 'done');
        const targetSection = (doneSections.length > 0 ? doneSections : post.sections)
          .reduce((a, b) => a.wordCount < b.wordCount ? a : b);
        if (!targetSection) return res.status(422).json({ error: 'No sections available' });
        field = 'section';
        sectionIndex = targetSection.index;
        originalText = targetSection.content;
        userPrompt = `Expand this HTML section by approximately 20% to increase the post's overall word count.
Add meaningful, relevant content — not filler. Maintain the same HTML structure and tone.
Return the FULL EXPANDED SECTION HTML only.

Post word count: ${post.totalWordCount} (target: ${post.targetWordCount})
Issue reason: ${reason}

Section HTML:
${originalText}`;
        break;
      }
      case 'brand_voice': {
        field = 'introduction';
        originalText = post.introduction;
        userPrompt = `Rewrite this blog post introduction to better match a professional, authoritative brand voice.
Keep the same topic, key points, and approximate length. Return the FULL INTRODUCTION HTML only.

Issue reason: ${reason}

Introduction HTML:
${originalText}`;
        break;
      }
      case 'factual_accuracy':
      case 'no_hallucinations': {
        const targetSection = post.sections[0];
        if (!targetSection) return res.status(422).json({ error: 'No sections available' });
        field = 'section';
        sectionIndex = targetSection.index;
        originalText = targetSection.content;
        userPrompt = `Review this HTML section and rewrite any potentially inaccurate or unverifiable claims conservatively.
Replace suspicious statistics or quotes with general, verifiable statements. Do NOT add new statistics.
Return the FULL SECTION HTML with conservative rewrites applied.

Issue reason: ${reason}

Section HTML:
${originalText}`;
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown issue key' });
    }

    try {
      const aiResult = await callAI({
        messages: [{ role: 'user', content: userPrompt }],
        feature: 'content-fix',
        workspaceId: req.params.workspaceId,
        maxTokens: 2000,
        temperature: 0.3,
      });

      const suggestedText = aiResult.text.trim();

      if (field === 'meta') {
        const parsed = parseAIJson<{ seoTitle: string; seoMetaDescription: string }>(suggestedText);
        if (!parsed) return res.status(500).json({ error: 'Failed to parse AI meta response' });
      }

      const sectionLabel = field === 'section' && sectionIndex !== undefined
        ? `section "${post.sections[sectionIndex]?.heading}"`
        : field;
      const explanation = `AI revised the ${sectionLabel} to address: ${reason.slice(0, 100)}`;

      const result: AiFixResult = { field, sectionIndex, originalText, suggestedText, explanation };
      res.json(result);
    } catch (err) {
      log.error({ err }, 'AI fix failed');
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `AI fix failed: ${msg}` });
    }
  },
);
```

### Step 8.3: Run integration test — expect PASS

- [ ] Run:

```bash
npx vitest run tests/integration/content-posts-ai-fix.test.ts
```

Expected: 5 tests pass. If `savePost` / `saveBrief` imports in the test file don't exist with those signatures, adjust to match the actual exported function names (`savePost` is imported from `server/content-posts.js`).

### Step 8.4: Typecheck and commit

- [ ] Run:

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] Commit:

```bash
git add server/routes/content-posts.ts tests/integration/content-posts-ai-fix.test.ts
git commit -m "feat: POST /ai-fix endpoint with per-issue prompt strategy + integration tests"
```

---

## Task 9: FixDiffModal Component

**Parallel with Task 8. Depends on Task 1.**

**Files:**
- Create: `src/components/post-editor/FixDiffModal.tsx`

### Step 9.1: Create the component

- [ ] Create `src/components/post-editor/FixDiffModal.tsx`:

```tsx
import { X, Loader2, Check } from 'lucide-react';
import type { AiFixResult } from '../../../shared/types/content';

interface FixDiffModalProps {
  issueLabel: string;
  result: AiFixResult | null;
  loading: boolean;
  applying: boolean;
  onApply: (result: AiFixResult) => void;
  onDismiss: () => void;
}

export function FixDiffModal({ issueLabel, result, loading, applying, onApply, onDismiss }: FixDiffModalProps) {
  if (!loading && !result) return null;

  const parsedMeta = result?.field === 'meta'
    ? (() => { try { return JSON.parse(result.suggestedText) as { seoTitle: string; seoMetaDescription: string }; } catch { return null; } })()
    : null;

  const parsedMetaOriginal = result?.field === 'meta'
    ? (() => { try { return JSON.parse(result.originalText) as { seoTitle: string; seoMetaDescription: string }; } catch { return null; } })()
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onDismiss}
    >
      <div
        className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] w-full max-w-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--brand-border)]/50">
          <span className="text-sm font-semibold text-[var(--brand-text-bright)]">
            AI Fix: {issueLabel}
          </span>
          <button
            onClick={onDismiss}
            className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[var(--brand-text-muted)]">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Generating fix…</span>
            </div>
          ) : result ? (
            <div className="space-y-4">
              {result.field === 'meta' && parsedMeta && parsedMetaOriginal ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Current SEO Title</div>
                    <div className="p-2 rounded bg-red-500/5 border border-red-500/20 text-xs text-red-300/80 line-through">
                      {parsedMetaOriginal.seoTitle}
                    </div>
                  </div>
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Suggested SEO Title</div>
                    <div className="p-2 rounded bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-300/80">
                      {parsedMeta.seoTitle}
                    </div>
                  </div>
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Current Meta Description</div>
                    <div className="p-2 rounded bg-red-500/5 border border-red-500/20 text-xs text-red-300/80 line-through">
                      {parsedMetaOriginal.seoMetaDescription}
                    </div>
                  </div>
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Suggested Meta Description</div>
                    <div className="p-2 rounded bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-300/80">
                      {parsedMeta.seoMetaDescription}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Original</div>
                    <div
                      className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-[var(--brand-text)] leading-relaxed line-through decoration-red-500/40 [&_strong]:text-[var(--brand-text-bright)] [&_h2]:font-semibold [&_h2]:text-[var(--brand-text-bright)] [&_a]:text-teal-400 max-h-56 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: result.originalText }}
                    />
                  </div>
                  <div>
                    <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Suggested</div>
                    <div
                      className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-xs text-[var(--brand-text)] leading-relaxed [&_strong]:text-[var(--brand-text-bright)] [&_h2]:font-semibold [&_h2]:text-[var(--brand-text-bright)] [&_a]:text-teal-400 max-h-56 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: result.suggestedText }}
                    />
                  </div>
                </div>
              )}

              {result.explanation && (
                <p className="t-caption text-[var(--brand-text-muted)] border-t border-[var(--brand-border)]/50 pt-3">
                  {result.explanation}
                </p>
              )}

              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={onDismiss}
                  className="px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] border border-[var(--brand-border)] hover:border-[var(--brand-border-hover)] transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => onApply(result)}
                  disabled={applying}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-lg)] t-caption-sm font-medium bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
                >
                  {applying
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Applying…</>
                    : <><Check className="w-3 h-3" /> Apply</>}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

### Step 9.2: Typecheck and commit

- [ ] Run:

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] Commit:

```bash
git add src/components/post-editor/FixDiffModal.tsx
git commit -m "feat: FixDiffModal — loading/diff/applying states, meta two-column layout"
```

---

## Task 10: ReviewChecklist + PostEditor Phase 2 Wiring

**Depends on Tasks 8 and 9 both committed.**

**Files:**
- Modify: `src/components/post-editor/ReviewChecklist.tsx`
- Modify: `src/components/PostEditor.tsx`

### Step 10.1: Export `CHECKLIST_ITEMS` from ReviewChecklist.tsx

- [ ] In `src/components/post-editor/ReviewChecklist.tsx`, change line 21:

```ts
const CHECKLIST_ITEMS: { key: keyof ReviewChecklistState; label: string }[] = [
```

to:

```ts
export const CHECKLIST_ITEMS: { key: keyof ReviewChecklistState; label: string }[] = [
```

### Step 10.2: Add `onRequestFix` prop and "Fix this" buttons

- [ ] Add `onRequestFix` to the `ReviewChecklistProps` interface:

```ts
export interface ReviewChecklistProps {
  postStatus: 'generating' | 'draft' | 'review' | 'approved';
  reviewChecklist: ReviewChecklistState | undefined;
  showChecklist: boolean;
  onToggleShowChecklist: () => void;
  onToggleItem: (key: keyof ReviewChecklistState) => void;
  onChangeStatus: (status: string) => void;
  onRunAIReview?: () => Promise<Record<string, AIReviewResult> | null>;
  onRequestFix?: (issueKey: string, reason: string) => Promise<void>;
}
```

- [ ] Add `onRequestFix` to the destructured function parameters:

```ts
export function ReviewChecklist({
  postStatus, reviewChecklist, showChecklist,
  onToggleShowChecklist, onToggleItem, onChangeStatus, onRunAIReview, onRequestFix,
}: ReviewChecklistProps) {
```

- [ ] Add a `fixingKey` state inside the component (after `aiResults`):

```ts
  const [fixingKey, setFixingKey] = useState<string | null>(null);
```

- [ ] Add a `handleFixThis` handler inside the component:

```ts
  const handleFixThis = async (issueKey: string, reason: string) => {
    if (!onRequestFix || fixingKey) return;
    setFixingKey(issueKey);
    try {
      await onRequestFix(issueKey, reason);
    } finally {
      setFixingKey(null);
    }
  };
```

- [ ] In the checklist items render, find the block that renders each item (starting around line 112). After the AI result reason div, add the "Fix this" button for failed items:

```tsx
                  {aiResults?.[item.key] && !aiResults[item.key].pass && onRequestFix && (
                    <div className="ml-8 mr-2 mb-1">
                      <button
                        onClick={() => handleFixThis(item.key, aiResults![item.key].reason)}
                        disabled={fixingKey !== null}
                        className="flex items-center gap-1 px-2 py-1 rounded t-caption-sm bg-teal-600/20 border border-teal-500/30 text-teal-300 hover:bg-teal-600/30 transition-colors disabled:opacity-50"
                      >
                        {fixingKey === item.key
                          ? <><Icon as={Loader2} size="sm" className="animate-spin" /> Fixing…</>
                          : 'Fix this'}
                      </button>
                    </div>
                  )}
```

Insert this block AFTER the existing AI reason `<div>` (the one at lines 130–133).

### Step 10.3: Add fix state and imports to PostEditor.tsx

- [ ] In `src/components/PostEditor.tsx`, add these imports (updating the existing import from ReviewChecklist):

```tsx
import { ReviewChecklist, CHECKLIST_ITEMS } from './post-editor/ReviewChecklist';
import { FixDiffModal } from './post-editor/FixDiffModal';
import type { AiFixResult } from '../../shared/types/content';
```

- [ ] Add fix-related state variables after the existing state declarations:

```tsx
  const [fixLoading, setFixLoading] = useState(false);
  const [fixApplying, setFixApplying] = useState(false);
  const [fixResult, setFixResult] = useState<AiFixResult | null>(null);
  const [fixIssueLabel, setFixIssueLabel] = useState('');
```

### Step 10.4: Add `handleRequestFix` and `handleApplyFix` handlers

- [ ] Add these handlers after the existing handler functions in PostEditor.tsx:

```tsx
  const handleRequestFix = async (issueKey: string, reason: string) => {
    setFixLoading(true);
    setFixIssueLabel(CHECKLIST_ITEMS.find(i => i.key === issueKey)?.label ?? issueKey);
    try {
      const result = await contentPosts.aifix(workspaceId, postId, { issueKey, reason });
      setFixResult(result);
    } catch (err) {
      console.error('PostEditor operation failed:', err);
    } finally {
      setFixLoading(false);
    }
  };

  const handleApplyFix = async (result: AiFixResult) => {
    if (!post) return;
    setFixApplying(true);
    try {
      if (result.field === 'introduction') {
        await saveField({ introduction: result.suggestedText });
      } else if (result.field === 'section' && result.sectionIndex !== undefined) {
        const sections = [...post.sections];
        sections[result.sectionIndex] = { ...sections[result.sectionIndex], content: result.suggestedText };
        await saveField({ sections });
      } else if (result.field === 'conclusion') {
        await saveField({ conclusion: result.suggestedText });
      } else if (result.field === 'meta') {
        const parsed = JSON.parse(result.suggestedText) as { seoTitle: string; seoMetaDescription: string };
        await saveField({ seoTitle: parsed.seoTitle, seoMetaDescription: parsed.seoMetaDescription });
      }
      setFixResult(null);
      invalidatePost();
    } catch (err) {
      console.error('PostEditor operation failed:', err);
    } finally {
      setFixApplying(false);
    }
  };
```

### Step 10.5: Pass `onRequestFix` to ReviewChecklist

- [ ] In the `<ReviewChecklist>` JSX block (around line 379), add `onRequestFix`:

```tsx
          <ReviewChecklist
            postStatus={post.status}
            reviewChecklist={post.reviewChecklist}
            showChecklist={showChecklist}
            onToggleShowChecklist={() => setShowChecklist(!showChecklist)}
            onToggleItem={(key) => {
              const checklist = post.reviewChecklist ?? { factual_accuracy: false, brand_voice: false, internal_links: false, no_hallucinations: false, meta_optimized: false, word_count_target: false };
              saveField({ reviewChecklist: { ...checklist, [key]: !checklist[key] } });
            }}
            onChangeStatus={(status) => saveField({ status })}
            onRunAIReview={async () => {
              const res = await contentPosts.aiReview(workspaceId, postId);
              return res?.review ?? null;
            }}
            onRequestFix={handleRequestFix}
          />
```

### Step 10.6: Render FixDiffModal at the bottom of PostEditor JSX

- [ ] In `PostEditor.tsx`, just before the final closing `</div>` (line 554), add:

```tsx
      <FixDiffModal
        issueLabel={fixIssueLabel}
        result={fixResult}
        loading={fixLoading}
        applying={fixApplying}
        onApply={handleApplyFix}
        onDismiss={() => { setFixResult(null); }}
      />
```

### Step 10.7: Typecheck, pr-check, and commit

- [ ] Run:

```bash
npm run typecheck && npx vite build
```

Expected: zero errors.

- [ ] Run:

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors.

- [ ] Commit:

```bash
git add src/components/post-editor/ReviewChecklist.tsx src/components/PostEditor.tsx
git commit -m "feat: Phase 2 — 'Fix this' buttons in review checklist, FixDiffModal with diff preview and apply"
```

---

## Final Verification Pass

After all tasks are committed, run the full quality gate:

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — successful build
- [ ] `npx vitest run` — full test suite passes
- [ ] `npx tsx scripts/pr-check.ts` — zero errors

**Manual verification checklist:**
- [ ] Bold text visible in light mode (admin PostEditor intro/conclusion view) — no `text-white` remaining
- [ ] Bubble menu appears on text selection in all 6 edit sites (3 admin, 3 client)
- [ ] Cmd+B toggles bold; Cmd+I toggles italic; Cmd+K opens link input in bubble menu
- [ ] Typing and pausing 2s triggers auto-save; "Saved" indicator appears and fades
- [ ] Done button flushes any pending save immediately and collapses edit mode
- [ ] Reading time displays in PostPreview (e.g. "~6 min read")
- [ ] "Fix this" button appears only for failed AI review items (not passed items)
- [ ] Clicking "Fix this" shows spinner → FixDiffModal with diff → Apply updates post → modal closes
- [ ] Dismiss closes modal without changes

---

## Self-Review Notes

**Spec coverage:** All 6 improvements accounted for. Pre-existing bugs (broadcast gap, WS invalidation) covered in Tasks 5 and 6.

**Placeholder scan:** No TBDs or "similar to" references. Every code block is complete.

**Type consistency:**
- `AiFixResult` defined in Task 1 → used identically in Tasks 8, 9, 10
- `SectionEditorProps` changes in Task 4 → call sites updated in Task 5
- `CHECKLIST_ITEMS` exported in Task 10.1 → imported in Task 10.3
- `useAutoSave` returns `{ scheduleAutoSave, flush, saveStatus }` → consumed identically across Tasks 5, 7

**Known edge case:** `savePost` in the Task 8 integration test — verify the exact exported function signature from `server/content-posts.ts` before running. The function may be named `savePost` or `upsertPost` depending on the file. Run `grep -n "^export function" server/content-posts.ts` to confirm.
