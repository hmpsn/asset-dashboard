# Design System Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a formal 3-tier CSS surface token system, wire it into the shared primitives, add automated pr-check enforcement, audit all 47 affected files, then migrate them by subsystem cluster.

**Architecture:** Phase 0 adds surface tokens and wires them into SectionCard/StatCard/Skeleton (the linchpin — without this, migrations don't advance the token system). Phase 1 adds enforcement rules. Phase 2 produces a categorized migration inventory. Phase 3 executes six subsystem-cluster PRs. Phase 4 adds primitives identified as missing during Phase 3.

**Brand framing:** Phase 3 is an intentional brand upgrade, not a neutral refactor. Cards migrated to SectionCard default get the brand asymmetric radius (`10px 24px 10px 24px`). This is correct and desired. Document it in each PR description.

**Tech stack:** React 19, TailwindCSS 4, `src/index.css` CSS custom properties, `scripts/pr-check.ts` grep/customCheck harness, `src/components/ui/` shared primitives.

**Known scope:** 92 hand-rolled card instances across 47 files (confirmed via `grep`). Six cluster PRs. Not one-page-per-PR — that would be 47 PRs.

---

## Prerequisites

- [ ] v9 Styleguide HTML available for Task 0.3 — Tasks 0.1, 0.2, 0.5 can start without it
- [ ] `npm run typecheck` passes on current branch
- [ ] `npx tsx scripts/pr-check.ts` passes on current branch

---

## Phase 0 — Ground Truth (one PR)

> Additive only. Zero visual change. Every later phase depends on this landing first.

### Task 0.1 — Add `--surface-N` and `--radius-*` tokens to `src/index.css` (Model: haiku)

**Owns:** `src/index.css`
**Must not touch:** any `.tsx` file, design docs

- [ ] **Step 1: Replace the `:root` block (lines 12–29)**

The existing block defines `--brand-bg-*` with raw hex. Replace entirely with:

```css
:root {
  /* ─── 3-tier surface system (canonical — use in new code) ─── */
  --surface-1: #0f1219;       /* page background / absolute base */
  --surface-2: #18181b;       /* primary card surfaces (bg-zinc-900 equivalent) */
  --surface-3: #27272a;       /* elevated: inputs, active tabs, hover (bg-zinc-800 equivalent) */

  /* ─── Radius scale ─── */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;          /* cards, panels — use rounded-[var(--radius-lg)] in new code */
  --radius-xl: 16px;          /* modals, large overlays */

  /* ─── Legacy background aliases (do not use in new code) ─── */
  --brand-bg: var(--surface-1);
  --brand-bg-surface: var(--surface-2);
  --brand-bg-elevated: var(--surface-2);
  --brand-bg-card: var(--surface-3);

  /* ─── Text ─── */
  --brand-text: #a1a1aa;
  --brand-text-bright: #e4e4e7;
  --brand-text-muted: #71717a;

  /* ─── Brand accent ─── */
  --brand-mint: #2dd4bf;
  --brand-mint-hover: #5eead4;
  --brand-mint-dim: rgba(45, 212, 191, 0.1);
  --brand-mint-glow: rgba(45, 212, 191, 0.18);
  --brand-yellow: #ffb600;
  --brand-yellow-dim: rgba(255, 182, 0, 0.1);
  --brand-border: #27272a;
  --brand-border-hover: #3f3f46;
  --radius: 10px; /* legacy — prefer --radius-* scale */
}
```

- [ ] **Step 2: Add light-mode surface overrides inside the `.dashboard-light` block**

Find `.dashboard-light {` (around line 278 after your edits). Add immediately after the opening brace, before the existing `/* Backgrounds */` comment:

```css
  /* ─── Surface tokens (light-mode overrides) ─── */
  --surface-1: #f8fafc;
  --surface-2: #ffffff;
  --surface-3: #f1f5f9;
```

- [ ] **Step 3: Confirm computed values are identical**

```bash
npm run dev
```

Open `/styleguide`. All cards, inputs, page backgrounds must look visually identical to before. The tokens are purely additive aliases at this point.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(tokens): introduce --surface-1/2/3 and --radius-* CSS variables

Adds a formal 3-tier surface system. --brand-bg-* are now var() aliases
so computed values are unchanged — zero visual difference.
--radius-sm/md/lg/xl give a named scale to replace hardcoded Tailwind
radius classes on new card elements."
```

---

### Task 0.2 — Update design docs to reference canonical token names (Model: haiku)

**Owns:** `DESIGN_SYSTEM.md`, `BRAND_DESIGN_LANGUAGE.md`
**Must not touch:** `src/index.css`, any `.tsx` file

- [ ] **Step 1: Replace the Surface Colors section in `BRAND_DESIGN_LANGUAGE.md`**

Find `### Surface Colors (Dark Mode — Default)` (around line 71). Replace the section through the end of the Light Mode table with:

```markdown
### Surface Colors

> **Canonical tokens are `--surface-N`.** The `--brand-bg-*` names are legacy aliases kept for backward compatibility — do not use them in new code.

#### Dark Mode (default)

| Canonical Token | Value | Tailwind Equivalent | Legacy Alias | Usage |
|-----------------|-------|---------------------|--------------|-------|
| `--surface-1` | `#0f1219` | body background | `--brand-bg` | Page background / absolute base |
| `--surface-2` | `#18181b` | `bg-zinc-900` | `--brand-bg-surface`, `--brand-bg-elevated` | Primary card surfaces |
| `--surface-3` | `#27272a` | `bg-zinc-800` | `--brand-bg-card` | Elevated: inputs, active tabs, hover states |
| `--border-default` | `#27272a` | `border-zinc-800` | `--brand-border` | Card borders |
| `--border-hover` | `#3f3f46` | `border-zinc-700` | `--brand-border-hover` | Hover border state |
| `--text-primary` | `#f4f4f5` | `text-zinc-100` | — | Headings, key content |
| `--text-secondary` | `#b4b4bc` | `text-zinc-400` | — | Descriptions, supporting text |
| `--text-muted` | `#a1a1aa` | `text-zinc-500` | — | Captions, timestamps, labels |
| `--text-subtle` | `#71717a` | `text-zinc-600/700` | — | Disabled, dividers |

#### Light Mode (`.dashboard-light`)

| Canonical Token | Value | Usage |
|-----------------|-------|-------|
| `--surface-1` | `#f8fafc` | Page background |
| `--surface-2` | `#ffffff` | Card backgrounds |
| `--surface-3` | `#f1f5f9` | Inputs, active tabs |
| `--border-default` | `#e2e8f0` | Card borders |
| `--text-primary` | `#0f172a` | Dark navy — headings, key content |
| `--text-secondary` | `#334155` | Descriptions |
| `--text-muted` | `#475569` | Captions, labels |
| `--text-subtle` | `#64748b` | Disabled |
```

- [ ] **Step 2: Add radius scale table to `DESIGN_SYSTEM.md`**

After the Typography Scale table, insert:

```markdown
---

## Radius Scale

| Token | Value | Tailwind Equivalent | Usage |
|-------|-------|---------------------|-------|
| `--radius-sm` | `6px` | `rounded` | Small controls, pills, badges |
| `--radius-md` | `8px` | `rounded-md` | Buttons, inputs |
| `--radius-lg` | `12px` | `rounded-xl` | Cards, panels — new code uses `rounded-[var(--radius-lg)]` |
| `--radius-xl` | `16px` | `rounded-2xl` | Modals, large overlays |

**Brand asymmetric radius:** `SectionCard` default variant uses `10px 24px 10px 24px` (the brand signature). This is intentional and correct. The `--radius-lg` token governs new generic cards; the asymmetric radius is a SectionCard-specific design decision, not a token.

**Rule for new card elements:** use `rounded-[var(--radius-lg)]` not the hardcoded Tailwind class `rounded-xl`. This makes the radius system themeable.
```

- [ ] **Step 3: Update the Color System table in `DESIGN_SYSTEM.md`**

Find `### Dark Mode (default)` around line 52. Replace its table to add the Canonical Token column:

```markdown
### Dark Mode (default)

| Canonical Token | Legacy Name | Value | Tailwind | Usage |
|-----------------|-------------|-------|----------|-------|
| `--surface-1` | `--brand-bg` | #0f1219 | — | Page background |
| `--surface-2` | `--brand-bg-surface/elevated` | #18181b | bg-zinc-900 | Card backgrounds |
| `--surface-3` | `--brand-bg-card` | #27272a | bg-zinc-800 | Inputs, active tabs, hover states |
| — | `--brand-border` | #27272a | border-zinc-800 | Card borders |
| — | `--brand-border-hover` | #3f3f46 | border-zinc-700 | Hover border state |
| — | — | #f4f4f5 | text-zinc-100/200 | Headings, key content |
| — | — | #b4b4bc | text-zinc-400 | Descriptions, supporting text |
| — | — | #a1a1aa | text-zinc-500 | Captions, timestamps, labels |
| — | — | #71717a | text-zinc-600/700 | Disabled, dividers |
```

- [ ] **Step 4: Commit**

```bash
git add DESIGN_SYSTEM.md BRAND_DESIGN_LANGUAGE.md
git commit -m "docs(design-system): document --surface-N as canonical surface tokens

Marks --brand-bg-* as legacy aliases. Adds radius scale table with
brand asymmetric-radius note. Updates both design docs."
```

---

### Task 0.3 — ~~Port Styleguide v9 into React~~ **COMPLETE — static HTML approach**

> **This task is already done.** The v9 styleguide (manifesto, scroll-spy TOC, surface system, motion section, dark/light toggle, D-DIN-PRO typography) is served as a static HTML file from `/public/styleguide.html`. The React route `/styleguide` redirects there via `window.location.replace`. No React porting required.
>
> **Why static:** the styleguide is a design reference document, not a product feature. Static HTML/CSS is the canonical source — no JSX translation layer that can introduce drift. The page intentionally exits the SPA and has no auth requirement.
>
> **Files already in place:**
> - `/public/styleguide.html` — full v9 HTML
> - `/public/styleguide.css` — styleguide styles
> - `/public/assets/logo-mint.svg`, `/public/assets/logo-navy.svg`
> - `src/App.tsx` — `StyleguideRedirect` inline component (lines ~75–78), not lazy-loaded (`src/components/Styleguide.tsx` was deleted)
>
> Skip to Task 0.5.

---

### _Removed steps (kept for reference only — do not execute)_

_All steps removed — superseded by the static HTML approach above._

---

### Task 0.5 — Wire `--surface-2` into SectionCard, StatCard, and Skeleton (Model: haiku)

**This is the architectural linchpin.** Without this, Phase 3 migrations adopt SectionCard but SectionCard still themes via Tailwind class overrides, not `--surface-N`. The token system stays cosmetic.

**Why this is safe:** Phase 0.1 adds `.dashboard-light { --surface-2: #ffffff; }`. The Tailwind class override `.dashboard-light .bg-zinc-900 { background-color: ...; }` remains in `src/index.css` for all other components that haven't migrated yet. So light-mode theming works for both old and new code simultaneously.

**Owns:** `src/components/ui/SectionCard.tsx`, `src/components/ui/StatCard.tsx`, `src/components/ui/Skeleton.tsx`
**Must not touch:** any page component file, `src/index.css`

> **Note on line numbers:** the steps below reference line numbers as orientation only — use the search patterns, not the line numbers, since they may drift if other PRs touch these files first.

- [ ] **Step 1: Update SectionCard.tsx**

Search for the `containerClasses` assignment and replace:

```tsx
// Before:
const containerClasses = isSubtle
    ? 'bg-zinc-900/40 border border-zinc-800 rounded-lg overflow-hidden transition-colors duration-200'
    : 'bg-zinc-900 border border-zinc-800 transition-colors duration-200';

// After:
const containerClasses = isSubtle
    ? 'bg-[var(--surface-2)]/40 border border-zinc-800 rounded-lg overflow-hidden transition-colors duration-200'
    : 'bg-[var(--surface-2)] border border-zinc-800 transition-colors duration-200';
```

Also update the JSDoc comment to reflect the new token (search for `bg-zinc-900` in the JSDoc):
```tsx
// Before: — solid `bg-zinc-900` with the brand asymmetric...
// After:  — solid `bg-[var(--surface-2)]` with the brand asymmetric...
```

- [ ] **Step 2: Update StatCard.tsx**

Two instances — search for `bg-zinc-900` in the file and replace both:

```tsx
// StatCard card wrapper — before:
className={`bg-zinc-900 ${isHero ? 'p-4' : 'p-3'} border border-zinc-800 ...`}
// After:
className={`bg-[var(--surface-2)] ${isHero ? 'p-4' : 'p-3'} border border-zinc-800 ...`}

// CompactStatBar wrapper — before:
className={`bg-zinc-900 border border-zinc-800 px-5 py-3 ...`}
// After:
className={`bg-[var(--surface-2)] border border-zinc-800 px-5 py-3 ...`}
```

- [ ] **Step 3: Update Skeleton.tsx**

Three instances — all are card-mimicking wrappers. Search for each `bg-zinc-900` string and replace:

```tsx
// Instance 1 — before: `bg-zinc-900 p-4 border border-zinc-800 ${className ?? ''}`
//              after:  `bg-[var(--surface-2)] p-4 border border-zinc-800 ${className ?? ''}`

// Instance 2 — before: `bg-zinc-900 border border-zinc-800 p-5 space-y-3 ${className ?? ''}`
//              after:  `bg-[var(--surface-2)] border border-zinc-800 p-5 space-y-3 ${className ?? ''}`

// Instance 3 — before: "bg-zinc-900 border border-zinc-800 p-5"
//              after:  "bg-[var(--surface-2)] border border-zinc-800 p-5"
```

- [ ] **Step 4: Verify light mode still works**

```bash
npm run dev
```

Open `/styleguide`, toggle to Light Mode. SectionCard, StatCard, CompactStatBar, and Skeleton wrappers must all show white backgrounds. If any are dark, the `.dashboard-light { --surface-2: #ffffff; }` override from Task 0.1 is not being applied — check that it was added inside the `.dashboard-light` block, not outside.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/SectionCard.tsx src/components/ui/StatCard.tsx src/components/ui/Skeleton.tsx
git commit -m "feat(primitives): wire --surface-2 into SectionCard, StatCard, Skeleton

Replaces hardcoded bg-zinc-900 with bg-[var(--surface-2)] in the three
card-surface primitives. Light-mode theming now works via the CSS var
override in .dashboard-light rather than a Tailwind class override.
Zero visual change — --surface-2 resolves to #18181b in dark mode and
#ffffff in light mode, same as the previous class-based overrides."
```

---

### Task 0.4 — Phase 0 PR gate (Model: haiku)

- [ ] **Step 1: Full quality gate**

```bash
npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts
```

All must pass. Zero errors.

- [ ] **Step 2: Open PR targeting `staging`**

PR title: `feat(design-system): Phase 0 — surface tokens, primitive token wiring, styleguide v9`

PR description must include:
- Screenshot of styleguide in dark mode showing TOC + new Surface System section
- Screenshot of styleguide in light mode showing cards correctly white (confirms Task 0.5 wiring)

---

## Phase 1 — Enforcement Rules (one PR, after Phase 0 merged)

> Rules that prevent new drift. Must ship before Phase 3 so migrated code is verified clean on every commit.

### Task 1.1 — Add six pr-check rules to `scripts/pr-check.ts` + enforcement doc (Model: sonnet)

**Owns:** `scripts/pr-check.ts`, `docs/rules/design-system-enforcement.md` (new)
**Must not touch:** `src/`

All six rules must scope violations to **git-diff'd files only** (not the entire repo) so existing code isn't flagged en masse during the migration period. Use the `fileGlobs` + `exclude` mechanism for pattern-based rules; for `customCheck` rules, filter against `files` (the diff'd file list passed as the first argument).

Add these six entries at the END of the `CHECKS` array before the closing `];` (line 783+).

- [ ] **Step 1: Add Rule A — Legacy surface token in new code**

```typescript
  {
    name: 'Legacy surface token in new code',
    pattern: 'var\\(--brand-bg-',
    fileGlobs: ['*.tsx', '*.css'],
    exclude: ['src/index.css'],
    message: 'Use var(--surface-1/2/3) instead of var(--brand-bg-*). The --brand-bg-* names are legacy aliases — see DESIGN_SYSTEM.md.',
    severity: 'warn',
    rationale: 'Prevents new code from using deprecated token names that bypass the 3-tier surface system.',
    claudeMdRef: '#design-system--the-three-laws-of-color',
  },
