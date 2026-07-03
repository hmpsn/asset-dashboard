# UI Rebuild F1 — Tokens PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ~82 missing design-token declarations (fonts, type roles, spacing, layout, motion, shadows) to `src/tokens.css` in both theme scopes, load JetBrains Mono, add the `.eyebrow` utility, and ratify the teal vocabulary in docs — the foundation every rebuilt surface consumes.

**Architecture:** Pure additive token work. `src/tokens.css` is the single token source (pr-check enforces `public/styleguide.css` may not redeclare); `copyTokensPlugin()` in `vite.config.ts` mirrors to `public/tokens.css` at build. No component behavior changes; `.t-*` classes keep HEAD behavior (no baked colors, `tabular-nums` kept). Kit token files are the copy source — values verified by the Phase 0 audit ([cross-design-system.md](../../ui-rebuild/phase0/cross-design-system.md) §3).

**Tech Stack:** CSS custom properties, Vite 8, `scripts/pr-check.ts` gates.

**Platform/Model:** Claude/Anthropic — single agent, **Opus** (Sonnet acceptable; the CSS is mechanical but Tasks 5–6 edit CLAUDE.md/BRAND_DESIGN_LANGUAGE and need judgment). Single-author, sequential — no parallel dispatch.

---

## Pre-requisites & ground rules

- **Branch:** work directly on `ui-rebuild-phase-0` (already exists, == `origin/staging` post-Reconcile). Run `git status` + `git branch --show-current` before ANY git write; this checkout can be shared — stage files explicitly by path, never `git add -A`.
- **Decisions already made** — do not relitigate: [PHASE_D_DECISIONS.md](../../ui-rebuild/phase0/PHASE_D_DECISIONS.md). F1-relevant: teal is the canonical word (D6); JetBrains Mono is THE mono; `--shadow-*` is canonical elevation, `--brand-shadow-*` deprecated-but-kept; NO kit z-index extras; NO noise overlay / global focus ring; `.t-*` classes keep HEAD behavior.
- **Copy source:** `hmpsn studio Design System/tokens/*.css` (in-repo, gitignored). Every block below was extracted from those files by the audit — the executor copies from THIS PLAN, and may diff against the kit files to double-check.
- **Never** redeclare a `--*` token outside `src/tokens.css` (pr-check `src-index-css-no-token-declarations` + `styleguide-token-parity`).
- **Docs are part of DoD** (CLAUDE.md session protocol): BRAND_DESIGN_LANGUAGE.md + CLAUDE.md updated in this PR.

## Task dependency graph

```
Task 1 (fonts) → Task 2 (type roles) → Task 3 (space/layout/motion) → Task 4 (shadows)
   → Task 5 (styleguide demo + docs) → Task 6 (full verification + PR)
```
Strictly sequential (all touch `src/tokens.css`); one PR at the end targeting `staging`.

## File ownership (this plan owns exclusively)

- Modify: `src/tokens.css`, `src/index.css`, `public/styleguide.css` (demo markup only — NO `--*` declarations), `public/styleguide.html` (if demo section lives there), `public/tokens.css` (build-mirrored — commit the regenerated file), `BRAND_DESIGN_LANGUAGE.md`, `CLAUDE.md` (one section)

---

### Task 1: Font-family tokens + JetBrains Mono

**Files:** Modify `src/tokens.css`, `src/index.css`

- [ ] **Step 1.1** — In `src/index.css` line 1, extend the Google Fonts import to include JetBrains Mono. Replace:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
```
with:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
```

- [ ] **Step 1.2** — In `src/tokens.css`, add a new section (after the existing Brand colors section, before Border) with a header comment matching the file's existing style:
```css
  /* ─── Font families (F1: UI rebuild foundation) ─── */
  --font-display: 'DIN Pro', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Menlo', 'Courier New', monospace;
```
(Theme-neutral — `:root` only, no `.dashboard-light` entry.)

- [ ] **Step 1.3** — In `src/index.css`, update the two mono type classes (`.t-mono` ~line 600, `.t-micro` ~line 610) to consume the token — Fira Code is retired per Phase D. In BOTH classes replace:
```css
  font-family: 'Fira Code', 'JetBrains Mono', 'Menlo', 'Courier New', monospace;
```
with:
```css
  font-family: var(--font-mono);
```
Do NOT touch any other declaration in these classes (`tabular-nums` etc. stay).

