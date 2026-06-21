# The Issue — Phase 5: Four-Jobs Lenses Implementation Plan

> Parallel-lane build. Pre-committed shared contracts → 3 exclusive-ownership lanes (server / frontend / tests) → controller integration → full gate → scaled adversarial review.

**Goal:** The two remaining four-jobs lenses (spec §9, §12.5) — **job #4 keyword targets** and **job #3 content work-order** — as ADMIN read-projections of the already-curated Issue rec set. Jobs #1 (POV) and #2 (client feed) shipped in Phases 1–2; the client side of #3/#4 also shipped in Phase 2 (the client content plan + act-on). Phase 5 adds the **operator lenses**: the curated targets/work-orders projected into the existing Keyword Hub + content-pipeline surfaces via deep-links.

**Spec:** `docs/superpowers/specs/2026-06-19-strategy-the-issue-design.md` §9 (four-jobs projection), §12 phase 5. Locked.

**Flag:** `strategy-the-issue` (existing). Admin-only. No migration, no new WS event, no new flag — pure read-projection of existing data; the hook is enabled-gated so flag-OFF makes zero calls (byte-identical OFF).

---

## Locked design

1. **Two lenses, both ADMIN-only read-projections** of the curated/in-play rec set (`isActiveRec(r) || isCuratedForClient(r)` — not struck, not declined; covers active + sent/approved/discussing).
   - **Job #4 — Keyword targets:** curated `keyword_gap` + `topic_cluster` recs, each deep-linking into the **Keyword Hub** (`adminPath(ws,'seo-keywords') + buildHubDeepLinkQuery({ keyword })`).
   - **Job #3 — Content work-orders:** curated `content` + `content_refresh` recs, each joined (by `recommendationId`) to its `content_topic_requests` row for a production **stage**, deep-linking into the **content pipeline** (`adminPath(ws,'content-pipeline') + '?tab=briefs'|'?tab=posts'`).
2. **No new source of truth.** Server projects from `loadRecommendations` + `listContentRequests`. One server projection function, one GET route, one hook, two thin components.
3. **deepLinkKeyword resolution:** `keyword_gap` → `targetKeyword` (fallback: source after `keyword_gap:`); `topic_cluster` → source after `topic_cluster:` (the topic; no `targetKeyword`). `null` only if neither resolves.
4. **Stage mapping** (content_topic_requests status → ContentWorkOrderStage): no request → `not_started`; `pending_payment|requested|brief_generated` → `queued`; `in_progress` → `in_progress`; `client_review|post_review` → `awaiting_client`; `changes_requested` → `changes_requested`; `approved` → `approved`; `delivered|published` → `completed`; `declined` → `declined`.
5. **Freshness:** the hook invalidates on existing events `RECOMMENDATIONS_UPDATED`, `CONTENT_REQUEST_CREATED`, `CONTENT_REQUEST_UPDATE` via `useWorkspaceEvents` — no new WS event.

---

## Shared contracts (PRE-COMMIT — controller owns)

- **`shared/types/strategy-issue-lenses.ts`** (new):
  ```ts
  import type { RecPriority } from './recommendations.js';
  export interface KeywordTargetRow {
    recId: string;
    type: 'keyword_gap' | 'topic_cluster';
    label: string;                  // the keyword (keyword_gap) or topic (topic_cluster)
    deepLinkKeyword: string | null; // term to seed the Keyword Hub ?q=; null when unresolved
    clientStatus: string;
    priority: RecPriority;
    sent: boolean;                  // isCuratedForClient — already in front of the client
  }
  export type ContentWorkOrderStage =
    | 'not_started' | 'queued' | 'in_progress' | 'awaiting_client'
    | 'changes_requested' | 'approved' | 'completed' | 'declined';
  export interface ContentWorkOrderRow {
    recId: string;
    type: 'content' | 'content_refresh';
    title: string;
    clientStatus: string;
    priority: RecPriority;
    sent: boolean;
    requestId: string | null;
    stage: ContentWorkOrderStage;
    hasBrief: boolean;
    hasPost: boolean;
  }
  export interface IssueLensesResponse {
    workspaceId: string;
    keywordTargets: KeywordTargetRow[];
    contentWorkOrders: ContentWorkOrderRow[];
  }
  ```
- **`src/lib/queryKeys.ts`** — `admin.issueLenses: (wsId) => ['admin-issue-lenses', wsId] as const`.

---

## Lane B — Server (exclusive owner: `server/` non-test)