```

- [ ] **Step 2: Add Rule B — Hand-rolled card pattern**

```typescript
  {
    name: 'Hand-rolled card div (use SectionCard)',
    pattern: 'className="[^"]*bg-zinc-9[0-9]{2}[^"]*rounded-xl',
    fileGlobs: ['*.tsx'],
    exclude: [
      'src/components/ui/', // ConfirmDialog (modal), ProgressIndicator (not a card) — correct use of rounded-xl
    ],
    message: 'Use <SectionCard> or <SectionCard variant="subtle"> instead of hand-rolling bg-zinc-9xx + rounded-xl. Add a // pr-check-disable-next-line comment with justification for modals and non-card elements.',
    severity: 'warn',
    rationale: 'Prevents hand-rolled card divs that bypass the SectionCard primitive and the --surface-N token system.',
    claudeMdRef: '#ui-primitives--always-check-before-hand-rolling',
  },
```

- [ ] **Step 3: Add Rule C — PageHeader required on page components**

This rule maintains a curated list of page-level components. New pages are added to the list when they're created. The list is self-documenting: if a file is on it, it's a page component that must have `<PageHeader`.

```typescript
  {
    name: 'Page component missing PageHeader',
    fileGlobs: [],
    message: 'Top-level page components must use <PageHeader>. Add <PageHeader title="..." subtitle="..." /> or add this file to the exclude list in pr-check.ts with a justification comment.',
    severity: 'warn',
    rationale: 'Enforces consistent page-level header structure across all navigable views.',
    claudeMdRef: '#ui-primitives--always-check-before-hand-rolling',
    customCheck: (_files) => {
      // Curated list of page-level components that must have <PageHeader.
      // Add new page components here when they're created.
      // Files marked "needs migration" will be cleaned up in Phase 3.
      const PAGE_COMPONENTS = [
        // Currently missing PageHeader (Phase 3 migration targets):
        'src/components/ContentPipeline.tsx',
        'src/components/ContentManager.tsx',
        'src/components/SeoAudit.tsx',
        'src/components/KeywordStrategy.tsx',
        'src/components/Performance.tsx',
        'src/components/PageSpeedPanel.tsx',
        'src/components/RankTracker.tsx',
        'src/components/ContentBriefs.tsx',
        'src/components/RevenueDashboard.tsx',
        'src/components/ClientDashboard.tsx',
        'src/components/KeywordAnalysis.tsx',
        // Already have PageHeader (guard against regression):
        'src/components/WorkspaceHome.tsx',
        'src/components/WorkspaceOverview.tsx',
        'src/components/AnalyticsHub.tsx',
        'src/components/BrandHub.tsx',
        'src/components/InternalLinks.tsx',
        'src/components/RedirectManager.tsx',
        'src/components/SiteArchitecture.tsx',
        'src/components/Roadmap.tsx',
        'src/components/LlmsTxtGenerator.tsx',
        'src/components/ContentPerformance.tsx',
        'src/components/ContentPlanner.tsx',
        'src/components/ContentSubscriptions.tsx',
        'src/components/FeatureLibrary.tsx',
      ];
      return PAGE_COMPONENTS
        .filter(p => {
          try {
            const content = readFileSync(path.join(ROOT, p), 'utf-8');
            return !content.includes('<PageHeader');
          } catch {
            return false; // file doesn't exist — not a violation
          }
        })
        .map(p => ({ file: p, line: 1, text: 'Missing <PageHeader>' }));
    },
  },
