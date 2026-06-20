# The Issue — Client P1b Implementation Plan (setup-readiness checklist + export one-pager + named-leads)

> **Status:** Implementation plan — **review gate before any code.** **Date:** 2026-06-20. **Scope:** the P1b bundle (admin setup-readiness checklist + client export one-pager + named-leads). Builds on committed P0 + P1a (HEAD 905556c97). **Sequence (owner-locked):** build P1b → P1c (push) → ONE staging soak + legacy cutover/teardown → P2. **Export feasibility:** NO PDF library in the repo → print-from-browser HTML (brief-export precedent), NOT a server PDF renderer.
> For agentic workers: REQUIRED SUB-SKILL — subagent-driven-development or executing-plans. Steps use - [ ] checkboxes; strict TDD.

**Goal:** Ship the P1b bundle — an admin setup-readiness checklist (the integrity guard that earns a trustworthy number), a client-exported forwardable one-pager (the budget-defense / anti-hostage artifact), and named-leads surfacing (admin sees captured leads with PII; client sees their own leads) — on the committed P0/P1a measured-capture substrate, fully flag-gated and byte-identical when OFF.

**Architecture:** Three concerns ride one shared server contract layer: (1) a PII-free `SetupReadinessState` rollup feeding the admin cockpit checklist with one-click gap deep-links, (2) a segment-aware `OnePagerExportPayload` rendered as print-optimized HTML (browser print-to-PDF — there is NO PDF library, this is confirmed), and (3) `NamedLeadView` reads exposed ONLY behind admin (`requireWorkspaceAccess`) or authed client-portal (`requireAuthenticatedClientPortalAuth`) guards — never on any public unauthed payload (the D7 invariant). Everything reuses the already-declared, default-OFF child flags `the-issue-client-measured-capture` (admin readiness + admin leads) and `the-issue-client-return-hook` (client export + client leads); no new flag is created. When both flags are OFF the public payloads (`/api/public/roi`, `/api/public/workspace`) and the existing admin/client surfaces are byte-identical to HEAD.

**Tech stack:** React 19 + Vite 8 + TailwindCSS 4 + React Router DOM 7 (frontend), Express + TypeScript (backend), SQLite via better-sqlite3. Server-rendered print-optimized HTML (`@page` + `@media print`) following the `server/brief-export-html.ts` / `server/post-export-html.ts` precedent. React Query for all frontend data; Zod via `validate()` middleware; Pino logging; Vitest for unit/integration/component, Playwright for E2E.

---

## ⬛ FEASIBILITY VERDICT

| Dimension | Verdict |
|-----------|---------|
| **Overall** | **HIGHLY FEASIBLE.** All P1a substrate is shipped + tested at HEAD. Every signal the readiness checklist needs is already captured and accessible. |
| **EXPORT MECHANISM (load-bearing — stated plainly)** | **There is NO PDF library in this codebase.** `package.json:74-128` contains `sharp`, `docx`, `cheerio`, `nodemailer` — and **zero** PDF engines (no `puppeteer`, `jspdf`, `html2canvas`, `@react-pdf`, `pdfkit`). **The export is print-from-browser: server-renders a print-optimized HTML document (`@page` + `@media print` CSS + a `.no-print` "Print / Save as PDF" button), the client opens it in a new tab and uses the browser's native print-to-PDF.** This mirrors the proven `server/brief-export-html.ts` pattern wired at `server/routes/content-briefs.ts:229-235`. **Do NOT add a PDF dependency. Do NOT build a server-side PDF renderer.** Any task that assumes `jsPDF` / `puppeteer` / `@react-pdf` is built on a false assumption and must be rejected. |
| **Readiness checklist** | Highly feasible — `ConversionTrackingReadout` (self-contained, props-only) is re-mounted in the cockpit; the deep-link `onClick` targets all resolve to existing `workspace-settings?tab=connections\|dashboard` controls (two-halves `?tab=` contract already satisfied by `WorkspaceSettings.tsx:85-107`). |
| **Named-leads (admin)** | Highly feasible — `loadFormSubmissions` exists (admin-only, returns full PII) but is never HTTP-exposed; a new `requireWorkspaceAccess` route is ~30 LOC. |
| **Named-leads (client, own leads)** | Feasible — a new `requireAuthenticatedClientPortalAuth` route. PII rides ONLY because the guard authenticated the caller; the `/api/public/` path prefix is a routing convention, not an auth statement. |
| **Segment resolution** | Already working — `ResolvedSegmentProfile.exportProfile` is resolved server-side (`server/workspaces.ts:96-106`); no new server mechanism needed. |
| **Flag family** | Already declared, all OFF — no new flag. `verify:feature-flags` stays green. |

---

## ⬛ DECISION REGISTER (owner-locked)

| # | Decision | Rationale |
|---|----------|-----------|
| **DR-1** | **The readiness checklist is bundled as the FRONT-HALF of P1b** (admin integrity guard ships in the same bundle PR as the client export). | The export's credibility depends on the number being trustworthy; the checklist is what earns it. They ship together. |
| **DR-2** | **The readiness checklist is in-product, NOT a static doc.** | It is a live, per-client `SetupReadinessState` rollup with one-click gap deep-links mounted in the cockpit spine — not a markdown checklist. |
| **DR-3 (D7 PII boundary)** | **Named-lead PII (`leadName`/`leadEmail`/`leadMessage`) is exposed ONLY via an authed client surface** (`requireAuthenticatedClientPortalAuth`) or the admin surface (`requireWorkspaceAccess`). **NEVER on `/api/public/roi`, `/api/public/workspace`, or any `client-safe.ts` serializer.** | The public payload already emits anonymous counts only (`{ga4Count, capturedCount}`, `formCaptureConnected` boolean). PII never rides the public payload. This is the load-bearing invariant of the whole bundle. |
| **DR-4** | **Export = print-from-browser HTML.** No PDF library, no server PDF renderer. | Audit-confirmed zero PDF deps; matches the brief/post export precedent exactly. |
| **DR-5** | **Export is NOT tier-gated.** | Spec: the forwardable one-pager is the anti-hostage guard for all segments. No `<TierGate>`. |
| **DR-6** | **No new feature flag.** Admin readiness + admin leads ride `the-issue-client-measured-capture`; client export + client leads ride `the-issue-client-return-hook`. | Both children are already declared OFF in the catalog with distinct `linkedRoadmapItemId`s. |
| **DR-7** | **The client one-pager export payload (`OnePagerExportPayload`) carries NO PII.** Lead PII rides the separate `NamedLeadView` reads, embedded into the export HTML by Lane C ONLY on the authed surface. | Keeps the data payload clean and the PII boundary auditable in one place. |
| **DR-8 (scope fence)** | **P1c (SMS/email push delivery) is OUT.** Do NOT wire `broadcastToWorkspace` push triggers. The `the-issue-client-return-hook` flag gates the export SURFACE only. | Phase-per-PR discipline. The big admin reframe beyond the checklist stays deferred. |

---

## ⬛ TASK DEPENDENCY GRAPH

```
                          ┌─────────────────────────────────────────────┐
                          │  LANE A — contracts + assemblers + endpoints │
                          │  (dependency root; ships FIRST as PR 1)      │
                          │  A1 types → A2 readiness → A3 export-data     │
                          │  → A4 admin status ext → A5 admin leads       │
                          │  → A6 client export+my-leads                  │
                          └───────────────┬─────────────────────────────┘
                                          │ (A's shared types + route signatures committed)
                          ┌───────────────┴───────────────┐
                          ▼                                ▼
        ┌──────────────────────────────┐   ┌──────────────────────────────────┐
        │ LANE B — admin readiness UI  │   │ LANE C — client export one-pager  │
        │ + admin named-leads readout  │   │ UI + client's-own-leads view      │
        │ (parallel with C)            │   │ (parallel with B)                 │
        └──────────────┬───────────────┘   └──────────────────┬───────────────┘
                       └──────────────┬─────────────────────┘
                                      ▼
                   ┌──────────────────────────────────────────┐
                   │ LANE D — D7 PII-leak tests + flag-OFF     │
                   │ byte-identical + DOM-probe + full gate    │
                   │ (RED tests authored FIRST against A's     │
                   │  contracts; flips GREEN as B/C land;       │
                   │  commits LAST in the same PR)             │
                   └──────────────────────────────────────────┘
```

**Ordering rule:** Lane A is a standalone first PR. **Nothing in B/C/D starts until Lane A's shared-type contract files and route signatures are committed + green.** B and C run in parallel (zero file overlap). Lane D's RED tests are authored first against A's pre-committed contracts and flip GREEN as B/C land; D commits last but in the same bundle PR as B/C so CI never sees a permanently-red committed test.

---

## ⬛ EXCLUSIVE FILE OWNERSHIP

