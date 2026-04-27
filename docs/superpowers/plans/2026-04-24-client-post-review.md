# Client Post Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to send a generated blog post to the client for in-platform review, where the client can edit sections directly, leave steering feedback, and approve or request changes.

**Architecture:** Add `post_review` to the `ContentTopicRequest` state machine (`in_progress → post_review → changes_requested | delivered`). New public API routes let clients read and edit the post content. `PostReviewCard` renders the post in the client portal with inline editing and approve/reject actions. The admin gets a "Send Post to Client" button in `RequestList` once a post exists for an in-progress request.

**Tech Stack:** Express + TypeScript (backend), React 19 + Vite (frontend), SQLite via better-sqlite3, React Query, Zod validation, Tailwind CSS 4.

---

## Task Dependencies

```
Task 1 (state machine + types)  ← run first, everything depends on it
        ↓
Task 2 (email.ts)  ∥  Task 3 (schemas)  ← parallel
        ↓
Task 4 (public routes)  ← sequential, needs 2 + 3
        ↓
Task 5 (admin notif hook)  ∥  Task 6 (admin button)  ∥  Task 7 (API client)  ← parallel
        ↓
Task 8 (PostReviewCard)  ← needs 7
        ↓
Task 9 (ContentTab wire)  ← needs 8
        ↓
Task 10 (integration tests)  ← needs 4, 5, 6, 9
```

## File Ownership Per Parallel Batch

**Tasks 2 ∥ 3:**
- Task 2 owns: `server/email.ts`
- Task 3 owns: `server/schemas/public-content.ts`

**Tasks 5 ∥ 6 ∥ 7:**
- Task 5 owns: `server/routes/content-requests.ts`
- Task 6 owns: `src/components/briefs/RequestList.tsx`
- Task 7 owns: `src/api/content.ts`

---

## Task 1: State Machine + Shared Types (Model: haiku)

**Files:**
- Create: `server/db/migrations/073-content-request-post-id.sql`
- Modify: `server/state-machines.ts`
- Modify: `shared/types/content.ts`
- Modify: `server/content-requests.ts`
- Modify: `src/components/client/types.ts`

- [ ] **Step 1.0: Create migration to add `post_id` column to `content_topic_requests`**

Create `server/db/migrations/073-content-request-post-id.sql`:

```sql
-- Migration 073: add post_id to content_topic_requests
-- Links a request to the GeneratedPost produced from its brief.
-- Nullable because post_id is only set when the post exists.
ALTER TABLE content_topic_requests ADD COLUMN post_id TEXT;
```

- [ ] **Step 1.1: Add `post_review` to `CONTENT_REQUEST_TRANSITIONS` in `server/state-machines.ts`**

Replace the existing `in_progress` and add new `post_review` entry:

```typescript
// In CONTENT_REQUEST_TRANSITIONS:
in_progress:  ['post_review', 'delivered', 'published', 'declined'],  // was: ['delivered', 'published', 'declined']
post_review:  ['changes_requested', 'delivered', 'published', 'declined'],
```

Also update `ContentRequestStatus` type on line 37:

```typescript
export type ContentRequestStatus = 'pending_payment' | 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'post_review' | 'delivered' | 'published' | 'declined';
```

- [ ] **Step 1.2: Update `ContentTopicRequest` in `shared/types/content.ts`**

Two changes in the same interface:

(a) Find the `status` field on `ContentTopicRequest` (line ~134) and add `'post_review'`:

```typescript
status: 'pending_payment' | 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'post_review' | 'delivered' | 'published' | 'declined';
```

(b) After the `briefId?: string` field, add `postId`:

```typescript
briefId?: string;
postId?: string;   // ← ADD: links request to its GeneratedPost; set when admin sends post to client
```

- [ ] **Step 1.3: Update `ClientContentRequest.status` union in `src/components/client/types.ts`**

Find the `ClientContentRequest` interface and update its `status` field:

```typescript
export interface ClientContentRequest {
  id: string; topic: string; targetKeyword: string; intent: string; priority: string;
  status: 'pending_payment' | 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'post_review' | 'delivered' | 'published' | 'declined';
  source?: 'strategy' | 'client'; briefId?: string;
  serviceType?: 'brief_only' | 'full_post'; pageType?: 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource'; upgradedAt?: string;
  deliveryUrl?: string; deliveryNotes?: string;
  postId?: string;  // ← ADD: link from request to its generated post
  clientFeedback?: string;  // ← ADD: surfaces steering feedback in portal
  comments?: { id: string; author: 'client' | 'team'; content: string; createdAt: string }[];
  requestedAt: string; updatedAt: string;
}
```

- [ ] **Step 1.3b: Update `server/content-requests.ts` — DB module changes for `postId`**

Four changes inside `server/content-requests.ts`. Make them in order:

**(a) Add `post_id` to `RequestRow` interface** (around line 20, after `brief_id`):

```typescript
interface RequestRow {
  // ... existing fields ...
  brief_id: string | null;
  post_id: string | null;   // ← ADD
  // ... rest of fields ...
}
```

**(b) Update `stmts().insert` SQL** to include `post_id` in both the column list and VALUES list:

```sql
INSERT INTO content_topic_requests
  (id, workspace_id, topic, target_keyword, intent, priority, rationale, status,
   brief_id, post_id, client_note, internal_note, decline_reason, client_feedback,
   source, service_type, page_type, upgraded_at, delivery_url, delivery_notes,
   target_page_id, target_page_slug, comments, requested_at, updated_at)
VALUES
  (@id, @workspace_id, @topic, @target_keyword, @intent, @priority, @rationale, @status,
   @brief_id, @post_id, @client_note, @internal_note, @decline_reason, @client_feedback,
   @source, @service_type, @page_type, @upgraded_at, @delivery_url, @delivery_notes,
   @target_page_id, @target_page_slug, @comments, @requested_at, @updated_at)
```

**(c) Update `stmts().update` SQL** to include `post_id = @post_id` in the SET clause:

```sql
UPDATE content_topic_requests SET
  status = @status, brief_id = @brief_id, post_id = @post_id, client_note = @client_note,
  internal_note = @internal_note, decline_reason = @decline_reason,
  client_feedback = @client_feedback, service_type = @service_type,
  upgraded_at = @upgraded_at, delivery_url = @delivery_url,
  delivery_notes = @delivery_notes, comments = @comments, updated_at = @updated_at
WHERE id = @id AND workspace_id = @workspace_id
```