```

- [ ] **Step 4: Add Rule D — Hardcoded card radius outside ui/***

```typescript
  {
    name: 'Hardcoded card radius outside ui primitives',
    pattern: 'className="[^"]*rounded-xl',
    fileGlobs: ['*.tsx'],
    exclude: [
      'src/components/ui/',        // primitives own their own radius
      'public/styleguide.html',    // static reference doc
    ],
    message: 'Use rounded-[var(--radius-lg)] instead of rounded-xl so the radius is themeable. Add a // pr-check-disable-next-line comment with justification for modals or non-card elements.',
    severity: 'warn',
    rationale: 'Prevents hardcoded Tailwind radius classes that bypass the --radius-* token system.',
    claudeMdRef: '#design-system--the-three-laws-of-color',
  },
```

- [ ] **Step 5: Add Rule E — --radius-signature-lg exclusivity**

```typescript
  {
    name: 'radius-signature-lg used outside SectionCard',
    pattern: '--radius-signature-lg',
    fileGlobs: ['*.tsx', '*.css'],
    exclude: [
      'src/components/ui/SectionCard.tsx',
      'public/styleguide.html',
      'public/styleguide.css',
    ],
    message: '--radius-signature-lg is the brand asymmetric radius (10px 24px 10px 24px) and is only permitted inside SectionCard.tsx. Use --radius-lg for other card elements.',
    severity: 'error',
    rationale: 'The asymmetric corner is a SectionCard-only brand signature. Other components adopting it would dilute the design intent.',
    claudeMdRef: '#design-system--the-three-laws-of-color',
  },
