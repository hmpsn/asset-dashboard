# hmpsn.studio — Claude Code Rules

> This file is loaded at the start of every Claude Code session. Follow it before making changes.

---

## Project Overview

**hmpsn.studio** is an SEO/web analytics agency platform. React 19 + Vite 8 + TailwindCSS 4 + React Router DOM 7 (frontend), Express + TypeScript (backend), SQLite via better-sqlite3 (storage).

Integrations: Webflow, Google Search Console, GA4, SEMRush, Stripe, OpenAI (GPT-4.1), Anthropic (Claude for creative prose).

- **Routing** — React Router DOM 7. `src/routes.ts` defines `Page` + `ClientTab` types, `adminPath()` + `clientPath()` helpers. Admin: `/ws/:workspaceId/:tab?`, Client: `/client/:workspaceId/:tab?`.
- **API Client** — Typed fetch wrappers in `src/api/` (7 modules). No raw `fetch()` in components.
- **Shared Types** — `shared/types/` (11 modules) shared between client and server.
- **Storage** — SQLite (WAL mode, foreign keys ON) at `DATA_BASE/dashboard.db`. 21+ migrations in `server/db/migrations/`.
- **AI** — OpenAI via `server/openai-helpers.ts` (`callOpenAI`), Anthropic via `server/anthropic-helpers.ts` (`callAnthropic`) for creative prose.
- **Auth** — Dual: internal JWT (7-day, admin) + client JWT (24h, per-workspace). Turnstile CAPTCHA optional.
- **Payments** — Stripe Checkout (not Payment Intents). Config encrypted on disk (AES-256-GCM).
- **Validation** — Zod v3 via `server/middleware/validate.ts`. Import as `import { validate, z } from '../middleware/validate.js'`.
- **Data Fetching** — React Query (`@tanstack/react-query`) for ALL frontend data. 50+ hooks in `src/hooks/admin/` and `src/hooks/client/`.
- **Logging** — Pino structured JSON (`server/logger.ts`). `createLogger(module)` for child loggers.
- **Error Monitoring** — Sentry (server + frontend). Auto-tags `workspaceId`.
- **Monetization** — 3 tiers (Free/Growth/Premium), per-item content purchases, 14-day Growth trial, UX soft-gating via `<TierGate>`.

---

## Session Protocol

### Before writing code

1. **Check `data/roadmap.json`** — scan for `"status": "pending"` in current sprint. If user hasn't specified a task, suggest the next pending item.
2. **Check `FEATURE_AUDIT.md`** — understand what exists. Don't build something that already exists.
3. **If UI work** — read `BRAND_DESIGN_LANGUAGE.md` before writing any JSX.
4. **Cross-reference before building** — search the codebase to verify a component/endpoint/feature doesn't already exist.
5. **For multi-phase or cross-system features** — before writing any implementation code, generate feature-specific guardrails: (a) CLAUDE.md rules for reusable patterns this feature introduces, (b) a `.windsurf/rules/<feature>.md` reference doc for feature-specific contracts, and (c) per-phase acceptance checklists embedded in the implementation plan. Guardrails written after bugs are found cost 3× more than guardrails written before the first commit.

### After completing a task

Every completed task must include:

1. **`FEATURE_AUDIT.md`** — add new entries or update existing ones for any feature work.
2. **`data/roadmap.json`** — mark completed items `"pending"` → `"done"`, add `"notes"`. Run `npx tsx scripts/sort-roadmap.ts`.
3. **`BRAND_DESIGN_LANGUAGE.md`** — update if any UI colors/components/patterns changed.
4. **Build verify** — `npx tsc --noEmit --skipLibCheck && npx vite build`
5. **Summarize** — what was done, what docs updated, what's next.
6. **`data/features.json`** — if the completed feature is client-impactful or sales-relevant, add/update its entry. Not every feature belongs here — only ones you'd mention on a sales call.

### Decision framework

