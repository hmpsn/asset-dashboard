# Design Review — Visual Design & Accessibility Soundness

**Reviewer scope:** hierarchy/density, typography (DIN Pro/Inter, tabular numerals), the four color laws, dark+light theme viability, contrast/hit targets/focus states vs. the Handoff Brief's a11y floors, data-viz quality, responsive posture.

**What I actually examined (all paths relative to `hmpsn studio Design System/`):** `styles.css`, all of `tokens/` (colors, typography, spacing, layout, effects, base, fonts), `guidelines/type-scale.css`, `readme.md`, `CLAUDE.md`, the Handoff Brief (extracted text), `Reference Screen - Keywords.html` (full), mockup views `cockpit.js`, `performance.js`, `portal.js` (full) plus greps across all 40 mockup views, and components: Button, IconButton, DataTable, StatCard, MetricTile-adjacent greps, MetricRing, Sparkline, Meter, Badge, IntentTag, StatusBadge, TrendBadge, Toggle, Checkbox, Toast, Skeleton, EmptyState, NavItem, Drawer, Modal, Popover, Tooltip, AppShell, Grid. I also parsed the shipped `assets/fonts/D-DIN-PRO-*.otf` binaries directly (sfnt table directory + cmap/hmtx) and computed WCAG contrast ratios from the token hex values.

**Certainty limits:** I could not render anything. Contrast figures are computed from token values (exact). Font-feature findings are parsed from the OTF binaries (exact). Anything about "how it feels at 1440px" is inference from code and is labeled as such.

---

## Verdict in one paragraph

The token architecture, theming discipline, and density posture are genuinely strong — this is an operator-grade, data-first design system, not a whitespace-over-utility rebrand, and the light theme is engineered (darkened accents, inverted zinc scale), not an afterthought. But the kit currently fails three of its own laws in load-bearing places: **the shipped DIN font cannot produce the tabular numerals the brief mandates** (the font has no `tnum` feature and proportional digits — verified in the binary), **purple leaks into the client portal and into core semantic components** (IntentTag, Badge) despite "purple = admin-AI only, never client-facing" being the one law the brief calls sacred, and **the flagship interaction pattern (table row → drawer) is keyboard-inaccessible** in the very components every surface will assemble from. All three are fixable at the system level before fan-out — which is exactly why they must be fixed before fan-out, because after 18 surfaces are assembled they become 18 fixes.

---

## What is GOOD and worth protecting

### P1 — The light theme is engineered, not bolted on *(praise)*
`tokens/colors.css` doesn't just swap surfaces; it darkens every accent for contrast on white (`--amber: #b45309` → 5.02:1, `--blue: #2563eb` → 5.17:1, `--emerald: #047857` → 5.48:1, all computed on `#ffffff`) and inverts the entire zinc scale so `--zinc-400`-consuming components get readable `#475569` in light mode automatically. The rule "a new token goes in both `:root` and `.dashboard-light`" (CLAUDE.md, Handoff Brief house rule 3) is the right structural guarantee. Most dark-first systems ship a light theme that fails contrast everywhere; this one mostly doesn't (exceptions in M3).

### P2 — Global keyboard-only focus ring, reduced-motion kill switch *(praise)*
`tokens/base.css:30` ships a `:focus-visible` mint outline with `outline-offset: 2px` and `border-radius: inherit` across every focusable element, and lines 52–58 globally collapse animation/transition durations under `prefers-reduced-motion`. Because components are inline-styled, this single global rule is what makes their focus states work at all — protect it; any consumer that resets `outline` reopens the hole.

### P3 — Real button semantics in the form controls *(praise)*
`Toggle.jsx` is a native `<button role="switch" aria-checked>` with a **documented 44px hit target** (`minHeight: 44` on the label). `Checkbox.jsx` is a native button with `aria-checked="mixed"` indeterminate support. Native buttons mean Space/Enter work for free. This is the correct pattern and the standard the rest of the kit should be held to.

