# Design System Phase 2 — Kickoff & Readiness Pack

> **Read this first.** This doc exists to hand off Phase 2 of the Phase 5 Design System
> sweep cleanly between sessions. It encodes lessons learned from Phase 1 (6 PRs, 4
> review cycles, ~40 issues surfaced) and the canonical conventions / guardrails that
> Phase 2 agents must follow.
>
> **Parent plan:** [`2026-04-24-design-system-phase5-sweep.md`](./2026-04-24-design-system-phase5-sweep.md).
> **Goal of Phase 2:** migrate every consumer component in `src/components/` (outside
> `ui/`) to use the Phase 1 primitives — replacing hand-rolled buttons, icons, layouts,
> typography, forms, and overlays with the canonical primitives shipped in Phase 1.

---

## 0. Session continuity — what to do first

If you're an agent / new session picking this up:

1. **Read this doc end to end** before touching anything
2. Read the parent plan [`2026-04-24-design-system-phase5-sweep.md`](./2026-04-24-design-system-phase5-sweep.md) §"Phase 2 — Codemod Execution by Page Domain" (lines 423–496)
3. Check Phase 1 status: `gh pr list --state open --search "Phase 5 Task 1"` — if any are still open, **do not start Phase 2** (see §1)
4. Read `CLAUDE.md` and `docs/rules/design-system-enforcement.md` in full
5. Inspect the barrel: `cat src/components/ui/index.ts` — confirm all 24 Phase 1 primitives are exported
6. Run the Phase 1 codemods fresh to get current migration inventory (see §4)

Do NOT read this session's transcript. It's long, full of Phase 1 debugging context,
and would pollute your working memory with things that no longer apply.

---

## 1. Pre-dispatch gates (non-negotiable)

Phase 2 does **not** dispatch until all of these are true. Gate on each one.

### Gate 1 — All 6 Phase 1 PRs merged to `staging`

Phase 2 codemods rewrite consumer code that imports Phase 1 primitives. If the
primitives aren't on staging, Phase 2 branches won't typecheck.

```bash
gh pr list --state merged --base staging --search "Phase 5 Task 1"   # expect 6 results
gh pr list --state open --base staging --search "Phase 5 Task 1"     # expect 0
```

If any are open, finish them first. Do **not** branch Phase 2 off a non-merged PR
branch — that creates a cross-dependency that breaks rollback.

### Gate 2 — Staging CI green + smoke QA passed

After the 6 Phase 1 PRs merge, verify staging on `asset-dashboard-staging.onrender.com`:

- `/styleguide.html` renders every new primitive section
- Key pages look visually unchanged from pre-Phase-1 (no regressions)
- `npm run typecheck && npx vitest run && npx vite build && npx tsx scripts/pr-check.ts`
  all green locally against fresh `origin/staging`

### Gate 3 — Phase 1 codemods hardened

Phase 1 codemods underreport. Phase 2 trusts them to identify migration sites —
if a codemod misses a file, Phase 2 misses that migration. The three known gaps
(from Phase 1 round-3 review):

| Codemod | Bug | Fix required |
|---|---|---|
| `phase5-icons.ts` | className regex requires size-class first (misses `<X className="text-zinc-400 w-4 h-4" />`) | Allow size classes anywhere in className string |
| `phase5-icons.ts` | Exception handling is file-level (a file with one `<EmptyState icon=...>` excludes all icons in that file) | Change to match-level exception filtering |
| `phase5-layout.ts` | Exact-substring className match (misses `flex items-center gap-2 justify-between`) | Allow additional classes after the gap/align tokens |

Fix these in a single small PR ("`feat(codemods): phase5 fidelity improvements`")
before Phase 2 dispatches. Add a test script that diffs the migration counts
before/after to verify no regressions.

### Gate 4 — Visual regression baseline captured

Playwright screenshot baselines for ~10 key pages captured **on staging** before
any Phase 2 PR opens. Phase 2's #1 risk is visual drift that typecheck + tests
can't catch.

Minimum baseline set:
- `/` (login)
- `/ws/:id/overview` (admin dashboard)
- `/ws/:id/analytics` (AnalyticsHub)
- `/ws/:id/pages` (PageIntelligence)
- `/ws/:id/strategy` (KeywordStrategy)
- `/ws/:id/content` (ContentBriefs)
- `/ws/:id/audit` (SeoAudit)
- `/ws/:id/brand` (BrandHub)
- `/client/:id/overview` (ClientDashboard)
- `/client/:id/inbox` (InboxTab)
- `/styleguide.html`

