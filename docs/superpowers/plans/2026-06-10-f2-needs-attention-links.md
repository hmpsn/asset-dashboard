# F2 — WorkspaceOverview "Needs Attention" deep links + severity sorting (audit #21)

**Branch:** `claude/core-f2-needs-attention-links`
**Lane:** F (Admin Throughput)
**Model:** Sonnet 4.6
**Bounded context:** All (cross-workspace admin surface)

---

## Problem

`WorkspaceOverview.tsx` lines 110–124 render a "Needs Attention" list with counts and
labels but zero interactivity. Each row is a static `<div>` — clicking does nothing. To
triage, the admin must manually scan every workspace card. With many workspaces this is
untenable: the admin knows _what_ is wrong but not _where_ to go.

---

## Goal

1. Each attention item becomes a clickable deep link (`ClickableRow`) that navigates
   directly to the correct admin tab for the relevant workspace.
2. Per-workspace attribution is visible — every row carries the workspace name as
   attribution so the admin knows which client to action.
3. Severity sort order is tightened (churn risk is highest urgency, above new requests).
4. `?tab=` two-halves contract is verified: any link that appends `?tab=X` to an
   `adminPath()` must land on a component that reads `searchParams.get('tab')`.
5. Section is capped at 8 visible rows with a "Show N more" expander to prevent
   the list from pushing Global Stats and the workspace grid below the fold with 20+
   workspaces.

---

## Design: per-workspace rows (not aggregated)

The shipped design uses **one row per workspace per issue** rather than a single aggregated
row per issue type. Reasons:

- Each row deep-links to a specific workspace tab — aggregation makes link targets
  ambiguous (which workspace?).
- Attribution (workspace name) is immediately visible on every row without needing hover
  or sub-labels.
- The severity sort + 8-row cap prevents unbounded growth: the most urgent items (churn
  critical > churn warning > new requests > ...) survive the cap; low-priority "no site
  linked" rows get pushed into the expander.

An aggregated design would save vertical space only at the cost of losing per-workspace
navigation — a worse tradeoff for an admin dashboard.

---

## Link-target inventory (final, with review fixes applied)

| Attention type | Target admin page | `?tab=` | Notes |
|---|---|---|---|
| Churn risk — critical | `adminPath(ws.id, 'requests')` | none | Priority 1 |
| Churn risk — warning | `adminPath(ws.id, 'requests')` | none | Priority 1.5 |
| New client requests | `adminPath(ws.id, 'requests')` | none | Priority 2 |
| Pending approvals | `adminPath(ws.id, 'seo-editor')` | none | Priority 3 |
| Content briefs awaiting review | `adminPath(ws.id, 'content-pipeline')` | `briefs` | Priority 4 — ContentPipeline.tsx reads searchParams.get('tab') |
| Pending work orders | `adminPath(ws.id, 'requests')` | none | Priority 5 — ClientDeliverablesPane on requests page |
| Rejected changes | `adminPath(ws.id, 'seo-editor')` | none | Priority 6 |
| Low health score | `adminPath(ws.id, 'seo-audit')` | none | Priority 7 |
| No site linked | `adminPath(ws.id, 'workspace-settings')` | `connections` | Priority 8 |

**Note on work orders (I1 review fix):** the original plan doc listed `workspace-settings`
as the work-order target, but `workspace-settings` has no work-order UI (its tabs are
connections/features/flags/dashboard/publishing/export/llms-txt). Work orders are fulfilled
via `ClientDeliverablesPane` on the `requests` page. Fixed in the (review) commit.

Only **content briefs** and **no site linked** use `?tab=`. ContentPipeline.tsx already
reads `searchParams.get('tab')` at line 51 via `resolveTabSearchParam` — receiver half is
already wired. WorkspaceSettings.tsx reads `searchParams.get('tab')` at line 89 — also
already wired. No new receiver edits needed for these two.

**I4 — requests page sub-tab deep link:** `adminPath(ws.id, 'requests')` renders the
requests tab in App.tsx with a `requestsSubTab` local state defaulting to `'deliverables'`.
The (review) commit wires the receiver: on workspace navigation the state initialiser now
reads `searchParams.get('tab')` and resolves it against the valid sub-tab set
`['signals', 'requests', 'actions', 'deliverables']`, falling back to `'deliverables'`.
This means a sender can append `?tab=signals` to land directly on the Signals sub-tab.
Senders in WorkspaceOverview currently don't append a sub-tab query string for requests
(churn, new requests, work orders all land on the default `deliverables` tab), but the
receiver is now wired for future callers.

---

## Severity sort order (priority field)

| Priority | Item |
|---|---|
| 1 | Churn risk — critical workspaces |
| 1.5 | Churn risk — warning only |
| 2 | New client requests |
| 3 | Pending approvals |
| 4 | Content briefs awaiting review |
| 5 | Pending work orders |
| 6 | Rejected changes |
| 7 | Low health score |
| 8 | No site linked |

The list is sorted ascending by priority. Items beyond position 8 are hidden behind a
"Show N more" button (simple `useState` toggle revealing the rest). The severity sort
guarantees the most urgent items are always visible in the cap.

---

## Row cap (I2 review fix)

The original plan had no cap. With 20+ workspaces, a "no site linked" item fires for
every unlinked workspace, permanently pushing Global Stats and the workspace grid below
the fold. Fix: cap at `ATTENTION_CAP = 8` rows with a `useState(false)` expander toggle.
The severity sort ensures the most urgent rows survive the cap.

---

## Files changed

- `src/components/WorkspaceOverview.tsx` — main change (OWNS): ClickableRow, per-workspace rows, 8-row cap + expander, I1 work-order link fix, M6 redundant class trim, M7 stable key
- `src/App.tsx` — I4: wire `requestsSubTab` to read `searchParams.get('tab')` on workspace entry
- `tests/component/WorkspaceOverview-attention.test.tsx` — M5: divergent sort fixture + fixed comment; I1: updated assertion to `requests`

---

## Acceptance checklist

- [x] `npm run typecheck` — zero errors
- [x] `npx vite build` — success
- [x] `npx vitest run` — all tests pass including new component tests
- [x] `npm run pr-check` — zero errors
- [x] No `violet` / `indigo` in changed files
- [x] Attention items are clickable (ClickableRow)
- [x] Content briefs row navigates to `content-pipeline?tab=briefs`
- [x] Work orders row navigates to `requests` (not `workspace-settings`)
- [x] Section capped at 8 rows with expander
- [x] Sort is tested with a divergent fixture (insertion order ≠ sorted order)
- [x] `tests/contract/tab-deep-link-wiring.test.ts` passes
