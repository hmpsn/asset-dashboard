# Client Dashboard IA Restructure — Pre-Plan Audit

**Date:** 2026-06-21
**Spec / source of truth:** `docs/superpowers/audits/2026-06-21-client-ia-tournament.md` (owner-ratified) + `docs/superpowers/audits/2026-06-21-client-tab-ia-persona-audit.md`
**Method:** 6 parallel read-only Explore scans of the entire client surface (`src/components/client/`, `src/routes.ts`, `server/roi.ts`, `shared/types/`, `tests/`, `scripts/pr-check.ts`).
**Goal:** prove exhaustive scope (every file the 5-phase plan must touch) before writing implementation plans, and surface reusable infrastructure + prevention gaps.

**Headline finding — P1 is mostly wiring, not building.** The two persona-gut-check refinements that "added" to P1 already exist in code: the typed `byType` rollup is assembled at [`OverviewTab.tsx:166-180`](../../../src/components/client/OverviewTab.tsx) and the named-lead list is a complete feature (`useClientMyLeads` + `IssueYourLeadsSection` + authed `/my-leads` endpoint). The only genuine new data work in P1 is the real month-over-month delta in `computeROI()`.

---

## Current IA — the 11-tab surface (verified inventory)

`ClientTab` union — [`src/routes.ts:25`](../../../src/routes.ts): `overview · performance · search · health · strategy · analytics · inbox · plans · roi · content-plan · brand`. Canonical render list `KNOWN_CLIENT_TABS` — [`src/lib/client-dashboard-tab.ts:28-38`](../../../src/lib/client-dashboard-tab.ts) (9 entries; `search`/`analytics` alias → `performance`).

| Current tab | Component | → Target bucket | Phase |
|---|---|---|---|
| `overview` | `OverviewTab.tsx` (spine path → `the-issue/TheIssueClientPage.tsx`) | **Overview** (reframe) | P1 |
| `inbox` | `InboxTab.tsx` → `inbox/UnifiedInbox.tsx` | **Inbox** (+ content review) | P3 |
| `roi` | `ROIDashboard.tsx` | **Results** (rename + promote + attribution) | P2/P4 |
| `performance` | `PerformanceTab.tsx` (sub-tabs Search/Analytics) | **Deep Dive › Analytics** | P2 |
| `search` (alias) | `SearchTab.tsx` | **Deep Dive › Analytics** | P2 |
| `analytics` (alias) | `AnalyticsTab.tsx` | **Deep Dive › Analytics** | P2 |
| `health` | `HealthTab.tsx` (+ `health-tab/*`) | Overview chip + **Deep Dive › Analytics** pinned fix-list | P1 chip / P2 fold |
| `strategy` | `StrategyTab.tsx` (interior overview/content/rankings/competitive) | **Deep Dive › Rankings** | P2 |
| `content-plan` | `ContentPlanTab.tsx` | Inbox approvals + **Deep Dive › Rankings** collapsed roadmap | P3 |
| `plans` | `PlansTab.tsx` | **Settings** | P2 |
| `brand` | `BrandTab.tsx` | **Settings** | P2 |
| *(new)* | — | **Deep Dive** shell (`?tab=deep-dive`, sub-tabs) | P2 |
| *(new, conditional)* | — | **Locations** (`client-locations` flag, >1 location) | P5 |

**Nav / routing files that change on any tab add/remove/rename** (route-removal-checklist scope): [`src/routes.ts`](../../../src/routes.ts) (union + aliases), [`src/lib/client-dashboard-tab.ts`](../../../src/lib/client-dashboard-tab.ts) (`KNOWN_CLIENT_TABS`, `resolveClientTab`), [`src/components/ClientDashboard.tsx`](../../../src/components/ClientDashboard.tsx) (lazy imports `:70-79`, `panels` object `:693-762`, query hooks `:116-131`), [`src/components/client/client-dashboard/clientDashboardNav.ts:21-54`](../../../src/components/client/client-dashboard/clientDashboardNav.ts) (`buildClientDashboardNav`), [`src/components/client/ClientHeader.tsx:242-292`](../../../src/components/client/ClientHeader.tsx) (tab bar + badges), [`src/App.tsx:111-139`](../../../src/App.tsx) (ClientRoutes + redirects), and the deep-link senders listed below.

