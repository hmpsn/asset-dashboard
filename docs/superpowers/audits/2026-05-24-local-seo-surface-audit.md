# Local SEO Surface Audit — Strategy / Keywords / Page Intelligence

Date: 2026-05-24
Owner: `design`
Secondary contexts: `seo-health`, `keyword-strategy`, `analytics-intelligence`

## Executive Summary

Local SEO visibility is correctly modeled as an admin-only, market-specific evidence layer. The implementation now wires that evidence into three admin surfaces, but the visual hierarchy still makes Strategy, Keywords, and Page Intelligence look like peer Local SEO reporting destinations.

Recommended information architecture:

1. **Strategy** is the canonical setup and posture home.
2. **Keywords / Keyword Command Center** is the canonical keyword-level local visibility surface.
3. **Page Intelligence** is a page-level annotation surface with handoff back to Keywords.

The safest implementation is not a new feature. It is a presentation pass that splits the current shared `LocalSeoVisibilityPanel` into surface-specific modes so each page carries the right amount of Local SEO context.

No client-facing Local SEO changes should ship with this pass. The client dashboard/advisor rollout remains deferred until admin staging QA proves data quality and copy clarity.

## Current Surface Map

| Surface | Current implementation | What it does well | What feels off |
| --- | --- | --- | --- |
| Strategy | `KeywordStrategy.tsx` renders `<LocalSeoVisibilityPanel compact />` above strategy settings. | Puts posture/setup near strategy generation, where admins expect account-level SEO configuration. | Compact mode still renders a full reporting card: setup status, five stats, configure, refresh, and "Admin only". This competes with strategy content and implies Strategy is a Local SEO dashboard. |
| Keywords / KCC | `KeywordCommandCenter.tsx` renders full `<LocalSeoVisibilityPanel onOpenKeywords />`, Local summary metric, Local filters, row badges, drawer evidence, and `check_local_visibility` actions. | This is the strongest surface. It owns keyword lifecycle, local filters, keyword-level refresh, local evidence badges, source labels, match confidence, and safe next actions. | The top Local SEO panel repeats setup/reporting content that Strategy also shows. The filter strip is dense because local filters sit beside every non-local lifecycle filter. |
| Page Intelligence | `PageIntelligence.tsx` renders `<LocalSeoVisibilityPanel compact />`, then derives `localSeoByKeyword` from snapshots and annotates rows/details. | Page rows correctly use Local SEO as page-level context only: primary keyword badge plus an expanded local evidence note. | The compact report at page top is too broad for a page-first surface. It duplicates Strategy and KCC rather than answering "does this page's primary keyword have local evidence?" |
| Rank Tracker | `RankTracker.tsx` shows boundary copy only. | Correctly keeps GSC query measurement separate from local-pack visibility. | No change recommended. |
| Client Portal | Guardrail tests keep LocalSeoSlice/client-local payloads out of public workspace, public intelligence, and public strategy responses. | Boundary is now explicit. | No change until the deferred client rollout item. |

## Canonical Ownership Matrix

| Local SEO fact | Canonical surface | Other surfaces may show | Notes |
| --- | --- | --- | --- |
| Workspace local posture (`local`, `hybrid`, `non_local`, `unknown`) | Strategy | Small status badge in Keywords; hidden or tiny hint in Page Intelligence | Strategy is where admins decide whether local visibility belongs in strategy work. |
| Market setup and suggested markets | Strategy | Keywords may link to setup when blocked; Page Intelligence should not manage setup | Avoid market forms/drawers from Page Intelligence unless there is no other recovery path. |
| Active/configured market counts | Strategy | Keywords summary may show active market label/count when filtering local rows | Strategy owns setup completeness. |
| Refresh-all local visibility | Strategy or Keywords, depending entry point | Strategy: account/market refresh. Keywords: keyword-scoped refresh and local filter refresh. Page Intelligence: no global refresh. | Keep provider fan-out framed as background job work. |
| Keyword-level local lifecycle and priority | Keywords | Page row badge for primary keyword only | KCC already owns lifecycle and actions. |
| Local visibility posture (`visible`, `possible`, `not visible`, degraded) | Keywords | Strategy aggregate counts; Page primary keyword badge | Use conservative copy from `docs/rules/local-seo-visibility.md`. |
| Business match confidence | Keywords drawer | Not Strategy/Page except aggregate possible-match count | Raw match confidence is evidence detail, not strategy headline. |
| Top local result evidence and competitors | Keywords drawer | Strategy may show repeat competitor rollup when not compact | Page Intelligence should not list competitors unless a future page-specific local audit exists. |
| Local candidates | Keywords | Strategy count only if needed | Candidates belong in the keyword universe until promoted/tracked. |
| Service coverage gaps / repeat competitor insights | Strategy setup/reporting or future recommendations | Keywords can show related evidence when attached to a row | Do not turn these into client recommendations yet. |

## Findings

### P1 — Shared panel mode is too broad

`LocalSeoVisibilityPanel` accepts `compact`, but compact only hides the markets/detail block and repeat competitor list. It still renders the same title, posture badge, Admin-only badge, configure/edit markets button, optional View local keywords button, Refresh button, setup callout, and five stat cards.

This causes Strategy and Page Intelligence to look like duplicate Local SEO dashboards. It also makes Page Intelligence carry workspace-level controls that are not page-specific.

Recommended fix:

- Replace boolean `compact` with explicit mode: `strategy`, `keywords`, `page`.
- `strategy` mode: setup/posture summary, market status, configure/edit markets, account refresh, small handoff to Keywords.
- `keywords` mode: local keyword lens summary, local filter handoff, keyword-scoped refresh context, maybe market status as secondary.
- `page` mode: no five-stat workspace report; show a compact explanatory strip only when local evidence exists for page primary keywords or local setup blocks page annotations.

