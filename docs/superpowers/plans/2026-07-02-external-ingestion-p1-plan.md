# External Outcome Ingestion — P1 Implementation Plan (manual mark-as-published + Rinse backfill)

> **For agentic workers (Codex):** Use the subagent-driven or executing-plans flow to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. **Platform: Codex/OpenAI** — model ladder per task below (GPT-5.4-Mini mechanical / GPT-5.4 implementation-with-judgment / GPT-5.5 only if a task needs cross-context reasoning). Read `CLAUDE.md` + `docs/PLAN_WRITING_GUIDE.md` before starting.

**Goal:** Let the operator record work published *outside* the platform (manual blog posts, agency edits) into the outcome ledger with honest attribution, so it can become a measured client win — plus a one-off backfill of Rinse Dental's history.

**Architecture:** Pure additive layer over the **already-hardened** manual-record backend (`POST /api/outcomes/:workspaceId/actions`, C4). P1 builds only: (1) an admin "Record published work" form that calls that route, (2) a thin API/hook wrapper if one doesn't already exist, (3) a one-off backfill script. **No new migration, no new route, no client-facing change.** Auto-detection is P2 (out of scope here).

**Tech Stack:** React 19 + React Query (`useMutation`), Express route (exists), better-sqlite3 (read-only for backfill), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-external-manual-outcome-ingestion-spec.md`.

---

## Contracts you build on (already exist — do NOT rebuild)

- **Route:** `POST /api/outcomes/:workspaceId/actions` (`server/routes/outcomes.ts:302`), `requireWorkspaceAccess`, admin-only. Body (Zod at `:319`): `actionType` (ActionType enum), `sourceType` (string), `sourceId` (string), `attribution` (`attributionEnum` — **pass explicitly**: `platform_executed` = agency did it, `externally_executed` = client did it; the route deprecation-warns + defaults to `not_acted_on` if omitted, so always send it), `baselineSnapshot` (optional `{position?,clicks?,impressions?}`), `source` (optional `{label, snapshot:{title,type,page}}` — pass for a durable win title), `measurementWindow` (optional). Returns `{ action: { id, ... } }`.
- **ActionType** (`shared/types/outcome-tracking.ts:9`) — use `content_produced` for a new post/page, `meta_updated` for a metadata change; pick the closest existing member (do NOT mint a new one).
- **API client:** `src/api/outcomes.ts` already has the actions POST wrapper (~:80). **Reuse it** — do not add a raw `fetch`.
- **Admin hooks pattern:** `src/hooks/admin/useOutcomes.ts` (`useOutcomeActions`, etc.). Add the mutation here.
- **Mount point:** `OutcomeDashboard` (`src/components/admin/outcomes/OutcomeDashboard.tsx`, admin tab `outcomes`, `src/App.tsx:439`).

---

### Task 1: `useRecordPublishedWork` mutation hook  *(Model: GPT-5.4)*
**Files:** Modify `src/hooks/admin/useOutcomes.ts`; reuse the POST wrapper in `src/api/outcomes.ts` (add a typed `recordAction(wsId, body)` export there if one isn't already present). Test: `tests/unit/hooks/admin-outcomes-record.test.tsx`.

- [ ] **Step 1 — failing test:** render a component using the hook with a `QueryClient`, mock the api wrapper, assert calling `mutate({actionType:'content_produced', sourceType:'manual', sourceId:'blog-x', attribution:'platform_executed', source:{label:'Post title', snapshot:{title:'Post title', type:'manual', page:'/blog/x'}}})` calls the wrapper with that exact body and, on success, invalidates `queryKeys.admin.outcomeActionsFiltered` + `outcomeScorecard` + `outcomeCoverage` for the workspace.
- [ ] **Step 2:** run it, confirm it fails.
- [ ] **Step 3 — implement:** add `useRecordPublishedWork(wsId)` returning a `useMutation` that calls the api wrapper and, `onSuccess`, invalidates those three query keys (match the invalidation set the outcome surfaces read).
- [ ] **Step 4:** run, confirm pass.
- [ ] **Step 5:** commit.

### Task 2: "Record published work" admin form  *(Model: GPT-5.4)*
**Files:** Create `src/components/admin/outcomes/RecordPublishedWorkCard.tsx`; mount it in `src/components/admin/outcomes/OutcomeDashboard.tsx`. Test: `tests/component/RecordPublishedWorkCard.test.tsx`.

Use shared primitives only (`SectionCard`, `StatCard`/inputs per `BRAND_DESIGN_LANGUAGE.md`); teal for the submit CTA; no violet/indigo. Follow the Four Laws of Color.

- [ ] **Step 1 — failing test:** render the card with a `QueryClient` + a mocked `useRecordPublishedWork`; fill URL=`/blog/x`, Title=`Choosing a plumber`, Type=`content_produced`, "Who published this?"=Agency; submit; assert `mutate` was called with `attribution:'platform_executed'`, `source.snapshot.title==='Choosing a plumber'`, `source.snapshot.page==='/blog/x'`, `sourceType:'manual'`, and a stable `sourceId` derived from the URL. Then switch "Who published this?"=Client and assert `attribution:'externally_executed'`.
- [ ] **Step 2:** run, confirm fail.
- [ ] **Step 3 — implement:** a `SectionCard` form with fields: Page URL (required), Title (required), Work type (`<select>` of the relevant ActionTypes with human labels), "Who published this?" (Agency → `platform_executed` / Client → `externally_executed`), optional baseline (position/clicks). On submit, build the body (derive `sourceId` deterministically from the URL, e.g. a slug/hash; `sourceType:'manual'`; `source.label`=title, `source.snapshot={title, type:'manual', page:URL}`) and call the mutation. Success → toast ("Recorded — it'll appear in outcomes") + reset; error → inline error. Contextual loading/empty/error states per the UI rules.
- [ ] **Step 4:** run, confirm pass. Then `npm run typecheck` + `npx tsx scripts/pr-check.ts` clean.
- [ ] **Step 5:** commit.

### Task 3: Wire the card into OutcomeDashboard  *(Model: GPT-5.4-Mini)*
**Files:** Modify `src/components/admin/outcomes/OutcomeDashboard.tsx`.

- [ ] **Step 1:** import + render `<RecordPublishedWorkCard workspaceId={workspaceId} />` at the top of the dashboard (above the scorecard) or behind a small "Record published work" disclosure — match the dashboard's existing layout idiom.
- [ ] **Step 2:** `npm run typecheck` + `npx vite build` clean.
- [ ] **Step 3:** commit.

### Task 4: Rinse Dental historical backfill script  *(Model: GPT-5.4)*
**Files:** Create `scripts/backfill-rinse-outcomes.ts`. Test: `tests/unit/backfill-rinse-outcomes.test.ts` (unit-test the pure mapping function; do NOT hit the network).

- [ ] **Step 1 — discover the source of truth (read-before-write):** find Rinse's workspace id and the store functions that list its historical **published** briefs/posts with timestamps + titles + URLs (search `server/` for the brief/post/content stores; e.g. `list*` functions returning `created_at`/`published_at`). Confirm the exact fields before writing the mapper.
- [ ] **Step 2 — failing test:** for a fixture row `{title, url, publishedAt}`, assert the pure `toRecordActionBody(row)` returns `{actionType:'content_produced', sourceType:'manual-backfill', sourceId:<deterministic from url>, attribution:'platform_executed', baselineSnapshot:{}, source:{label:title, snapshot:{title, type:'manual-backfill', page:url}}}` and that a row missing a title/url is skipped-and-reported (never a throw).
- [ ] **Step 3 — implement:** a script that (a) resolves the Rinse workspace id (arg or lookup), (b) reads its historical published items, (c) maps each via the pure function, (d) **idempotently** inserts via the same `recordAction` server path (dedupe on `sourceId` — skip if an action with that `(workspaceType='manual-backfill', sourceId)` already exists so re-runs don't double-count), (e) prints a summary (recorded / skipped / reasons). `--dry-run` flag that logs without writing. Attribution is `platform_executed` (the agency performed this work).
- [ ] **Step 4:** run the unit test; then run the script `--dry-run` against a local seeded DB and eyeball the summary. Do NOT run it against staging/prod DB — that's an operator step after review.
- [ ] **Step 5:** commit.

### Task 5: Honesty contract test  *(Model: GPT-5.4)*
**Files:** Extend `tests/integration/outcomes-client-routes.test.ts` (the file C4 already added the `not_acted_on`-exclusion tests to).

- [ ] **Step 1 — failing test:** record a manual `platform_executed` action via the real route, score it a win, and assert it **appears** in the public client scorecard/wins (it's honest agency work). Then record an `externally_executed` action, score it a win, and assert the client wins surface frames it as externally-executed (carries `attribution:'externally_executed'`, not "we shipped") — reuse the C4-A assertions.
- [ ] **Step 2:** run, confirm the framing/attribution flows through.
- [ ] **Step 3 — implement any gap** (should be none — the C4 path already handles attribution honestly; this test locks it for the manual path).
- [ ] **Step 4:** run, confirm pass.
- [ ] **Step 5:** commit.

---

## Definition of done
- [ ] `npm run typecheck` · `npx vite build` · `npx vitest run` · `npx tsx scripts/pr-check.ts` · `npm run lint:hooks` all clean.
- [ ] Flag-ON real-render smoke N/A (admin-only, no flag) — but do a real browser check of the form submitting once (`preview_*`).
- [ ] `FEATURE_AUDIT.md` entry; `data/roadmap.json` item marked done (+ `sort-roadmap.ts`).
- [ ] The Rinse backfill is left as an **operator-run** step (script committed, not executed against prod by the agent).
- [ ] One PR (phase-per-PR); merges to `staging` first.

## Out of scope (P2, separate plan)
Webflow-CMS / sitemap auto-detection, the `needsAttribution` operator-confirm queue, and the neutral-provenance detector. P1 is the manual core only.
