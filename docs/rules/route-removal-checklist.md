# Route Removal Checklist

When removing or renaming a value from the `Page` union type (`src/routes.ts`), every one of the following must be updated in the **same commit**. Skipping any of these produces a dangling reference that either fails at runtime (missing case in `renderContent()`) or leaves a dead sidebar entry that navigates to a 404.

## The seven update sites

1. **`src/routes.ts`** — remove the value from the `Page` union type.
2. **`src/App.tsx`** — remove the corresponding `case` in `renderContent()`.
3. **`src/components/layout/Sidebar.tsx`** — remove the sidebar entry (icon, label, click handler).
4. **`src/components/layout/Breadcrumbs.tsx`** — remove the entry from `TAB_LABELS`.
5. **`src/components/CommandPalette.tsx`** — remove the entry from `NAV_ITEMS`.
6. **Grep for `adminPath(*, 'old-route')`** — update every navigation target that referenced the old route value. A global search for the string literal is the only reliable way to catch these.
7. **Tests** — find any tests that reference the old route value (integration tests, unit tests, E2E specs) and update or delete them.

## Why no pr-check rule

This is a cross-file constraint rather than a per-file pattern, so a regex-based rule would produce false positives on any file that happens to mention the old route string for a valid reason (e.g. migration notes, redirects, test fixtures). The TypeScript compiler catches the most dangerous cases — missing `case` in `renderContent()` fails `tsc -b --noEmit` because the `Page` union is exhaustive. The remaining entries (sidebar, command palette) must be removed manually.

If you add a new enum-style string anywhere in the app that's referenced in 5+ places, consider adding a `grep -n` smoke test to `tests/unit/` as a safety net rather than waiting for the next route removal to catch the drift.

## Related

- [docs/rules/data-flow.md](./data-flow.md) — event/route string conventions
- [docs/rules/pr-check-rule-authoring.md](./pr-check-rule-authoring.md) — when to add a new rule vs keep a manual checklist
