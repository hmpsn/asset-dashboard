# Design Cleanup — Working Agreement (read first)

**For:** any engineer or agent picking up an item from `design-cleanup-sprint.json`.
**Companion docs:** `design-cleanup-sprint-brief.html` (human overview + wave order), `ux-findings-index.html` (finding ↔ item map), and the six `ux-review-*.html` artifacts (the *why* behind each item, with before/after sketches).

Every JSON item now carries `files`, `dependsOn`, `acceptanceCriteria`, and `verify`. Read the item, read its review artifact, then read this agreement before writing code.

---

## 1. Non-negotiable guardrails (this repo will reject violations)

These are existing `asset-dashboard` conventions. Breaking them fails `pr-check` or `report-style-drift`.

- **Token source-of-truth.** Every `--*` custom property lives in **`src/tokens.css`** only (mirrored to `public/tokens.css`). Never declare or redefine a token in a component, `index.css`, or `styleguide.css`. If a fix needs a new token, add it to `tokens.css` and reference it. See CLAUDE.md → "Design System — Token source of truth".
- **No freehand Tailwind hue values.** Use the semantic accent utilities (`text-accent-brand|info|success|warning|danger`, `bg-accent-*-soft`, `border-accent-*-soft`) or `var(--token)`. Raw `text-amber-400`, `bg-red-500/8`, `#22d3ee`, etc. are drift — that's literally what several items fix. The only sanctioned raw-zinc usages carry a `// raw-zinc-ok` marker; don't add new ones.
- **The four laws of color** (the spine of every color item): **mint = action**, **blue = data**, **emerald = success**, **purple = admin-AI-only (never client-facing)**, with amber = warning, red = danger, orange = changes-requested, cyan = send. If you're coloring something, it must be by *meaning*, not decoration.
- **Two muted text tiers, never three:** body (`--zinc-400`) and dim (`--zinc-500`). Don't invent a third.
- **Signature radius is reserved.** `--radius-signature` / `--radius-signature-lg` (the asymmetric corners) belong **only** to StatCard and SectionCard. Everything else uses `--radius-lg` etc.
- **Flag discipline — byte-identical OFF.** `the-issue-client-spine`, `client-ia-v2`, `strategy-the-issue`, `the-issue-client-measured-capture` etc. gate new layouts. When a flag is OFF the render must be **byte-identical to today**. Several screens have an explicit flag-OFF branch marked "do NOT refactor" — leave it alone; only touch the flag-ON path unless an item explicitly says otherwise.
- **One PR per item (or per phase), staging-first.** Matches the repo's existing roadmap convention. Keep diffs reviewable; don't bundle unrelated items.
- **Respect existing escape-hatch markers** (`pr-check-disable-next-line`, `raw-zinc-ok`, `duplicate-heading-ok`, `trend-icon-ok`) — they encode prior decisions. Don't strip them without cause.

## 2. Verification protocol (per item)

Before marking an item done, run/confirm:

1. **`pr-check`** passes (the repo's gate). 
2. **`report-style-drift`** shows no new violations vs `data/style-drift-baseline.json` (color items should *reduce* the count).
3. **Visual states** — eyeball the touched surface in **dark AND light** theme, **empty AND populated** data, and **flag ON AND OFF** where a flag gates it. Many findings only reproduce in one state.
4. **Tests** — update/extend the relevant vitest specs; respect the coverage ratchet (`report-coverage-ratchet`). UI-only reorders rarely need new logic tests, but component-API changes (Wave 0 primitives) do.
5. **No new console errors**; keyboard focus order and the 44px hit-target minimum preserved on anything interactive.

## 3. How to read an item

```
id                 stable handle; the PR title prefix
title              one-line what
files              the file(s) to edit (verify line numbers — code drifts)
dependsOn          item ids that must land first (empty = pick up anytime)
acceptanceCriteria the testable "done" checklist
verify             states/scripts to check for THIS item
notes              the full fix rationale (mirrors the review artifact)
source             screen-scoped finding id (e.g. CC-F1) → ux-review-*.html
est / priority     S/M/L · P1/P2/P3
owner              ui-platform (screen work) or design-system (shared)
```

---

## 4. Wave 0 — new-primitive API specs

Five shared components/patterns. Build these **before** the screen waves that consume them. All live in **`src/components/ui/`** (the existing primitives home), follow the four laws, reference tokens only, and ship with a `.test.tsx`. Mirror the prop/style conventions of the existing `ui/` components (look at `Button.tsx`, `Badge.tsx`, `SectionCard.tsx` for house style).

### 4.1 `NeedsAttention` / `AttentionRow`  → retires CC-F3, WH-F5, enables WH-F6
- **Where:** `src/components/ui/NeedsAttention.tsx` (or `components/flow/` if you prefer the grouping used in this design-system repo).
- **Shape:**
  ```ts
  type AttentionSeverity = 'critical' | 'warning' | 'info'; // → red / amber / mint-or-blue
  interface AttentionItem {
    id: string; label: string; sub?: string; severity: AttentionSeverity;
    icon?: LucideIcon; href?: string; onClick?: () => void;
    meta?: string;        // right-aligned context (e.g. workspace name)
    badge?: string;       // optional Badge value
  }
  interface NeedsAttentionProps {
    items: AttentionItem[]; title?: string;  // default "Needs Attention"
    cap?: number;         // collapse beyond N with "show more"
    showCount?: boolean;  // append "· N" to the title
  }
  ```
- **Rules:** one severity→color map (critical=`--red`, warning=`--amber`, info=`--blue`/`--teal`); always-visible trailing chevron; rows are `ClickableRow`; P1-present → subtle red/amber left-accent on the container. Replaces the two divergent inline implementations in `WorkspaceOverview.tsx` and `WorkspaceHome.tsx`.

### 4.2 `Disclosure`  → retires AC-F2, ISSUE "Under the hood"
- **Where:** `src/components/ui/Disclosure.tsx`.
- **Shape:** `{ summary: ReactNode; badges?: BadgeProps[]; defaultOpen?: boolean; children }` — wraps a styled `<details>`/`<summary>` with the canonical chrome (t-label summary, chevron that rotates on open, `--radius-lg` container, focus ring). Support **nesting / grouping** so a former 8-surface drawer becomes 2–3 labeled `Disclosure`s.
- **Rules:** keyboard-operable; `prefers-reduced-motion` respected on the chevron; no `--radius-signature` (it's not a spotlight card).

### 4.3 `Menu` / `Dropdown`  → retires CP-F5
- **Where:** `src/components/ui/Menu.tsx`.
- **Shape:** `{ trigger: ReactNode; items: MenuItem[]; align?: 'start'|'end' }` where `MenuItem = { label; onSelect; icon?; trailing? }` (trailing supports the pipeline's CSV/JSON dual-action rows).
- **Rules:** click-outside + Escape to dismiss; positioned panel at `--z-dropdown`; arrow-key navigation; the panel uses `--surface-2` + `--brand-border` + `--radius-lg`. This is the **only net-new component**; everything else is consolidation.

### 4.4 Card `tone` prop  → retires ISSUE-F5
- **Where:** extend `src/components/ui/StatCard.tsx` (and the base card if one is factored out).
- **Shape:** add `tone?: 'neutral' | 'teal' | 'emerald' | 'blue' | 'amber'` → applies a canonical `linear-gradient(...) + matching border` at **one** opacity (define the values once, e.g. gradient `from <accent>/8`, border `<accent>/20`). Replaces the hand-rolled `className="bg-gradient-to-br from-emerald-500/10 …"` on the verdict shell and outcome band.

### 4.5 Section-header treatment  → retires ISSUE-F4
- **Where:** either a tiny `src/components/ui/SectionLabel.tsx` or a documented usage rule.
- **Shape:** the `t-label` uppercase kicker (`<SectionLabel>What's working</SectionLabel>`). **Convention:** top-level page sections use `SectionLabel`; `SectionCard` headers are reserved for cards *within* a section; a `<summary>` is only for a `Disclosure`. One header weight per role.

---

## 5. The color/token sweep (Wave 0b) — one workstream

Items `design-color-law-sweep-mint-on-data`, `design-wh-purple-on-data`, `design-cp-healthbar-color`, `design-ac-staleness-tokens`, `design-cd-trial-banner-tokens` are **one body of work**: enforce the four laws and route every warning/alert surface through tokens or `InlineBanner`. Do the repo-wide grep first (it finds most instances), then the per-screen items become spot-fixes + a regression check against `style-drift-baseline.json`. Land `InlineBanner` token variants once; reuse for the cockpit staleness nudge and both client trial banners.

---

## 6. Definition of done (whole sprint)

- All 30 JSON items at `status: done`; `report-style-drift` count down, not up.
- The five Wave-0 primitives exist in `ui/`, are documented, and the screens that had hand-rolled versions now import them (no duplicate implementations remain).
- No flag-OFF branch changed its byte output.
- Light + dark + empty + populated verified on every touched screen.