```

- [ ] **Step 6: Add Rule F — Non-standard transition-duration**

```typescript
  {
    name: 'Non-standard transition duration',
    pattern: 'transition-duration-\\[(?!120ms|180ms|400ms)',
    fileGlobs: ['*.tsx', '*.css'],
    exclude: [
      'src/components/ui/',
      'public/styleguide.html',
      'public/styleguide.css',
    ],
    message: 'Use transition-duration-[120ms], transition-duration-[180ms], or transition-duration-[400ms] (or var(--motion-*) when the token system ships). Non-standard durations break motion consistency.',
    severity: 'warn',
    rationale: 'Enforces the three-speed motion system: 120ms (micro), 180ms (standard), 400ms (entrance).',
    claudeMdRef: '#design-system--the-three-laws-of-color',
  },
```

- [ ] **Step 7: Verify all six rules fire correctly**

```bash
# Rule A
echo '.test { background: var(--brand-bg-card); }' > /tmp/test-a.css
npx tsx scripts/pr-check.ts --all 2>&1 | grep "Legacy surface token"
rm /tmp/test-a.css

# Rule B
echo '<div className="bg-zinc-900 rounded-xl border p-4">card</div>' > /tmp/test-b.tsx
npx tsx scripts/pr-check.ts --all 2>&1 | grep "Hand-rolled card"
rm /tmp/test-b.tsx

# Rule C
npx tsx scripts/pr-check.ts --all 2>&1 | grep "Page component missing PageHeader" | head -5

# Rule D
echo '<div className="rounded-xl border p-4">card</div>' > /tmp/test-d.tsx
npx tsx scripts/pr-check.ts --all 2>&1 | grep "Hardcoded card radius"
rm /tmp/test-d.tsx

# Rule E
echo '.x { border-radius: var(--radius-signature-lg); }' > /tmp/test-e.css
npx tsx scripts/pr-check.ts --all 2>&1 | grep "radius-signature-lg"
rm /tmp/test-e.css