| Situation | Action |
|-----------|--------|
| Clear, specific task | Proceed. Implement fully. |
| Ambiguous but low-risk (styling, docs) | Proceed with best judgment, explain. |
| Multiple directions (architecture, new feature) | Present 2-3 options with tradeoffs. |
| Conflicts with existing patterns | Flag conflict, recommend pattern-consistent approach. |
| Unsure if something exists | Search first, then proceed. |
| Pre-existing lint errors | Check Known Issues below. If listed, ignore. If new, fix only if caused by your changes. |
| Bug found during review (any origin) | Fix it in the current PR. Never defer a fixable bug — whether it's from your changes, pre-existing, or out-of-scope. Compounding unfixed bugs is worse than a slightly larger diff. If the fix is genuinely risky or large, flag it explicitly and offer to fix it. |

---

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server (frontend) |
| `npm run dev:server` | Express server (backend) |
| `npm run dev:all` | Both concurrently |
| `npx tsc --noEmit --skipLibCheck` | Type-check |
| `npx vite build` | Production build |
| `npx vitest run` | Unit + integration + component tests |
| `npx playwright test` | E2E tests (requires server running) |
| `npx tsx scripts/sort-roadmap.ts` | Auto-archive completed sprints |
| `npx tsx scripts/pr-check.ts` | Automated pre-PR checklist (color violations, JSON.parse, hard-coded names) |

**Always verify after changes:** `npx tsc --noEmit --skipLibCheck && npx vite build`

---

## Design System — The Three Laws of Color

1. **Teal for actions** — every CTA, toggle, active state, tier badge, interactive highlight
2. **Blue for data** — clicks, sessions, impressions, info badges, progress bars (read-only, never actionable)
3. **Purple for admin AI only** — `AdminChat.tsx` and `SeoAudit.tsx` "Flag for Client". Never in client-facing views.

### Color quick reference

```
Button / CTA / toggle?      → Teal (from-teal-600 to-emerald-600)
Data metric?                 → Blue (text-blue-400, bg-blue-500/10)
Admin AI feature?            → Purple (purple-400/purple-600)
Score (health/perf)?         → scoreColor() from ui/constants.ts
Status badge?                → green=success, amber=warning, red=error, orange=changes-requested, blue=info, teal=client-requested
Tier badge (client)?         → Teal (all tiers) or zinc (free)
```

### Forbidden

- **Never** use `violet`, `indigo`, or new hue families without explicit approval
- **Never** hand-roll card markup — use `<SectionCard>`
- **Never** hand-roll stat displays — use `<StatCard>` or `<CompactStatBar>`
- **Never** hard-code score colors — use `scoreColor()` / `scoreColorClass()`
- **Never** use purple in any client-facing component

### UI Primitives — always check before hand-rolling

`SectionCard`, `StatCard`, `CompactStatBar`, `PageHeader`, `MetricRing`, `MetricRingSvg`, `Badge`, `TabBar`, `DateRangeSelector`, `DataList`, `EmptyState`, `TierGate`, `TierBadge`, `AIContextIndicator`, `StatusBadge`, `Skeleton` — all from `src/components/ui/`.

---

## Data Flow Rules (mandatory)

1. **Broadcast after mutation** — every POST/PUT/PATCH/DELETE that changes workspace data must call `broadcastToWorkspace()` with an appropriate event.
2. **Frontend must handle broadcasts** — every `useWebSocket` handler must invalidate relevant React Query caches.
3. **Delete operations** — always read data before delete (for activity log context).
4. **Activity logging** — all significant operations must call `addActivity()`.
5. **STUDIO_NAME constant** — use the constant from `server/constants.ts`, never hard-code "hmpsn.studio".
6. **Typed data contracts at boundaries** — when data flows between layers (backend → API → frontend, or between modules via JSON columns), define typed interfaces in `shared/types/` BEFORE implementing. Never use `Record<string, unknown>` for new data shapes. Specifically:
   - New DB JSON columns → define a typed interface, not `Record<string, unknown>`
   - New insight types → add to `InsightDataMap` in `shared/types/analytics.ts`
   - New filter/category values → use shared const objects (like `INSIGHT_FILTER_KEYS`), not string literals
   - Percentage vs decimal fields → add JSDoc: `/** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */`
   - Shared string enums between producer/consumer → single const object imported by both sides
7. **Wire new data sources into the intelligence engine** — any new table or store that captures workspace activity must be surfaced in `server/workspace-intelligence.ts`. Add a field to the appropriate slice interface in `shared/types/intelligence.ts` AND read from the new store inside the corresponding `assemble*` function. The AI context and AdminChat are blind to data that isn't wired into a slice. The relevant slice for client-facing signals and engagement data is `ClientSignalsSlice`.

