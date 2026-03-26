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

### After completing a task

Every completed task must include:

1. **`FEATURE_AUDIT.md`** — add new entries or update existing ones for any feature work.
2. **`data/roadmap.json`** — mark completed items `"pending"` → `"done"`, add `"notes"`. Run `npx tsx scripts/sort-roadmap.ts`.
3. **`BRAND_DESIGN_LANGUAGE.md`** — update if any UI colors/components/patterns changed.
4. **Build verify** — `npx tsc --noEmit --skipLibCheck && npx vite build`
5. **Summarize** — what was done, what docs updated, what's next.

### Decision framework

| Situation | Action |
|-----------|--------|
| Clear, specific task | Proceed. Implement fully. |
| Ambiguous but low-risk (styling, docs) | Proceed with best judgment, explain. |
| Multiple directions (architecture, new feature) | Present 2-3 options with tradeoffs. |
| Conflicts with existing patterns | Flag conflict, recommend pattern-consistent approach. |
| Unsure if something exists | Search first, then proceed. |
| Pre-existing lint errors | Check Known Issues below. If listed, ignore. If new, fix only if caused by your changes. |

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

## UI/UX Rules (mandatory)

1. **Always use shared primitives** from `src/components/ui/` before creating new components.
2. **Loading states** — use contextual messages ("Analyzing site health..." not "Loading..."). Use `<Skeleton>` for layout-preserving shimmer.
3. **Empty states** — always action-oriented with a CTA using `<EmptyState>`.
4. **Error handling** — wrap major sections in `<ErrorBoundary>`. Show empathetic messages with retry.
5. **Mobile-first** — responsive design, test at mobile breakpoints.
6. **Color coding** — follow the Three Laws strictly.
7. **Accessibility** — proper ARIA labels, keyboard navigation, focus management.
8. **Progressive disclosure** — show summary first, details on demand.

---

## Code Conventions

- **TypeScript strict** — no `any` unless unavoidable
- **API error shape**: `{ error: string }` consistently
- **User-facing strings**: follow `.windsurf/workflows/ui-vocabulary.md` canonical labels
- **Route validation**: Zod schemas via `validate()` middleware, not hand-written checks
- **Frontend data**: all hooks use `useQuery`/`useMutation`. No hand-rolled `useState`+`useEffect`+fetch patterns. Query keys: `admin-*` / `client-*` prefixes.
- **DB patterns**: lazy prepared statements, JSON columns as TEXT parsed at read boundary, `rowToX()` mappers, three-state booleans (0/1/NULL)
- **Large edits**: break into multiple smaller edits if > 300 lines

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
| `.windsurf/workflows/deploy.md` | Commit, push, verify deploy |
| `.windsurf/rules/data-flow.md` | Data flow consistency rules (detailed) |
| `.windsurf/rules/ui-ux-consistency.md` | UI/UX consistency rules (detailed) |

---

## Known Issues to Ignore

These pre-existing lint warnings are not caused by current work:

- **`ClientDashboard.tsx`**: `requestingTopic` declared but never read; `useEffect` missing dependencies (intentional fire-once)
- **`ContentPipeline.tsx`**: `useEffect` with `fetchSummary` callback dependency

Do not fix during unrelated tasks.

---

## Quality Gates

Work is not done until ALL pass:

- [ ] `npx tsc --noEmit --skipLibCheck` — zero errors
- [ ] `npx vite build` — builds successfully
- [ ] `FEATURE_AUDIT.md` updated (if feature work)
- [ ] `data/roadmap.json` updated (if roadmap item)
- [ ] `BRAND_DESIGN_LANGUAGE.md` updated (if UI changed)
- [ ] No `violet` or `indigo` in `src/components/`