**(d) Update `rowToRequest` mapper** to read the new column (after `briefId: row.brief_id ?? undefined`):

```typescript
briefId: row.brief_id ?? undefined,
postId: row.post_id ?? undefined,   // ← ADD
```

**(e) Update `updateContentRequest` function** — add `postId` to the picks and to the `.run()` call:

Update the function signature's `Pick` type (around line 174):
```typescript
updates: Partial<Pick<ContentTopicRequest, 'status' | 'briefId' | 'postId' | 'internalNote' | 'declineReason' | 'clientFeedback' | 'serviceType' | 'upgradedAt' | 'deliveryUrl' | 'deliveryNotes'>>
```

And in the `.run()` call, add `post_id: existing.postId ?? null`:
```typescript
stmts().update.run({
  id: existing.id,
  workspace_id: workspaceId,
  status: existing.status,
  brief_id: existing.briefId ?? null,
  post_id: existing.postId ?? null,   // ← ADD
  client_note: existing.clientNote ?? null,
  // ... rest unchanged ...
});
```

Also update the `addComment` function's `.run()` call the same way (it also calls `stmts().update`):
```typescript
// In addComment, find stmts().update.run and add:
post_id: existing.postId ?? null,   // ← ADD
```

**(f) Update `createContentRequest` insert call** to pass `post_id: null` (new requests never have a post yet):

```typescript
stmts().insert.run({
  // ... existing fields ...
  brief_id: request.briefId ?? null,
  post_id: null,   // ← ADD (posts are linked later via updateContentRequest)
  // ... rest unchanged ...
});
```

- [ ] **Step 1.4: Update the Zod status enum in `server/routes/content-requests.ts`**

Find the `updateContentRequestSchema` (around line 42) and add `'post_review'` to the status enum:

```typescript
status: z.enum(['pending_payment', 'requested', 'brief_generated', 'client_review', 'approved', 'changes_requested', 'in_progress', 'post_review', 'delivered', 'published', 'declined']).optional(),
```

- [ ] **Step 1.5: Verify the types compile cleanly**

```bash
cd /path/to/repo && npm run typecheck
```

Expected: zero errors related to `post_review`.

- [ ] **Step 1.6: Commit**

```bash
git add server/db/migrations/073-content-request-post-id.sql \
        server/state-machines.ts \
        shared/types/content.ts \
        server/content-requests.ts \
        src/components/client/types.ts \
        server/routes/content-requests.ts
git commit -m "feat(content): add post_review status and postId column to ContentTopicRequest"
```

---

## Task 2: Add `notifyClientPostReady` Email Function (Model: haiku)

**Files:**
- Modify: `server/email.ts`

Do NOT modify any other file in this task.

- [ ] **Step 2.1: Add `notifyClientPostReady` to `server/email.ts`**

Add this function after `notifyClientBriefReady` (around line 173):

```typescript
export function notifyClientPostReady(opts: {
  clientEmail: string;
  workspaceName: string;
  workspaceId?: string;
  topic: string;
  targetKeyword: string;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) return;
  queueEmail(makeEvent('content_post_ready', opts.clientEmail, opts.workspaceId || '', opts.workspaceName, opts.dashboardUrl, {
    topic: opts.topic, targetKeyword: opts.targetKeyword,
  }));
}
```

- [ ] **Step 2.2: Verify compile**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2.3: Commit**

```bash
git add server/email.ts
git commit -m "feat(email): add notifyClientPostReady notification"
```

---

## Task 3: Add Zod Schemas for Post-Review Public Routes (Model: haiku)

**Files:**
- Modify: `server/schemas/public-content.ts`

Do NOT modify any other file in this task.

- [ ] **Step 3.1: Add three new schemas to `server/schemas/public-content.ts`**

Append at the bottom of the file:

```typescript
// POST /api/public/content-request/:workspaceId/:id/approve-post
export const approvePostSchema = z.object({}).strict();

// POST /api/public/content-request/:workspaceId/:id/request-post-changes
export const requestPostChangesSchema = z.object({
  feedback: z.string().min(1).max(2000),
}).strict();

// PATCH /api/public/content-posts/:workspaceId/:postId/client-edit
export const clientPostEditSchema = z.object({
  title: z.string().max(500).optional(),
  metaDescription: z.string().max(500).optional(),
  introduction: z.string().optional(),
  sections: z.array(z.object({
    index: z.number(),
    heading: z.string(),
    content: z.string(),
    wordCount: z.number(),
    targetWordCount: z.number().optional(),
    keywords: z.array(z.string()).optional(),
    status: z.enum(['pending', 'generating', 'done', 'error']).optional(),
  })).optional(),
  conclusion: z.string().optional(),
}).strict();
```

- [ ] **Step 3.2: Verify compile**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3.3: Commit**

```bash
git add server/schemas/public-content.ts
git commit -m "feat(schemas): add approve-post, request-post-changes, client-edit schemas"
```

---

## Task 4: Add Public API Routes for Post Review (Model: sonnet)

**Files:**
- Modify: `server/routes/public-content.ts`

Do NOT modify any other file in this task. Depends on Tasks 2 and 3 being committed.

- [ ] **Step 4.0: Add `postId` to the public content requests serialization**

The `GET /api/public/content-requests/:workspaceId` handler (around line 143–154 in `server/routes/public-content.ts`) does explicit field selection and currently omits `postId`. Without this fix, `ContentTab` can never load the associated post when status is `post_review`.

Find the `.map(r => ({...}))` block that looks like:

```typescript
res.json(requests.map(r => ({
  id: r.id, topic: r.topic, targetKeyword: r.targetKeyword, intent: r.intent,
  priority: r.priority, status: r.status, source: r.source,
  serviceType: r.serviceType || 'brief_only', pageType: r.pageType || 'blog', upgradedAt: r.upgradedAt,
  comments: r.comments || [], requestedAt: r.requestedAt, updatedAt: r.updatedAt,
  // Include briefId only when in client_review or later
  briefId: ['client_review', 'approved', 'changes_requested', 'in_progress', 'delivered', 'published'].includes(r.status) ? r.briefId : undefined,
})));
```

Replace with (adds `postId` gate and `clientFeedback`):

