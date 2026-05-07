# Background Generation Contracts

Long-running admin generation uses the existing background job platform:

- `server/jobs.ts` owns durable job state.
- `server/routes/jobs.ts` owns the central `/api/jobs` dispatcher.
- Dedicated `server/*-job.ts` worker modules own crawl-heavy or AI-heavy job bodies.
- `src/hooks/useBackgroundTasks.tsx` owns admin job state on the frontend.
- `src/components/TaskPanel.tsx` owns the floating task surface.
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

Admin generation UI must use `useBackgroundTasks()` for job start, progress, cancel, and rediscovery. Feature surfaces may show inline progress, but the inline state should derive from the same job object shown by `TaskPanel`.

Every new job type must be added to `shared/types/background-jobs.ts` with:

- A human label.
- A concise description.
- Whether cancellation is actually supported.
- Expected result behavior.

## Guardrails

Phase 1 ships a narrow warning rule, `Background generation in high-churn routes must be allowlisted`. It scans audited high-churn route files for post-response generation patterns such as `generateX(...).then(...)` and `queueXGeneration(...)`.

This guardrail is intentionally smaller than the full contract above because Phase 2 still needs to migrate several legacy synchronous routes. Use `// background-generation-ok: <reason>` only next to reviewed legacy call sites, and remove the hatch when the call is moved behind `/api/jobs`.
