# Automated Rules (generated)

> **DO NOT EDIT.** This file is regenerated from `scripts/pr-check.ts` on every PR.
> Run `npm run rules:generate` to update. CI fails if the committed file drifts
> from the generator output.

Total rules: **41** — 23 error, 18 warn.

Every rule below is enforced automatically by `npx tsx scripts/pr-check.ts`.
Rules in the **error** tier block merges; rules in the **warn** tier are
advisory but tracked.

---

## Errors (block merge)

| # | Rule | Severity | Method | Scope | Escape hatch | Rationale |
|---|------|----------|--------|-------|--------------|-----------|
| 1 | Purple in client components | error | pattern | `src/components/client/` | — | Purple is admin-only (Three Laws of Color). Use teal for actions, blue for data. |
| 2 | Forbidden hues (violet/indigo) in components | error | pattern | `*.ts, *.tsx` | — | violet- and indigo- are forbidden. Use teal, blue, or purple (admin only). |
| 3 | Bare JSON.parse on server | error | pattern | `server/` | — | Use parseJsonSafe() or parseJsonFallback() from server/db/json-validation.ts. |
| 4 | Hard-coded studio name | error | pattern | `*.ts, *.tsx` | — | Use the STUDIO_NAME / STUDIO_URL constant from src/constants.ts (frontend) or server/constants.ts (backend). |
| 5 | formatBrandVoiceForPrompt reintroduction | error | pattern | `*.ts, *.tsx` | — | A generic format helper that wraps a raw authority-layered field bypasses the authority chain silently — the compiler cannot catch it because the raw field type is still `string`. |
| 6 | z.array(z.unknown()) on server | error | pattern | `*.ts` | — | Use parseJsonSafeArray(raw, typedItemSchema, context) — z.unknown() bypasses per-item validation and requires unsafe casts. |
| 7 | Direct listPages() outside workspace-data | error | pattern | `server/` | — | Use getWorkspacePages() from workspace-data.ts instead of calling listPages() directly. |
| 8 | Direct buildSeoContext() call | error | pattern | `server/` | — | Use buildWorkspaceIntelligence({ slices: ["seoContext"] }) instead of buildSeoContext(). |
| 9 | Placeholder test assertion — expect(true).toBe(true) | error | pattern | `tests/` | — | expect(true).toBe(true) always passes and documents nothing. Replace with a real assertion that can actually fail. |
| 10 | Bare JSON.parse on DB row column | error | pattern | `server/` | — | Use parseJsonSafe(row.column, schema, fallback) or parseJsonFallback(row.column, fallback). Bare JSON.parse on DB columns crashes on malformed data. |
| 11 | replaceAllPageKeywords called outside keyword-strategy route | error | pattern | `server/` | — | replaceAllPageKeywords() is a destructive bulk operation. Only call it from server/routes/keyword-strategy.ts. For incremental updates use upsertPageKeyword(). |
| 12 | getBacklinksOverview called outside workspace-intelligence | error | pattern | `server/` | — | getBacklinksOverview() is an expensive external API call. Only call it from server/workspace-intelligence.ts where caching and rate-limiting are enforced. |
| 13 | Silent bare catch in workspace-intelligence assemblers | error | pattern | `server/workspace-intelligence.ts` | — | Bare `catch {` in workspace-intelligence.ts hides TypeError/ReferenceError as silent degradation. Use `catch (err)` and call isProgrammingError(err) for dynamic-import blocks, or log.debug at minimum. |
| 14 | useGlobalAdminEvents import restriction | error | custom | `*.ts, *.tsx` | `// global-events-ok` | Silent dead broadcast handlers: the frontend never receives the event and the UI appears stale until a manual refetch. |
| 15 | Global keydown missing isContentEditable guard | error | custom | `src/` | `// keydown-ok` | Escape/Enter/arrow keys hijack text fields, destroying the user’s typing or closing modals from the wrong event. |
| 16 | Multi-step DB writes outside db.transaction() | error | custom | `server/` | `// txn-ok` | Partial failure leaves the DB in an inconsistent state; retries then hit PRIMARY KEY violations and permanently block the operation. |
| 17 | AI call before db.prepare without transaction guard | error | custom | `server/` | `// ai-race-ok` | Two concurrent handlers both observe “no existing row” during the AI call and both INSERT, creating permanent duplicate rows on a logical natural key. |
| 18 | UPDATE/DELETE missing workspace_id scope | error | custom | `server/` | `// ws-scope-ok` | Cross-tenant read or write exposure: a forged row id or misrouted request can touch another workspace’s data if the auth layer is ever compromised. |
| 19 | getOrCreate* function returns nullable | error | custom | `server/` | `// getorcreate-nullable-ok` | Dead `if (!result)` guard branches lie to reviewers about the function’s real shape and hide downstream assumptions that would fail on a genuine null. |
| 20 | Record<string, unknown> in shared/types | error | pattern | `shared/types/` | `// record-unknown-ok` | Producer/consumer drift: field renames and semantic changes compile silently until a runtime bug surfaces in production. |
| 21 | PATCH spread without nested merge | error | pattern | `server/routes/` | `// patch-spread-ok` | Nested sub-objects (e.g. `address` inside a profile blob) are silently replaced instead of merged, clobbering fields the PATCH body didn’t mention. |
| 22 | Public-portal mutation without addActivity | error | custom | `server/routes/public-portal.ts` | `// activity-ok` | Admins lose visibility into client portal engagement — writes performed by clients leave no trace in the activity feed. |
| 23 | broadcastToWorkspace inside bridge callback | error | custom | `server/` | `// bridge-broadcast-ok` | Double-dispatched WS events: every subscriber receives the same update twice, producing UI flicker or masking genuine retries behind idempotency guards. |