### P4 — Trend encoding is not color-only *(praise)*
`TrendBadge.jsx` encodes direction three ways: signed number (`+`/`−`), rotated arrow glyph, and emerald/red color, with `invert` for metrics where down is good and a neutral zero state. This is colorblind-safe by construction. The cockpit mockup's `.ck-kmove` repeats the same triple encoding. Keep this as the mandated pattern for every delta in the product.

### P5 — Density posture is right for an operator tool *(praise)*
The Reference Screen (the declared structural target) is a KPI strip → toolbar (search + lens + filter chips) → dense table (13.5px rows, 12px vertical padding, keyword + mono sub-URL stacked per row, 6 columns incl. sparkline and meter) → detail drawer. `--page-max: 1180px` dense default with a `--page-max-wide: 1440px` analytics escape, 12px grid gutters, 20px section gaps (`tokens/layout.css`). The cockpit mockup's verdict-first header + three-stream tiles + work queue + right rail (technicals / keywords / content-in-flight) is a legitimately good operator hierarchy: decide first, evidence adjacent. This is not a whitespace-over-utility design.

### P6 — Primary button contrast is unusually good *(praise)*
`--button-primary-text: #0a1f1b` on the mint→emerald gradient computes to **9.2:1 on mint, 8.9:1 on emerald**. Most SaaS products ship white-on-teal at ~2.5:1. The dark-ink-on-mint decision, carried into light mode as white-on-deepened-teal, is a small thing done exactly right.

### P7 — The restraint rules are the brand *(praise)*
"The radius signals status" (signature asymmetric radius only on StatCard/SectionCard, `tokens/spacing.css`), "mint glow reserved for primary CTAs, never general elevation" (`tokens/effects.css`), "two muted text tiers, never three" (`guidelines/type-scale.css` header), no photography, no purple-blue SaaS gradient (readme). These are enforceable, teachable constraints — the difference between a design language and a component pile. The `.eyebrow` utility consolidating the single most-copied line of CSS (18+ hand-rolls) is exactly the right systemization instinct.

### P8 — The brief's a11y floors exist at all *(praise, with a caveat)*
Handoff Brief house rule 7 names ≥44px hit targets, visible mint focus states, and a specific light-mode contrast recheck ("bright mint/amber lose contrast on white"). Naming the floors in the standing preamble is better than 90% of handoff docs. The caveat is B3/M4 below: the kit as shipped doesn't meet its own floors.

---

## BLOCKERS

### B1 — The mandated "tabular numerals on all data" is physically impossible with the shipped font *(blocker)*
**Evidence (parsed from the OTF binaries):** `assets/fonts/D-DIN-PRO-700-Bold.otf` GSUB features are `dlig, frac, liga, ordn, sups` — **no `tnum`, no `lnum`, no `pnum`**. Digit advance widths are proportional: `'1' = 348`, `'7' = 457`, `'8' = 525` units (Regular: `'1' = 329` vs `'8' = 512`). So `font-variant-numeric: tabular-nums` on any DIN-set text is a **silent no-op**, and DIN digits are ~35% narrower for '1' than '8'.

**Where it bites:** the Handoff Brief's house rule 6 says "Tabular numerals on all data." `MetricTile.jsx:31`, `GroupBlock.jsx:43`, `Meter.jsx:16` all request `tabular-nums` **on `var(--font-display)`** — no-ops. The mockup's `.num` class (`Keywords &amp; Flows Mockup.html`) does the same. Every right-aligned DIN numeral column (ranks, volumes, positions — e.g. cockpit `.ck-kpos`, portal `.rpos .now`) will visibly misalign vertically, and any live-updating stat value will jitter horizontally. For a product whose readme says "Numbers carry the message," this is a materials defect, not a style nit.

**What works today by accident:** `DataTable.jsx:53` right-aligned cells and `KeyValueRow.jsx:16` apply `tabular-nums` on inherited **Inter**, which does ship `tnum` — those columns align. The inconsistency proves the fix is cheap.