- Create `server/strategy-issue-lenses.ts` — `buildIssueLenses(workspaceId): IssueLensesResponse`:
  - `loadRecommendations` → filter `(isActiveRec(r) || isCuratedForClient(r))`.
  - `keywordTargets` = filtered recs of type `keyword_gap`|`topic_cluster` → `KeywordTargetRow` (resolve `deepLinkKeyword` + `label` per §3; `sent = isCuratedForClient(r)`). Sort: sent first, then priority, then impactScore.
  - `contentWorkOrders` = filtered recs of type `content`|`content_refresh`; build `Map<recommendationId, ContentTopicRequest>` from `listContentRequests(workspaceId)` (last-wins or most-recent); derive `stage` (§4), `requestId`, `hasBrief = !!request.briefId`, `hasPost = !!request.postId`. Sort: by stage urgency then priority.
  - Returns `{ workspaceId, keywordTargets, contentWorkOrders }`. Read-only; no writes.
  - Export a pure `contentRequestStageOf(status): ContentWorkOrderStage` helper (also imported by the contract test).
- Create `server/routes/strategy-issue-lenses.ts` — `GET /api/workspaces/:workspaceId/issue-lenses` → `IssueLensesResponse`. `requireWorkspaceAccess`. Validate `workspaceId` param.
- Edit `server/app.ts` — register the router (alongside `strategyPovRouter`).

## Lane C — Frontend (exclusive owner: `src/`)

- Create `src/api/issueLenses.ts` — `getIssueLenses(workspaceId): Promise<IssueLensesResponse>` (`GET /api/workspaces/:wsId/issue-lenses`).
- Create `src/hooks/admin/useIssueLenses.ts` — query `admin.issueLenses`, `enabled = !!workspaceId && enabledArg`; `useWorkspaceEvents` handlers for `RECOMMENDATIONS_UPDATED`, `CONTENT_REQUEST_CREATED`, `CONTENT_REQUEST_UPDATE` → invalidate. Returns `{ keywordTargets, contentWorkOrders, isLoading, isError }`.
- Create `src/components/strategy/issue/KeywordTargetsLens.tsx` — `SectionCard` "Keyword targets"; one row per `KeywordTargetRow`: label + a sent/active badge + a "View in Keyword Hub" link (`navigate(adminPath(ws,'seo-keywords') + buildHubDeepLinkQuery({ keyword: row.deepLinkKeyword }))`, disabled when `deepLinkKeyword == null`). `EmptyState` when none. Props `{ workspaceId, theIssueEnabled? }`. No purple; teal links (Law 1).
- Create `src/components/strategy/issue/ContentWorkOrderLens.tsx` — `SectionCard` "Content work-orders"; one row per `ContentWorkOrderRow`: title + a stage badge (`StatusBadge`/`Badge` mapped per stage) + a deep-link to the content pipeline (`adminPath(ws,'content-pipeline') + (row.hasPost ? '?tab=posts' : '?tab=briefs')`). `EmptyState` when none. Props `{ workspaceId, theIssueEnabled? }`.
- Edit `src/components/KeywordStrategy.tsx` — mount both lenses in `issueOverviewEl` (after `TrustLadderPanel`), gated by the existing `theIssueEnabled`; thread `theIssueEnabled` into each so the hook is enabled-gated. Imports at top.
- Edit `BRAND_DESIGN_LANGUAGE.md` — note the two lens panels + stage-badge color mapping if novel.

## Lane D — Tests (exclusive owner: `tests/`)

- `tests/unit/strategy-issue-lenses.test.ts` — `buildIssueLenses`: keyword targets include only curated keyword_gap/topic_cluster (struck/declined excluded); `deepLinkKeyword` resolution (keyword_gap targetKeyword, topic_cluster from source, null when neither); content work-orders include only content/content_refresh, joined to the right request by recommendationId, with the correct `stage`/`hasBrief`/`hasPost`; `sent` reflects `isCuratedForClient`. `contentRequestStageOf` maps every content-request status correctly (table-driven over the full enum).
- `tests/integration/strategy-issue-lenses-route.test.ts` — `GET /api/workspaces/:ws/issue-lenses` returns the projection shape; struck recs excluded; a content rec with a linked in-progress request shows `stage:'in_progress'`.
- (Optional) a contract test asserting the stage mapping covers every `ContentTopicRequest['status']` value (fail-closed on a new status).

---

## Acceptance gates (controller)

- [ ] typecheck · vite build · full vitest · pr-check 0 errors · verify:feature-flags.
- [ ] Flag-OFF: the hook makes zero calls; cockpit byte-identical.
- [ ] Curated-set filter excludes struck + declined; only the 4 lens rec-types appear.
- [ ] Deep-links resolve to valid Page values (`seo-keywords`, `content-pipeline`) with the two-halves `?tab=`/`?q=` contract honored by the receivers.
- [ ] Scaled adversarial review; fix all Critical/Important; re-gate.
- [ ] FEATURE_AUDIT #525 → Phase 0–5; roadmap; memory boundary.
