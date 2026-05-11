# Autonomous Run — Client IA Redesign Phase 2

**Date:** 2026-05-10
**Mode:** Autonomous `/loop` (dynamic), unsupervised overnight
**Plan:** `docs/superpowers/plans/2026-05-08-client-inbox-redesign.md` (Tasks 4–8 are the nominal Phase 2 scope)
**Spec:** `docs/superpowers/specs/2026-05-08-client-inbox-redesign.md`

---

## Staging State at Kickoff

All plan Tasks 0–8 are implemented on staging (schema-review retired, SchemaReviewModal, ClientActionDetailModal, pr-check rules — all done in earlier sessions). 545 test files pass, pr-check is clean.

**One gap remains before Phase 2 is fully sealed:** ActionQueueStrip chip `section` values still use intermediate filter names (`seo-changes`, `needs-action`, `content`) instead of the final `InboxFilter` values (`decisions`, `reviews`). The `InboxTab.tsx` comment explicitly marks this as the "Phase 2B migration window" — the `LEGACY_FILTER_MAP` bridge exists only until these chips are updated. This is PR 2.1.

Feature flags `new-inbox-ia` and `client-wins-surface` are deployed but off — manual flip by the human after staging verification.

---

## Tonight's Scope

**Primary (must complete):**

1. **PR 2.1** — ActionQueueStrip: final chip section values + LEGACY_FILTER_MAP cleanup
2. **PR 2.2** — Post-ship docs: FEATURE_AUDIT.md + roadmap.json + feature-shipped checklist for inbox IA redesign

**Stretch (if time and energy permit):**

3. **PR 2.3** — Admin feature flag UI: simple toggle interface in admin panel (next roadmap item per MEMORY.md — "admin UI for feature flag toggles, no plan needed")

**Explicitly deferred (manual steps for human):**

- Flip `new-inbox-ia` on staging to verify the new inbox layout visually
- Flip `client-wins-surface` on staging for WinsSurface verification
- Merge staging → main after verification

---

## PR Detail

### PR 2.1 — ActionQueueStrip Final Chip Section Values

**Branch:** `feat/action-queue-strip-final-values`
**Worktree:** `.claude/worktrees/action-queue-strip-final-values/`
**Complexity:** Small (1–2 files, ~20 lines changed)
**Model:** Haiku (mechanical string literal updates)

**Context:** `src/components/client/Briefing/ActionQueueStrip.tsx` chip `section` values currently use the intermediate names that pre-dated the final InboxFilter rename. The escalation pill already uses `decisions` (updated in PR 1.2). Only the regular chips need updating.

**What to change in `src/components/client/Briefing/ActionQueueStrip.tsx`:**

Update the `Chip` interface `section` type:
```ts
// Before
section: 'seo-changes' | 'content' | 'needs-action';
// After
section: 'decisions' | 'reviews';
```
> Note: `approvals`, `replies`, and `contentPlan` chips all route to `decisions`. `briefs` and `posts` chips route to `reviews`. There is no `conversations` chip — that section is for client requests which are wired directly in InboxTab.

Update each chip push call:
```ts
// approvals → decisions (was 'seo-changes')
chips.push({ count: counts.approvals, label: ..., section: 'decisions' });

// briefs → reviews (was 'content')
chips.push({ count: counts.briefs,   label: ..., section: 'reviews' });

// posts → reviews (was 'content')
chips.push({ count: counts.posts,    label: ..., section: 'reviews' });

// replies → decisions (was 'needs-action')
chips.push({ count: counts.replies,  label: ..., section: 'decisions' });

// contentPlan → decisions (was 'needs-action')
chips.push({ count: counts.contentPlan, label: ..., section: 'decisions' });
```

Update the JSDoc comment above the `Chip` interface to remove the old mapping notes and reflect the final values.

**What to change in `src/components/client/InboxTab.tsx`:**

Remove the three intermediate LEGACY_FILTER_MAP entries (now unused since ActionQueueStrip chips no longer emit these values). The legacy URL alias params must stay for external backward-compat:

```ts
export const LEGACY_FILTER_MAP: Record<string, InboxFilter> = {
  // Remove these three — no longer emitted by ActionQueueStrip after Phase 2B:
  //   'needs-action':  'decisions',
  //   'seo-changes':   'decisions',
  //   'content':       'reviews',

  // Keep these — external URLs and old client bookmarks may still use them:
  approvals:       'decisions',
  requests:        'conversations',
  copy:            'reviews',
  'content-plan':  'decisions',
  completed:       'all',
};
```

Also update the InboxTab JSDoc for `LEGACY_FILTER_MAP` to remove the "Phase 2B migration window" language (migration is now complete).

**Tests to run:**
```bash
npm run typecheck && npx vitest run && npx tsx scripts/pr-check.ts
grep -n "seo-changes\|'needs-action'\|'content'" src/components/client/Briefing/ActionQueueStrip.tsx
# Expected: zero results for those three section values (only 'decisions' and 'reviews' remain)
```

---

### PR 2.2 — Post-Ship Docs (Feature-Shipped Checklist)

**Branch:** `feat/inbox-ia-post-ship-docs`
**Worktree:** `.claude/worktrees/inbox-ia-post-ship-docs/`
**Complexity:** Small (docs only)
**Model:** Haiku

Apply the `docs/workflows/feature-shipped.md` 9-step checklist for the inbox IA redesign:

1. **FEATURE_AUDIT.md** — Add/update entries for:
   - `InboxTab` — 3-section layout (Decisions / Reviews / Conversations) behind `new-inbox-ia` flag
   - `ActionQueueStrip` — now renders in InsightsBriefingPage only (InboxTab usage retired in PR 1.2); chip section values now final
   - `SchemaReviewModal` — full-screen modal replaces retired schema-review ClientTab
   - `ClientActionDetailModal` — Tier-3 action card full-screen review
   - `WinsSurface` — wins surface in InsightsBriefingPage behind `client-wins-surface` flag
   - Remove or update the `SchemaReviewTab` entry — component is reused inside SchemaReviewModal but is no longer a standalone nav tab

