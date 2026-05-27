# 2026-05-27 — Audit Drift Closure Findings

> Equivalent of a `pre-plan-audit` skill run. Four parallel Explore subagents covered server helpers, frontend helpers, admin/client data drift, and intelligence-slice gaps. Drives three implementation plans:
> - [plan-a-security-and-drift](../plans/2026-05-27-audit-drift-closure-plan-a-security-and-drift.md)
> - [plan-b-ai-and-wiring](../plans/2026-05-27-audit-drift-closure-plan-b-ai-and-wiring.md)
> - [plan-c-adoption-sweeps](../plans/2026-05-27-audit-drift-closure-plan-c-adoption-sweeps.md)

## Methodology

Four parallel `Explore` subagents (`general-purpose` after Explore prompts hit length limits) scoped to:
1. Server helper duplication audit (`server/`)
2. Frontend helper duplication audit (`src/`)
3. Admin vs client data drift audit (`server/routes/*` vs `server/routes/public-*.ts`, `src/api/*` vs `src/api/client*`)
4. Intelligence-slice and shared-type contract gap audit

Each agent returned exhaustive findings tables (file:line citations, P1/P2/P3 priority). The session main agent then cross-verified each citation against the codebase before plan authoring; the corrections section below records what cross-verification overturned.

## Findings — Verified Accurate

### Security (P0)

| Endpoint | File:line | Issue |
|---|---|---|
| `GET /api/public/rank-tracking/:workspaceId/history` | `server/routes/rank-tracking.ts:125` | No auth middleware; admin twin (`:112`) uses `requireWorkspaceAccess` |
| `GET /api/public/rank-tracking/:workspaceId/latest` | `server/routes/rank-tracking.ts:133` | Same |
| `GET /api/public/audit-traffic/:workspaceId` | `server/routes/public-portal.ts:310` | No auth middleware; returns GA/GSC page metrics |
| `GET /api/public/anomalies/:workspaceId` | `server/routes/anomalies.ts:27` | **Added during verification.** No auth middleware |
| `POST /api/anomalies/:anomalyId/dismiss` | `server/routes/anomalies.ts:34` | **Added during verification.** No `requireWorkspaceAccess`, no workspace guard at all |
| `POST /api/anomalies/:anomalyId/acknowledge` | `server/routes/anomalies.ts:43` | Same |

### Admin/client data drift (P1)

| Concept | Admin | Client | Confirmed |
|---|---|---|---|
| `isTrial` | `server/routes/workspaces.ts:182` (`trialEnd > new Date()`) | `server/serializers/client-safe.ts:75` (`effectiveTier === 'growth' && baseTier === 'free'`) | ✅ formula divergence on the same workspace row |
| Workspace serialization | `server/routes/workspaces.ts:94` (`{ ...ws, webflowToken: undefined, clientPassword: undefined }`) | `server/serializers/client-safe.ts:42` (allow-list) | ✅ lossy spread auto-leaks new columns |
| Briefing payload | no admin preview endpoint | `server/routes/public-portal.ts` briefing handler synthesizes `issueNumber`, `issueSummary`, top-5 `recommendations`, `weeklyOpener` | ✅ admin ships blind |

### Missing broadcast/activity wiring (P1)

| File:line | Issue |
|---|---|
| `server/routes/client-actions.ts:49,67,84` | Three mutations, zero `broadcastToWorkspace`/`addActivity` |
| `server/routes/keyword-command-center.ts:123,137` | Single + bulk action mutations, neither wired |
| `server/routes/anomalies.ts:34,43` | Dismiss + acknowledge, neither wired |

### Bare `JSON.parse` on AI structured output (P1)

| File:line | Issue |
|---|---|
| `server/content-brief.ts:35` | Local `parseAiJson` (lowercase, distinct from canonical `parseAIJson` in `server/openai-helpers.ts:505`) — should be retired |
| `server/content-brief.ts:1017,1020-1022` | Guessed field-name anti-pattern: `(outlineParsed as Record<string,unknown>).outline ?? .sections ?? []` |
| `server/aeo-page-review.ts:63,242` | Bare `JSON.parse` on AI response |
| `server/diagnostic-orchestrator.ts:466` | `JSON.parse(result.text) as { rootCauses?: unknown; ... }` |
| `server/schema-plan.ts:358` | Bare `JSON.parse(cleaned)` |

### Server helper duplication (P1 / P2)