---

## P1 scope — Overview reframe + real MoM delta (file:line)

The reframe lives in the **spine-ON path**: `OverviewTab.tsx` (gated by `strategy-the-issue` at `:117`, mounts `TheIssueClientPage`) → `the-issue/TheIssueClientPage.tsx` (spine flag `:140/:203`) → `the-issue/IssueVerdictHeadline.tsx` + `the-issue/OutcomeCountBand.tsx`.

| P1 item | Status today | Files / lines to change |
|---|---|---|
| **(a) Typed outcome breakout in hero** | `byType` rollup ALREADY built ([`OverviewTab.tsx:166-180`](../../../src/components/client/OverviewTab.tsx)); `OutcomeCountBand` already type-orders + icons ([`OutcomeCountBand.tsx:31-42,89-114`](../../../src/components/client/the-issue/OutcomeCountBand.tsx)); `IssueVerdictHeadline` does NOT yet render byType in the hero | Render `byType` row in `IssueVerdictHeadline.tsx` (hero); pass-through already exists at `OverviewTab.tsx:211` |
| **(b) Clickable count → named-lead list** | Named-lead list fully built: `useClientMyLeads` ([`src/hooks/client/useClientMyLeads.ts`](../../../src/hooks/client/useClientMyLeads.ts)), `getMyLeads` ([`src/api/conversionTracking.ts:102-104`](../../../src/api/conversionTracking.ts)), `IssueYourLeadsSection.tsx`, endpoint `GET /api/public/export/:workspaceId/my-leads` ([`server/routes/the-issue-export.ts:55-70`](../../../server/routes/the-issue-export.ts), authed, gated `the-issue-client-return-hook`). `namedRecordsAvailable` hardcoded `false` ([`OverviewTab.tsx`](../../../src/components/client/OverviewTab.tsx)) | Add onClick/disclosure on `OutcomeCountBand.tsx` StatCard → open/deep-link `IssueYourLeadsSection`; honest "available with tracking" when return-hook OFF |
| **(c) Real month-over-month delta** | `computeROI()` has NO prior-period field; `outcomeVerdict` shape [`shared/types/roi.ts:56-76`](../../../shared/types/roi.ts) lacks `priorPeriodCount`/`monthOverMonthPercent`; client builds units with hardcoded `baseline:null, priorPeriod:null` ([`OverviewTab.tsx:158-159`](../../../src/components/client/OverviewTab.tsx)). Copy pattern: `computeGrowthPercent()` [`server/roi.ts:68-85`](../../../server/roi.ts). Snapshots: `loadGa4SnapshotHistory` / `getEarliestGa4Snapshot` ([`server/ga4-snapshots.ts`](../../../server/ga4-snapshots.ts)). Render already handles it: `OutcomeCountBand.trendSub()` [`:54-71`](../../../src/components/client/the-issue/OutcomeCountBand.tsx) (incl. `establishing your baseline` empty-state at `:65`) | `shared/types/roi.ts` (+2 fields); `server/roi.ts:358-400` (find ~30-day-prior snapshot, re-aggregate pinned outcomes, null when <2 snapshots in window); thread server `priorPeriod` into `OverviewTab.tsx:158-159`. Serialization automatic (rides `GET /api/public/roi/:workspaceId`, [`server/routes/stripe.ts:329`](../../../server/routes/stripe.ts)) |
| **(d) Demote health score → chip** | 0-100 ring at hero via `HealthScoreCard`/`NarratedStatusHeadline` MetricRing (88px) | Render small health Badge inline in `IssueVerdictHeadline.tsx`; keep MetricRing only in the "under the hood" slot (`TheIssueClientPage.tsx:323`) |
| **(e) Demote insights feed → "see detail" link** | `InsightsDigest` full 3/5-col render | Collapse behind `<details>` / link-out in `TheIssueClientPage.tsx` spine-ON (insert ~`:305`) |
| **(f) Cut predictions + byline** | `PredictionShowcaseCard` at legacy `OverviewTab.tsx:528-530` (NOT in spine path); "Curated by your strategist" byline KEPT deliberately at `IssueVerdictHeadline.tsx:16-19,104-108` | ⚠️ **Decision point** — tournament says cut byline; current code keeps it as the curation moat. See Open Decisions. Predictions already absent from spine path. |

