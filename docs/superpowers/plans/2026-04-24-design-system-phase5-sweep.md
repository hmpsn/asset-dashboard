# Design System Phase 5 — Total Unification Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every hand-rolled UI element in `src/` and enforce that all visual output flows through a single token pipeline: `src/index.css` → `public/styleguide.html` (mirror) → `src/components/ui/*` primitives → every consumer. Zero drift, zero one-offs, zero arbitrary values.

**Prior work:** Phase 4 (PR #273, #278) introduced `<TrendBadge>` + `<ChartCard>` primitives and the `v9` static styleguide. Phase 5 lands the rest of the system.

**Non-goals:** New product features, routing changes, data-layer refactors. This is pure UI unification.

**Non-triggers (confirmed not applicable):**
- React Query cache invalidation — no data mutations
- WebSocket event contracts — no new events
- Auth / workspace-scoping — no new endpoints
- DB migrations — no schema changes
- Route removal checklist — no route removals (`docs/rules/route-removal-checklist.md`)
- Activity logging / broadcast — no workspace mutations

**Source of truth policy (set by product owner 2026-04-24):**
1. `src/index.css` is the ONE canonical token file. Every `--*` variable lives here.
2. `public/styleguide.html` + `public/styleguide.css` visually demo those tokens. They `@import` from `/index.css` (served at runtime) rather than copy values. If they diverge from `index.css`, `pr-check` fails.
3. Every UI component in `src/components/` reads from `var(--*)` or from a `.t-*` utility class. Raw hex, raw `text-zinc-*`, raw `bg-zinc-*`, raw `rounded-lg`, arbitrary `text-[Npx]` are violations.
4. No gaps. Modals, dropdowns, tooltips, form validation states, tabs, dividers — every UI concept has a primitive AND a styleguide section.

---

## Audit Summary (from 10 parallel audit agents, April 23–24)

Ground-truth verified via repo-wide grep:

| Violation class | Count | Representative fix |
|---|---|---|
| Arbitrary `text-[Npx]` values | 2,257 | → `.t-*` utility class |
| Raw `text-zinc-*` | 2,844 | → `var(--brand-text/bright/muted/dim)` |
| Raw `bg-zinc-*` | 1,730 | → `var(--surface-1/2/3)` |
| Raw `border-zinc-*` | 1,363 | → `var(--brand-border)` |
| `rounded-lg` (zero uses of `--radius-*`) | 1,104 | → `rounded-[var(--radius-lg)]` |
| Hand-rolled buttons | 1,132 | → `<Button>` / `<IconButton>` |
| Hand-rolled form controls | 303 | → `<FormInput>` / `<FormSelect>` / etc. |
| Inline `flex items-center gap-*` | ~1,200 | → `<Row>` / `<Stack>` |
| Inline asymmetric `borderRadius: '...'` | 263 | → wrap in `<SectionCard>` if card-like and structurally compatible. Non-SectionCard containers MAY keep `rounded-[var(--radius-signature-lg)]` if the asymmetric brand signature is intentional — they must declare intent with `// pr-check-disable-next-line -- <reason>` per site. Cards without specific brand intent should use `rounded-[var(--radius-lg)]`. |
| Hand-rolled modals (`fixed inset-0`) | 21 | → `<Modal>` |
| Hand-rolled dropdowns | 15+ | → `<Popover>` |
| Hand-rolled pills bypassing Badge | 30+ | → `<StatusPill>` or `<Badge>` |
| Hand-rolled dividers | 50+ | → `<Divider>` |
| Trend icon imports outside TrendBadge | 55 files | → `<TrendBadge>` |
| **Law violations** | | |
| Purple in non-admin-AI contexts | 26 | remove (Law 04) |
| Rose / pink (no styleguide hue) | 14 | remove |
| `text-green-400` (should be emerald) | 10 | → emerald |
| `scoreColorClass` returns green, `scoreColor` returns emerald hex | 38+ callsites | reconcile to emerald |
| `Badge.tsx` exposes `purple` variant (client-reachable) | 1 | remove variant |
| `statusConfig.ts` `'in-review'` = purple | 1 | → blue (data) or zinc |

Full audit outputs in `docs/superpowers/audits/2026-04-24-phase5/` (committed in Task 0.1).

---

## Pre-requisites

- [ ] Phase 4 (`TrendBadge` + `ChartCard`, PR #273, #278) merged to main
- [ ] 10 audit outputs captured at `/private/tmp/claude-501/.../tasks/*.output` for Task 0.1 ingestion
- [ ] Canonical token file path agreed: `src/tokens.css` (shared between Vite build and styleguide — see Task 0.2 for the two-file architecture that resolves the `/src/*` URL not being prod-reachable)
- [ ] `npm run typecheck && npx vitest run && npx tsx scripts/pr-check.ts` green on current branch before Phase 0 dispatch
- [ ] Existing `docs/rules/design-system-enforcement.md` reviewed — Phase 3 extends it; does not create a parallel rules doc

## Feature-flag posture

No `FeatureFlag` registered. Rationale: every Phase 1 primitive is additive (unconsumed until Phase 2), and every Phase 2 migration is visually behavior-preserving (if a page looks different, it's a bug and the PR reverts). Single-PR rollback per Phase 2 domain is sufficient. **If a Phase 2 PR introduces a visible regression on a live page**, revert that PR — do not hotfix with a flag.

## Deploy flow

Every PR in this plan targets `staging` per `docs/workflows/deploy.md`. After each phase's PRs merge to `staging` and smoke-test passes on `asset-dashboard-staging.onrender.com`, `staging` → `main` to release. Phase N+1 PRs do not open until Phase N is green on main.

---

## Task Dependencies

```
Phase 0 (sequential inside single PR):
  Task 0.0 → Task 0.1 → Task 0.2 → Task 0.3 → Task 0.4 → Task 0.5 → Task 0.6 → Task 0.7

Phase 1 (after Phase 0 on main):
  Task 1.1 ∥ Task 1.2 ∥ Task 1.3 ∥ Task 1.4 ∥ Task 1.5 ∥ Task 1.6
  (6 parallel PRs; shared barrel handled via pre-committed stub skeleton in Phase 0 Task 0.0)

Phase 2 (after all 6 Phase 1 PRs on main):
  Task 2.1 ∥ Task 2.2 ∥ Task 2.3 ∥ Task 2.4 ∥ Task 2.5
  (5 parallel PRs; disjoint file domains)

Phase 3 (after all Phase 2 PRs on main):
  Task 3.1 (single PR, sequential)
```

Any task that modifies a file owned by a parallel peer is a blocker — report `NEEDS_CONTEXT` and stop.

---

## Phase Map

```
Phase 0  (1 PR)  — Foundation: token reconciliation + law violation cleanup
Phase 1  (6 PRs) — Primitives + styleguide sections + codemod scaffolds
Phase 2  (5 PRs) — Codemod execution by page domain
Phase 3  (1 PR)  — pr-check enforcement hardening
─────────
13 PRs total, ~3–4 weeks
```

Phase 1 PRs are parallel-safe after Phase 0 merges. Phase 2 PRs are parallel-safe after all Phase 1 primitives land. Phase 3 lands after Phase 2.

---

## Phase 0 — Foundation

**One PR. Additive tokens + law-violation cleanup + audit commit + guardrails docs + barrel skeleton. Must merge before anything else.**

### Phase 0 Acceptance Checklist

- [ ] `src/tokens.css` contains every token from the styleguide (union of `src/index.css` + `public/styleguide.css`)
- [ ] `src/index.css` and `public/styleguide.css` both `@import` from a single canonical URL; neither redeclares tokens
- [ ] `/styleguide.html` renders identically to pre-edit screenshots in both dev (`npm run dev`) and prod preview (`npx vite preview` after `npx vite build`)
- [ ] `.t-*` typography classes are callable from any `.tsx` via className
- [ ] `scoreColorClass` returns emerald classes matching `scoreColor` hex values
- [ ] Zero purple/violet hits in `src/components/client/`; zero rose/pink hits in `src/components/`; zero `text-green-400` used as success indicator
- [ ] `src/components/ui/index.ts` exports stub placeholders for every Phase 1 primitive (so Phase 1 agents add files, not export lines)
- [ ] `docs/rules/design-system-enforcement.md` updated with Phase 5 migration section
- [ ] CLAUDE.md "Design System — The Three Laws of Color" section updated to acknowledge emerald as Law 03 (separate from green)
- [ ] `data/roadmap.json` Phase 0 entries marked done, sprint sorted via `npx tsx scripts/sort-roadmap.ts`
- [ ] `FEATURE_AUDIT.md` Phase 5 entry created with foundation-landed status

### Task 0.0 — Pre-commit barrel skeleton (Model: haiku)

**Owns:** `src/components/ui/index.ts`, empty placeholder files for each Phase 1 primitive
**Must not touch:** anything else

Rationale: 6 parallel Phase 1 agents appending to the same barrel creates guaranteed merge conflicts. Pre-commit export lines pointing at empty files; Phase 1 agents fill file contents without editing the barrel.

- [ ] Create empty files (each with a single placeholder default export):
  - `src/components/ui/typography/Heading.tsx`, `Stat.tsx`, `BodyText.tsx`, `Caption.tsx`, `Label.tsx`, `Mono.tsx`, `index.ts`
  - `src/components/ui/Icon.tsx`
  - `src/components/ui/Button.tsx`, `IconButton.tsx`, `ActionPill.tsx`, `SegmentedControl.tsx`
  - `src/components/ui/forms/FormField.tsx`, `FormInput.tsx`, `FormSelect.tsx`, `FormTextarea.tsx`, `Checkbox.tsx`, `Toggle.tsx`, `index.ts`
  - `src/components/ui/layout/Row.tsx`, `Stack.tsx`, `Column.tsx`, `Grid.tsx`, `Divider.tsx`, `index.ts`
  - `src/components/ui/overlay/Modal.tsx`, `Popover.tsx`, `Tooltip.tsx`, `index.ts`
- [ ] Each placeholder exports a minimal component (`export function X(){ return null; }`) so TS/lint passes
- [ ] Append re-exports to `src/components/ui/index.ts` (one block per subgroup with clear comments) so Phase 1 agents ONLY edit the primitive files, never the barrel
- [ ] `npm run typecheck && npx vite build` — zero errors

### Task 0.1 — Commit audit outputs (Model: haiku)

**Owns:** `docs/superpowers/audits/2026-04-24-phase5/*.md`

- [ ] Create `docs/superpowers/audits/2026-04-24-phase5/` directory
- [ ] Copy each of the 10 audit agent outputs (from `/private/tmp/.../tasks/*.output`) into that directory with descriptive filenames: `pass1-ui-primitives.md`, `pass1-admin-pages.md`, `pass1-client-pages.md`, `pass1-brand-tools.md`, `pass1-feature-modules.md`, `pass1-shared-components.md`, `pass2-typography.md`, `pass2-buttons-forms.md`, `pass2-colors-borders.md`, `pass2-spacing-icons-layout.md`
- [ ] Create `README.md` in that directory: one paragraph explaining these are frozen as the Phase 5 scope reference; do not edit — superseded findings go in new dated audits

### Task 0.2 — Extract canonical tokens to `src/tokens.css` (Model: sonnet)

**Owns:** NEW `src/tokens.css`, `src/index.css`, `public/styleguide.css`, `vite.config.ts` (build-time copy), `scripts/verify-styleguide-parity.ts` (new)

**Must not touch:** any `.tsx` file, any other `.css` file

**Architecture note (resolves a prod-serving gap):** `/src/*` URLs are only served by Vite in dev — in prod they become hashed bundles that standalone HTML pages can't reference. Solution: tokens live in `src/tokens.css` (canonical, under Vite's watch), imported by `src/index.css` (the app bundle) AND copied to `public/tokens.css` during build so `styleguide.html` can `@import url('/tokens.css')` at both dev and prod URLs.

- [ ] Read `public/styleguide.css` fully and current `src/index.css` fully. Produce a diff report (in PR description, not commit message): what tokens exist in styleguide.css but not index.css, and what differs in value between the two.
- [ ] Create `src/tokens.css` containing ONLY `:root { ... }` + `.dashboard-light { ... }` blocks with every `--*` variable. Must-have set (union of both files, styleguide wins on conflicts):
  - Surface: `--surface-1/2/3`
  - Text: `--brand-text/bright/muted/dim`
  - Brand: `--brand-mint`, `--brand-mint-hover`, `--brand-mint-dim`, `--brand-mint-glow`, `--brand-yellow`, `--brand-yellow-dim`
  - Border: `--brand-border`, `--brand-border-hover`
  - Radius: `--radius-sm(4)`, `--radius-md(8)`, `--radius-lg(10)`, `--radius-xl(12)`, `--radius-pill(9999px)`, `--radius-signature(6px 12px 6px 12px)`, `--radius-signature-lg(10px 24px 10px 24px)`
  - Icons: `--icon-sm(14px)`, `--icon-md(18px)`, `--icon-lg(24px)`
  - Zinc: `--zinc-100` through `--zinc-950` (light-mode inverted)
  - Accents: `--teal`, `--blue`, `--emerald`, `--purple`, `--amber`, `--red`, `--orange`, `--cyan`, `--sky`, `--yellow` (light + dark)
  - Chart: `--metric-ring-track`, `--blue-ghost`, `--chart-grid`, `--chart-axis`, `--chart-area-top(.18)`, `--chart-area-bot(0)`, `--chart-stroke-width(1.5)`, `--chart-dot-ring`
  - Z-index: `--z-sticky(10)`, `--z-dropdown(20)`, `--z-tooltip(30)`, `--z-modal-backdrop(40)`, `--z-modal(50)`, `--z-toast(60)`
- [ ] Rewrite `src/index.css` top: `@import './tokens.css';` — remove every `--*` declaration now in tokens.css. Keep everything else (resets, globals, typography classes from Task 0.3, animations).
- [ ] Rewrite `public/styleguide.css` top: `@import url('/tokens.css');` — remove every `--*` declaration. Keep only styleguide-page chrome (`.sg-*`, `.sec-*`, `.manifesto-*`, etc.).
- [ ] Add a Vite plugin or public-folder copy step so `src/tokens.css` is emitted as `public/tokens.css` on build. Simplest: add to `vite.config.ts` a `generateBundle` hook or a pre-build `scripts/copy-tokens.ts` invoked from package.json `prebuild`. Pick whichever pattern this repo already uses — check for existing `public/` asset generators first.
- [ ] Create `scripts/verify-styleguide-parity.ts`: reads `src/tokens.css` and `public/styleguide.css`, asserts `styleguide.css` declares zero `--*` tokens (all must come via `@import`). Exits non-zero on violation. Wire into `scripts/pr-check.ts` as a custom check (warn severity — promoted to error in Phase 3).
- [ ] Verify: `npm run dev` → `/styleguide.html` pixel-identical; `npx vite build && npx vite preview` → `/styleguide.html` pixel-identical. Attach before/after screenshots (dev + prod preview) to PR.

### Task 0.3 — Publish `.t-*` typography utilities globally (Model: sonnet)

**Owns:** `src/index.css` (append `.t-*` class block)

- [ ] Copy the `.t-hero`, `.t-h1`, `.t-h2`, `.t-stat-lg`, `.t-stat`, `.t-stat-sm`, `.t-page`, `.t-body`, `.t-ui`, `.t-label`, `.t-caption`, `.t-mono`, `.t-caption-sm`, `.t-micro` class definitions from `public/styleguide.css` into `src/index.css` under a `/* ─── Typography utilities (canonical) ─── */` section
- [ ] Remove them from `public/styleguide.css` (they now come from the `@import`)
- [ ] Verify `/styleguide.html` still renders every type specimen correctly

### Task 0.4 — Fix scoreColor emerald/green mismatch (Model: haiku)

**Owns:** `src/components/ui/constants.ts`

- [ ] Change `scoreColorClass` to return `text-emerald-400` for `>=80` (was `text-green-400`)
- [ ] Verify `scoreColor` hex constant is `#34d399` (emerald-400) — matches the class now
- [ ] Run `grep -rn 'text-green-400' src/` — if any remain that represent success/score contexts, change to `text-emerald-400`. Keep `text-green-*` only if the author intent was literal green (none found in current audit — all 10 instances are success misuse)
- [ ] `npm run typecheck && npx vitest run`

### Task 0.5 — Remove forbidden hues from UI primitives (Model: sonnet)

**Owns:** `src/components/ui/Badge.tsx`, `src/components/ui/statusConfig.ts`, all files currently using purple in client paths, all files using rose/pink

- [ ] Delete the `purple` key from `Badge.tsx` variant map (line ~15). Update TS union type.
- [ ] In `statusConfig.ts`: change `'in-review'` from purple tokens to blue (`border-blue-500/30`, `bg-blue-500/10`, `text-blue-400`) — "in review" is data-state, not AI
- [ ] Grep `src/components/client/**/*.tsx` for `purple-`, `violet-`. Replace every hit with the appropriate law color (teal=action, blue=data, emerald=success). Log each file in PR description. Expected count: 26 hits across ~8 files.
- [ ] Grep `src/components/` for `rose-`, `pink-`. Replace with red (error) or amber (warning) per context. Expected: 14 hits.
- [ ] Leave purple-in-admin-AI intact (`src/components/admin/AdminChat.tsx`, `src/components/audit/SeoAudit.tsx` "Flag for Client" button) — these are Law 04 compliant
- [ ] `npm run typecheck && npx vitest run && npx vite build`

### Task 0.6 — Verify Phase 0 (Model: sonnet)

- [ ] Visual regression: open every major page in preview (Dashboard, SeoAudit, Performance, Clients, ContentPipeline, ClientDashboard). Zero visual change expected.
- [ ] `npx tsx scripts/pr-check.ts` passes
- [ ] Token parity script (`scripts/verify-styleguide-parity.ts`, created in Task 0.2) passes
- [ ] Run full Phase 0 Acceptance Checklist above — all boxes checked
- [ ] `data/roadmap.json` Phase 5 entries marked; `npx tsx scripts/sort-roadmap.ts`
- [ ] `FEATURE_AUDIT.md` Phase 5 foundation entry created
- [ ] Open PR titled `feat(design-system): phase 5 foundation — canonical token unification + law cleanup` targeting `staging`

### Task 0.7 — Update guardrails docs (Model: sonnet)

**Owns:** `CLAUDE.md` (single section edit), `docs/rules/design-system-enforcement.md` (extend existing table, do NOT create parallel file)

Per CLAUDE.md Session Protocol rule 5, multi-phase features require guardrails docs landed before implementation.

- [ ] **CLAUDE.md** — under "Design System — The Three Laws of Color", add a subsection "Law 03 — Emerald for success" with the existing emerald guidance (currently implicit). Acknowledge Law 04 (Purple) already documented. Reference `public/styleguide.html` as the visual source of truth and `src/tokens.css` as the single token file. Add one line under "Forbidden": "Never redefine a `--*` token outside `src/tokens.css`."
- [ ] **docs/rules/design-system-enforcement.md** — extend the rules table with a "Phase 5 migration window" section listing the 11 new rules (names only — full spec lives in Task 3.1). Mark current status `warn` for each; Phase 3 promotes to `error`. Generalize the "Hardcoded card radius" rule entry to cover all `rounded-*` literals. Reconcile escape-hatch comment conventions: migrate existing `// pr-check-disable-next-line` sites to per-rule hatches (`// <rule-name>-ok`) as a follow-up noted under "Outstanding hatches to migrate".
- [ ] **docs/rules/design-system-enforcement.md** — add a new section "Token authority" citing `src/tokens.css` as the canonical source, `public/tokens.css` as the build-copied mirror, `public/styleguide.css` as @import-only.
- [ ] `npm run rules:generate` (regenerates `docs/rules/automated-rules.md` only after Phase 3 rules land with full customCheck/regex — skip in Phase 0 if the script requires rule implementations; note in PR)

---

## Phase 1 — Primitives + Styleguide Sections

**6 parallel PRs. Each PR: new primitive(s) + styleguide.html section + Storybook-like demo in `/styleguide` + no consumer migration yet. This splits primitive authoring from migration so review is focused.**

### Phase 1 Acceptance Checklist (per PR)

- [ ] Primitive file(s) fully implement the API specified in the task (no placeholder exports from Task 0.0 remain)
- [ ] **Do NOT modify `src/components/ui/index.ts`** — barrel pre-committed in Task 0.0
- [ ] Unit tests added under `src/components/ui/__tests__/<primitive>.test.tsx`: render + className passthrough + ref forwarding + a11y (label required where applicable, keyboard interaction for interactive elements, reduced-motion branching where applicable)
- [ ] Styleguide section added to `public/styleguide.html` with 2+ positive specimens and 1+ do/don't pair
- [ ] Codemod scaffold at `scripts/codemods/phase5-<name>.ts` — dry-run only (`--dry-run` default, `--write` opt-in), emits per-file match report
- [ ] Zero consumer files in `src/components/` outside `src/components/ui/**` modified
- [ ] `npm run typecheck && npx vitest run && npx vite build && npx tsx scripts/pr-check.ts`
- [ ] Preview-verify `/styleguide.html` renders the new section correctly in both dev and prod preview
- [ ] PR targets `staging`

Every Phase 1 PR MUST:
1. Fill the placeholder primitive files created in Task 0.0 (do not create new files in `src/components/ui/` — use the pre-committed paths)
2. Add a styleguide.html section with do/don'ts + visual examples
3. Include unit tests per the Acceptance Checklist above
4. Include a codemod scaffold under `scripts/codemods/phase5-<primitive>.ts` (dry-run only, not applied)
5. NOT modify any consumer component (Phase 2's job)
6. NOT modify `src/components/ui/index.ts` (barrel is frozen from Task 0.0)

### Task 1.1 — Typography primitives (Model: sonnet)

**Owns:**
- CREATE `src/components/ui/typography/Heading.tsx`, `Stat.tsx`, `BodyText.tsx`, `Caption.tsx`, `Label.tsx`, `Mono.tsx`
- CREATE `src/components/ui/typography/index.ts` barrel
- MODIFY `src/components/ui/index.ts` (add re-exports)
- CREATE `src/components/ui/__tests__/typography.test.tsx`
- CREATE `scripts/codemods/phase5-typography.ts`
- MODIFY `public/styleguide.html` (add "Typography primitives" subsection under section 02)

**API:**
```tsx
<Heading level={1|2|3} as?="h1|h2|h3|div">…</Heading>          // .t-h1/t-h2/t-page
<Stat size="hero"|"default"|"sm">{value}</Stat>                // .t-stat-lg/t-stat/t-stat-sm
<BodyText tone?="default"|"muted"|"dim">…</BodyText>           // .t-body
<Caption size?="default"|"sm">…</Caption>                      // .t-caption / .t-caption-sm
<Label>…</Label>                                               // .t-label (uppercase DIN)
<Mono size?="default"|"micro">…</Mono>                         // .t-mono / .t-micro
```

- [ ] Build each primitive as a thin wrapper: render the corresponding `.t-*` class + accept `className` for extension + forward ref
- [ ] `tone` on `BodyText` maps to CSS vars: `default`=`--brand-text`, `muted`=`--brand-text-muted`, `dim`=`--brand-text-dim` (two-tiers-of-muted rule enforced at type level — no `tone="subtle"` option)
- [ ] Unit tests: each primitive renders expected class, accepts className, forwards ref, passes children
- [ ] Codemod: AST-walk `.tsx` files, transform `<span className="text-[11px] uppercase tracking-wide text-zinc-500">X</span>` → `<Label>X</Label>`, `<div className="text-3xl font-bold">{n}</div>` → `<Stat size="hero">{n}</Stat>`, etc. Dry-run reports matches — do not write files.
- [ ] Styleguide section: show each primitive rendered next to its token name, with 3 do/don'ts (e.g. "Don't use `<Heading level={1}>` for stat values — use `<Stat size='hero'>`")

### Task 1.2 — Icon primitive (Model: haiku)

**Owns:**
- CREATE `src/components/ui/Icon.tsx`
- MODIFY `src/components/ui/index.ts`
- CREATE `src/components/ui/__tests__/Icon.test.tsx`
- CREATE `scripts/codemods/phase5-icons.ts`
- MODIFY `public/styleguide.html` (subsection under section 04)

**API:**
```tsx
<Icon as={TrendingUp} size="xs"|"sm"|"md"|"lg"|"xl"|"2xl" className?="…" />
// xs=8, sm=12, md=16, lg=20, xl=24, 2xl=32 — matches audit histogram
```

- [ ] `as` accepts any Lucide component (typed `LucideIcon`)
- [ ] Renders with fixed `w-N h-N` classes; does NOT accept freeform `size={N}` prop — forces the enum
- [ ] Codemod: find `<TrendingUp className="w-3 h-3 text-teal-400" />` → `<Icon as={TrendingUp} size="sm" className="text-teal-400" />`; also handle `<Send size={12} />` → `<Icon as={Send} size="sm" />`
- [ ] Exception list in codemod: do not touch Lucide icons passed as props to other primitives (e.g. `<EmptyState icon={Clock} />`) — they stay as raw components

### Task 1.3 — Button + ActionPill primitives (Model: sonnet)

**Owns:**
- CREATE `src/components/ui/Button.tsx`, `IconButton.tsx`, `ActionPill.tsx`, `SegmentedControl.tsx`
- MODIFY `src/components/ui/index.ts`
- CREATE tests
- CREATE `scripts/codemods/phase5-buttons.ts`
- MODIFY `public/styleguide.html` (subsection under section 05)

**API:**
```tsx
<Button variant="primary"|"secondary"|"ghost"|"danger"|"link"
        size="sm"|"md"|"lg"
        icon?={LucideIcon}
        iconPosition?="left"|"right"
        loading?={boolean}
        disabled?={boolean}
        onClick>…</Button>

<IconButton icon={LucideIcon} size?="sm"|"md"|"lg" variant?="ghost"|"solid" label={string /* a11y required */} />

<ActionPill variant="start"|"approve"|"decline"|"send"|"request-changes" icon?={LucideIcon}>…</ActionPill>

<SegmentedControl options={[{id, label}]} value onChange size?="sm"|"md" />
```

- [ ] `Button` primary = mint gradient (`from-teal-600 to-emerald-600`); secondary = zinc chrome; ghost = transparent; danger = red; link = text-only with underline — match styleguide section 05 button specimens
- [ ] `ActionPill` variants map to the styleguide's workflow pills. Colors encoded in `statusConfig.ts` extension.
- [ ] Codemod: match common button patterns `<button className="px-4 py-2 bg-gradient-to-r from-teal-600 ...">` → `<Button variant="primary">`. Dry-run. Emit a per-file report listing unmatched buttons for manual cleanup.

### Task 1.4 — Form primitives (Model: sonnet)

**Owns:**
- CREATE `src/components/ui/forms/FormField.tsx`, `FormInput.tsx`, `FormSelect.tsx`, `FormTextarea.tsx`, `Checkbox.tsx`, `Toggle.tsx`
- CREATE `src/components/ui/forms/index.ts` barrel
- MODIFY `src/components/ui/index.ts`
- CREATE tests
- CREATE `scripts/codemods/phase5-forms.ts`
- MODIFY `public/styleguide.html` (new subsection: Form validation states)

**API:**
```tsx
<FormField label error?={string} hint?={string} required?={boolean}>
  <FormInput type value onChange placeholder? />
</FormField>

<FormSelect options={[{value,label}]} value onChange />
<FormTextarea value onChange rows? maxLength? />
<Checkbox checked onChange label />
<Toggle checked onChange label />
```

- [ ] `FormField` owns label positioning, error red border + message, required asterisk, hint text below
- [ ] Error state: `border-red-500/50 text-red-400` message underneath — this is the new styleguide "Form validation states" section
- [ ] Focus ring: `--brand-mint-glow` (Law 01 — mint for actions)
- [ ] Checkbox/Toggle: mint-on-checked (Law 01)

### Task 1.5 — Layout primitives (Model: haiku)

**Owns:**
- CREATE `src/components/ui/layout/Row.tsx`, `Stack.tsx`, `Column.tsx`, `Grid.tsx`, `Divider.tsx`
- CREATE `src/components/ui/layout/index.ts`
- MODIFY `src/components/ui/index.ts`
- CREATE tests
- CREATE `scripts/codemods/phase5-layout.ts`
- MODIFY `public/styleguide.html` (new subsection under 04: Layout primitives)

**API:**
```tsx
<Row gap="xs"|"sm"|"md"|"lg" align? justify? wrap? className?>…</Row>
<Stack gap="xs"|"sm"|"md"|"lg"|"xl" dir?="col"|"row" align? className?>…</Stack>
<Column gap? className?>…</Column>  // alias: Stack dir="col"
<Grid cols={{sm?:N, md?:N, lg?:N, xl?:N}} gap? className?>…</Grid>
<Divider orientation?="horizontal"|"vertical" className?="my-4" />
```

- [ ] `gap` maps to Tailwind scale: xs=1, sm=2, md=3, lg=4, xl=6 (matches audit histogram)
- [ ] No arbitrary gap values accepted — enum only
- [ ] `Divider` renders `border-b border-[var(--brand-border)]` or `border-r` for vertical
- [ ] Codemod: find `<div className="flex items-center gap-2">` → `<Row gap="sm">`, `<div className="flex flex-col gap-3">` → `<Stack gap="md">`, etc. Emit report — do not apply.

### Task 1.6 — Overlay primitives (Model: opus)

**Owns:**
- CREATE `src/components/ui/overlay/Modal.tsx`, `Popover.tsx`, `Tooltip.tsx`
- CREATE `src/components/ui/overlay/index.ts`
- MODIFY `src/components/ui/index.ts`
- CREATE tests (including focus-trap behavior, escape key, outside click)
- CREATE `scripts/codemods/phase5-overlays.ts`
- MODIFY `public/styleguide.html` (new subsection: Overlays & modals)

**API:**
```tsx
<Modal open onClose size?="sm"|"md"|"lg"|"xl">
  <Modal.Header title onClose />
  <Modal.Body>…</Modal.Body>
  <Modal.Footer>…</Modal.Footer>
</Modal>

<Popover trigger={<button>Menu</button>} placement?="bottom-start"|"bottom-end"|"top-start"|... closeOnSelect?>
  <Popover.Item onClick>Action</Popover.Item>
  <Popover.Separator />
  <Popover.Item onClick danger>Delete</Popover.Item>
</Popover>

<Tooltip content={string | ReactNode} placement? delay?>
  {trigger}
</Tooltip>
```

- [ ] `Modal`: fixed inset-0 overlay using `z-[var(--z-modal)]` (add to index.css: `--z-sticky:10, --z-dropdown:20, --z-tooltip:30, --z-modal-backdrop:40, --z-modal:50, --z-toast:60`), backdrop blur, centered content with scale-in motion per styleguide §07, escape-to-close, focus trap, body scroll lock
- [ ] `Popover`: absolute-positioned; uses a lightweight positioning helper (no new dependency — small inline getBoundingClientRect calc), closes on outside click + escape, keyboard arrow nav
- [ ] `Tooltip`: hover-triggered, 300ms default delay, dismisses on blur, supports `placement` with simple collision avoidance
- [ ] All three respect `prefers-reduced-motion`
- [ ] Codemod: identify `fixed inset-0` blocks and emit a migration worksheet for each (not auto-transformed — each modal has custom content that requires manual review)

---

## Phase 2 — Codemod Execution by Page Domain

**5 PRs. Each PR runs relevant codemods over its domain slice, applies them, manually cleans the residue, verifies visually. Parallel-safe — each PR owns a disjoint file set.**

### Phase 2 Acceptance Checklist (per PR)

- [ ] All 6 Phase 1 codemods executed over the domain in `--write` mode; results committed as a distinct first commit in the PR ("chore: apply codemods to <domain>") so manual work is a separable second commit
- [ ] Post-codemod manual sweep completes all residual fixes (raw `text-zinc-*` / `bg-zinc-*` / `border-zinc-*` / `rounded-lg` / `text-[Npx]` / inline `borderRadius:` within domain)
- [ ] Hand-rolled modals migrated to `<Modal>`; hand-rolled dropdowns to `<Popover>`; hand-rolled trend icons to `<TrendBadge>`
- [ ] Preview-verify every touched page: capture pre-edit screenshot before starting, post-edit screenshot at end, attach both to PR
- [ ] **Playwright mandatory**: `npx playwright test tests/e2e/admin-flow.spec.ts tests/e2e/client-flow.spec.ts` (or domain-specific spec if it exists) — must pass. If a spec fails, investigate before claiming the PR ready.
- [ ] Domain grep audit — from PR description, paste output of these commands scoped to the domain's files:
  ```
  grep -rn 'text-\[' <domain paths>
  grep -rn 'text-zinc-' <domain paths>
  grep -rn 'bg-zinc-' <domain paths>
  grep -rn 'border-zinc-' <domain paths>
  grep -rn 'rounded-lg' <domain paths>
  grep -rn "borderRadius:" <domain paths>
  ```
  Every command must return zero hits.
- [ ] `npm run typecheck && npx vitest run && npx vite build && npx tsx scripts/pr-check.ts`
- [ ] `data/roadmap.json` domain entry marked done + sorted; `FEATURE_AUDIT.md` updated
- [ ] PR targets `staging`

**Effort estimate per Phase 2 PR:** 2–3 working days. Codemods cover ~70% of the raw-zinc migrations; the remaining ~30% is judgment calls (which zinc maps to primary/muted/dim text? which card keeps asymmetric radius?). For the five domains totaling ~5,000 raw-zinc callsites, plan ~1,500 manual touches distributed unevenly — admin analytics (2.1) is the heaviest.

Every Phase 2 PR MUST:
1. Run every Phase 1 codemod over its domain's files in apply mode
2. Manually clean up the tail
3. Remove all raw `text-zinc-*`, `bg-zinc-*`, `border-zinc-*`, `rounded-lg`, `text-[Npx]`, inline asymmetric `borderRadius` within its domain
4. Verify each touched page in preview (screenshot + visual diff)
5. NOT touch `src/components/ui/` (primitives frozen after Phase 1)
6. NOT touch files outside its domain

### Task 2.1 — Admin analytics pages (Model: sonnet)

**Owns files under:** `src/components/Performance.tsx`, `src/components/PageIntelligence.tsx`, `src/components/Rankings.tsx`, `src/components/Competitors.tsx`, `src/components/Dashboard.tsx`, `src/components/search-console/**`, `src/components/analytics/**`, `src/components/insights/**`, `src/components/rankings/**`, `src/components/competitors/**`

- [ ] Run all 6 codemods over domain in apply mode (`--write`)
- [ ] Manual pass: remove residual raw `text-zinc-*` / `bg-zinc-*` / `border-zinc-*` / `rounded-lg` / arbitrary `text-[Npx]`
- [ ] Replace every `borderRadius: '...'` inline style. **The asymmetric brand signature is the SectionCard primitive's canonical chrome** — prefer wrapping in `<SectionCard>` when structurally compatible. Non-SectionCard containers (collapsible panels, sticky tables, hand-rolled chrome with intentional brand asymmetric corners) MAY use `rounded-[var(--radius-signature-lg)]` directly — they must declare intent with `// pr-check-disable-next-line -- <reason>` per site. Cards without specific brand intent (interior surfaces, sub-cards) use `rounded-[var(--radius-lg)]`. Row-level asymmetric `--radius-signature` (the `6px 12px 6px 12px` variant) remains permitted unconditionally for sub-card row elements that adopt the StatCard-style accent.
- [ ] Migrate hand-rolled trend icons to `<TrendBadge>` (expect ~15–20 in this domain)
- [ ] Migrate hand-rolled modals/dropdowns in this domain to `<Modal>`/`<Popover>`
- [ ] Preview-verify each page: open preview, compare to pre-edit screenshot, capture new screenshot for PR
- [ ] `npm run typecheck && npx vitest run && npx tsx scripts/pr-check.ts`

### Task 2.2 — Admin content pages (Model: sonnet)

**Owns:** `src/components/SeoEditor.tsx`, `src/components/CmsEditor.tsx`, `src/components/BriefDetail.tsx`, `src/components/ContentPipeline.tsx`, `src/components/content/**`, `src/components/briefs/**`, `src/components/editor/**`, `src/components/audit/**`

Same checklist as Task 2.1, scoped to these files.

### Task 2.3 — Admin operations pages (Model: sonnet)

**Owns:** `src/components/Approvals.tsx`, `src/components/Requests.tsx`, `src/components/Clients.tsx`, `src/components/Audit.tsx` (panel), `src/components/Matrix.tsx`, `src/components/matrix/**`, `src/components/admin/**` (non-AI), `src/components/approvals/**`, `src/components/requests/**`, `src/components/clients/**`

Same checklist. Note: purple in `AdminChat.tsx` stays (Law 04).

### Task 2.4 — Client-facing pages (Model: sonnet)

**Owns:** `src/components/client/**`, `src/components/ClientDashboard.tsx`, `src/components/ClientLayout.tsx`

Same checklist. Extra constraint: **zero purple, zero rose, zero pink** in this domain. Verify with a final grep at end of task.

### Task 2.5 — Brand, schema, revenue, remaining (Model: sonnet)

**Owns:** `src/components/brand/**`, `src/components/schema/**`, `src/components/RevenueDashboard.tsx`, `src/components/revenue/**`, `src/components/workspace/**`, `src/components/onboarding/**`, `src/components/settings/**`, `src/components/auth/**`, any file in `src/components/` not already claimed

Same checklist. This task absorbs everything not claimed by 2.1–2.4.

After Task 2.5: a full-platform grep for `text-[Npx]`, raw `text-zinc-*`, raw `bg-zinc-*`, `rounded-lg`, inline `borderRadius:` must return **only** files in `src/components/ui/` itself (if any) and auto-generated/untouchable files. Anything else is a miss — fix before Phase 3.

---

## Phase 3 — pr-check Enforcement

**1 PR. Lock the system shut.** Follows `docs/rules/pr-check-rule-authoring.md`.

### Phase 3 Acceptance Checklist

- [ ] All 12 rules below added to `scripts/pr-check.ts` with name, message, rationale, `claudeMdRef` anchor, severity, and hatch pattern
- [ ] Each rule has a unit test in `scripts/__tests__/pr-check.test.ts` covering positive + negative + hatched cases
- [ ] `npx tsx scripts/pr-check.ts` returns zero violations on main HEAD after Phase 2 is complete (ship-at-error precondition)
- [ ] `npm run rules:generate` executed; `docs/rules/automated-rules.md` regenerated and committed
- [ ] `docs/rules/design-system-enforcement.md` — "Phase 5 migration window" section updated to "Phase 5 locked" with all rules marked error; pre-existing warn-only rules (Hand-rolled card div, Hardcoded card radius, Legacy surface token, Non-standard transition duration) promoted to error in same pass
- [ ] CLAUDE.md "Code Conventions" pointer updated to reference the 12 new rules
- [ ] PR targets `staging`

### Severity progression policy

Per `docs/rules/pr-check-rule-authoring.md`, new rules with existing backlog ship `warn` first and promote to `error` only after zero hits. This plan shortcuts that protocol by making Phase 2 complete the backlog before Phase 3 opens — at Phase 3 dispatch time, every rule must return zero hits on main, so they can ship directly at `error`. If any rule has residual hits at Phase 3 start, ship that rule at `warn` and open a follow-up cleanup PR before promoting.

### Task 3.1 — Add pr-check rules (Model: sonnet)

**Owns:** `scripts/pr-check.ts`, `scripts/__tests__/pr-check.test.ts`, `docs/rules/automated-rules.md`, `docs/rules/design-system-enforcement.md`, `CLAUDE.md` (Code Conventions pointer)

Each rule below MUST include: `name`, `severity`, `pattern` (regex) OR `customCheck`, `message`, `rationale`, `claudeMdRef`, `hatch` (inline pattern for regex rules, above-line for customCheck rules per `pr-check-rule-authoring.md`), `test cases` (positive + negative + hatched).

**Regex-based rules (inline hatch: `// <rule-name>-ok`):**

| # | name | pattern | exclude | severity | message |
|---|---|---|---|---|---|
| 1 | `no-arbitrary-text-size` | `text-\[\d+(\.\d+)?px\]` | `src/components/ui/**`, `public/styleguide.*` | error | Use a `.t-*` class or a `<Heading>/<BodyText>/<Caption>/<Label>/<Stat>` primitive. |
| 2 | `no-raw-text-zinc` | `text-zinc-\d+` | `src/components/ui/**`, `public/styleguide.*` | error | Use `var(--brand-text / --brand-text-bright / --brand-text-muted / --brand-text-dim)`. |
| 3 | `no-raw-bg-zinc` | `bg-zinc-\d+` | `src/components/ui/**`, `public/styleguide.*` | error | Use `var(--surface-1 / --surface-2 / --surface-3)`. |
| 4 | `no-raw-border-zinc` | `border-zinc-\d+` | `src/components/ui/**`, `public/styleguide.*` | error | Use `var(--brand-border)` or `var(--brand-border-hover)`. |
| 5 | `no-rounded-literal` | `rounded-(sm\|md\|lg\|xl\|2xl\|3xl\|full)` | `src/components/ui/**`, `public/styleguide.*` | error | Use `rounded-[var(--radius-sm/md/lg/xl/pill)]` or `rounded-[var(--radius-signature*)]` for asymmetric card signatures. |
| 6 | `no-inline-asymmetric-radius` | `borderRadius:\s*['"]\d+px\s+\d+px` | `src/components/ui/**`, `public/styleguide.*` | error | Wrap in `<SectionCard>` when structurally compatible. Otherwise use `className="rounded-[var(--radius-lg)]"` for interior surfaces, or `rounded-[var(--radius-signature-lg)]` with `// pr-check-disable-next-line -- <reason>` for non-SectionCard containers that legitimately want the brand asymmetric corner. The smaller `--radius-signature` is permitted at the row level without justification. |
| 7 | `no-purple-in-client` | `(purple\|violet)-\d+` | N/A | error | Purple is admin-AI only (Law 04). Use teal (action), blue (data), or emerald (success). Scope: `src/components/client/**`. |
| 8 | `no-rose-pink` | `(rose\|pink)-\d+` | `public/styleguide.*` | error | Not in styleguide palette. Use red (error) or amber (warning). Scope: `src/components/**`. |
| 9 | `no-trend-icon-outside-trendbadge` | `import.*\b(TrendingUp\|TrendingDown\|ArrowUp\|ArrowDown)\b.*from\s+['"]lucide-react['"]` | `src/components/ui/TrendBadge.tsx`, `src/components/ui/__tests__/**` | error | Use `<TrendBadge value={n} />` — it encodes direction, color, and sign automatically. |
| 10 | `no-fixed-inset-outside-overlay` | `fixed\s+inset-0` | `src/components/ui/overlay/**` | error | Use `<Modal>` or `<Popover>` from `src/components/ui/overlay/`. |
| 11 | `no-handrolled-cta-button` | `<button[^>]*className="[^"]*bg-gradient-to-r[^"]*from-teal` | `src/components/ui/Button.tsx` | error | Use `<Button variant="primary">`. |

**customCheck rules (above-line hatch: `// <rule-name>-ok: <reason>`):**

| # | name | check | severity | message |
|---|---|---|---|---|
| 12 | `styleguide-token-parity` | Parse `src/tokens.css` and `public/styleguide.css`; assert `styleguide.css` contains zero `--*` declarations. | error | `public/styleguide.css` must only `@import url('/tokens.css')`; redeclaring tokens creates drift. |
| 13 | `score-color-law-parity` | Parse `src/components/ui/constants.ts`; assert `scoreColorClass` return values map to the same Tailwind family as `scoreColor` hex values (both emerald / amber / red — no green). | error | Score color drift: `scoreColorClass` and `scoreColor` must reference the same color family per Law 03 (emerald for success). |

(That's 13 rules total — 11 regex + 2 customCheck. The plan's original "12" undercounted by merging rules 2–4; breaking them apart gives better error messages.)

- [ ] Implement each rule in `scripts/pr-check.ts` with the full schema above
- [ ] Unit tests in `scripts/__tests__/pr-check.test.ts`: for each rule, a file content that triggers it, a file content that does not, and a file content with the hatch applied (must not trigger). Include regression cases for hatch patterns (inline vs above-line per guide)
- [ ] Update `docs/rules/design-system-enforcement.md` — move from "Phase 5 migration window" section to "Phase 5 locked" section. Also promote the 4 existing warn rules (Hand-rolled card div, Hardcoded card radius, Legacy surface token, Non-standard transition duration) to `error` — the Phase 2 migrations should have eliminated their backlogs. Regenerate `docs/rules/automated-rules.md` via `npm run rules:generate`.
- [ ] Verify: `npx tsx scripts/pr-check.ts` returns zero violations against current main (after Phase 2 merges). If any rule fires, ship that rule at `warn` and open a follow-up. Record any such deferrals in the PR description.
- [ ] CLAUDE.md — under "Code Conventions", append: `- **Design system enforcement**: 13 mechanized rules lock the token pipeline. See [docs/rules/design-system-enforcement.md](./docs/rules/design-system-enforcement.md).`

---

## Cross-Phase Contracts

### Tokens exported by Phase 0 (consumed by all later phases)

See `src/index.css` `:root` block after Task 0.2 lands. Every primitive in Phase 1 imports nothing new — it uses CSS variables directly.

### Primitive exports added by Phase 1 (consumed by Phase 2)

From `src/components/ui/index.ts` after all Phase 1 PRs merge:
- Typography: `Heading`, `Stat`, `BodyText`, `Caption`, `Label`, `Mono`
- Icon: `Icon`
- Actions: `Button`, `IconButton`, `ActionPill`, `SegmentedControl`
- Forms: `FormField`, `FormInput`, `FormSelect`, `FormTextarea`, `Checkbox`, `Toggle`
- Layout: `Row`, `Stack`, `Column`, `Grid`, `Divider`
- Overlay: `Modal`, `Popover`, `Tooltip`

Existing primitives (do not modify in Phase 5): `SectionCard`, `StatCard`, `CompactStatBar`, `TrendBadge`, `ChartCard`, `Badge`, `StatusBadge`, `TierBadge`, `PageHeader`, `TabBar`, `DateRangeSelector`, `DataList`, `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton`, `MetricRing`, `TierGate`, `ConfirmDialog`, `WorkflowStepper`, `FeatureFlag`, `OnboardingChecklist`, `WorkspaceHealthBar`, `NextStepsCard`, `AIContextIndicator`, `MetricToggleCard`, `CharacterCounter`

### Styleguide contract

After every Phase 1 PR merges, `/styleguide.html` shows the new primitive in its intended section. After Phase 2.5, every primitive listed above is demonstrated in the styleguide. After Phase 3, `pr-check` fails if a primitive exists in `src/components/ui/` without a corresponding styleguide section.

---

## Parallel Dispatch Rules (per multi-agent-coordination.md)

- **Phase 0**: single PR, single agent, sequential tasks inside it
- **Phase 1**: after Phase 0 merges, dispatch Tasks 1.1–1.6 in parallel. Each owns disjoint files. The only shared file is `src/components/ui/index.ts` — handled sequentially: Task 1.1 adds typography barrel, others rebase & add their entries. Recommend: one integrator agent rebases each PR onto main after typography lands.
- **Phase 2**: after all Phase 1 PRs merge, dispatch Tasks 2.1–2.5 in parallel. Each owns disjoint file domains (verify via grep before dispatch: `grep -l '<domain pattern>' <other domain paths>` should return empty). Shared files (none expected) are surfaced at dispatch review.
- **Phase 3**: single PR after Phase 2 green.

Diff review checkpoint after each parallel batch:
- `git log --oneline origin/main..HEAD` — expected commit count matches task count
- `git diff origin/main..HEAD --stat` — confirm ownership: each parallel agent's file list disjoint
- `npm run typecheck && npx vitest run && npx tsx scripts/pr-check.ts`

---

## Systemic Improvements

**Shared utilities created:**
- `scripts/codemods/phase5-*.ts` — 6 codemods (typography, icons, buttons, forms, layout, overlays)
- `scripts/verify-styleguide-parity.ts` — enforces styleguide.css ⊂ index.css
- Layout + overlay + form primitives (listed above)

**pr-check rules added:** 11 (Phase 3)

**Test coverage added:**
- Unit tests for every Phase 1 primitive (~24 new test files)
- Contract test: styleguide token parity
- Contract test: every exported primitive has a styleguide section

**Docs updates:**
- `BRAND_DESIGN_LANGUAGE.md` — append "Phase 5 — primitive-only policy" section after Phase 2
- `FEATURE_AUDIT.md` — entry per phase
- `DESIGN_SYSTEM.md` — append primitive catalog

---

## Verification Strategy

### Per-PR verification

| Phase | Command | Visual check |
|---|---|---|
| 0 | `npm run typecheck && npx vite build && npx tsx scripts/pr-check.ts` | `/styleguide.html` identical to pre-edit screenshot |
| 1 (each) | Same + `npx vitest run src/components/ui/__tests__/<primitive>.test.tsx` | `/styleguide.html` renders new section |
| 2 (each) | Same + `npx playwright test` (if e2e exists for domain) | Screenshot every touched page pre/post |
| 3 | `npx tsx scripts/pr-check.ts` (11 new rules) | N/A |

### Final platform verification (after Phase 3)

- [ ] `grep -rn 'text-\[' src/components/ | grep -v 'components/ui/'` → 0 hits
- [ ] `grep -rn 'text-zinc-' src/components/ | grep -v 'components/ui/'` → 0 hits
- [ ] `grep -rn 'bg-zinc-' src/components/ | grep -v 'components/ui/'` → 0 hits
- [ ] `grep -rn 'rounded-lg' src/components/ | grep -v 'components/ui/'` → 0 hits
- [ ] `grep -rn "borderRadius:" src/components/ | grep -v 'components/ui/'` → 0 hits (inline styles)
- [ ] `grep -rn 'purple\|violet' src/components/client/` → 0 hits
- [ ] `grep -rn 'rose-\|pink-' src/components/` → 0 hits
- [ ] `grep -rn 'TrendingUp\|TrendingDown' src/ | grep -v 'components/ui/TrendBadge\|components/ui/__tests__'` → 0 hits
- [ ] Every primitive in `src/components/ui/index.ts` exports has a section in `public/styleguide.html`
- [ ] `public/styleguide.css` declares zero `--*` tokens (imports only from `/src/index.css`)

---

## Rollback

If a Phase 2 PR breaks visual consistency on a page, revert that single PR. Primitives are independent of consumers — reverting a migration does not revert a primitive. Phase 3 rules only become errors after Phase 2 completes; if a critical bug ships alongside Phase 3, ship the affected rule at `warn` and open a follow-up cleanup PR (see Phase 3 severity progression policy).

---

## Deferred (Phase 6+ candidates)

- Light-mode rollout (tokens support it, but no consumer pages run in light mode yet)
- Mobile-first responsive audit (noted in audit output — many pages desktop-only)
- Chart primitive refactor (already done in Phase 4 via ChartCard)
- Dark/light theme toggle UI (separate initiative)
- Adding new Lucide icons to the sprite (on-demand only)
- Migrating existing `// pr-check-disable-next-line` sites to per-rule hatches (`// <rule-name>-ok`) — tracked in `docs/rules/design-system-enforcement.md`

---

## Success Criteria

1. `src/tokens.css` is the single token file. `public/styleguide.css` and `src/index.css` both `@import` from it and declare zero `--*` duplicates. `public/tokens.css` exists as a build-copied mirror for prod `/tokens.css` URL.
2. Every UI element in `src/components/` renders via a primitive from `src/components/ui/` OR reads from a `.t-*` class / `var(--*)` token. Zero hand-rolled elements.
3. `public/styleguide.html` demonstrates every exported primitive.
4. `pr-check` ERRORS on new arbitrary sizes, raw zinc colors, literal `rounded-*`, forbidden hues, hand-rolled modals/buttons, trend icons outside TrendBadge, score color drift, and styleguide drift (13 rules total).
5. Final grep sweep (see "Final platform verification") returns 0 hits across all 8 checks.

When all 5 land, Phase 5 is done. The platform is unified. No gaps, no one-offs, one source of truth.