Capture in `tests/playwright/visual/phase2-baseline/` and commit to staging.
Each Phase 2 PR runs the same suite and diffs — **zero diffs is the gate.**
A single intentional diff (e.g. a genuinely needed visual change) requires
explicit approval + snapshot update in the same PR.

### Gate 5 — Acceptance criteria pre-committed

**Write this down before the first Phase 2 PR opens and link it in every dispatch prompt:**

> A Phase 2 PR is "done" when:
> - `npm run typecheck && npx vitest run && npx vite build && npx tsx scripts/pr-check.ts` all green
> - Playwright visual diff = 0 against baseline (or the PR description explicitly justifies each diff)
> - No `BUG` / `Critical` review comments open (from Devin or manual review)
> - `Info` / `Minor` / `Suggestion` comments are acknowledged in a follow-up list but **do not block merge**
> - Doc updates: if the PR changes any primitive consumption pattern that affects the color map, BRAND_DESIGN_LANGUAGE.md is updated

Review discipline is the lever that ended Phase 1's review loop. Use it from day 1 in Phase 2.

---

## 2. Lessons from Phase 1 (what went wrong + how Phase 2 prevents it)

Phase 1 shipped 24 primitives across 6 parallel PRs. It took 4 review cycles and
~40 review comments to converge. Root causes below. Every Phase 2 guardrail in this
doc exists because of one of these.

| Phase 1 failure mode | Blast radius in Phase 2 | Mitigation |
|---|---|---|
| **Agents stripped `src/components/ui/index.ts`** — Forms + Layout agents each deleted exports for other PRs' primitives | Catastrophic: Phase 2 touches hundreds of consumer files; a stripped barrel breaks every other PR | Pre-push check (see §5). Explicit "DO NOT TOUCH" list in every agent prompt. Integrator diffs branches before any PR opens. |
| **3 different `className`-merge strategies emerged** (`cn()`, `[].filter().join()`, template literal) | Medium: consumers now have `cn()` available via Phase 1; Phase 2 must use it consistently | Canonical playbook (§6) mandates `cn()`. Pre-check grep in dispatch script rejects PRs that use other patterns. |
| **4 different test path conventions** across PRs | Medium: Phase 2 shouldn't add many tests, but any it does must go in the canonical path | `tests/components/ui/` is canonical. Any new test file elsewhere rejected. |
| **Doc drift** — 2 PRs claimed same `§` number; 2 PRs stripped pre-existing TrendBadge/ChartCard rows; round-3 surfaced missing primitive inventory rows | Medium: Phase 2 doesn't add primitives, but may change Per-Component Color Map entries | Phase 2 PRs do NOT modify DESIGN_SYSTEM.md sections §1–§20 (reserved for Phase 1). Integrator owns BRAND_DESIGN_LANGUAGE.md § 4 per-PR updates. |
| **Codemod bugs under-reported + over-reported** (missed real sites, flagged non-migration sites) | High: Phase 2 acts on codemod output; bad codemods cause wrong rewrites | Gate 3 above — harden codemods before dispatch. Integrator verifies migration inventory. |
| **Review depth increased each round** (Devin surfaced subtle bugs like `@keyframes modal-in` missing animation in round 3) | High: each Phase 2 PR will go through multiple review rounds | Pre-committed acceptance criteria (Gate 5). Ignore Info-tier comments explicitly. Target 1–2 review rounds per PR, not 4. |
| **Visual regressions were invisible** until manual QA | **Critical**: Phase 2 changes rendered output; regressions in button styles, layout gaps, icon sizes | Playwright baseline (Gate 4). Zero-diff gate. |

---

## 3. Architecture: Integrator + 5 Workers (recommended over pure-parallel)

Phase 1 used pure-parallel dispatch (6 agents, each isolated). It produced a lot of
coordination bugs. Phase 2 should use an **integrator + 5 workers** pattern:

```
         ┌─────────────────────────────────────────────────┐
         │         Integrator Agent (opus, stays live)     │
         │  - Runs hardened codemods → migration inventory │
         │  - Declares exclusive file ownership per PR      │
         │  - Owns BRAND_DESIGN_LANGUAGE.md updates         │
         │  - Diffs branches mid-flight → flags drift       │
         │  - Post-dispatch: cross-PR consistency review    │
         └──┬──────┬──────┬──────┬──────┬──────────────────┘
            │      │      │      │      │
         ┌──▼──┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐
         │ 2.1 │ │2.2 │ │2.3 │ │2.4 │ │2.5 │  ← 5 Worker Agents (sonnet)
         │admin│ │admn│ │admn│ │clnt│ │rest│
         │anlx │ │cont│ │ops │ │    │ │    │
         └─────┘ └────┘ └────┘ └────┘ └────┘
```

### Integrator responsibilities (opus model, single persistent agent)

Run in **foreground**, not as a background subagent — session-level Bash
permissions are more reliable and a persistent integrator is cheaper than
re-spawning.

1. **Pre-dispatch**
   - Run all 6 hardened Phase 1 codemods (`phase5-typography`, `phase5-icons`,
     `phase5-buttons`, `phase5-forms`, `phase5-layout`, `phase5-overlays`)
   - Produce `docs/migration-inventory.md`: every candidate site mapped to
     exactly one Phase 2 task (2.1–2.5) based on file path
   - Partition migration inventory into 5 non-overlapping file sets
   - `grep`-verify: each file appears in exactly one task's ownership list

2. **During dispatch** (workers running in parallel)
   - Every 2–3 minutes: `git fetch --all` and `git diff origin/feat/phase2-2.X...origin/feat/phase2-2.Y -- <shared-paths>` — if any drift detected, pause the affected worker and reconcile
   - Coordinate any doc updates (BRAND_DESIGN_LANGUAGE.md, FEATURE_AUDIT.md) — workers emit "suggested doc change" strings; integrator consolidates into a single commit on a coordinator branch

3. **Post-dispatch, pre-PR**
   - Run cross-PR consistency check: grep all 5 branches for rogue patterns (`cn(` vs `filter().join()`, `text-zinc-` vs `var(--brand-text-`, raw hex colors, etc.)
   - Run Playwright visual diff against baseline for each branch
   - Only green PRs are opened

### Worker responsibilities (sonnet model, 5 parallel agents)

Each worker receives at dispatch:

- The parent Phase 5 plan
- **This kickoff doc**
- Their specific task's migration inventory slice (file list, per-file change list)
- The canonical playbook (§6 below)
- The "DO NOT TOUCH" list (§5 below)
- The pre-committed acceptance criteria

Each worker produces:

- One branch: `feat/design-system-phase5-2.X-<domain>`
- One PR targeting `staging`
- Commits organized by file — one commit per major consumer file, with before/after
  summary in the commit message
- A "doc updates needed" list emitted back to the integrator (NOT committed directly
  by the worker to shared docs)

### Why this is better than pure-parallel

Phase 1 pure-parallel produced:
- 2 PRs stripped each other's exports
- 3 different className-merge conventions
- 4 test-path conventions
- 2 section-number collisions in DESIGN_SYSTEM.md

The integrator catches all of these **before** PRs open instead of after round 1
review. Phase 2's larger blast radius makes this coordination cost mandatory.

---

## 4. Phase 2 task breakdown (from parent plan)

Per the Phase 5 plan §"Phase 2 — Codemod Execution by Page Domain" (lines 423–496):

| Task | Domain | Target files (approximate) |
|---|---|---|
| **2.1** | Admin analytics pages | `src/components/AnalyticsHub.tsx`, `PageIntelligence.tsx`, `KeywordStrategy.tsx`, `charts/*.tsx`, chart-consuming pages |
| **2.2** | Admin content pages | `src/components/ContentPipeline.tsx`, `ContentBriefs.tsx`, `ContentPlanner.tsx`, `CmsEditor.tsx`, `brand/*.tsx`, `post-editor/*.tsx` |
| **2.3** | Admin operations pages | `src/components/SeoAudit.tsx`, `RedirectManager.tsx`, `SchemaSuggester.tsx`, `LinkChecker.tsx`, `WorkspaceSettings.tsx`, `admin/*.tsx` |
| **2.4** | Client-facing pages | `src/components/ClientDashboard.tsx`, `client/*.tsx` (entire directory) |
| **2.5** | Brand, schema, revenue, remaining | `src/components/brand/*.tsx` remainder, `schema/*.tsx`, `revenue/*.tsx`, any file not covered above |