**P1 flag:** add `client-ia-v2` (gates the new hero shape; flag-OFF = byte-identical) + declare `client-locations` (P5, dark). Catalog: [`shared/types/feature-flags.ts`](../../../shared/types/feature-flags.ts) — add to `FEATURE_FLAGS` (`:12`), `FEATURE_FLAG_CATALOG` (`:189`), and the `'The Issue (Client)'` group in `FEATURE_FLAG_GROUPS` (`:520-553`).

---

## Later-phase scope (P2–P5, file:line — for phasing, not P1)

- **P2 (Deep Dive shell + Results rename + health fold + settings):** merge `AnalyticsTab.tsx` (`:1-639`), `SearchTab.tsx` (`:1-280`), `PerformanceTab.tsx` (`:27-165` — sub-tab precedent, uses `/* tab-deeplink-ok */`), `StrategyTab.tsx` (`:54-970`), `HealthTab.tsx` (+ `health-tab/*`) under a new `DeepDiveTab.tsx` with `Analytics`/`Rankings` sub-tabs; new `DeepDiveTab` MUST read `searchParams.get('tab')` (contract test below) or carry `/* tab-deeplink-ok */`. Rename `roi`→`Results` (nav `clientDashboardNav.ts:51`, union, `KNOWN_CLIENT_TABS`). Move `plans`+`brand` → a settings home (**must confirm one exists** — Open Decision). `client-ia-v2` gates the nav swap.
- **P3 (content into Inbox):** route `ContentTab.tsx` (`:64-350+`, has `soloRequestId` solo mode) + `ContentPlanTab.tsx` (`:18-150+`) into Inbox › Reviews; precedent = `SchemaReviewModal.tsx` (`:29-54`, full-screen `--z-modal-fullscreen`). Alias already half-wired: `routes.ts:29-34` maps `content→reviews`. Cut `content`/`content-plan` tabs; roadmap view → collapsed Deep Dive › Rankings.
- **P4 (Share/Export + per-piece attribution):** `ROIDashboard.tsx` (`:84-210+`, `ROIMethodologyDisclosure:29-82`); per-article data exists but is NOT mapped — `contentPerformance.publicGet` ([`ContentTab.tsx:130-148`](../../../src/components/client/ContentTab.tsx)) returns `{requestId, gsc, ga4}`. **Gate D:** provenance + banded `~$` must travel into any export artifact.
- **P5 (multi-location, separate track):** **confirmed server-only** — `server/client-locations.ts` (`:1-207`, full CRUD), `shared/types/local-seo.ts` (`ClientLocation:119-155`, `LocalVisibilitySnapshot.matchedLocationId:283`), `src/api/localSeo.ts` (`:34-79`). **Zero client components, zero public serialization, zero nav entry.** Leaderboard hero + Locations drill-down + location filters are all net-new.

---

## Reusable infrastructure (use, don't rebuild)

1. **Typed outcome data** — `IssueOutcomeCount` / `OutcomeTypeBreakdown` ([`shared/types/the-issue.ts:22-46`](../../../shared/types/the-issue.ts)) + `OutcomeType` ([`shared/types/outcome-tracking.ts`](../../../shared/types/outcome-tracking.ts)) + `OutcomeCountBand` render. P1 hero reuses `outcomeCount.byType`.
2. **Named-lead capture** — `useClientMyLeads` + `IssueYourLeadsSection` + `/my-leads` endpoint. P1 clickable-count reuses this verbatim.
3. **Trend rendering + honest empty-state** — `OutcomeCountBand.trendSub()` already renders both deltas and `establishing your baseline`. No new render code for (c); only feed it real numbers.
4. **30-day-prior snapshot lookback** — `computeGrowthPercent()` ([`server/roi.ts:68-85`](../../../server/roi.ts)) is the exact pattern to copy for outcome MoM.
5. **Full-screen modal-in-Inbox** — `SchemaReviewModal` is the P3 precedent for content review modals.
6. **Sub-tab + deep-link** — `PerformanceTab` shows the internal-sub-tab + `tab-deeplink-ok` pattern for P2's Deep Dive.

