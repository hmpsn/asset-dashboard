# The Issue — Phase 6: Full Competitor Page Implementation Plan

> Parallel-lane build. Pre-committed shared contracts → 3 exclusive-ownership lanes (server / frontend / tests) → controller integration → full gate → scaled adversarial review.

**Goal:** Promote the existing competitor intelligence into a dedicated admin **Competitors page** (share of voice, keyword gaps, backlinks, **alerts**) — spec §12.6. Maximal reuse: the `StrategyCompetitiveTab` composition (ShareBar + CompetitiveIntel + KeywordGaps + BacklinkProfile) already exists; the one genuinely net-new surface is **competitor alerts** (`competitor_alerts` table — written weekly by `intelligence-crons.ts` but with ZERO UI today).

**Spec:** `docs/superpowers/specs/2026-06-19-strategy-the-issue-design.md` §12 phase 6, §16. Locked.

**Flag:** `strategy-the-issue`. The page is reached via a flag-ON deep-link from The Issue cockpit; it is a **non-registry Page** (not in the global nav), so flag-OFF nav + every existing surface stays byte-identical. The client competitor surface already shipped (Phase 2 `CompetitorGapsSection` in `TheIssueClientPage`) — Phase 6 is admin-side.

---

## Locked design

1. **New admin `competitors` Page** (a real `Page` union value), reachable via `adminPath(ws,'competitors')`. Added to `NON_REGISTRY_PAGES` (NOT the nav registry) so no global nav item appears — flag-OFF nav is byte-identical. The entry point is a flag-ON deep-link from The Issue cockpit ("Competitor intelligence →"). Reachable by URL for anyone, but harmless (admin-only competitor data already shown in the command-center `?tab=competitive` interior tab).
2. **`CompetitorsPage`** composes, in order: a `PageHeader`; the net-new `CompetitorAlertsPanel`; then the existing `StrategyCompetitiveTab` composition (ShareBar + CompetitiveIntel + KeywordGaps + BacklinkProfile) fed the same props the cockpit feeds it. Loads strategy via `useKeywordStrategy` + `useStrategySettings` (the exact pattern `KeywordStrategyPanel` uses).
3. **`CompetitorAlertsPanel`** (net-new) — surfaces recent `competitor_alerts` (keyword gained/lost, authority change, new keyword) with severity badges (critical → red, warning → amber, opportunity → emerald/teal). Read-only. `EmptyState` when none. Blue for data metrics (positions, volume).
4. **Server: a recent-alerts list** — add `listCompetitorAlerts(workspaceId, limit)` to `server/competitor-snapshot-store.ts` (ordered `created_at DESC`, the existing index) + a `GET /api/workspaces/:workspaceId/competitor-alerts` route.
5. **Rules-of-Hooks:** `useFeatureFlag('strategy-competitor-send')` MUST be read on its OWN line, never on the RHS of `commandCenterEnabled && useFeatureFlag(...)` (short-circuit makes the hook conditional — the documented crash from Phase 1). Mirror `KeywordStrategy.tsx`.

---

## Shared contracts (PRE-COMMIT — controller owns)

- **`shared/types/competitor-alerts.ts`** (new) — the API contract (a clean shared shape, decoupled from the server `CompetitorAlert` store interface):
  ```ts
  export type CompetitorAlertType = 'keyword_gained' | 'keyword_lost' | 'authority_change' | 'new_keyword';
  export type CompetitorAlertSeverity = 'critical' | 'warning' | 'opportunity';
  export interface CompetitorAlertView {
    id: string;
    competitorDomain: string;
    alertType: CompetitorAlertType;
    keyword: string | null;
    previousPosition: number | null;
    currentPosition: number | null;
    positionChange: number | null;
    volume: number | null;
    severity: CompetitorAlertSeverity;
    snapshotDate: string;
    createdAt: string;
  }
  export interface CompetitorAlertsResponse {
    workspaceId: string;
    alerts: CompetitorAlertView[];
  }
  ```
- **`src/routes.ts`** — add `'competitors'` to the `Page` union.
- **`src/lib/navRegistry.tsx`** — add `'competitors'` to `NON_REGISTRY_PAGES` with a rationale comment ("dedicated competitor interior page; reached via a deep-link from The Issue cockpit, not the global nav — keeps flag-OFF nav byte-identical").
- **`src/lib/queryKeys.ts`** — `admin.competitorAlerts: (wsId) => ['admin-competitor-alerts', wsId] as const`.

These four keep the `nav-registry-completeness` contract test green (Page union + NON_REGISTRY in lockstep).

---

## Lane B — Server (exclusive owner: `server/` non-test)