**Integrator produces the authoritative list from the actual migration inventory.**
Do not treat this table as final — it's a starting partition.

### Should we split further?

**Yes.** The Phase 5 plan's 5 PRs may be too large given Phase 1 review fatigue.
Consider splitting **2.1 and 2.4** (the largest surfaces) into 2–3 PRs each:

- **2.1** → `2.1a` AnalyticsHub, `2.1b` PageIntelligence, `2.1c` KeywordStrategy + charts
- **2.4** → `2.4a` ClientDashboard top-level, `2.4b` client tabs (Inbox/Approvals/Requests/Content), `2.4c` client insight cards + misc

10–12 smaller PRs is strictly better than 5 huge PRs:
- Faster per-PR review
- Cleaner rollback (one page surface at a time)
- Smaller visual-diff surface per PR
- Less merge-conflict risk

Integrator decides final partition based on migration inventory size.

---

## 5. "DO NOT TOUCH" list (enforced via pre-push check)

Phase 2 agents must **never** modify these files/directories:

### Barrel (the big one)
- `src/components/ui/index.ts` — frozen. Any PR that modifies this fails pre-push.
  Reasoning: Phase 1 twice had agents strip this file of other PRs' exports.

### Phase 1 primitive source
- `src/components/ui/typography/` — frozen
- `src/components/ui/forms/` — frozen
- `src/components/ui/layout/` — frozen
- `src/components/ui/overlay/` — frozen
- `src/components/ui/Icon.tsx`, `Button.tsx`, `IconButton.tsx`, `ActionPill.tsx`,
  `SegmentedControl.tsx`, `TrendBadge.tsx`, `ChartCard.tsx` — frozen
- Bug fixes to these go in a Phase 3 or dedicated hotfix PR, not in a Phase 2 task

### Design system docs (section numbering coordination)
- `DESIGN_SYSTEM.md` sections `§1` through `§20` — frozen. Workers may NOT renumber or modify.
- `BRAND_DESIGN_LANGUAGE.md` § 3 UI Primitive Inventory — workers emit suggested row
  changes to integrator; integrator makes the single consolidated commit.
- `BRAND_DESIGN_LANGUAGE.md` § 4 Per-Component Color Map — workers may add rows for
  consumers they migrate, but the integrator reviews for consistency before any PR
  includes these changes.