| Lane | Creates | Modifies (owned regions) |
|------|---------|--------------------------|
| **A** | `server/the-issue-readiness.ts` · `server/the-issue-export.ts` · `server/the-issue-one-pager-html.ts` · `server/routes/the-issue-export.ts` · `tests/unit/the-issue-p1b-contracts.test.ts` · `tests/unit/the-issue-readiness.test.ts` · `tests/unit/the-issue-export-assembler.test.ts` · `tests/unit/the-issue-one-pager-html.test.ts` · `tests/integration/the-issue-p1b-readiness-status.test.ts` · `tests/integration/the-issue-p1b-client-export.test.ts` | `shared/types/the-issue.ts` (append the three interfaces) · `server/routes/the-issue-conversion-tracking.ts` (A4 + A5 additions) · `server/app.ts` (one router mount) · `src/api/conversionTracking.ts` (`readiness` field on `ConversionTrackingStatus` + export/my-leads wrappers) |
| **B** | `src/components/strategy/issue/AdminLeadsReadout.tsx` · `src/components/strategy/issue/IssueSetupReadiness.tsx` · `src/hooks/admin/useAdminLeads.ts` · `tests/integration/the-issue-admin-leads.test.ts` · `tests/component/admin-leads-hook.test.tsx` · `tests/component/admin-leads-readout.test.tsx` · `tests/component/issue-setup-readiness.test.tsx` · `tests/component/issue-cockpit-readiness-flag-off.test.tsx` | `server/form-submissions.ts` (add `loadFormSubmissionsPaged` + paged stmt) · `server/routes/the-issue-conversion-tracking.ts` (paginated admin leads route — see ownership note) · `src/components/settings/ConversionTrackingReadout.tsx` (additive optional `onClick` on `ConversionSetupStep`) · `src/lib/queryKeys.ts` (`admin.formSubmissions`) · `src/components/KeywordStrategy.tsx` (cockpit mount) |
| **C** | `server/the-issue-one-pager.ts` · `src/hooks/client/useClientMyLeads.ts` · `src/components/client/the-issue/IssueExportBar.tsx` · `src/components/client/the-issue/IssueYourLeadsSection.tsx` · `tests/unit/the-issue-one-pager-assembler.test.ts` · `tests/unit/the-issue-client-api.test.ts` · `tests/integration/the-issue-client-export.test.ts` · `tests/component/the-issue-export-bar.test.tsx` | `src/api/theIssue.ts` (append) · `src/lib/queryKeys.ts` (`client.myLeads` — coordinate with B; separate line) · `src/hooks/client/index.ts` (one export) · `src/components/client/the-issue/TheIssueClientPage.tsx` (spine-ON branch only) |
| **D** | `tests/integration/the-issue-p1b-readiness.test.ts` · `tests/integration/the-issue-p1b-export.test.ts` · `tests/integration/the-issue-p1b-named-leads.test.ts` · `tests/component/the-issue-p1b-readiness-checklist.test.tsx` · `tests/component/the-issue-p1b-client-export.test.tsx` · `tests/component/the-issue-p1b-flag-off-domprobe.test.tsx` | `tests/unit/the-issue-client-flags.test.ts` (append a `describe` only) |

**Cross-lane ownership notes (resolve at dispatch, single owner each):**
- **`server/the-issue-readiness.ts`** — Lane A owns it. (Drift in the drafts called it `assembleIssueSetupReadiness`; the canonical name is **`assembleSetupReadiness`** returning **`SetupReadinessState`** — see Name Reconciliation below.) Lane B never creates this file.
- **The one-pager HTML renderer** — Lane A owns `server/the-issue-one-pager-html.ts` and `server/the-issue-export.ts` (the export-DATA assembler). Lane C owns `server/the-issue-one-pager.ts` only if a distinct assembler is needed — **resolved below: there is ONE assembler (`assembleOnePagerExport` in `server/the-issue-export.ts`, Lane A) and ONE renderer (Lane A). Lane C does NOT create a second assembler.** (See Name Reconciliation.)
- **`server/routes/the-issue-conversion-tracking.ts`** — both A (A4 readiness field + A5 admin leads route) and B (paginated admin leads) touch it. **Resolved: Lane A ships the basic admin leads route in A5; Lane B's pagination is folded INTO A5 (one route, paginated, owned by Lane A) — see Name Reconciliation / Self-Review.** B consumes it; B does not add a second leads route.
- **`server/routes/the-issue-export.ts`** — Lane A owns the client-authed export + my-leads router (the drafts had Lane A and Lane C both proposing this router under different names; **canonical: Lane A owns `server/routes/the-issue-export.ts`**, Lane C consumes via API wrappers).
- **`src/lib/queryKeys.ts`** — B adds `admin.formSubmissions`, C adds `client.myLeads`. Different blocks, different lines; controller diff-reviews for conflict.

---

## ⬛ MODEL ASSIGNMENTS (Anthropic ladder)

| Lane / Task class | Model |
|-------------------|-------|
| Lane A — shared types, server assemblers, endpoints (cross-context, D7-critical) | **Opus** for A1 (contract), A6 (D7 client-authed reasoning); **Sonnet** for A2–A5 |
| Lane B — typed contract + endpoint + hook + checklist UI (local judgment) | **Sonnet** for B1–B5; **Opus** for B6 cockpit-mount integration + holistic flag-OFF parity |
| Lane C — server pure layer + client UI | **Sonnet** for C-server + C-UI; **Opus** for the TheIssueClientPage flag-branch integration |
| Lane D — test authoring | **Sonnet** for D1–D6 fixtures; **Opus** for the D7-leak holistic review gate (D8) |
| Final cross-lane review | **Opus** via `scaled-code-review` skill |

Haiku is not assigned — no purely mechanical task in this bundle.

---

## ⬛ NAME RECONCILIATION (cross-lane drift — locked before any code)

The four drafts used inconsistent identifiers. These are the **canonical** names; every task below uses them:

| Concept | CANONICAL | Rejected drift |
|---------|-----------|----------------|
| Readiness aggregate type | `SetupReadinessState` (in `shared/types/the-issue.ts`) | ~~`IssueSetupReadiness`~~, ~~`setupState`~~ |
| Readiness assembler fn | `assembleSetupReadiness(workspaceId): SetupReadinessState \| null` | ~~`assembleIssueSetupReadiness(ws)`~~ |
| Readiness assembler file | `server/the-issue-readiness.ts` | (consistent) |
| Export-data type | `OnePagerExportPayload` (in `shared/types/the-issue.ts`) | ~~`OnePagerPayload`~~ |
| Export-data assembler | `assembleOnePagerExport(workspaceId): OnePagerExportPayload \| null` | ~~`assembleOnePager(id, {includeLeads})`~~ |
| Export-data assembler file | `server/the-issue-export.ts` | ~~`server/the-issue-one-pager.ts`~~ |
| One-pager HTML renderer | `renderOnePagerHTML(payload): string` in `server/the-issue-one-pager-html.ts` | (consistent) |
| Named-lead view type | `NamedLeadView` (in `shared/types/the-issue.ts`) | ~~`AdminFormSubmissionView`~~, ~~`ClientLeadView`~~, ~~`AdminLeadsResponse`~~ |
| Admin/client lead read fn | `loadFormSubmissions` (exists) + `loadFormSubmissionsPaged` (new, Lane B-into-A5) | ~~`loadClientLeadViews`~~ |
| Client export route | `GET /api/public/export/:workspaceId/one-pager` | (consistent) |
| Client own-leads route | `GET /api/public/export/:workspaceId/my-leads` | ~~`/api/public/:workspaceId/my-leads`~~ (use the `/export/` prefix for both — one router) |
| Admin leads route | `GET /api/workspaces/:id/form-submissions` | (consistent) |
| Export client router | `server/routes/the-issue-export.ts` (Lane A) | ~~`server/routes/the-issue-client-export.ts`~~ |

**One assembler, one renderer, one payload type.** The "Lane C builds its own assembler/renderer/payload" path in the C draft is **rejected** — it duplicated Lane A. Lane C consumes Lane A's `assembleOnePagerExport` + `renderOnePagerHTML` via the route Lane A ships, and renders the in-app export affordance + my-leads view only.

**`NamedLeadView` carries PII fields** (`leadName`/`leadEmail` nullable). Both admin and client-own reads return the same shape; `leadMessage` stays admin-internal (omitted from the list view). The Lane B draft's distinction between an "admin PII view" and a "client-safe view" collapses into one `NamedLeadView` — the client legitimately sees their OWN leads' PII; the guard (not the shape) enforces the boundary.

---

# LANE A — contracts + assemblers + endpoints (dependency root · PR 1)

**Role:** Dependency root. Ships shared-type contracts + three assemblers (readiness, export-data, one-pager HTML) + the HTTP endpoints. B/C/D depend on these types and route signatures.

**Flag posture (VERIFIED — no new flag):**
- Readiness-state assembler + admin status endpoint → `the-issue-client-measured-capture`.
- Export-data assembler + client export endpoint → `the-issue-client-return-hook`.
- Admin named-leads read → `the-issue-client-measured-capture`.
- Client-authed "your leads" read → `the-issue-client-return-hook`.

**D7 invariant:** PII ONLY behind `requireWorkspaceAccess` (admin) or `requireAuthenticatedClientPortalAuth` (`server/middleware.ts:229`). Never extend `server/serializers/client-safe.ts` or the `/api/public/roi` / `/api/public/workspace` payloads with PII.

**Ordering within A:** A1 → A2 → A3 sequential (types before assemblers); A4/A5/A6 run in listed order (one owner, dependency root). Each task is a full RED → GREEN → COMMIT TDD cycle.

---

### A1 — Shared-type contracts (types-first)

- [ ] **RED** — Create `tests/unit/the-issue-p1b-contracts.test.ts`: a typed-fixture compile + presence test asserting `SetupReadinessState`, `OnePagerExportPayload`, `NamedLeadView` are importable from `shared/types/the-issue.ts`, and that `OnePagerExportPayload.exportProfile` is assignment-compatible with the non-null subset of `ResolvedSegmentProfile['exportProfile']`. Run → RED.
- [ ] **GREEN** — Append to `shared/types/the-issue.ts` (after the last export; reuse the existing `OutcomeProvenance`, `OutcomeTypeBreakdown`, `OutcomeBaseline`, `OutcomeType`, `ResolvedSegmentProfile`):

