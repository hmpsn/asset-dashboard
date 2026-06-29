# MCP Server Audit — hmpsn.studio

> **Date:** 2026-06-26 · **Branch:** `audit/mcp-surface` (off `origin/staging` @ `295399b25`)
> **Method:** Multi-agent audit (6 mappers → 4 synthesizers → adversarial verification → synthesis), 39 agents.
> **Scope:** the four questions — (1) are agents properly instructed? (2) what platform pieces lack MCP access + next best adds? (3) is the MCP built to scale and (4) empower the Claude content/analytics workflow?
> **Status:** Advisory. Every load-bearing claim was independently re-verified against source by the controller (see Appendix A). Tool count is authoritative at **45 tools across 8 categories**.

---

## 1. Executive summary

**(a) Are agents properly instructed? Grade: D.** When an agent connects, it receives essentially no orientation. The `Server` constructor passes only name/version + capabilities — there is **no `instructions` field** (`server/mcp/server.ts:36-39`; zero grep hits for "instructions" anywhere in `server/mcp/`), and the SDK at v1.29.0 fully supports it. There are **zero `.describe()` calls** in `shared/types/mcp-action-schemas.ts` (verified count: 0), so 33 of 45 tools ship JSON Schemas with no per-parameter guidance. The handle pipeline (single-use, 15-min TTL), the workspace-scoping contract, the read-then-write `expected_revision` protocol, and which tools cost money are all invisible at discovery time. Read-tool descriptions are good; write-tool descriptions are bare one-liners.

**(b) What lacks MCP access + next best adds? Grade: C+ for coverage.** The surface is a strong **content-generation spine + read-intelligence** server, but both flagship loops break at the same two joints: **no terminal action** (publish / resolve) and **no lifecycle write-back** (status advance / insight resolution). The single highest-leverage gaps — all wrapping verified, workspace-scoped functions that already exist — are `resolve_insight`, inbox decision actions, `publish_post`, and `advance_content_status`. Entire high-value contexts (schema, recommendations, raw GSC/GA4 with date ranges) have zero MCP presence.

**(c) Is it built to scale + empower the workflow? Grade: C.** The request path is correctly stateless and horizontally scalable; the background-job system is durable and restart-aware. But two pieces of process-local state (`handles.ts` Map, `paid-call-counter.ts` global) silently break under multi-instance, the auth model is a single static shared bearer token with **no rate limiting on `/mcp`** and no spend ceiling, and several reads are unbounded. The content loop is ~75% driveable end-to-end and the analytics loop ~55% — both are *stateless* today because the agent can read a queue but never close it.

---

## 2. Current MCP surface at a glance

**45 tools across 8 categories** (`ALL_TOOLS`, `server/mcp/server.ts:20-29`; per-file `name:` counts verified):

| Category | Count | Tools |
|---|---|---|
| workspaces | 5 | create / update / delete / get_workspace_overview / list_workspaces |
| intelligence | 1 | get_workspace_intelligence |
| insights | 3 | get_insights / get_unresolved_insights / get_anomalies |
| content (read) | 4 | get_seo_context / get_content_performance / get_content_decay / get_keyword_analysis |
| clients | 2 | get_client_signals / get_pending_work |
| keyword-actions | 6 | research_keywords / add_keyword_to_strategy / add_keywords_batch / remove_page_keyword / replace_keyword_strategy / get_keyword_strategy |
| content-actions | 18 | brief/post CRUD + versions + content-request + send_to_client |
| job-actions | 6 | start_keyword_strategy_generation / start_local_seo_refresh / start_seo_audit / get_job_status / list_jobs / cancel_job |

**What works well (keep):**
- **Stateless request path** — fresh `Server` + `StreamableHTTPServerTransport` per request, closed in `finally` (`server/mcp/server.ts:85-100`); the SDK-reuse hazard is correctly avoided and documented.
- **Durable background jobs** — SQLite write-through, `MAX_JOBS=200`, `JOB_TTL_MS=2h`, `markInterruptedAfterRestart`, per-`(type, workspace)` single-flight guards. `start_*` returns `{job_id}` and is pollable/cancellable.
- **The handle indirection** (`prepare_* → save_*`) with single-use consume semantics gives genuine retry-safety to multi-step content flows.
- **Optimistic concurrency** on briefs/posts via `expected_revision`.
- **`get_workspace_intelligence`** is the best-documented tool on the surface — names its slices, says when to use it, advises slicing to reduce size. It's the template the other 44 should follow.
- **Entry-point glue already exists** — `get_pending_work` (cross-workspace triage) and `get_workspace_overview` materially help autonomous operation; do not rebuild them.

