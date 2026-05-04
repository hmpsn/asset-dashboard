# Platform Consolidation Monolith Splits - Implementation Plan

## Overview

Reduce the largest platform monoliths through behavior-preserving extractions. Phase 1 starts with routes and slice helpers that already have clean boundaries, keeping high-risk orchestration work for later phases.

## Pre-Requisites

- [x] Phase 0 platform consolidation audit complete: `docs/superpowers/audits/2026-05-04-platform-consolidation-audit.md`
- [x] Monolith pre-plan audit complete: `docs/superpowers/audits/2026-05-04-platform-consolidation-monolith-preplan-audit.md`
- [x] Phase 1 background job contract merged to staging

## Task List

### Task 1 - Webflow SEO Route Utility Split (Model: sonnet)

**Owns:**
- `server/routes/webflow-seo.ts`
- `server/routes/webflow-seo-suggestions.ts`
- `server/routes/webflow-seo-page-tools.ts`
- `server/route-groups/webflow.ts`

Move SEO suggestion CRUD/apply routes and page HTML/SEO copy utility routes into focused routers. Preserve all paths and response shapes.

### Task 2 - Page Elements Intelligence Slice Split (Model: sonnet)

**Owns:**
- `server/workspace-intelligence.ts`
- `server/intelligence/page-elements-slice.ts`
- `tests/unit/page-elements-slice.test.ts`

Move the page-scoped `pageElements` assembler and formatter behind a stable import. Preserve the read-only behavior: no extraction during intelligence assembly, and missing persisted catalogs return `undefined`.

### Task 3 - Roadmap And Feature Audit Updates (Model: haiku)

**Owns:**
- `data/roadmap.json`
- `FEATURE_AUDIT.md`

Mark this first monolith split as completed without marking the larger route/component split items done.

## Task Dependencies

Sequential:
  Task 1 and Task 2 can be implemented independently, then Task 3 records the completed phase after verification.

Later phases:
  Keyword strategy helper/feedback route split -> keyword strategy generation service extraction -> background job migration.
  StrategyTab hook split -> StrategyTab section components -> deep-link contract fix.
  Workspace intelligence slice directory split -> formatter split -> cache/orchestrator cleanup.

## Cross-Phase Contracts

### Phase 1 -> Later Monolith Phases

- `server/routes/webflow-seo-suggestions.ts` owns `/api/webflow/seo-suggestions/*`.
- `server/routes/webflow-seo-page-tools.ts` owns `/api/webflow/page-html/:siteId` and `/api/webflow/seo-copy`.
- `server/intelligence/page-elements-slice.ts` exports `assemblePageElements()` and `formatPageElementsSection()`.
- `server/workspace-intelligence.ts` remains the public API for `buildWorkspaceIntelligence()` and `formatForPrompt()`.

## Systemic Improvements

- Shared utilities: none extracted yet; this phase only moves existing route/slice boundaries.
- pr-check rules: no new rule in this phase. Existing route contract and background-generation checks remain active.
- Tests: add direct page-elements slice coverage and run existing route/intelligence tests.

## Verification Strategy

- [ ] `npm run typecheck`
- [ ] `npx vitest run tests/unit/page-elements-slice.test.ts tests/unit/workspace-intelligence.test.ts tests/unit/format-for-prompt.test.ts tests/integration/webflow-seo-writes.test.ts tests/integration/webflow-seo-bulk-slugless.test.ts --reporter=verbose`
- [ ] `npx tsx scripts/pr-check.ts`
- [ ] `npx vite build`
- [ ] `npx vitest run`
