# Automated Rules (generated)

> **DO NOT EDIT.** This file is regenerated from `scripts/pr-check.ts` on every PR.
> Run `npm run rules:generate` to update. CI fails if the committed file drifts
> from the generator output.

Total rules: **78** — 40 error, 38 warn.

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
| 6 | window.confirm() in client components | error | pattern | `src/components/client/` | — | window.confirm() produces a browser-native dialog anchored to the top of the viewport, which disorients users working near the bottom of long pages. ConfirmDialog renders centered with teal CTA and keyboard support. |
| 7 | z.array(z.unknown()) on server | error | pattern | `*.ts` | — | Use parseJsonSafeArray(raw, typedItemSchema, context) — z.unknown() bypasses per-item validation and requires unsafe casts. |
| 8 | Direct listPages() outside workspace-data | error | pattern | `server/` | — | Use getWorkspacePages() from workspace-data.ts instead of calling listPages() directly. |
| 9 | Direct buildSeoContext() call | error | pattern | `server/` | — | Use buildWorkspaceIntelligence({ slices: ["seoContext"] }) instead of buildSeoContext(). |
| 10 | Placeholder test assertion — expect(true).toBe(true) | error | pattern | `tests/` | — | expect(true).toBe(true) always passes and documents nothing. Replace with a real assertion that can actually fail. |
| 11 | Bare JSON.parse on DB row column | error | pattern | `server/` | — | Use parseJsonSafe(row.column, schema, fallback) or parseJsonFallback(row.column, fallback). Bare JSON.parse on DB columns crashes on malformed data. |
| 12 | replaceAllPageKeywords called outside keyword-strategy route | error | pattern | `server/` | — | replaceAllPageKeywords() is a destructive bulk operation. Only call it from server/routes/keyword-strategy.ts. For incremental updates use upsertPageKeyword(). |
| 13 | getBacklinksOverview called outside workspace-intelligence | error | pattern | `server/` | — | getBacklinksOverview() is an expensive external API call. Only call it from server/workspace-intelligence.ts where caching and rate-limiting are enforced. |
| 14 | Silent bare catch in server files | error | pattern | `server/` | — | Bare `catch {` hides TypeError/ReferenceError as silent degradation. Use `catch (err)` and call isProgrammingError(err), or log.debug for expected failures (JSON parse, migration). Annotate intentionally-silent catches with `// catch-ok`. |
| 15 | useGlobalAdminEvents import restriction | error | custom | `*.ts, *.tsx` | `// global-events-ok` | Silent dead broadcast handlers: the frontend never receives the event and the UI appears stale until a manual refetch. |
| 16 | Global keydown missing isContentEditable guard | error | custom | `src/` | `// keydown-ok` | Escape/Enter/arrow keys hijack text fields, destroying the user’s typing or closing modals from the wrong event. |
| 17 | Multi-step DB writes outside db.transaction() | error | custom | `server/` | `// txn-ok` | Partial failure leaves the DB in an inconsistent state; retries then hit PRIMARY KEY violations and permanently block the operation. |
| 18 | AI call before db.prepare without transaction guard | error | custom | `server/` | `// ai-race-ok` | Two concurrent handlers both observe “no existing row” during the AI call and both INSERT, creating permanent duplicate rows on a logical natural key. |
| 19 | UPDATE/DELETE missing workspace_id scope | error | custom | `server/` | `// ws-scope-ok` | Cross-tenant read or write exposure: a forged row id or misrouted request can touch another workspace’s data if the auth layer is ever compromised. |
| 20 | getOrCreate* function returns nullable | error | custom | `server/` | `// getorcreate-nullable-ok` | Dead `if (!result)` guard branches lie to reviewers about the function’s real shape and hide downstream assumptions that would fail on a genuine null. |
| 21 | Record<string, unknown> in shared/types | error | pattern | `shared/types/` | `// record-unknown-ok` | Producer/consumer drift: field renames and semantic changes compile silently until a runtime bug surfaces in production. |
| 22 | PATCH spread without nested merge | error | pattern | `server/routes/` | `// patch-spread-ok` | Nested sub-objects (e.g. `address` inside a profile blob) are silently replaced instead of merged, clobbering fields the PATCH body didn’t mention. |
| 23 | Public-portal mutation without addActivity | error | custom | `server/routes/public-portal.ts` | `// activity-ok` | Admins lose visibility into client portal engagement — writes performed by clients leave no trace in the activity feed. |
| 24 | broadcastToWorkspace inside bridge callback | error | custom | `server/` | `// bridge-broadcast-ok` | Double-dispatched WS events: every subscriber receives the same update twice, producing UI flicker or masking genuine retries behind idempotency guards. |
| 25 | requireAuth in brand-engine route files (should be requireWorkspaceAccess) | error | custom | `server/routes/` | `// auth-ok` | requireAuth on brand-engine routes 401s every admin call because the admin panel authenticates via HMAC, not JWT. |
| 26 | useEffect external-sync dirty guard against the live prop | error | custom | `src/` | `// sync-ok` | Comparing a dirty flag against the live prop (not a ref) prevents external-sync useEffects from ever firing after an update arrives — classic stale-state bug. |
| 27 | Constants in sync (STUDIO_NAME, STUDIO_URL) | error | custom | `server/constants.ts + src/constants.ts` | — | STUDIO_NAME/STUDIO_URL drift silently desynchronizes the studio branding between the admin UI (src/) and server-generated content like emails and AI prompts (server/). |
| 28 | seo-context.ts import restriction (deprecated module) | error | custom | `server/` | `// seo-context-ok` | seo-context.ts is being retired in favor of the unified workspace intelligence system. New callers must use the intelligence assembler. |
| 29 | requireAuth usage outside allowed route files | error | custom | `server/` | `// auth-ok` | requireAuth on a non-JWT route silently rejects all admin-panel requests because the admin panel authenticates via HMAC token, not JWT. |
| 30 | Duplicate globally-applied rate limiter in route file | error | custom | `server/routes/` | `// limiter-ok` | Double-applied rate limiters share the same in-memory bucket, so each request increments the counter twice — a 10 req/min limit silently becomes 5 req/min. |
| 31 | Port collision in integration tests | error | custom | `tests/` | `// port-ok` | Duplicate test ports cause flaky CI: the second test file to bind gets EADDRINUSE, producing intermittent failures that are hard to diagnose. |
| 32 | Inline React Query string key (use queryKeys.*) | error | custom | `src/` | `// querykey-ok` | Inline query key literals drift from the centralized factory, causing stale-cache bugs where invalidateQueries misses entries because the key arrays don't match. |
| 33 | useGlobalAdminEvents called with workspace-scoped event name | error | custom | `src/` | `// global-events-ok` | Silent dead broadcast handlers: useGlobalAdminEvents never subscribes to a workspace room, so workspace-scoped events (WS_EVENTS.*) are silently dropped by the server's broadcastToWorkspace filter. The UI appears stale with no error message. |
| 34 | Discarded updatePageSeo return value | error | pattern | `server/` | `// seo-ok` | updatePageSeo() returns rather than throws on Webflow API errors. Discarding the return value silently treats failures as success, causing incorrect "applied" counts and phantom successful operations. PR #1 Platform Health Sprint fixed 4 such sites; this rule prevents recurrence. |
| 35 | Re-upsert without cloneInsightParams | error | custom | `server/` | — | upsertInsight defaults omitted optional fields to null. When re-upserting from an existing AnalyticsInsight record, manually copying fields one-by-one silently drops any field the author does not think to include. cloneInsightParams maps all fields in one place. |
| 36 | resolvePagePath(...) with undefined fallback is dead code — use tryResolvePagePath | error | custom | `*.ts, *.tsx` | `// slug-path-ok` | The dead-code pattern silently neutralizes downstream guards like `if (basePath)` that are meant to skip fetch/GSC-match for path-less pages. |
| 37 | Manual pageMap pairing outside shared helpers — use findPageMapEntry(ForPage) or usePageJoin | error | custom | `src/` | — | Three components independently reimplemented pageMap.find with divergent semantics (SeoEditor, PageIntelligence, ApprovalsTab). The shared helpers in pathUtils.ts and the usePageJoin hook normalize all matching. Direct .find() silently breaks case variants and legacy paths. |
| 38 | useWorkspaceEvents handler for centralized event | error | custom | `src/` | `// ws-invalidation-ok` | Duplicated useWorkspaceEvents subscriptions diverge over time — one side gets updated, the other silently misses cache keys — producing stale UI bugs that are hard to reproduce because they depend on event ordering. |
| 39 | roadmap.json item ID uniqueness | error | custom | `data/roadmap.json` | — | Cross-sprint duplicate IDs caused PR #258 round-4: clicking expand on one row toggled both, and the server PATCH updated whichever sprint came first. |
| 40 | radius-signature-lg used outside SectionCard | error | pattern | `*.tsx, *.css` | — | The asymmetric corner is a SectionCard-only brand signature. Other components adopting it would dilute the design intent. |