**Fix options (pick one, system-wide):** (a) license a DIN cut with real tabular figures; (b) declare a rule that *data columns* are set in Inter+`tnum` or JetBrains Mono and reserve DIN for headings/hero stats where alignment across rows doesn't matter; (c) synthesize a tabular DIN subset. Do this before the pilot surface, and add a CI check that `--font-display` + `tabular-nums` never co-occur (it's greppable).

### B2 — Purple reaches client-facing surfaces through the spec itself *(blocker)*
The fourth law — "purple = admin-AI only, **never client-facing**" — is stated in `tokens/colors.css:8`, `readme.md`, `CLAUDE.md`, and the Handoff Brief's hard stops. The kit then violates it three ways:

1. **`mockup/portal.js` — the client portal, the most client-facing surface that exists** — hard-codes `purple:'#7c3aed'` (line 23) and uses it for the "next steps" dots (line 155), the next-step status pill (line 158), and the recommendations section icon + reach pills (lines 201–207). The Handoff Brief says the prototype's component and hierarchy choices are load-bearing spec. An agent building the portal from this spec ships purple to clients by construction.
2. **`components/feedback/IntentTag.jsx:15`** maps the `local` keyword intent to `tone: 'purple'`. Keyword intent is *data*, appears in the Reference Screen table, and keyword/ranking information flows into client-visible surfaces. Also note `transactional → emerald` repurposes the *success* hue as a category color.
3. **`components/feedback/Badge.jsx:11`** reintroduces a `purple` tone into the Badge tone union. The current platform **deliberately removed purple from `Badge.tsx`'s color union** (root `CLAUDE.md`, Four Laws §4) precisely because generic availability guarantees leakage. This is a regression of a settled platform decision.

**Fix:** portal purple → recolor to teal/blue per the trust-spine palette; IntentTag `local` → pick a non-law hue that exists in both theme scopes (sky/cyan are already tokens) or use zinc; Badge → drop the purple tone from the public union and expose it only via an admin-only component or an explicit `adminAI` variant that lint can flag in client paths.

### B3 — The flagship interaction (row → drawer) is keyboard-inaccessible in the core components *(blocker)*
- **`DataTable.jsx:35–48`:** clickable rows are plain `<div onClick>` — no `tabIndex`, no `role`, no key handler, no focus style (hover is a JS `onMouseEnter` style mutation with no focus equivalent). A keyboard user cannot open the keyword drawer in the Reference Screen at all. There are also no table semantics (`role="table"/row/columnheader"`), so screen readers get an undifferentiated div soup with no header-to-cell association.
- **`Drawer.jsx`:** no focus trap, no focus-on-open, no focus-return-on-close, no Escape handling. Worse: when closed, the `<aside>` is only `translateX(100%)` — its buttons **remain in the tab order** while `aria-hidden={!open}` is set, which is both a "focus lands in aria-hidden content" WCAG violation and a ghost-tab-stop bug on every screen that mounts a drawer.
- **`Modal.jsx`:** same — `role="dialog" aria-modal` is present but there is no focus management or Escape handling anywhere (verified by grep: zero `onKeyDown`/`Escape`/`.focus(` in Drawer/Modal/Popover).

WCAG 2.1.1 (keyboard) is a floor beneath the brief's own floors. Since every one of the 18 surfaces will assemble from exactly these primitives, fixing DataTable (row as `role="row"` with `tabIndex=0` + Enter/Space, or an explicit row-action button column) and Drawer/Modal (focus trap util, Escape, `visibility: hidden`/`inert` when closed) fixes the entire product at once. That is the whole argument for doing it now.

---

## MAJOR

