# Client Inbox Redesign — Pre-Plan Audit

**Date:** 2026-05-08
**Spec:** `docs/superpowers/specs/2026-05-08-client-inbox-redesign.md`
**Audited by:** Parallel agent search — exhaustive

---

## Key Surprise: SchemaReviewTab Is a Standalone Top-Level Tab

The spec assumed SchemaReviewTab could be pulled into the inbox as a modal trigger with low effort. **It's actually a standalone top-level tab in ClientDashboard**, rendered at `tab === 'schema-review'` — a separate `ClientTab` value, visible only for paid workspaces (`isPaid`).

- **Import:** `ClientDashboard.tsx` line 31
- **Tab registration:** `ClientDashboard.tsx` line 669 — `{ id: 'schema-review' as ClientTab, label: 'Schema', icon: Shield }`
- **Render site:** `ClientDashboard.tsx` line 821–823

**Impact on plan:** Moving schema plan review into the inbox requires:
1. Removing `'schema-review'` from the `ClientTab` nav — or redirecting it to `inbox?tab=seo-changes` (the route-removal-checklist applies: 7 update sites)
2. Adding a schema plan card to InboxTab's SEO Changes section
3. Wrapping the existing `SchemaReviewTab` component inside a full-screen modal triggered from that card
4. Updating `ClientDashboard.tsx` render logic accordingly

This is the highest-risk change in the redesign — it touches the route removal checklist and requires a tab nav change.

---

## Findings by Category

### FILTER TYPE — InboxFilter (8 values → 5 values)

**File:** `src/components/client/InboxTab.tsx` lines 18–25

Current:
```ts
type InboxFilter = 'needs-action' | 'all' | 'completed' | 'approvals' | 'requests' | 'copy' | 'content' | 'content-plan';
```

New (proposed):
```ts
type InboxFilter = 'all' | 'needs-action' | 'seo-changes' | 'content' | 'completed';
```

Old values that must be migrated:
| Old value | Maps to | Notes |
|-----------|---------|-------|
| `'approvals'` | `'seo-changes'` | Filter chip renamed |
| `'requests'` | `'needs-action'` | Merged into section |
| `'copy'` | `'content'` | Now a sub-item in Content section |
| `'content-plan'` | `'needs-action'` | Now a sub-item in Needs Action |
| `'completed'` | `'completed'` | Unchanged (now a mode toggle, not a filter) |

---

### ROUTING — ClientInboxAlias (needs update)

**File:** `src/routes.ts` lines 26–36 and 52

Current:
```ts
export type ClientInboxAlias = 'approvals' | 'requests' | 'content';
```

The alias `'approvals'` must remap to `?tab=seo-changes`. `'requests'` remaps to `?tab=needs-action`. `'content'` stays `?tab=content`.

**ClientTab union also needs updating** (line 25): `'approvals' | 'requests' | 'content'` appear as ClientTab values AND as InboxAliases. These are used for legacy redirects — the aliases themselves don't need removal, only their target tab value changes.

---

### DEEP-LINK CONSUMERS — Must update filter string literals

| File | Line | Current value | New value |
|------|------|---------------|-----------|
| `src/components/client/Briefing/ActionQueueStrip.tsx` | 80 | `'approvals'` | `'seo-changes'` |
| `src/components/client/Briefing/ActionQueueStrip.tsx` | 80 | `'content-plan'` | `'needs-action'` |
| `src/components/client/Briefing/ActionQueueStrip.tsx` | 157 | `chip.section` (runtime) | Chip interface update needed |
| `src/App.tsx` | 126–131 | legacy redirect targets | Update alias → new filter values |

---

### CONDITIONAL VISIBILITY LOGIC — showX variables (full replacement)

**File:** `src/components/client/InboxTab.tsx` lines 128–138

These 6 `const showX` variables all get replaced by the new three-section structure. The section visibility is no longer filter-conditional; sections are always present and collapse/expand. Filter chips hide entire sections.

---

### BETA MODE GATING — Preserved, repointed

**File:** `src/components/client/InboxTab.tsx` lines 105, 124, 132, 184, 505

`betaMode` currently gates the entire 'content' filter chip and `ContentTab` rendering. In the redesign this gating moves to the Content section header and body. Same gate, new home. No logic change needed, just relocation.

---

### LOAD CALLBACKS — Prop drilling remains

`loadApprovals` and `loadRequests` are defined in `ClientDashboard.tsx` (lines 177–183) as `useCallback` wrappers around `queryClient.invalidateQueries`. They're passed through `InboxTab` → `ApprovalsTab` / `RequestsTab`. This prop chain remains unchanged in the redesign — we're not restructuring data fetching.

---

### CHILD COMPONENTS — All exclusively owned by InboxTab

| Component | External imports | Action |
|-----------|-----------------|--------|
| `ApprovalsTab` | 0 | Reuse as-is inside SEO Changes section |
| `RequestsTab` | 0 | Reuse as-is inside Needs Action section |
| `ContentTab` | 0 | Reuse as-is inside Content section |
| `ClientCopyReview` | 0 | Reuse as-is inside Content section |
| `SchemaReviewTab` | 1 (ClientDashboard) | Wrap in modal, retire standalone tab |