# Rule F
echo '<div className="transition-duration-[300ms]">x</div>' > /tmp/test-f.tsx
npx tsx scripts/pr-check.ts --all 2>&1 | grep "Non-standard transition"
rm /tmp/test-f.tsx
```

All six must fire. If Rule B or D doesn't fire, check the regex escaping.

- [ ] **Step 8: Create `docs/rules/design-system-enforcement.md`**

```markdown
# Design System Enforcement Rules

These rules are mechanized in `scripts/pr-check.ts` and enforced on every PR diff.
All rules are scoped to files changed in the diff (not the full repo) during the Phase 1–3 migration window.

| Rule | Severity | Pattern | Scope |
|------|----------|---------|-------|
| Legacy surface token | warn | `var(--brand-bg-*)` | `*.tsx`, `*.css` |
| Hand-rolled card div | warn | `bg-zinc-9xx + rounded-xl` | `*.tsx` (excl. `ui/`) |
| Page component missing PageHeader | warn | customCheck curated list | page components |
| Hardcoded card radius | warn | `rounded-xl` outside `ui/` | `*.tsx` (excl. `ui/`) |
| radius-signature-lg exclusivity | **error** | `--radius-signature-lg` | all, excl. SectionCard + styleguide |
| Non-standard transition duration | warn | duration not 120/180/400ms | `*.tsx`, `*.css` |

## Migration path

- Phase 1: All rules ship as `warn` (except Rule E which is `error` immediately).
- Phase 3f: Rules A, B, D promoted to `error` once all 47 files are migrated.
- Phase 4+: Rule F promoted to `error` once `--motion-*` tokens land.

## Escape hatch

Add `// pr-check-disable-next-line` above the offending line with a justification comment.
Only use for modals, non-card elements, or intentional design exceptions.
```

- [ ] **Step 9: Count baseline violations (save for Phase 3 tracking)**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -E "(Hand-rolled|Legacy surface|Missing .PageHeader|Hardcoded card radius|Non-standard transition)" | wc -l
```

Record this number. Phase 3 goal: reduce to zero across migrated clusters.

- [ ] **Step 10: Commit**

```bash
git add scripts/pr-check.ts docs/rules/design-system-enforcement.md
git commit -m "feat(pr-check): Phase 1 — six design system enforcement rules

Rules A–F (all scoped to diff'd files):
- A: Legacy surface token var(--brand-bg-*) → warn
- B: Hand-rolled bg-zinc-9xx + rounded-xl card → warn
- C: Page component missing <PageHeader> → warn (curated list)
- D: Hardcoded rounded-xl outside ui/ → warn
- E: --radius-signature-lg outside SectionCard → error
- F: Non-standard transition-duration → warn

Severity warn during Phase 1-3 migration; A/B/D promote to error in Phase 3f.
Documents rule rationale in docs/rules/design-system-enforcement.md."
```

---

### Task 1.2 — Regenerate `docs/rules/automated-rules.md` (Model: haiku)

**Owns:** `docs/rules/automated-rules.md`
**Must not touch:** `scripts/pr-check.ts`

- [ ] **Step 1: Run the generator**

```bash
npm run rules:generate
```

- [ ] **Step 2: Verify all six new rules appear**

```bash
grep -A 2 "Legacy surface token\|Hand-rolled card\|Page component missing PageHeader\|Hardcoded card radius\|radius-signature-lg\|Non-standard transition" docs/rules/automated-rules.md
```

Expected: all six rules listed with severity, rationale, and file scope.

- [ ] **Step 3: Commit and open PR**

```bash
git add docs/rules/automated-rules.md
git commit -m "docs(rules): regenerate automated-rules.md with Phase 1 enforcement rules"
```

PR title: `feat(pr-check): Phase 1 — surface token, hand-rolled card, and PageHeader enforcement`

---

## Phase 2 — Categorized Component Audit (one PR, after Phase 1 merged)

> Inventory-only. No code changes. The audit produces a migration checklist with a decision for each card instance.

### Task 2.1 — Generate `docs/UI_AUDIT.md` (Model: opus)

**Owns:** `docs/UI_AUDIT.md` (new file)
**Must not touch:** any source file

For each of the 47 affected files, inspect every hand-rolled card instance and assign it one of three migration decisions:

| Decision | When to use | Migration action |
|---|---|---|
| **default** | Main page-level content section | Replace with `<SectionCard>` (gets asymmetric brand corners — intentional upgrade) |
| **subtle** | Dense data, nested inside another card, table wrapper | Replace with `<SectionCard variant="subtle">` |
| **hatch** | Modal, dialog, control (not a card), one-off layout | Add `// pr-check-disable-next-line` with justification, keep as-is |

Files to audit (47 total, confirmed via grep):

**brand/ cluster (5 files):** `brand/BrandscriptTab.tsx`, `brand/DiscoveryTab.tsx`, `brand/VoiceTab.tsx`, `brand/PageStrategyTab.tsx`, `brand/CopyReviewPanel.tsx`

**client/ cluster (10 files):** `client/DataSnapshots.tsx`, `client/HealthTab.tsx`, `client/PlansTab.tsx`, `client/SearchTab.tsx`, `client/StrategyTab.tsx`, `client/FixRecommendations.tsx`, `client/SeoGlossary.tsx`, `client/OutcomeSummary.tsx`, `client/OrderStatus.tsx`, `client/ClientHeader.tsx`

**settings/ cluster (5 files):** `settings/ConnectionsTab.tsx`, `settings/FeaturesTab.tsx`, `settings/ClientDashboardTab.tsx`, `settings/BusinessProfileTab.tsx`, `settings/IntelligenceProfileTab.tsx`

**post-editor/ cluster (5 files):** `post-editor/PostPreview.tsx`, `post-editor/ReviewChecklist.tsx`, `post-editor/SectionEditor.tsx`, `post-editor/VersionHistory.tsx`, `PostEditor.tsx`

