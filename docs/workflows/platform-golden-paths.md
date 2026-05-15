---
description: Golden-path implementation templates for the platform's most common feature classes
---

# Platform Golden Paths

Use these templates when scoping a new feature or substantial enhancement. Each feature must name one owning bounded context from `docs/rules/platform-organization.md`, check the context's surfaces in `docs/rules/platform-integration-surfaces.md`, then wire shared contracts, routes, hooks, invalidation, and tests inside that context. Before closeout, confirm the matching gates in `docs/workflows/feature-class-definition-of-done.md`.

## How to use this doc

1. Pick the closest feature class below.
2. Fill in the placeholders before writing implementation code.
3. If the feature spans contexts, name the primary owner and secondary integrations up front.
4. Copy the completed template into your plan or PR description.

---

## 1. Admin CRUD Feature

Use for admin-only create/update/delete flows such as settings editors, internal tables, or workspace management tools.

**Owning bounded context**
- Primary owner: `[context-name]`
- Secondary integrations: `[none | list]`
- Behavior type: `[new behavior | behavior-preserving extraction | both]`

**Shared types**
- Add or update `shared/types/[domain].ts` for request/response shapes.
- If a DB JSON column is involved, define the stored shape before wiring routes.
- If the entity is workspace-scoped, include `workspaceId` in the contract where appropriate.

**API / hooks / query keys**
- Route adapter: `server/routes/[domain].ts`
- Domain behavior: `server/domains/[domain]/` or established server module
- API wrapper: `src/api/[domain].ts`
- Admin hooks: `src/hooks/admin/use[Domain].ts`
- Query keys: add `queryKeys.admin.[domain]...` entries in `src/lib/queryKeys.ts`

**Broadcasts / listeners**
- If admin-only and not visible in client views, still decide whether admin-global or workspace-scoped real-time updates are needed.
- Workspace-scoped writes: `broadcastToWorkspace(workspaceId, WS_EVENTS.[EVENT], payload)`
- Register new constants in `server/ws-events.ts` and mirror in `src/lib/wsEvents.ts`
- Frontend listener: `useWorkspaceEvents(workspaceId, { [WS_EVENTS.EVENT]: ...invalidate... })`

**Activity logging**
- Call `addActivity()` for meaningful create/update/delete actions.
- Delete flows must read before delete so the log and broadcast payload have stable context.
- For repeated workspace-scoped write lifecycles, prefer `runWorkspaceMutation()` (`server/routes/workspace-mutation-helper.ts`) to keep read-before-write, transaction, mapped error, activity, and broadcast steps consistent.

**Tests**
- Integration: route read/write coverage in `tests/integration/[domain].test.ts`
- Contract: shared-type or event-wiring assertions in `tests/contract/[domain].test.ts`
- Include mutation + subsequent read assertions, not just 200 status checks.

**Docs**
- Update any workflow/rules doc if the feature introduces a new reusable pattern.
- Update `FEATURE_AUDIT.md` only if this is a real feature users or operators will rely on.

**Verification**
- `npm run typecheck`
- `npx vite build`
- `npx vitest run`
- `npx tsx scripts/pr-check.ts`

---

## 2. Client-Visible Feature

Use for anything that changes the client portal, public workspace API, tier-gated views, or client-facing copy/data.

**Owning bounded context**
- Primary owner: `[client-portal | inbox | analytics-intelligence | ...]`
- Secondary integrations: `[admin tab, billing, intelligence slices, etc.]`
- Client narrative placement: `[Data | Diagnosis | Plan | Action]`

**Shared types**
- Define client-facing response types in `shared/types/[domain].ts`
- If using a public endpoint, make the serialized shape explicit and client-safe
- Add feature-flag types first if the work is phased or dark-launched

**API / hooks / query keys**
- Public/admin route surface: `server/routes/[domain].ts` or existing route module
- API wrapper: `src/api/[domain].ts`
- Client hook: `src/hooks/client/useClient[Domain].ts`
- Admin hook if mirrored: `src/hooks/admin/use[Domain].ts`
- Query keys: `queryKeys.client.[domain]...` and paired admin keys if both sides render the data

**Broadcasts / listeners**
- Every workspace-scoped write that affects the client must call `broadcastToWorkspace()`
- Both halves must exist:
  - server event via `WS_EVENTS`
  - client/admin `useWorkspaceEvents` invalidation