2. **data/roadmap.json** — Mark inbox IA redesign items as `"done"`, add `"notes"` with PR numbers (#662 for inbox, #663 for wins surface). Run `npx tsx scripts/sort-roadmap.ts`.

3. **BRAND_DESIGN_LANGUAGE.md** — Note three-section inbox layout if any color/interaction patterns were added.

4. **docs/workflows/ui-vocabulary.md** — Confirm inbox section names are correct (Decisions, Reviews, Conversations) and ActionQueueStrip chip labels are documented.

5. **data/features.json** — No update needed (inbox IA is an internal UX restructure, not a sales-call feature).

**Verification:**
```bash
npm run typecheck && npx tsx scripts/pr-check.ts
```

---

### PR 2.3 (Stretch) — Admin Feature Flag UI

**Branch:** `feat/admin-feature-flag-ui`
**Worktree:** `.claude/worktrees/admin-feature-flag-ui/`
**Complexity:** Medium
**Model:** Sonnet

Per MEMORY.md: "Next task: admin UI for feature flag toggles, no plan needed."

**What to build:**
- Admin UI section for toggling feature flags (likely in an existing admin settings area)
- Reads current flag values from the existing `/api/admin/feature-flags` endpoint (check server routes for the exact path)
- Lists all flags from `FEATURE_FLAGS` (`shared/types/feature-flags.ts`) with toggle switches
- Shows current state (server override vs static default)
- Uses existing admin UI patterns and primitives (`SectionCard`, `Badge`, etc.)
- Confirmation before toggling (flags affect production UX)

Read `server/routes/admin.ts` (or wherever the feature flag routes live), `shared/types/feature-flags.ts`, and the existing admin settings components before writing any code. Follow existing admin component patterns exactly.

**Hard stop condition:** If after reading existing routes the scope isn't clear within 30 minutes, write a 1-paragraph scope note to `docs/superpowers/specs/2026-05-10-feature-flag-ui-scope.md` and stop. Don't build wrong UI — a scope note is more valuable than a half-built admin panel.

---

## Per-PR Workflow

Each PR follows this exact sequence. Do not skip steps.

1. **Worktree setup** — `git worktree add .claude/worktrees/<slug>/ -b feat/<slug>` branched from `staging` HEAD
2. **Implementation** — use `superpowers:subagent-driven-development`:
   - Fresh implementer subagent per task
   - Two-stage review per task (spec compliance → code quality)
   - Re-review until clean before next task
3. **Verification gate** before marking PR ready:
   ```bash
   npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
   ```
   ALL must be green, zero errors, no new warnings.
4. **Code review** — `superpowers:requesting-code-review` (small PRs; no parallel agents so scaled review not required)
5. **Open PR** to `staging` branch
6. **Wait for CI** — green required before merge
7. **Merge to staging**
8. **Move to next PR**

**Sequencing:** PR 2.1 must merge before PR 2.2 starts (docs should reflect final chip values). PR 2.3 is independent and can start any time.

---

## Fix-and-Continue Policy

**Default: figure out what's wrong, fix it, keep moving.** Do not halt on every failure.

| Failure | Action |
|---------|--------|
| `pr-check` error | Read error, fix violation, re-run |
| Test failure | Diagnose root cause, fix code OR fix test (only if test was wrong), re-run |
| `typecheck` error | Read error, fix types, re-run |
| Subagent DONE_WITH_CONCERNS | Read concerns, address each one |
| Subagent NEEDS_CONTEXT | Provide missing context, re-dispatch |
| Subagent BLOCKED (after 1 retry with more context) | Escalate per halt conditions |

**Halt and surface (only when genuinely stuck):**

| Condition | Why halt |
|-----------|----------|
| Same failure after 3 fix attempts | Risk of infinite thrash |
| ActionQueueStrip chip update causes test failures that can't be diagnosed in 3 attempts | Requires human review of InboxFilter contract |
| PR 2.3 scope unclear after reading routes | Write scope note and stop |

When halting: write to `docs/superpowers/autonomous-runs/2026-05-10-phase-2-halt-<timestamp>.md`, push notification, exit gracefully.

---

## Push Notifications

Push notify on:

- ✅ Each PR opened
- ✅ Each PR merged to staging
- 🛑 Any halt condition triggered
- 🎉 Final completion (PRs 2.1 and 2.2 merged to staging)

---

## Time Bound

Hard cap: **4 hours** from loop start (smaller scope than Phase 1 — two targeted PRs). If not done, complete the in-flight PR and stop with a summary regardless.

---

## Reference Documents

Read once at start, treat as authoritative:

- `docs/superpowers/plans/2026-05-08-client-inbox-redesign.md` — full plan; Phase 2 STOP section has the verification checklist
- `docs/superpowers/specs/2026-05-08-client-inbox-redesign.md` — signal routing and interaction tiers
- `CLAUDE.md` — project conventions, design system, quality gates
- `docs/workflows/feature-shipped.md` — 9-step post-ship checklist
- `docs/workflows/ui-vocabulary.md` — canonical labels
- `docs/rules/automated-rules.md` — pr-check rules currently enforced
- `docs/workflows/deploy.md` — staging → main flow

---

## Branching Strategy

```
PR 2.1: worktree at .claude/worktrees/action-queue-strip-final-values/  branch: feat/action-queue-strip-final-values
PR 2.2: worktree at .claude/worktrees/inbox-ia-post-ship-docs/          branch: feat/inbox-ia-post-ship-docs
PR 2.3: worktree at .claude/worktrees/admin-feature-flag-ui/             branch: feat/admin-feature-flag-ui
```

All branches from `staging` HEAD (`02699f0c`).

---

## Wake-Up Summary Document

When the loop completes (or halts), write a wake-up summary to `docs/superpowers/autonomous-runs/2026-05-10-phase-2-wakeup-summary.md` with:

- Each PR's status (opened, merged to staging, blocked, not started)
- Links to each PR
- Any halt reasons with paths to halt-summary docs
- Failures encountered and how they were resolved
- What's left for the human

**Human next steps after Phase 2:**
1. Enable `new-inbox-ia=true` on staging (via admin feature flag UI or direct API) and verify the 3-section inbox layout end-to-end per the plan's final verification checklist
2. Enable `client-wins-surface=true` on staging and verify WinsSurface in InsightsBriefingPage
3. If staging verification passes: merge staging → main to ship to production
4. After production stable for 1 week: consider removing the feature flags (per feature flag lifecycle in `docs/rules/development-patterns.md`)
