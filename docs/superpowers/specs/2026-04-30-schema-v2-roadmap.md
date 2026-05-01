# Schema Generator v2 — Master Roadmap

**Date:** 2026-04-30
**Status:** Specs complete, ready for implementation planning
**Context:** `docs/superpowers/audits/2026-04-30-hmpsn-schema-baseline-audit.md`

---

## Four Workstreams

| ID | Spec | PRs | Lines | Dependencies |
|----|------|-----|-------|--------------|
| A | [Webflow Scope Widening](2026-04-30-schema-webflow-scope-widening-design.md) | 1 | ~80 | None |
| B | [LocalBusiness Threading](2026-04-30-schema-localbusiness-design.md) | 1 | ~100 | None |
| C | [Entity Graph](2026-04-30-schema-entity-graph-design.md) | 1 | ~400 | None |
| D | [Site Plan Wiring](2026-04-30-schema-site-plan-wiring-design.md) | 2 | ~250 | **C must be merged first** |

Total: 5 PRs, ~830 lines of diff.

---

## Dependency Graph

```
A ──────────────────────────── merge
B ──────────────────────────── merge
C ──────────────────────────── merge ──► D-PR1 ──► D-PR2
```

A, B, and C have no dependencies on each other and can be dispatched in parallel. D-PR1 cannot start until C is merged; D-PR2 cannot start until D-PR1 is merged.

**Shared-contract pre-commit rule (CLAUDE.md):** Before any agent touches `generator.ts`, `site-context.ts`, or `schema-suggester.ts`, the `SiteContext` / `SiteContextPage` interfaces and `LeanGeneratorInput.siteContext?: SiteContext` field must be committed. This is C's pre-commit step.

---

## Shipping Order

### Wave 1 — dispatch in parallel (no dependencies)

| PR | Workstream | What it fixes | Risk |
|----|-----------|---------------|------|
| A | Scope widening | PR1+PR2 enrichments now fire on `.w-richtext` pages | Low — scope helper + mechanical substitution |
| B | LocalBusiness | `/about`, `/contact`, `/services/*` gain entity cross-refs; callout surfaces data gap | Low — optional field threading |

**Combined wave diff: ~180 lines.** Both PRs touch disjoint files:
- A owns: `server/schema/extractors/page-elements/**`
- B owns: `server/schema/templates/static.ts`, `server/schema/templates/service.ts`, `server/schema/generator.ts` (three dispatch calls only), `src/components/schema/SchemaSuggester.tsx`

No file overlap. Safe to merge independently or together.

---

### Wave 2 — after Wave 1 is merged and green on staging

| PR | Workstream | What it fixes | Risk |
|----|-----------|---------------|------|
| C | Entity graph | Hub pages reference their children; `/services`, `/insights`, `/our-work` earn cross-page rich results | Medium — new module + generator branching |

**C is the architectural foundation.** It introduces `SiteContext` / `SiteContextPage` and the optional `siteContext` threading into `generateLeanSchema`. All C changes are additive and backward-compatible — `siteContext` is optional, existing callers require no changes.

---

### Wave 3 — after C is merged and green on staging

| PR | Workstream | What it fixes | Risk |
|----|-----------|---------------|------|
| D-PR1 | Site Plan wiring — data layer + exclusion | 8 junk pages excluded from schema; excluded indicator in dashboard | Low — additive fields, no generator changes |
| D-PR2 | Site Plan wiring — role → @type override | `/discovery` emits Service+ReserveAction; role fills classifier gaps | Medium — generator dispatch branch + two new templates |

D-PR2 must not start until D-PR1 is merged and green on staging (CLAUDE.md phase-per-PR rule).

---

## What Each Workstream Does NOT Include

Per spec — deferred to future PRs:

- **A** — Webflow-specific extractor pass, FAQ extractor scope change
- **B** — team members as `Person` on `/about`, contactPoint on `/contact`, LocalBusiness healthcare subtypes
- **C** — sub-service `isPartOf` back-reference, role-driven hub detection (D handles this), page exclusion (D handles this)
- **D** — auto-regeneration on role change (requires background job infrastructure), `industrySubtype` escalation

---

## Verification Summary

Each PR ships with:

1. `npm run typecheck && npx vite build && npx vitest run` — zero failures
2. Staging re-run of baseline audit script against `662a84f1ca1f7847c26a1eb8`
3. Workstream-specific functional checks (see each spec's Verification Gate section)

Pass criteria for "schema v2 complete":

| Check | Expected |
|-------|---------|
| `/services` | Service + OfferCatalog with 3 child @id refs |
| `/insights` | Blog + blogPost[] with 5 child @id refs |
| `/our-work` | CollectionPage + mainEntity:ItemList with 4 ListItem entries |
| `/about` | mainEntity: `{ "@id": "…/#localbusiness" }` (when businessProfile.address set) |
| `/contact` | mainEntity: `{ "@id": "…/#localbusiness" }` (when businessProfile.address set) |
| `/services/*` | provider: `{ "@id": "…/#localbusiness" }` (when businessProfile.address set) |
| Any blog post / case study on Webflow | Non-zero rawCounts for at least one enrichment type |
| `/schedule/*`, `/401`, `/404` | excluded: true in snapshot, no schema generated |
| `/discovery` | Service + potentialAction:ReserveAction |
| Schema dashboard | Callout visible when businessProfile.address empty |

---

## Implementation Planning

Follow `docs/PLAN_WRITING_GUIDE.md` for each workstream plan. Model assignments per spec:

| Workstream | Model |
|-----------|-------|
| A — scope substitution + unit tests | Haiku |
| B — parameter threading + conditional logic + callout | Haiku |
| C — pure function + unit tests (assembleSiteContext) | Haiku |
| C — template branching + integration tests | Sonnet |
| D-PR1 — data layer + exclusion wiring | Haiku |
| D-PR2 — role-override dispatch + new templates | Sonnet |
| D — integration tests | Sonnet |
