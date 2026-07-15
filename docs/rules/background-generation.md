# Background Generation Contracts

Long-running admin generation uses the existing background job platform:

- `server/jobs.ts` owns durable job state.
- `server/routes/jobs.ts` owns the central `/api/jobs` dispatcher.
- Dedicated `server/*-job.ts` worker modules own crawl-heavy or AI-heavy job bodies.
- `src/hooks/useBackgroundTasks.tsx` owns frontend job state and rediscovery.
- `src/components/NotificationBell.tsx` owns the production task surface in the admin shell (TaskPanel was retired).
- `shared/types/background-jobs.ts` owns job type metadata, labels, and cancellation semantics.

Do not add a new queue, ad hoc progress channel, or anonymous fire-and-forget promise for long-running admin generation.

## When A Job Is Required

Use a background job when a route can crawl many pages, process many records, call AI repeatedly, call slow external APIs, or continue after the user leaves the page.

Examples:

- Site audits
- All-site schema generation
- Bulk SEO analysis or rewrites
- Keyword strategy generation
- Bulk content or post generation
- Crawl-heavy workspace profile generation

Single-field editor assists, single-page generation, and interactive chat can stay synchronous when they are explicitly documented as short operations.

## Job Start Contract

Long-running admin generation routes must:

1. Create a job through `createJob(...)`.
2. Respond quickly with `{ jobId }` before expensive work begins.
3. Store durable results in the owning domain table or file, not only in `job.result`.
   Exception: existing review-before-save generators may return a draft in
   `job.result` when auto-saving would overwrite editable workspace context.
   The UI must hydrate that draft from the terminal job and still require the
   existing explicit save action.
4. Update progress with stable `status`, `message`, `progress`, and `total` semantics.
5. Add activity and broadcast domain events when generated data changes. When a
   shared generation service is used by both direct and background paths, log
   activity in that shared service so both paths stay in parity.
6. Register abort handling when the UI offers cancellation, and unregister it
   from the worker `finally` block once the job reaches a terminal state.

On server restart, persisted `pending` or `running` jobs must be marked `error`
with a visible restart-interruption message. Jobs cannot silently remain active
after their worker process is gone.

Cancellation must remain observable after `cancelJob()` is called. Workers that
poll `isJobCancelled(jobId)` must continue to see `true` even if their abort
controller has already been unregistered during cleanup.

## Resource-Scoped Acceptance

Generation jobs that mutate a durable artifact must use a canonical resource
identity. Do not use `hasActiveJob(type, workspaceId)` as the acceptance guard:
it blocks unrelated artifacts and its separate check/create sequence races.

- Insert the generic job, every normalized resource claim, and any domain
  acceptance row or skeleton in one transaction. Update in-memory job state and
  broadcast only after commit.
- Active uniqueness spans job types for `(workspace, resource)`, because review,
  regeneration, and batch jobs can otherwise mutate the same artifact.
- Multi-resource work claims the complete sorted, unique resource set atomically.
  An overlapping copy batch must roll back as a unit; disjoint batches may run.
- A claim conflict returns the owning active job ID and starts no paid work.
- Completion/error releases claims transactionally. Cancellation retains claims
  until the aborting worker reaches `finally`; restart recovery may release them
  after marking the unreachable job terminal.
- Resource identities are trusted domain values, never raw caller-provided keys,
  and are omitted from public/client job payloads.

The SQLite job platform assumes one application process owns a given
`dashboard.db` file. Resource acceptance is DB-atomic, but abort controllers and
worker ownership are process-local. A multi-process deployment must first add an
external queue or durable worker lease/status-CAS contract; do not point multiple
server processes at the same SQLite job ledger.

## Worker Module Contract

`server/routes/jobs.ts` should stay a thin dispatcher. For heavyweight jobs, keep
route-local code limited to validation, job creation, `registerAbort(job.id)`,
the quick `{ jobId }` response, and invoking the worker. Move crawl loops,
provider prefetches, AI calls, persistence, activity logging, cache invalidation,
and terminal cleanup into a dedicated worker module.

