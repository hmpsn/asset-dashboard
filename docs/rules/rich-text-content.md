# Rich-Text Content Invariants

The blog/content editor (PR #356, April 2026) migrated post body fields from plain-text textareas to a TipTap rich-text editor. This shifted the data shape on several fields and introduced four content-handling patterns that every consumer of post content must respect.

## What changed

| Field | Before | After |
|---|---|---|
| `post.introduction` | plain text | TipTap HTML |
| `post.conclusion` | plain text | TipTap HTML |
| `post.sections[].content` | plain text | TipTap HTML |
| `post.title`, `post.metaDescription`, `post.seoTitle`, `post.seoMetaDescription`, `post.sections[].heading` | plain text | plain text (unchanged) |

Anywhere these fields are read, written, counted, displayed, or persisted, the rules below apply.

## Rule 1 — Always count words via the HTML-aware helpers

Calling `text.split(/\s+/).filter(...)` or `countWords(text)` on rich-text HTML treats `<p>` and `</p>` as words and inflates the count. Use:

- **Server**: `countHtmlWords()` from `server/content-posts-ai.ts` (wraps `countWords(stripHtml(html))`)
- **Client**: `countWordsFromHtml()` from `src/lib/utils.ts` (in-browser `<[^>]+>` strip)

Plain-text fields (title, headings, meta) keep using `countWords()` as before. The pr-check rule **HTML-naive word count on rich-text post field** mechanically catches bare `countWords(post.introduction)` / `post.introduction.split(/\s+/)` patterns. Escape hatch: `// html-word-count-ok` if you really do want a word-by-tag count for some debugging reason.

**Real-world failure (PR #356 review):** The PATCH handler stored client-edited section content with the original `wordCount` preserved by partial spread; the WordBadge displayed a stale 5w next to a 30-word edit. Fixed by recomputing on every write.

## Rule 2 — Sanitize HTML at the public boundary; trust admin input

The trust model is asymmetric **on purpose**:

- **Public/client routes** (`server/routes/public-content.ts`) MUST sanitize incoming HTML via `sanitizeRichText()` (rich text fields) or `sanitizePlainText()` (plain text fields) from `server/html-sanitize.ts` before persisting. The TipTap StarterKit + Link allowlist is the canonical safe set; anything outside is a stored XSS risk because the same content renders via `dangerouslySetInnerHTML` in admin and client views.
- **Admin routes** (`server/routes/content-posts.ts` PATCH) DO NOT sanitize. Admins are gated by HMAC password + `requireWorkspaceAccess`; admin-side input is trusted. Sanitizing admin writes would silently strip valid TipTap output (e.g. attribute-order quirks) and mask data-loss bugs.
- **AI-generated HTML** (the `/ai-fix` endpoint) MUST be sanitized regardless of caller — even though only an admin can trigger it, the AI is an untrusted content source and the user-supplied `reason` parameter is a prompt-injection vector.

If you add a new route that accepts HTML, decide which side of this boundary it sits on and sanitize accordingly. Don't introduce a third tier.

## Rule 3 — `useAutoSave` saveFn closures: flush before changing the closed-over context

`useAutoSave` keeps the latest `saveFn` reference in `saveFnRef.current` (updated on every render). When the debounce timer fires, it calls the latest closure with the latest state — but the **HTML it carries** was queued under whatever state existed when `scheduleAutoSave(html)` was called.

If a single `useAutoSave` instance is shared across multiple logical contexts (e.g. one section editor used for many sections, where the saveFn reads `editingSection` from state), switching contexts without flushing causes the queued HTML for context A to be written to context B's record.

**Contract for callers:**

```typescript
// ❌ Wrong — pending save for section A overwrites section B
onClick={() => setEditingSection(section.index)}

// ✅ Right — drain the prior section's pending save before switching
onClick={async () => { await flushSection(); setEditingSection(section.index); }}
```

Same applies to the "Done" button (already correct) and any other state change that affects which record the saveFn writes to.

For independent contexts (e.g. intro and conclusion in the same component), use **separate `useAutoSave` instances** — each gets its own timer and `pendingHtml` ref, so they don't interfere.

## Rule 4 — Don't sync external prop state into a focused editor

Any controlled-ish component that accepts an `initialValue` prop AND updates internal state via user input has a race: when an upstream save resolves and the parent re-renders with the saved value, a naive `useEffect(() => editor.setContent(initialValue), [initialValue])` will overwrite keystrokes the user made during the save round-trip.

The `RichTextEditor` pattern:

```typescript
const lastSyncedRef = useRef<string | null>(null);
useEffect(() => {
  if (!editor) return;
  if (editor.isFocused) return;                       // user is typing — never clobber
  if (lastSyncedRef.current === initialValue) return; // already synced this exact value
  lastSyncedRef.current = initialValue;
  editor.commands.setContent(initialValue, { emitUpdate: false });
}, [editor, initialValue]);
```

Both guards matter:
1. **Focus guard** prevents the active-typing race
2. **`lastSyncedRef`** sidesteps subtle HTML-normalization differences between TipTap output and the server sanitizer (`<br>` vs `<br/>`, attribute order) — comparing against `editor.getHTML()` would oscillate and re-sync forever

If you build another rich-text-ish component, replicate this pattern.

## Rule 5 — Coalesce auto-save side-effects to one entry per editing session

Auto-save fires every 2 seconds during active editing. Side effects that were once "one per explicit save" (version snapshots, activity log entries, outbound webhooks) become "30 per minute" if naively wired to every PATCH.

**Pattern** — admin PATCH at `server/routes/content-posts.ts` and client edit at `server/routes/public-content.ts`:

```typescript
const COALESCE_WINDOW_MS = 60_000;
const recentVersion = getMostRecentPostVersion(workspaceId, postId);
const withinWindow = !!recentVersion
  && recentVersion.trigger === 'manual_edit'
  && (Date.now() - new Date(recentVersion.createdAt).getTime()) < COALESCE_WINDOW_MS;
if (!withinWindow) {
  snapshotPostVersion(...);
  addActivity(...);
}
```

Apply the same window to any side effect that's "one per editing session," not "one per save tick."

## Rule 6 — WS event payload shapes must agree across emitters

Multiple routes emit the same `WS_EVENTS.X` event but write different payload shapes is a silent dead-code failure: the handler reads `payload.postId`, one emitter sent `{ id }`, that emitter's invalidation never fires. The pr-check `useWorkspaceEvents handler for centralized event` rule catches the *handler-missing* half; payload-shape consistency is currently a manual check.

**When emitting an existing event from a new code path**, grep all existing emitters and match the shape. If you genuinely need a different shape, deliberately union the payload type in `shared/types/` and update the handler to accept both.

## Read-list

- [`server/html-sanitize.ts`](../../server/html-sanitize.ts) — the canonical HTML allowlist
- [`src/components/post-editor/RichTextEditor.tsx`](../../src/components/post-editor/RichTextEditor.tsx) — focus-guard sync pattern
- [`src/hooks/useAutoSave.ts`](../../src/hooks/useAutoSave.ts) — the shared-timer contract
- [`server/routes/public-content.ts`](../../server/routes/public-content.ts) — the public-side sanitize + coalesce reference
- [`server/routes/content-posts.ts`](../../server/routes/content-posts.ts) — the admin-side trust + coalesce reference
