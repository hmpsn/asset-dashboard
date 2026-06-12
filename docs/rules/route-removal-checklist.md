# Route Removal Checklist

When removing or renaming a value from the `Page` union type (`src/routes.ts`), every one of the following must be updated in the **same commit**. Skipping any of these produces a dangling reference that either fails at runtime (missing case in `renderContent()`) or leaves a dead nav entry that navigates to a 404.

> **Nav-registry reality (W3.4, 2026-06).** The Sidebar, CommandPalette, and Breadcrumbs are now **registry-driven** — all three read nav identity (label, `needsSite`, group, description) from `NAV_REGISTRY` in `src/lib/navRegistry.tsx` via `resolveNavLabel()` / `entry.needsSite`. They no longer hold their own per-tab metadata (the `Hardcoded nav metadata outside the nav registry` pr-check rule enforces this). What used to be three separate update sites (Sidebar / Breadcrumbs / Palette) is now **one**: the registry entry. A `Page` value that is intentionally not in the sidebar lives in `NON_REGISTRY_PAGES` instead.

## The update sites

1. **`src/routes.ts`** — remove the value from the `Page` union type. (The compiler will then flag every exhaustive switch that still references it.)
2. **`src/App.tsx`** — remove the corresponding `case` in `renderContent()`. A removed-but-redirected route keeps a `<Navigate>` line here through its soak window before the value is deleted.
3. **`src/lib/navRegistry.tsx`** — remove the `NAV_REGISTRY` entry **or** the `NON_REGISTRY_PAGES` entry, whichever holds the value. This single removal propagates to the Sidebar, CommandPalette, and Breadcrumbs automatically.
4. **Grep for navigation literals** — `grep -rn "'old-route'" src/` to find every `adminPath(*, 'old-route')` / `clientPath(...)` / `?tab=old-route` target. A global search for the string literal is the only reliable way to catch these. (For folded-in routes, a dedicated pr-check rule can mechanize the ban — see the `Retired seo-ranks route literal in src` rule, promoted from the `route-fold-in-seo-ranks` drift test.)
5. **Contract / nav tests** — update the nav-coverage contract tests and any `?tab=` deep-link wiring tests, plus any integration/unit/E2E specs that reference the old value. Update or delete them.

## Why mostly no pr-check rule

This is a cross-file constraint rather than a per-file pattern, so a generic regex rule would produce false positives on any file that mentions the old route string for a valid reason (migration notes, redirects, test fixtures). The TypeScript compiler catches the most dangerous cases — a missing `case` in `renderContent()` and any exhaustive switch over `Page` fail `tsc -b --noEmit` because the `Page` union is exhaustive. The nav surfaces are covered by the registry (one removal, three surfaces).

For a **specific** folded-in route that should never return (e.g. `seo-ranks`), promote the drift grep into a scoped pr-check rule with an escape hatch — see the `Retired seo-ranks route literal in src` rule. Reserve this for routes with a real reintroduction hazard, not every removal.

## Related

- [docs/rules/data-flow.md](./data-flow.md) — event/route string conventions
- [docs/rules/pr-check-rule-authoring.md](./pr-check-rule-authoring.md) — when to add a new rule vs keep a manual checklist