### M1 — MetricRing's score bands contradict the platform's settled score-color law *(major)*
`components/data/MetricRing.jsx:4–8`: `score >= 80 → 'var(--teal)'`, with a doc comment claiming "Matches the app's scoreColor." It doesn't. The platform canon is **emerald**: `src/components/ui/constants.ts:15` returns `#34d399` for ≥80, and `constants.ts:54` even carries a comment "FOUR-LAWS FIX: the ≤10 band is emerald (success), NOT teal (actions)" — the platform already fixed this exact confusion once. Teal on a score also breaks law 1 (teal invites a click; a health score is not clickable). Client-facing health scores changing hue is a "meaning of a client-facing figure" change the brief forbids. Fix the component; one line.

### M2 — `--brand-text-dim` fails AA on every surface it sits on, and it is used as real text *(major)*
Computed: `#71717a` on `--surface-2` = **3.67:1**; on `--surface-3` = **3.08:1**; as `--chart-axis` on `--surface-1` = 3.88:1. All below the 4.5:1 AA floor for normal text, and its consumers are *small* text: `.t-micro` (10px, `type-scale.css:23`), `DataTable.jsx:29` column headers (10px mono), Drawer eyebrows (10px), `NavItem` meta (9px). The system's own "two muted tiers" rule sanctions `dim` as a text tier — but a sanctioned text tier must pass AA. Options: brighten the token (~`#84848e` clears 4.5:1 on surface-2), or reclassify `dim` as decorative-only (ticks, dividers) and move table headers/eyebrows to `--brand-text-muted` (`#8b8b94`, 5.25:1 — passes). Note also `--brand-text-faint` currently duplicates `dim` in dark (`#71717a` both) but diverges in light — a trap for anyone choosing between them.

### M3 — Light-mode text contrast failures on exactly the surfaces the brief warned about *(major)*
- `--brand-mint: #0d9488` on white = **3.74:1**. Fine for large text and UI component boundaries; **fails AA for normal-size text**, and mint is used as link/label/eyebrow text at 10–13.5px throughout. The token comment says "deeper in light mode for contrast" — it isn't deep enough for text. A text-safe light mint (`#0f766e` = `--brand-mint-hover`, 4.98:1) already exists in the palette; swap which one is the text default in light scope, or add a `--brand-mint-text` pair.
- `--brand-text-faint: #94a3b8` on white = **2.56:1**, and portal.js (a *light-by-design client trust surface*) uses its hard-coded equivalent for real text: "Powered by" (`pt-power`, 10.5px), rank meta (`rmeta`, 11px mono), timestamps (`when`). The client-facing surface has the worst contrast in the kit.
- The Handoff Brief explicitly says "re-check accents specifically in light mode." The check fails today, in the tokens, before any surface is built.

### M4 — The ≥44px hit-target floor is contradicted by every shipped control except Toggle *(major)*
Handoff Brief house rule 7: "≥44px hit targets." Measured from the components: `Button` lg ≈ 42px, md ≈ 35px, sm ≈ 27px (`Button.jsx:21–25`); `IconButton` = 28/32/40px boxes (`IconButton.jsx:15`); `NavItem` ≈ 31px (7px padding + 13px text); Drawer/Modal close buttons = 30px. Only `Toggle` meets the floor. Two honest resolutions: (a) declare the floor as **pointer-target ≥24px (WCAG 2.5.8 AA) on desktop, 44px on touch/client-facing surfaces**, and write that down — 44px everywhere is genuinely wrong for a dense desktop operator tool; or (b) keep 44px and add invisible hit-area extension (`::after` inset expansion) to the small controls. What cannot stand is a CI-gated floor the design system itself fails — the gate will either fail everything or be quietly ignored, and both outcomes poison the other gates' credibility.