---

## Prevention (must ship with the work)

- **Deep-link contract** — [`tests/contract/tab-deep-link-wiring.test.ts:284-396`](../../../tests/contract/tab-deep-link-wiring.test.ts) statically verifies every `?tab=` sender has a receiver that reads `searchParams.get('tab')`. P2's `DeepDiveTab` + the `roi→results` rename must keep this green. pr-check mirror: `scripts/pr-check.ts:3844-3886` (`TabBar` without `?tab=`).
- **Flag-OFF byte-identical** — every phase ships a DOM-snapshot parity test with `client-ia-v2` OFF (precedent: `OverviewTab.measuredFlagOff.test.tsx`).
- **Flag-ON real-render smoke** — exercise the real client read path `GET /api/public/roi/:workspaceId` + `GET /api/public/workspace/:id`, not the admin route (CLAUDE.md "integration tests must cover the actual read path").
- **Rules-of-Hooks** — `npm run lint:hooks` gate + the real-transition test (`OverviewTab.flagTransition.test.tsx`) guard the conditional-hook class of bug that the local soak caught.
- **Feature-flag consistency** — `npm run verify:feature-flags`; both new flags need `FEATURE_FLAGS` + `FEATURE_FLAG_CATALOG` (lifecycle) + a `FEATURE_FLAG_GROUPS` entry.
- **New prevention to add** — a contract test asserting `KNOWN_CLIENT_TABS` matches the `panels` keys in `ClientDashboard.tsx` (catches the lazy-import/panel/nav lockstep drift that an 11→4 collapse risks).

---

## Parallelization + model assignments

**Phase-per-PR (CLAUDE.md):** P1 → merge+green → P2 → … P5 is an independent track. Within a phase:

| Phase | Parallelism | Model guidance |
|---|---|---|
| **P1 Phase 0** (declare flags) | sequential, commit first | Haiku (mechanical catalog edit) |
| **P1 server MoM** (roi.ts + shared type + integration test) | 1 owner | Sonnet (data logic, snapshot lookback) |
| **P1 client** (hero byType, clickable leads, health chip, insights link, CTAs — distinct files/components) | 2-3 parallel by component ownership (`IssueVerdictHeadline` / `OutcomeCountBand` / `TheIssueClientPage`) | Sonnet |
| **P1 verification** | sequential gate | Opus (full-context parity + smoke judgment) |
| **P2** | parallel by source tab → Deep Dive sub-section (exclusive file ownership per tab) | Sonnet; Opus for the nav/contract wiring |
| **P5** | independent track | Sonnet build, Opus for provenance-blending review |

File-ownership rule: in P1 client work, `IssueVerdictHeadline.tsx`, `OutcomeCountBand.tsx`, and `TheIssueClientPage.tsx` are separately owned to avoid edit collisions; `OverviewTab.tsx` (the data-assembly seam) is single-owner.

---

## Open decisions (carried from tournament §8; only ⚠️ ones touch P1)

1. ⚠️ **"Curated by your strategist" byline** — tournament/skeptic say cut it (agency self-grading = distrust trigger); current code keeps it as the deliberate human-curation moat ([`IssueVerdictHeadline.tsx:16-19`](../../../src/components/client/the-issue/IssueVerdictHeadline.tsx)). **Owner call needed for P1.** Plan default: keep it (less destructive; reversible), implement the rest of P1, and let the built surface's persona review settle it.
2. Deep Dive label (P2). 3. Settings home exists? (blocks P2). 4. Consulting Content fast-follow? 5. Banded-$ export wording (blocks P4).

**Next:** writing-plans → `docs/superpowers/plans/2026-06-21-client-ia-p1-overview-reframe.md` (this audit is the verified scope).