---

## Warnings (advisory)

| # | Rule | Severity | Method | Scope | Escape hatch | Rationale |
|---|------|----------|--------|-------|--------------|-----------|
| 1 | Raw fetch() in components | warn | custom | `src/components/` | `// fetch-ok` | Raw fetch() bypasses typed API wrappers, error normalization, and auth headers — the #1 source of untyped response bugs in UI code. |
| 2 | Local prepared statement caching | warn | pattern | `*.ts` | — | Use createStmtCache()/stmts() for prepared statements. Local `let stmt` guards are useless. |
| 3 | Bare SUM() without COALESCE in db.prepare | warn | pattern | `server/` | — | Wrap SUM() with COALESCE: COALESCE(SUM(col), 0). SQLite SUM returns NULL (not 0) when no rows match. |
| 4 | as any on dynamic import results | warn | pattern | `server/` | `// as-any-ok` | Use `import type { T } from "./module.js"` instead of `as any`. Guessed property names are the #1 bug source. Add `// as-any-ok` comment if truly unavoidable. |
| 5 | Hardcoded dark hex in inline styles | warn | pattern | `src/components/` | — | Use CSS variables or chartColor helpers from ui/constants.ts. Hardcoded dark hex breaks light mode. |
| 6 | SVG with hardcoded dark fill/stroke | warn | pattern | `src/components/` | — | Use chartDotStroke()/chartAxisColor() from ui/constants.ts for SVG colors. Dark hex breaks light mode. |
| 7 | buildWorkspaceIntelligence() without slices (assembles all 8 slices) | warn | pattern | `server/` | `// bwi-all-ok` | Always pass { slices: [...] } to buildWorkspaceIntelligence(). Omitting it assembles all 8 slices (expensive). Add `// bwi-all-ok` if intentional. |
| 8 | formatForPrompt with inline sections literal (use buildIntelPrompt or sections: slices) | warn | pattern | `server/` | `// bip-ok` | Use buildIntelPrompt(id, slices) when only the formatted string is needed. When raw intel is also needed: const slices = [...]; formatForPrompt(intel, { sections: slices }). Add `// bip-ok` for intentional exceptions. |
| 9 | Unguarded recordAction() call | warn | pattern | `server/` | `// recordAction-ok` | recordAction() must be gated by `if (workspaceId)`. Add `// recordAction-ok` if verified safe. |
| 10 | Raw string literal in broadcastToWorkspace() event arg | warn | custom | `server/` | `// ws-event-ok` | Silent drift between broadcast emitter and frontend handler when an event string is typo’d or renamed on one side only. |
| 11 | Raw string literal in broadcast() event arg | warn | custom | `server/` | `// ws-event-ok` | Silent drift between broadcast emitter and frontend handler when an event string is typo’d or renamed on one side only. |
| 12 | Source-sniffing in tests (readFileSync on .ts/.tsx source) | warn | pattern | `tests/` | `// readFile-ok` | Test behavior via imports and mocks, not source-file string matching. Add // readFile-ok on the line if this is an intentional endpoint migration guard. |
| 13 | Vacuous .every() in tests (no length guard) | warn | pattern | `tests/` | `// every-ok` | Assert array.length > 0 before .every(). [].every(fn) always returns true. Add // every-ok if intentional. |
| 14 | Unguarded SET status = ? (state machine transition) | warn | pattern | `server/` | `// status-ok` / `-- status-ok` | State machine transitions must use validateTransition(from, to). Direct SET status = ? skips guard. Add // status-ok (JS comment) or -- status-ok (SQL comment) if this is a non-state-machine column. |
| 15 | Untyped dynamic import (missing import type) | warn | pattern | `server/` | `// dynamic-import-ok` | Add `import type { T } from "./module.js"` at file top to type dynamic import results. `as any` on dynamic imports hides wrong property names. Add // dynamic-import-ok if unavoidable. |
| 16 | Raw bulk_lookup string outside keywords type file | warn | pattern | `*.ts, *.tsx` | — | Use the 'bulk_lookup' literal only from shared/types/workspace.ts (PageKeywordMap.metricsSource). Raw string references in other files create undiscoverable magic values. |
| 17 | Raw ai_estimate string in server files | warn | pattern | `server/` | — | The 'ai_estimate' metricsSource value must only be referenced from shared/types/workspace.ts. Use the shared type, not a raw string literal. |
| 18 | Layout-driving state set in useEffect | warn | custom | `src/` | `// effect-layout-ok` | One-frame layout flash: the browser paints with stale layout state, then the effect runs and re-lays-out, producing visible jitter. |

---

## How to add a new rule

See [docs/rules/pr-check-rule-authoring.md](./pr-check-rule-authoring.md).

## How to regenerate this file

```bash
npm run rules:generate
```

CI runs the same command and fails the build if the working tree differs
from the committed file.