```ts
/**
 * P1b — admin setup-readiness rollup. Each signal is a ✓/⚠ gate the operator must clear to
 * produce a trustworthy outcome verdict. PII-FREE: counts + booleans + timestamps only (D7).
 * Backed by assembleSetupReadiness (server/the-issue-readiness.ts). Rides the ADMIN
 * conversion-tracking-status endpoint (requireWorkspaceAccess), never the public payload.
 */
export interface SetupReadinessState {
  ga4Connected: boolean;            // workspace.ga4PropertyId present
  valueSet: boolean;                // workspace.outcomeValue present
  basisOfValue: 'client_provided' | 'agency_estimate' | 'ai_enriched' | null;
  segmentConfirmed: boolean;        // admin-confirmed segmentConfig OR deterministic local/multi
  eventsPinned: boolean;            // ≥1 pinned eventConfig entry
  eventsTyped: boolean;             // ≥1 pinned event carrying an outcomeType
  webflowConnected: boolean;        // ≥1 webflowFormSources mapping
  conversionTrackingConfirmedAt: string | null;
  lastLeadAt: string | null;        // freshness of captured leads (count-only freshness, no PII)
  povDrafted: boolean;              // Strategy POV exists for the workspace
  /** Count of gates not yet cleared (drives the admin "N steps left" affordance). */
  openGapCount: number;
}

/**
 * P1b — the forwardable one-pager export payload (the "zero-edit board summary"). Assembled
 * server-side from computeROI().outcomeVerdict + curated top-moves + the segment exportProfile.
 * Carries NO PII (lead names ride the separate NamedLeadView reads, embedded by the renderer
 * only on the authed surface). NEVER on the public unauthed payload (D7).
 */
export interface OnePagerExportPayload {
  exportProfile: 'sms_recap' | 'board_one_pager' | 'partner_summary' | 'owner_portfolio';
  workspaceName: string;
  brandLogoUrl: string | null;
  outcomeNoun: string;              // resolved segment plural noun
  verdictSentence: string;          // pre-templated dollar verdict (client never re-derives)
  estimatedValue: number;
  monthlyRetainer: number | null;
  adSpendEquivalent: number;        // from ROIData.adSpendEquivalent
  valueVsRetainerRatio: number | null; // estimatedValue / monthlyRetainer, null when no retainer
  outcomeCount: number;
  outcomeUnitLabel: string;
  outcomeCountSinceStart: number | null; // baselineDeltaCount — the "since we started" frame
  baselineCapturedAt: string | null;
  outcomeTypeBreakdown: OutcomeTypeBreakdown[];
  topMoves: { title: string; estimatedGain: string }[]; // curated, client-safe (NO EMV/value)
  methodologyLine: string;          // provenance-aware honesty line
  provenance: OutcomeProvenance;
  /** Present ONLY when the renderer is fed leads on the authed surface; PII is the client's own. */
  leads?: NamedLeadView[];
  generatedAt: string;              // ISO
}

/**
 * P1b — named-lead view. Admin reads (requireWorkspaceAccess) and the client's OWN-leads read
 * (requireAuthenticatedClientPortalAuth) BOTH return this shape — the guard, not the shape,
 * enforces the boundary. NEVER public/unauthed (D7). leadMessage stays admin-internal (omitted).
 */
export interface NamedLeadView {
  id: string;
  formName: string;
  leadName: string | null;
  leadEmail: string | null;
  outcomeType: OutcomeType;
  submittedAt: string;
}
```

Re-run → GREEN. `npm run typecheck` clean.
- [ ] **COMMIT:** `feat(the-issue-p1b): Lane A — readiness/export/named-lead shared-type contracts`

---

### A2 — Readiness-state assembler

- [ ] **RED** — Create `tests/unit/the-issue-readiness.test.ts` using `seedWorkspace()`. Cases: (1) bare workspace → all gates false, `openGapCount === 7`, `basisOfValue === null`; (2) fully configured (`ga4PropertyId`, `outcomeValue`, `eventConfig` with a pinned+typed event, `webflowFormSources`, `conversionTrackingConfirmedAt`, `segmentConfig`) → all gates true, `openGapCount === 0`; (3) PII assertion — `JSON.stringify(result)` `.not.toContain('@')`, `.not.toContain('leadName')`, no key matching `/lead(Name|Email|Message)/`. Run → RED.
- [ ] **GREEN** — Create `server/the-issue-readiness.ts` (bounded context = analytics-intelligence / The Issue; sibling to `server/the-issue-outcome.ts`). Pure read-only assembler, no DB writes, no broadcast:

```ts
export function assembleSetupReadiness(workspaceId: string): SetupReadinessState | null
```

Grounded reads (all VERIFIED):
- `ga4Connected` ← `!!ws.ga4PropertyId` (`shared/types/workspace.ts:324`).
- `valueSet` / `basisOfValue` ← `ws.outcomeValue?.basis ?? null` (`:401-407`).
- `eventsPinned` ← `(ws.eventConfig ?? []).some(c => c.pinned)`; `eventsTyped` ← `.some(c => c.pinned && c.outcomeType)` (`:328`, `:22`) — mirrors `the-issue-conversion-tracking.ts:53,62`.
- `webflowConnected` ← `(ws.webflowFormSources?.length ?? 0) > 0` (`:443`).
- `conversionTrackingConfirmedAt` ← `ws.conversionTrackingConfirmedAt ?? null` (`:444`).
- `lastLeadAt` ← `getFormCaptureStatus(ws.id).lastSubmissionAt` (`server/form-submissions.ts:77` — count/freshness only, NO PII).
- `segmentConfirmed` ← `!!ws.segmentConfig` OR deterministic local/multi — reuse `resolveSegmentProfile(ws)` (`server/workspaces.ts:96-101`) discipline; do NOT re-implement the location read inline.
- `povDrafted` ← read via the Strategy POV module. **READ-BEFORE-WRITE:** `grep -n 'export' server/strategy-pov-generator.ts` for the existing "get/load POV" signature BEFORE wiring — do not guess the function name. If no cheap existence read exists, add `hasStrategyPov(workspaceId): boolean` there (one-way import, no cycle).
- `openGapCount` ← count of false/null required gates (`ga4Connected`, `valueSet`, `segmentConfirmed`, `eventsPinned`, `eventsTyped`, `webflowConnected`, `povDrafted`).
- Return `null` when `getWorkspace(workspaceId)` is null.

Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-p1b): Lane A — setup-readiness assembler (config signals → gates)`

---

### A3 — Export-data assembler + one-pager HTML renderer (segment-aware, print-from-browser)

> **DR-4 reminder:** NO PDF library. This task produces structured DATA (`OnePagerExportPayload`) and a print-optimized HTML string. The client browser does the print-to-PDF.

- [ ] **RED (assembler)** — Create `tests/unit/the-issue-export-assembler.test.ts`. Seed a workspace with CPC page-keywords + `outcomeValue` + a GA4 snapshot + `setWorkspaceFlagOverride('the-issue-client-spine', id, true)` (reuse the seeding pattern from `tests/integration/the-issue-client-roi-public.test.ts:30-47`). Cases: (1) no outcomeVerdict (flag OFF) → returns `null`; (2) hydrated → `estimatedValue === outcomeCount * valuePerOutcome`, `valueVsRetainerRatio` correct, `exportProfile` matches workspace segment, `topMoves.length <= 3`, `methodologyLine` matches provenance; (3) PII assertion — `JSON.stringify(payload)` `.not.toContain('@')`, no lead-name leakage. Run → RED.
- [ ] **GREEN (assembler)** — Create `server/the-issue-export.ts`:

```ts
export function assembleOnePagerExport(workspaceId: string): OnePagerExportPayload | null
```

Grounded reads:
- `computeROI(workspaceId)` (`server/roi.ts:171`) → use `roi.outcomeVerdict` (`:379-398`) + `roi.adSpendEquivalent` (`shared/types/roi.ts:28`). Return `null` if `roi` is null OR `roi.outcomeVerdict` undefined (honest degradation; inherits `computeROI`'s flag/outcomeValue gating at `:358`).
- `exportProfile` / `outcomeNoun` ← `resolveSegmentProfile(ws)` (`server/workspaces.ts:96`): `exportProfile` (fall back to `'board_one_pager'` if null), `outcomeNounPlural`.
- `workspaceName` ← `ws.name`; `brandLogoUrl` ← `ws.brandLogoUrl ?? null`.
- `estimatedValue`, `monthlyRetainer`, `outcomeCount`, `outcomeUnitLabel`, `provenance`, `outcomeTypeBreakdown` ← from `roi.outcomeVerdict` (`outcomeTypeBreakdown` may be absent on the P0/flag-OFF path → default `[]`).
- `outcomeCountSinceStart` ← `roi.outcomeVerdict.baselineDeltaCount` (`:386`); `baselineCapturedAt` ← `roi.outcomeVerdict.baseline.baselineCapturedAt`.
- `valueVsRetainerRatio` ← `monthlyRetainer ? estimatedValue / monthlyRetainer : null` (rate-display-shares-source: numerator + denominator both from `outcomeVerdict`).
- `verdictSentence` ← pre-templated server-side (e.g. `"${outcomeCount} ${outcomeNoun} ≈ $${estimatedValue.toLocaleString()} in value vs. a $${retainer} retainer"`). Client never re-derives.
- `topMoves` ← `loadRecommendations(workspaceId)` (`server/recommendations.ts:408`), filter with `isCuratedForClient` (`shared/recommendation-predicates.ts:40`, re-exported `recommendations.ts:657`), top 3 by `impactScore`, map to `{ title, estimatedGain }` — **client-safe fields only, NEVER `opportunity.value`/EMV** (mirror the public projection's strip).
- `methodologyLine` ← provenance-aware: `'measured_action'` → "Counts are website-native measured outcomes captured from your forms and tracked events." vs `'estimate_ga4'` → "Counts are estimated from GA4 key events; named-lead capture sharpens this as it accrues."
- `generatedAt` ← `new Date().toISOString()`.
- **NO PII in this payload** — `leads` is left undefined here; the route/renderer attaches `NamedLeadView[]` on the authed surface only.

Re-run → GREEN.
- [ ] **RED (renderer)** — Create `tests/unit/the-issue-one-pager-html.test.ts`. Build a fixture `OnePagerExportPayload`. Cases: (1) renders the dollar verdict + retainer ratio strings; (2) renders the outcome-count-with-N band + the "since we started" baseline label; (3) renders the methodology line verbatim; (4) when `leads` present → lead name/email appear, when absent → no empty leads table; (5) `esc()` neutralizes a `<script>`-bearing lead value (XSS guard on a forwardable doc); (6) `sms_recap` renders the compact variant (distinguishing marker e.g. `data-export-profile="sms_recap"`), `board_one_pager` the full layout; (7) uses `STUDIO_NAME`/`STUDIO_URL` not a hard-coded `"hmpsn.studio"`. Run → RED.
- [ ] **GREEN (renderer)** — Create `server/the-issue-one-pager-html.ts`:

```ts
export function renderOnePagerHTML(payload: OnePagerExportPayload): string
```

Mirror `server/brief-export-html.ts` exactly: `<!DOCTYPE>` + `@page` + `@media print` + a `.no-print` `.print-bar` with a teal "Print / Save as PDF" button, the hmpsn logo SVG, `esc()` on every interpolated value, `-webkit-print-color-adjust: exact`. Use `STUDIO_NAME`/`STUDIO_URL` from `server/constants.js` (never hard-code). Emit a `data-export-profile="<exportProfile>"` root attribute (Lane D segment-assertion hook). Layout: hero dollar verdict vs retainer + ratio + ad-spend-equivalent; outcome-count-with-N band + "since we started" delta; top moves; methodology honesty line in a muted footer; and when `payload.leads` present, a "Your captured leads" table (name/email/form/date). `sms_recap` → compact copy-pasteable recap card; the other three → full layout (board/partner/owner differ only in heading + frame label). `null` exportProfile defaults to board layout. **Print stylesheet uses literal hex** (this is a standalone print document, NOT an `src/components/` component — the Four-Laws token rule does not apply; still: teal action button, NO purple/violet/indigo).

Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-p1b): Lane A — one-pager export-data assembler + print HTML renderer (segment-aware)`