- If the feature updates workspace metadata, also account for `workspace:updated`

**Activity logging**
- Log meaningful client-visible actions, especially approvals, requests, content changes, and state transitions
- If the feature is public-portal writable, confirm the log appears on the actual path users trigger

**Tests**
- Integration must hit the actual client read path, especially `GET /api/public/workspace/:id` when relevant
- Component or contract coverage for tab routing, tier gating, and empty/error states as needed
- Add WebSocket invalidation assertions if the UI depends on real-time refresh

**Docs**
- Update `FEATURE_AUDIT.md` for shipped client-visible capabilities
- Update `BRAND_DESIGN_LANGUAGE.md` if client UI patterns, colors, or primitives change
- Update `data/features.json` if this is sales-relevant

**Verification**
- `npm run typecheck`
- `npx vite build`
- `npx vitest run`
- `npx tsx scripts/pr-check.ts`
- Manual client-path check on the receiving route, including any `?tab=` deep link

---

## 3. Background Job Feature

Use for long-running admin generation, bulk processing, crawls, or work that continues after the HTTP response.

**Owning bounded context**
- Primary owner: `[context-name]`
- Secondary integrations: `[jobs platform, client portal, intelligence, etc.]`
- Trigger surface: `[admin page / API endpoint / scheduled task]`

**Shared types**
- Add the job type to `shared/types/background-jobs.ts` with:
  - `BACKGROUND_JOB_TYPES`
  - label / cancellable / `resultBehavior`
- Add or update domain result types in `shared/types/[domain].ts`

**API / hooks / query keys**
- Entry route returns `{ jobId }` via `/api/jobs` platform flow
- Domain logic persists results in the owning context, not inside the route handler
- Frontend job tracking uses existing background-task hooks/components (`useBackgroundTasks`, `TaskPanel`)
- Query keys: add domain-specific invalidation targets in `src/lib/queryKeys.ts`

**Broadcasts / listeners**
- Broadcast when durable domain state changes, not for every internal worker step unless the UI needs it
- Track progress through the jobs platform; track data freshness through `useWorkspaceEvents`
- Register any new workspace event in `server/ws-events.ts` and frontend mirror

**Activity logging**
- Log job start/completion/failure when the outcome matters to workspace history
- Keep labels consistent with `BACKGROUND_JOB_TYPES` metadata

**Tests**
- Contract test for job registration / task panel wiring
- Integration test for entry route returning `{ jobId }`
- Integration or contract coverage for the eventual read path after job completion
- Failure-path coverage for external API errors or cancellation when supported

**Docs**
- Update `docs/rules/background-generation.md` only if the platform contract changes
- Update product-facing docs only if the resulting capability is user-visible

**Verification**
- `npm run typecheck`
- `npx vite build`
- `npx vitest run`
- `npx tsx scripts/pr-check.ts`
- Manual check that the task appears in the task UI and the resulting domain data refreshes without reload

---

## 4. AI Generation Feature

Use for generation, rewriting, summarization, classification, or AI-assisted editorial flows.

**Owning bounded context**
- Primary owner: `[brand-engine | content-pipeline | schema | seo-health | ...]`
- Secondary integrations: `[intelligence, inbox, background jobs, public rendering]`
- Output contract: `[plain prose | markdown | JSON | HTML]`

**Shared types**
- Define request/result types in `shared/types/[domain].ts`
- If AI output is stored, type the stored shape explicitly
- If the prompt depends on authority-layered fields, expose the resolved representation rather than raw + formatter helpers

**API / hooks / query keys**
- Prefer `callAI()` in `server/ai.ts` for new code
- Route adapter handles validation, auth, and response shaping; domain module owns prompt/data orchestration
- Add admin/client hooks and query keys only for persisted outputs or reusable fetches

**Broadcasts / listeners**
- If generated output changes workspace-visible state, broadcast after persistence
- Listener invalidates the rendered data query, not just a parent dashboard key
- If this writes into inbox/review surfaces, also invalidate the downstream inbox queries

**Activity logging**
- Log meaningful generation events (started, generated, approved, published) where users or operators need auditability
- If generation can fail due to external services, cover the failure path in logs/tests

**Tests**
- Integration coverage for the route and saved output shape
- Contract coverage for prompt/rendering alignment when formatting is strict
- If client-visible, verify the actual public read path or rendered consumer
- Add failure-path tests for provider errors and malformed output parsing

