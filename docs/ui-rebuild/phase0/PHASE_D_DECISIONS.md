# Phase D — Ratified Decisions (UI Rebuild)

**Ratified:** 2026-07-03 by owner ("lock with your defaults") · **Status:** LOCKED — these gate all rebuild work.
**Source of defaults:** [PHASE0_SIGNOFF.md](PHASE0_SIGNOFF.md) §2 / [STRATEGY.md](STRATEGY.md) §1 / [cross-design-system.md](cross-design-system.md) §6 / [cross-client-dashboard.md](cross-client-dashboard.md) §5.

## Tier-1 (program-gating)

| # | Decision | RATIFIED ANSWER |
|---|---|---|
| D1 | Design-system integration path | **Option C: port/merge into `src/components/ui/` under HEAD conventions.** Kit `.d.ts` = prop floor; **HEAD props always win**; kit `.jsx` = pixel spec. Options A (wrap bundle) and B (copy as-is) are off the table. |
| D2 | Rebuild root path | **In-place-behind-flags** with a per-file `@ds-rebuilt` marker as the scope for rebuild-only lint/pr-check rules. |
| D3 | Page Intelligence home | **SEO Editor Research mode** (the ledger's answer). Bounds the Keywords pilot scope. |
| D4 | Client dashboard | **Option C: finish the C1 cutover (flag-ON staging validation → global flip → legacy retirement) → C2 re-skin the ratified 4-tab IA with the design system → C3 additive portal ideas, each individually flagged + signed off.** No new client IA. |
| D5 | Icon system | **REVERSED 2026-07-03 by owner → Font Awesome Sharp Regular (Pro 7, self-hosted).** The kit's original `Icon`/`ICON_NAMES` contract (Font Awesome Sharp Regular) is restored as the icon system of record; the woff2 + Pro CSS are self-hosted under `public/vendor/fontawesome/` + `public/fonts/` (no CDN/kit script). `<Icon name="…">` renders a `fa-sharp fa-regular fa-…` glyph via `ICON_NAMES`; `<Icon as={LucideIcon}>` stays supported during the incremental migration off lucide-react (~381 files). ~~Original ratified answer: lucide-react, no Font Awesome dependency.~~ |
| D6 | Action-color vocabulary | **"Teal" is the canonical word** (matches Tailwind class names at hundreds of call sites + existing CLAUDE.md/BRAND_DESIGN_LANGUAGE). `--brand-mint` token names remain as-is (same hex #2dd4bf; renaming tokens is churn without value) but are documented as the teal action family. Kit docs' "mint" is translated at port time. |
| D7 | Rule severity in rebuild scope | **Error from day one** on `@ds-rebuilt` files. |
| D8 | URL scheme / redirects | **A redirect map is a required deliverable of every consolidation PR**, per the route-removal checklist. |

## D4 sub-questions (client dashboard)

| Q | RATIFIED ANSWER |
|---|---|
| Q2 tab set | **Keep the ratified set: Overview · Inbox · Results · Deep Dive (+ Settings).** Performance stays folded in Deep Dive › Analytics; Brand stays in Settings. Kit mockups' alternate tab sets rejected. |
| Q3 theme | **Keep HEAD behavior: dark default + client-side toggle** through C1/C2 (zero behavior change during cutover/re-skin). Light-by-default for clients is revisited as its own C3-era decision with the re-skin in hand. |
| Q4 send-boundary model | **Out of scope for C1/C2.** Considered per-idea at C3 with explicit owner sign-off (it is a product/workflow change, not UI parity). |
| Q5 cutover mechanics | **Confirmed:** staging flag-ON validation → global flip (client `useFeatureFlag` cannot per-workspace pilot) → legacy-branch retirement. All client workspaces move at once. |
| Q6 ROI → Results merge | **Approved** with `?tab=roi` alias + retirement per CL2. |
| Q7 deferred items | **Multi-location (IA v2 P5): SCHEDULED into this rebuild** (Phase C backlog) — elevated from deferred because the multi-location persona returned the panel's only *blocker* verdict and the finding was validated. Landing-in-shell polish stays deferred. |

## Design-system sub-decisions consumed by F1 (from cross-design-system §6)

| Q | RATIFIED ANSWER |
|---|---|
| Mono font (§6 Q7) | **Adopt the kit's ratification: JetBrains Mono is THE mono; Fira Code retired.** Load JetBrains Mono (Google Fonts, alongside Inter); mono stacks become `'JetBrains Mono','Menlo','Courier New', monospace`. |
| Shadow duplication (§6 Q6) | **Adopt kit `--shadow-sm/md/lg/glow` as the canonical elevation family.** `--brand-shadow-*` kept, marked deprecated in `src/tokens.css` comments; migration is a Z-phase deferred item. |
| `.t-*` baked colors (§6 Q8) | **Keep HEAD behavior — `.t-*` classes set NO color** (call sites own color). Kit classes' color declarations are dropped at port. `tabular-nums` on stat/mono classes is kept (kit's omission is the bug). |
| Kit z-index extras (`--z-takeover/command-palette/system-toast/critical-system`) | **Not added in F1 (YAGNI).** Added demand-driven in F3 when a ported component needs them. HEAD-only z tokens (`--z-commerce-*`, `--z-client-toast`) are untouchable. |
| Noise overlay + global focus ring (§6 Q10) | **Deferred — not in F1.** Product-wide visible changes; decided at F4/pilot with real surfaces to judge on. |
| Badge purple/tone (§6 Q4), DataList contract (§6 Q5), adherence lint home (§6 Q9) | **Tier-2 — decided at F2/F3 dispatch** as ticket blockers, not now. HEAD policy (no purple) is the standing default. |

## Standing policies ratified with the batch

- Trade-off policy **T1 carry-over-then-reskin is the default** for machinery-dense components; T2–T14 as tabled in [STRATEGY.md §2](STRATEGY.md) with their upgrade triggers.
- Hard floors (non-tradeable): no UI-computed money/verdicts; no fabricated numbers; no export drops; no a11y-broken overlays; no capability deletion without a named home.
- Deferred ledger `data/ui-rebuild-deferred-ledger.json` + `verify:deferred-ledger` CI step (ships F2); every PR carrying a trade-off adds its `DEF-*` row in the same PR.
- Consistency auditor: mechanized (scoped lint/pr-check, error severity) + 3-tier agentic sweeps per [cross-consistency.md](cross-consistency.md).
- Sequence: **D → F1–F5 → P (Keywords pilot) → A (2 lanes to start) ∥ C (C1→C2→C3) → Z.** Phase-per-PR, staging-first, ledger-as-DoD per surface.