---

### A4 — Wire readiness onto the ADMIN status endpoint (extend, don't duplicate)

- [ ] **RED** — Create `tests/integration/the-issue-p1b-readiness-status.test.ts` (use `createEphemeralTestContext(import.meta.url, { contextName: 'p1b-readiness-status' })`). Seed a workspace, `setWorkspaceFlagOverride('the-issue-client-measured-capture', id, true)`. Hit `GET /api/workspaces/:id/conversion-tracking-status` with the admin `x-auth-token`. Assert `body.readiness` exists with the expected gate booleans; assert raw text `.not.toContain('leadName')` / `.not.toContain('@example')`. Flag-OFF case → endpoint returns 404 (existing behavior; readiness never leaks when OFF). Run → RED.
- [ ] **GREEN** — Extend the existing `GET /api/workspaces/:id/conversion-tracking-status` handler in `server/routes/the-issue-conversion-tracking.ts` (`:40-70`, already `requireWorkspaceAccess` + flag-gated on `the-issue-client-measured-capture`). Add `readiness: assembleSetupReadiness(ws.id)` to the JSON response (additive, admin-only — public payload untouched). Import `assembleSetupReadiness` at the top-of-file import group. Also update `src/api/conversionTracking.ts` `ConversionTrackingStatus` interface to add `readiness: SetupReadinessState | null` (typed boundary; B consumes it). Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-p1b): Lane A — readiness rollup on admin conversion-tracking-status`

---

### A5 — Admin named-leads read endpoint (operator sees captured leads, PII visible, paginated)

> **Folded:** Lane B's pagination requirement is built into THIS route (one route, paginated, owned by Lane A). Lane B consumes it; B does not add a second leads route.

- [ ] **RED** — Create `tests/integration/the-issue-admin-leads.test.ts` (`createEphemeralTestContext`, `seedWorkspace`, `setWorkspaceFlagOverride`):
  1. Flag-OFF → `GET /api/workspaces/:id/form-submissions` returns 404 (`res.sendStatus(404)`).
  2. Flag-ON, admin-authed → seed 2 `form_submissions` via `saveFormSubmission` with sentinel PII; assert 200, `body.total === 2`, `body.leads[0].leadEmail` present, ordered `submittedAt DESC`.
  3. Pagination `?limit=1&offset=0` → 1 lead, `total` still 2 (rate-display-shares-source: header N = full count, not page length).
  4. **D7 cross-check:** hit PUBLIC `GET /api/public/roi/:id` → assert the sentinel lead name/email are `.not.toContain()` (PII only on the admin route).
  Run → RED.
- [ ] **GREEN** —
  - In `server/form-submissions.ts`, add to `createStmtCache` (`:24-42`) a `selectByWorkspacePaged` prepared stmt (`... WHERE workspace_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?`) + an optional range-scoped variant; add `export function loadFormSubmissionsPaged(workspaceId, { limit, offset, startDate?, endDate? }): { leads: FormSubmission[]; total: number }` reusing `rowToFormSubmission` (`:44`) and `countFormSubmissions` (`:77`) for `total`. **createStmtCache only — no local `let stmt`.**
  - In `server/routes/the-issue-conversion-tracking.ts`, add `theIssueConversionTrackingRouter.get('/api/workspaces/:id/form-submissions', requireWorkspaceAccess(), validate(leadsQuerySchema), (req,res) => {...})`: workspace + flag guard (copy the `:44-52` pattern, flag = `the-issue-client-measured-capture`), then map `loadFormSubmissionsPaged(...)` `FormSubmission[]` → `NamedLeadView[]` explicitly (lockstep boundary; do not spread), respond `{ leads, total }`. Add `leadsQuerySchema = z.object({ limit: z.coerce.number().int().positive().max(200).optional(), offset: z.coerce.number().int().nonnegative().optional(), startDate: z.string().optional(), endDate: z.string().optional() })` (query validation via `validate()`). Read-only → no broadcast/activity.
  - Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-p1b): Lane A — admin named-leads endpoint (PII, requireWorkspaceAccess, paginated)`

---

### A6 — Client-authed export + "your leads" endpoints (client JWT, NEVER public unauthed)

> Both gated by `requireAuthenticatedClientPortalAuth` (`server/middleware.ts:229`) — NOT `requireClientPortalAuth` (passwordless-URL access is wrong for PII), and NEVER `requireAuth` (JWT-multi-user only). Both flag-gated on `the-issue-client-return-hook`.

