# hmpsn.studio — Agent Rules

> **Single source of truth for all AI agents** (Claude Code, Codex, Devin, Windsurf, Cursor).
> This file is loaded at the start of every session. Follow it before making changes.
>
> Codex reads this via `.codex/config.toml` fallback. Windsurf's `.windsurfrules` is a thin pointer here.

---

## Project Overview

**hmpsn.studio** is an SEO/web analytics agency platform. React 19 + Vite 8 + TailwindCSS 4 + React Router DOM 7 (frontend), Express + TypeScript (backend), SQLite via better-sqlite3 (storage).

Integrations: Webflow, Google Search Console, GA4, SEMRush, DataForSEO (both via `SeoDataProvider` interface in `server/seo-data-provider.ts`), Stripe, OpenAI (GPT-4.1), Anthropic (Claude for creative prose).

- **Routing** — React Router DOM 7. `src/routes.ts` defines `Page` + `ClientTab` types, `adminPath()` + `clientPath()` helpers. Admin: `/ws/:workspaceId/:tab?`. Client: `/client/:workspaceId/:tab?` (betaMode variant: `/client/beta/:workspaceId/:tab?`). **Inbox sub-routing:** the Inbox tab uses `?tab=decisions|reviews|conversations` (`InboxFilter` values, not `ClientTab` values) — the `?tab=` deep-link two-halves contract applies here too. Legacy aliases still work: `approvals→decisions`, `requests→conversations`, `content→reviews`. **Retired tab:** `schema-review` was removed as a standalone `ClientTab` (old bookmarks redirect → `/inbox?tab=reviews`; `SchemaReviewModal` now mounts inside Inbox). **Current `ClientTab` values:** `overview`, `performance`, `search`, `health`, `strategy`, `analytics`, `inbox`, `plans`, `roi`, `content-plan`, `brand`. (`approvals`, `requests`, `content` are legacy `ClientInboxAlias` values, not real tabs.)
- **API Client** — Typed fetch wrappers in `src/api/` (20 modules). No raw `fetch()` in components.
- **Shared Types** — `shared/types/` (48 modules) shared between client and server.
- **Storage** — SQLite (WAL mode, foreign keys ON) at `DATA_BASE/dashboard.db`. 101+ migrations in `server/db/migrations/`.
- **MCP Server** — `server/mcp/` exposes an MCP-protocol action server (workspaces, insights, content, keywords, intelligence, job actions). Uses `mcpAuthMiddleware` + `handleMcpRequest`. New tool categories go in `server/mcp/tools/`.
- **AI** — Unified dispatcher: `callAI()` in `server/ai.ts` routes to either provider — new code should use this. Direct helpers: OpenAI via `server/openai-helpers.ts` (`callOpenAI`), Anthropic via `server/anthropic-helpers.ts` (`callAnthropic`) for creative prose.
- **Auth** — Dual: internal JWT (7-day, admin) + client JWT (24h, per-workspace). Turnstile CAPTCHA optional.
- **Payments** — Stripe Checkout (not Payment Intents). Config encrypted on disk (AES-256-GCM).
- **Validation** — Zod v3 via `server/middleware/validate.ts`. Import as `import { validate, z } from '../middleware/validate.js'`.
- **Data Fetching** — React Query (`@tanstack/react-query`) for ALL frontend data. Hooks in `src/hooks/admin/` and `src/hooks/client/`.
- **Logging** — Pino structured JSON (`server/logger.ts`). `createLogger(module)` for child loggers.
- **Error Monitoring** — Sentry (server + frontend). Auto-tags `workspaceId`.
- **Monetization** — 3 tiers (Free/Growth/Premium), per-item content purchases, 14-day Growth trial, UX soft-gating via `<TierGate>`.

---

## Enforcement Layers

Project rules live in three layers. Know which layer you're reading before copy-pasting:

1. **CLAUDE.md** (this file) — session protocol, decision framework, design laws, and philosophical guardrails that can't be grepped.
2. **[docs/rules/automated-rules.md](./docs/rules/automated-rules.md)** — every rule enforced by `scripts/pr-check.ts`. Auto-generated from the `CHECKS` array; do not hand-edit. CI fails if the committed file drifts from `npm run rules:generate`.
3. **[docs/rules/*.md](./docs/rules/)** — deep-dive references for specific subsystems (data-flow, UI/UX, multi-agent coordination, analytics insights, AI dispatch patterns, etc.).

When a CLAUDE.md rule becomes mechanizable, it moves to layer 2. The authoring guide for new pr-check rules is [docs/rules/pr-check-rule-authoring.md](./docs/rules/pr-check-rule-authoring.md). The current rule count is **140** (125 error, 15 warn) — run `npm run rules:generate` if the committed file drifts.

---

## Session Protocol

### Before writing code

0. **New environment?** — Run `npm run seed:demo` then `npm run smoke:core` to confirm local setup is healthy. See `docs/workflows/local-dev-onboarding.md`.
1. **Check `data/roadmap.json`** — scan for `"status": "pending"` in current sprint. If user hasn't specified a task, suggest the next pending item.
2. **Check `FEATURE_AUDIT.md`** — understand what exists. Don't build something that already exists.
3. **If UI work** — read `BRAND_DESIGN_LANGUAGE.md` before writing any JSX.
4. **Before writing any implementation plan** — read `docs/PLAN_WRITING_GUIDE.md`.
5. **Cross-reference before building** — search the codebase to verify a component/endpoint/feature doesn't already exist.
6. **For new feature or substantial refactor work** — identify the owning bounded context from `docs/rules/platform-organization.md` before choosing files. Prefer adjacent, context-owned modules over new catch-all files.
7. **For multi-phase or cross-system features** — before writing any implementation code, generate feature-specific guardrails: (a) CLAUDE.md rules for reusable patterns this feature introduces, (b) a `docs/rules/<feature>.md` reference doc for feature-specific contracts, and (c) per-phase acceptance checklists embedded in the implementation plan. Guardrails written after bugs are found cost 3× more than guardrails written before the first commit.

### After completing a task

Every completed task must include:

1. **`FEATURE_AUDIT.md`** — add new entries or update existing ones for any feature work.
2. **`data/roadmap.json`** — mark completed items `"pending"` → `"done"`, add `"notes"`. Run `npx tsx scripts/sort-roadmap.ts`.
3. **`BRAND_DESIGN_LANGUAGE.md`** — update if any UI colors/components/patterns changed.
4. **Build verify** — `npm run typecheck && npx vite build`
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
| `npm run typecheck` | Type-check (project-aware: `tsc -b --noEmit`, traverses both `tsconfig.app.json` and `tsconfig.node.json`). Plain `npx tsc --noEmit` against the root `tsconfig.json` checks **zero files** because the root config uses project references with `files: []` — always use the script. |
| `npx vite build` | Production build |
| `npx vitest run` | Unit + integration + component tests |
| `npx playwright test` | E2E tests (requires server running) |
| `npx tsx scripts/sort-roadmap.ts` | Auto-archive completed sprints |
| `npx tsx scripts/pr-check.ts` | Automated pre-PR checklist (color violations, JSON.parse, hard-coded names) |
| `npm run pr-check` | Alias for `npx tsx scripts/pr-check.ts` |
| `npm run pr-check:all` | Run pr-check across all changed + unchanged files |
| `npm run db:migrate` | Run pending SQLite migrations |
| `npm run db:sync-staging` | Sync staging database to local |
| `npm run seed:demo` | Seed fixture workspaces for local dev (blocked in production) |
| `npm run smoke:core` | Fast core smoke coverage — use after seeding |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:contract` | Contract tests only |
| `npm run test:component` | Component tests only |
| `npm run test:coverage` | Full test suite with coverage report |
| `npm run verify:platform` | Full platform health verification suite |
| `npm run verify:platform:quick` | Quick platform checks (skips slow verifiers) |
| `npm run verify:feature-flags` | Validate feature flag catalog consistency |
| `npm run verify:coverage-ratchet` | Fail if coverage has regressed below ratchet |
| `npm run rules:generate` | Regenerate `docs/rules/automated-rules.md` from pr-check CHECKS array |

**Always verify after changes:** `npm run typecheck && npx vite build`

---

## Design System — The Four Laws of Color

1. **Teal for actions** — every CTA, toggle, active state, tier badge, interactive highlight
2. **Blue for data** — clicks, sessions, impressions, info badges, progress bars (read-only, never actionable)
3. **Emerald for success** — `scoreColorClass()` returns `text-emerald-400` for score ≥80; `scoreColor()` hex is `#34d399` (emerald-400). Never `text-green-400` for success/score indicators — green and emerald are distinct hues, emerald is canonical.
4. **Purple for admin AI only** — `AdminChat.tsx` and `SeoAudit.tsx` "Flag for Client". Never in client-facing views. Purple removed from `Badge.tsx` color union — use teal/blue/emerald/amber/red instead.

### Color quick reference

```
Button / CTA / toggle?      → Teal (from-teal-600 to-emerald-600)
Data metric?                 → Blue (text-blue-400, bg-blue-500/10)
Admin AI feature?            → Purple (purple-400/purple-600)
Score (health/perf)?         → scoreColor() / scoreColorClass() from ui/constants.ts
  ≥80 → emerald (text-emerald-400, #34d399)
  ≥60 → amber   (text-amber-400)
  <60 → red     (text-red-400)
Status badge?                → green=success, amber=warning, red=error, orange=changes-requested, blue=info, teal=client-requested
Tier badge (client)?         → Teal (all tiers) or zinc (free)
```

### Token authority

- **Single source of truth:** `src/tokens.css` — every `--*` CSS custom property lives here. Never redefine a `--*` token outside `src/tokens.css`.
- **App bundle:** `src/index.css` `@import`s `src/tokens.css`. No `--*` declarations in `src/index.css`.
- **Styleguide:** `public/styleguide.css` `@import url('/tokens.css')`. No `--*` declarations in `public/styleguide.css`.
- **Build mirror:** `public/tokens.css` is copied from `src/tokens.css` by `copyTokensPlugin()` in `vite.config.ts` at build time.
- **Typography utilities:** 14 `.t-*` classes (`.t-hero`, `.t-h1`, `.t-h2`, `.t-stat-lg`, `.t-stat`, `.t-stat-sm`, `.t-page`, `.t-body`, `.t-ui`, `.t-label`, `.t-caption`, `.t-caption-sm`, `.t-mono`, `.t-micro`) defined in `src/index.css` and available globally.
- **Visual source of truth:** `/styleguide` React route (or `/styleguide.html` static) demos all tokens + primitives.
- **Verification:** `npx tsx scripts/verify-styleguide-parity.ts` asserts zero token duplication between `src/index.css` and `src/tokens.css`.
- **Z-index scale (never use raw z-index values):** `--z-sticky: 10`, `--z-dropdown: 20`, `--z-tooltip: 30`, `--z-modal-backdrop: 40`, `--z-modal: 50`, `--z-modal-fullscreen: 55` (full-screen takeover modals above chat widget), `--z-toast: 60`. All defined in `src/tokens.css`.
- **Token categories in `src/tokens.css`:** Surface, Text, Brand colors, Border, Shadows/overlays, Scrollbar, Border-radius, Icon sizes, Zinc scale, Accent hues, Chart, Z-index, Annotation colors.

### Forbidden

- **Never** use `violet`, `indigo`, or new hue families without explicit approval
- **Never** use `rose-` or `pink-` — not in the design system hue palette
- **Never** hand-roll card markup — use `<SectionCard>`
- **Never** hand-roll stat displays — use `<StatCard>` or `<CompactStatBar>`
- **Never** hard-code score colors — use `scoreColor()` / `scoreColorClass()`
- **Never** use purple in any client-facing component
- **Never** use `text-green-400` for success/score indicators — use `text-emerald-400`
- **Never** redefine a `--*` token outside `src/tokens.css`

### UI Primitives — always check before hand-rolling

`SectionCard`, `StatCard`, `CompactStatBar`, `PageHeader`, `MetricRing`, `MetricRingSvg`, `Badge`, `TabBar`, `DateRangeSelector`, `DataList`, `EmptyState`, `ErrorState`, `LoadingState`, `TierGate`, `TierBadge`, `AIContextIndicator`, `StatusBadge`, `Skeleton`, `ConfirmDialog`, `WorkflowStepper`, `WorkspaceHealthBar`, `OnboardingChecklist`, `FeatureFlag`, `TrendBadge`, `ChartCard`, `ClickableRow`, `ProgressIndicator`, `CharacterCounter`, `NextStepsCard`, `MetricToggleCard`, `ScannerReveal`, `SerpPreview`, `SocialPreview`, `ActionPill` [deprecated], `SegmentedControl` [deprecated] — all from `src/components/ui/`.

**Client inbox components** (in `src/components/client/`) — check before hand-rolling inbox UI: `DecisionDetailModal` (full-screen bulk approval modal), `DecisionCard` (entry-point card — inline approve for single-action, modal CTA for batch), `ApprovalBatchCard` (inline approval card for Decisions/Conversations sections), `PriorityStrip` (cross-section priority item strip), `SchemaReviewModal` (schema review mounted as a modal inside Inbox > Reviews).

---

## Data Flow Rules (mandatory)

1. **Broadcast after mutation** — every POST/PUT/PATCH/DELETE that changes workspace data must call `broadcastToWorkspace()` with an appropriate event. All WS event name constants must be defined in `server/ws-events.ts` — never use inline string literals. Any feature that writes data visible to both admin and client must register its events there.
2. **Frontend must handle broadcasts** — every workspace-scoped broadcast needs a `useWorkspaceEvents(workspaceId, ...)` handler that invalidates the relevant React Query caches. For workspace-scoped events (anything broadcast via `broadcastToWorkspace()`) ALWAYS use `useWorkspaceEvents`, never `useGlobalAdminEvents`. The latter does NOT send a `subscribe` action, so the server's workspace filter excludes the connection and your handler is dead code. `useGlobalAdminEvents` is reserved for the ~2 legitimate global-fanout events (`ADMIN_EVENTS.*`, `presence:update`) and is forbidden elsewhere.
3. **Delete operations** — always read data before delete (for activity log context).
4. **Activity logging** — all significant operations must call `addActivity()`. Public-portal mutations are enforced by pr-check (see [automated-rules.md](./docs/rules/automated-rules.md)).
5. **Typed data contracts at boundaries** — when data flows between layers (backend → API → frontend, or between modules via JSON columns), define typed interfaces in `shared/types/` BEFORE implementing. Never use `Record<string, unknown>` for new data shapes. Specifically:
   - New DB JSON columns → define a typed interface, not `Record<string, unknown>`
   - New insight types → add to `InsightDataMap` in `shared/types/analytics.ts`
   - New filter/category values → use shared const objects (like `INSIGHT_FILTER_KEYS`), not string literals
   - Percentage vs decimal fields → add JSDoc: `/** Already a percentage (e.g., 6.3 for 6.3%). Do NOT multiply by 100. */`
   - Shared string enums between producer/consumer → single const object imported by both sides
6. **Wire new data sources into the intelligence engine** — any new table or store that captures workspace activity must be surfaced in `server/intelligence/`. Each slice lives at `server/intelligence/<name>-slice.ts` and exports a single `assembleX(workspaceId, opts?)` function plus a typed interface. Add a field to the appropriate slice interface in `shared/types/intelligence.ts` AND implement the read inside the corresponding `assemble*` function. `server/workspace-intelligence.ts` is the public facade that orchestrates all slices — call `buildWorkspaceIntelligence()` from there; do not call slice functions directly from route handlers. The AI context and AdminChat are blind to data that isn't wired into a slice. **Current slices:** `seoContext`, `insights`, `siteHealth`, `siteInventory`, `operational`, `learnings`, `clientSignals`, `pageProfile`, `pageElements`, `contentPipeline`, `localSeo`. The relevant slice for client-facing signals and engagement data is `ClientSignalsSlice`. See `docs/rules/workspace-intelligence.md`.

## UI/UX Rules (mandatory)

1. **Always use shared primitives** from `src/components/ui/` before creating new components.
2. **Loading states** — use contextual messages ("Analyzing site health..." not "Loading..."). Use `<Skeleton>` for layout-preserving shimmer.
3. **Empty states** — always action-oriented with a CTA using `<EmptyState>`.
4. **Error handling** — wrap major sections in `<ErrorBoundary>`. Show empathetic messages with retry.
5. **Mobile-first** — responsive design, test at mobile breakpoints.
6. **Color coding** — follow the Four Laws strictly.
7. **Accessibility** — proper ARIA labels, keyboard navigation, focus management.
8. **Progressive disclosure** — show summary first, details on demand.
9. **Extract shared interaction patterns** — when 2+ components implement the same user interaction (toggle logic, filter state, sort behavior), extract to a shared hook or utility. Don't let subagents independently re-implement the same logic — it drifts. Example: `useToggleSet(defaults, { min, max })` instead of 3 inline `useState<Set>` + toggle handlers.
10. **AI prompt ↔ frontend rendering must be co-designed** — when a system prompt instructs the AI to format output a certain way (Markdown, JSON, prefixed labels), verify the frontend rendering matches. If a rewrite/insertion path uses `textContent` or `innerText`, the AI must be told to return plain prose, not Markdown. If a parsing path uses `match(/regex/)`, the AI's output format must be stable enough for the regex. Document the contract in the system prompt itself (e.g., "content is inserted into a live editor — no Markdown syntax").
11. **Content quality grounding** — factual content generation and review paths must use the research-mode/evidence contracts in `docs/rules/content-quality-grounding.md`. Preserve output-format contracts (`responseFormat`, `json: true`, clean HTML) and never let AI auto-check provenance-sensitive review items.
12. **`?tab=` deep-link two-halves contract** — when navigating to a component with `?tab=X` (via `navigate()`, `<Navigate>`, or any URL construction), the receiving component MUST read `useSearchParams` and initialize its tab state from the `'tab'` param. This is a two-halves contract: the sender appends `?tab=X`, the receiver reads it. Neither half alone is sufficient — a `?tab=` URL whose target ignores the param is a silent navigation bug (user sees the default tab instead of the requested one). Pattern: `const [searchParams] = useSearchParams(); const [tab, setTab] = useState(() => { const param = searchParams.get('tab'); return TABS.some(t => t.id === param) ? param : defaultTab; });`. Enforced by contract test (`tests/contract/tab-deep-link-wiring.test.ts`) and pr-check.

---

## Multi-Agent Coordination (mandatory)

> Full rules + model assignment table: `docs/rules/multi-agent-coordination.md`
> Plan-writing guide (parallel agents, PR gates, testing, verification): `docs/PLAN_WRITING_GUIDE.md`

Key rules: pre-commit shared contracts before dispatch, exclusive file ownership per agent, diff review after every parallel batch, explicit dependency graphs in every plan, spec amendments sync to plans in same commit, cross-phase contracts doc for multi-phase features.

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

**Rule: Admin mutations on workspace-scoped tables must take explicit `expectedWorkspaceId`.** `requireWorkspaceAccess(:id)` only verifies the caller has access to the `:id` workspace in the URL — it does NOT verify that nested `:userId` (or similar) path parameters actually belong to that workspace. Any exported mutation function in `server/client-users.ts` (`updateClientUser`, `changeClientPassword`, `deleteClientUser`, and any future `update*|delete*|change*`) must therefore accept `expectedWorkspaceId: string` as a required parameter and route the target `id` through the `assertUserInWorkspace(id, expectedWorkspaceId)` guard. The guard MUST return `null` uniformly for both "row not found" and "row belongs to a different workspace" so the endpoint cannot be used as a workspace-enumeration oracle. Without this, an admin authenticated for workspace A could call `PATCH|DELETE|password-change` against a user from workspace B by knowing only the UUID. Enforced by pr-check.

---

## Code Conventions

- **TypeScript strict** — no `any` unless unavoidable
- **API error shape**: `{ error: string }` consistently
- **User-facing strings**: follow `docs/workflows/ui-vocabulary.md` canonical labels
- **Studio name**: use the `STUDIO_NAME` / `STUDIO_URL` constants from `src/constants.ts` (frontend) or `server/constants.ts` (backend). Never hard-code `"hmpsn.studio"` — enforced by pr-check.
- **Route validation**: Zod schemas via `validate()` middleware, not hand-written checks
- **Frontend data**: all hooks use `useQuery`/`useMutation`. No hand-rolled `useState`+`useEffect`+fetch patterns. Query keys: `admin-*` / `client-*` prefixes.
- **Imports**: always at top of file, grouped with existing imports. Never add imports mid-file next to the code that uses them — this breaks the oxc parser used by vitest/vite and violates code conventions. When adding code to an existing file, check existing imports first (`grep -n '^import' <file>`).
- **DB patterns**: lazy prepared statements via `createStmtCache()`/`stmts()`, JSON columns as TEXT parsed at read boundary, `rowToX()` mappers, three-state booleans (0/1/NULL). Bare `JSON.parse` on DB columns, local `let stmt` caching, multi-step DB writes outside `db.transaction()`, AI-call-before-DB-writes without a transaction guard, `SUM()` without `COALESCE`, UPDATE/DELETE without `workspace_id` scoping, and `getOrCreate*` functions with nullable return types are **all enforced by pr-check**. See [automated-rules.md](./docs/rules/automated-rules.md). For detailed rationales see [docs/rules/ai-dispatch-patterns.md](./docs/rules/ai-dispatch-patterns.md).
- **JSON column parsing — always use the three helpers from `server/db/json-validation.ts`**, never bare `JSON.parse`. Pick the right one: `parseJsonSafe<T, F>(raw, schema, fallback, context)` for single-object columns (pass `context` with `workspaceId`/`field`/`table` for rich warning logs), `parseJsonSafeArray(raw, itemSchema, context)` for array columns (validates items individually so one bad item doesn't drop all — never validate the whole array at once), `parseJsonFallback<T>(raw, fallback)` for schema-free fields. See `server/approvals.ts` `rowToBatch` for the array pattern.
- **Zod schema field names** — when writing Zod schemas for existing TypeScript interfaces, always cross-reference field names against the source interface in `shared/types/`. Zod won't flag name mismatches at compile time — a required field with a wrong name silently fails `safeParse` at runtime, returning the fallback instead of real data.
- **Schema vs stored shape** — DB column schemas must reflect what is actually stored, not the in-memory assembled object. If a write path deliberately omits a field (e.g. storing it in a separate table), that field must be `.optional()` in the Zod schema. A required field absent from the stored blob causes every `parseJsonSafe` call to silently return the empty fallback, destroying all real data. See `keywordStrategySchema.pageMap` as the canonical example.
- **Status transitions must use state machines** — before any status mutation, call `validateTransition(currentStatus, nextStatus)` from `server/state-machines.ts`. All legal forward/backward transitions for approval items, content requests, client actions, work orders, content subscriptions, and posts are defined here. A transition that isn't listed is a bug, not a feature.
- **Normalize large repeated arrays out of JSON columns** — arrays that need filtering or sorting belong in dedicated tables, not JSON blobs. Pattern: migrations 088–090 extracted `keyword_gaps`, `topic_clusters`, and `cannibalization_issues` from keywordStrategy JSON. Follow this when modeling new repeating data.
- **Inbox abstraction** — `NormalizedDecision` in `shared/types/decision.ts` is the canonical interface for inbox items that unifies `ClientAction` and `ApprovalBatch`. Use it for any component or hook that renders or processes both types. `isSingleAction: true` → inline approve/decline UI; `false` → bulk modal (opens `DecisionDetailModal`).
- **Outcome tracking types** — `shared/types/outcome-tracking.ts` defines `ActionType`, `Attribution`, `OutcomeScore`, `LearningsTrend`, and `EarlySignal` unions. Always use these typed values when creating tracked actions or outcomes — never inline string literals.
- **Outcome learnings availability is authoritative** — builder-backed content/recommendation consumers must treat `LearningsSlice.availability` as the source of truth for whether learnings are usable. Do not re-check feature flags or rebuild ad hoc “no learnings” logic in callers when `buildContentGenerationContext()` / `buildRecommendationGenerationContext()` already returned `learningsAvailability`. The only extra builder-local state is `not_requested`, which means the caller intentionally omitted the learnings slice. Use the shared helpers in `server/outcome-learning-default-path.ts` for score adjustments and fallback messaging. See `docs/rules/outcome-learning-default-path.md`.
- **Large edits**: break into multiple smaller edits if > 300 lines
- **Platform organization** — new and substantially touched features must name an owning bounded context and follow the forward-looking structure in `docs/rules/platform-organization.md`. Prefer route-to-service extraction (`server/routes/*` as HTTP adapters; domain behavior in `server/domains/<domain>/` or established domain modules) over adding more logic to route files. Avoid whole-repo feature-folder migrations unless there is a pre-plan audit, phased migration plan, compatibility strategy, and verification gate for each phase.
- **Delete-then-reinsert batch updates must preserve metadata** — batch-save UX is often implemented as delete-all + reinsert (simpler than per-row upserts). This permanently clobbers `created_at`, user-defined `sort_order`, and any approval/status column not present in the new payload. Always build a `Map<id, { createdAt, sortOrder, ... }>` from the pre-delete read and re-apply those fields on insert. See `updateBrandscriptSections` in `server/brandscript.ts` for the pattern.
- **Prompt assembly layers must not duplicate content** — `buildSystemPrompt` in `server/prompt-assembly.ts` injects voice DNA + guardrails into the system message when `profile.status === 'calibrated'` (Layer 2). Any user-prompt code that manually inlines the same DNA must guard on `profile.status !== 'calibrated'` to avoid redundant injection that wastes tokens and confuses the model. Use `buildVoiceCalibrationContext(profile)` from `server/voice-calibration.ts` rather than hand-rolling the guard inline.
- **Structured AI output paths must use named operation contracts + schema validation** — when an AI caller expects JSON or another typed payload, register a named operation in `server/ai-operation-registry.ts` when the call is reusable/high-value, use `callAI({ operation: '...' })` where practical, and validate the parsed payload with Zod or an equivalent schema. `parseAIJson()` is boundary cleanup only; it is not a replacement for shape validation. See `docs/rules/ai-operation-contracts.md`.
- **AI quality evals are deterministic-first** — prompt/output quality gates must extend the shared AI reliability registry with typed fixtures, not create disconnected live-model scoring paths. CI may hard-fail missing evidence, authority, output-format, or provenance contracts; subjective prose scoring stays advisory/manual until validated. See `docs/rules/ai-quality-evals.md`.
- **Authority-layered fields — expose one resolved representation, never raw + format helper** — when a shared-type field has multiple authority sources (legacy column + override, global + workspace-specific, raw + computed), the single blessed representation is the pre-resolved form (e.g. `SeoContextSlice.effectiveBrandVoiceBlock`, which is pre-formatted by `buildSeoContext` with voice-profile authority applied). Callers inject that form DIRECTLY. Never ship a generic `format<Field>ForPrompt(raw)` helper alongside it — any caller who grabs the helper bypasses the authority chain, and the compiler cannot see the mistake because the raw field's type is still `string`. **Corollary:** when *adding* a new authority layer to an existing field, grep the repo for every format helper touching that field and delete them in the same commit. A helper that predates an authority layer cannot know about it. The reintroduction hazard is mechanized by the pr-check rule of the same name.
- **Route removal checklist** — removing or renaming a `Page` union value touches seven files. The full list lives in [docs/rules/route-removal-checklist.md](./docs/rules/route-removal-checklist.md). Every entry must be updated in the same commit.
- **Phase-per-PR** — multi-phase features ship as one PR per phase. Never open phase N+1 until phase N is merged and CI is green on `staging`. Use `<FeatureFlag flag="...">` to dark-launch incomplete phases so production never serves broken UI. Add the flag to `shared/types/feature-flags.ts` before the first commit of any new multi-phase feature. **Before touching a gated area, check `shared/types/feature-flags.ts` for active in-flight flags.** Currently active: `new-inbox-ia` (client inbox IA redesign), `local-seo-visibility` (local SEO visibility foundation), `client-briefing-v2` / `client-briefing-v2-ai-polish` (client briefing v2 layout), `schema-ai-element-classifier` (AI element role classifier), `smart-placeholders`, `client-brand-section`.
- **Staging before main** — all PRs merge into `staging` first. After verifying on the staging deploy, merge `staging` → `main` to release to production. Never merge an unverified PR directly to `main`.
- **String literal renames** — when renaming a discriminator value used across the codebase (insight type, status enum, filter key), grep the entire repo for the old literal and update ALL references in one commit. Never split a rename across multiple tasks or PRs.
- **New insight type registration** — adding a value to `InsightType` requires all four of these in the same commit: (1) `InsightType` union in `shared/types/analytics.ts`, (2) typed `XData` interface + `InsightDataMap` entry — never `Record<string,unknown>`, (3) Zod schema in `server/schemas/`, (4) frontend renderer case. Missing any one fails silently. See `docs/rules/analytics-insights.md`.
- **DB column + mapper lockstep** — adding columns to any table requires migration SQL, row interface, `rowToX()` mapper, write path (`upsertX()`), AND the public endpoint serialization list in `public-portal.ts` if the field is client-facing, all in the same commit. TypeScript will not catch a mapper that silently ignores a new column, and the public endpoint's explicit field list will silently omit it.
- **Integration tests must cover the actual read path** — when a feature gates client-facing behavior on a field from `GET /api/public/workspace/:id`, the integration test must exercise that endpoint, not the admin GET. A test that only verifies the admin route gives false confidence; a regression in the public serialization goes undetected.
- **Enrichment field fallbacks** — optional fields computed at insight-store time must have explicit fallbacks. `pageTitle` must always resolve to something (cleaned slug if all else fails) — never render a raw URL. Enrichment failure must degrade gracefully, not block insight storage.
- **Feedback loop completeness** — every cross-system write (e.g. insights → strategy, insights → pipeline) requires both halves: server `broadcastToWorkspace()` AND frontend `useWorkspaceEvents` handler that invalidates the correct React Query key. Neither half alone is sufficient.
- **Bridge authoring rules** — every bridge callback must follow four rules: pass `bridgeSource` for stale-cleanup immunity, use `applyScoreAdjustment()` for score changes, return `{ modified: N }` and never manually broadcast, and never call `resolveInsight()` unless the bridge's purpose is resolution management. Full rationale: [docs/rules/bridge-authoring.md](./docs/rules/bridge-authoring.md). Rule #3 is enforced by pr-check.
- **Client vs admin insight framing** — client-facing insight components must use narrative, outcome-oriented language. No purple. No admin jargon. Premium features wrapped in `<TierGate>`. Verify with `grep -r "purple-" src/components/client/` before shipping any client insight work.
- **Rate display: numerator and denominator must share a source** — if a component shows both a computed rate (win rate, conversion rate, etc.) and a "total" count, the displayed count must be the exact denominator used to compute the rate. Never mix a DB-aggregated count with a locally-filtered count. A mismatch causes users to infer the wrong raw counts from the displayed percentage.
- **Read-before-write for cross-module consumption** — before writing code that consumes another module's exports (assemblers, bridges, mappers), read the source module's actual interface/type definitions and exported function signatures. Never guess property names, function names, or return shapes from memory. The #1 bug pattern in this codebase is guessed field names (`pages` vs `decayingPages`, `createdAt` vs `changedAt`, `organicValue` vs `organicTrafficValue`) that compile because of `as any` casts but produce silent data loss at runtime.
- **Zod clearable-field pattern** — optional validated fields that back user-editable inputs (email, URL, phone with pattern) must use `.or(z.literal(''))` so clearing the field doesn't return a 400. `.optional()` only handles the key being absent, not an empty string from a cleared input.
- **Feature toggle scope minimality** — feature toggles must gate the specific sub-feature, never a composite parent component. Pass the flag as a prop and gate inside the component at the narrowest point. Wrapping a composite component (e.g. `InsightsDigest` with 12+ card types) hides far more than the toggle intends.
- **AI/recommendation generation consumers must use shared intelligence context builders.** For high-value server-side generation and recommendation paths that need both raw intelligence and a formatted prompt block, use `server/intelligence/generation-context-builders.ts` (`buildContentGenerationContext`, `buildRecommendationGenerationContext`) rather than hand-rolling direct `getInsights()` / `getWorkspaceLearnings()` prompt assembly. Use `buildIntelPrompt()` when only the formatted intelligence block is needed. Caller-owned add-on blocks are reserved for non-slice evidence (scraped references, live SERP excerpts, per-page provider breakdowns). If required data is not yet slice-backed, document the exception inline and in PR notes instead of normalizing a new direct-read path.
- **`buildSchemaContext` reads must use intelligence slices.** New data sources for schema generation are read via `buildWorkspaceIntelligence({ slices: [...] })` inside `server/helpers.ts:buildSchemaContext`. Direct workspace reads (`ctx.X = ws.Y`) are reserved for identity fields (`name`, `id`, `liveDomain`, `brandLogoUrl`, `siteHasSearch`, plus `siteId`). All other fields must come from a slice. Four remaining direct reads (`businessContext`, `knowledgeBase`, `_businessProfile`, `_personasBlock`) are tracked in `data/roadmap.json:schema-context-builder-pattern-b-migration` for opportunistic migration when adjacent code is touched. Net-new direct reads outside the identity allow-list require an inline `// schema-context-direct-read-ok: <reason>` hatch. Enforced by pr-check rule `schema-context-direct-read-not-on-allowlist`.
- **Long-running admin generation must use the background job platform.** Admin routes that crawl many pages, process many records, call AI repeatedly, or continue after a response must use `server/jobs.ts` / `/api/jobs`, return `{ jobId }`, and surface progress through `useBackgroundTasks` + `TaskPanel`. Job labels and cancellation semantics live in `shared/types/background-jobs.ts`. New job types must be added to `BACKGROUND_JOB_TYPES` with `label`, `cancellable`, and `resultBehavior` (`'ephemeral'` | `'domain-store'` | `'domain-store-and-result'`); use helper functions (`getBackgroundJobLabel`, `isBackgroundJobCancellable`) for safe access. Short synchronous editor assists require an explicit rationale; post-response generation outside the job system is guarded by pr-check with `// background-generation-ok`. Full contract: [docs/rules/background-generation.md](./docs/rules/background-generation.md).
- **Admin send convention** — all admin "send to client" surfaces use a single "Send to client" button + optional inline note field. Never add "Send for Review" or "Flag for Client" as separate buttons — enforced by pr-check rule `send-for-review-anti-pattern`. See `docs/workflows/ui-vocabulary.md` §Admin Send Convention.
- **Inbox section routing** — client actions and approval batches without a note route to Decisions; with a note they route to Conversations. Reviews are static (content briefs, posts, copy pipeline). Full routing rules in `docs/rules/inbox-section-routing.md`. Enforced by pr-check rules `inbox-legacy-filter-literal` and `inbox-action-queue-strip`.

> **Mechanized enforcement.** Many rules above (and every silent-failure rule removed from this section during the pr-check audit) are now enforced by `scripts/pr-check.ts`. The canonical list with escape hatches lives in [docs/rules/automated-rules.md](./docs/rules/automated-rules.md) — do not duplicate them here.

---

## Test Conventions (mandatory for feature work)

- **Write tests alongside code** — new routes need integration tests, new state transitions need guard tests, new shared type fields need contract tests. Use the existing infrastructure; don't hand-roll mocks when a factory exists.
- **Test infrastructure** — mock factories in `tests/mocks/` (webflow, stripe, openai, anthropic, google, semrush), seed fixtures in `tests/fixtures/` (workspace-seed, auth-seed, content-seed, approval-seed), HTTP test helper `createTestContext(port)` in `tests/integration/helpers.ts`.
- **Port uniqueness** — each integration test file using `createTestContext()` must use a unique port. Check existing ports with `grep -r 'createTestContext(' tests/` before allocating. Current range: 13201–13899.
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
| `docs/PLAN_WRITING_GUIDE.md` | **Writing plans** — parallel agents, platform-appropriate model assignments, PR gates, testing, verification |
| `docs/workflows/use-primitives.md` | When and how to use UI primitives |
| `docs/workflows/ui-vocabulary.md` | Canonical labels for buttons, badges, status text |
| `docs/workflows/feature-integration.md` | Connecting features together |
| `docs/workflows/feature-shipped.md` | 9-step post-ship checklist |
| `docs/workflows/platform-golden-paths.md` | Golden-path templates for admin CRUD, client-visible, background job, AI generation, analytics, and inbox work |
| `docs/workflows/pr-readiness-checklist.md` | Pre-PR platform health checklist for context ownership, read paths, broadcasts, logging, tests, and verification |
| `docs/workflows/wiring-patterns.md` | Adding data sources to chat/strategy/briefs |
| `docs/workflows/stripe-integration.md` | Payment architecture |
| `docs/workflows/auth-system.md` | Auth architecture and flows |
| `docs/workflows/new-feature-checklist.md` | Before/during/after feature implementation |
| `docs/workflows/deploy.md` | Commit, push, verify deploy (staging → main flow) |
| `docs/workflows/staging-environment.md` | Staging URLs, DB sync, feature flags, env vars |
| `docs/rules/automated-rules.md` | **Generated** table of every rule enforced by `scripts/pr-check.ts` |
| `docs/rules/pr-check-rule-authoring.md` | How to add a new mechanized rule (when to do it, how to write the regex/customCheck, how to test it) |
| `docs/rules/data-flow.md` | Data flow consistency rules (detailed) |
| `docs/rules/ui-ux-consistency.md` | UI/UX consistency rules (detailed) |
| `docs/rules/analytics-insights.md` | Insight type registration, enrichment contracts, anomaly dedup, phase gates |
| `docs/rules/bridge-authoring.md` | Insight bridge rules (stale-cleanup immunity, score adjustments, broadcast, resolution respect) |
| `docs/rules/route-removal-checklist.md` | Seven update sites when removing or renaming a `Page` value |
| `docs/rules/multi-agent-coordination.md` | Parallel agent protocol, file ownership, cross-phase contracts, spec-plan sync |
| `docs/rules/ai-dispatch-patterns.md` | AI-call-before-DB-write race, transaction guards, retry-on-unique patterns |
| `docs/rules/ai-operation-contracts.md` | Named operation registry + structured-output validation rules for high-value AI callers |
| `docs/rules/ai-quality-evals.md` | Deterministic AI quality eval fixture contracts, soft-gate policy, and live-model eval boundary |
| `docs/rules/development-patterns.md` | Operational patterns — React Query hooks, WebSocket wiring checklist, route templates, DB query patterns, auth decision tree, feature flag lifecycle, testing quick reference |
| `docs/rules/rich-text-content.md` | TipTap content invariants — HTML word-count helpers, sanitize-on-public-boundary trust model, `useAutoSave` shared-timer contract, RichTextEditor focus-guard pattern, side-effect coalescing |
| `docs/rules/content-quality-grounding.md` | Research-mode and provenance contracts for factual content generation and post review |
| `docs/testing-plan.md` | Test strategy, failure mode catalog, coverage gaps, infrastructure |
| `AI_CHATBOT_ROADMAP.md` | Client AI advisor roadmap — chat feature phases, upgrade hooks, proactive insights spec |
| `GLOSSARY.md` | Domain terminology — Activity Log, Approval Batch, Blueprint, Insight, Playbook, etc. |
| `docs/rules/background-generation.md` | Full background job platform contract — when to use it, worker patterns, pr-check escape hatch |
| `docs/rules/inbox-section-routing.md` | Inbox section routing rules — Decisions vs Conversations vs Reviews routing logic |
| `docs/rules/seo-editor-write-targets.md` | SEO Editor static/CMS/manual write-target contract |
| `docs/rules/brand-engine.md` | Copy & Brand Engine contracts — voice profile, brandscript, prompt assembly patterns |
| `docs/rules/intelligence-consumer-builders.md` | Allowed patterns for server-side AI/recommendation consumers of workspace intelligence |
| `docs/rules/workspace-intelligence.md` | Intelligence slice architecture — `assemble*()` functions, slice interfaces, token budget |
| `docs/rules/outcome-learning-default-path.md` | Outcome learnings availability + scoring contract for builder-backed recommendation/content paths |
| `docs/rules/platform-organization.md` | Bounded-context ownership, route-to-service extraction, and safe organization/refactor rules |
| `docs/rules/platform-integration-surfaces.md` | Integration surfaces by bounded context — external APIs, DB/storage, AI calls, jobs, events, query keys, endpoints, activity types |
| `docs/testing/platform-domain-smoke-matrix.md` | Fast smoke-test matrix by bounded context |
| `docs/workflows/feature-class-definition-of-done.md` | Completion gates by feature class before PR closeout |
| `docs/workflows/client-debug.md` | Debugging client-reported bugs — gather context, investigate data/UI/API/CMS issues |
| `docs/workflows/local-dev-onboarding.md` | First-hour setup — env, `seed:demo`, `smoke:core`, fixture workspaces, demo client passwords |
| `docs/workflows/codebase-overview.md` | Quick architecture orientation — bounded contexts, route module counts, forward-looking file placement |
| `docs/workflows/adr-log.md` | Lightweight ADR workflow — when to write an ADR, how to verify `docs/adr/` log stays current |
| `docs/workflows/platform-health-cadence.md` | Recurring 4–6 sprint platform health checkpoint contract and measurable dimensions |
| `docs/workflows/release-safety.md` | Pre-release safety checklist — feature flag audit, coverage ratchet, staging merge integrity |
| `docs/rules/deprecation-lifecycle.md` | Deprecation lifecycle taxonomy (`deprecated` → `hidden` → `migrated` → `removed`) and contract requirements |
| `docs/rules/feature-flag-lifecycle.md` | Feature flag lifecycle — creation, rollout targets, stale audit cadence, removal conditions |
| `docs/rules/keyword-command-center.md` | Keyword Command Center contracts — cheap vs Evaluated variant split, OOM guard |
| `docs/rules/local-seo-visibility.md` | Local SEO visibility contracts — location backfill queue, keyword enrichment, market primary |
| `docs/rules/evidence-ledger-mvp.md` | Content review evidence ledger — grounding provenance, freshness scoring, provenance flags |
| `docs/testing/coverage-ratchet-ci.md` | Coverage ratchet CI contract — current baselines, how to update, how to investigate regressions |
| `docs/testing/critical-domain-coverage-baseline.md` | Critical-domain coverage baseline — minimum acceptable percentages per bounded context |
| `docs/testing/ai-reliability-pipeline-trace-map.md` | AI reliability pipeline — fixture registry, trace map, soft-gate policy |
| `docs/adr/` | Architecture decision records — 0001 background jobs, 0002 intelligence slices, 0003 feature flags, 0004 client/admin split, 0005 unified AI dispatch, 0006 bounded context extraction |

---

## Parallel Agent Coordination & Planning (mandatory)

> Full reference: `docs/PLAN_WRITING_GUIDE.md` + `docs/rules/multi-agent-coordination.md`

**Before dispatching subagents:** pre-commit shared contracts (types, function signatures, barrel exports, migrations), assign exclusive file ownership per task, and schedule a diff review checkpoint after every batch (git diff, grep duplicates, tsc, full test suite). Dispatch prompts must include app-level context: rate limiters, React Query caches, WS events, current conditional rendering state.

**Every implementation plan must include:** task dependency graph, platform-appropriate model assignments, file ownership per parallel task, systemic improvements (shared utilities, pr-check rules, new tests), feature-class definition-of-done gates, and a verification strategy with specific commands. Name the active agent platform in the plan: Codex/OpenAI plans use `GPT-5.4-Mini` for mechanical cleanup, `GPT-5.4` for implementation with local judgment, and `GPT-5.5` for complex cross-context work and review; Claude/Anthropic plans use the corresponding `Haiku`/`Sonnet`/`Opus` ladder. For refactoring/migration/audit work, run `pre-plan-audit` before writing the plan.

---

## Quality Gates

Work is not done until ALL pass:

- [ ] `npm run typecheck` — zero errors (uses `tsc -b` for project-aware checking)
- [ ] `npx vite build` — builds successfully
- [ ] `npx vitest run` — full test suite passes (not just new tests)
- [ ] `FEATURE_AUDIT.md` updated (if feature work)
- [ ] `data/roadmap.json` updated (if roadmap item)
- [ ] `BRAND_DESIGN_LANGUAGE.md` updated (if UI changed)
- [ ] No `violet` or `indigo` in `src/components/`
- [ ] `npx tsx scripts/pr-check.ts` — zero errors
- [ ] If multiple/parallel agents were used for any part of this work: invoke `scaled-code-review` skill before merging. Fix Critical/Important issues before proceeding. (Single-agent work on a single domain: `superpowers:requesting-code-review` is sufficient.)
- [ ] All bugs surfaced during review are fixed — never dismiss a fixable bug as "pre-existing", "minor", or "out of scope". If a review agent or manual review finds it and it can be fixed, fix it in this PR.
- [ ] If multi-phase feature: this PR covers exactly one phase. Phase N+1 is not started until phase N is merged and green.
- [ ] `npm run verify:feature-flags` — no orphaned or ungrouped feature flag keys
- [ ] `npm run verify:coverage-ratchet` — coverage has not regressed below ratchet baseline