## UI/UX Rules (mandatory)

1. **Always use shared primitives** from `src/components/ui/` before creating new components.
2. **Loading states** — use contextual messages ("Analyzing site health..." not "Loading..."). Use `<Skeleton>` for layout-preserving shimmer.
3. **Empty states** — always action-oriented with a CTA using `<EmptyState>`.
4. **Error handling** — wrap major sections in `<ErrorBoundary>`. Show empathetic messages with retry.
5. **Mobile-first** — responsive design, test at mobile breakpoints.
6. **Color coding** — follow the Three Laws strictly.
7. **Accessibility** — proper ARIA labels, keyboard navigation, focus management.
8. **Progressive disclosure** — show summary first, details on demand.
9. **Extract shared interaction patterns** — when 2+ components implement the same user interaction (toggle logic, filter state, sort behavior), extract to a shared hook or utility. Don't let subagents independently re-implement the same logic — it drifts. Example: `useToggleSet(defaults, { min, max })` instead of 3 inline `useState<Set>` + toggle handlers.

---

## Multi-Agent Coordination (mandatory)

> Full rules: `.windsurf/rules/multi-agent-coordination.md`

When dispatching parallel subagents or working on multi-phase features:

1. **Pre-commit shared contracts** — types, function signatures, barrel exports must be committed before any agent starts. Agents read from committed code, never uncommitted state.
2. **Exclusive file ownership** — every file touched during parallel work has exactly one owner. No file may be modified by two agents concurrently. Shared files (app.ts, seo-context.ts, BrandHub.tsx, api client files) are sequential tasks.
3. **Diff review after each batch** — after all parallel agents complete, review diffs, grep for duplicate imports, run tsc + full test suite before dispatching the next batch.
4. **Explicit task dependency graphs** — every multi-task plan must include a dependency section. "Obviously sequential" is not acceptable — dispatchers don't infer dependencies.
5. **Spec amendment → plan sync** — when a spec is amended, every plan referencing it must be updated in the same commit. Addendums without plan updates create invisible gaps.
6. **Cross-phase contracts** — multi-phase features require a companion guardrails doc listing what each phase exports for downstream consumption (tables, functions, types, components).
7. **File ownership in dispatch prompts** — when dispatching implementer subagents, include explicit "Files you OWN" and "Files you must NOT touch" lists.

---

## Auth Conventions

This project uses **two separate auth systems** that must never be mixed up:

| System | Used for | Token location | Server check |
|--------|----------|---------------|-------------|
| HMAC password auth | Admin panel login | `localStorage` → `x-auth-token` header | `APP_PASSWORD` gate in `app.ts` |
| JWT user auth | Multi-user accounts (`users.ts`) | `Authorization: Bearer` or `token` cookie | `requireAuth` middleware |

**Rule: Never add `requireAuth` to admin API routes.** The admin panel authenticates via HMAC token (`x-auth-token`), which the global `APP_PASSWORD` gate in `app.ts` already validates for all `/api/` requests. Adding `requireAuth` to a route the admin frontend calls will silently return 401 — the token won't be recognized because `requireAuth` only accepts JWTs.

**`requireAuth` is only correct in two contexts:**
1. `server/routes/users.ts` — JWT-based multi-user account management
2. `server/routes/auth.ts` — `/api/auth/me` JWT session check

**`requireWorkspaceAccess` is safe for all routes** — it explicitly passes through when no JWT user is present (HMAC auth users are covered by the global gate).

---

## Code Conventions