**Content / top-level cluster (9 files):** `ContentPipeline.tsx`, `ContentBriefs.tsx`, `CmsEditor.tsx`, `RankTracker.tsx`, `RevenueDashboard.tsx`, `SalesReport.tsx`, `MediaTab.tsx`, `PublishSettings.tsx`, `RequestManager.tsx`

**Scattered cluster (10 files):** `audit/AuditReportExport.tsx`, `charts/AnnotatedTrendChart.tsx`, `editor/BulkOperations.tsx`, `editor/PageEditRow.tsx`, `schema/PagePicker.tsx`, `briefs/RequestList.tsx`, `shared/RankTable.tsx`, `Toast.tsx`, `WorkspaceSelector.tsx`, `CommandPalette.tsx`

**Confirmed hatches (already in ui/):** `ui/ConfirmDialog.tsx` (modal — keep `rounded-xl`), `ui/ProgressIndicator.tsx` (status bar — keep `rounded-xl`)

- [ ] **Step 1: For each file, grep the hand-rolled card instances with line numbers**

```bash
grep -n 'bg-zinc-9[0-9]*.*rounded-xl\|rounded-xl.*bg-zinc-9' src/components/<file>.tsx
```

- [ ] **Step 2: Read each line in context (±5 lines) to classify as default / subtle / hatch**

Heuristics:
- Is it a top-level section container with a title? → **default**
- Is it wrapping a table, list, or dense data? → **subtle**
- Is it a modal, popover, tooltip, select, toast? → **hatch**
- Is it nested inside another card? → **subtle**

- [ ] **Step 3: Write `docs/UI_AUDIT.md`**

```markdown
# UI Primitive Audit — Phase 2 Findings

> Generated 2026-04-23. Migration checklist for Phase 3.
> Decision key: **default** = SectionCard default, **subtle** = SectionCard subtle, **hatch** = keep with justification comment.

## Summary

| Cluster | Files | Default | Subtle | Hatch | Total instances |
|---------|-------|---------|--------|-------|----------------|
| brand/ | 5 | N | N | N | N |
| client/ | 10 | N | N | N | N |
| settings/ | 5 | N | N | N | N |
| post-editor/ | 5 | N | N | N | N |
| content/top-level | 9 | N | N | N | N |
| scattered | 10 | N | N | N | N |
| **Total** | **47** | | | | **92** |

## Per-File Detail

### brand/BrandscriptTab.tsx
| Line | Context snippet | Decision | Reason |
|------|-----------------|----------|--------|
| 45 | `<div className="bg-zinc-900 rounded-xl border...">Content sections</div>` | default | Top-level section wrapper |
| ... | | | |

[Repeat for all 47 files]
```

- [ ] **Step 4: Commit and open PR**

```bash
git add docs/UI_AUDIT.md
git commit -m "docs(audit): Phase 2 — categorized UI primitive migration inventory

Catalogs 92 hand-rolled card instances across 47 files.
Each instance classified as default/subtle/hatch for Phase 3 execution."
```

PR title: `docs(audit): Phase 2 — categorized UI primitive inventory`

---

## Phase 3 — Cluster Migrations (six PRs, after Phase 2 merged)

> One PR per subsystem cluster. Do not start cluster N+1 until cluster N is merged and green on staging. Use `docs/UI_AUDIT.md` decisions for every card.

### Per-cluster checklist (apply to every Phase 3 PR)

For each file in the cluster:
- [ ] Read `docs/UI_AUDIT.md` for the file — get each card's decision (default / subtle / hatch)
- [ ] For **default** cards: replace `<div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">` wrapper with `<SectionCard title="..." titleIcon={<Icon />}>`. Remove the inner title element (SectionCard renders it). Use `noPadding` if the inner content is a table or full-bleed.
- [ ] For **subtle** cards: replace with `<SectionCard variant="subtle" title="...">`. No title prop if the card has no header.
- [ ] For **hatch** cards: add `{/* pr-check-disable-next-line -- [justification] */}` on the line above the className. Do not restructure the element.
- [ ] Verify SectionCard is imported: `grep -n 'SectionCard' <file>`. If not present, add to the existing `import { ... } from './ui'` or `import { ... } from '../ui'` line — never mid-file.
- [ ] If the page file is on the PageHeader curated list and is missing `<PageHeader>`: add it. Locate where the page title/subtitle is currently rendered and replace with `<PageHeader title="..." subtitle="..." />`.
- [ ] Run: `npx tsx scripts/pr-check.ts` — zero new errors, hand-rolled card warnings for this file must be gone.
- [ ] Run: `npm run typecheck`
- [ ] Take browser screenshots before and after (dark mode and light mode for any client/ files).
- [ ] Include the before/after screenshots and the audit decision summary in the PR description.

### Phase 3a — brand/ cluster

**Files:** `brand/BrandscriptTab.tsx`, `brand/DiscoveryTab.tsx`, `brand/VoiceTab.tsx`, `brand/PageStrategyTab.tsx`, `brand/CopyReviewPanel.tsx`
**Owns:** all five files listed above
**Must not touch:** any file outside `src/components/brand/`

- [ ] Apply per-cluster checklist to all five files
- [ ] `npx vitest run` — full suite, not just brand tests
- [ ] `npx vite build`
- [ ] Open PR: `refactor(brand): Phase 3a — migrate brand/ cards to SectionCard primitive`

### Phase 3b — client/ cluster

**Files:** `client/DataSnapshots.tsx`, `client/HealthTab.tsx`, `client/PlansTab.tsx`, `client/SearchTab.tsx`, `client/StrategyTab.tsx`, `client/FixRecommendations.tsx`, `client/SeoGlossary.tsx`, `client/OutcomeSummary.tsx`, `client/OrderStatus.tsx`, `client/ClientHeader.tsx`
**Owns:** all ten files listed above
**Must not touch:** any file outside `src/components/client/`