---

### NET-NEW BUILD — Full-screen modals for Tier 3 action cards

No existing modal UI for these `ClientActionSourceType` payloads:
- `internal_link` — needs modal showing link table (anchor + target + context snippet)
- `redirect_proposal` — needs modal showing source → target pairs
- `keyword_strategy` — needs modal showing mapped pages + quick wins + gaps
- `aeo_change` — needs modal showing current → proposed diffs

Currently these are summary-only inline cards. The modals are **net-new components** — one per source type, or one generic payload renderer. This is the second-largest chunk of new work after the SchemaReviewTab migration.

---

### TESTS — Must update after filter rename

| File | Affected |
|------|---------|
| `tests/unit/client-routes-redirect.test.tsx` | Lines 73–119 test `isClientInboxAlias` and filter preservation — update expected filter values |
| `tests/contract/tab-deep-link-wiring.test.ts` | Likely tests `?tab=` param wiring — verify InboxTab reads new filter values |

---

## Existing Coverage

- **No email notifications** hardcode inbox filter tab names — emails use root `dashboardUrl` only. Safe.
- **No server routes** reference `InboxFilter` values — filter system is frontend-only. Safe.
- **InsightsDigest** navigates dynamically via `insight.action.tab` — these are set at insight-generation time and include `'approvals'`, `'content-plan'`, etc. Must update insight generation to emit new filter values OR handle legacy values gracefully in the new InboxTab.

---

## Infrastructure Recommendations

1. **Single source of truth for filter values** — Extract `INBOX_FILTER_VALUES` as a shared const (like `INSIGHT_FILTER_KEYS`) rather than duplicating literals across InboxTab, ActionQueueStrip, and test files. Prevents the next drift.

2. **pr-check rule** — Add a rule that flags `?tab=approvals`, `?tab=requests`, `?tab=copy`, `?tab=content-plan` string literals in src/ after the migration completes. Catches anyone re-introducing old filter values.

3. **Modal component pattern** — The 4 Tier-3 action card modals should share a `ClientActionModal` wrapper component (header, close button, approve/reject footer) with a per-`sourceType` body renderer. Avoids 4 independent full-page components.

---

## Parallelization Strategy

### Phase 0 — Shared contracts (sequential, must merge first)
- Update `InboxFilter` type and `VALID_INBOX_FILTERS` in `InboxTab.tsx`
- Update `ClientInboxAlias` mapping in `routes.ts` (remap old → new filter values)
- Add `INBOX_FILTER_VALUES` shared const
- Update `ClientTab` union to remove/redirect `'schema-review'`

### Phase 1 — Core InboxTab restructure (single agent, Sonnet)
- **Owns:** `InboxTab.tsx` exclusively
- Replace filter bar with section structure + mode toggle
- Wire priority strip logic
- Implement section collapse/expand
- Update `betaMode` gating to new section homes
- Update deep-link `useState` init to new filter values

### Phase 2 — Parallel (2 agents)
- **Agent A (Sonnet)** — `ClientDashboard.tsx`: Remove SchemaReviewTab standalone tab, add `clientActions` + schema data to InboxTab props as needed
- **Agent B (Sonnet)** — `ActionQueueStrip.tsx` + `App.tsx` + test files: Update filter string literals, alias mappings, redirect targets, test expectations

### Phase 3 — SchemaReviewTab modal integration (Sonnet)
- **Owns:** New `SchemaReviewModal.tsx`, edits to `SchemaReviewTab.tsx` if needed
- Wrap existing SchemaReviewTab in a full-screen modal
- Wire schema plan card in InboxTab SEO Changes section to open modal

### Phase 4 — Tier 3 action card modals (Sonnet, can parallelize per modal)
- `ClientActionModal.tsx` shared wrapper
- `InternalLinkModal.tsx` — renders link table payload
- `RedirectProposalModal.tsx` — renders source → target pairs
- `KeywordStrategyModal.tsx` — renders strategy payload
- `AeoChangeModal.tsx` — renders AEO diff payload

### Phase 5 — InsightsDigest insight action tab values (Haiku)
- Audit all insight generation that emits `action.tab` values matching old filter names
- Update to new filter values or add fallback handling in InboxTab

---

## Model Assignments

| Task | Model | Reasoning |
|------|-------|-----------|
| Phase 0 shared contracts | Sonnet | Small, precise type changes |
| Phase 1 InboxTab restructure | Sonnet | Large component, complex conditional logic |
| Phase 2A ClientDashboard | Sonnet | Route removal checklist, tab nav change |
| Phase 2B ActionQueueStrip + tests | Haiku | Mechanical string literal updates |
| Phase 3 SchemaReviewTab modal | Sonnet | New component + wiring |
| Phase 4 action card modals | Sonnet | New components per payload type |
| Phase 5 InsightsDigest audit | Haiku | Grep + targeted string updates |
