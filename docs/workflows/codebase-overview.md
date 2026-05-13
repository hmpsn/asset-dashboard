---
description: Understand the asset-dashboard codebase architecture, key files, and how features connect
---

# Codebase Overview

`asset-dashboard` is the hmpsn.studio SEO/web analytics agency platform. It combines a React 19 + Vite 8 + TailwindCSS 4 frontend with an Express + TypeScript backend and SQLite storage via `better-sqlite3`.

This document is a quick orientation guide. For ownership and implementation placement, use the canonical platform-health docs:

- `docs/rules/platform-organization.md` — bounded-context ownership map.
- `docs/rules/platform-integration-surfaces.md` — integration surfaces that tend to break together.
- `docs/testing/platform-domain-smoke-matrix.md` — fast smoke signal per bounded context.
- `docs/testing/critical-domain-coverage-baseline.md` — current critical-domain coverage baseline.
- `docs/workflows/feature-class-definition-of-done.md` — completion gates by feature class.

## Current Shape

- **Frontend:** React 19, Vite 8, React Router DOM 7, TailwindCSS 4. Routes and tab helpers live in `src/routes.ts`.
- **Backend:** Express app factory in `server/app.ts`; process startup in `server/index.ts`.
- **Routes:** 87 route modules in `server/routes/` plus route groups in `server/route-groups/`.
- **Storage:** SQLite in WAL mode with foreign keys on; 95 migrations in `server/db/migrations/`.
- **API wrappers:** 16 typed modules in `src/api/`. Components should use wrappers/hooks, not raw `fetch()`.
- **Hooks:** React Query hooks in `src/hooks/admin/` and `src/hooks/client/`.
- **Shared types:** 36 shared modules in `shared/types/`.
- **Tests:** 563 test files in `tests/` plus `server/__tests__`, with unit, integration, contract, component, and E2E coverage.

## Runtime Architecture

The backend is a single Express app with route modules grouped by bounded context. Most route files are HTTP adapters around existing domain modules; new reusable business logic should prefer context-owned modules or `server/domains/<domain>/` when extracting from overloaded routes.

The frontend is route/tab based rather than feature-folder complete. New work should still follow bounded-context placement:

```txt
shared/types/<domain>.ts
src/api/<domain>.ts
src/hooks/admin/use<Domain>.ts
src/hooks/client/useClient<Domain>.ts
src/components/<domain>/
server/routes/<domain>.ts
server/domains/<domain>/
tests/integration/<domain>.test.ts
tests/contract/<domain>.test.ts
docs/rules/<domain>.md
```

That shape is forward-looking. Do not move old files purely for tidiness.

## Canonical Bounded Contexts

Every meaningful feature should name one primary owner:

- `workspace-command-center`
- `client-portal`
- `inbox`
- `content-pipeline`
- `schema`
- `seo-health`
- `analytics-intelligence`
- `brand-engine`
- `outcomes-roi`
- `billing-monetization`
- `integrations`
- `platform-foundation`

Cross-context work should name one primary owner, secondary integrations, and any shared coordination files.

## Shared Coordination Files

These files are not owned by one feature context and should be touched deliberately:

- `server/app.ts`, `server/index.ts`
- `server/ws-events.ts`, `server/broadcast.ts`, `server/websocket.ts`, `src/lib/wsEvents.ts`
- `src/routes.ts`, `src/lib/client-dashboard-tab.ts`
- `src/lib/queryKeys.ts`, `src/lib/queryClient.ts`
- `shared/types/index.ts`
- `server/middleware/validate.ts`, `server/auth.ts`, `server/middleware.ts`, `server/state-machines.ts`
- `server/jobs.ts`, `shared/types/background-jobs.ts`

When a plan touches these, call out the blast radius and verification commands.

## Data And AI Flow

- **Data fetching:** React Query is the frontend data layer. Admin hooks live in `src/hooks/admin/`; client hooks live in `src/hooks/client/`.
- **API boundaries:** Typed wrappers in `src/api/` are the frontend boundary. Avoid raw component-level `fetch()`.
- **Shared contracts:** Cross-layer shapes belong in `shared/types/` before implementation.
- **WebSocket updates:** Workspace-scoped writes should broadcast via `broadcastToWorkspace()` using constants from `server/ws-events.ts`, and frontend consumers should invalidate relevant React Query keys with `useWorkspaceEvents()`.
- **AI dispatch:** New AI calls should prefer `callAI()` in `server/ai.ts`. Direct provider helpers exist for legacy and specialized cases: `callOpenAI()` in `server/openai-helpers.ts`, `callAnthropic()` in `server/anthropic-helpers.ts`.
- **Long-running generation:** Crawls, batch processing, repeated AI calls, or post-response work should use the background job platform in `server/jobs.ts` and `/api/jobs`.

## Testing And Verification

Use the smallest meaningful test that exercises the actual read/write path:

- Unit tests for pure helpers and state machines.
- Contract tests for shared types, query/event wiring, and public/client serialization.
- Integration tests for route handlers and DB-backed behavior.
- Component/workflow tests for client/admin UI flows.
- E2E tests for golden journeys that cross admin, client, billing, or background jobs.

Current coverage posture is tracked in `docs/testing/critical-domain-coverage-baseline.md`. The first target is critical-domain confidence, not immediate global 80-90% coverage.

Common verification commands:

```bash
npm run typecheck
npx tsx scripts/pr-check.ts
npx vite build
npx vitest run
npm run verify:organization
npm run verify:coverage-baseline
```

## Monetization And Client Surface

The platform uses Stripe Checkout, workspace tiers, trials, content purchases, and soft client gating through shared monetization components. Billing work belongs to `billing-monetization`; client-facing tier visibility also touches `client-portal`.

Client-facing product work must preserve the narrative arc:

1. Insights
2. Performance
3. Site Health
4. Strategy
5. Inbox
6. Plans
7. ROI

## Historical Docs

Older plans and audits under `docs/superpowers/` are useful history, but they are not current ownership authority. Prefer `docs/rules/platform-organization.md`, `docs/rules/platform-integration-surfaces.md`, and the Wave 2 platform-health reports when planning new work.