⚠️ **Light-mode extra check:** All client/ files render under `.dashboard-light`. After migration, toggle to light mode and verify every migrated card shows a white background. If any card stays dark, the SectionCard token wiring from Task 0.5 is not applying — investigate before merging.

- [ ] Apply per-cluster checklist to all ten files
- [ ] Light-mode screenshot for each file in the PR description
- [ ] `npx vitest run && npx vite build`
- [ ] Open PR: `refactor(client): Phase 3b — migrate client/ cards to SectionCard primitive`

### Phase 3c — settings/ cluster

**Files:** `settings/ConnectionsTab.tsx`, `settings/FeaturesTab.tsx`, `settings/ClientDashboardTab.tsx`, `settings/BusinessProfileTab.tsx`, `settings/IntelligenceProfileTab.tsx`
**Owns:** all five files listed above
**Must not touch:** any file outside `src/components/settings/`

- [ ] Apply per-cluster checklist to all five files
- [ ] `npx vitest run && npx vite build`
- [ ] Open PR: `refactor(settings): Phase 3c — migrate settings/ cards to SectionCard primitive`

### Phase 3d — post-editor/ cluster

**Files:** `post-editor/PostPreview.tsx`, `post-editor/ReviewChecklist.tsx`, `post-editor/SectionEditor.tsx`, `post-editor/VersionHistory.tsx`, `PostEditor.tsx`
**Owns:** all five files listed above
**Must not touch:** any file outside `src/components/post-editor/` or `PostEditor.tsx`

- [ ] Apply per-cluster checklist to all five files
- [ ] `npx vitest run && npx vite build`
- [ ] Open PR: `refactor(post-editor): Phase 3d — migrate post-editor cards to SectionCard primitive`

### Phase 3e — Content / top-level cluster

**Files:** `ContentPipeline.tsx`, `ContentBriefs.tsx`, `CmsEditor.tsx`, `RankTracker.tsx`, `RevenueDashboard.tsx`, `SalesReport.tsx`, `MediaTab.tsx`, `PublishSettings.tsx`, `RequestManager.tsx`
**Owns:** all nine files listed above
**Must not touch:** any other file

Note: several of these are on the PageHeader curated list and are missing `<PageHeader>`. Add it for each.

- [ ] Apply per-cluster checklist to all nine files
- [ ] `npx vitest run && npx vite build`
- [ ] Open PR: `refactor(content): Phase 3e — migrate content/top-level cards to SectionCard primitive`

### Phase 3f — Scattered cluster + promote rules to error severity

**Files:** `audit/AuditReportExport.tsx`, `charts/AnnotatedTrendChart.tsx`, `editor/BulkOperations.tsx`, `editor/PageEditRow.tsx`, `schema/PagePicker.tsx`, `briefs/RequestList.tsx`, `shared/RankTable.tsx`, `Toast.tsx`, `WorkspaceSelector.tsx`, `CommandPalette.tsx`
**Also owns:** `scripts/pr-check.ts` (for severity promotion)
**Must not touch:** any file not in the list above

After migrating the final cluster, promote the three Phase 1 rules from `warn` to `error` in `scripts/pr-check.ts`:

```typescript
// Change severity from 'warn' to 'error' for all three rules:
// - 'Legacy surface token in new code'
// - 'Hand-rolled card div (use SectionCard)'
// - 'Page component missing PageHeader'
```

- [ ] Apply per-cluster checklist to all ten files
- [ ] Promote rules to `error` severity in `scripts/pr-check.ts`
- [ ] Run `npm run rules:generate` to update `docs/rules/automated-rules.md`
- [ ] `npx tsx scripts/pr-check.ts --all` — zero violations in any src/components/ file
- [ ] `npx vitest run && npx vite build`
- [ ] Open PR: `refactor(scattered): Phase 3f — final cluster migration + promote rules to error`

---

## Phase 4 — Primitive Hardening (one PR, after Phase 3 complete)

> Add primitives revealed as missing during Phase 3. Scope narrowed after Phase 3 audit (2026-04-24).

### Audit findings (2026-04-24)

An Explore-agent audit across all 38 Phase 3 files measured each anticipated primitive against a 3+ instances bar:

- **`<Surface tier={1|2|3}>`** — **not justified.** Only 9 uses of `bg-[var(--surface-N)]` in Phase 3 files, all already inside SectionCard / StatCard / Skeleton. No bare-div pattern to consolidate. **Deferred.**
- **`<Toolbar>`** — **borderline, deferred.** 6 filter/action rows, but high variance (toggles vs. static headers vs. filter+search+button combos, different padding, different responsibilities). A shared wrapper would be either too loose (just a flex row, no value) or too opinionated (baking assumptions that don't fit all callers). Document the pattern; keep callsites local.
- **`<DataCard>`** — **justified but reshape.** 7 chart+trend instances, but the pattern is not uniform enough for a single wrapper. Split into a thin `<ChartCard>` wrapper + a separate `<TrendBadge>` primitive.

### Primitives to ship

**`<TrendBadge>`** — reusable trend indicator (up/down arrow + % delta, emerald/red coloring). Extracts the canonical `ChangeBadge` helper from [DataSnapshots.tsx:16](src/components/client/DataSnapshots.tsx:16) and replaces hand-rolled versions found in:

- [RevenueDashboard.tsx:134-137](src/components/RevenueDashboard.tsx:134) — monthDelta % vs last month
- [AuditHistory.tsx:47-49](src/components/audit/AuditHistory.tsx:47) — scoreDelta
- [SchemaSuggester.tsx:979](src/components/SchemaSuggester.tsx:979) — clicks delta (inline)
- [DataSnapshots.tsx](src/components/client/DataSnapshots.tsx) — 5 ChangeBadge callsites (extract + replace local helper)

```tsx
// src/components/ui/TrendBadge.tsx
interface TrendBadgeProps {
  value: number;
  suffix?: string;         // default '%'
  invert?: boolean;        // flip what's "good" (e.g. rank position — lower is better)
  showSign?: boolean;      // show '+' prefix for positive values; default false
  label?: string;          // contextual text appended after the value, e.g. 'vs last month'
  size?: 'sm' | 'md';      // sm = 11px / w-3 (default), md = 12px / w-3.5
  hideOnZero?: boolean;    // default true
  className?: string;
}
```

Renders `TrendingUp` + `text-emerald-400` for positive, `TrendingDown` + `text-red-400` for negative, `null` (or `Minus` + `text-zinc-400`) for zero based on `hideOnZero`.

**`<ChartCard>`** — thin SectionCard wrapper with chart-friendly defaults: tighter padding (`px-4 py-3`), inline title+trend row (no border-b separator), no asymmetric corner clash with embedded recharts containers. Pairs with existing `<AnnotatedTrendChart>` and `<MiniSparkline>`.

```tsx
// src/components/ui/ChartCard.tsx
interface ChartCardProps {
  title?: string;
  titleIcon?: ReactNode;
  /** Trend delta to display inline next to title. Rendered via <TrendBadge>. */
  trend?: number;
  /** Props forwarded to the inline TrendBadge (suffix, label, invert, etc.). */
  trendProps?: Omit<TrendBadgeProps, 'value'>;
  /** Right-aligned slot (e.g. a "View details" link). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}
```

### Per-primitive checklist

- [ ] Create `src/components/ui/TrendBadge.tsx` and `src/components/ui/ChartCard.tsx`
- [ ] Export both from `src/components/ui/index.ts` barrel
- [ ] Add demonstration section to `/public/styleguide.html`
- [ ] Add pr-check **warn** rule: hand-rolled TrendingUp/Down + emerald-400/red-400 pattern should use `<TrendBadge>` (warn for now; promote to error in a follow-up after adoption)
- [ ] Add pr-check fixture tests in `tests/pr-check.test.ts`
- [ ] Migrate the 7 identified callsites (DataSnapshots × 5 ChangeBadge, RevenueDashboard, AuditHistory, SchemaSuggester) to `<TrendBadge>` in the same PR
- [ ] `npm run rules:generate`
- [ ] `npm run typecheck && npx vite build && npx vitest run && npx tsx scripts/pr-check.ts`
- [ ] Open PR: `feat(primitives): Phase 4 — ChartCard + TrendBadge primitives`

### Deferred

`<Surface>` and `<Toolbar>` are intentionally deferred. Revisit if a future phase surfaces 3+ new callsites.

---

## Task Dependencies

```
Phase 0.1 (index.css tokens)  ─┐
Phase 0.2 (design docs)        ├─→ all can run in parallel
Phase 0.3 (styleguide v9)*     ┘   *0.3 requires v9 HTML
                ↓ (all committed)
Phase 0.5 (wire primitives)   ─→ depends on 0.1 (--surface-2 must exist)
                ↓
Phase 0.4 (PR gate)           ─→ all Phase 0 tasks committed

Phase 0 merged to staging
                ↓
Phase 1.1 (pr-check rules)    ─→ sequential
Phase 1.2 (regenerate docs)   ─→ after 1.1

Phase 1 merged to staging
                ↓
Phase 2.1 (audit)             ─→ single task

Phase 2 merged to staging
                ↓
Phase 3a (brand/)             ─→ sequential, one PR per cluster
Phase 3b (client/)            ─→ after 3a
Phase 3c (settings/)          ─→ after 3b
Phase 3d (post-editor/)       ─→ after 3c
Phase 3e (content/top-level)  ─→ after 3d
Phase 3f (scattered + error)  ─→ after 3e

Phase 3 complete
                ↓
Phase 4 (new primitives)      ─→ informed by Phase 3 findings
```

---

## Systemic Improvements

**Shared utilities added:** `Surface` component (Phase 4). SectionCard/StatCard/Skeleton already adopt `--surface-2` in Phase 0.5.

**pr-check rules added:**
- `Legacy surface token in new code` (Phase 1, warn → error in Phase 3f)
- `Hand-rolled card div` (Phase 1, warn → error in Phase 3f)
- `Page component missing PageHeader` (Phase 1, warn → error in Phase 3f)
- Per-primitive rules for Phase 4 additions

**Tests required:** No new vitest tests (CSS and design-pattern work). Add a pr-check test fixture for each of the three new rules in `tests/pr-check.test.ts` — the existing harness supports this. One fixture per rule: a file that triggers the violation and a file that doesn't.

---

## Verification Strategy

| Phase | Verification |
|---|---|
| Phase 0 | `/styleguide` dark mode: zero visual change, TOC + new sections visible. Light mode: all primitive cards white (confirms Task 0.5). |
| Phase 1 | `npx tsx scripts/pr-check.ts --all` fires on known violations; clean on `src/components/ui/` directory. |
| Phase 2 | `docs/UI_AUDIT.md` covers all 47 files, each instance has a decision (default/subtle/hatch). |
| Phase 3 (each cluster) | Before/after browser screenshots in PR (dark + light). `npx tsx scripts/pr-check.ts` shows zero hand-rolled card warnings for the cluster's files. |
| Phase 3f | `npx tsx scripts/pr-check.ts --all` zero violations anywhere in `src/components/`. |
| Phase 4 | New primitives render in `/styleguide`. pr-check rule fires on synthetic test. |

---

## Quality Gates (each PR before opening)

- [ ] `npm run typecheck` — zero errors
- [ ] `npx vite build` — production build succeeds
- [ ] `npx vitest run` — full test suite passes (not just changed files)
- [ ] `npx tsx scripts/pr-check.ts` — zero errors (warns acceptable during Phases 0–3e)
- [ ] `BRAND_DESIGN_LANGUAGE.md` updated if any color/surface semantics changed
- [ ] `data/roadmap.json` updated when a phase is marked done
- [ ] Phase N+1 does not start until Phase N is merged and green on staging