### Infra / config
- `vite.config.ts` — frozen. Phase 1 already modified the test `include` pattern; no further changes needed.
- `src/index.css` — frozen (tokens and `.t-*` utilities are Phase 0's output).
- `src/tokens.css`, `public/tokens.css`, `public/styleguide.css` — frozen.
- `package.json`, `tsconfig*.json`, `scripts/pr-check.ts` — frozen. Phase 3 owns pr-check rule additions, not Phase 2.

### Server / non-UI
- `server/**` — Phase 2 is a UI-only migration. No server changes.
- `shared/types/**` — frozen. Only edit if a primitive migration genuinely requires a new shared type (rare; flag to integrator).

### Pre-push check implementation

**Already shipped: `scripts/phase2-guard.ts`** (included in this PR). Usage:

```bash
# In a Phase 2 worker agent's commit flow, run before `git push`:
npx tsx scripts/phase2-guard.ts

# Or install as a pre-push hook:
echo '#!/bin/sh\nnpx tsx scripts/phase2-guard.ts' > .git/hooks/pre-push
chmod +x .git/hooks/pre-push

# The integrator agent (which owns coordinated doc updates) bypasses the
# docs-only portion of the check with:
npx tsx scripts/phase2-guard.ts --integrator
```

The script exits 0 on clean, non-zero with a specific violation listing on failure.
Every Phase 2 worker dispatch prompt must include: "Run `npx tsx scripts/phase2-guard.ts`
before `git push` — fail-to-zero or do not push."

---

## 6. Canonical conventions (the playbook)

These are the rules every Phase 2 worker agent must follow. They were discovered
the hard way in Phase 1 — don't re-discover them.

### 6.1 className merge — ALWAYS `cn()`

```tsx
// ✓ correct — re-exported from the ui barrel for convenience
import { cn } from '../ui';
<div className={cn('flex flex-row gap-2', active && 'bg-teal-500/10', className)} />

// ✓ also correct — direct import from the canonical implementation
import { cn } from '../../lib/utils';

// ✗ wrong — template literal
<div className={`flex flex-row gap-2 ${active ? 'bg-teal-500/10' : ''} ${className ?? ''}`} />

// ✗ wrong — filter/join
<div className={[baseClass, active && 'bg-teal-500/10', className].filter(Boolean).join(' ')} />

// ✗ wrong — string concat
<div className={baseClass + ' ' + (className ?? '')} />
```

> **Path note.** This codebase has no `@/`-style tsconfig path alias. Use the
> relative path that matches your file's depth: `'../ui'` from
> `src/components/`, `'../../ui'` from `src/components/<subdir>/`. The form
> `'@/lib/utils'` shown in older docs is incorrect — it would fail to resolve.

### 6.2 Test file location — ALWAYS `tests/components/ui/`

If Phase 2 adds a test file for a consumer migration:

- **Correct:** `tests/components/<Domain>/<Consumer>.test.tsx`
- **Wrong:** `tests/component/` (singular), `tests/unit/`, `src/components/**/__tests__/`

### 6.3 Prop spreading — `...rest` AFTER explicit props

```tsx
// ✓ correct — rest spread first, explicit overrides win
<button {...rest} type="button" onClick={handleClick}>

// ✗ wrong — caller can accidentally override type or onClick
<button type="button" onClick={handleClick} {...rest}>
```

### 6.4 Icon sizing — use the primitive, not template literals

```tsx
// ✓ correct (path is relative — see §6.1 path note)
import { Icon } from '../ui';
import { TrendingUp } from 'lucide-react';
<Icon as={TrendingUp} size="sm" className="text-teal-400" />

// ✗ wrong — raw Lucide with manual sizing
<TrendingUp className="w-3 h-3 text-teal-400" />

// ✗ wrong — Tailwind dynamic class (Tailwind v4 scanner won't see this)
<TrendingUp className={`w-${sizeMap[size]}`} />
```

### 6.5 Button gradient — use the primitive, not hand-rolled

```tsx
// ✓ correct
import { Button } from '../ui';
<Button variant="primary" icon={Send} onClick={handleSend}>Send</Button>

// ✗ wrong
<button className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white ...">
```

### 6.6 Score colors — use helpers, NEVER hardcode

```tsx
// ✓ correct
import { scoreColor, scoreColorClass } from '../ui/constants';
const color = scoreColor(score);             // hex for SVG fills
const cls = scoreColorClass(score);          // Tailwind class for text

// ✗ wrong
const color = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
```

### 6.7 Three Laws of Color — non-negotiable

- **Teal for actions** — CTAs, toggles, active states, interactive highlights
- **Blue for data** — read-only metrics, info badges, click/impression counts
- **Emerald for success** — scores ≥ 80, approved states, positive deltas
- **Purple for admin AI ONLY** — never in `src/components/client/**`

Forbidden hues in consumers: `violet-`, `indigo-`, `rose-`, `pink-`, `text-green-400`
for success. Enforced by pr-check.

### 6.8 Token usage — full migration of raw zinc/borderRadius/text-[Npx] in your domain

A Phase 2 worker's domain must end with **zero** raw `text-zinc-*`, `bg-zinc-*`,
`border-zinc-*`, `rounded-lg`, `text-[Npx]`, or inline `borderRadius:` in any
file in the worker's scope. The parent plan's "Phase 2 Acceptance Checklist —
Domain grep audit" enforces this; pr-check will fail any PR that lets one slip
through.

> **Earlier draft of this section said the opposite.** It claimed Phase 2 was
> "migration, not full token rewrite" and that surrounding zinc could stay.
> That note conflicted with the parent plan's domain grep audit — workers
> following it would fail acceptance. The parent plan's stricter rule wins.

#### Token mapping (use these — do NOT invent `var(--zinc-*)`)

The project does **not** define `--zinc-300`, `--zinc-400`, `--zinc-500`,
`--zinc-600`, or `--zinc-700` as CSS custom properties. `var(--zinc-N)` resolves
to empty string at runtime — text becomes the browser default and backgrounds
become transparent. **This is a runtime regression and Playwright visual diff is
the only gate that catches it.**

The legitimate replacements:

| Raw zinc class | Semantic CSS var (preferred) | Notes |
|---|---|---|
| `text-zinc-100`, `text-zinc-200`, `text-zinc-300` | `text-[var(--brand-text-bright)]` | Headings, primary emphasis |
| `text-zinc-400` | `text-[var(--brand-text)]` | Body text |
| `text-zinc-500` | `text-[var(--brand-text-muted)]` | Muted/secondary text |
| `bg-zinc-800`, `bg-zinc-900` | `bg-[var(--surface-1)]` / `bg-[var(--surface-2)]` / `bg-[var(--surface-3)]` | Pick the surface tier that matches the visual layer |
| `border-zinc-700`, `border-zinc-800` | `border-[var(--brand-border)]` | All non-accent borders |

If a site has no semantic equivalent (e.g. a one-off zinc-700 used for a legend
swatch where a colored accent would be wrong), keep the original Tailwind
utility class — it's defined as a CSS override in `src/index.css`. Do NOT
escape into `text-[var(--zinc-700)]`; the variable does not exist.

---

## 7. Migration recipes (common patterns)

Standard before/after transformations Phase 2 workers will perform repeatedly.
These supplement the Phase 1 codemod outputs — workers apply these manually when
codemods underreport.

### Recipe 1: Hand-rolled primary button → `<Button variant="primary">`

```tsx
// BEFORE
<button
  onClick={handleRun}
  disabled={running}
  className="bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50 flex items-center gap-2"
>
  {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
  {running ? 'Running...' : 'Run Audit'}
</button>

// AFTER
<Button
  variant="primary"
  size="md"
  icon={running ? undefined : Play}
  loading={running}
  onClick={handleRun}
>
  {running ? 'Running...' : 'Run Audit'}
</Button>
```

### Recipe 2: Hand-rolled approval pill → `<ActionPill variant="approve">`

```tsx
// BEFORE
<button
  onClick={() => approve(id)}
  className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 rounded text-[11px] font-medium text-emerald-400"
>
  <Check className="w-3 h-3" /> Approve
</button>

// AFTER
<ActionPill variant="approve" icon={Check} onClick={() => approve(id)}>
  Approve
</ActionPill>
```

### Recipe 3: Trend indicator → `<TrendBadge>`

```tsx
// BEFORE
<span className={`text-xs flex items-center gap-1 ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
  {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
  {Math.abs(delta).toFixed(1)}%
</span>

// AFTER
<TrendBadge value={delta} suffix="%" />
```

### Recipe 4: Flex row → `<Row>`

```tsx
// BEFORE
<div className="flex items-center gap-2">
  <Icon1 />
  <span>Label</span>
</div>

// AFTER
<Row gap="sm">
  <Icon1 />
  <span>Label</span>
</Row>
```

**Do not migrate every `flex items-center gap-*` occurrence.** Only migrate when:
- The container is a semantic wrapper (not a one-off inline flex)
- Readability improves (Row has explicit `gap` enum vs arbitrary `gap-X` values)
- No additional flex props (`flex-1`, `flex-shrink-0`) needed that Row doesn't support

Judgment call per site. Integrator triages ambiguous cases.

### Recipe 5: Hand-rolled modal → `<Modal>`

Only migrate modals that match the primitive's capabilities. Custom modals with
unusual sizing, tab structures, or embedded forms may stay hand-rolled if they'd
require distorting the `<Modal>` API. Defer to Phase 3 if unsure.

```tsx
// BEFORE
{isOpen && (
  <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
    <div className="bg-zinc-900 rounded-lg max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
      <h2 className="text-lg font-semibold text-zinc-100 mb-4">Confirm</h2>
      {children}
    </div>
  </div>
)}

// AFTER
<Modal open={isOpen} onClose={onClose} size="md">
  <Modal.Header title="Confirm" />
  <Modal.Body>{children}</Modal.Body>
</Modal>
```

### Recipe 6: Character counter / field label → use FormField composition

Skip for now unless the consumer already renders a `<label>` above an `<input>`.
Forms primitive has `FormField` but not every validation pattern in the codebase
maps cleanly. Phase 3 or Phase 4 can own form-specific migrations.

---

## 8. Risks + mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Visual regression in production | High | High | Playwright baseline (Gate 4), zero-diff gate per PR |
| Agent strips shared file | Low (mitigated) | Catastrophic | Pre-push frozen-paths guard (§5) |
| Cross-PR coordination drift | High | Medium | Integrator pattern (§3), mid-flight diffing |
| Review fatigue + endless cycles | High | Medium | Pre-committed acceptance criteria (Gate 5), ignore Info-tier comments |
| Codemod under/over-match | Medium | Medium | Gate 3 hardening; manual override via recipes (§7) |
| Accidentally touching server / config | Low | High | Frozen-paths guard rejects at push time |
| Merge conflicts between 5–12 PRs | High (if 5 big PRs), Low (if 10–12 small) | Medium | Prefer small PRs (§4), integrator enforces file ownership |
| Rollback difficulty | Low (one primitive consumer ≠ whole feature) | Low | Each PR is per-domain; revert single PR if regression found |

---

## 9. Phase 1 polish items (single follow-up PR — do AFTER Phase 1 merges)

Round 3 review surfaced these low-signal items. Do NOT bundle them into Phase 2 —
they're independent and belong in one "Phase 1 polish" PR against `staging` **after
all 6 Phase 1 PRs merge to staging**.

### 9.1 Literal patches (copy-paste ready for next session)

Branch: `chore/phase1-polish-roundup`, base: `staging`. Apply all four patches below,
run quality gates, open PR against `staging`.

#### Patch 1 — Export `IconSize` and `IconProps` types from barrel

File: `src/components/ui/Icon.tsx` — export the types:

```tsx
// BEFORE (currently unexported):
type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
interface IconProps extends React.HTMLAttributes<HTMLSpanElement> { … }

// AFTER:
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export interface IconProps extends React.HTMLAttributes<HTMLSpanElement> { … }
```

File: `src/components/ui/index.ts` — add under `// Icon`:

```tsx
export { Icon } from './Icon';
export type { IconSize, IconProps } from './Icon';  // ← add this line
```

#### Patch 2 — `SegmentedControl` disabled adds `pointer-events-none`

File: `src/components/ui/SegmentedControl.tsx`, in the button `className` cn() call:

```tsx
// BEFORE:
opt.disabled && 'opacity-50 cursor-not-allowed',

// AFTER:
opt.disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
```

Matches sibling primitives (Button, IconButton, ActionPill). Belt-and-suspenders with
the native `disabled` attribute.

#### Patch 3 — `Icon` conditional `role="img"` when consumer passes `aria-label`

File: `src/components/ui/Icon.tsx`:

```tsx
// BEFORE:
export const Icon = React.forwardRef<HTMLSpanElement, IconProps>(function Icon(
  { as: Component, size = 'md', className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn('inline-flex items-center justify-center', SIZE_MAP[size], className)}
      {...rest}
    >
      <Component className="w-full h-full" aria-hidden="true" />
    </span>
  );
});

// AFTER:
export const Icon = React.forwardRef<HTMLSpanElement, IconProps>(function Icon(
  { as: Component, size = 'md', className, ...rest },
  ref,
) {
  // When consumer passes aria-label, the <span> becomes a semantic image;
  // apply role="img" so all screen readers announce it (per ARIA spec, a
  // bare <span> with aria-label is not guaranteed to be announced).
  const isSemantic = 'aria-label' in rest || 'aria-labelledby' in rest;
  return (
    <span
      ref={ref}
      role={isSemantic ? 'img' : undefined}
      className={cn('inline-flex items-center justify-center', SIZE_MAP[size], className)}
      {...rest}
    >
      <Component className="w-full h-full" aria-hidden="true" />
    </span>
  );
});
```

Add test at `tests/components/ui/Icon.test.tsx`:

```tsx
it('applies role="img" when aria-label is provided (semantic icon)', () => {
  const { container } = render(<Icon as={TrendingUp} aria-label="Trending up" />);
  expect(container.firstElementChild?.getAttribute('role')).toBe('img');
});

it('omits role when no aria-label (decorative icon)', () => {
  const { container } = render(<Icon as={TrendingUp} />);
  expect(container.firstElementChild?.getAttribute('role')).toBeNull();
});
```

#### Patch 4 — `DESIGN_SYSTEM.md` File Structure listing — add Phase 1 primitive files

File: `DESIGN_SYSTEM.md`, find the `File Structure` section tree (roughly line 430 on
staging post-merge) and append the new files:

```
├── Icon.tsx                # Strict-enum wrapper around Lucide components (Phase 5)
├── Button.tsx              # Primary/secondary/ghost/danger/link button (Phase 5)
├── IconButton.tsx          # Square icon button with required a11y label (Phase 5)
├── ActionPill.tsx          # Workflow pill: start/approve/decline/send/request-changes (Phase 5)
├── SegmentedControl.tsx    # Radiogroup with roving tabIndex (Phase 5)
├── typography/
│   ├── Heading.tsx
│   ├── Stat.tsx
│   ├── BodyText.tsx
│   ├── Caption.tsx
│   ├── Label.tsx
│   ├── Mono.tsx
│   └── index.ts
├── forms/
│   ├── FormField.tsx
│   ├── FormInput.tsx
│   ├── FormSelect.tsx
│   ├── FormTextarea.tsx
│   ├── Checkbox.tsx
│   ├── Toggle.tsx
│   └── index.ts
├── layout/
│   ├── Row.tsx
│   ├── Stack.tsx
│   ├── Column.tsx
│   ├── Grid.tsx
│   ├── Divider.tsx
│   ├── utils.ts            # Shared GapSize + gapMap
│   └── index.ts
├── overlay/
│   ├── Modal.tsx
│   ├── Popover.tsx
│   ├── Tooltip.tsx
│   ├── reducedMotion.ts
│   └── index.ts
```

### 9.2 Quality gates for the polish PR

```bash
npm run typecheck && npx vitest run && npx vite build && npx tsx scripts/pr-check.ts
```

All green → open PR against `staging` with title:
`chore(design-system): Phase 1 polish roundup (round-3 review cleanup)`

Total scope: ~50 lines changed across 4 files + 2 test additions. ~20 minutes of work.

---

## 10. Session transition checklist

When this session closes and Phase 2 starts fresh:

- [ ] This doc committed to `main` (via `docs/phase2-kickoff` branch + PR)
- [ ] The Phase 1 polish PR opened and merged (§9)
- [ ] All 6 Phase 1 PRs merged to `staging` (Gate 1)
- [ ] Staging smoke-tested (Gate 2)
- [ ] Phase 1 codemods hardened (Gate 3) — one small PR merged to `staging`
- [ ] Playwright baseline captured on `staging` (Gate 4) — committed to
      `tests/playwright/visual/phase2-baseline/`
- [ ] Acceptance criteria (Gate 5) referenced in every worker dispatch prompt
- [ ] Frozen-paths pre-push guard implemented (§5) — can be part of the hardening PR
- [ ] Next session reads: this doc → parent Phase 5 plan → `CLAUDE.md` → starts with
      integrator agent setup

---

## 11. TL;DR for the next session

**Do this in order:**

1. Confirm all 5 pre-dispatch gates pass (§1)
2. Spawn the integrator agent (opus, foreground, long-lived)
3. Integrator runs hardened codemods → produces `docs/migration-inventory.md`
4. Integrator partitions inventory into 10–12 non-overlapping task sets (prefer
   smaller PRs; §4 suggests splits for 2.1 and 2.4)
5. Dispatch worker agents in batches of 3–4 parallel (not all 10–12 at once —
   review bandwidth caps at 3–4 concurrent)
6. Integrator monitors all branches, catches drift, consolidates doc updates
7. Each worker completes → runs own quality gates + Playwright diff → opens PR
8. Review against pre-committed acceptance criteria (Gate 5), ignore Info-tier
9. Merge to staging in completion order, re-baseline Playwright after each merge
10. When all Phase 2 PRs merged: staging smoke test, then `staging → main`
    release PR (batch promotion)

**Expected timeline:** 5–8 working days for 10–12 PRs, assuming good Devin
throughput and no major visual regressions.

**If things go sideways:** revert the single problematic PR (each PR is per-domain,
so rollback is a single `git revert <merge-commit>` → staging stays functional).

---

## 12. References

- Parent plan: [`2026-04-24-design-system-phase5-sweep.md`](./2026-04-24-design-system-phase5-sweep.md)
- Project root: [`CLAUDE.md`](../../../CLAUDE.md)
- Design rules: [`docs/rules/design-system-enforcement.md`](../../rules/design-system-enforcement.md)
- Automated rules: [`docs/rules/automated-rules.md`](../../rules/automated-rules.md)
- Multi-agent coordination: [`docs/rules/multi-agent-coordination.md`](../../rules/multi-agent-coordination.md)
- Plan writing guide: [`docs/PLAN_WRITING_GUIDE.md`](../../PLAN_WRITING_GUIDE.md)
