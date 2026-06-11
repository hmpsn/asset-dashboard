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
   directly to the correct admin tab for the relevant workspace(s).
2. Per-workspace attribution is visible — for multi-workspace issues, the most-affected
   workspace is called out in the label.
3. Severity sort order is tightened (priority field already exists; churn risk bumped
   above new requests as highest urgency).
4. `?tab=` two-halves contract is verified: any link that appends `?tab=X` to an
   `adminPath()` must land on a component that reads `searchParams.get('tab')`.

---

## Link-target inventory

| Attention type | Target admin page | ?tab= | Receiver reads searchParams? |
|---|---|---|---|
| New client requests | `adminPath(ws.id, 'requests')` | none | N/A |
| Pending approvals | `adminPath(ws.id, 'content-pipeline')` | none | N/A |
| Content briefs awaiting review | `adminPath(ws.id, 'content-pipeline')` | `briefs` | YES — ContentPipeline.tsx:51 |
| Pending work orders | `adminPath(ws.id, 'requests')` | none | N/A |
| Rejected changes | `adminPath(ws.id, 'seo-editor')` | none | N/A |
| Low health score | `adminPath(ws.id, 'seo-audit')` | none | N/A |
| No site linked | `adminPath(ws.id, 'workspace-settings')` | none | N/A |
| Churn risk | `adminPath(ws.id, 'home')` | none | N/A |

Only **content briefs** uses `?tab=briefs`. `ContentPipeline.tsx` already reads
`searchParams.get('tab')` at line 51 via `resolveTabSearchParam` — receiver half is
already wired. No new receiver edits needed.

---

## Attribution strategy

All items are cross-workspace aggregates. Design principle: show the single "most
affected" workspace inline in the label; the row links to that workspace. If only
one workspace has the issue, link directly. If multiple, show count and link to the
worst offender (highest count).

Items with no single-workspace scope (config issues like "no site linked") link to the
first affected workspace by alphabetical sort.

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

The existing code already sorts by `priority` ascending. The priority values above match
the current code. No reorder needed — sort is already correct.

---

## Implementation plan

### 1. Refactor the attention items array to include navigation targets

Extend the `attentionItems` array type to include a `href` field:

```ts
type AttentionItem = {
  label: string;
  value: string;
  color: string;
  icon: typeof Bell;
  priority: number;
  href: string;          // ← new
  attribution?: string;  // ← new: workspace name (if multi-ws)
};
```

For each item, select the "most affected" workspace from `data` and derive the href via
`adminPath()`.

### 2. Replace the static `<div>` with `<ClickableRow>`

Replace lines 116–121 with `<ClickableRow onClick={() => navigate(item.href)} ...>`
styled teal on hover per the design system (action = teal).

Show an `<ArrowRight>` icon on the right (already imported in the file) to signal
navigability.

### 3. Attribution label

For items that aggregate multiple workspaces, append ` · {wsName}` when only one
workspace is affected, or `· {N} workspaces` when several are. The worst offender's name
is the one shown for context.

### 4. Files changed

- `src/components/WorkspaceOverview.tsx` — main change (OWNS)
- No receiving component edits needed (ContentPipeline already reads searchParams)

### 5. Tests

New file: `tests/component/WorkspaceOverview.attention.test.tsx`

Tests:
- Each attention item type produces a clickable row with correct href
- Content briefs item produces href ending in `?tab=briefs`
- Items are ordered by priority ascending
- Attribution label shows workspace name when single workspace affected
- Multiple workspaces produce "N workspaces" attribution

---

## Acceptance checklist

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — success
- [ ] `npx vitest run` — all tests pass including new component tests
- [ ] `npm run pr-check` — zero errors
- [ ] No `violet` / `indigo` in changed files
- [ ] Attention items are clickable (ClickableRow)
- [ ] Content briefs row navigates to `content-pipeline?tab=briefs`
- [ ] `tests/contract/tab-deep-link-wiring.test.ts` passes (verifies the ?tab=briefs
      sender → ContentPipeline receiver contract)
