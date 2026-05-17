# Styleguide Lockdown Contract

> Canonical contract for the platform-wide styleguide migration lock.
> This complements `CLAUDE.md`, `BRAND_DESIGN_LANGUAGE.md`, `DESIGN_SYSTEM.md`,
> `/styleguide`, and `src/tokens.css`.
> Rule-level registry authority lives in `docs/rules/styleguide-rule-registry.md`
> and `data/styleguide-rule-registry.json`.

## Authority Order

1. `src/tokens.css` (all `--*` token values)
2. `src/index.css` (`.t-*` typography utilities + global token consumers)
3. UI primitives in `src/components/ui/`
4. `BRAND_DESIGN_LANGUAGE.md` Four Laws + color/semantics map
5. `/styleguide` + `public/styleguide.css` (visual reference, must mirror app)

If two sources conflict, higher authority wins.

## Hard Invariants

1. Interactive controls use shared primitives (`Button`, `IconButton`, form + overlay primitives) unless explicitly allowlisted.
2. Typography uses `.t-*` utilities; raw `text-[Npx]` is disallowed unless explicitly justified.
3. Radius uses `--radius-*` tokens; raw radius literals/classes are disallowed unless justified.
4. Colors must follow Four Laws and approved semantic map.
5. Card/page shell layout uses approved primitives (`SectionCard`, `PageHeader`, etc.) rather than hand-rolled clones.
6. Style exceptions are declared in `data/style-exceptions.json` with owner + expiry metadata.

## Scorecard Schema

`verify:style-drift` tracks the following metrics:

- `raw_button_unallowlisted_count`
- `raw_typography_bypass_count`
- `raw_radius_literal_count`
- `disallowed_hue_count`
- `non_primitive_action_count`
- `exception_count`

Baselines are persisted in `data/style-drift-baseline.json`.
Any metric increase versus baseline is a regression.

## Rule Registry Contract

All style/design directives must be represented in the canonical registry:

- Human-readable: `docs/rules/styleguide-rule-registry.md`
- Machine-readable: `data/styleguide-rule-registry.json`

Each directive must include enforcement tier, detectability class, metric key,
and fixture requirements before promotion.

## Enforcement and Ratchet Policy

1. No net-new exceptions: `exception_count` must not increase.
2. Warning-to-error ratchet is staged (admin-facing rule groups first).
3. Rules only promote to `error` when full-scan shows zero live violations.
4. Visual regression gates (`phase2:baseline`) are required for migrated surfaces.

## Implementation Checklist (Per Wave)

1. Migrate to primitives/tokens.
2. Remove temporary hatches where fixed.
3. Run: `npm run typecheck && npx tsx scripts/pr-check.ts --all && npx vite build && npx vitest run`.
4. Run: `npm run verify:style-drift` and confirm no metric regression.
5. Run visual baseline diff for touched surfaces.