- **TypeScript strict** — no `any` unless unavoidable
- **API error shape**: `{ error: string }` consistently
- **User-facing strings**: follow `.windsurf/workflows/ui-vocabulary.md` canonical labels
- **Route validation**: Zod schemas via `validate()` middleware, not hand-written checks
- **Frontend data**: all hooks use `useQuery`/`useMutation`. No hand-rolled `useState`+`useEffect`+fetch patterns. Query keys: `admin-*` / `client-*` prefixes.
- **Imports**: always at top of file, grouped with existing imports. Never add imports mid-file next to the code that uses them — this breaks the oxc parser used by vitest/vite and violates code conventions. When adding code to an existing file, check existing imports first (`grep -n '^import' <file>`).
- **DB patterns**: lazy prepared statements via `createStmtCache()`/`stmts()`, JSON columns as TEXT parsed at read boundary, `rowToX()` mappers, three-state booleans (0/1/NULL). Use `parseJsonSafe`/`parseJsonFallback` from `server/db/json-validation.ts` — never bare `JSON.parse` on DB columns. Never use local `let` variables inside functions for prepared statement caching — the `if (!stmt)` guard is useless on a local variable that's re-initialized every call.
- **Multi-step DB mutations must use `db.transaction()`** — any function that runs 2+ sequential `db.prepare().run()` calls where a partial failure would leave inconsistent state (e.g. INSERT into table A succeeded but DELETE from table B failed). Without a transaction, the next run can hit PRIMARY KEY violations on the already-inserted rows, permanently blocking the operation. Use `const doWork = db.transaction(() => { ... }); doWork();`. See `server/outcome-tracking.ts` `archiveOldActions` as the canonical example.
- **`SUM()` columns must use `COALESCE`** — SQLite `SUM()` returns `NULL` (not `0`) when no rows match. Always wrap: `COALESCE(SUM(col), 0)` in any query whose result flows to the frontend or is used in arithmetic. A `NULL` total silently breaks counters displayed to users.
- **Array validation from DB** — when Zod-validating a JSON array column, validate items individually (filter out bad items) rather than validating the whole array (which drops ALL items if any one fails). Use `parseJsonSafeArray(raw, itemSchema, context)` from `server/db/json-validation.ts`. See `server/approvals.ts` `rowToBatch` for the pattern.
- **Zod schema field names** — when writing Zod schemas for existing TypeScript interfaces, always cross-reference field names against the source interface in `shared/types/`. Zod won't flag name mismatches at compile time — a required field with a wrong name silently fails `safeParse` at runtime, returning the fallback instead of real data.
- **Schema vs stored shape** — DB column schemas must reflect what is actually stored, not the in-memory assembled object. If a write path deliberately omits a field (e.g. storing it in a separate table), that field must be `.optional()` in the Zod schema. A required field absent from the stored blob causes every `parseJsonSafe` call to silently return the empty fallback, destroying all real data. See `keywordStrategySchema.pageMap` as the canonical example.
- **Large edits**: break into multiple smaller edits if > 300 lines
- **Route removal checklist** — when removing or renaming a `Page` type value, update ALL of these in the same commit:
  1. `src/routes.ts` — remove from `Page` union type
  2. `src/App.tsx` — remove `renderContent()` case
  3. `src/components/layout/Sidebar.tsx` — remove sidebar entry
  4. `src/components/layout/Breadcrumbs.tsx` — remove from `TAB_LABELS`
  5. `src/components/CommandPalette.tsx` — remove from `NAV_ITEMS`
  6. Grep for `adminPath(*, 'old-route')` — update any navigation targets
  7. Tests referencing the old route value