**Docs**
- Update workflow docs when introducing a new AI wiring pattern
- Update brand/content-quality docs when the output contract or evidence requirements change

**Verification**
- `npm run typecheck`
- `npx vite build`
- `npx vitest run`
- `npx tsx scripts/pr-check.ts`
- Manual prompt/output smoke test confirming the frontend consumes the exact returned format

---

## 5. Analytics / Intelligence Feature

Use for new insight types, intelligence slices, anomaly-style analytics, or workspace context consumed by AI and reporting.

**Owning bounded context**
- Primary owner: `analytics-intelligence`
- Secondary integrations: `[client-portal, seo-health, outcomes-roi, admin chat, etc.]`
- Data source owner: `[table/store/module]`

**Shared types**
- Add or update `shared/types/analytics.ts` or `shared/types/intelligence.ts`
- New `InsightType` work must ship lockstep:
  - union value
  - typed data interface + `InsightDataMap`
  - server schema
  - frontend renderer
- New intelligence source must extend the correct slice interface first

**API / hooks / query keys**
- Use `server/intelligence/<name>-slice.ts` + `buildWorkspaceIntelligence()` for new workspace intelligence reads
- Add domain-specific API wrappers and hooks if the feature has direct UI surfaces
- Add `queryKeys.admin.intelligence...`, `queryKeys.client.intelligence...`, or more specific keys as needed

**Broadcasts / listeners**
- Broadcast after writes to analytics state that drives UI or AI context
- Use `useWorkspaceEvents` listeners to invalidate the exact intelligence or insights queries
- If cache invalidation is part of the server flow, make it explicit in both the server and listener coverage

**Activity logging**
- Log only user-meaningful analytics milestones, not every internal recomputation
- Positive/negative trend detections and operator actions usually merit activity entries

**Tests**
- Contract test for lockstep registration or slice wiring
- Integration test for the actual read path used by the UI or AI context
- If enrichment/fallback logic exists, cover degraded inputs explicitly

**Docs**
- Update analytics/intelligence rules docs when the feature changes registration or slice contracts
- Update `FEATURE_AUDIT.md` if this creates a surfaced product capability

**Verification**
- `npm run typecheck`
- `npx vite build`
- `npx vitest run`
- `npx tsx scripts/pr-check.ts`
- Manual check that the surfaced insight/intelligence data appears in the consuming admin/client view

---

## 6. Approval / Inbox Feature

Use for approval batches, client actions, inbox routing, review flows, and decisions/conversations/reviews UX.

**Owning bounded context**
- Primary owner: `inbox`
- Secondary integrations: `[client-portal, content-pipeline, brand-engine, schema, approvals]`
- Inbox destination: `[decisions | conversations | reviews]`

**Shared types**
- Use `shared/types/decision.ts` `NormalizedDecision` for any mixed approval/action rendering
- Add/update shared request/response contracts for approval entities in `shared/types/[domain].ts`
- If statuses change, update the relevant state machine rules before wiring the route

**API / hooks / query keys**
- Route adapters usually live in approval/request/content domain routes
- Add or update both admin and client hooks when both sides render the queue
- Query keys often include:
  - `queryKeys.admin.approvals(...)`
  - `queryKeys.admin.clientActions(...)`
  - `queryKeys.client.approvals(...)`
  - `queryKeys.client.clientActions(...)`
  - any derived inbox-specific keys

**Broadcasts / listeners**
- Approval/inbox writes must broadcast with `WS_EVENTS` constants
- Client and admin listeners both need `useWorkspaceEvents` invalidation
- Preserve the `?tab=` deep-link two-halves contract when adding new inbox routing entry points

**Activity logging**
- Log approval applied/reverted/requested-changes and equivalent user-visible decision events
- Read before delete so deleted items still produce correct log context

**Tests**
- Integration coverage for create/update/apply/delete flows
- State-machine guard tests for status transitions
- Client read-path or inbox-render tests for the actual destination section
- WebSocket pairing/invalidation coverage if a new event is introduced

**Docs**
- Update inbox routing docs when section-placement rules change
- Update `FEATURE_AUDIT.md` if the inbox capability changed materially for users

**Verification**
- `npm run typecheck`
- `npx vite build`
- `npx vitest run`
- `npx tsx scripts/pr-check.ts`
- Manual check of Decisions / Conversations / Reviews placement and any linked modal/deep-link flow
