---
description: Final PR gate for context ownership, data-flow completeness, and read-path verification
---

# PR Readiness Checklist

Run this before opening a PR or marking a phase complete. This checklist is intentionally biased toward the platform's silent-failure risks: wrong context placement, missing invalidation, missing broadcasts, missing activity logs, and tests that never hit the real consumer.

## 1. Ownership and scope

- [ ] The PR names one owning bounded context from `docs/rules/platform-organization.md`
- [ ] Any secondary integrations are listed explicitly in the PR description or plan
- [ ] The owning context's surfaces were checked in `docs/rules/platform-integration-surfaces.md`
- [ ] The applicable feature-class gates from `docs/workflows/feature-class-definition-of-done.md` are satisfied or explicitly not applicable
- [ ] If this PR promotes/demotes a major surface, include a completed maturity scorecard from `docs/workflows/feature-maturity-scorecard.md`
- [ ] Shared coordination files touched (`server/app.ts`, `src/routes.ts`, `server/ws-events.ts`, `src/lib/queryKeys.ts`, shared barrels) are necessary, not incidental
- [ ] If the work is phased, this PR covers exactly one phase and the feature flag/shared contract changes for that phase are complete

## 2. Public and client exposure

- [ ] I identified whether the change is admin-only, client-visible, public-portal visible, or shared
- [ ] Any client-visible field is serialized on the actual client/public read path, not just the admin path
- [ ] Tier gating, feature flags, and client-facing copy are wired where applicable
- [ ] If the feature navigates with `?tab=`, the receiving component reads the search param and initializes from it

## 3. API, hooks, and query keys

- [ ] Typed request/response contracts exist in `shared/types/` for new boundary shapes
- [ ] API wrappers live in `src/api/[domain].ts` rather than ad hoc fetches in components
- [ ] Hooks exist in the owning admin/client hook area for all new data flows
- [ ] Query keys were added to `src/lib/queryKeys.ts`
- [ ] Mutations invalidate the exact query keys the consuming UI reads

## 4. WebSocket broadcast and listener completeness

- [ ] Every workspace-scoped mutation that changes visible state calls `broadcastToWorkspace()`
- [ ] New event names were added to `server/ws-events.ts` and mirrored in `src/lib/wsEvents.ts`
- [ ] The frontend listens with `useWorkspaceEvents`, not `useGlobalAdminEvents`, for workspace-scoped events
- [ ] The event listener invalidates/refetches the query actually consumed by the UI
- [ ] If both admin and client can mutate the data, both write paths broadcast the same event contract

## 5. Activity logging and state transitions

- [ ] Significant user-visible or operator-meaningful mutations call `addActivity()`
- [ ] Delete flows read the record before delete when log or broadcast context depends on it
- [ ] Any status mutation uses the relevant state machine validation
- [ ] Background jobs or AI flows log the milestones that matter to user/operator history

## 6. Actual read-path tests

- [ ] Tests cover the route/component that really consumes the data, not a nearby surrogate
- [ ] Client-visible fields are tested through the public/client read path when applicable
- [ ] New WebSocket events or invalidation paths have integration/contract coverage where the feature depends on them
- [ ] Failure paths are covered for external APIs, AI providers, or job execution when applicable
- [ ] If the feature adds a new shared type/event/insight/job contract, there is at least one contract-style assertion guarding it

## 7. Docs and rollout notes

- [ ] Workflow/rules docs were updated if this PR introduces a reusable pattern or contract change
- [ ] `FEATURE_AUDIT.md` is updated if the change is a real shipped capability
- [ ] `BRAND_DESIGN_LANGUAGE.md` is updated if UI patterns/colors changed
- [ ] `data/features.json` is updated if the feature is client-impactful or sales-relevant

## 8. Verification commands

Run the standard gates:

```bash
npm run typecheck
npx vite build
npx vitest run
npx tsx scripts/pr-check.ts
```

Optional but commonly needed:

```bash
grep -r "createTestContext(" tests/
grep -r "violet\\|indigo" src/components/
```

## 9. PR closeout prompts

Answer these before you hit "ready for review":

1. What is the owning bounded context, and why does this code belong there?
2. Which query keys does the UI read, and what invalidates them?
3. Which WebSocket event completes the feedback loop?
4. Which test proves the actual client/admin consumer can read the new state?
5. What verification commands passed locally?