- **Phase-per-PR** — multi-phase features ship as one PR per phase. Never open phase N+1 until phase N is merged and CI is green on `staging`. Use `<FeatureFlag flag="...">` to dark-launch incomplete phases so production never serves broken UI. Add the flag to `shared/types/feature-flags.ts` before the first commit of any new multi-phase feature.
- **Staging before main** — all PRs merge into `staging` first. After verifying on the staging deploy, merge `staging` → `main` to release to production. Never merge an unverified PR directly to `main`.
- **String literal renames** — when renaming a discriminator value used across the codebase (insight type, status enum, filter key), grep the entire repo for the old literal and update ALL references in one commit. Never split a rename across multiple tasks or PRs.
- **Test assertions on collections** — never assert `.every()` or `.some()` on a potentially empty array without first asserting `length > 0`. `[].every(fn)` returns `true` vacuously, hiding real failures. Pattern: `expect(arr.length).toBeGreaterThan(0); expect(arr.every(fn)).toBe(true);`
- **New insight type registration** — adding a value to `InsightType` requires all four of these in the same commit: (1) `InsightType` union in `shared/types/analytics.ts`, (2) typed `XData` interface + `InsightDataMap` entry — never `Record<string,unknown>`, (3) Zod schema in `server/schemas/`, (4) frontend renderer case. Missing any one fails silently. See `.windsurf/rules/analytics-insights.md`.
- **DB column + mapper lockstep** — adding columns to any table requires migration SQL, row interface, `rowToX()` mapper, write path (`upsertX()`), AND the public endpoint serialization list in `public-portal.ts` if the field is client-facing, all in the same commit. TypeScript will not catch a mapper that silently ignores a new column, and the public endpoint's explicit field list will silently omit it.
- **Integration tests must cover the actual read path** — when a feature gates client-facing behavior on a field from `GET /api/public/workspace/:id`, the integration test must exercise that endpoint, not the admin GET. A test that only verifies the admin route gives false confidence; a regression in the public serialization goes undetected.
- **Enrichment field fallbacks** — optional fields computed at insight-store time must have explicit fallbacks. `pageTitle` must always resolve to something (cleaned slug if all else fails) — never render a raw URL. Enrichment failure must degrade gracefully, not block insight storage.
- **Feedback loop completeness** — every cross-system write (e.g. insights → strategy, insights → pipeline) requires both halves: server `broadcastToWorkspace()` AND frontend `useWebSocket` handler that invalidates the correct React Query key. Neither half alone is sufficient.
- **Bridge authoring rules** — all bridges must follow these patterns. Violations produce recurring bugs:
  1. **Stale-cleanup immunity**: pass `bridgeSource: '<bridge_flag>'` to `upsertInsight()` when creating bridge insights. When re-upserting an existing insight (e.g., score adjustments), pass `bridgeSource: insight.bridgeSource` to preserve the original value — omitting it defaults to `null` and strips protection. Never call `resolveInsight('in_progress')` as a cleanup-protection hack — it overwrites admin resolutions.
  2. **Score adjustments**: use `applyScoreAdjustment()` from `server/insight-score-adjustments.ts`. Never store independent `_*BaseScore` fields — they don't compose across bridges.
  3. **Broadcast**: return `{ modified: N }` from bridge callbacks. Never manually import/call `broadcastToWorkspace` inside a bridge — `executeBridge` handles it automatically when `modified > 0`.
  4. **Resolution respect**: never call `resolveInsight()` inside a bridge callback unless the bridge's explicit purpose is resolution management.
- **Client vs admin insight framing** — client-facing insight components must use narrative, outcome-oriented language. No purple. No admin jargon. Premium features wrapped in `<TierGate>`. Verify with `grep -r "purple-" src/components/client/` before marking Phase 3 done.
- **Rate display: numerator and denominator must share a source** — if a component shows both a computed rate (win rate, conversion rate, etc.) and a "total" count, the displayed count must be the exact denominator used to compute the rate. Never mix a DB-aggregated count with a locally-filtered count. A mismatch causes users to infer the wrong raw counts from the displayed percentage.
- **Guard `recordAction()` with a valid `workspaceId`** — never fall back to a non-workspace ID (Webflow siteId, sourceId, etc.) as the FK value. Always gate: `if (workspaceId) { recordAction({ workspaceId, ... }) }`. A Webflow siteId passed as `workspaceId` fails the FK constraint and silently kills outcome tracking for that call.
- **Never use `as any` on dynamic import results** — the `(x: any)` or `as any` cast on a dynamically imported module's return value suppresses TypeScript and lets wrong property/function names compile silently. Every field resolves to `undefined` and falls through to `?? ''` / `?? 0` defaults, producing all-zero/empty data. Instead: (1) add `import type { T } from './module.js'` at the top of the file, (2) type the variable from the dynamic import, (3) let TypeScript verify every field access. If the type isn't exported, export it. If a circular dependency prevents a value import, `import type` is always safe (erased at compile time). The `// as-any-ok` escape hatch is for genuinely untyped third-party code only.
- **Read-before-write for cross-module consumption** — before writing code that consumes another module's exports (assemblers, bridges, mappers), read the source module's actual interface/type definitions and exported function signatures. Never guess property names, function names, or return shapes from memory. The #1 bug pattern in this codebase is guessed field names (`pages` vs `decayingPages`, `createdAt` vs `changedAt`, `organicValue` vs `organicTrafficValue`) that compile because of `as any` casts but produce silent data loss at runtime.
- **Zod clearable-field pattern** — optional validated fields that back user-editable inputs (email, URL, phone with pattern) must use `.or(z.literal(''))` so clearing the field doesn't return a 400. `.optional()` only handles the key being absent, not an empty string from a cleared input.
- **PATCH depth-aware merge on nested JSON** — PATCH endpoints on JSON columns with nested sub-objects (e.g. `address` inside `businessProfile`) must deep-merge known nested keys, not just top-level spread. `{ ...existing, ...req.body }` silently replaces nested objects. Pattern: `...(req.body.address !== undefined ? { address: { ...(existing.address ?? {}), ...req.body.address } } : {})`.
- **Feature toggle scope minimality** — feature toggles must gate the specific sub-feature, never a composite parent component. Pass the flag as a prop and gate inside the component at the narrowest point. Wrapping a composite component (e.g. `InsightsDigest` with 12+ card types) hides far more than the toggle intends.
- **Public-portal mutations must call `addActivity()`** — every POST/PUT/PATCH/DELETE in `public-portal.ts` that changes workspace data must call `addActivity()` with an appropriate type. Without it, admins have zero visibility into client portal engagement in the activity feed.