- [ ] **Step 1.4** — Add the `.eyebrow` utility to `src/index.css`, directly after `.t-micro`. First run `grep -n -A8 "eyebrow" public/styleguide.css` and copy that exact rule so app and styleguide stay identical (the audit located it at `public/styleguide.css:94`; the kit's `guidelines/type-scale.css` has the same rule if the grep comes up empty — copy from there and note it in the PR description).

- [ ] **Step 1.5** — Verify:
```bash
grep -c "font-display\|font-sans\|font-mono" src/tokens.css   # expected: 3
grep -c "Fira Code" src/index.css                              # expected: 0
npm run typecheck && npx vite build                            # expected: clean
```

- [ ] **Step 1.6** — Commit:
```bash
git add src/tokens.css src/index.css
git commit -m "feat(ui-rebuild/f1): font-family tokens, JetBrains Mono, .eyebrow utility"
```

### Task 2: Type-role tokens (40)

**Files:** Modify `src/tokens.css`

- [ ] **Step 2.1** — Add after the font-family block (`:root` only; theme-neutral). This is the complete role set from kit `tokens/typography.css`, verbatim values:
```css
  /* ─── Type roles (sizes/weights the .t-* utilities and DS components read) ─── */
  --type-hero-size: 42px;    --type-hero-line: 1.1;  --type-hero-weight: 700; --type-hero-track: -0.03em;
  --type-h1-size: 28px;      --type-h1-line: 1.2;    --type-h1-weight: 600;   --type-h1-track: -0.025em;
  --type-h2-size: 22px;      --type-h2-line: 1.2;    --type-h2-weight: 600;   --type-h2-track: -0.02em;
  --type-stat-lg-size: 34px; --type-stat-lg-weight: 700; --type-stat-lg-track: -0.03em;
  --type-stat-size: 24px;    --type-stat-weight: 700;    --type-stat-track: -0.025em;
  --type-stat-sm-size: 18px; --type-stat-sm-weight: 600; --type-stat-sm-track: -0.02em;
  --type-page-size: 15.5px;  --type-page-line: 1.5;  --type-page-weight: 400;
  --type-body-size: 15.5px;  --type-body-line: 1.5;  --type-body-weight: 500;
  --type-ui-size: 13.5px;    --type-ui-line: 1.4;    --type-ui-weight: 500;
  --type-label-size: 11.5px; --type-label-weight: 500; --type-label-track: 0.06em;
  --type-caption-size: 13.5px; --type-caption-weight: 500;
  --type-mono-size: 12px;    --type-mono-weight: 400; --type-mono-line: 1.5;
  --type-micro-size: 10px;   --type-micro-track: 0.1em;
```
Do NOT rewrite the `.t-*` classes to consume these in F1 — that refactor is a DEF-ledger item (declare it in the PR description); the tokens exist for DS components ported in F3.

- [ ] **Step 2.2** — Verify + commit:
```bash
grep -c -- "--type-" src/tokens.css        # expected: 40
npx vite build                             # expected: clean
git add src/tokens.css && git commit -m "feat(ui-rebuild/f1): type-role tokens (40)"
```

### Task 3: Spacing, layout, motion tokens

**Files:** Modify `src/tokens.css`

- [ ] **Step 3.1** — Add after the existing Border-radius section (all `:root` only; theme-neutral). Note `--radius-*`, `--icon-*` already exist at HEAD — do NOT duplicate them:
```css
  /* ─── Spacing scale (4px rhythm) ─── */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px; --space-5: 20px;
  --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px; --space-16: 64px;

  /* ─── App shell + content boundaries (AppShell/PageContainer read these) ─── */
  --shell-sidebar: 232px;
  --shell-sidebar-rail: 62px;
  --shell-topbar: 56px;
  --page-max: 1180px;
  --page-max-narrow: 760px;
  --page-max-wide: 1440px;
  --page-pad-x: 26px;
  --page-pad-y: 24px;
  --page-pad-bottom: 90px;
  --section-gap: 20px;
  --grid-gap: 12px;
  --grid-gap-lg: 16px;
  --bp-sm: 640px;
  --bp-md: 900px;
  --bp-lg: 1200px;

  /* ─── Motion ─── */
  --ease-out: cubic-bezier(0.22, 0.61, 0.36, 1);
  --ease-draw: cubic-bezier(0.2, 0.7, 0.3, 1);
  --dur-fast: 0.15s;
  --dur-base: 0.25s;
  --dur-slow: 0.5s;
  --stagger-step: 60ms;
```

- [ ] **Step 3.2** — Verify + commit:
```bash
grep -c -- "--space-" src/tokens.css   # expected: 10
grep -c -- "--shell-\|--page-\|--section-gap\|--grid-gap\|--bp-" src/tokens.css  # expected: 15
grep -c -- "--ease-\|--dur-\|--stagger" src/tokens.css  # expected: 6
npx vite build
git add src/tokens.css && git commit -m "feat(ui-rebuild/f1): spacing, layout-boundary, motion tokens"
```

### Task 4: Shadow tokens (both themes) + deprecation note

**Files:** Modify `src/tokens.css`

- [ ] **Step 4.1** — In the `:root` Shadows section (next to the existing `--brand-shadow-sm/md` at ~lines 54–55), add:
```css
  /* Canonical elevation family (F1). --brand-shadow-* is DEPRECATED — do not use
     in new code; migration to --shadow-* is a Z-phase deferred item. */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.25);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -4px rgba(0, 0, 0, 0.2);
  --shadow-glow: 0 8px 32px -6px rgba(45, 212, 191, 0.35);
```

- [ ] **Step 4.2** — In the `.dashboard-light, .light` block (starts ~line 151), add the light overrides:
```css
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 16px rgba(15, 23, 42, 0.10);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.06), 0 4px 6px -4px rgba(0, 0, 0, 0.04);
  --shadow-glow: 0 8px 28px -6px rgba(13, 148, 136, 0.35);
```

- [ ] **Step 4.3** — Verify + commit:
```bash
grep -c -- "--shadow-" src/tokens.css   # expected: 8 (4 root + 4 light)
npx vite build
git add src/tokens.css && git commit -m "feat(ui-rebuild/f1): shadow elevation tokens (both themes), deprecate --brand-shadow-*"
```

### Task 5: Styleguide demo + docs ratification

**Files:** Modify `public/styleguide.css` and/or `public/styleguide.html` (demo only), `BRAND_DESIGN_LANGUAGE.md`, `CLAUDE.md`

- [ ] **Step 5.1** — Locate the styleguide surface: `grep -rn "styleguide" src/App.tsx` (React route) and `ls public/styleguide.html`. Add a compact "Foundation tokens (F1)" demo section to whichever renders sections (spacing ladder swatches, one box per shadow token, a motion demo div using `--dur-base`/`--ease-out`, a line each in `--font-display/sans/mono`). Rules: reference tokens via `var(--…)` ONLY — declaring any `--*` in `public/styleguide.css` fails pr-check `styleguide-token-parity`.

- [ ] **Step 5.2** — `BRAND_DESIGN_LANGUAGE.md`: in the token/typography sections, add the six new token families with one-line purpose each, and add under the color law wording: "'Teal' is the canonical vocabulary for the action color (#2dd4bf). The `--brand-mint` token names are historical aliases for the same family — do not introduce 'mint' in new docs or UI copy." (Ratifies D6.)

- [ ] **Step 5.3** — `CLAUDE.md`: update ONLY the line `**Token categories in src/tokens.css:**` to append: `Font families, Type roles, Spacing scale, Shell/page layout, Motion, Elevation (--shadow-*, canonical; --brand-shadow-* deprecated)`. No other CLAUDE.md edits.

- [ ] **Step 5.4** — Commit:
```bash
git add public/styleguide.css public/styleguide.html BRAND_DESIGN_LANGUAGE.md CLAUDE.md
git commit -m "docs(ui-rebuild/f1): styleguide token demos; ratify teal vocabulary + new token categories"
```

### Task 6: Full verification + PR

- [ ] **Step 6.1** — Full gates (ALL must pass; run sequentially, never two vitest runs at once):
```bash
npm run typecheck                 # zero errors
npx vite build                    # clean build; regenerates public/tokens.css mirror
git status --porcelain public/tokens.css   # if modified: git add public/tokens.css (build mirror is committed)
npx tsx scripts/pr-check.ts       # zero errors (watch: styleguide-token-parity, src-index-css-no-token-declarations)
npm run lint:hooks                # zero errors
npx vitest run                    # FULL suite — not just affected tests
```

- [ ] **Step 6.2** — Real-render smoke (fonts are the one visible change): start the dev server via the preview tooling, load any admin page, verify in devtools that `.t-mono` computes `font-family: "JetBrains Mono", …` and no FOUT/404 on the Google Fonts request; toggle `.dashboard-light` on `<html>` via devtools and confirm shadow tokens resolve to the light values.

- [ ] **Step 6.3** — Commit mirror if changed, then open the PR to `staging`:
```bash
git push -u origin ui-rebuild-phase-0
gh pr create --base staging --title "UI Rebuild F1 — foundation tokens (fonts, type roles, spacing, layout, motion, shadows)" --body "<summary; note DEF items: .t-* token-consumption refactor deferred to F3; --brand-shadow-* migration deferred to Z; ledger rows to be added when data/ui-rebuild-deferred-ledger.json ships in F2. Link docs/ui-rebuild/phase0/PHASE_D_DECISIONS.md>"
```

---

## Verification strategy (summary)

pr-check parity rules are the machine gate for this PR's risk class (token drift between app/styleguide); the build regenerates the public mirror; the full vitest suite guards against accidental behavioral change (there should be **zero** component behavior change — any test failure means scope was exceeded); the flag-free real-render smoke covers the only user-visible change (mono font + light-shadow resolution).

## Systemic improvements (deliberately deferred, tracked)

- `.t-*` classes consuming `--type-*` tokens → F3 (with the DS component ports).
- `--brand-shadow-*` → `--shadow-*` migration → Z phase.
- pr-check rule "no raw shadow/duration/easing literals in `@ds-rebuilt` files" → F2 gates PR (per cross-consistency design).
- These become `DEF-*` ledger rows when `data/ui-rebuild-deferred-ledger.json` ships in F2 — until then the PR description is the record.

## Definition of done

- [ ] All Task 6 gates green (typecheck, build, pr-check, lint:hooks, full vitest)
- [ ] ~82 new tokens present: 3 font + 40 type + 10 space + 15 layout + 6 motion + 8 shadow (4 root + 4 light) — grep counts as in tasks
- [ ] Zero `--*` declarations added outside `src/tokens.css`
- [ ] `.t-*` visual behavior unchanged except mono font family
- [ ] BRAND_DESIGN_LANGUAGE.md + CLAUDE.md token-categories updated; teal ratified
- [ ] PR open against `staging` with DEF items named in the description