| Helper | Sites | Severity |
|---|---|---|
| `slugify` | `server/intelligence/entity-resolution-slice.ts:13` (`[^a-z0-9\s-]`) vs `server/mcp/tools/keyword-actions.ts:49` (`[^a-z0-9]+`) | **P1** — divergent output |
| `dedupeByKeyword` / `dedupeByTopic` / `dedupeStrings` / `dedupeCandidates` | `server/cannibalization-issues.ts:131`, `server/keyword-gaps.ts:74`, `server/topic-clusters.ts:102`, `server/keyword-strategy-sanitizer.ts:103`, `server/keyword-recommendations.ts:137` | P1 |
| `uniq` / `uniqueStrings` / `uniqueSeoTexts` / `uniqueEntities` | `server/keyword-strategy-ux.ts:85`, `server/schema/data-sources.ts:255`, `server/webflow-seo-rewrite-utils.ts:36`, `server/schema-suggester.ts:223` | P2 |
| `sanitizeForPrompt` / `sanitizeForPromptInjection` / `sanitizeQueryForPrompt` | `server/briefing-prompt.ts:169`, `server/helpers.ts:278`, `server/helpers.ts:294` | P2 |

### Frontend helper adoption gaps (P1)

| Pattern | Sites | Canonical |
|---|---|---|
| Inline score-color thresholds | ~15 components | `scoreColor`/`scoreColorClass`/`scoreBgClass` in `src/components/ui/constants.ts` |
| Raw `.toLocaleString()` for metrics | ~78 sites | `fmtNum` in `src/utils/formatNumbers.ts` |
| Inline `Intl.NumberFormat` USD | 4 sites (`client/InsightsEngine.tsx:44`, `client/FixRecommendations.tsx:13`, `client/SeoCart.tsx:8`, `ClientDashboard.tsx:601`) | `fmtMoney` (existing) |
| Bytes → KB/MB | 3 sites (`AssetBrowser.tsx:40`, `AssetAudit.tsx:38`, `PageWeight.tsx:35`) | `formatBytes` (to add to `src/utils/formatNumbers.ts`) |
| Raw `new Date(*).toLocaleDateString()` | ~25 sites | `formatDate*` helpers (new `src/utils/formatDates.ts`) |
| `useState<Set<X>>` toggle pattern | ~30 sites | `useToggleSet` (existing in `src/hooks/useToggleSet.ts`, only 3 sites adopt it) |
| Custom relative-time formatters | 4 sites | `timeAgo` in `src/lib/timeAgo.ts` |
| Status→badge ternaries | 6+ sites | `<Badge>`/`<StatusBadge>` props or `lib/copyStatusConfig.ts` |

Full site lists captured in roadmap items `audit-drift-score-color-adoption-sweep`, `audit-drift-fmt-num-formatbytes-adoption`, `audit-drift-fmt-money-format-date-adoption`, `audit-drift-use-toggle-set-adoption`, `audit-drift-p2-helper-tail`.

### P2 admin/client parity tail

| Concept | Files |
|---|---|
| Insight shape parallelism (raw vs `buildClientInsights`) | `server/routes/insights.ts:17` vs `server/routes/public-analytics.ts:131` |
| Content-gap `opportunityScore` fallback inconsistency | `server/routes/keyword-strategy.ts:211` vs `server/routes/public-content.ts:214` + briefing projection |
| `pendingApprovals` count includes non-client-visible statuses | `server/routes/workspaces.ts:126` |
| Brand-voice authority bypassed on onboarding writes | `server/routes/public-portal.ts:135,185` (writes raw `ws.brandVoice` instead of via voice-profile chain) |
| `quickWins` shape parity | `server/routes/keyword-strategy.ts:259` (full row) vs `server/routes/public-content.ts:216-221` (4 fields) |

### P3 residuals

| Item | Files |
|---|---|
| Retire `server/db/json-column.ts:parseJsonColumn` in favor of `parseJsonFallback` | `server/db/json-column.ts:9` vs `server/db/json-validation.ts:90` |
| Collapse `titleCaseWord` / `capitalize` / `capitalizeSlugSegment` | `server/insight-enrichment.ts:37`, `server/schema/data-sources.ts:146,324` |
| Collapse `compact()` siblings | `server/keyword-strategy-context.ts:36`, `server/keyword-strategy-ux.ts:85` |
| `useDebouncedValue` hook missing | `KeywordCommandCenter.tsx:116-131`, `useAutoSave.ts`, `ui/overlay/Tooltip.tsx:110` (audit `useAutoSave` shared-timer contract before migrating) |
| `daysSince(iso)` helper missing | `schema/SchemaPageCard.tsx:95`, `client/Briefing/WinsSurface.tsx:32` |
| `sleep(ms)` only one copy but commonly re-rolled | `server/local-seo.ts:156` |
| Typed shape for `matchedPage` / `meta` | `server/schema-suggester.ts:692-876` (8+ `as Record<string,unknown>` casts) |

