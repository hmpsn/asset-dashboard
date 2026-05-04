# Platform Consolidation Monolith Pre-Plan Audit

Branch: `codex/platform-consolidation-monoliths`
Base: `origin/staging` at `9f9bbaa3`
Date: 2026-05-04

## Summary

The monolith track remains valid after the Phase 1 background-generation PR merged to staging. The highest-value targets are still large route/component files, but the safest first PR should avoid the most entangled orchestration cores and extract behavior-preserving boundaries that already exist.

## Findings

| Area | Current size | Boundary findings | First safe action |
| --- | ---: | --- | --- |
| `server/routes/webflow-seo.ts` | 1,910 lines before split | Audit, rewrite, legacy bulk, suggestions, page HTML/copy tools, and job-backed bulk endpoints live together. | Extract SEO suggestions and page utility routes; leave background job endpoints in place. |
| `server/routes/keyword-strategy.ts` | 2,755 lines | Helper exports, giant SSE generation route, read/diff/patch, feedback, and signals are combined. | Later: extract helper exports and feedback routes before touching generation orchestration. |
| `server/workspace-intelligence.ts` | 3,027 lines before split | Orchestrator, slice assemblers, prompt formatters, cache helpers, page profile, and page elements are combined. | Extract `pageElements` slice first because it is read-only and page-scoped. |
| `src/components/client/StrategyTab.tsx` | 2,157 lines | Keyword feedback, priorities, tracked keywords, content gaps, drawers, focus trap, and CTAs are intertwined. | Later: split with hook-first strategy, preserving drawer/focus behavior. |
| `src/components/brand/VoiceTab.tsx` | 1,165 lines | Internal section components already exist in one file. | Good low-risk frontend split candidate after backend route slice. |

## First PR Scope

This PR starts with low-risk backend decomposition:

- `webflow-seo` suggestions routes move to `server/routes/webflow-seo-suggestions.ts`.
- `webflow-seo` page HTML and SEO copy routes move to `server/routes/webflow-seo-page-tools.ts`.
- `pageElements` intelligence assembler/formatter moves to `server/intelligence/page-elements-slice.ts`.

## Out Of Scope

- Keyword strategy generation migration to background jobs.
- Webflow SEO background job rewrite.
- StrategyTab render/focus-trap refactor.
- Workspace intelligence full slice directory split.
- VoiceTab frontend component split.

## Verification

- `npm run typecheck`
- `npx vitest run tests/unit/page-elements-slice.test.ts tests/unit/workspace-intelligence.test.ts tests/unit/format-for-prompt.test.ts tests/integration/webflow-seo-writes.test.ts tests/integration/webflow-seo-bulk-slugless.test.ts --reporter=verbose`
- `npx tsx scripts/pr-check.ts`
- `npx vite build`
- Full `npx vitest run` before PR handoff.