---

## Test Conventions (mandatory for feature work)

- **Write tests alongside code** — new routes need integration tests, new state transitions need guard tests, new shared type fields need contract tests. Use the existing infrastructure; don't hand-roll mocks when a factory exists.
- **Test infrastructure** — mock factories in `tests/mocks/` (webflow, stripe, openai, anthropic, google, semrush), seed fixtures in `tests/fixtures/` (workspace-seed, auth-seed, content-seed, approval-seed), HTTP test helper `createTestContext(port)` in `tests/integration/helpers.ts`.
- **Port uniqueness** — each integration test file using `createTestContext()` must use a unique port. Check existing ports with `grep -r 'createTestContext(' tests/` before allocating. Current range: 13201–13316.
- **External API error tests** — mock the API to return an error, then assert the operation records `failed`/`error` status, not success (FM-2 pattern).
- **Cleanup** — all `beforeAll` resource creation must be paired with `afterAll` cleanup. Use `seedWorkspace().cleanup()` or `deleteWorkspace(id)`. Never leave orphaned test data.

---

## Key Documentation (read as needed)

| Doc | When to read |
|-----|-------------|
| `BRAND_DESIGN_LANGUAGE.md` | Any UI work — color rules, per-component color map |
| `DESIGN_SYSTEM.md` | Component specs, typography, spacing, Tailwind classes |
| `FEATURE_AUDIT.md` | Before building anything — 70+ feature inventory |
| `MONETIZATION.md` | Tiers, pricing, Stripe spec, UX soft-gating |
| `ACTION_PLAN.md` | Execution roadmap, decision log |
| `data/roadmap.json` | Sprint tracking — what's done/pending |
| `.windsurf/workflows/use-primitives.md` | When and how to use UI primitives |
| `.windsurf/workflows/ui-vocabulary.md` | Canonical labels for buttons, badges, status text |
| `.windsurf/workflows/feature-integration.md` | Connecting features together |
| `.windsurf/workflows/feature-shipped.md` | 9-step post-ship checklist |
| `.windsurf/workflows/wiring-patterns.md` | Adding data sources to chat/strategy/briefs |
| `.windsurf/workflows/stripe-integration.md` | Payment architecture |
| `.windsurf/workflows/auth-system.md` | Auth architecture and flows |
| `.windsurf/workflows/new-feature-checklist.md` | Before/during/after feature implementation |
| `.windsurf/workflows/deploy.md` | Commit, push, verify deploy (staging → main flow) |
| `.windsurf/workflows/staging-environment.md` | Staging URLs, DB sync, feature flags, env vars |
| `.windsurf/rules/data-flow.md` | Data flow consistency rules (detailed) |
| `.windsurf/rules/ui-ux-consistency.md` | UI/UX consistency rules (detailed) |
| `.windsurf/rules/analytics-insights.md` | Insight type registration, enrichment contracts, anomaly dedup, phase gates |
| `.windsurf/rules/multi-agent-coordination.md` | Parallel agent protocol, file ownership, cross-phase contracts, spec-plan sync |
| `docs/testing-plan.md` | Test strategy, failure mode catalog, coverage gaps, infrastructure |

---

## Known Issues to Ignore