- [ ] **RED** — Create `tests/integration/the-issue-p1b-client-export.test.ts` (`createEphemeralTestContext` with `autoPublicAuth: true`). Seed a workspace with `clientPassword`, save a `FormSubmission` with sentinel PII, set `outcomeValue` + GA4 snapshot, `setWorkspaceFlagOverride('the-issue-client-return-hook', id, true)` AND `the-issue-client-spine` (so `computeROI` hydrates). Cases:
  1. **Unauthenticated** GET `/api/public/export/:id/my-leads` → 401, and assert the body `.not.toContain()` the sentinel name/email (PII never escapes on the reject path).
  2. **Authenticated** GET `/api/public/export/:id/my-leads` → 200, sentinel name/email present (client may see their OWN leads).
  3. **Authenticated** GET `/api/public/export/:id/one-pager` → 200, `text/html`, contains verdict + methodology line; raw text `.not.toContain('@')` (one-pager DATA carries no PII unless leads attached — confirm the route's `includeLeads` decision below).
  4. **Flag-OFF** → both routes 404; PUBLIC `/api/public/roi/:id` + `/api/public/workspace/:id` byte-identical (no new fields).
  Run → RED.
- [ ] **GREEN** — Create `server/routes/the-issue-export.ts` (new client-facing router; admin-vs-client separation is the existing pattern). Mount in `server/app.ts` next to the conversion-tracking mount (`:366`). Routes:

```ts
// GET /api/public/export/:workspaceId/one-pager — segment one-pager HTML (authed; print-from-browser).
router.get('/api/public/export/:workspaceId/one-pager',
  requireAuthenticatedClientPortalAuth(),
  (req, res) => {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
    if (!isFeatureEnabled('the-issue-client-return-hook', ws.id)) { res.sendStatus(404); return; }
    const payload = assembleOnePagerExport(ws.id);
    if (!payload) { res.status(404).json({ error: 'Export not available — verdict not yet established' }); return; }
    // Attach the client's own leads (authed surface only); anonymous payload otherwise.
    const leads: NamedLeadView[] = loadFormSubmissions(ws.id).map(toNamedLeadView);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderOnePagerHTML({ ...payload, leads }));
  },
);

// GET /api/public/export/:workspaceId/my-leads — the CLIENT's OWN captured leads (authed PII, JSON).
router.get('/api/public/export/:workspaceId/my-leads',
  requireAuthenticatedClientPortalAuth(),
  (req, res) => {
    const ws = getWorkspace(req.params.workspaceId);
    if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
    if (!isFeatureEnabled('the-issue-client-return-hook', ws.id)) { res.sendStatus(404); return; }
    const leads: NamedLeadView[] = loadFormSubmissions(ws.id).map(toNamedLeadView);
    res.json({ leads });
  },
);
```

Define a shared `toNamedLeadView(s: FormSubmission): NamedLeadView` mapper (in this router or `the-issue-export.ts`) so admin (A5) and client reads stay lockstep. **Route ordering:** literal `/api/public/export/:workspaceId/*` mounted before any catch-all `/api/public/:workspaceId/*` param routes. Add API client wrappers in `src/api/conversionTracking.ts` (or a new `src/api/theIssueExport.ts`): `getOnePagerExportUrl(workspaceId)` (returns the URL — it's a navigable HTML doc, opened via `window.open`) and `getMyLeads(workspaceId)` (`getSafe<{leads: NamedLeadView[]}>` with `{ leads: [] }` fallback). No raw `fetch` in components.

Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-p1b): Lane A — client-authed one-pager + my-leads export endpoints (D7)`

---

### Lane A handoff contract (what B/C/D consume)
- **Lane B:** imports `SetupReadinessState`; consumes `readiness` from the extended status endpoint via `ConversionTrackingStatus`; consumes the paginated admin leads route `{ leads, total }`; re-mounts `ConversionTrackingReadout` + builds the deep-link `onClick` wiring.
- **Lane C:** imports `OnePagerExportPayload` + `NamedLeadView`; calls `getOnePagerExportUrl` (opens HTML in a new tab) + `getMyLeads`; renders the in-app export affordance + "your leads" view. **Lane C does NOT build a second assembler/renderer/payload.**
- **Lane D:** extends the byte-identical pattern; asserts (a) flag-OFF → no export/my-leads routes + no new public fields; (b) PII absent from EVERY public unauthed payload; (c) admin/client-authed routes return PII ONLY to authed callers.

### Lane A acceptance criteria (PR 1 — must all pass before B/C/D start)
- [ ] `npm run typecheck` (project-aware `tsc -b`) — zero errors.
- [ ] `npx vite build` — succeeds.
- [ ] `npx vitest run` (the new files, then the FULL suite) — green.
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (no bare `JSON.parse`; no `requireAuth` on admin/client routes — A5 uses `requireWorkspaceAccess`, A6 uses `requireAuthenticatedClientPortalAuth`; STUDIO_NAME literal in the renderer; imports at top).
- [ ] `npm run verify:feature-flags` — green (no new flag).
- [ ] **D7 manual grep gate:** `grep -rn "leadName\|leadEmail\|leadMessage" server/serializers/client-safe.ts server/routes/stripe.ts` → PII fields NOT added to any public serializer.
- [ ] Docs: `FEATURE_AUDIT.md` (P1b data layer), `data/roadmap.json` (mark Lane A item; `npx tsx scripts/sort-roadmap.ts`). No `BRAND_DESIGN_LANGUAGE.md` change (server/types only — the print HTML uses literal hex, not tokens).

---

# LANE B — admin setup-readiness checklist + named-leads readout

**Owns the admin front-half.** Re-mounts the reusable `ConversionTrackingReadout` + an `OnboardingChecklist`-modeled deep-linkable step list in the cockpit (KeywordStrategy spine), plus the admin named-leads readout (operator sees captured leads, PII admin-only). Gated on `the-issue-client-measured-capture`; byte-identical OFF.

**Dependency:** Hard dependency on Lane A's `SetupReadinessState` + `assembleSetupReadiness` + the paginated admin leads route + the extended `ConversionTrackingStatus`. **Lane B does NOT create `server/the-issue-readiness.ts` and does NOT add a second admin leads route** — both are Lane A's. `ConversionTrackingReadout` (`:63`) + `ConversionSetupStep` (`:23-28`) already exist; B re-mounts, never rewrites.

**Model:** Sonnet for B1–B4; Opus for B5 (cockpit-mount + holistic flag-OFF parity).

---

### B1 — Admin named-leads hook + queryKey (consumes A5)

- [ ] **RED** — Create `tests/component/admin-leads-hook.test.tsx`. With the API wrapper mocked, assert the hook does NOT fetch when `enabled=false` (flag-OFF parity), and that on a mocked `FORM_SUBMISSION_CAPTURED` event the query key is invalidated (both-halves contract).
- [ ] **GREEN** —
  - **Modify** `src/lib/queryKeys.ts` — add `admin.formSubmissions: (wsId, params?) => ['admin-form-submissions', wsId, params ?? {}] as const` adjacent to `conversionTrackingStatus` (`:62`). Prefix `['admin-form-submissions', wsId]` invalidates all pages.
  - **Modify** `src/api/conversionTracking.ts` — add `listLeads(workspaceId, params?)` via the existing `getSafe`/`get` wrappers (no raw `fetch`), `getSafe<{ leads: NamedLeadView[]; total: number }>` with `{ leads: [], total: 0 }` fallback (flag-OFF 404 → safe empty). Build the query string from `params`.
  - **Create** `src/hooks/admin/useAdminLeads.ts` — mirror `useConversionTrackingStatus.ts` (`:30-61`): `useQuery` gated on `(enabled && !!workspaceId)`; both-halves WS handler (`useMemo` keyed on `WS_EVENTS.FORM_SUBMISSION_CAPTURED` → `qc.invalidateQueries({ queryKey: ['admin-form-submissions', workspaceId] })`) via `useWorkspaceEvents(enabled ? workspaceId : undefined, handlers)`; flag-OFF/disabled → no fetch, no subscription; `staleTime: 30s`, `refetchOnWindowFocus: false`.
  - Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-leads): P1b admin named-leads hook + api + queryKey (both-halves WS invalidation)`

---

### B2 — Admin named-leads readout component (PII visible to operator)

- [ ] **RED** — Create `tests/component/admin-leads-readout.test.tsx`: renders `leadName`/`leadEmail`/`formName` for 2 leads; count badge shows `total` (may exceed `leads.length` when paginated — proves header N = unbounded total); `loading` → contextual message, no rows; `total===0` → `EmptyState` with CTA; color assertion — no `purple-`/`violet`/`indigo`, count badge uses a `blue-` class (data law).
- [ ] **GREEN** — Create `src/components/strategy/issue/AdminLeadsReadout.tsx` — self-contained, props-only (`{ leads: NamedLeadView[]; total: number; loading?: boolean; onConnectCta?: () => void }`). Wrap in `<SectionCard noPadding>`; header `h3` "Captured leads" + a **blue** count badge `{total} captured` (Law 2: data = blue, not actionable). Body: a `<DataList>`-style list (check `src/components/ui/DataList` first) — each row `leadName ?? '—'` (bright), `leadEmail` (`t-caption-sm` WITH explicit `text-[var(--brand-text-muted)]` — `t-caption-sm` has no color), `formName` + `outcomeType` chip (blue, read-only), `timeAgo(submittedAt)`. Loading → "Loading captured leads…". Empty → `<EmptyState>` "No leads captured yet — connect a Webflow form to start capturing." with CTA wired to `onConnectCta`. **No purple. Count is data → blue, never teal.** ARIA labels on rows; email is a real value, not a tooltip. Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-leads): P1b AdminLeadsReadout component (operator sees captured leads, no purple)`

---

### B3 — Setup-readiness checklist: deep-linkable steps (extend ConversionSetupStep, OFF-safe)

- [ ] **RED** — (covered by B4's render test; this task is the additive contract change.) Confirm the existing Settings-tab consumer at `ClientDashboardTab.tsx:1021-1037` (which passes no `onClick`) renders byte-identical after the change — assert in B4.
- [ ] **GREEN** — **Modify** `src/components/settings/ConversionTrackingReadout.tsx`: extend `ConversionSetupStep` (`:23-28`) with an **optional** `onClick?: () => void`. In the steps `.map` (`:135-150`), when `step.onClick` is defined render the row as a `<button onClick={step.onClick}>` (label gets a hover step `--brand-text → --brand-text-bright` per the hover-must-step rule + a trailing `ArrowRight` icon + `aria-label`); when absent keep today's static `<div>` (byte-identical for the existing P1a consumer — additive optional field, no behavior change). This converges `ConversionSetupStep` toward `OnboardingStep` (which already has `onClick`, ALIGNMENT #2).
- [ ] **COMMIT:** `feat(the-issue-readiness): P1b deep-linkable ConversionSetupStep (additive optional onClick, OFF-safe)`

---

### B4 — Readiness panel wrapper (deep-links to gap-fix surfaces)

- [ ] **RED** — Create `tests/component/issue-setup-readiness.test.tsx` (wrap in `MemoryRouter` + `QueryClientProvider`; mock `useNavigate`): all-incomplete `readiness` → all steps show ⚠/incomplete, each actionable step's click calls `navigate` with the EXACT asserted deep-link string; all-complete → steps render completed (line-through), provenance pill = "Measured"; no purple/violet/indigo.
- [ ] **GREEN** — Create `src/components/strategy/issue/IssueSetupReadiness.tsx` — props `{ workspaceId: string; readiness: SetupReadinessState; status: ConversionTrackingStatus | undefined; segmentLabel: string; resolvedProvenance: OutcomeProvenance; loading?: boolean }`. Internally: re-mount `ConversionTrackingReadout` (reuse, not rewrite) fed from `readiness` + `status`; build the deep-linkable `ConversionSetupStep[]` with `onClick` handlers using `useNavigate` + `adminPath` (`src/routes.ts:40`):
  - GA4 not connected → `navigate(adminPath(workspaceId, 'workspace-settings') + '?tab=connections')` (verified target — `WorkspaceOverview.tsx:159`; receiver reads `?tab=` at `WorkspaceSettings.tsx:85-107` — two-halves contract satisfied).
  - Events not pinned/typed (`!readiness.eventsTyped`) → `?tab=dashboard` (`ClientDashboardTab` owns Event Display & Pinning + per-event lead-type, `ClientDashboardTab.tsx:1344`).
  - Webflow not connected (`!readiness.webflowConnected`) → `?tab=dashboard` (form-source picker).
  - Outcome value not set (`!readiness.valueSet`) → `?tab=dashboard` (Outcome Value control).
  - Segment not confirmed (`!readiness.segmentConfirmed`) → `?tab=dashboard` (segment control).
  - POV not drafted (`!readiness.povDrafted`) → no navigate (operator is already on the cockpit where `DraftedPovEditor` lives, `KeywordStrategy.tsx:597`); render static or wire a parent-supplied `scrollIntoView` callback.
  - Inline explainers: each step's `description` is the lightweight explainer. For richer term tooltips, **grep `src/components/ui` + `src/components/client/the-issue/outcomeProvenance.ts` for the existing explainer/glossary component BEFORE hand-rolling** (UI/UX rule #1). All deep-link `?tab=` targets are valid `SectionTab` values and the receiver initializes from the param (contract whole — note in PR per the tab-deep-link two-halves rule; enforced by `tests/contract/tab-deep-link-wiring.test.ts`).
  - Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-readiness): P1b admin setup-readiness checklist with one-click gap deep-links`

---

### B5 — Mount readiness panel + leads readout in the cockpit spine (flag-gated, OFF byte-identical)

