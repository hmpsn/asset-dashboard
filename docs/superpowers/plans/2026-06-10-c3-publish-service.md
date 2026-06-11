# C3 — Publish Service Extraction (audit item #12)

> Phase C3 of the 2026-06-10 core-features remediation run. Single-agent (Claude/Opus).
> Branch: `claude/core-c3-publish-service` off `origin/staging` (base: PR #1182 / C2 merged).

## Problem (verified against fresh origin/staging)

Two publish paths drifted apart:

1. **Manual publish** — `server/routes/content-publish.ts:64` `POST .../publish-to-webflow`.
   Synchronous, returns `{ success, itemId, slug, isUpdate, post }` inline. Superset field
   map (incl. `summary` from brief + `featuredImage` when `generateImage`), re-reads the post
   to defend against the auto-publish race (`content-publish.ts:125`), records outcome action
   with the `getActionByWorkspaceAndSource` dedup guard, broadcasts `CONTENT_PUBLISHED`, logs
   `content_published`, and enqueues `queueKeywordStrategyPostUpdateFollowOns` after response.

2. **Auto-publish on approval** — `server/routes/content-posts.ts:368-441`, PATCH handler.
   **Silent fire-and-forget** (`createCollectionItem(...).then()` at :386, hatch at :385).
   Failures only `log.warn` — never surface to the operator. Writes a **strict subset** field
   map (missing `summary` + `featuredImage`). Does **NOT** call
   `queueKeywordStrategyPostUpdateFollowOns` (the only one of 9 callers missing it).

## Goals

- Extract ONE `publishPostToWebflow` domain service in `server/domains/content/`, consumed by
  BOTH paths. Single field map (the manual superset). Single broadcast + activity + outcome +
  follow-on site.
- Auto-publish becomes a **background job** (`CONTENT_PUBLISH`): failures surface as job status
  `error` + activity, never silent.
- Follow-ons (`queueKeywordStrategyPostUpdateFollowOns`) fire on BOTH paths (inside the service).

## Sync-vs-job decision (deliberate)

**Manual publish stays synchronous; only auto-publish becomes a job. Both call the same service.**

Rationale:
- Manual publish is a single foreground operator action — the UI (`ContentManager.publishPost`,
  `PostEditor`) `await`s the call and expects an inline `{ success, post }` result (image-generation
  toggle, immediate row refresh). Converting it to a job would force a UX rewrite for no benefit:
  it is one Webflow round-trip, fast, and already error-surfaced via the HTTP response.
- Auto-publish was already detached (fire-and-forget) — there is no inline result to preserve.
  The approve PATCH response **never** carried publish results (verified: `content-posts.ts`
  `res.json(updated)` at the end; the `.then()` runs after). So making it a job is strictly an
  improvement: failures now surface via job `error` + activity, and `useJobProgress` +
  `CONTENT_PUBLISHED` give the editor progress/failure UX. The approve PATCH keeps its
  `200 + post` contract unchanged.

The shared service `publishPostToWebflow()` is a plain async function (no HTTP, no job coupling).
The route calls it directly and awaits; the job runner calls it and maps the result to job status.

## Contracts preserved (verified)

- Post status `approved` is TERMINAL — publish is a side effect via `webflowItemId`/`publishedAt`/
  `publishedSlug`. **No state-machine changes.**
- Idempotency / race guard: service re-reads the post and guards on `!webflowItemId` (update vs
  create). The job runner additionally short-circuits if the post is already published before
  starting work.
- Outcome `recordAction` keeps the `getActionByWorkspaceAndSource(workspaceId,'post',postId)` dedup
  guard — critical for job retries (a retried publish must not double-record).
- `WS_EVENTS.CONTENT_PUBLISHED` payload shape `{ postId, itemId, slug, title, isUpdate }` and
  `addActivity('content_published', ...)` move INTO the service (single place).
- On partial failure (item created but publish-live fails), stamp `webflowItemId` +
  `webflowCollectionId` only (no `publishedAt`/`publishedSlug`) — same as manual today.
- On create failure, stamp NOTHING (FM-2: no partial `webflowItemId`).

## Files (exclusive ownership)

| File | Change |
| --- | --- |
| `server/domains/content/publish-post-to-webflow.ts` | NEW — the extracted service + `PublishResult`/`PublishPostError`. |
| `server/content-publish-job.ts` | NEW — job runner (`runContentPublishJob`), mirrors `llms-txt-generation-job.ts`. |
| `shared/types/background-jobs.ts` | Additive `CONTENT_PUBLISH` job type + metadata (`ephemeral`, non-cancellable). |
| `server/routes/content-publish.ts` | Manual route calls the service; remove inlined field-map/broadcast/activity/outcome/follow-on. |
| `server/routes/content-posts.ts` | Auto-publish → `createJob(CONTENT_PUBLISH)` + `setImmediate(runContentPublishJob)`. Remove inlined block + stale `// background-generation-ok` hatch. |
| `tests/integration/content-posts-workflow.test.ts` | Auto-publish tests now assert job lifecycle (`error` surfaces, no partial stamp, summary/featuredImage field parity). |
| `tests/contract/outcome-publish-triggers-rec-regen.test.ts` | Point publish/follow-on greps at the service; add auto-publish-path coverage. |
| `tests/integration/publish-service-field-parity.test.ts` | NEW — field-map parity contract (both paths produce identical fieldData given identical inputs). |
| `tests/helpers/background-job-test-matrix.ts` | Add `CONTENT_PUBLISH` row anchored to the workflow test. |
| `FEATURE_AUDIT.md`, `data/roadmap.json` | Mark audit item #12 done. |

Manual-publish suites (`journey-content-publish`, `content-publish-writes`,
`content-publish-action-tracking`, `content-posts-lifecycle`) exercise the synchronous route,
which keeps its response contract — expected to pass unchanged; swept regardless.

## Service interface

```ts
// server/domains/content/publish-post-to-webflow.ts
export interface PublishPostToWebflowOptions {
  generateImage?: boolean;        // manual route only; auto-publish omits
  activitySource?: 'manual' | 'auto-publish';
}
export interface PublishPostToWebflowResult {
  itemId: string;
  slug: string;
  isUpdate: boolean;
  post: GeneratedPost;            // the updated post row
}
export class PublishPostError extends Error {
  readonly code: 'workspace_not_found' | 'no_publish_target' | 'no_site' | 'no_token'
    | 'post_not_found' | 'invalid_status' | 'create_failed' | 'publish_failed' | 'no_item_id';
  readonly httpStatus: number;    // route maps directly
}
export async function publishPostToWebflow(
  workspaceId: string, postId: string, opts?: PublishPostToWebflowOptions,
): Promise<PublishPostToWebflowResult>;
```

The service: loads ws/token/post, validates status, re-reads post (race guard), builds the ONE
superset field map (incl. `summary` from `getBrief(...).executiveSummary` and `featuredImage`),
create-or-update + publish-live, stamps publish fields in a `db.transaction()`, records outcome
(guarded), `invalidateContentPipelineIntelligence`, broadcasts `CONTENT_PUBLISHED`, logs activity,
and calls `queueKeywordStrategyPostUpdateFollowOns` (best-effort try/catch). Errors throw
`PublishPostError`; partial-failure stamping happens before the throw.

## Job runner

```ts
// server/content-publish-job.ts
export async function runContentPublishJob({ jobId, workspaceId, postId }): Promise<void>
```
Mirrors `llms-txt-generation-job.ts`: `updateJob(running)` → re-read post, short-circuit done if
already `webflowItemId` → `await publishPostToWebflow(..., { activitySource:'auto-publish' })` →
`updateJob(done, { result })`. On `PublishPostError`/any error → `updateJob(error, ...)`. The
service already wrote partial-stamp + activity, so the job error path adds no DB writes.
`unregisterAbort` in `finally` (parity with the C2 pattern, though non-cancellable).

Auto-publish dispatch lives in `content-posts.ts` (I own it) via `createJob` + `setImmediate`,
NOT in `routes/jobs.ts` (owned by another lane) — the frontend never starts this job directly;
it observes it through `useBackgroundTasks`/`useJobProgress` polling `/api/jobs`. Guard with
`hasActiveJob(CONTENT_PUBLISH, wsId)` keyed by postId-in-message to avoid double-dispatch.

## Tests (TDD)

1. **Field-map parity** (new) — given identical post+publishTarget(summary+featuredImage), assert
   the fieldData the service builds includes title/slug/body/metaTitle/metaDescription/publishDate
   /summary/featuredImage. Drives the superset extraction.
2. **Auto-publish job success** — PATCH approve → job runs → post stamped, `CONTENT_PUBLISHED`
   broadcast, activity logged, follow-ons queued.
3. **FM-2 failure** — Webflow create errors → job `error`, NO `webflowItemId` stamped, no
   `CONTENT_PUBLISHED`.
4. **Follow-ons on BOTH paths** — contract grep asserts the service file calls
   `queueKeywordStrategyPostUpdateFollowOns`; manual + auto both route through it.

## Verification

`npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts`, the four touched/new test
files, and the content shard of `npm run test:integration`. (Full vitest via pre-commit hook.)

## Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