---

## Warnings (advisory)

| # | Rule | Severity | Method | Scope | Escape hatch | Rationale |
|---|------|----------|--------|-------|--------------|-----------|
| 1 | new Map from .toLowerCase() key without uniqueness proof | warn | pattern | `server/` | `// map-dup-ok` | Silent-overwrite in Map construction from tuples — TypeScript cannot see the key collision, and the bug only manifests for a subset of input distributions. |
| 2 | Raw fetch() in components | warn | custom | `src/components/` | `// fetch-ok` | Raw fetch() bypasses typed API wrappers, error normalization, and auth headers — the #1 source of untyped response bugs in UI code. |
| 3 | Local prepared statement caching | warn | pattern | `*.ts` | — | Use createStmtCache()/stmts() for prepared statements. Local `let stmt` guards are useless. |
| 4 | Bare SUM() without COALESCE in db.prepare | warn | pattern | `server/` | — | Wrap SUM() with COALESCE: COALESCE(SUM(col), 0). SQLite SUM returns NULL (not 0) when no rows match. |
| 5 | as any on dynamic import results | warn | pattern | `server/` | `// as-any-ok` | Use `import type { T } from "./module.js"` instead of `as any`. Guessed property names are the #1 bug source. Add `// as-any-ok` comment if truly unavoidable. |
| 6 | Hardcoded dark hex in inline styles | warn | pattern | `src/components/` | — | Use CSS variables or chartColor helpers from ui/constants.ts. Hardcoded dark hex breaks light mode. |
| 7 | SVG with hardcoded dark fill/stroke | warn | pattern | `src/components/` | — | Use chartDotStroke()/chartAxisColor() from ui/constants.ts for SVG colors. Dark hex breaks light mode. |
| 8 | buildWorkspaceIntelligence() without slices (assembles all 8 slices) | warn | pattern | `server/` | `// bwi-all-ok` | Always pass { slices: [...] } to buildWorkspaceIntelligence(). Omitting it assembles all 8 slices (expensive). Add `// bwi-all-ok` if intentional. |
| 9 | formatForPrompt with inline sections literal (use buildIntelPrompt or sections: slices) | warn | pattern | `server/` | `// bip-ok` | Use buildIntelPrompt(id, slices) when only the formatted string is needed. When raw intel is also needed: const slices = [...]; formatForPrompt(intel, { sections: slices }). Add `// bip-ok` for intentional exceptions. |
| 10 | Unguarded recordAction() call | warn | pattern | `server/` | `// recordAction-ok` | recordAction() must be gated by `if (workspaceId)`. Add `// recordAction-ok` if verified safe. |
| 11 | Raw string literal in broadcastToWorkspace() event arg | warn | custom | `server/` | `// ws-event-ok` | Silent drift between broadcast emitter and frontend handler when an event string is typo’d or renamed on one side only. |
| 12 | Raw string literal in broadcast() event arg | warn | custom | `server/` | `// ws-event-ok` | Silent drift between broadcast emitter and frontend handler when an event string is typo’d or renamed on one side only. |
| 13 | Source-sniffing in tests (readFileSync on .ts/.tsx source) | warn | pattern | `tests/` | `// readFile-ok` | Test behavior via imports and mocks, not source-file string matching. Add // readFile-ok on the line if this is an intentional endpoint migration guard. |
| 14 | Vacuous .every() in tests (no length guard) | warn | pattern | `tests/` | `// every-ok` | Assert array.length > 0 before .every(). [].every(fn) always returns true. Add // every-ok if intentional. |
| 15 | Unguarded SET status = ? (state machine transition) | warn | pattern | `server/` | `// status-ok` / `-- status-ok` | State machine transitions must use validateTransition(from, to). Direct SET status = ? skips guard. Add // status-ok (JS comment) or -- status-ok (SQL comment) if this is a non-state-machine column. |
| 16 | Untyped dynamic import (missing import type) | warn | pattern | `server/` | `// dynamic-import-ok` | Add `import type { T } from "./module.js"` at file top to type dynamic import results. `as any` on dynamic imports hides wrong property names. Add // dynamic-import-ok if unavoidable. |
| 17 | Raw bulk_lookup string outside keywords type file | warn | pattern | `*.ts, *.tsx` | — | Use the 'bulk_lookup' literal only from shared/types/workspace.ts (PageKeywordMap.metricsSource). Raw string references in other files create undiscoverable magic values. |
| 18 | Raw ai_estimate string in server files | warn | pattern | `server/` | — | The 'ai_estimate' metricsSource value must only be referenced from shared/types/workspace.ts. Use the shared type, not a raw string literal. |
| 19 | isProgrammingError near new URL() or fetch() | warn | custom | `server/` | `// url-fetch-ok` | False-positive log.warn noise: network failures and user-supplied malformed URLs trigger TypeError alerts that obscure real code bugs. |
| 20 | Layout-driving state set in useEffect | warn | custom | `src/` | `// effect-layout-ok` | One-frame layout flash: the browser paints with stale layout state, then the effect runs and re-lays-out, producing visible jitter. |
| 21 | Assembled-but-never-rendered slice fields | warn | custom | `shared/types/intelligence.ts + server/workspace-intelligence.ts` | — | A slice field present in the type but absent from the formatter is assembled but never reaches the AI prompt — silent data loss. |
| 22 | callCreativeAI without json: flag in files that use parseJsonFallback | warn | custom | `server/` | — | callCreativeAI without an explicit json: flag silently drifts between models that return valid JSON and ones that wrap it in prose. |
| 23 | Admin mutation on client_users missing expectedWorkspaceId param | warn | custom | `server/client-users.ts` | `// ws-authz-ok` | Without an in-function cross-workspace guard on admin mutations, an admin auth'd for workspace A can mutate a user in workspace B by passing the foreign UUID through a workspace-A URL. |
| 24 | Inline voice-profile authority check (use isVoiceProfileAuthoritative helper) | warn | pattern | `server/seo-context.ts` | `// voice-authority-ok` | Inline authority checks drift: the shadow-mode copy missed the `hasExplicitConfig` gate, silently dropping the legacy brand voice for samples-only draft profiles (PR #168 bug). |
| 25 | Bare brand-engine read in seo-context.ts (use safeBrandEngineRead) | warn | custom | `server/seo-context.ts` | `// safe-read-ok` | A missing brand-engine table in a non-production env crashes the entire buildSeoContext call tree, and an unnarrowed catch would hide real programming bugs as silent degradation. |
| 26 | Test body has no assertion or explicit failure throw | warn | custom | `*.test.ts, *.test.tsx` | `// no-assertion-ok` | A vitest/jest test body with no assertion passes unconditionally — a broken implementation will not trip the suite. 2026-04-11 audit found 3 such silent-pass bodies in the stripe webhook suite claiming regression coverage they never had. |
| 27 | TabBar component without ?tab= deep-link support | warn | custom | `src/components/` | `tab-deeplink-ok` | A ?tab= URL that the target component ignores is a silent navigation bug — the user sees the default tab instead of the requested one. |
| 28 | Missing broadcastToWorkspace after DB write in route handler | warn | custom | `server/routes/` | `// broadcast-ok` | Route handlers that write to the DB without broadcasting leave connected clients with stale data until they manually refresh. |
| 29 | Admin route mutation without addActivity | warn | custom | `server/routes/*.ts (excluding public-* and infrastructure routes)` | `// activity-ok` | Significant admin operations that skip addActivity() leave gaps in the workspace activity feed, making it impossible for team members to audit what changed and when. |
| 30 | addActivity type not in CLIENT_VISIBLE_TYPES (public route) | warn | custom | `server/routes/` | `client-visibility-ok` | Public-portal mutations that log activity with a type absent from CLIENT_VISIBLE_TYPES create invisible entries — the activity is recorded but never shown to client-portal users. This is sometimes intentional (admin-only bookkeeping) but often an oversight when adding new activity types. |
| 31 | Raw provider date passed to new Date() | warn | pattern | `server/` | `// provider-date-ok` | Prevents Invalid Date regressions after PR #218 A4 finding: SEMRush emits Unix epoch strings that new Date() cannot parse. |
| 32 | Competitor keyword push missing serpFeatures | warn | custom | `server/` | `// compkw-serp-ok` | Prevents regression of PR #218 A3 finding: DomainKeyword.serpFeatures was silently dropped in the inline mapping. |
| 33 | Bare slug used in pagePath construction — use resolvePagePath(page) | warn | custom | `*.ts, *.tsx` | `// slug-path-ok` | Webflow nested pages (`/services/seo`) have slug=`seo` — using `/${page.slug}` directly produces wrong short URLs that break GSC matching and pagePath lookups. |
| 34 | Legacy surface token in new code | warn | pattern | `*.tsx, *.css` | — | Prevents new code from using deprecated token names that bypass the 3-tier surface system. |
| 35 | Hand-rolled card div (use SectionCard) | warn | pattern | `*.tsx` | — | Prevents hand-rolled card divs that bypass the SectionCard primitive and the --surface-N token system. |
| 36 | Page component missing PageHeader | warn | custom | `` | — | Enforces consistent page-level header structure across all navigable views. |
| 37 | Hardcoded card radius outside ui primitives | warn | pattern | `*.tsx` | — | Prevents hardcoded Tailwind radius classes that bypass the --radius-* token system. |
| 38 | Non-standard transition duration | warn | custom | `*.tsx, *.css` | — | Enforces the three-speed motion system: 120ms (micro), 180ms (standard), 400ms (entrance). |

---

## How to add a new rule

See [docs/rules/pr-check-rule-authoring.md](./pr-check-rule-authoring.md).

## How to regenerate this file

```bash
npm run rules:generate
```

CI runs the same command and fails the build if the working tree differs
from the committed file.