- Edit `server/competitor-snapshot-store.ts` — add `listCompetitorAlerts(workspaceId: string, limit = 50): CompetitorAlert[]` (SELECT … WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?, mapped via the existing row mapper). Use the lazy-prepared-stmt cache already in the file.
- Create `server/routes/competitor-alerts.ts` — `GET /api/workspaces/:workspaceId/competitor-alerts` → `CompetitorAlertsResponse`. `requireWorkspaceAccess`. Map each `CompetitorAlert` → `CompetitorAlertView` (null-coalesce the optional numerics). `createLogger`.
- Edit `server/app.ts` — mount the router.

## Lane C — Frontend (exclusive owner: `src/`)

- Create `src/api/competitorAlerts.ts` — `getCompetitorAlerts(workspaceId): Promise<CompetitorAlertsResponse>` (`GET /api/workspaces/:wsId/competitor-alerts`).
- Create `src/hooks/admin/useCompetitorAlerts.ts` — `useQuery` on `admin.competitorAlerts`, `enabled = !!workspaceId`, `staleTime` ~1h (alerts refresh weekly), invalidate on `WS_EVENTS.STRATEGY_UPDATED` via `useWorkspaceEvents`. Returns `{ alerts, isLoading, isError }`.
- Create `src/components/competitors/CompetitorAlertsPanel.tsx` — `SectionCard` "Competitor alerts"; one row per `CompetitorAlertView`: competitor domain + an alert-type label + the keyword + a position-change metric (blue, data law) + a severity `Badge` (critical→red, warning→amber, opportunity→emerald). `EmptyState` ("No competitor movement detected — the Monday check will surface gains/losses here.") when empty. Loading + error branches. Props `{ workspaceId }`. NO purple.
- Create `src/components/competitors/CompetitorsPage.tsx` — `{ workspaceId: string }`. `const navigate = useNavigate()`; `useKeywordStrategy(workspaceId)` + `useStrategySettings(...)` to derive `competitorList`/`seoDataAvailable`/`keywordGaps` (mirror `KeywordStrategyPanel`); read flags on SEPARATE lines (`commandCenterEnabled`, `competitorSendFlag`; `competitorSendEnabled = commandCenterEnabled && competitorSendFlag`). Render `PageHeader` (title "Competitors", `Users` icon) → `CompetitorAlertsPanel` → `StrategyCompetitiveTab` with the derived props. `LoadingState`/`EmptyState` while strategy loads.
- Edit `src/App.tsx` — `const CompetitorsPage = lazyWithRetry(() => import('./components/competitors/CompetitorsPage').then(m => ({ default: m.CompetitorsPage })))`; add `if (tab === 'competitors' && selected) return <CompetitorsPage key={\`competitors-${selected.id}\`} workspaceId={selected.id} />;` in `renderContent`.
- Edit `src/components/KeywordStrategy.tsx` — in `issueOverviewEl` (flag-ON only), add a deep-link to the competitors page (e.g. a `Button variant="link"` near the competitor/orient surfaces: `navigate(adminPath(workspaceId,'competitors'))`, label "Competitor intelligence →"). Do NOT touch the flag-OFF path or the existing `?tab=competitive` interior tab.
- Edit `BRAND_DESIGN_LANGUAGE.md` — note the Competitors page + alert-severity badge map.

## Lane D — Tests (exclusive owner: `tests/`)

- `tests/unit/competitor-alerts-store.test.ts` — `listCompetitorAlerts` returns rows newest-first, respects the limit, workspace-scoped (a second workspace's alerts excluded); empty when none.
- `tests/integration/competitor-alerts-route.test.ts` — `GET /api/workspaces/:ws/competitor-alerts` returns 200 + `{ workspaceId, alerts }`; a seeded alert is mapped to the `CompetitorAlertView` shape (severity + positionChange present); newest-first.
- The `nav-registry-completeness` contract test already covers the new Page once it's in `NON_REGISTRY_PAGES` (no edit needed — verify it stays green).

---

## Acceptance gates (controller)

- [ ] typecheck · vite build · full vitest · pr-check 0 errors · verify:feature-flags.
- [ ] `nav-registry-completeness` green (Page union + NON_REGISTRY in lockstep).
- [ ] Flag-OFF: no new global nav item; the `?tab=competitive` interior tab + every existing surface byte-identical; the cockpit deep-link only renders flag-ON.
- [ ] No Rules-of-Hooks violation (competitor-send flag on its own line).
- [ ] Reuse verified: `CompetitorsPage` uses the existing `StrategyCompetitiveTab` composition, not re-implemented competitor renders.
- [ ] Scaled adversarial review; fix all Critical/Important; re-gate.
- [ ] FEATURE_AUDIT #525 → Phase 0–6; roadmap; memory boundary.