---

## 3. Q1 — Agent instruction quality (Grade: D)

**Findings:**
- **Server `instructions` ABSENT.** `new Server({name, version}, {capabilities:{tools:{}}})` — no third argument (`server/mcp/server.ts:36-39`). The SDK supports `instructions?: string` at v1.29.0; this is an overlooked omission, not a limitation.
- **Zero per-parameter descriptions.** `grep -c '\.describe(' shared/types/mcp-action-schemas.ts` = **0**. `toMcpJsonSchema` uses `zod-to-json-schema`, which *does* propagate `.describe()` into JSON Schema `description` — so adding describes reaches discovery automatically with no handler changes. The most damaging opaque params: `getWorkspaceIntelligenceInputSchema.slices` (no enum), `addKeywordToStrategyInputSchema.target` (discriminated union, no hint), `sendToClientInputSchema`'s four "exactly one" targets (rule lives only in a `.refine` message), `update_brief/post` `mode` + `expected_revision`.
- **Cost signal incomplete.** Only `research_keywords` is tagged `[Paid API]` and it is the **sole caller** of `recordPaidCall` (verified: `server/mcp/tools/keyword-actions.ts:115` is the only call site). `start_keyword_strategy_generation`, `start_local_seo_refresh`, and `get_workspace_intelligence` with backlink/entity enrichment all hit paid providers unflagged and uncounted.
- **No documented multi-tool workflow.** The brief→post→send and research→add chains are only hinted per-tool; the handle lifecycle (single-use, 15-min TTL at `handles.ts:11`, workspace/kind-scoped) surfaces only inside thrown error strings.
- **Workspace-scoping enforced but never stated**, and two casings coexist: snake_case `workspace_id` vs camelCase `workspaceId` (insights/intelligence/content-performance). An agent juggling both will guess wrong.
- **No README** in `server/mcp/`; CLAUDE.md mentions MCP only architecturally.

**Single highest-impact fix:** add a server-level `instructions` string (one constructor argument) **plus** `.describe()` on every schema property. The instructions string is the only guidance *every* connecting agent is guaranteed to receive before its first call. Draft text:

> *hmpsn.studio is an SEO/web-analytics agency platform. Every tool operates on one client workspace and needs a workspace id — call `list_workspaces` first. (Most tools name this `workspace_id`; insights/intelligence/content-performance use `workspaceId` — match the tool's schema.) Content authoring is a handle pipeline: `prepare_brief_context` returns a `brief_request_handle` + `brief_schema` — YOU generate the brief locally, then `save_brief` (returns `brief_handle`). Repeat with `prepare_post_context` → `save_post`. Finally `send_to_client` creates the client request AND emails the client. Keyword research: `research_keywords` ([Paid API], one paid call per term) returns a `research_handle` for `add_keyword_to_strategy`. Handles are single-use, expire 15 minutes after creation, and are scoped to one workspace+kind — if a handle errors as not-found/expired, re-run the producing tool; never retry the consumer with the same handle. Editing: call `get_brief`/`get_post` for the `revision` token, pass it as `expected_revision`; on conflict, re-fetch. Paid APIs: `research_keywords`, `start_keyword_strategy_generation`, `start_local_seo_refresh`, and `get_workspace_intelligence` with `enrich_with_backlinks`/`resolve_entity_references`. Long jobs (`start_*`) return a `job_id`; poll `get_job_status`. Destructive: `delete_workspace`, `delete_brief`, `delete_post`, `replace_keyword_strategy`, `revert_post_version`.*

---

## 4. Q2 — Coverage gaps & next best adds (Grade: C+)

**Gap pattern.** The two end-to-end loops a Claude agent runs — (A) generate-content-to-published and (B) review-analytics-to-triaged — each break at the same two joints: **(1) no terminal action** (publish / resolve) and **(2) no lifecycle write-back** (status advance / insight resolution). Both loops are therefore *stateless*: the agent re-surfaces already-actioned items every pass and can never reach a terminal state.

**Gap matrix (highest-leverage missing item per context):**

| Context | Read | Write | Top missing |
|---|---|---|---|
| Analytics Intelligence | rich (insights, anomalies, intelligence, seo-context) | **NONE** | **resolve_insight**, raw GSC/GA4 + date range, diagnostics, mark_cannibalization_resolved |
| Inbox | `get_pending_work` (read-only) | **NONE** | **approve/decline batch item**, respond to client action |
| Content Pipeline | decay, perf, brief/post CRUD, versions | brief/post CRUD, send_to_client | **publish_post**, **advance_content_status**, grounded content jobs, widen save_brief schema |
| Schema | **NONE** | **NONE** | **generate / validate / publish page schema** |
| SEO Health / Strategy | `start_seo_audit` only | audit only | **recommendations generate + read + lifecycle** |
| Keyword | analysis, strategy | full mutation set | (well-covered) |
| Outcomes / Brand | titles only (in bundle) | **NONE** | scorecard/learnings read, voice-profile read |

**Ranked recommended new tools** (P0 first; each P0–P1 wraps a verified, workspace-scoped existing function):

| # | Tool | Loop | Priority | Effort | Unlocks | Verified backing |
|---|---|---|---|---|---|---|
| 1 | `resolve_insight` (+ bulk) | Analytics | **P0** | S | Closes the stateless analytics loop | `resolveInsight` `analytics-insights-store.ts:290` (returns `undefined` on workspace mismatch → clean 404) |
| 2 | Inbox decision actions (update item / respond to client action) | Analytics | **P0** | M | Makes the read-only inbox closeable | `updateItem` `approvals.ts:164`, `updateClientAction` `client-actions.ts:252` (both already call `validateTransition` internally — tool adds broadcast + activity, not re-validation) |
| 3 | `publish_post` | Content | **P0** | M | Reaches the `published` terminal state | `publishPostToWebflow` `domains/content/publish-post-to-webflow.ts:139`; `CONTENT_PUBLISH` job `background-jobs.ts:30,247` |
| 4 | `advance_content_status` | Content | **P1** | M | Drives review lifecycle past `client_review` | route through `updateContentRequest` (`content-requests.ts:294` already validates) |
| 5 | Grounded content jobs (`start_brief_generation` / `start_post_generation`) | Content | **P1** | M | Lets agent delegate to server pipeline (server-side retry, downstream review/voice-score, no agent token spend) | `content-brief-generation-job.ts`, `content-posts.ts` — *note: existing `prepare_*` path is already grounded via `buildContentGenerationContext()`; the real win is who runs the model, not grounding* |
| 6 | Schema tools (generate / validate / publish) | Both | **P1** | L | Opens a zero-presence context | `generateSchemaForPage` `schema-suggester.ts` (signature is `(siteId, pageId, token, ctx)` — wrapper resolves Webflow site+token internally) |
| 7 | Recommendations (generate via job / read / lifecycle) | Analytics | **P1** | L | Exposes Strategy v3 rec engine | `generateRecommendations` `recommendations.ts`, `applyBulkRecommendationAction` (action ∈ `send`/`throttle`/`strike`); generate is AI-backed → route via job platform |
| 8 | Raw GSC/GA4 read w/ date-range + period comparison | Analytics | **P2** | M | Agent computes its own trends | `getSearchOverview/getPerformanceTrend/getSearchPeriodComparison` `search-console.ts` — zero `days/dateRange/startDate` on any read schema |
| 9 | Widen `save_brief`/`update_brief` schema | Content | **P2** | M | Stops silent loss of ~20 ContentBrief fields | `buildBriefEntity` `content-actions.ts:658-684` maps only 12 of ~35 fields; `briefPatchContentSchema` is `.strict()` so updates *reject* the rich fields |

---

## 5. Q3 — Scale & workflow empowerment (Grade: C)

**Production-readiness verdict: single-instance-only today.** The request layer scales; the stateful pieces around it do not.

**What breaks at >1 instance or under open traffic:**
1. **Process-local handle store** (`handles.ts:20`, `new Map()` + 15-min TTL). Three failures: (a) a handle from instance A is invisible to instance B with no session affinity → multi-step flows fail with a *silent* `HandleNotFoundError`; (b) all handles vanish on restart; (c) **no eviction sweeper** (deletion is lazy only on a matching consume, `handles.ts:77`) and no `MAX_HANDLES` cap — `research_keywords` issues up to 50 handles/call, most never consumed → slow leak. This is the single biggest scaling blocker.
2. **Paid-call counter** (`paid-call-counter.ts`, module-global monotonic `let`, reset only in tests). Per-instance, latches "on" forever after first crossing, and **enforces nothing** ("informational only"). The two paid *jobs* are uncounted entirely. No circuit breaker anywhere.
3. **Auth** — one static shared `MCP_API_KEY` (`auth.ts:9-24`). Any holder can touch any workspace and any tool (create/delete workspace, send_to_client, paid research). No per-workspace scoping, no caller identity (all tagged `source:'mcp-chat'`), and **zero rate limiting on `/mcp`** — verified: the three Express limiters apply only to `/api/public/` (`app.ts:205-208`) and `/mcp` mounts at `app.ts:215`. Rotation is a hard env+restart cutover. *(The timing-safe compare itself is correct: equal-length padding + dual length guard rejects both longer and shorter tokens, fail-closed on empty key.)*
4. **Unbounded reads.** `get_anomalies` returns `JSON.stringify(anomalies)` with no `.slice()` and no `limit` in its schema (verified `insights.ts:89-102`) — unlike its capped siblings (`get_insights` 20, `get_unresolved_insights` 100). Cross-workspace `get_pending_work` and `list_workspaces` do unbounded N+1 sweeps over all workspaces with no pagination.

**Reliability gaps:** non-handle mutations aren't idempotent (retry duplicates `create_workspace`/`create_content_request`); error-shape inconsistency between the MCP `{isError,content}` envelope and the router's `{error}` 500 (`index.ts:13-16`); thin observability — only `log.debug({tool})` per call (`server.ts:47`), no request-level structured log, metrics, or tracing at the MCP boundary.

**Autonomous-loop assessment:**
- **Content loop A (~75%):** research → add to strategy → create request → prepare/save brief → prepare/save post → send_to_client all wired and idempotent on create. **Dead-ends at `client_review`** — `update_post`/`update_brief` carry no `status` field, `send_to_client` only ever sets `client_review` (`content-actions.ts:921,1233`), and **none of the 7 content background jobs are exposed** (job-actions wraps only `KEYWORD_STRATEGY`, `SEO_AUDIT`, `LOCAL_SEO_REFRESH` — verified). The agent can draft and send but never publish or react to the client's decision.
- **Analytics loop B (~55%):** rich qualitative reads + a fully-wired content-side response. **Breaks on diagnose** (no tool fetches or triggers a diagnostic report) and **breaks hardest on triage write-back** (no `resolveInsight` anywhere in `server/mcp/` — verified zero hits). After acting, the agent cannot mark anything resolved, so the same unresolved queue re-surfaces every pass — it loops on already-actioned work with no audit trail. No date-range reads cap diagnosis quality further.

---

## 6. Prioritized roadmap

**P0 — quick wins + loop-closers (do first):**
1. Add the server-level `instructions` string (1 constructor arg) — `server/mcp/server.ts:36`.
2. Add `.describe()` to every property in `mcp-action-schemas.ts` — propagates to discovery free, zero handler changes.
3. `resolve_insight` (+ bulk) — closes the analytics loop. Wraps `resolveInsight`; follow MCP write discipline (route through service fn, `addActivity`, `broadcastToWorkspace`).
4. Inbox decision tools (update approval item / respond to client action).
5. Add rate limiting to `/mcp` + a real paid-call budget covering the two paid jobs (not just `research_keywords`).

**P1 — structural completeness:**
6. `publish_post` via the `CONTENT_PUBLISH` job; `advance_content_status` via `updateContentRequest`.
7. Move the handle store + paid-call counter to a shared SQLite/Redis store with a TTL sweeper and `MAX_HANDLES` cap (mirror `jobs.ts` durability) — unblocks multi-instance.
8. Expose grounded content jobs; schema tools (generate + validate first, publish second); recommendations (generate-via-job + read + lifecycle).
9. Per-key workspace scoping + caller identity + multi-key rotation.

**P2 — quality + hardening:**
10. Raw GSC/GA4 read tool with date-range/period-comparison params.
11. Widen `save_brief`/`update_brief` schema to persist the full `ContentBrief`.
12. Bound `get_anomalies` + paginate the cross-workspace sweeps; unify the error shape; add request-level structured logging/metrics/tracing at the MCP boundary; idempotency keys on `create_*`.
13. Add `server/mcp/README.md` documenting the handle pipeline, revision protocol, paid-tool list, and the `workspace_id`/`workspaceId` casing split.

---

## 7. What's already good / refuted gaps

**Credit where due:**
- The stateless request path and durable, restart-aware job system are the right architecture and a sharp, deliberate contrast with the in-memory handle store.
- `get_pending_work` (cross-workspace triage) and `get_workspace_overview` are exactly the autonomous-operation entry-point glue most MCP servers lack — already shipped. Do not rebuild them.
- `create_content_request` has real keyword-dedupe idempotency; the `prepare_* → save_*` handle indirection and `expected_revision` optimistic concurrency are well-designed; `get_workspace_intelligence` is a model tool description.
- The timing-safe token compare is correct and fail-closed.

**Refuted / corrected (do NOT present as gaps):**
- **"49 tools" is a miscount** — the real exposed count is **45** (verified per-file). No repo doc cites 49; there is nothing to amend except stating 45 here.
- **The `prepare_*_context` path is NOT un-grounded.** Both `prepare_brief_context` and `prepare_post_context` already call `buildContentGenerationContext()` (`content-actions.ts:627,775`), the same blessed intelligence builder the server jobs use. The real distinction for exposing content jobs is *who runs the model* (agent-in-the-loop vs autonomous server job), not grounded vs un-grounded — frame the recommendation accordingly.
- **Inbox/content-status tools should not re-call `validateTransition`** — the wrapped store functions (`updateItem`, `updateClientAction`, `updateContentRequest`) already validate internally. The new tools add `broadcastToWorkspace` + `addActivity` only.
- **`send_to_client` is not the only status setter** — `save_brief`→`brief_generated` and `save_post`→`in_progress` also mutate status; the accurate gap is that no MCP tool can drive the *later* lifecycle states (`approved`/`changes_requested`/`post_review`/`delivered`/`published`).

---

## Appendix A — Verification status

This audit ran 6 mapping agents → 4 synthesis agents → adversarial verification → final synthesis. A transient server-side rate limit knocked out 15 of 28 verifier agents (all on lower-priority **P2 tail** recommendations); 13 verifiers (covering every **P0/P1** recommendation) completed. To close that gap, the controller independently re-verified all load-bearing claims directly against source:

| Claim | Method | Result |
|---|---|---|
| No `instructions` field; SDK `^1.29.0` supports it | read `server.ts:36-39` + `package.json` | ✅ confirmed |
| `0` `.describe()` calls in `mcp-action-schemas.ts` | `grep -c '\.describe('` | ✅ confirmed (0) |
| `recordPaidCall` single call site | `grep -rn recordPaidCall server` | ✅ confirmed (`keyword-actions.ts:115` only) |
| No rate limiter on `/mcp` | read `app.ts:201-215` | ✅ confirmed (limiters scoped to `/api/public/`) |
| `resolveInsight` exists, zero `server/mcp/` refs | grep both | ✅ confirmed |
| `get_anomalies` unbounded; siblings clamped | read `insights.ts:56-102` | ✅ confirmed |
| `publishPostToWebflow` + `CONTENT_PUBLISH` job exist | grep both | ✅ confirmed |
| job-actions exposes only 3 of 7 job types | read `job-actions.ts:169,258,293` | ✅ confirmed |
| `updateItem`/`updateClientAction`/`updateContentRequest` exist | grep exports | ✅ confirmed |

The 15 unverified P2 tail recommendations (e.g. error-shape unification, idempotency keys, observability, README) are sound in principle but were not individually re-checked against source; treat them as advisory-confidence pending a follow-up pass.