### P1 — KCC should be the local keyword hub

KCC already has the richest and safest local implementation:

- Local filters: Local, Local Candidates, Visible Locally, Possible Match, Not Visible, Not Checked, Provider Degraded.
- Row badges via `LocalSeoVisibilityBadge`.
- Drawer evidence with local priority, lifecycle, sources, local-pack presence, match confidence, and top local result evidence.
- Safe next actions including `Check locally` / `Refresh local`.

That makes KCC the natural hub. The UI should lean into this instead of making the full Local SEO report equally prominent on Strategy and Page Intelligence.

Recommended fix:

- Keep the full Local SEO panel on KCC, but retitle/copy it as a lens: "Local Keyword Visibility" or "Local Visibility Lens".
- Group local filters visually inside the filter strip or provide a local filter cluster once local counts exist. The current single row of all filters is functionally correct but dense.
- Keep row/drawer evidence as the source of truth for keyword-level detail.

### P2 — Strategy needs posture/setup, not operational keyword detail

Strategy is the right place to explain whether local SEO applies and whether markets are configured. It should not feel like the place where admins inspect local keyword evidence.

Recommended Strategy treatment:

- Show posture badge, active markets, last refresh, and setup state.
- Include a single "Open local keyword lens" handoff to Keywords.
- Keep "Configure market" and global "Refresh" here because those are strategy-level setup actions.
- Avoid top local result evidence, candidate lists, match confidence, and local filter counts beyond aggregate stats.

### P2 — Page Intelligence should annotate pages only

Page Intelligence already derives `localSeoByKeyword` from latest snapshots and attaches local visibility to a page's primary keyword. That is the correct shape. The broad compact Local SEO report at the top is the mismatch.

Recommended Page Intelligence treatment:

- Remove the workspace-level Local SEO panel from Page Intelligence.
- Keep row-level `LocalSeoVisibilityBadge`.
- Keep expanded detail copy: "Local visibility in {market}" plus conservative evidence detail.
- Add one lightweight empty/setup hint only when the page list contains local-intent pages but no local markets/snapshots exist.
- Add a handoff to KCC filtered to Local or to the exact primary keyword when possible.

### P2 — Color semantics are mostly right, but a local-only visual cue would help

Current color use mostly follows the style guide:

- Blue for local visibility evidence/data.
- Teal for actions.
- Emerald/amber/red for visible/possible/not-found outcomes.

The missing piece is not another hue. It is a consistent icon/copy pattern: `MapPin` + blue data treatment for local evidence, teal only for "configure", "open", and "refresh" actions.

Recommended fix:

- Standardize Local SEO surface headers around `MapPin` or existing badge icons.
- Keep local evidence backgrounds blue-tinted and local actions teal.
- Avoid making every surface title "Local SEO Visibility"; use surface-specific labels to signal relationship:
  - Strategy: "Local SEO Setup"
  - Keywords: "Local Keyword Visibility"
  - Page Intelligence: "Local visibility annotation"

## Proposed Implementation Pass

### Step 1 — Split surface modes

Change `LocalSeoVisibilityPanelProps` from:

```ts
compact?: boolean;
onOpenKeywords?: () => void;
```

to a more explicit mode contract:

```ts
mode?: 'strategy' | 'keywords' | 'page';
onOpenKeywords?: () => void;
```

Keep `compact` temporarily only if needed for compatibility, but prefer converting the three call sites in the same PR.

### Step 2 — Make Strategy the setup summary

Update `KeywordStrategy.tsx` to render `mode="strategy"`.

Expected content:

- title: "Local SEO Setup"
- posture badge
- active/configured markets
- last refresh
- checked/visible/possible/not-found aggregate stats if data exists
- Configure/Edit markets action
- Refresh action
- Open local keyword lens action

### Step 3 — Make KCC the keyword hub

Update `KeywordCommandCenter.tsx` to render `mode="keywords"`.

Expected content:

- title: "Local Keyword Visibility"
- concise setup/reporting strip
- local counts tied to KCC filters
- View local keywords handoff can become a local filter action and should stay in-page
- Keep keyword row and drawer evidence unchanged except copy polish if needed

### Step 4 — Make Page Intelligence annotation-only

Update `PageIntelligence.tsx` to render either no panel or `mode="page"` as a small strip.

Expected content:

- no five-stat workspace report
- no global refresh button
- no market configuration drawer unless local setup is the only way to resolve a visible blocked state
- row/detail badges remain
- handoff to Keywords for deeper local evidence

### Step 5 — Add regression coverage

Tests should pin the IA boundary:

- Strategy renders setup/posture language and does not render the KCC-only "Keyword visibility lives in Keywords" detail block.
- KCC renders the local keyword lens and keeps local filters/actions.
- Page Intelligence does not render the full Local SEO stats panel, while row/detail annotations still render when snapshots exist.
- Public/client boundary tests remain unchanged and should continue to pass.

## Acceptance Criteria

- Admins can tell at a glance that Strategy is the local setup/posture home.
- Admins can tell that Keywords is where local keyword evidence and local keyword actions live.
- Page Intelligence shows local evidence only in the context of a page's assigned keyword.
- The same Local SEO fact does not appear as a full peer card on all three pages.
- No client-facing API or UI exposes LocalSeoSlice or raw local visibility internals.
- No provider calls run from render paths; refresh remains background-job driven.

## Non-goals

- No client dashboard/advisor Local SEO rollout.
- No local scoring/ranking changes in strategy generation.
- No GBP health, review/reputation, or geo-grid work.
- No schema mutation or publishing behavior.
- No new keyword lifecycle manager outside KCC.