### M5 — Badge/Toast accent tints are frozen dark-mode rgba values that don't re-key in light mode *(major)*
`Badge.jsx:3–13` and `Toast.jsx:3–8` hard-code tint layers like `rgba(45,212,191,.10)` / `rgba(251,191,36,.12)` — derived from the *dark* hue values. Under `.dashboard-light` the text color flips to the darkened accent (e.g. amber `#b45309`) but the wash stays computed from bright dark-mode amber `#fbbf24`. Result: mismatched hue pairs on every badge in light mode, and a direct violation of the kit's own "theme-neutral by construction / tokens only, no raw hex" hard stop *inside its most-used primitive*. Same for `Badge` solid variant's `'#0a1f1b'` literal. Fix pattern: `color-mix(in srgb, var(--amber) 12%, transparent)` (re-keys automatically), or paired `--*-dim` tokens in both scopes (the pattern `--brand-mint-dim` already establishes). This should also become an adherence-lint rule: no `rgba(` with hard-coded channels in components.

### M6 — Overlay z-indexes ignore the token scale and put toasts under modals *(major)*
`tokens/effects.css` defines a careful scale (`--z-modal: 50`, `--z-toast: 60`, up to `--z-critical-system`). The components ignore it with raw numbers: Popover 59/60, Tooltip 70, Drawer 90/95, Modal 100. Consequences: (1) a Toast rendered at token `--z-toast: 60` — the correct, documented value — sits **under** an open Drawer (95) or Modal (100), so mutation feedback ("saved", "failed") is invisible exactly when a modal flow triggers it, which the Build Conventions' mutation-feedback contract makes a first-class scenario; (2) "tokens only" is violated in four layout primitives. Re-point all overlay components at the `--z-*` tokens and re-order (tooltip above popover, toast above everything below critical).

### M7 — Law drift inside the system's own semantic components will propagate 18-wide *(major)*
Three internal contradictions, each small, each about to be cloned into every surface by parallel agents:
- **`StatusBadge.jsx:12`: `live → teal`**, while the readme's law list explicitly names "'Live' pills" under **emerald**. A live/published state is a success state, not an action.
- **`Meter.jsx`: default fill is mint / mint→emerald gradient.** The platform's four laws put "progress bars" explicitly under **blue** (data), and the root `CLAUDE.md` agrees ("Blue for data — … progress bars (read-only, never actionable)"). The Reference Screen renders the Opportunity *data column* as mint gradient meters — data dressed as action, in the structural target every agent is told to copy.
- **`mockup/cockpit.js:213`: flight-meter stage dots hard-code `#a78bfa` (purple) for the "Drafting" stage** — purple as a pipeline-stage category on an operator surface, plus three more raw hexes in the same line.
Settle each with one decision now (live=emerald; Meter default=blue with mint reserved for user-controlled progress like onboarding; stage dots from non-law hues) and encode them in the Which-Primitive guide, or accept 18 divergent interpretations.

### M8 — No responsive contract; the shell has no mobile posture at all *(major)*
`AppShell.jsx` is a fixed `232px 1fr` grid at every viewport — no breakpoint collapses the sidebar (the `rail` prop is manual); on a 375px phone the canvas gets ~140px. `tokens/layout.css` breakpoints are labeled "reference values" and nothing consumes them. The mockup shell (`Keywords &amp; Flows Mockup.html`) is `overflow: hidden`, desktop-only, zero `@media`. Container-query responsiveness exists but is patchy: the mockup canvas sets `container-type: inline-size` (line 208) so `performance.js`/portal `@container` rules do work, but `AppShell`'s canvas is the only component-level container and no doc states which surfaces owe which breakpoints. For the **admin** tool, desktop-first is a defensible explicit decision — but it is nowhere written down, and the **client-facing portal and recommendations surfaces will be opened on phones** (clients read "your monthly update" from an email link on mobile more than anywhere else). Required: a one-page responsive contract — shell behavior below `--bp-md`, which surfaces are mobile-required (portal, recs: yes) vs desktop-optimized (editor, audit: fine), and the container-query pattern to use. The root platform's own rule is "Mobile-first … test at mobile breakpoints"; the rebuild kit currently walks that back silently.

---

## MINOR