These pre-existing lint warnings are not caused by current work:

- **`ClientDashboard.tsx`**: `requestingTopic` declared but never read; `useEffect` missing dependencies (intentional fire-once)
- **`ContentPipeline.tsx`**: `useEffect` with `fetchSummary` callback dependency

Do not fix during unrelated tasks.

---

## Parallel Agent Coordination (mandatory before dispatching subagents)

Subagents are fully isolated — no shared state, no awareness of each other. Conflicts happen when two agents touch the same file or depend on output the other hasn't committed yet. Follow this protocol every time:

### 1. Pre-commit shared contracts first
Before any parallel agents start, identify every type, interface, or function signature that multiple agents will depend on. Define and **commit** these to the branch. Agents read from committed code, not from each other's in-progress work.

Examples of shared contracts: new entries in `shared/types/`, new exports in barrel files (`src/hooks/admin/index.ts`), new query keys in `src/lib/queryKeys.ts`, new DB store functions that multiple routes will call.

### 2. Assign exclusive file ownership
Each agent task description must include:
- **Owns** — exhaustive list of files it may create or modify
- **Must not touch** — any file owned by another parallel agent

If a file needs changes from more than one agent, it becomes a **sequential task** instead. No exceptions.

### 3. Shared files are sequential
Files commonly needed by multiple agents — route files, `analytics-insights-store.ts`, `shared/types/analytics.ts`, barrel exports — should be handled by one agent (or the orchestrator) after parallel work completes.

### 4. Diff review checkpoint after each parallel batch
After parallel agents finish, run:
```bash
git diff HEAD -- <list of shared files touched>
```
Check for: duplicate imports, conflicting function definitions, missed exports, mismatched type names. Fix before starting the next batch.

### 5. Dispatch prompts must declare app-level context
When dispatching a subagent to write or modify a server route or frontend component, the prompt **must include** a brief "App-level context" section covering:
- Which rate limiters already apply (e.g., "all /api/public/ POST routes already have `publicWriteLimiter` via `app.ts` — do NOT add it in the route file")
- Which React Query caches already exist and their keys
- Which WS events the component already subscribes to
- Current conditional rendering state (e.g., "the EmptyState shows when `items.length === 0` — adding a parallel signal banner requires updating this condition too")

Subagents have no awareness of code they haven't been explicitly shown. Missing context is the #1 source of "looks right in isolation, broken in context" bugs.

---

## Implementation Planning Standards

When writing implementation plans (via `writing-plans` skill):

1. **Exhaustive audit first** — for refactoring, migration, or audit work, invoke the `pre-plan-audit` skill before writing the plan. This launches parallel agents to grep the entire codebase and categorize every finding. Never write a plan from memory or spot-checks.
2. **Parallelization strategy required** — every plan must include a dependency graph showing which tasks can run concurrently and which are sequential.
3. **Model assignments required** — specify Haiku (mechanical replacements), Sonnet (component logic), or Opus (orchestration/judgment) per task.
4. **Systemic improvements section required** — every plan must include: shared utilities to extract (if 3+ files do the same fix), pr-check rules to prevent recurrence, and test coverage additions.
5. **Verification strategy required** — specify how to verify the work (preview screenshots, specific test commands, contrast checks) rather than "manual verification."

---

## Quality Gates

Work is not done until ALL pass:

- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vite build` — builds successfully
- [ ] `npx vitest run` — full test suite passes (not just new tests)
- [ ] `FEATURE_AUDIT.md` updated (if feature work)
- [ ] `data/roadmap.json` updated (if roadmap item)
- [ ] `BRAND_DESIGN_LANGUAGE.md` updated (if UI changed)
- [ ] No `violet` or `indigo` in `src/components/`
- [ ] `npx tsx scripts/pr-check.ts` — zero errors
- [ ] If subagents were used: invoke `scaled-code-review` skill for parallel batch output (10+ files), or `superpowers:requesting-code-review` for single-task output. Fix Critical/Important issues before proceeding.
- [ ] All bugs surfaced during review are fixed — never dismiss a fixable bug as "pre-existing", "minor", or "out of scope". If a review agent or manual review finds it and it can be fixed, fix it in this PR.
- [ ] If multi-phase feature: this PR covers exactly one phase. Phase N+1 is not started until phase N is merged and green.
