# PR 1.0a — Feedback Retirement Pre-Plan Audit

**Date:** 2026-05-10
**Spec:** `docs/superpowers/specs/2026-05-10-pr-1-0a-feedback-retirement-design.md`
**Worktree:** `.claude/worktrees/feedback-retirement/` (`feat/feedback-retirement`)
**Total findings:** 28 files touched (8 deletions, 18 modifications, 2 creations)

---

## Findings

### FILES TO DELETE (8)

| File | Reason |
|------|--------|
| `src/components/client/FeedbackWidget.tsx` | 341-line component — the widget itself |
| `server/routes/feedback.ts` | 5 admin routes (list-all, list-by-ws, PATCH status, POST reply, DELETE) |
| `server/routes/public-feedback.ts` | 3 client portal routes (POST submit, GET list, POST reply) |
| `server/feedback.ts` | CRUD module: `FeedbackItem`, `FeedbackRow`, `FeedbackStatus`, `FeedbackType` types + all DB ops + broadcasts |
| `tests/integration/feedback-routes.test.ts` | Port 13220 — tests all 8 route handlers; deleted with the routes |
| `tests/integration/public-feedback-broadcasts.test.ts` | Broadcast tests for feedback:new + feedback:update events; deleted with the routes |

### FILES TO MODIFY — Frontend (7)

| File | Line(s) | Change |
|------|---------|--------|
| `src/components/client/index.ts` | 4 | Remove `export { FeedbackWidget } from './FeedbackWidget'` |
| `src/components/ClientDashboard.tsx` | 30, 916 | Remove import + remove `<FeedbackWidget ...>` mount |
| `src/components/client/ClientChatWidget.tsx` | 28, 91 | Remove JSDoc comment referencing FeedbackWidget (lines are comments only, not logic) |
| `src/api/misc.ts` | 200–205 | Remove `feedback` object (`submit()` + `list()`) |
| `src/api/index.ts` | 9 | Remove `feedback` from re-exports |
| `src/hooks/admin/useWorkspaceOverview.ts` | 41–52, 71, 91 | Remove local `FeedbackItem` type def, `feedback: FeedbackItem[]` from `WorkspaceOverviewData`, and `getSafe('/api/feedback', [])` call |
| `src/components/WorkspaceOverview.tsx` | 7, 31, 43, 373–466 | Remove `FeedbackItem` import, `feedbackReply` state, `feedback` variable, and entire "Client Feedback" section (~90 lines) |

### FILES TO MODIFY — Server (9)

| File | Line(s) | Change |
|------|---------|--------|
| `server/app.ts` | 57 | Remove `import feedbackRoutes from './routes/feedback.js'` + remove router registration |
| `server/route-groups/public.ts` | 9, 19 | Remove `import publicFeedbackRoutes from '../routes/public-feedback.js'` + `app.use(publicFeedbackRoutes)` |
| `server/ws-events.ts` | 37–38 | Remove `FEEDBACK_NEW: 'feedback:new'` and `FEEDBACK_UPDATE: 'feedback:update'` |
| `server/email.ts` | 381–391 | Remove `notifyTeamNewFeedback()` function |
| `server/email-templates.ts` | 180, 254–287 | Remove `'feedback_new'` from `EmailEventType` union + `case 'feedback_new':` + `renderFeedbackNew()` function |
| `server/email-throttle.ts` | 60 | Remove `feedback_new: 'internal'` entry |
| `shared/types/intelligence.ts` | 247 | Remove `feedbackItems?: Array<{ id: string; type: string; status: string; createdAt: string }>` from `ClientSignalsSlice` |
| `server/intelligence/client-signals-slice.ts` | 243–247, 375 | Remove `feedbackItems` variable + DB read + slice field assignment |
| `server/intelligence/formatters.ts` | 668–670 | Remove `feedbackItems` formatter block |

### FILES TO MODIFY — Tests & Fixtures (4)