### m1 — The Reference Screen violates the kit's icon rule and its eyebrow rule *(minor)*
`Reference Screen - Keywords.html:28–40` hand-rolls **Lucide** glyph paths ("Lucide glyphs via the Icon contract") and never loads the FA kit, while `CLAUDE.md`/readme mandate Font Awesome Sharp Regular, "No Lucide." `Toast.jsx`'s doc comment also says "Pair with an icon (Lucide)." The same file hand-rolls the uppercase mono eyebrow inline three times (drawer section labels) — the exact pattern the readme says to "treat as a defect in review." The structural target every agent copies should be the most compliant artifact in the kit, not a rule-breaker. Small fixes; do them before the pilot.

### m2 — Fira Code is "retired" but is the mockup's actual mono, 200+ uses *(minor)*
`tokens/fonts.css` declares JetBrains Mono "THE mono (Fira Code is retired)," yet the mockup shell `<link>`s Fira Code from Google Fonts and 35 of 40 view files hard-code `'Fira Code',monospace` (grep counts: editor 34, pipeline 19, traffic 18, aivis 14…). Since the mockup is "indicative" this is tolerable *if* the port re-maps every instance to `var(--font-mono)`; it becomes a real defect the first time an agent copies a mockup CSS block verbatim. Add `Fira Code` to the adherence lint's forbidden list.

### m3 — Sub-scale font sizes saturate the mockup with no remap table *(minor)*
The sanctioned scale bottoms out at `t-micro` 10px mono / `t-label` 11.5px, but mockup views run 8.5px (`.ck-fkind`), 9px (`.ck-tsev`, NavItem meta), 9.5px, 10.5px sans-serif text throughout. The kit tells agents "trust the design system's type scale over the mockup" but provides no mapping (e.g. 11px pill → `t-label`; 10.5px meta → `t-micro` only if mono+uppercase, else `t-caption-sm`). Past migration experience in this repo (t-micro misuse; `text-[11px]` mismaps) says agents *will* guess wrong at scale. Publish a one-table remap in the Handoff Brief.

### m4 — StatCard numerals get no tabular treatment and its delta is sign+color only *(minor)*
`StatCard.jsx:37–47`: the value doesn't request `tabular-nums` (moot until B1 is fixed, relevant after), and the delta lacks TrendBadge's arrow. Sign + color is acceptable (sign carries direction), but using `TrendBadge` inside StatCard would unify the delta language. Also `Sparkline` is `aria-hidden` with no text alternative — fine when paired with a visible delta, so make "sparkline never appears without an adjacent numeric delta" an explicit rule.

### m5 — Meter and MetricRing lack ARIA value semantics *(minor)*
`Meter.jsx` has no `role="progressbar"` / `aria-valuenow`; `MetricRing.jsx`'s SVG is unlabeled (the centered numeral saves it visually, but nothing associates "82" with "health score" for a screen reader). Cheap adds.

### m6 — NavItem's count badge uses the premium yellow accent for routine counts *(minor)*
`NavItem.jsx:33` renders nav badges in `--brand-yellow` — the token colors.css reserves as "premium / spotlight accent." Counts are data; blue or zinc fits the laws. Also NavItem `meta` is 9px text (below scale) at `--brand-text-dim` with `opacity: .8` — triple-degraded, ~3:1 effective contrast.