- [ ] **RED** — Create `tests/component/issue-cockpit-readiness-flag-off.test.tsx` (holistic flag-OFF parity): render the cockpit subtree (or `issueOverviewEl` extraction) with `the-issue-client-measured-capture` mocked **OFF** → readiness panel ("Conversion tracking" header) + leads readout ("Captured leads" header) BOTH absent (`queryByText` null); the P0/P1a spine (`IssueHeader` "The Issue" title, "Send issue") still renders. With the flag **ON** + a `readiness` fixture with gaps → readiness panel renders above `IssueHeader`; expanding "Supporting detail" reveals `AdminLeadsReadout`. **Real loading→loaded transition** (real `QueryClient`, let the leads query resolve) so a Rules-of-Hooks violation in the new conditional mounts is caught.
- [ ] **GREEN** — **Modify** `src/components/KeywordStrategy.tsx` (`issueOverviewEl` at `:580`, JSX spine at `:586`):
  - Add `const measuredCapture = useFeatureFlag('the-issue-client-measured-capture');` at the top with the other flags (imports at top of file — `grep -n '^import' src/components/KeywordStrategy.tsx` first).
  - Compute `readiness`: thread Lane A's `assembleSetupReadiness` onto the existing strategy/workspace payload the cockpit loads (prefer extending an existing payload over a new round-trip — confirm with Lane A at the contract checkpoint). Conversion status + leads via `useConversionTrackingStatus(workspaceId, measuredCapture && !!ws?.ga4PropertyId)` (existing hook) + `useAdminLeads(workspaceId, undefined, measuredCapture)` (B1) — both no-op when OFF.
  - **Mount slot-0, ABOVE `IssueHeader`** inside the `<div className="space-y-8">` at `:586`: `{measuredCapture && <IssueSetupReadiness ... />}` (config-chrome must be the first thing the operator sees).
  - **Mount the leads readout inside the existing "Supporting detail" `<details>`** (`:650-688`, body at `:659`): `{measuredCapture && <AdminLeadsReadout leads={...} total={...} loading={...} onConnectCta={() => navigate(adminPath(workspaceId,'workspace-settings')+'?tab=dashboard')} />}` (progressive disclosure — cold cockpit stays decision-first).
  - **Render NOTHING for P1b additions when the flag is OFF → byte-identical to today's cockpit.**
  - Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue): P1b mount setup-readiness + admin leads readout in cockpit spine (flag-gated, OFF byte-identical)`

---

### Lane B acceptance criteria
- [ ] `npm run typecheck` — zero errors.
- [ ] `npx vite build` — succeeds.
- [ ] `npx vitest run` — the new files, then the FULL suite (never two full vitest passes concurrently — EADDRINUSE lesson).
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (color laws, no-raw-fetch, JSON.parse, stmt-cache, tab-deep-link wiring).
- [ ] `grep -rn "purple-\|violet\|indigo" src/components/strategy/issue/AdminLeadsReadout.tsx src/components/strategy/issue/IssueSetupReadiness.tsx` → empty.
- [ ] **Local D7 proof:** `grep -rn "loadFormSubmissions\|loadFormSubmissionsPaged\|NamedLeadView\|leadEmail\|leadName" server/serializers/ server/routes/stripe.ts server/public-portal.ts` → ZERO hits (the admin PII reader never appears in any public serializer).
- [ ] Docs: `FEATURE_AUDIT.md` (admin readiness + named-leads readout), `data/roadmap.json` (admin-front-half item; `sort-roadmap.ts`), `data/features.json` (sales-relevant: "we show clients exactly what earns a measured number"), `BRAND_DESIGN_LANGUAGE.md` (cockpit readiness panel + leads readout color map — blue count badge, no teal-on-data), `docs/rules/the-issue.md` (deep-link target map: gap → `workspace-settings?tab=...`).

---

# LANE C — client export one-pager + the client's own leads

**Owns the client-facing half.** The in-app export affordance (opens Lane A's one-pager HTML in a new tab → browser print-to-PDF) and the client's "your leads" view. Gated on `the-issue-client-return-hook`; byte-identical OFF.

**Dependency:** Hard dependency on Lane A's `OnePagerExportPayload` + `NamedLeadView` types, the `assembleOnePagerExport` + `renderOnePagerHTML` server functions, the `/api/public/export/:id/one-pager` + `/api/public/export/:id/my-leads` routes, and the `getOnePagerExportUrl` + `getMyLeads` API wrappers. **Lane C builds NO server assembler, NO HTML renderer, NO export route, NO second payload type** (the C draft's parallel-implementation path is rejected per Name Reconciliation). Lane C is UI + the client hook only.

**Locked decisions:** export = print-from-browser (Lane A's HTML, opened via `window.open`); NOT tier-gated (DR-5); D7 — the in-app affordance is a button, lead PII appears only inside the authed export HTML and the "your leads" view, never on the public payload.

**Model:** Sonnet for C-server-consumption + C-UI; Opus for the `TheIssueClientPage` flag-branch integration.

---

### C1 — Client API wrapper + query key + hook (consumes A6)

> Lane A already added `getOnePagerExportUrl` + `getMyLeads` to `src/api/conversionTracking.ts` in A6. If Lane A placed them in `src/api/theIssue.ts` instead, Lane C aligns to wherever A committed them — confirm at the contract checkpoint; do not duplicate.

- [ ] **RED** — Create `tests/unit/the-issue-client-api.test.ts` — assert the one-pager URL helper returns the exact path `/api/public/export/${id}/one-pager` and `getMyLeads` falls back to `{ leads: [] }` on a mocked 404. Run → RED (if the wrappers live in `theIssue.ts`, this also pins their location).
- [ ] **GREEN** —
  - If not already present from A6: **Modify** `src/api/theIssue.ts` — append `onePagerUrl: (workspaceId) => \`/api/public/export/${workspaceId}/one-pager\`` and `myLeads: (workspaceId) => getSafe<{leads: NamedLeadView[]}>(\`/api/public/export/${workspaceId}/my-leads\`, { leads: [] })`. Import `NamedLeadView` at top.
  - **Modify** `src/lib/queryKeys.ts` (client block, near `roi: ['client-roi', wsId]` ~`:273`) — add `myLeads: (wsId: string) => ['client-the-issue-my-leads', wsId] as const`. (Coordinate with B's `admin.formSubmissions` edit — separate block/line; controller diff-reviews.)
  - **Create** `src/hooks/client/useClientMyLeads.ts` (mirror `useClientROI` in `useClientQueries.ts:133` — `useQuery`, `queryKey: queryKeys.client.myLeads(wsId)`, `enabled`, `staleTime`). **Both-halves WS freshness:** `useWorkspaceEvents(workspaceId, { [WS_EVENTS.FORM_SUBMISSION_CAPTURED]: () => qc.invalidateQueries({ queryKey: queryKeys.client.myLeads(workspaceId) }) })` (workspace-scoped → `useWorkspaceEvents`, never `useGlobalAdminEvents`). Export from `src/hooks/client/index.ts`.
  - Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-client): P1b Lane C — client export/my-leads API + query key + hook (both-halves WS freshness)`

---

### C2 — Export affordance + "Your leads" view components (no purple)

- [ ] **RED** — Create `tests/component/the-issue-export-bar.test.tsx`:
  1. `IssueExportBar` renders a teal CTA + the correct `onePagerUrl` href/target; clicking opens the export URL (mock `window.open`).
  2. `IssueYourLeadsSection`: mocked `useClientMyLeads` returning 2 leads → both names render; empty → `EmptyState`; **real loading→loaded transition** (mocked-hook Rules-of-Hooks guard).
  3. `previewMode` → `IssueExportBar` does NOT call `window.open`.
  4. No-purple guard on both components.
- [ ] **GREEN** —
  - Create `src/components/client/the-issue/IssueExportBar.tsx` — props `{ workspaceId: string; previewMode?: boolean }`. Teal CTA (Law 1: teal for actions) "Download one-pager" (shared `Icon` + lucide `Download`/`FileDown`), wired to `window.open(theIssueApi.onePagerUrl(workspaceId), '_blank', 'noopener')` (suppressed when `previewMode`). Sub-line: "Forward to your board — exports as a print-ready PDF." `t-*` typography + `--brand-*` tokens, no purple, wrap in `SectionCard` (or compact inline strip — the export-affordance "slot 1" mount). Tag the root node `data-p1b` (Lane D DOM-probe hook).
  - Create `src/components/client/the-issue/IssueYourLeadsSection.tsx` — props `{ workspaceId: string; previewMode?: boolean }`. Uses `useClientMyLeads(workspaceId)`. A `<details>` "Your captured leads" (collapsed, matching the page's "Under the hood" pattern at `TheIssueClientPage.tsx:291-311`). Body: a `DataList`/table of name/email/form/date. Empty → `<EmptyState>` "No captured leads yet — leads from your website forms will appear here." Loading → `<Skeleton>`. Error degrades via the `getSafe` `{ leads: [] }` fallback. No purple, shared primitives only. Tag root `data-p1b`.
  - Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-client): P1b Lane C — export bar + your-leads view (no purple, data-p1b tagged)`

---

### C3 — Mount on TheIssueClientPage (flag-gated, OFF byte-identical, flag-OFF branch untouched)