```typescript
res.json(requests.map(r => ({
  id: r.id, topic: r.topic, targetKeyword: r.targetKeyword, intent: r.intent,
  priority: r.priority, status: r.status, source: r.source,
  serviceType: r.serviceType || 'brief_only', pageType: r.pageType || 'blog', upgradedAt: r.upgradedAt,
  comments: r.comments || [], requestedAt: r.requestedAt, updatedAt: r.updatedAt,
  // Include briefId only when in client_review or later
  briefId: ['client_review', 'approved', 'changes_requested', 'in_progress', 'delivered', 'published'].includes(r.status) ? r.briefId : undefined,
  // Include postId only when post is ready for client review or beyond
  postId: ['post_review', 'delivered', 'published'].includes(r.status) ? r.postId : undefined,
  clientFeedback: r.clientFeedback,
})));
```

> **Note:** `r.postId` is not on `ContentTopicRequest` today — that field comes from finding the associated `GeneratedPost` in the DB. Check `server/content-requests.ts` or `server/content-posts.ts` to see how the post is linked to the request (likely via `briefId → post.briefId` join, or a `postId` column on the request row). If a `postId` column doesn't exist on the `content_requests` table, use `listPosts(workspaceId).find(p => p.briefId === r.briefId)?.id` as a fallback lookup. Prefer adding a `postId` column if it doesn't exist (add it to Task 1's migration if needed).

- [ ] **Step 4.1: Add imports to `server/routes/public-content.ts`**

At the top of the file, alongside existing imports, add:

```typescript
import { approvePostSchema, requestPostChangesSchema, clientPostEditSchema } from '../schemas/public-content.js';
import { getPost, updatePostField, snapshotPostVersion, listPosts } from '../content-posts.js';
import { notifyClientPostReady } from '../email.js';
import { WS_EVENTS } from '../ws-events.js';
```

(Check if any of these are already imported before adding duplicates.)

- [ ] **Step 4.2: Add `GET /api/public/content-posts/:workspaceId/:postId`**

Add before the `export default router` line:

```typescript
// Client reads a post (only allowed when request is in post_review status)
router.get('/api/public/content-posts/:workspaceId/:postId', (req, res) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  // Verify the associated request is in post_review (or delivered for read-only view)
  const requests = listContentRequests(req.params.workspaceId);
  const req_ = requests.find(r => r.briefId === post.briefId);
  if (!req_ || !['post_review', 'delivered', 'published'].includes(req_.status)) {
    return res.status(403).json({ error: 'Post is not available for client review' });
  }

  res.json(post);
});
```

- [ ] **Step 4.3: Add `POST /api/public/content-request/:workspaceId/:id/approve-post`**

```typescript
// Client approves a post — transitions request to 'delivered'
router.post('/api/public/content-request/:workspaceId/:id/approve-post', validate(approvePostSchema), (req, res, next) => {
  let updated;
  try {
    updated = updateContentRequest(req.params.workspaceId, req.params.id, { status: 'delivered' });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'post_approved', `${actor?.name || 'Client'} approved post for "${updated.topic}"`, '', { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: updated.id, status: updated.status });
  res.json(updated);
});
```

- [ ] **Step 4.4: Add `POST /api/public/content-request/:workspaceId/:id/request-post-changes`**

```typescript
// Client requests changes on a post
router.post('/api/public/content-request/:workspaceId/:id/request-post-changes', validate(requestPostChangesSchema), (req, res, next) => {
  const feedback = sanitizeString(req.body.feedback, 2000);
  let updated;
  try {
    updated = updateContentRequest(req.params.workspaceId, req.params.id, {
      status: 'changes_requested', clientFeedback: feedback,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidTransitionError') {
      return res.status(400).json({ error: err.message });
    }
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Request not found' });
  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'post_changes_requested', `${actor?.name || 'Client'} requested changes on post for "${updated.topic}"`, feedback || '', { requestId: updated.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, { id: updated.id, status: updated.status });
  res.json(updated);
});
```

- [ ] **Step 4.5: Add `PATCH /api/public/content-posts/:workspaceId/:postId/client-edit`**

```typescript
// Client edits post content (sections, title, meta — NOT status or admin fields)
router.patch('/api/public/content-posts/:workspaceId/:postId/client-edit', validate(clientPostEditSchema), (req, res, next) => {
  const ws = getWorkspace(req.params.workspaceId);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });

  const post = getPost(req.params.workspaceId, req.params.postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  // Only allow edits when request is in post_review
  const requests = listContentRequests(req.params.workspaceId);
  const associatedReq = requests.find(r => r.briefId === post.briefId);
  if (!associatedReq || associatedReq.status !== 'post_review') {
    return res.status(403).json({ error: 'Post is not open for editing' });
  }

  // Snapshot before client edits so admin can see the diff
  snapshotPostVersion(post, 'manual_edit', 'client_edit');

  const { title, metaDescription, introduction, sections, conclusion } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (metaDescription !== undefined) updates.metaDescription = metaDescription;
  if (introduction !== undefined) updates.introduction = introduction;
  if (sections !== undefined) updates.sections = sections;
  if (conclusion !== undefined) updates.conclusion = conclusion;

  let updated;
  try {
    updated = updatePostField(req.params.workspaceId, req.params.postId, updates);
  } catch (err) {
    return next(err);
  }
  if (!updated) return res.status(404).json({ error: 'Post not found' });

  const actor = getClientActor(req, req.params.workspaceId);
  addActivity(req.params.workspaceId, 'post_client_edit', `${actor?.name || 'Client'} edited post content for "${post.targetKeyword}"`, '', { postId: post.id }, actor);
  broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { id: updated.id, status: updated.status });
  res.json(updated);
});
```

- [ ] **Step 4.6: Verify compile and routes are reachable**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4.7: Commit**

```bash
git add server/routes/public-content.ts
git commit -m "feat(api): add public post-review routes (read, approve, request-changes, client-edit)"
```

---

## Task 5: Admin Notification Hook for `post_review` Status (Model: haiku)

**Files:**
- Modify: `server/routes/content-requests.ts`

Do NOT modify any other file in this task. Depends on Tasks 1 and 2 being committed.

- [ ] **Step 5.1: Import `notifyClientPostReady` in `server/routes/content-requests.ts`**

Find the existing import line (around line 20):

```typescript
import { notifyClientBriefReady, notifyClientContentPublished } from '../email.js';
```

Replace with:

```typescript
import { notifyClientBriefReady, notifyClientContentPublished, notifyClientPostReady } from '../email.js';
```

- [ ] **Step 5.2: Add `post_review` email notification after the `client_review` block**

In the `PATCH /api/content-requests/:workspaceId/:id` handler, find the existing `if (status === 'client_review')` block and add a new block directly after it:

```typescript
// Notify client when post is sent for their review
if (status === 'post_review') {
  const wsInfo = getWorkspace(req.params.workspaceId);
  if (wsInfo?.clientEmail) {
    const origin = req.get('origin') || req.get('referer')?.replace(/\/[^/]*$/, '') || '';
    const dashUrl = origin ? `${origin}/client/${req.params.workspaceId}/inbox` : undefined;
    notifyClientPostReady({
      clientEmail: wsInfo.clientEmail,
      workspaceName: wsInfo.name,
      workspaceId: req.params.workspaceId,
      topic: updated.topic,
      targetKeyword: updated.targetKeyword,
      dashboardUrl: dashUrl,
    });
  }
}
```

- [ ] **Step 5.3: Add activity log entry for `post_review` transition**

In the same PATCH handler, find where `addActivity` is called for other status transitions (look for the activity log block). Add:

```typescript
if (status === 'post_review') {
  addActivity(req.params.workspaceId, 'post_sent_for_review', `Post sent to client for review: "${updated.topic}"`, '', { requestId: updated.id });
}
```

- [ ] **Step 5.4: Verify compile**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 5.5: Commit**

```bash
git add server/routes/content-requests.ts
git commit -m "feat(content): notify client and log activity when post sent for review"
```

---

## Task 6: Admin "Send Post to Client" Button in RequestList (Model: sonnet)

**Files:**
- Modify: `src/components/briefs/RequestList.tsx`

Do NOT modify any other file in this task. Depends on Task 1 being committed.

- [ ] **Step 6.1: Update the local `ContentTopicRequest` type in `RequestList.tsx`**

Find the inline `status` field definition (around line 49) and add `'post_review'`:

```typescript
status: 'requested' | 'brief_generated' | 'client_review' | 'approved' | 'changes_requested' | 'in_progress' | 'post_review' | 'delivered' | 'published' | 'declined';
```

Also add `clientFeedback?: string;` to the interface if it's not already present.

- [ ] **Step 6.2: Add status label for `post_review` in the status config map**

Find the `statusConfig` object (around line 148 where `in_progress` is defined) and add:

```typescript
post_review: { icon: Eye, color: 'text-cyan-400', label: 'Client Review' },
```

Add `Eye` to the lucide-react import at the top of the file if not already imported.

- [ ] **Step 6.3: Add "Send Post to Client" button for `in_progress` requests**

Find the `in_progress` block in the action buttons section (around line 237–260). The existing block renders "Open Post" and "Deliver Content" buttons. Add a new "Send Post to Client" button after the "Open Post" button, but ONLY when the post status is `review` or `approved`:

```typescript
{req.status === 'in_progress' && req.briefId && (() => {
  const existingPost = posts.find(p => p.briefId === req.briefId);
  if (!existingPost) return null;

  const canSendToClient = existingPost.status === 'review' || existingPost.status === 'approved';

  return (
    <>
      <button
        onClick={() => onOpenPost?.(existingPost.id)}
        className="flex items-center gap-1 px-2 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 hover:bg-teal-600/30 transition-colors"
        title="Open post in editor"
      >
        <PenLine className="w-3 h-3" /> Open Post
      </button>
      {canSendToClient && (
        <button
          onClick={() => onUpdateRequestStatus(req.id, 'post_review')}
          className="flex items-center gap-1 px-2 py-1 rounded bg-gradient-to-r from-cyan-600/30 to-teal-600/30 border border-cyan-500/40 text-[11px] text-cyan-200 font-medium hover:from-cyan-600/50 hover:to-teal-600/50 transition-all"
          title="Send post to client for review and approval"
        >
          <Send className="w-3 h-3" /> Send Post to Client
        </button>
      )}
    </>
  );
})()}
```

Add `Send` to the lucide-react import if not already present.

- [ ] **Step 6.4: Add status label and badge for `post_review` in the request card**

In the status badge section of the request card, find where statuses like `client_review` are displayed. Add `post_review` handling so it shows "Client Review" with a cyan badge:

```typescript
post_review: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
```

- [ ] **Step 6.5: Add informational text for `post_review` status**

After the `client_review` informational text block (around line 196 where `"Awaiting client feedback"` is rendered), add:

```typescript
{req.status === 'post_review' && (
  <span className="text-[11px] text-cyan-400/60 italic">Post sent — awaiting client approval</span>
)}
```

- [ ] **Step 6.6: Verify compile**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6.7: Commit**

```bash
git add src/components/briefs/RequestList.tsx
git commit -m "feat(admin): add Send Post to Client button and post_review status display"
```

---

## Task 7: Client-Facing API Methods (Model: haiku)

**Files:**
- Modify: `src/api/content.ts`

Do NOT modify any other file in this task. Depends on Task 4 being committed.

- [ ] **Step 7.1: Add public post-review API methods to `src/api/content.ts`**

Find the `contentRequests` export (around line 72) and add after it:

```typescript
// Public (client portal) post-review actions
export const publicPostReview = {
  getPost: (wsId: string, postId: string) =>
    get<GeneratedPost>(`/api/public/content-posts/${wsId}/${postId}`),

  clientEdit: (wsId: string, postId: string, updates: {
    title?: string;
    metaDescription?: string;
    introduction?: string;
    sections?: GeneratedPost['sections'];
    conclusion?: string;
  }) =>
    patch<GeneratedPost>(`/api/public/content-posts/${wsId}/${postId}/client-edit`, updates),

  approvePost: (wsId: string, reqId: string) =>
    post<ContentTopicRequest>(`/api/public/content-request/${wsId}/${reqId}/approve-post`, {}),

  requestPostChanges: (wsId: string, reqId: string, feedback: string) =>
    post<ContentTopicRequest>(`/api/public/content-request/${wsId}/${reqId}/request-post-changes`, { feedback }),
};
```

- [ ] **Step 7.2: Verify compile**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 7.3: Commit**

```bash
git add src/api/content.ts
git commit -m "feat(api-client): add publicPostReview methods for client post-review flow"
```

---

## Task 8: PostReviewCard Client Component (Model: sonnet)

**Files:**
- Create: `src/hooks/client/useClientPostPreview.ts`
- Create: `src/components/client/PostReviewCard.tsx`

Do NOT modify any other file in this task. Depends on Tasks 1 and 7 being committed.

- [ ] **Step 8.0: Create `src/hooks/client/useClientPostPreview.ts`**

This hook is needed so PostReviewCard can fetch its own data via React Query, avoiding a hand-rolled `useState`+fetch pattern. Keeping post loading inside PostReviewCard means ContentTab needs no new state.

```typescript
import { useQuery } from '@tanstack/react-query';
import { publicPostReview } from '../../api/content';
import type { GeneratedPost } from '../../../shared/types/content';

/**
 * Fetches a GeneratedPost for client review.
 * Only fires when `enabled` is true (i.e., the card is expanded and status is post_review).
 */
export function useClientPostPreview(
  workspaceId: string,
  postId: string | undefined,
  enabled: boolean,
) {
  return useQuery<GeneratedPost>({
    queryKey: ['client', 'post-preview', workspaceId, postId],
    queryFn: () => publicPostReview.getPost(workspaceId, postId!),
    enabled: !!postId && enabled,
    staleTime: 1000 * 60 * 5, // 5 min — post content rarely changes mid-session
    retry: false,
  });
}
```

- [ ] **Step 8.1: Create `src/components/client/PostReviewCard.tsx`**

```typescript
import { useState } from 'react';
import { Check, X, ChevronDown, ChevronUp, Edit3 } from 'lucide-react';
import type { ClientContentRequest } from './types';
import type { GeneratedPost } from '../../../shared/types/content';
import { publicPostReview } from '../../api/content';
import { useClientPostPreview } from '../../hooks/client/useClientPostPreview';

interface PostReviewCardProps {
  request: ClientContentRequest;
  workspaceId: string;
  onUpdate: (updated: ClientContentRequest) => void;
  setToast: (t: { message: string; type: 'success' | 'error' } | null) => void;
}

export function PostReviewCard({ request, workspaceId, onUpdate, setToast }: PostReviewCardProps) {
  // Self-fetches post data via React Query (no hand-rolled state/effect needed)
  const { data: fetchedPost, isLoading: postLoading } = useClientPostPreview(workspaceId, request.postId, true);
  const [post, setPost] = useState<GeneratedPost | undefined>(undefined);

  // Sync fetched post into local state once (so edits can update it without refetching)
  if (fetchedPost && !post) setPost(fetchedPost);

  if (postLoading) return <p className="text-xs text-zinc-500 mt-3 animate-pulse">Loading post…</p>;
  if (!post) return <p className="text-xs text-zinc-500 mt-3">Post not available.</p>;
  const [editingSection, setEditingSection] = useState<number | null>(null);
  const [sectionDraft, setSectionDraft] = useState('');
  const [editingIntro, setEditingIntro] = useState(false);
  const [introDraft, setIntroDraft] = useState('');
  const [editingConclusion, setEditingConclusion] = useState(false);
  const [conclusionDraft, setConclusionDraft] = useState('');
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);

  async function saveSection(index: number, content: string) {
    try {
      const sections = post.sections.map(s =>
        s.index === index ? { ...s, content, wordCount: content.split(/\s+/).filter(Boolean).length } : s
      );
      const updated = await publicPostReview.clientEdit(workspaceId, post.id, { sections });
      setPost(updated);
      setEditingSection(null);
      setToast({ message: 'Section saved', type: 'success' });
    } catch {
      setToast({ message: 'Failed to save section', type: 'error' });
    }
  }

  async function saveIntro(content: string) {
    try {
      const updated = await publicPostReview.clientEdit(workspaceId, post.id, { introduction: content });
      setPost(updated);
      setEditingIntro(false);
      setToast({ message: 'Introduction saved', type: 'success' });
    } catch {
      setToast({ message: 'Failed to save introduction', type: 'error' });
    }
  }

  async function saveConclusion(content: string) {
    try {
      const updated = await publicPostReview.clientEdit(workspaceId, post.id, { conclusion: content });
      setPost(updated);
      setEditingConclusion(false);
      setToast({ message: 'Conclusion saved', type: 'success' });
    } catch {
      setToast({ message: 'Failed to save conclusion', type: 'error' });
    }
  }

  async function handleApprove() {
    setApproving(true);
    try {
      const updated = await publicPostReview.approvePost(workspaceId, request.id);
      onUpdate(updated as unknown as ClientContentRequest);
      setToast({ message: 'Post approved! Your team has been notified.', type: 'success' });
    } catch {
      setToast({ message: 'Failed to approve post', type: 'error' });
    } finally {
      setApproving(false);
    }
  }

  async function handleRequestChanges() {
    if (!feedback.trim()) {
      setShowFeedback(true);
      return;
    }
    setSubmitting(true);
    try {
      const updated = await publicPostReview.requestPostChanges(workspaceId, request.id, feedback.trim());
      onUpdate(updated as unknown as ClientContentRequest);
      setToast({ message: 'Feedback sent to your team.', type: 'success' });
    } catch {
      setToast({ message: 'Failed to send feedback', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 mt-3">
      {/* Post header */}
      <div className="px-1">
        <h3 className="text-sm font-semibold text-zinc-100">{post.title}</h3>
        {post.metaDescription && (
          <p className="text-xs text-zinc-400 mt-1 italic">{post.metaDescription}</p>
        )}
      </div>

      {/* Introduction */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Introduction</span>
          {!editingIntro && (
            <button
              onClick={() => { setIntroDraft(post.introduction.replace(/<[^>]+>/g, '')); setEditingIntro(true); }}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-teal-400 transition-colors"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>
        {editingIntro ? (
          <div className="space-y-2">
            <textarea
              value={introDraft}
              onChange={e => setIntroDraft(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-300 focus:border-teal-500/50 focus:outline-none resize-y"
              rows={4}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => saveIntro(introDraft)} className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 hover:bg-teal-600/30 transition-colors">Save</button>
              <button onClick={() => setEditingIntro(false)} className="px-2.5 py-1 rounded text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
            </div>
          </div>
        ) : (
          <div
            className="text-xs text-zinc-300 leading-relaxed prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: post.introduction }}
          />
        )}
      </div>

      {/* Sections */}
      {post.sections.map(section => (
        <div key={section.index} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-200">{section.heading}</span>
            {editingSection !== section.index && (
              <button
                onClick={() => { setSectionDraft(section.content.replace(/<[^>]+>/g, '')); setEditingSection(section.index); }}
                className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-teal-400 transition-colors"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            )}
          </div>
          {editingSection === section.index ? (
            <div className="space-y-2">
              <textarea
                value={sectionDraft}
                onChange={e => setSectionDraft(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-300 focus:border-teal-500/50 focus:outline-none resize-y"
                rows={6}
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={() => saveSection(section.index, sectionDraft)} className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 hover:bg-teal-600/30 transition-colors">Save</button>
                <button onClick={() => setEditingSection(null)} className="px-2.5 py-1 rounded text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <div
              className="text-xs text-zinc-300 leading-relaxed prose prose-invert prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: section.content }}
            />
          )}
        </div>
      ))}

      {/* Conclusion */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">Conclusion</span>
          {!editingConclusion && (
            <button
              onClick={() => { setConclusionDraft(post.conclusion.replace(/<[^>]+>/g, '')); setEditingConclusion(true); }}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-teal-400 transition-colors"
            >
              <Edit3 className="w-3 h-3" /> Edit
            </button>
          )}
        </div>
        {editingConclusion ? (
          <div className="space-y-2">
            <textarea
              value={conclusionDraft}
              onChange={e => setConclusionDraft(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-300 focus:border-teal-500/50 focus:outline-none resize-y"
              rows={4}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => saveConclusion(conclusionDraft)} className="px-2.5 py-1 rounded bg-teal-600/20 border border-teal-500/30 text-[11px] text-teal-300 hover:bg-teal-600/30 transition-colors">Save</button>
              <button onClick={() => setEditingConclusion(false)} className="px-2.5 py-1 rounded text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
            </div>
          </div>
        ) : (
          <div
            className="text-xs text-zinc-300 leading-relaxed prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: post.conclusion }}
          />
        )}
      </div>

      {/* Steering feedback */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/80 p-3">
        <button
          onClick={() => setShowFeedback(v => !v)}
          className="flex items-center justify-between w-full text-left"
        >
          <span className="text-[11px] font-medium text-zinc-400">Notes for the team <span className="text-zinc-600">(optional steering feedback)</span></span>
          {showFeedback ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
        </button>
        {showFeedback && (
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="e.g. 'Please make the tone less formal' or 'Add more specifics about our pricing model in section 2'"
            className="mt-2 w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 focus:border-teal-500/50 focus:outline-none resize-y"
            rows={3}
          />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleApprove}
          disabled={approving || submitting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-teal-600 to-emerald-600 text-white text-xs font-medium hover:from-teal-500 hover:to-emerald-500 transition-all disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" />
          {approving ? 'Approving…' : 'Approve Post'}
        </button>
        <button
          onClick={() => { setShowFeedback(true); handleRequestChanges(); }}
          disabled={approving || submitting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-zinc-700 text-zinc-400 text-xs font-medium hover:border-zinc-600 hover:text-zinc-300 transition-all disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" />
          {submitting ? 'Sending…' : 'Request Changes'}
        </button>
      </div>
      {showFeedback && !feedback.trim() && (
        <p className="text-[11px] text-amber-400">Please add notes describing what you'd like changed before requesting revisions.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 8.2: Verify compile**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 8.3: Commit**

```bash
git add src/hooks/client/useClientPostPreview.ts src/components/client/PostReviewCard.tsx
git commit -m "feat(client): add self-fetching PostReviewCard with inline editing and approve/reject"
```

---

## Task 9: Wire PostReviewCard into ContentTab (Model: sonnet)

**Files:**
- Modify: `src/components/client/ContentTab.tsx`

Do NOT modify any other file in this task. Depends on Task 8 being committed.

- [ ] **Step 9.0: Fix `ContentTab` summary card and alert banner to include `post_review`**

Two places in `ContentTab.tsx` need updating:

**(a) `inProgress` bucket in the summary stats cards** (look for the array near the top of the component where statuses are grouped):

Find the `inProgress` bucket definition (it should contain `['pending_payment', 'requested', 'brief_generated', 'changes_requested', 'approved', 'in_progress']`). Add `'post_review'`:

```typescript
const inProgress = requests.filter(r =>
  ['pending_payment', 'requested', 'brief_generated', 'changes_requested', 'approved', 'in_progress', 'post_review'].includes(r.status)
);
```

**(b) Alert banner for client action needed** (look around line 95, where `client_review` count is computed for the "briefs ready for review" banner):

The banner currently reads something like:
```typescript
const needsReview = requests.filter(r => r.status === 'client_review').length;
```

Add a separate count for posts needing review and show both notifications:
```typescript
const needsBriefReview = requests.filter(r => r.status === 'client_review').length;
const needsPostReview = requests.filter(r => r.status === 'post_review').length;
```

Then in the banner JSX, show a post review alert alongside the existing brief alert:
```tsx
{needsPostReview > 0 && (
  <div className="...alert-banner-classes...">
    <Eye className="w-4 h-4 text-cyan-400" />
    <span>{needsPostReview} post{needsPostReview > 1 ? 's' : ''} ready for your review</span>
  </div>
)}
```

Match the existing banner's styling exactly. Add `Eye` to the lucide-react import if not already present.

- [ ] **Step 9.1: Import `PostReviewCard` in `ContentTab.tsx`**

At the top of the file, add with the other local imports:

```typescript
import { PostReviewCard } from './PostReviewCard';
```

No additional imports needed — `PostReviewCard` is self-fetching (uses its own React Query hook internally). No hand-rolled state is needed in ContentTab.

- [ ] **Step 9.2: (No longer needed — PostReviewCard self-fetches via React Query)**

PostReviewCard uses `useClientPostPreview` internally (created in Task 8). Do NOT add `postPreviews`/`loadingPost` state to ContentTab — this would violate CLAUDE.md's prohibition on hand-rolled `useState`+fetch patterns.

- [ ] **Step 9.3: (No longer needed — see Step 9.2)**

- [ ] **Step 9.4: No change needed to the expand trigger**

`PostReviewCard` fetches its own data when rendered, so nothing needs to be triggered on expand. The existing expand logic (calls `setExpandedContentReq` and `loadBriefPreview`) stays untouched.

- [ ] **Step 9.5: Render `PostReviewCard` inside the expanded request for `post_review` status**

Find where the brief preview is rendered for `client_review` status (look for where `brief &&` and the brief outline are rendered, around lines 390–500). After the brief block, add a new block for `post_review`:

```typescript
{req.status === 'post_review' && (
  <PostReviewCard
    request={req}
    workspaceId={workspaceId}
    onUpdate={updated => {
      setContentRequests(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
    }}
    setToast={setToast}
  />
)}
```

- [ ] **Step 9.6: Add `post_review` to the progress stepper step list in `ContentTab`**

Find where the `steps` array is defined for the progress stepper (look for `['Requested', 'Brief Ready', 'Your Review', 'Approved', ...]`). Add `'Post Review'` between `'In Production'` and `'Delivered'`:

```typescript
const steps = req.serviceType === 'full_post'
  ? ['Requested', 'Brief Ready', 'Your Review', 'Approved', 'In Production', 'Post Review', 'Delivered', 'Published'] as const
  : ['Requested', 'Brief Ready', 'Your Review', 'Approved', 'Delivered', 'Published'] as const;
```

Ensure the `currentStep` computation maps `post_review` → the index of `'Post Review'`.

- [ ] **Step 9.7: Add `post_review` to the status label displayed in the card header**

Find the status label map (where `in_progress` maps to `'In Progress'` or similar). Add:

```typescript
post_review: 'Needs Your Review',
```

- [ ] **Step 9.8: Verify compile**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors and successful build.

- [ ] **Step 9.9: Commit**

```bash
git add src/components/client/ContentTab.tsx
git commit -m "feat(client): render PostReviewCard for post_review requests in ContentTab"
```

---

## Task 10: Integration Tests (Model: sonnet)

**Files:**
- Create: `tests/integration/client-post-review.test.ts`

Depends on Tasks 4, 5, 6, and 9 being committed. Uses port **13328** (check existing tests first: `grep -r 'createTestContext(' tests/` to confirm it's free).

- [ ] **Step 10.1: Write failing tests first**

Create `tests/integration/client-post-review.test.ts`:

```typescript
/**
 * Integration tests for client post review flow.
 *
 * Tests the public API endpoints added in Task 4:
 * - POST /api/public/content-request/:wsId/:id/approve-post
 * - POST /api/public/content-request/:wsId/:id/request-post-changes
 *
 * And the state machine guard (via admin PATCH) for post_review transitions.
 *
 * Pattern follows tests/integration/content-requests-routes.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13328);
const { api, postJson, patchJson } = ctx;

let testWsId = '';

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('Post Review Test Workspace');
  testWsId = ws.id;
}, 25_000);

afterAll(() => {
  deleteWorkspace(testWsId);
  ctx.stopServer();
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function createRequest(topic: string, kw: string): Promise<{ id: string; status: string }> {
  const res = await postJson(`/api/content-requests/${testWsId}`, {
    topic, targetKeyword: kw, intent: 'informational',
    priority: 'medium', rationale: '', serviceType: 'full_post',
  });
  expect(res.status).toBe(200);
  return res.json() as Promise<{ id: string; status: string }>;
}

async function setStatus(reqId: string, status: string): Promise<Response> {
  return patchJson(`/api/content-requests/${testWsId}/${reqId}`, { status });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/public/content-request/:wsId/:id/approve-post', () => {
  it('transitions post_review → delivered', async () => {
    const req = await createRequest('Approve Test', `approve-test-${Date.now()}`);

    // Walk to in_progress → post_review
    await setStatus(req.id, 'in_progress');
    const toPostReview = await setStatus(req.id, 'post_review');
    expect(toPostReview.status).toBe(200);

    // Client approves via public route (no auth required)
    const res = await postJson(`/api/public/content-request/${testWsId}/${req.id}/approve-post`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('delivered');
  });

  it('rejects approve-post from a non-post_review status (e.g. in_progress)', async () => {
    const req = await createRequest('Bad Approve Test', `bad-approve-${Date.now()}`);
    await setStatus(req.id, 'in_progress');
    // Do NOT advance to post_review

    const res = await postJson(`/api/public/content-request/${testWsId}/${req.id}/approve-post`, {});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/public/content-request/:wsId/:id/request-post-changes', () => {
  it('transitions post_review → changes_requested and stores clientFeedback', async () => {
    const req = await createRequest('Changes Test', `changes-test-${Date.now()}`);

    await setStatus(req.id, 'in_progress');
    await setStatus(req.id, 'post_review');

    const res = await postJson(
      `/api/public/content-request/${testWsId}/${req.id}/request-post-changes`,
      { feedback: 'Please make section 2 more detailed.' },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; clientFeedback: string };
    expect(body.status).toBe('changes_requested');
    expect(body.clientFeedback).toBe('Please make section 2 more detailed.');
  });

  it('rejects request-post-changes from non-post_review status', async () => {
    const req = await createRequest('Guard Test', `guard-test-${Date.now()}`);
    // Stays at 'requested' — does NOT advance to post_review

    const res = await postJson(
      `/api/public/content-request/${testWsId}/${req.id}/request-post-changes`,
      { feedback: 'Should be rejected.' },
    );
    expect(res.status).toBe(400);
  });

  it('rejects request-post-changes with empty feedback', async () => {
    const req = await createRequest('Empty Feedback Test', `empty-fb-${Date.now()}`);
    await setStatus(req.id, 'in_progress');
    await setStatus(req.id, 'post_review');

    const res = await postJson(
      `/api/public/content-request/${testWsId}/${req.id}/request-post-changes`,
      { feedback: '' },
    );
    expect(res.status).toBe(400); // Zod min(1) validation
  });
});

describe('State machine guard: in_progress → post_review', () => {
  it('allows in_progress → post_review', async () => {
    const req = await createRequest('SM Allow Test', `sm-allow-${Date.now()}`);
    await setStatus(req.id, 'in_progress');
    const res = await setStatus(req.id, 'post_review');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('post_review');
  });

  it('blocks requested → post_review directly (must go through in_progress)', async () => {
    const req = await createRequest('SM Block Test', `sm-block-${Date.now()}`);
    // 'requested' cannot jump to 'post_review' — must walk through in_progress
    const res = await setStatus(req.id, 'post_review');
    expect(res.status).toBe(400);
  });
});
```

> **PLAN_WRITING_GUIDE update needed:** Port 13328 is the next free port (verified against codebase — current max is 13327). After this task, update `docs/PLAN_WRITING_GUIDE.md` line ~197 to show the new range as 13201–13328.

- [ ] **Step 10.2: Run tests — confirm they fail correctly before implementation**

```bash
npx vitest run tests/integration/client-post-review.test.ts
```

Expected: FAIL (routes don't exist yet, or transitions not yet in state machine — depending on what tasks are done).

- [ ] **Step 10.3: Run full test suite after all tasks complete**

```bash
npx vitest run
```

Expected: all tests pass, no regressions.

- [ ] **Step 10.4: Build verify**

```bash
npm run typecheck && npx vite build
```

Expected: zero errors, successful build.

- [ ] **Step 10.5: Run pr-check**

```bash
npx tsx scripts/pr-check.ts
```

Expected: zero errors.

- [ ] **Step 10.6: Commit**

```bash
git add tests/integration/client-post-review.test.ts
git commit -m "test(integration): add client-post-review flow tests"
```

---

## Post-Implementation Checklist

- [ ] `FEATURE_AUDIT.md` — add entry: "Client Post Review — client can view, edit, approve or request changes on full posts before delivery"
- [ ] `data/roadmap.json` — mark item done, run `npx tsx scripts/sort-roadmap.ts`
- [ ] `BRAND_DESIGN_LANGUAGE.md` — no new color patterns introduced; confirm no purple in `PostReviewCard`
- [ ] `npx tsx scripts/pr-check.ts` — zero errors
- [ ] No `violet` or `indigo` in `src/components/client/`

---

## Systemic Improvements

These are improvements that should accompany (or follow immediately after) the feature implementation.

### 1. Shared utilities extracted by this feature
- **`useClientPostPreview` hook** (`src/hooks/client/useClientPostPreview.ts`) — created in Task 8. Pattern: `useQuery` for client-portal data fetching. Any future client-portal post reads should reuse this hook.

### 2. pr-check rules to consider adding

**(a) Public mutation routes missing `post_review` in status badge maps**
After implementation, run `grep -r "post_review" src/components/client/ContentTab.tsx` and confirm the summary-card status arrays were updated. A pr-check rule could enforce that any `status === 'post_review'` string in a route file has a corresponding entry in the client status badge map — but this is complex to automate. At minimum, add a manual checklist item: "New status values added to state machine must appear in ContentTab status config and summary buckets."

**(b) Public mutation activity logging**
The existing pr-check rule `Public-portal mutation without addActivity` (see `docs/rules/automated-rules.md`) already covers `approve-post` and `request-post-changes`. Verify both new routes call `addActivity` — this is already in the plan (Task 4) but the pr-check will catch it if missed.

### 3. Test coverage additions

**Required as part of this plan (Task 10):**
- `approve-post` happy path and guard (non-`post_review` status blocked)
- `request-post-changes` happy path, guard, and empty-feedback validation
- `in_progress → post_review` allowed; `requested → post_review` blocked

**Recommended follow-up tests (not in this plan — add after merge):**
- `content-lifecycle.test.ts`: Add `post_review` to the happy-path walkthrough (`in_progress → post_review → delivered`) so the lifecycle suite covers the new state
- `PATCH /api/public/content-posts/:wsId/:postId/client-edit`: Unit test that `snapshotPostVersion` is called before the edit, and the updated sections are persisted correctly

### 4. Intelligence engine wiring (deferred)
Post feedback (`clientFeedback`, `voiceScore`, `voiceFeedback`, `reviewChecklist`) is stored in the DB but not in `ClientSignalsSlice` (`shared/types/intelligence.ts`). Adding `contentFeedbackSignals` to that slice would let AdminChat and the strategy engine learn from client post reactions. Tracked separately — not in scope for this plan.

---

## Self-Review Notes

**Spec coverage verified:**
- ✅ `post_review` state machine transitions (Task 1)
- ✅ `postId` DB column, migration, mapper, write path (Task 1: Steps 1.0 + 1.2 + 1.3b)
- ✅ `postId` public serialization (Task 4, Step 4.0)
- ✅ Admin "Send Post to Client" button (Task 6)
- ✅ Email notification to client (Tasks 2 + 5)
- ✅ Public post read endpoint (Task 4.2)
- ✅ Client inline section editing (Tasks 4.5 + 8)
- ✅ Steering feedback textarea (Task 8)
- ✅ Client approve action → `delivered` (Tasks 4.3 + 8)
- ✅ Client request-changes action → `changes_requested` (Tasks 4.4 + 8)
- ✅ Admin sees client-edited version via post versioning (Task 4.5 calls `snapshotPostVersion`)
- ✅ Integration tests — all use correct test infrastructure (`createWorkspace`/`deleteWorkspace`, `postJson`/`patchJson`/`api`, `ctx.stopServer()`) (Task 10)
- ✅ Model assignments on all 10 tasks
- ✅ Systemic improvements section present
- ✅ `ContentTab` summary cards and alert banner updated for `post_review` (Task 9, Step 9.0)
- ✅ PostReviewCard uses React Query (`useClientPostPreview`) — no hand-rolled `useState`+fetch (Tasks 8 + 9)

**Audit findings resolved (April 2026 review):**
1. Model assignments — added to all task headings ✅
2. Systemic improvements section — added ✅
3. `postId` missing from data model — migration 073 + DB module changes added to Task 1 ✅
4. Hand-rolled `useState`+fetch in Task 9 — replaced with self-fetching PostReviewCard + `useClientPostPreview` hook ✅
5. Task 10 test infrastructure incompatibilities — rewritten with correct imports, signatures, and API surface ✅
6. `ContentTab` summary cards/banner missing `post_review` — added Step 9.0 ✅
7. PLAN_WRITING_GUIDE port range stale — note added in Task 10 to update docs ✅

**Conscious design decisions (not bugs):**
- `changes_requested → post_review` shortcut NOT added to state machine — admin must re-enter `in_progress` to re-send; this is intentional (forces an explicit re-queue step)
- `briefId` gate in Step 4.0 does NOT include `post_review` — client's focus during post_review is the post, not the brief; intentional
- `dangerouslySetInnerHTML` in PostReviewCard — follows existing codebase pattern for AI-generated HTML; content is AI-generated (not user-submitted), low XSS risk
