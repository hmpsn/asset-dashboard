# PR 1.0b — Deprecate `keyword_strategy` Client Action

**Date:** 2026-05-10
**Phase 1 PR:** 1.0b (parallel-safe with 1.0a, 1.3, 1.4)
**Parent IA spec:** `2026-05-09-client-ia-redesign-design.md` §3.5 Rule 3 + §5.4
**Branch:** `feat/keyword-strategy-deprecation` from `staging`

---

## Goal

Remove `keyword_strategy` as a `ClientActionSourceType`. Keyword strategy already has a dedicated SEO Strategy page with its own approval/feedback workflow; surfacing it as an Inbox client_action duplicates the mental model. This PR:

1. Archives all existing pending `keyword_strategy` client_action rows (data preserved, not deleted)
2. Removes the creation path in `KeywordStrategy.tsx`
3. Removes the type from `ClientActionSourceType` union and all related payload types
4. Removes the `'keyword_strategy'` case from `ClientActionDetailModal`
5. Removes `keyword_strategy` from the server's `validSources` guard

This is a pure deletion / archival. No new features, no behavior changes to the SEO Strategy page or its existing workflow.

## What is NOT changing

- The workspace-level `keyword_strategy` column/field in `workspaces` table — this stores the actual strategy data for the SEO Strategy page. **Not touched.**
- `KeywordStrategyPayload`, `KeywordStrategyPage`, `KeywordStrategyQuickWin` types — if they are referenced only by `ClientActionSourceType`, they are removed. If referenced elsewhere (e.g. workspace intelligence), they stay.
- The `KeywordStrategy.tsx` component itself — only the "Send to client" action creation line is removed. The component remains fully functional.
- The `keyword_strategy` field in `server/workspace-data.ts` or any SEO page wiring.

## Scope

### Migration (create)
- `server/db/migrations/092-archive-keyword-strategy-actions.sql`
  ```sql
  UPDATE client_actions SET status = 'archived', updated_at = datetime('now')
  WHERE source_type = 'keyword_strategy' AND status = 'pending';
  ```
  No rows are deleted; archived status is already a valid `ClientActionStatus`.

### Files to modify

| File | Change |
|------|--------|
| `shared/types/client-actions.ts` | Remove `'keyword_strategy'` from `ClientActionSourceType` union; remove `KeywordStrategyPayload`, `KeywordStrategyPage`, `KeywordStrategyQuickWin` interfaces if only used by client_action (verify during audit) |
| `server/client-actions.ts` | Remove `'keyword_strategy'` from `validSources` array |
| `src/components/KeywordStrategy.tsx` | Remove the "Send to client" client_action creation block (one `createClientAction()` call + surrounding UI — button/modal/state) |
| `src/components/client/ClientActionDetailModal.tsx` | Remove `case 'keyword_strategy':` handler block |

### Files to verify (may need changes, must check during audit)
- Any test file mocking or testing `keyword_strategy` client actions
- `FEATURE_AUDIT.md` — check if keyword_strategy client_action is listed separately from the KeywordStrategy feature

### Files NOT to touch
- `server/keyword-gaps.ts`, `server/content-gaps.ts`, `server/cannibalization-issues.ts`, `server/topic-clusters.ts`, `server/workspaces.ts` — these reference `keyword_strategy` as a workspace JSON field, not as a `ClientActionSourceType`
- `src/components/KeywordStrategy.tsx` main component body — only remove the action creation; leave the rest

## Out of scope
- Any change to `client_actions` table schema
- Any change to SEO Strategy page UI or approval workflow
- Any change to `requests` table or inbox IA restructure (PR 1.1)

## Risks
- **TypeScript exhaustiveness**: removing a union member may break switch statements that have no `default` case — pre-plan audit must find all switch statements over `ClientActionSourceType`
- **Hidden payload references**: `KeywordStrategyPayload` may be imported by workspace intelligence formatters — verify before removing

## Verification
```
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

## Success criteria
- `source_type = 'keyword_strategy'` rows in `client_actions` are archived (status = 'archived')
- No code path can create a new `keyword_strategy` client_action
- `ClientActionSourceType` does not include `'keyword_strategy'`
- TypeScript has zero errors
- Full test suite green
- Codex + scaled-code-review approve
- Staging CI green
- Merged to staging