- [ ] **RED** — Extend `tests/component/the-issue-export-bar.test.tsx` (or a page-level test): `TheIssueClientPage` with `theIssueClientSpine={true} theIssueReturnHook={false}` → no export bar, no leads section (spine-ON, export-OFF byte-identical); with `theIssueReturnHook={true}` → export bar present, leads section in the disclosure.
- [ ] **GREEN** — **Modify** `src/components/client/the-issue/TheIssueClientPage.tsx`:
  - Read the export flag at the top with the other unconditional hooks (Rules-of-Hooks; mirror `useFeatureFlag('the-issue-client-spine')` at `:134` + the `theIssueClientSpine` test-override prop): add `const exportFlag = useFeatureFlag('the-issue-client-return-hook'); const exportEnabled = theIssueReturnHook ?? exportFlag;` and an optional `theIssueReturnHook?: boolean` prop on `TheIssueClientPageProps`.
  - **Inside the `if (spineEnabled)` branch ONLY:** mount `{exportEnabled && <IssueExportBar workspaceId={workspaceId} previewMode={previewMode} />}` directly under the `slot-verdict` block (slot 1, the audit's mount point), and `{exportEnabled && !previewMode && <IssueYourLeadsSection workspaceId={workspaceId} />}` inside the "Under the hood" `<details>` body.
  - **Do NOT touch the flag-OFF branch** (`:317-426`) — it must stay byte-identical (the file's "do NOT refactor" banner).
  - Re-run → GREEN.
- [ ] **COMMIT:** `feat(the-issue-client): P1b Lane C — mount export bar + your-leads on TheIssueClientPage (flag-gated, OFF byte-identical)`

---

### Lane C acceptance criteria
- [ ] `npm run typecheck` — zero errors.
- [ ] `npx vite build` — succeeds.
- [ ] `npx vitest run` — new files, then FULL suite.
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (STUDIO_NAME literal not needed client-side; no-raw-fetch; no-purple; json-parse; broadcast/handler pairing).
- [ ] `npm run verify:feature-flags` — green (reused `the-issue-client-return-hook`).
- [ ] `grep -r "purple-\|violet\|indigo" src/components/client/the-issue/IssueExportBar.tsx src/components/client/the-issue/IssueYourLeadsSection.tsx` → zero.
- [ ] **Real-browser DOM probe** of the spine-ON + export-ON client surface (Phase-5 multilayer-verification lesson): confirm the export bar + leads disclosure render, the one-pager opens in a new tab, and the print stylesheet applies (catches collapsed-grid/undefined-token regressions that typecheck+build+pr-check all miss).
- [ ] Docs: `FEATURE_AUDIT.md` (client one-pager export + your-leads), `data/roadmap.json` (client export item; `sort-roadmap.ts`), `data/features.json` (the forwardable one-pager is sales-relevant), `BRAND_DESIGN_LANGUAGE.md` (export bar + leads disclosure patterns).

---

# LANE D — flag + tests + verification (RED first, commits LAST in the bundle PR)

**Owner:** verification spine. RED tests authored FIRST against Lane A's pre-committed contracts; each file flips GREEN as B/C land; Lane D commits last but in the same bundle PR so CI never sees a permanently-red committed test.

**Dependency:** hard on Lane A's types (uses the EXACT canonical identifiers — `SetupReadinessState`, `OnePagerExportPayload`, `NamedLeadView`; do NOT invent names); soft on B (server routes) + C (UI). Flag reality: P1b reuses already-declared OFF children — no net-new flag. Cross-lane hooks Lane D requires: `data-export-profile="<profile>"` on the HTML root (A3), `data-p1b` on every P1b-introduced client root node (C2/C3) + `data-p1b-readiness` on the admin readiness mount (B5), the `onClick` action field on `ConversionSetupStep` (B3), and the sentinel PII convention (`LEAK_SENTINEL_NAME` / `leak-sentinel@example.test` / `LEAK_SENTINEL_MSG`).

---

### D1 — Flag-family gating contract (unit)

- [ ] **RED** — Append a `describe('P1b bundle gating', …)` to `tests/unit/the-issue-client-flags.test.ts` (`:48`): `the-issue-client-measured-capture` registered, default-OFF, grouped under `'The Issue (Client)'` (gates admin readiness + admin leads); `the-issue-client-return-hook` registered, default-OFF, `lifecycle.rolloutTarget === 'staging-validation'`, `linkedRoadmapItemId === 'the-issue-client-redesign-p1-return-hook'` (gates client export + client leads); negative — P1b parts MUST NOT be gated on `the-issue-client-reconciliation` (assert its `removalCondition` still matches `/CRM|call.?tracking|P3/i`).
- [ ] **GREEN** — passes immediately (catalog already satisfies); value is regression-locking the gating decision. `npm run verify:feature-flags` green.
- [ ] **COMMIT:** `test(the-issue-p1b): pin P1b part→flag gating contract (Lane D)`

---

### D2 — Readiness assembler ✓/⚠ + flag-OFF 404 (integration)

- [ ] **RED** — Create `tests/integration/the-issue-p1b-readiness.test.ts` (admin endpoint → HMAC `x-auth-token`; `createEphemeralTestContext(import.meta.url, { contextName: 'p1b-readiness' })`; overrides set BEFORE `startServer`; distinct workspaces per flag state). `wsComplete` (fully configured, flag ON) → every readiness signal ✓; `wsGaps` (value unset, events pinned-not-typed, no forms, flag ON) → `valueSet/eventsTyped/webflowConnected === false`, endpoint still 200 (honest degradation, never 500); `wsFlagOff` → 404. Raw-text guard on `wsComplete`: `.not.toContain('leadEmail')` / `'leadName'` / `'leadMessage'`. `afterAll` clears overrides + cleanups.
- [ ] **GREEN** — flips when Lane A's A4 lands. Iterate field names only to match A's committed contract.
- [ ] **COMMIT:** `test(the-issue-p1b): readiness assembler ✓/⚠ + flag-OFF 404 (Lane D)`

---

### D3 — One-pager export segment-aware + D7 public-clean (integration)

> Export route is client-authed (`requireAuthenticatedClientPortalAuth`) → `createEphemeralTestContext(import.meta.url, { autoPublicAuth: true, contextName: 'p1b-export' })`. Print-from-browser HTML, NOT a PDF library (DR-4).

- [ ] **RED** — Create `tests/integration/the-issue-p1b-export.test.ts`. Seed workspaces driving distinct `exportProfile`s via segment (read `server/workspaces.ts:77-105` SEGMENT_DEFAULTS): `wsBoard` (b2b_saas → `board_one_pager`), `wsLocal` (1 location → `local_smb` → `sms_recap`), `wsPortfolio` (≥2 locations → `multi_location` → `owner_portfolio`), `wsPartner` (professional_services → `partner_summary`); each with `outcomeValue` + GA4 snapshot so `outcomeVerdict` hydrates; flag `the-issue-client-return-hook` ON. `wsExportOff` (flag OFF). Assert: segment-awareness via the `data-export-profile="<profile>"` root attribute (non-brittle); content completeness (outcome noun + verdict sentence + outcome-count-with-N + "since we started" baseline + top moves + methodology line); **D7 negative** — seed `saveFormSubmission` sentinel PII, hit `GET /api/public/roi/:id` + `GET /api/public/workspace/:id` and assert `.not.toContain('leak-sentinel@example.test')` etc. (public payloads sentinel-free even when capture is ON); flag-OFF → export route 404. `afterAll` cleanup.
- [ ] **GREEN** — flips when A3 (assembler+renderer) + A6 (route) land.
- [ ] **COMMIT:** `test(the-issue-p1b): one-pager export segment-aware + D7 public-clean (Lane D)`

---

### D4 — Named-leads admin (PII) + client-authed (own leads) + D7 public-clean (integration)

- [ ] **RED** — Create `tests/integration/the-issue-p1b-named-leads.test.ts`. Seed `wsLeads` with two `form_submissions` (sentinel PII), flag `the-issue-client-return-hook` ON for client reads / `the-issue-client-measured-capture` ON for admin read; `wsLeadsOff` (flags OFF). **Admin read** (`requireWorkspaceAccess` → HMAC): `GET /api/workspaces/:id/form-submissions` 200 with PII sentinels visible, `total` correct; flag OFF → 404; no admin token → 401/403. **Client-authed read** (`requireAuthenticatedClientPortalAuth` → client JWT, `autoPublicAuth`): `GET /api/public/export/:id/my-leads` returns the workspace's own leads (`NamedLeadView` shape, names present — the client sees their OWN leads); flag OFF → 404. **D7 public negative (load-bearing):** for `wsLeads`, hit `GET /api/public/roi/:id` + `GET /api/public/workspace/:id` (raw text) and assert `.not.toContain('LEAK_SENTINEL_NAME')` / `'leak-sentinel@example.test'` / `'LEAK_SENTINEL_MSG'` / `'leadEmail'` / `'leadName'` — both flag-ON and flag-OFF. `afterAll` cleanup.
- [ ] **GREEN** — flips when A5 (admin) + A6 (client) land.
- [ ] **COMMIT:** `test(the-issue-p1b): named-leads admin(PII)+client-authed reads + D7 public-clean (Lane D)`

---

### D5 — Readiness checklist renders gaps + deep-links (component)

- [ ] **RED** — Create `tests/component/the-issue-p1b-readiness-checklist.test.tsx` (mirror `tests/component/conversion-tracking-readout.test.tsx` — mock `useFeatureFlag`, the leads/status hooks, `../../src/api/client`; `QueryClientProvider`). Flag ON, status fixture with gaps → each gap renders ⚠/incomplete + a clickable deep-link affordance (`getByRole('button'|'link', { name: /set outcome value|pin & type events|connect webflow forms|confirm segment|draft pov/i })`); the click invokes the wired nav handler (mock `useNavigate`, assert called with the correct target). Completed signal → done-state (`line-through`, teal `CheckCircle`), NO deep-link. Color guard: no `purple`.
- [ ] **GREEN** — flips when Lane B (B3/B4) lands.
- [ ] **COMMIT:** `test(the-issue-p1b): readiness checklist gaps + deep-links (Lane D)`

---

### D6 — Client export affordance + flag-OFF parity (component)

- [ ] **RED** — Create `tests/component/the-issue-p1b-client-export.test.tsx` (mirror `tests/component/conversion-tracking-flag-off-parity.test.tsx`; mock the flag hook + the export API wrapper — no raw fetch). Flag ON + `segmentProfile` → export affordance renders (`getByRole('button'|'link', { name: /export|download|one-pager|board summary/i })`); flag OFF → affordance ABSENT (`queryByRole` null) + the verdict spine unchanged (`IssueVerdictHeadline` still renders) — byte-identical client-side parity. No-PII guard (the affordance is a button, not the lead list). Color guard: no `purple`.
- [ ] **GREEN** — flips when Lane C (C2/C3) lands.
- [ ] **COMMIT:** `test(the-issue-p1b): client export affordance + flag-OFF parity (Lane D)`

---

### D7 — Flag-OFF DOM-probe (verification gate)

- [ ] **RED** — Create `tests/component/the-issue-p1b-flag-off-domprobe.test.tsx`: render `TheIssueClientPage` with ALL P1b children OFF, capture `container.innerHTML`; render the P1a-only baseline (P1a flag ON, P1b children OFF) and assert the P1b additions contribute ZERO nodes — `container.querySelector('[data-p1b]')` is null. Render the admin cockpit readiness mount with `the-issue-client-measured-capture` OFF → `[data-p1b-readiness]` absent. (This is the design-system "5 verification layers" lesson — typecheck+build+pr-check+unit can all pass while a flag-OFF surface silently changes; a real render-tree probe is mandatory.)
- [ ] **GREEN** — flips when C2/C3 tag `data-p1b` and B5 tags `data-p1b-readiness`.
- [ ] **COMMIT:** `test(the-issue-p1b): flag-OFF DOM-probe (no P1b nodes when OFF) (Lane D)`

---

# ⬛ VERIFICATION STRATEGY

Run sequentially — never two full `npx vitest run` at once (per-file deterministic ports orphan test servers → EADDRINUSE flakes; on flake, kill PPID-1 `tsx server/index.ts` orphans and re-run the single file).

```
npm run typecheck                       # tsc -b — zero errors (asserts Lane A types compile)
npx vite build                          # production build green
npx vitest run tests/unit/the-issue-p1b-contracts.test.ts \
              tests/unit/the-issue-readiness.test.ts \
              tests/unit/the-issue-export-assembler.test.ts \
              tests/unit/the-issue-one-pager-html.test.ts \
              tests/unit/the-issue-client-api.test.ts \
              tests/unit/the-issue-client-flags.test.ts \
              tests/integration/the-issue-p1b-readiness-status.test.ts \
              tests/integration/the-issue-p1b-readiness.test.ts \
              tests/integration/the-issue-p1b-export.test.ts \
              tests/integration/the-issue-admin-leads.test.ts \
              tests/integration/the-issue-p1b-named-leads.test.ts \
              tests/integration/the-issue-p1b-client-export.test.ts \
              tests/integration/the-issue-client-export.test.ts \
              tests/component/admin-leads-hook.test.tsx \
              tests/component/admin-leads-readout.test.tsx \
              tests/component/issue-setup-readiness.test.tsx \
              tests/component/issue-cockpit-readiness-flag-off.test.tsx \
              tests/component/the-issue-export-bar.test.tsx \
              tests/component/the-issue-p1b-readiness-checklist.test.tsx \
              tests/component/the-issue-p1b-client-export.test.tsx \
              tests/component/the-issue-p1b-flag-off-domprobe.test.tsx
npx vitest run                          # FULL suite (no regressions) — run ALONE
npm run verify:feature-flags            # no orphaned/ungrouped keys (no new flag)
npm run verify:coverage-ratchet         # coverage not regressed below baseline
npx tsx scripts/pr-check.ts             # zero errors (D7 boundary, no-purple, requireAuth discipline)
```

**PR-blocking gates:**
- **D7 public-clean negatives (D3 + D4)** are the HARD gate — if any sentinel PII string (`LEAK_SENTINEL_NAME` / `leak-sentinel@example.test` / `LEAK_SENTINEL_MSG`) appears in any public/unauthed payload (flag-ON or OFF), the PR does NOT merge.
- **Flag-OFF byte-identical:** D2 (404), D3 (404), D6 (affordance absent), D7 (zero P1b nodes) must all be green.
- **`requireAuth` discipline (pr-check):** admin named-leads = `requireWorkspaceAccess` (HMAC); client export/my-leads = `requireAuthenticatedClientPortalAuth` (client JWT) — NEVER `requireAuth` on an admin route.

### Flag-OFF byte-identical + phase-per-PR + D7 preservation
- **Flag-OFF byte-identical:** with `the-issue-client-measured-capture` AND `the-issue-client-return-hook` both OFF, every public payload (`/api/public/roi`, `/api/public/workspace`) and every existing admin/client surface is byte-identical to HEAD. The new routes 404; no new fields ride existing payloads; no P1b DOM nodes mount. Proven by D2/D3/D6/D7.
- **Phase-per-PR:** P1b is ONE phase shipped as a bundle — Lane A is PR 1 (merged + green on `staging` before B/C/D); B+C+D land in the bundle PR 2 into `staging` first, then `staging → main`. **P1c (SMS/email push) is OUT** — do NOT wire `broadcastToWorkspace` push triggers; the return-hook flag gates the export SURFACE only. The big admin reframe beyond the readiness checklist stays deferred (DR-8).
- **D7 PII-boundary preservation:** PII (`leadName`/`leadEmail`/`leadMessage`) is added ONLY behind `requireWorkspaceAccess` (admin) or `requireAuthenticatedClientPortalAuth` (client portal). `server/serializers/client-safe.ts`, `/api/public/roi`, and `/api/public/workspace` are NEVER extended with PII. Manual grep gate + D3/D4 `.not.toContain()` assertions enforce it; `OnePagerExportPayload` carries no PII (leads attach at the route only, on the authed surface).

---

# ⬛ SYSTEMIC IMPROVEMENTS

1. **Single `toNamedLeadView(s: FormSubmission): NamedLeadView` mapper** (Lane A) — shared by the admin route (A5) and the client route (A6) so the lockstep boundary lives in one place; a field drop fails one mapper test, not silently across two routes.
2. **One assembler / one renderer / one payload type** — collapsing the C-draft's parallel implementation eliminates the #1 multi-agent drift risk (two diverging one-pager shapes). Enforced by Name Reconciliation + the controller diff-review.
3. **`data-p1b` / `data-p1b-readiness` / `data-export-profile` deterministic test hooks** — make flag-OFF DOM-probes and segment assertions non-brittle (no copy-string matching); reusable convention for future flag-gated surfaces.
4. **Sentinel PII convention** (`LEAK_SENTINEL_*`) — one canonical set of strings across D3/D4 so the D7 grep is a single consistent check; adopt as the house pattern for all future PII-boundary tests.
5. **Candidate pr-check rule** — "no `loadFormSubmissions*` / `NamedLeadView` / `leadEmail` / `leadName` import in `server/serializers/` or `server/public-portal.ts`" mechanizes the D7 boundary so a future agent cannot reintroduce a PII leak. Propose in the Lane A PR notes (authoring guide: `docs/rules/pr-check-rule-authoring.md`).
6. **`hasStrategyPov(workspaceId): boolean`** (if added in A2) is a reusable cheap existence read other intelligence slices can consume rather than loading the full POV.

---

# ⬛ SELF-REVIEW PASS (placeholders · name consistency · scope→task coverage)

**Placeholders:** none — every task names concrete files, line anchors, function signatures, and commit messages. No `TODO`/`TBD`/`<fill-in>` remains.

**Name consistency (drift fixed inline):**
- ✅ Readiness type/fn/file unified to `SetupReadinessState` / `assembleSetupReadiness` / `server/the-issue-readiness.ts` (was `IssueSetupReadiness`/`assembleIssueSetupReadiness`/`setupState`).
- ✅ Export type/fn/file unified to `OnePagerExportPayload` / `assembleOnePagerExport` / `server/the-issue-export.ts` (was `OnePagerPayload`/`assembleOnePager(id,{includeLeads})`/`server/the-issue-one-pager.ts`).
- ✅ Lead view unified to `NamedLeadView` (was `AdminFormSubmissionView`/`ClientLeadView`/`AdminLeadsResponse`). One shape, guard-enforced boundary; `leadMessage` admin-internal.
- ✅ Client own-leads route unified to `/api/public/export/:workspaceId/my-leads` (was `/api/public/:workspaceId/my-leads`) — one router (`server/routes/the-issue-export.ts`, Lane A).
- ✅ **Duplicate-assembler conflict resolved:** the C draft's `server/the-issue-one-pager.ts` + `assembleOnePager` + `OnePagerPayload` are REJECTED; Lane C consumes Lane A's single assembler/renderer/route.
- ✅ **Duplicate admin-leads-route conflict resolved:** Lane B's pagination folded INTO Lane A's A5 route (one paginated route, owned by A); B's `loadFormSubmissionsPaged` server helper is the only B-owned server addition.

**Scope item → task coverage:**

| Scope item | Task(s) |
|------------|---------|
| Admin setup-readiness checklist (in-product, DR-2) | A2 (assembler), A4 (endpoint), B3/B4 (deep-linkable UI), B5 (cockpit mount), D2/D5 |
| Readiness deep-links to gap-fix routes (audit gap: `onClick` not wired) | B3 (optional `onClick` on `ConversionSetupStep`), B4 (handlers), D5 |
| Client export one-pager (forwardable, segment-aware) | A3 (assembler + HTML renderer), A6 (route), C1/C2/C3 (UI), D3/D6 |
| Export mechanism = print-from-browser (DR-4, no PDF lib) | A3 (HTML renderer mirroring brief-export), C2 (`window.open`), Feasibility Verdict + DR-4 |
| Segment-driven template (`exportProfile`) | A3 (segment-aware renderer + `data-export-profile`), D3 |
| Admin named-leads surfacing (operator sees PII, audit gap: no route) | A5 (route, paginated), B1/B2 (hook + readout), B5 (mount), D4 |
| Client's-own named-leads (authed, DR-3) | A6 (`my-leads` route), C1 (hook), C2/C3 (UI), D4 |
| D7 PII boundary (never on public payload) | A1 (PII-free `OnePagerExportPayload`), A5/A6 (guarded), grep gates, D3/D4 `.not.toContain()` |
| Flag family (no new flag, DR-6) | A flag posture, D1, `verify:feature-flags` |
| Flag-OFF byte-identical | A4/A5/A6 404-when-OFF, B5/C3 conditional mounts, D2/D3/D6/D7 |
| Shared contracts (types-first) | A1, Name Reconciliation |
| Phase-per-PR + P1c out (DR-8) | Verification §phase-per-PR, scope fence |

Every scope item maps to at least one task. No orphan scope, no orphan task.

**Files:** `/Users/joshuahampson/CascadeProjects/asset-dashboard-strategy` is the repo root for all paths above.