Worker modules must preserve existing job semantics: they receive the created
`jobId`, call `updateJob(...)` for progress and terminal state, and call
`unregisterAbort(jobId)` from a `finally` block. Do not import the route module
from a worker.

## Frontend Contract

Admin generation UI must use `useBackgroundTasks()` for job start, progress, cancel, and rediscovery. Feature surfaces may show inline progress, but the inline state should derive from the same job object surfaced through the Notification Hub / `NotificationBell` task feed.

Every new job type must be added to `shared/types/background-jobs.ts` with:

- A human label.
- A concise description.
- Whether cancellation is actually supported.
- Expected result behavior.
- Its job class (`'user'` or `'system'` — see System Job Class below).

## System Job Class

Every entry in `BACKGROUND_JOB_METADATA` carries a `class: 'user' | 'system'`
field. `'system'` means the job type is only ever created by automated
background triggers with no human in the loop. Today the sole `'system'` type is
`INTELLIGENCE_RECOMPUTE`, created exclusively through
`server/intelligence-recompute-job.ts` `enqueueIntelligenceRecompute` (itself
gated behind the `signal-auto-recompute` flag and `hasActiveJob`-deduped).
`enqueueIntelligenceRecompute` is invoked from more than one place, so removing
any single caller does NOT retire the type — the producers are:

- `server/insight-recompute-cron.ts` — the daily activity-gated recompute cron
  (see `server/cron-registry.ts` `insight-recompute` for the scheduler that ticks it).
- `server/rank-tracking-scheduler.ts` — the daily rank-tracking cron, which
  refreshes signals after new rank snapshots land (`server/cron-registry.ts`
  `rank-tracking`).
- `server/keyword-strategy-follow-ons.ts` — an on-mutation follow-on fired after a
  keyword-strategy / content update settles, not a cron.

Every other type defaults to `'user'`. Because the class is a property of the job
TYPE, all of these producer paths are gated identically by the class filter — the
type determines client visibility, not which caller enqueued it.

`isSystemJobType(type)` is the single predicate that reads this field (mirrors
`isBackgroundJobCancellable`). Unknown types default to `false` — the safe
direction, since hiding an unrecognized job from the admin feed would be a
silent visibility regression.

**Client-facing job feeds must exclude system-class jobs.** A nightly cron run
must never appear in a client's task panel. This is enforced at the query
level, the narrowest correct point:

- `server/routes/jobs.ts` `isClientVisibleJob()` — gates `GET /api/public/jobs/:workspaceId`
  (consumed by `src/hooks/client/useClientWorkFeed.ts` → `AgencyWorkFeed.tsx`).
- `server/websocket.ts` `resolveJobDelivery()` — gates the unauthenticated/client
  WebSocket delivery path for `JOB_CREATED`/`JOB_UPDATED`.

Both call sites already gate on a `CLIENT_VISIBLE_JOB_TYPES` allow-list; the
`isSystemJobType` check is a second, independent gate that always wins on top
of it, so a type mistakenly added to the allow-list in the future still can't
reach a client if it's `class: 'system'`.

**Admin surfaces never filter by class** — `GET /api/jobs`, the authenticated
admin WebSocket path, `useBackgroundTasks.tsx`, and `NotificationBell.tsx` show
every job regardless of class. Operators need visibility into cron-originated
work; only the client-facing surfaces need protecting.

No DB migration is involved: `class` is metadata keyed by job `type`, not a
column on the `jobs` table, so it works retroactively for every already-persisted
job row without a backfill.

## Guardrails

Phase 1 ships a narrow warning rule, `Background generation in high-churn routes must be allowlisted`. It scans audited high-churn route files for post-response generation patterns such as `generateX(...).then(...)` and `queueXGeneration(...)`.

This guardrail is intentionally smaller than the full contract above because Phase 2 still needs to migrate several legacy synchronous routes. Use `// background-generation-ok: <reason>` only next to reviewed legacy call sites, and remove the hatch when the call is moved behind `/api/jobs`.