## Corrections Applied During Verification

These audit claims were **overturned** by cross-verification against the codebase and dropped or rewritten:

| Audit claim | Verification result | Action |
|---|---|---|
| `webflow-audit.ts:20` serves raw `getLatestSnapshot` (admin) vs client uses `getLatestEffectiveSnapshot` | File `server/webflow-audit.ts` does not exist. `getLatestSnapshot` (defined in `server/reports.ts:494`) has **zero callers outside `reports.ts`**. The actual audit-traffic logic lives in `server/audit-traffic.ts`; snapshot-suppression view logic lives in `server/audit-snapshot-views.ts`. | **Dropped.** Not a real divergence. |
| Migrate `server/copy-generation.ts:116` from `callAnthropic` to `callAI()` | CLAUDE.md explicitly permits `callAnthropic` for creative prose. Copy generation IS creative prose. | **Dropped.** Per-policy correct. |
| Audit reported test port range 13201–13316 (from stale PLAN_WRITING_GUIDE) | Actual highest port in `tests/` is 13870. CLAUDE.md range is 13201–13899. | **Plans bumped to 13871+.** |
| Some references to `parseAIJson` vs `parseAiJson` were ambiguous | Canonical export is `parseAIJson` (uppercase) in `server/openai-helpers.ts:505`. `server/content-brief.ts:35` defines a **local** `parseAiJson` (lowercase) that should be retired during the Plan B migration. | **Plan B Task 2 updated** to delete the local and route through canonical. |

## Coverage Verification

For each finding, the verifier confirmed canonical home exists and is reachable:

| Canonical | File | Verified |
|---|---|---|
| `scoreColor`/`scoreColorClass`/`scoreBgClass` | `src/components/ui/constants.ts:10,18,23` | ✅ |
| `fmtNum`/`fmtMoney`/`fmtMoneyFull` | `src/utils/formatNumbers.ts:7,14,20` | ✅ |
| `useToggleSet` | `src/hooks/useToggleSet.ts:12` | ✅ |
| `timeAgo` | `src/lib/timeAgo.ts:7` | ✅ |
| `parseJsonSafe`/`parseJsonSafeArray`/`parseJsonFallback` | `server/db/json-validation.ts:12,44,90` | ✅ |
| `parseAIJson` (AI text canonical) | `server/openai-helpers.ts:505` | ✅ |
| `callAI` (unified dispatcher) | `server/ai.ts:68` | ✅ |
| `computeEffectiveTier` | `server/workspaces.ts:58` | ✅ |
| `broadcastToWorkspace` | `server/broadcast.ts:31` | ✅ |
| `addActivity` | `server/activity-log.ts:253` | ✅ |
| `buildWorkspaceIntelligence` | `server/workspace-intelligence.ts:47` | ✅ |
| `requireClientPortalAuth` | `server/middleware.ts:188` | ✅ |
| `requireWorkspaceAccess` | `server/auth.ts:105` | ✅ |
| `computeOpportunityScore` | `server/keyword-strategy-helpers.ts:74` | ✅ |
| `useWorkspaceEvents` / `useGlobalAdminEvents` | `src/hooks/useWorkspaceEvents.ts:13`, `src/hooks/useGlobalAdminEvents.ts:22` | ✅ |

## Out of Scope

- WebSocket broadcast event coverage gaps beyond the three routes named. There may be other workspace-mutation routes silently skipping `broadcastToWorkspace`; a complete sweep is its own pr-check rule (Plan B Task 10).
- Coverage of `useGlobalAdminEvents` misuse in frontend hooks. Audit only spot-checked `src/App.tsx:338` (legitimate) and `WorkspaceOverview.tsx:34` (legitimate, scoped to `presence:update`). A full sweep is its own task.
- AI quality eval gaps; tracked separately under `docs/rules/ai-quality-evals.md`.