### m7 — Portal is a parallel, off-token light palette *(minor, deliberate but risky)*
`portal.js:17–24` defines its own hard-coded palette object rather than consuming `.dashboard-light` tokens. As a framed "client preview" this is a defensible mockup device, but the production portal must be built on the token system or it will drift from every future token fix (including M3's contrast fixes). The Handoff Brief should say so explicitly for the Client Portal surface ticket.

### m8 — `--ann-camp: #a855f7` puts purple in traffic-chart annotations *(minor)*
`tokens/colors.css:94`: campaign annotation overlays are purple. Annotations appear on traffic charts that flow into client-visible contexts. Inherited from the current app, but the rebuild is the moment to re-hue (cyan/sky are free).

### m9 — Disabled text `#3f3f46` is 1.7:1 *(informational)*
WCAG exempts disabled controls, so this passes — but at 1.7:1 disabled labels are near-invisible on `--surface-2`; users can't read *what* is disabled. Consider `--zinc-600` (#52525b) for disabled text with the current value kept for disabled borders.

---

## Data-viz assessment (charts, rings, trends)

The chart token layer (`tokens/effects.css`) is thoughtful: grid/axis/tooltip colors themed in both modes, area-fill opacities as tokens, dot-ring matching surface. `Sparkline` normalizes correctly, degrades to an empty SVG on no data, and defaults to blue (law-correct). `MetricRing` is clean SVG with sensible stroke scaling. Concerns beyond M1/m5: the palette for *multi-series* charts doesn't exist — there's a blue scale "for chart demos," but no declared series ramp, so 18 surfaces of agents will invent their own; and the mockup's Lighthouse ring (`performance.js:164`) hand-rolls what `MetricRing` should render (with its own score bands — a third band definition). Declare one score-band function and one categorical series ramp as system contracts before fan-out.

## Density & hierarchy assessment

From code: KPI tiles at 180px min in an auto-fill grid, 13.5px UI copy, 12px row padding, 26px page gutters, verdict-first cockpit with grouped work queue and a supporting right rail — the hierarchy consistently puts a decision or a number first and chrome second. The type scale's 13.5/15.5px "bumped small sizes" is a deliberate legibility choice that keeps density honest. Two watch-items: (1) the mockup achieves its density partly through sub-scale type (m3) — porting to the sanctioned scale will make everything ~8% bigger, so verify the flagship tables still fit at 1280×800 during the pilot; (2) `--page-pad-bottom: 90px` reserves space for floating bars on every page whether or not one exists — fine as a token, but PageContainer applying it unconditionally wastes a stat-row of vertical space on short viewports (inference; verify in pilot).

---

## Recommendations (ordered)

1. **Fix B1 before the pilot surface:** decide the numeral strategy (tabular DIN license, or Inter/JetBrains for data columns), then add an adherence-lint rule forbidding `font-display` + `tabular-nums` co-occurrence.
2. **Purge client-facing purple at the source (B2):** recolor portal.js, re-map IntentTag `local`, remove `purple` from Badge's public tone union; add a lint rule (purple tokens forbidden under client-surface paths) mirroring the platform's existing `grep -r "purple-" src/components/client/` gate.
3. **Make the four core interaction primitives accessible once (B3):** DataTable keyboard rows + table semantics; a shared focus-trap/Escape/inert utility consumed by Drawer, Modal, Popover. Gate the pilot on a keyboard-only walkthrough of the Reference Screen (row → drawer → action → close → focus returns).
4. **One-line law fixes (M1, M7):** MetricRing ≥80 → emerald; StatusBadge live → emerald; Meter default → blue; document all three in the Which-Primitive guide.
5. **Token pass (M2, M3, M5-adjacent):** brighten or reclassify `--brand-text-dim`; make light-mode mint text-safe; replace frozen rgba tints with `color-mix` on tokens; re-point overlay z-indexes at `--z-*` (M6).
6. **Write the two missing contracts:** the hit-target policy (M4 — pick 24px desktop / 44px touch and say so) and the responsive contract (M8 — shell collapse behavior + which surfaces are mobile-required, portal first).
7. **Clean the reference artifacts (m1, m2, m3):** FA icons + `.eyebrow` in the Reference Screen; Fira Code on the lint blacklist; publish the mockup→scale type remap table.
8. **Add the missing data-viz contracts:** one score-band function, one categorical series ramp, "sparkline never without adjacent delta."

None of the blockers is architectural. The system's bones — tokens, theming, density, restraint rules — are worth building on; the failures are all instances of the kit not yet obeying its own laws, and every one is cheapest to fix now, while there is exactly one copy of everything.
