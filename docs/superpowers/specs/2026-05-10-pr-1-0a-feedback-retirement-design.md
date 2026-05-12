# PR 1.0a — Retire `feedback` table

**Date:** 2026-05-10
**Phase 1 PR:** 1.0a (foundation cleanup, parallel-safe)
**Parent IA spec:** `2026-05-09-client-ia-redesign-design.md` §3.5 Rule 4 + §5.1
**Branch:** `feat/feedback-retirement` from `staging`

---

## Goal

Fully retire the legacy `feedback` table and its surrounding plumbing. The table holds in-app feedback submissions from a sidebar `FeedbackWidget` mounted in the client dashboard. After audit confirmed it's overlapping with `requests` and not serving a clear differentiated purpose, the IA spec mandates a full deprecation (no grace period).

This PR is a pure deletion. No new features, no behavior changes for actively-supported flows.

## Scope

### Files to delete

- `src/components/client/FeedbackWidget.tsx` — the sidebar widget itself
- `server/routes/feedback.ts` — admin CRUD route
- `server/routes/public-feedback.ts` — client submission route (if exists; verify path during implementation)
- `shared/types/feedback.ts` (if exists; verify during implementation)
- `tests/integration/feedback-routes.test.ts` (if exists; verify during implementation)
- Any `useFeedback*` hook in `src/hooks/` (verify during implementation)

### Files to modify

- `src/components/ClientDashboard.tsx` — remove `FeedbackWidget` import (line 30) and mount (line 916)
- `src/components/client/ClientChatWidget.tsx` — remove the `chatExpanded` callback wiring that exists solely for FeedbackWidget (lines 28, 91)
- `src/components/client/index.ts` — remove the `FeedbackWidget` export (line 4)
- `server/app.ts` — remove route registrations for `/api/feedback/*` and `/api/public/feedback/*`
- Any other call sites discovered during pre-plan audit

### Migration

A new migration that:
1. Migrates existing `feedback` rows to `requests` with `category: 'general'`, preserving title/description/timestamps where mappable, prefixing the title with `[migrated from feedback]` so the team knows the provenance
2. Drops the `feedback` table
3. Drops any indexes on `feedback`

The migration must be reversible-safe to a reasonable extent — even though we're deleting, the row migration to `requests` preserves the data.

### Tests

- Migration test: seed feedback rows pre-migration, verify they exist as requests post-migration with `category: 'general'`
- Integration test: verify `GET /api/feedback/...` returns 404 (route removed)
- Integration test: verify `POST /api/public/feedback` returns 404 (route removed)
- Component test: verify `ClientDashboard` does not render `FeedbackWidget` (it's deleted, so import would error)

### Documentation

- Update `CLAUDE.md` if it references the feedback table or FeedbackWidget anywhere (verify via grep during audit)
- No new docs needed; the IA spec already documents the rationale

## Out of scope

- Any change to `requests` table or its public API surface
- Any change to the new IA / Inbox structure (that's PR 1.2)
- Any change to admin tooling beyond removing dead feedback routes
- "We called it" hide (PR 1.3) and `keyword_strategy` deprecation (PR 1.0b) are sibling PRs

## Risks

- **Data loss risk:** mitigated by the migration step that preserves existing feedback rows as requests
- **Hidden references:** any other component or test that imports `FeedbackWidget` or fetches the feedback API will break — pre-plan audit must enumerate exhaustively
- **Email notification triggers:** if any email path mentions feedback, that needs adjustment too

## Verification

Per the brief, all of these must be green before opening the PR:

```
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

Plus full test suite pass (per project quality gate).

## Success criteria

- `feedback` table dropped (and rows preserved in `requests`)
- All routes removed
- All client/server imports of FeedbackWidget gone
- pr-check zero errors
- Full test suite green
- Codex independent review approves
- Scaled-code-review approves
- Staging CI green
- Smoke test: `curl /api/public/feedback/...` returns 404
- Merged to main with green production CI