| File | Line(s) | Change |
|------|---------|--------|
| `tests/fixtures/rich-intelligence.ts` | 233 | Remove `feedbackItems` array from rich-intelligence fixture |
| `tests/assemble-client-signals.test.ts` | 35, 134, 156, 323–337, 408–448 | Remove `server/feedback.js` mock + all `feedbackItems` test data/assertions |
| `tests/format-for-prompt.test.ts` | 104, 267 | Remove feedback-item formatting test cases |
| `tests/unit/row-mapper-completeness.test.ts` | 70, 129, 816–906 | Remove `feedback` table from row-mapper completeness coverage check |

### FILES TO MODIFY — Docs (1)

| File | Change |
|------|--------|
| `FEATURE_AUDIT.md` | Remove FeedbackWidget entry |

### FILES TO CREATE (2)

| File | Purpose |
|------|---------|
| `server/db/migrations/091-retire-feedback-table.sql` | Migrate feedback rows → requests (category='general'), drop indexes, drop table |
| `tests/integration/feedback-retirement.test.ts` | Port 13352 — verify /api/feedback/* and /api/public/feedback/* all return 404 |

---

## Feedback Table Schema (source of truth for migration)

Created in **migration 003**, modified in **019** (FK + cascade), indexed in **026**.

```sql
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- 'bug' | 'feature' | 'general'
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  context TEXT,
  submitted_by TEXT,
  replies TEXT NOT NULL DEFAULT '[]',  -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_feedback_workspace ON feedback(workspace_id);
CREATE INDEX idx_feedback_ws_status ON feedback(workspace_id, status);
```

**No foreign keys reference the feedback table** — safe to drop directly.

**Next migration number:** 091 (current highest is 090).

---

## Migration Strategy

The migration (`091-retire-feedback-table.sql`) must:

1. **Map feedback → requests**: Insert each feedback row into `requests` with:
   - `category: 'general'` (or the requests equivalent)
   - `title`: original title prefixed with `[migrated from feedback] `
   - `description`: original `description`
   - `status`: map `'new'` → pending, others → closed/resolved (verify requests status enum during implementation)
   - `created_at`, `updated_at`: preserved from feedback row
   - `workspace_id`: preserved
   - `id`: new UUID (requests has its own PK scheme)

2. **Before writing migration**: Read `server/db/migrations/003-per-workspace.sql` (requests table definition) to confirm exact column names and required fields. Never guess column names.

3. **Drop indexes**: `DROP INDEX IF EXISTS idx_feedback_ws_status; DROP INDEX IF EXISTS idx_feedback_workspace;`

4. **Drop table**: `DROP TABLE IF EXISTS feedback;`

Migration is intentionally **not reversible** — rows are preserved in `requests`, so data is not lost.

---

## Email Path Detail

`notifyTeamNewFeedback()` is called **only** from `server/routes/public-feedback.ts` (line 62). Deleting the route file removes the only caller. Still must delete the function from `server/email.ts` and the template from `server/email-templates.ts` to avoid dead code and failing type checks.

Email throttle: `feedback_new: 'internal'` in `server/email-throttle.ts` (line 60) must be removed to keep the throttle config consistent with the union type.

---

## Intelligence Wiring Detail

`server/intelligence/client-signals-slice.ts` reads feedback items and injects them into the `ClientSignalsSlice`:
- Reads up to 10 most recent feedback items from DB
- Shapes them as `{ id, type, status, createdAt }`
- Assigns to `feedbackItems` on the slice

`server/intelligence/formatters.ts` renders them as: `"Feedback: N items (M open)"` into the formatted prompt context.

Both the shared type (`shared/types/intelligence.ts:247`) and the assembler must be cleaned up in the same task to avoid a TypeScript error where `feedbackItems` is referenced but removed from the interface.

---

## WS Events Detail

`FEEDBACK_NEW` and `FEEDBACK_UPDATE` are defined only in `server/ws-events.ts` (lines 37–38). They are used only within `server/feedback.ts` (which is being deleted). Removing both constants from `ws-events.ts` is safe.

No frontend component (other than the deleted `FeedbackWidget.tsx`) subscribes to these events.

---

## Test Cleanup Notes

### Tests to DELETE:
- `feedback-routes.test.ts` (port 13220) — full HTTP route tests, deleted with routes
- `public-feedback-broadcasts.test.ts` — broadcast tests, deleted with broadcasts

### Tests to MODIFY (remove feedback-related assertions only, keep rest intact):
- `tests/assemble-client-signals.test.ts` — mocks `server/feedback.js`; has `feedbackItems` assertions in multiple test cases; must be carefully trimmed, not deleted wholesale
- `tests/format-for-prompt.test.ts` — has feedback item formatting tests at lines 104, 267; remove only those cases
- `tests/unit/row-mapper-completeness.test.ts` — has feedback table in completeness check (lines 816–906); remove the feedback table assertions

### New test (port 13352):
`tests/integration/feedback-retirement.test.ts` — lightweight test that:
1. Boots the server
2. Asserts `GET /api/feedback` → 404
3. Asserts `GET /api/feedback/:wsId` → 404
4. Asserts `POST /api/public/feedback/:wsId` → 404
5. Asserts `GET /api/public/feedback/:wsId` → 404

---

## Parallelization Strategy

This PR uses **subagent-driven development** (one task at a time, sequential) per the brief. Tasks are ordered to avoid TypeScript errors at intermediate steps.

### Phase 0 — Migration first (blocks nothing else but must exist before test task)
1. Write + commit migration `091-retire-feedback-table.sql` (Haiku — SQL only)

### Phase 1 — Deletions and core server cleanup (sequential, each task commits)
2. Delete `server/feedback.ts`, `server/routes/feedback.ts`, `server/routes/public-feedback.ts`; remove registrations from `server/app.ts` + `server/route-groups/public.ts`; remove WS events from `server/ws-events.ts` (Sonnet — multi-file coordination)
3. Delete email function + template + throttle entry (`server/email.ts`, `server/email-templates.ts`, `server/email-throttle.ts`) (Haiku — straightforward deletions)

### Phase 2 — Intelligence cleanup (Sonnet — shared type + 3 server files)
4. Remove `feedbackItems` from `shared/types/intelligence.ts`, `server/intelligence/client-signals-slice.ts`, `server/intelligence/formatters.ts` — all in one commit

### Phase 3 — Frontend cleanup (Sonnet — 7 frontend files)
5. Delete `FeedbackWidget.tsx`; modify `client/index.ts`, `ClientDashboard.tsx`, `ClientChatWidget.tsx`, `src/api/misc.ts`, `src/api/index.ts`, `useWorkspaceOverview.ts`, `WorkspaceOverview.tsx`

### Phase 4 — Test cleanup + new retirement test (Sonnet)
6. Delete `feedback-routes.test.ts`, `public-feedback-broadcasts.test.ts`; trim `assemble-client-signals.test.ts`, `format-for-prompt.test.ts`, `row-mapper-completeness.test.ts`, `rich-intelligence.ts` fixture; write `feedback-retirement.test.ts` (port 13352)

### Phase 5 — Docs
7. Remove `FEATURE_AUDIT.md` feedback entry (Haiku)

---

## Model Assignments

| Task | Model | Reasoning |
|------|-------|-----------|
| Migration SQL | Haiku | Pure SQL, no logic judgment |
| Email template removal | Haiku | Clear deletion, no logic |
| Docs update | Haiku | Text edit, no code |
| Intelligence type + assembler cleanup | Sonnet | Shared type + 3 files, TypeScript coordination |
| Server route + registration cleanup | Sonnet | Multi-file, needs to verify no remaining imports |
| Frontend cleanup | Sonnet | 7 files, needs to verify clean import removal |
| Test cleanup + new retirement test | Sonnet | Needs to write new test and surgically trim existing ones |
