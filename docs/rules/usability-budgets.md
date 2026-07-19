# Admin Usability Budgets

These eight budgets are **D3-ratified** platform contracts for every current
and future admin surface. They turn the reusable conventions confirmed by the
2026-07-16 UX-flow audit into reviewable limits. A budget may be enforced by a
browser measurement, pr-check, a contract test, or the PR-readiness checklist;
the enforcement home named below is part of the contract.

The budgets apply to representative, production-shaped data. An empty fixture
cannot prove action placement, collection containment, or readback hierarchy.
If a surface cannot be populated locally, record it as code-judged rather than
claiming that it passed a browser-measured budget.

## Ratified budget registry

| # | D3-ratified budget | Limit | Enforcement home |
|---|---|---|---|
| 1 | Primary action within one fold | The first enabled primary-variant action is at `y < 900` at 1440×900 on representative data, unless the surface explicitly declares itself verdict-only. | Standard fold/action browser probe below + `docs/workflows/pr-readiness-checklist.md`; measured in every flow-changing PR. |
| 2 | Depth within four folds; collections contained | Page depth is at most four 900px folds. Any collection over 50 rows paginates, uses master/detail with internal scroll, or virtualizes rather than growing in page flow. | Standard fold/action browser probe below + PR-readiness checklist. `WorkbenchFrame`/bounded-workbench tests are the preferred component-level home as surfaces adopt them. |
| 3 | One idiom per pattern | A lens represents a different mental model; a column preset is not a lens and group-by is not a lens. At most two control rows sit above a collection. Guide uses a Drawer consistently. | PR-readiness checklist + evaluative persona pass; primitive guidance belongs in `docs/workflows/use-primitives.md`. |
| 4 | Every empty state names its next action | A rebuilt `EmptyState` supplies an `action`, except for an audited terminal or parent-owned recovery state. Copy must name the populating condition or exact fix location and teach rather than apologize. | pr-check rule `Actionless EmptyState in rebuilt surface` for the action signal; checklist/persona review for wording quality. |
| 5 | Every aggregate states its window and basis | Rates, rollups, totals, deltas, and freshness claims state the time window and source/basis using shared constants or provenance/freshness UI. A displayed rate and total use the same numerator/denominator source. | PR-readiness checklist rate-display/window item; shared constants and existing rate-denominator tests where available. |
| 6 | One name per destination | Sidebar, breadcrumb, command palette, document title, and in-surface title use the registry-resolved destination name. | pr-check rule `RebuiltSidebar hardcoded nav label override`; W0.3 adds/pins nav naming parity after registry closure. |
| 7 | Vocabulary comes from the registry | New operator-facing coinage is registered in both `GLOSSARY.md` and `shared/types/lexicon.ts`; action labels say what the control actually does and survive a say-it-aloud client-call test. | `npm run verify:lexicon` + PR-readiness checklist + `docs/workflows/ui-vocabulary.md`. |
| 8 | Readback above data entry | On a reading surface, verdict/readback content mounts before forms. Occasional data-entry belongs below the readback or behind a secondary action and Drawer. | PR-readiness checklist + evaluative persona pass/component order assertion for reworked reading surfaces. |

## Standard measurement for budgets 1–2

Use the audit dataset’s measurement conditions: viewport 1440×900, one fold =
900px, scroll position at the top, live or loaded-demo representative data,
default route/lens, and no Drawer or modal open. Wait for queries and layout to
settle, then run this browser probe in the page context:

```js
window.scrollTo(0, 0);

const fold = 900;
const root = document.querySelector('main') ?? document.body;
const actionSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="button"]:not([aria-disabled="true"])',
].join(',');

const visible = (element) => {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden'
    && !element.closest('[aria-hidden="true"]');
};

const actions = [...root.querySelectorAll(actionSelector)].filter(visible);
const primary = actions.find((element) => {
  const className = typeof element.className === 'string' ? element.className : '';
  return className.includes('from-[var(--teal)]')
    && className.includes('to-[var(--emerald)]');
});
const y = (element) => Math.round(element.getBoundingClientRect().top + window.scrollY);
const pageHeight = document.documentElement.scrollHeight;

({
  viewport: `${window.innerWidth}x${window.innerHeight}`,
  pageHeight,
  folds: Number((pageHeight / fold).toFixed(1)),
  actions: actions.length,
  aboveFold: actions.filter((element) => y(element) < fold).length,
  firstPrimary: primary
    ? { label: primary.textContent?.trim() ?? '', y: y(primary) }
    : null,
});
```

Record the returned object in the PR notes for a flow/layout change. Budget 1
passes when `firstPrimary.y < 900`, or when the parity contract explicitly
declares the surface verdict-only and the PR notes cite that exception. Budget
2 passes when `folds <= 4`; also inspect every collection over 50 rows because
a shallow empty state does not prove populated containment.

## Budget 4 allowlist governance

W0.2 audited all 54 rebuilt `EmptyState` mounts without an `action` prop. The
pr-check allowlist in `scripts/pr-check.ts` fingerprints each exception by file
and stable tag text and records why it is terminal, parent-owned, or scheduled
for repair. New actionless mounts fail. A changed fingerprint must be re-audited
rather than silently inheriting an exception.

Six entries carry `TODO-W1.3` because W1.3 adds direct Workspace Settings
actions to the dead-end Webflow/GA4/GSC connection states. Delete each TODO
allowlist entry when its action lands. The remaining terminal/readback and
nested provider-panel exceptions stay reviewable; copy that merely apologizes
(`did not return rows`) still fails the manual wording-quality part of budget 4.
The narrow `// empty-state-action-ok: <reason>` hatch exists for a reviewed new
exception and is honored on the opening line or immediately above it.

## Budget 6 transition governance

W0.2 intentionally ratchets instead of breaking staging. The pr-check rule
`RebuiltSidebar hardcoded nav label override` allows only the five audited
`GROUP_PRESENTATION` overrides present at ratification and fails any new or
changed override. That temporary allowlist is **deleted in W0.3** when W0.3
moves the chosen labels into `navRegistry` and removes the sidebar overrides.
After W0.3, the rule remains as the permanent guard against presentation-only
destination names. The `// rebuilt-nav-label-ok: <reason>` hatch requires an
owner-approved exception and is honored inline or immediately above the item.

## Rule lifecycle

This is an active rules document under `docs/rules/rules-lifecycle.md`. The two
mechanized checks are registered in `scripts/pr-check.ts`, covered by trigger,
negative, hatch, ratchet-allowlist, registry-census, describe-presence, and
generated-rules parity tests in `tests/pr-check.test.ts`, and published through
`npm run rules:generate` into `docs/rules/automated-rules.md`.

Retire a mechanized rule only when the compiler or a stronger contract test
fully owns the same bug class. Removing a rule requires removing its hatches,
regenerating `automated-rules.md`, and recording the reason. Temporary campaign
allowlists are narrower: remove their entries as the named follow-up lands;
they are not permanent exemptions.