## Cron Registry

Recurring boot-wired schedulers ("crons" — anything started once at process
boot and re-firing on an interval, as distinct from a per-request background
job) go through `server/cron-registry.ts`: `CRON_METADATA` is a typed
`Record<CronId, CronMetadataEntry>` (label, owning module, interval, description,
and a `stopHook`-gated `start`/`stop` lifecycle pair) mirroring
`shared/types/background-jobs.ts`'s `BACKGROUND_JOB_METADATA` shape.

A new boot-wired scheduler must:

1. Add a `CronId` + `CRON_METADATA` entry in `server/cron-registry.ts`, referencing
   the module's existing (or new) idempotent `startX()`/`stopX()` exports.
2. NOT call `startX()`/`stopX()` at module load inside `cron-registry.ts` —
   construction must stay lazy. `startAllRegisteredCrons()` /
   `stopAllRegisteredCrons()` are the only call sites that invoke lifecycle
   hooks, from `server/startup.ts` and `server/index.ts` (gracefulShutdown)
   respectively. This matters for tests, not just runtime: any unit test that
   partially mocks scheduler imports (the historical failure mode — see
   `tests/unit/startup.test.ts`, which once mocked only 15 of 20 `startX`
   exports) will start real timers inside vitest if construction is eager.
3. Be added to the manually-maintained module inventory in
   `tests/contract/cron-registry-census.test.ts` (the same step as #1 — do both
   in one commit). Understand what that census actually guarantees: it fails
   the build when a module ALREADY in its hardcoded inventory loses its
   `CRON_METADATA` entry, when `cron-registry.ts` stops importing an inventory
   module, when `gracefulShutdown`/`startSchedulers` stop routing through
   `stopAllRegisteredCrons()`/`startAllRegisteredCrons()`, or when `startup.ts`
   bypasses the registry by importing an inventory scheduler directly. It does
   NOT auto-detect a brand-new scheduler that is nowhere in its inventory —
   because it iterates that hardcoded list, not `startup.ts`'s live imports. So
   a genuinely-new scheduler stays green until someone extends the inventory by
   hand; that manual step is exactly why #1 and #3 are one commit, and why the
   auto-catch is the deferred pr-check rule's job (see the note below).

A cron with no real stop/lifecycle hook (an unconditional module-level
`setInterval` that fires on import, with no existing `stop()` export) is
still registered — with `stopHook: false` and a required `exemptReason`
string — rather than silently omitted. Three such timers exist today
(`server/middleware.ts` rate-limit + login-lockout cleanup,
`server/ai-deduplication.ts` cache cleanup) plus the MCP TTL sweeper
(`server/mcp/handles.ts`, which already self-guards under `NODE_ENV=test`).
Restructuring their import-time start semantics is a separate, deliberate
follow-up — not something a registry PR should silently absorb.

**No pr-check rule exists for "new setInterval must register in CRON_METADATA."**
This was evaluated during the R10-PR1 registry build and deferred: a regex or
customCheck rule cannot reliably distinguish a new boot-wired module-level
scheduler from a request-scoped `setInterval` (e.g. the SSE keepalive timer in
`server/routes/keyword-strategy.ts`, created and torn down per HTTP request)
without real scope analysis. This IS the gap the census contract test cannot
close on its own — the census only enforces its hardcoded inventory, so a
brand-new, un-inventoried scheduler passes CI until someone manually adds it to
both `server/cron-registry.ts` and the census's module list. The census guards
the far more common regression (an inventoried scheduler losing its
registration, or `startup.ts` bypassing the registry); the auto-detection of an
entirely-new unregistered scheduler is what this deferred pr-check rule would
add. Revisit if a scheduler is ever added to `startSchedulers()`'s call graph
without a registry entry in practice; until then, adding a new boot-wired
scheduler is a manual two-step contract (register + inventory), not a
mechanized one.
