# Phase A Build Conventions — UI Rebuild

> **Status:** Canonical. Every per-surface ticket-cut cites this doc; every surface PR is reviewed against it.
> **Audience:** Build agents who have NOT seen the Keywords pilot. Every rule below is grounded in a real
> file:line — read the cited code before building, never guess shapes (CLAUDE.md read-before-write rule).
> **Companion contracts:** `docs/rules/ui-rebuild-consistency.md` (the 7 `@ds-rebuilt` gates),
> `docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md` + `owner-decisions.json` (the ratified AD-* decisions),
> `docs/superpowers/plans/2026-07-06-ui-rebuild-phase-a-fanout.md` (wave plan + sequencing rules).

The reference implementation for everything structural is the merged Keywords pilot:
`src/components/keywords-rebuilt/` (PR #1480, + review fixes #1481). When this doc and the pilot disagree,
the pilot is right — file a correction PR against this doc.

---

## 1. Freshness + Refresh (AD-001)

Applies uniformly to: **cockpit, ai-visibility, competitors, links, local-presence, performance,
site-audit, asset-manager.** (Ratified: `docs/ui-rebuild/phase-a/PHASE_A_DECISIONS.md`, AD-001 row.)

- **"Last updated" meta + a manual Refresh action.** Nothing on a rebuilt surface implies live/scheduled
  scanning that doesn't exist. Scheduled/cron scanning is a **separate, per-surface, individually-flagged
  follow-up** — never bundled into the surface PR.
- **Where it mounts:** the surface's `Toolbar` (`src/components/ui/layout/Toolbar.tsx`), in the right-hand
  action slot — i.e. after a `<ToolbarSpacer />`. `Toolbar` is a `role="toolbar"` flex row with roving
  tabindex (Toolbar.tsx:41–118); `ToolbarSpacer` is the flex-1 divider that pushes trailing items right
  (Toolbar.tsx:120–123). Pattern: left = lens/search/filters, right = refresh + meta — exactly how the
  pilot splits its Toolbar (`KeywordsSurface.tsx:273–303`: LensSwitcher + SearchField, then
  `<ToolbarSpacer />`, then the trailing FormSelect). Always pass `label=` (a11y floor requires the
  accessible name).
- **Freshness meta rendering:** a `t-caption text-[var(--brand-text-muted)]` span next to the Refresh
  button — same idiom as the pilot's row-count meta (`KeywordsTable.tsx:485–487`).
- **Honest copy rules** (`docs/workflows/ui-vocabulary.md` §Action Verbs):
  - Re-running an analysis is **"Re-scan"** or **"Run Audit"** (`RefreshCw` icon, zinc) — never "Sync",
    "Live", or "Auto-refresh".
  - The meta states what actually happened: `Last scanned {date}` / `Data as of {date}`. If the data has a
    provider window, say so — the pilot's metric caption is the exemplar:
    `KeywordsTable.tsx:490–492` — *"Clicks & impressions: last {N} days. Rank: {N}-day average. Volume:
    provider estimate."*
  - A refetch failure with cached data on screen must say the data is stale, not fail silently — copy the
    pilot's stale banner verbatim as the template (`KeywordsSurface.tsx:346–355`): `InlineBanner
    tone="warning" title="Summary may be stale"` + *"…the last loaded numbers are still shown"* + an
    inline Retry button.
- **Refresh mutations** report via `useToast` with started/failed copy, e.g. the pilot's refresh controls
  (`KeywordDrawer.tsx:498–526`): success `'National rank refresh started'`, error via
  `mutationErrorMessage(error, '… refresh failed')`.

## 2. Verdict headlines (AD-002)

- Verdict data is **server-derived only, never client-composed** (AD-002: *"extends the
  no-client-verdicts hard floor to narrative headlines"*). SB-006 does **not** introduce a server enum:
  content-performance items receive the existing `OutcomeReadback` (`score: OutcomeScore` +
  `direction: DeltaDirection`) by joining to scored actions. The server never emits
  `win | early | flat`; those are client rendering labels mapped from `OutcomeScore`.
- Narrative verdict headlines are the separate SB-038 contract: `verdictHeadline?: string` is drafted
  during strategy-POV generation and rendered as-is when present. It is server/model-derived, never a
  hardcoded or templated client string; absent means render the honest-absence state (§6).
- **Client code renders; it does not write.** No string interpolation that *composes* a judgment
  ("Traffic is up 40% because…"), no client-side metric thresholding to invent a verdict, and no fallback
  prose when the payload has no `OutcomeReadback` or `verdictHeadline`.
- Rendering guidance: `OutcomeReadback.score` maps to the surface's win/early/flat label and tone via
  existing primitives (`Badge`/`StatusBadge` from `src/components/ui/`); `direction` can support the
  movement detail. Tone mapping stays a lookup table like the pilot's `FEEDBACK_TONE` const
  (`KeywordsSurface.tsx:84–88`) — data → label/tone, never data → prose.

## 3. Money-frame + basis pill (AD-003, AD-028)

- Dollar figures come from **cron-precomputed server fields** — `valueAtStake` / `recoveredSoFar` +
  `basis: 'estimate' | 'measured' | 'actual'` (plan W1.1 / SB-003 contract, `shared/types/outcome-tracking.ts`
  adjacents). **Never compute-on-render** — AD-003 names this "the computeROI snapshot-write trap
  generalized": a render-time computation silently drifts from the persisted snapshot the client saw.
- **Basis pill:** every dollar display carries its provenance pill (`estimate`/`measured`/`actual`),
  rendered with `Badge` (soft variant, sm) beside the figure.
- **Formatting:** module-level `Intl.NumberFormat` const, 0 fraction digits — copy the pilot's
  `MONEY_FORMAT` (`KeywordsSurface.tsx:36–40`). Absent money is an em-dash, not `$0`
  (`KeywordsSurface.tsx:338`; rationale §7).
- **Admin vs client (AD-028 — trust invariant):** raw `$X/mo` is **admin-only**. Client-facing surfaces
  render **banded** value only (`impactBand`) — *"raw $/mo on client cards is prohibited"*
  (owner-decisions.json AD-028). Any admin component reused client-side must strip or band the raw figure.

## 4. 429 / quota state (AD-020)

Applies to every surface with AI actions (AD-020 lists asset-manager, brand-ai, content-pipeline,
page-rewriter; adopt anywhere `callAI`-backed actions surface). The shared pattern (verbatim from the
ratified default):

1. **Disabled AI actions** with a quota tooltip (use `ui/overlay/Tooltip.tsx`) — the button stays visible,
   disabled, and explains itself. Disable-with-reason plumbing exists in the pilot: actions carry
   `disabled` + `disabledReason` and the button wires `disabled={mutation.isPending || action.disabled}`
   (`KeywordDrawer.tsx:239–249`, `213–216`).
2. **First-429 dismissible banner:** on the first 429 of a session, show `InlineBanner` with `onDismiss`
   — dismiss-state pattern at `KeywordsTable.tsx:505–509` (`onDismiss={() => setBulkResult(null)}`).
3. **Bulk/stream runs show a partial-run tally** — "{n} of {total} completed before the quota was hit",
   with completed work kept, never rolled back or misreported as full success. Surface the tally in the
   same result banner slot as the pilot's bulk-result banner (`KeywordsTable.tsx:505–509`).
- Detect via `ApiError.status` from `src/api/client` — the pilot's status-gated error branch is the
  template (`KeywordsSurface.tsx:53–55`, `isLockedError` checking 402/403; write the 429 twin).

## 5. Score authority (AD-016)

- **Every displayed score / coverage % / share-of-voice metric is server-computed.** A second client
  heuristic that can disagree with the authoritative source is a trust landmine (AD-016). This covers AI
  SoV %, schema coverage %, on-page optimization score, per-category audit scores, map-pack SoV — each
  arrives via its data ticket (sn-schema-1, sn-site-audit-1, sn-seo-editor-6, sn-local-presence-3).
- Client code may **format** (`Intl.NumberFormat`, `Meter` display) but never **derive** (no
  `wins/total*100` in a component when the server already ships a rate). CLAUDE.md rate-display rule
  applies: a displayed rate's denominator must be the exact count shown next to it — never mix a
  DB-aggregated count with a locally-filtered one.
- **Explicit denominators:** show them. Pilot exemplars: the display-cap banner names the hidden count
  from server fields `rawEvidenceTotal − rawEvidenceReturned` (`KeywordsTable.tsx:151`, `494–503`), and
  the lens-count comment explains why every lens previews the same server `counts.total` rather than
  contradictory per-lens client counts (`KeywordsSurface.tsx:57–67`). Read that comment before inventing
  a count.
- Score → color goes through `scoreColor()`/`scoreColorClass()` (`ui/constants.ts`), never hand-rolled
  thresholds.

## 6. Honest absence (AD-026)

- **Sparklines/trends render only from a real series** (persisted history or a linked request). Never
  fabricate, interpolate, or pad a series to make a chart appear.
- `Sparkline` (`src/components/ui/Sparkline.tsx`) is already absence-safe: an empty `data` array renders
  a blank fixed-size SVG (Sparkline.tsx:39–51), a single point renders a flat line (55–70). But a blank
  SVG alone is not an absent *state* — pair it with explanatory text, as the pilot does
  (`KeywordDrawer.tsx:354–361`): sparkline + caption resolving to `'Loading snapshots...'` /
  `'{n} snapshots'` / `'Not enough snapshots yet'`.
- Pass `label=` when the sparkline carries information (`KeywordDrawer.tsx:357`); omit it only for pure
  decoration (the SVG then gets `aria-hidden`, Sparkline.tsx:37).
- The pilot builds its series exclusively from fetched history points, filtering non-numbers
  (`KeywordDrawer.tsx:154–160`) — copy that shape; no default/fallback values in the map.
- Same rule for verdicts (§2), money (§3), and table cells (§7 em-dash): absence is displayed as absence.
  AD-026 ratified "ship verdict + tiles first; sparklines behind their data ticket with an honest absent
  state until then."

## 7. Structural surface template (the Keywords pilot)

Every rebuilt surface follows the pilot's skeleton. Read the six files in
`src/components/keywords-rebuilt/` before cutting your surface.

**Page skeleton** (`KeywordsSurface.tsx`):
- Root: `<div className="flex min-h-full flex-col gap-5">` (line 251).
- `PageHeader` first — `title` + honest one-line `subtitle`; primary quick-action lives in the `actions`
  slot (lines 252–271). `KeywordDrawer.tsx:235` shows the Drawer-level `eyebrow` prop for hierarchy labels.
- `Toolbar` next — `LensSwitcher` (with per-lens icons + server counts, lines 274–285), `SearchField`
  (debounced via the state hook, 286–291), `<ToolbarSpacer />`, trailing advanced controls (292–302).
- `FilterChip` row below the Toolbar for the primary filter axis, with server-provided counts and
  an `aria-label` on the wrapper (lines 305–315).
- **KPI tiles above the table:** a `grid gap-3 sm:grid-cols-2 xl:grid-cols-5` of `MetricTile`s with
  token accents (`var(--blue)`, `var(--teal)`, `var(--amber)`, `var(--emerald)`) and `Skeleton`
  placeholders sized to the tile (`h-[92px]`) while loading (lines 325–344).
- **Two-tier summary error:** no data → `ErrorState` with Retry action (317–323); stale cached data →
  warning `InlineBanner` + Retry (346–355). Hard 402/403 lock → full-page `ErrorState type="permission"`
  early return (233–248).
- Grouped secondary content uses `GroupBlock` with `stats` chips and `collapsible defaultOpen`
  (lines 359–390).
- **WS wiring:** `useWorkspaceEvents(workspaceId, { [WS_EVENTS.X]: invalidate })`, invalidating the
  surface's React Query prefix; each handler carries the `// ws-invalidation-ok` justification comment
  (lines 224–231).

**Table** (`KeywordsTable.tsx` + `ui/DataTable.tsx`):
- `DataTable` is **self-carded**: it provides its own `bg-[var(--surface-2)] border … rounded …
  overflow-x-auto` container (DataTable.tsx:118–124 — the comment explains why `-auto` not `-hidden`:
  the 11-col Keywords table is ~1480px and must scroll, not clip). Do NOT wrap it in a second
  `SectionCard` — that double-cards it. `SectionCard` remains the wrapper for non-table content sections.
- Sticky column header rides `z-[var(--z-sticky)]` inside DataTable (DataTable.tsx:132–134).
- **Sticky bulk-action bar:** when rows are selected, a `sticky top-0 z-[var(--z-dropdown)]
  bg-[var(--surface-1)] pb-1` wrapper pins an `InlineBanner` + `Toolbar` of bulk actions above the table
  (`KeywordsTable.tsx:511–548`). Read the two in-code comments there: why z-dropdown (must beat the
  table's own z-sticky header) and why the count tracks `selectedRows` (page ∩ selection), not
  `selectedKeys.size`. Never use raw z-index values — the `--z-*` scale only.
- **Em-dash placeholders:** absent numeric cells render `'—'`, never word-placeholders — right-aligned
  cells style values bright/semibold/tabular-nums, so "No data" reads as a loud value
  (`KeywordsTable.tsx:99–113`, comment + `formatMoney`/`formatNumber`/`formatUpside`).
- Dual `EmptyState`s: default-view empty (CTA to the producing surface) vs filtered-view empty
  (CTA `Clear filters`) (`KeywordsTable.tsx:195–222`).
- Row selection via `useToggleSet` (`KeywordsTable.tsx:147`) — don't hand-roll a `useState<Set>`.

**Detail drawer** (`KeywordDrawer.tsx` + `ui/overlay/Drawer.tsx`):
- `Drawer` props: `open/onClose/title/subtitle/eyebrow/width/footer` (Drawer.tsx:23–40); focus-trap +
  scroll-lock come from `ui/overlay/overlayUtils.ts` — never hand-roll either (CLAUDE.md).
- Three body branches, in order: loading `Skeleton`s → **error branch with Retry** → gone/empty info
  banner (`KeywordDrawer.tsx:259–279`). The error-branch comment is the rule: an open, titled drawer
  whose fetch failed must show a real error + `detail.refetch()` Retry, not a placeholder.
- Actions live in the Drawer `footer` as a `Toolbar` (237–257); destructive ops go through
  `ConfirmDialog` with `variant="destructive"` (546–569).

**URL state** (`useKeywordsSurfaceState.ts`):
- ALL view state (lens, filter, search, sort, page, selected item) lives in search params, each read
  through a **validating type-guard with a default** (lines 58–104) — never trust a raw param.
- The `?tab=` two-halves contract (CLAUDE.md UI rule 12): the receiver reads and validates the param.
  The pilot's receiver is `filterFromParams`/`readHubDeepLink` (lines 80–84).
- **Do not overload the shared `tab` param for your surface's own lens** — the pilot uses a separate
  `lens` param precisely because overloading `tab` silently dropped inbound filter deep-links (review
  finding PR #1480, comment at lines 47–51).
- Writes go through one `updateParams` helper (deletes empty keys, `replace: true` by default,
  lines 143–155); search is debounced 300ms with a committed-vs-input sync ref (lines 128–168).

**Mutation feedback** (`keywordMutationFeedback.ts`):
- All mutations toast via the existing `useToast` (`src/components/Toast.tsx`) — success string, error via
  `mutationErrorMessage(error, 'X failed')`. That helper is a **re-export of the canonical
  `extractErrorMessage`** — do not fork it; a local copy silently misses the non-Error API shapes
  (keywordMutationFeedback.ts:1–4). Do not build a second Toast.

**Mount** (`src/components/layout/rebuiltSurfaces.ts`):
- A new surface is **one line** in `REBUILT_SURFACES` — `lazyWithRetry(() => import(...))` keyed by
  `Page`, uniform `{ workspaceId }` props (`RebuiltSurfaceProps`, lines 17–23). Never a new hardcoded
  branch in `App.tsx`.

**Gates + ledger:**
- Every file in the surface directory carries the `// @ds-rebuilt` header marker (first line of every
  pilot file), opting into the **seven error-severity pr-check rules**: `ds-raw-hex-anywhere`,
  `ds-tailwind-palette-bypass`, `ds-per-view-css-block`, `ds-token-theme-parity`, `ds-icon-discipline`,
  `ds-deep-import`, `ds-motion-token` (`docs/rules/ui-rebuild-consistency.md` §1). Hatches are inline
  same-line only, each with a justification.
- Icons: `<Icon name="…">` from `ICON_NAMES`; `<Icon as={LucideIcon}>` is the sanctioned migration path
  (see `KeywordsTable.tsx:85–91` wrapping `Icon name` for EmptyState). No emoji-as-icon, no raw `fa-*`.
- **Every quick-win trade-off ships a `DEF-*` row in `data/ui-rebuild-deferred-ledger.json` in the same
  PR.** Required fields (copy an existing entry, e.g. `DEF-foundation-001`): `id`, `surface`, `item`,
  `decision`, `class`, `upgradeTrigger`, `owner`, `status`, `roadmapItemId`, `createdAt`, `reviewBy`,
  `links`. `npm run verify:deferred-ledger` enforces schema/expiry/roadmap links.

## 8. Testing conventions

**Flag-transition component test — seeded QueryClient (mandatory per surface).**
Do NOT mock `useFeatureFlag` (a mocked hook consumes zero hook slots and hides Rules-of-Hooks crashes —
CLAUDE.md Test Conventions). Seed the real flag query instead. Canonical snippet, verbatim from
`tests/component/layout/RebuiltSidebar.test.tsx:55–70` (`renderSidebar`):

```tsx
function renderSidebar(overrides: Partial<typeof defaultProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Pre-seed the feature-flag query so the component's `useQuery` (staleTime: Infinity)
  // reads the flags SYNCHRONOUSLY from render 1 — no loading→loaded transition to race.
  queryClient.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RebuiltSidebar {...defaultProps} {...overrides} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
```

(`queryKeys.shared.featureFlags()` = `['feature-flags']`, `src/lib/queryKeys.ts:352`.) Where the test
must exercise the flag-ON shell mount itself, mock the API layer (`src/api/misc` `featureFlags.list`)
and render through `Dashboard`, as the pilot does
(`tests/component/keywords-rebuilt/KeywordsSurface.test.tsx:148–155`, `renderDashboard` at 498–507);
assert the rebuilt surface mounts without throwing while legacy chrome does not.

**Deep-link receiver tests.** Two layers, both required:
1. The static contract test `tests/contract/tab-deep-link-wiring.test.ts` (senders ↔ receivers wired;
   see its header comment, lines 1–16) — new `?tab=` senders/receivers must keep it green.
2. A runtime receiver test rendering the surface at a fully-loaded deep-link URL and asserting every
   param landed — copy the pilot
   (`KeywordsSurface.test.tsx:516`: renders
   `'/ws/ws-1/seo-keywords?lens=lifecycle&filter=tracked&search=cosmetic&page=3&q=…'`), including legacy
   alias params (`?tab=tracked`, line 530).

**Flag-ON real-render smoke (CLAUDE.md UI rule 13).** Green gates prove the code is correct, not that
the surface works. Before the surface PR merges: flip the flag via the env-flag local mechanism, run
against a live DB path with a workspace that actually has data for your surface, click through real
states in the browser (`preview_*` tools), screenshot in the PR. The pilot's smoke found three real
defects that every automated gate missed (PR #1481: DataTable overflow, sticky bulk bar, rail collapse).

**CT baselines.** Only if the surface adds a screenshot matrix: generate baselines in the **jammy
Playwright Docker image** (per the plan's verification strategy — dimensions match ubuntu CI; the 0.03
`maxDiffPixelRatio` absorbs AA). Never commit baselines rendered on macOS.

**Standard per-PR gates** (plan §Verification): `npm run typecheck && npx vite build && npx vitest run`
(full suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` (surgical
baseline updates only) + `npm run verify:deferred-ledger`. Component tests include the a11y floor
assertion (`expectNoA11yViolations`, see `KeywordsSurface.test.tsx:21`).

**T1 carry-over-then-reskin (AD-010).** Machinery-dense HEAD subsystems (voice calibration, Page
Strategy/Copy Pipeline, asset Audit/Upload/Organize lenses, etc. — AD-010 list) mount as
**token-restyled drill-ins** behind the new surface: a `Drawer`/panel wrapping the carried-over
machinery, restyled to tokens, **never redesigned and never dropped** in Phase A. The pilot's
`KeywordBulkConfirmDialog` reuse (`KeywordsTable.tsx:17`, `594–601` — imported from the legacy
`keyword-command-center/` directory, not rebuilt) is the shape: carry the working machinery, reskin the
shell. Redesigns of these subsystems are explicit post-Phase-A tickets.
