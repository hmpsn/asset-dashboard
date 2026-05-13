# Platform Organization

This platform is organized by layers today, with bounded-context organization emerging over time. The goal is safer product velocity, not cosmetic file movement.

## Bounded Contexts

Every meaningful feature should have one owning bounded context. Current canonical contexts:

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

If a feature genuinely spans contexts, name the primary owner and the secondary integrations. Shared files such as `server/app.ts`, `src/routes.ts`, `server/ws-events.ts`, `src/lib/queryKeys.ts`, and shared type barrels remain coordination points and should be edited deliberately.

## New Work Convention

For new features, or when substantially touching an existing feature, prefer this shape:

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

This is a convention for new and adjacent work, not permission for a whole-repo shuffle.

## Route-To-Service Extraction

Route files should trend toward HTTP adapters: validation, auth, request parsing, response shaping, activity logging, and broadcast calls. Business rules, DB orchestration, AI orchestration, and reusable domain behavior belong in `server/domains/<domain>/` or an already established server module for that context.

When extracting:

- Preserve existing URLs, response shapes, status codes, broadcasts, activity logs, query keys, and tests.
- Move behavior first; rename paths only in a later PR if there is a strong reason.
- Keep one bounded context per PR unless a shared contract change requires a coordinated batch.
- Add or update route read/write contracts for high-churn route files.
- Verify with the relevant integration/contract tests plus `npm run typecheck`, `npx vite build`, and `npx tsx scripts/pr-check.ts`.

## Frontend Decomposition

Large page/tab components should become shells that compose hooks, section components, and shared primitives. Extract behavior-preserving boundaries before visual redesign:

- route/page shell
- data hooks and mutations
- view-model helpers
- repeated section components
- modals/drawers
- shared UI primitives only when at least two call sites need the pattern

Do not mix broad visual redesign with a structural split unless the roadmap item explicitly calls for both.

## API Wrapper Shape

Avoid adding more unrelated methods to catch-all wrappers such as `src/api/misc.ts` or oversized domain wrappers such as `src/api/seo.ts`. New endpoints should prefer a domain-specific API module, with backward-compatible barrel exports where needed.

## Big-Bang Reorganizations

Avoid whole-repo feature-folder migrations. They create high review noise and can break invisible contracts: route paths, public serialization, React Query keys, WebSocket invalidation, feature flags, tests, docs, and AI prompt/rendering contracts.

A broad migration is only acceptable with:

- a pre-plan audit,
- a dependency graph,
- file ownership by context,
- one PR per phase,
- compatibility exports while callers migrate,
- and full verification at each phase boundary.

