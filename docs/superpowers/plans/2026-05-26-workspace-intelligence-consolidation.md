# Workspace Intelligence Consolidation Master Plan

## Summary

Primary owner: `analytics-intelligence`. Secondary integrations: `schema`, `content-pipeline`, `client-portal`, `seo-health`, `brand-engine`, and `outcomes-roi`.

Goal: make workspace intelligence the canonical, fresh, tested source of truth for AI context, admin/client intelligence reads, schema planning, content generation, and operational summaries.

Ship as one cleanup sprint with 5 phased PRs. PRs 1-3 are the minimum sprint target; PRs 4-5 follow after contract and slice correctness are stable. Every PR must include regression tests for the drift it fixes.

## Key Changes

### PR 1: Intelligence Contract + Guardrails

- Add one shared runtime slice registry in `shared/types/intelligence.ts`, derive `IntelligenceSlice` from it, and include metadata for option-scoped slices like `pageProfile`, `pageElements`, and `siteInventory`.
- Replace stale slice allow-lists in workspace intelligence facade, admin intelligence route, debug prompt route, MCP intelligence tool, and frontend API/hook types.
- Define `siteInventory` as schema/server-scoped unless the route/tool can supply `siteId` and `siteBaseUrl`; do not let it appear as silently promptable.
- Update `docs/rules/workspace-intelligence.md` to reflect current slices, option requirements, cache key dimensions, and prompt formatter support.

### PR 2: Freshness + Invalidation

- Fix backend cache invalidation for content pipeline, copy pipeline, recommendations, briefing publish, Local SEO updates, and other intelligence-backed mutations found during the audit.
- Ensure each workspace-scoped mutation has both halves of the feedback loop: `broadcastToWorkspace()` and React Query invalidation through workspace events.
- Standardize use of existing `WS_EVENTS` constants; add new events only where no existing event accurately describes the mutation.

### PR 3: Slice Correctness

- Fix lossy or misleading calculations: insights aggregate before cap, page-specific insights from full data, content request buckets, published post lifecycle, Local SEO per-market coverage, client engagement activity coverage, approval rate including `applied`, site-health dead-link fallback, and CWV naming/calculation.
- Standardize duplicate bucket semantics, especially work orders and content request statuses.
- Keep this PR focused on slice assembly semantics, not consumer prompt migrations.

### PR 4: Schema + Site Inventory Consolidation

- Route schema planning through resolved `seoContext.strategy`, not raw `ws.keywordStrategy`.
- Add a schema intelligence wrapper that resolves workspace/site identity once and calls `buildWorkspaceIntelligence()` with the needed schema slices and options.
- Either wire `buildSchemaIntelligenceBlock()` into schema generation or remove/deprecate dead context fields.
- Fix backlink enrichment by passing `enrichWithBacklinks: true` only where backlink data is actually consumed.
- Consolidate page element freshness so schema generation and intelligence reads do not diverge.

### PR 5: AI Consumer Migration

- Migrate monthly digest, admin chat, content brief generation, voice calibration, AEO review, and alt-text paths away from one-off context assembly.
- Use canonical builders: `buildContentGenerationContext`, `buildRecommendationGenerationContext`, `buildIntelPrompt`, or a dedicated builder when needed.
- Remove duplicate SEO/business/voice/learnings prompt blocks where `promptContext` already carries the same data.
- Preserve caller-owned add-ons only for workflow-specific evidence: SERP excerpts, references, scraped page text, template constraints, or provider breakdowns.
- Ensure voice/brand consumers use `buildSystemPrompt()` or a documented complete voice block helper.

## Testing Strategy

Testing is part of implementation, not closeout. Each PR should include failing or regression tests before or alongside the fix.

### PR 1 Tests

- Registry parity test: shared registry equals facade defaults, route allow-lists, debug route allow-list, MCP allow-list, and formatter-supported sections.
- Route tests for valid newer slices like `localSeo` and `pageElements`.
- Tests for invalid/all-invalid slice behavior so requests do not silently assemble all data.
- Documentation/contract test for option-scoped slices and `siteInventory` exception.

### PR 2 Tests

- Mutation/read-path tests proving stale intelligence is invalidated after content, copy, recommendation, briefing, and Local SEO changes.
- WebSocket invalidation tests proving admin/client query keys refresh when relevant events fire.
- Cache tests proving `content_pipeline_cache` and workspace intelligence cache cannot serve stale summaries after mutation.

### PR 3 Tests

- Slice fixture tests for `insights`, `contentPipeline`, `siteHealth`, `clientSignals`, `localSeo`, and `learnings`.
- Edge-case tests for top-100 insight capping, page-specific insight filtering, content request status buckets, multi-market Local SEO coverage, `applied` approvals, and CWV/dead-link fallbacks.
- Actual client read-path tests for fields surfaced through `/api/public/intelligence/:workspaceId`.

### PR 4 Tests

- Schema plan route test proving page-map data comes from resolved `seoContext.strategy`.
- Schema generation/context tests for site inventory option handling, page elements freshness, backlink enrichment, and dead schema enrichment behavior.
- Contract test preventing raw `ws.keywordStrategy` from being reintroduced into schema planning.

### PR 5 Tests

- Prompt/context contract tests for admin chat, monthly digest, content brief generation, schema, voice calibration, AEO review, and alt text.
- Assertions that canonical context appears once, brand/voice/learnings blocks are not duplicated, and voice authority is preserved.
- Strengthen the intelligence consumer inventory guard so new AI/recommendation consumers must be classified as native, hybrid, legacy, or documented exception.

Full gates for every PR:

- `npm run typecheck`
- `npx vite build`
- `npx vitest run`
- `npx tsx scripts/pr-check.ts`

## Coordination

- Active platform: Codex/OpenAI.
- Use `GPT-5.4` for bounded implementation PRs and `GPT-5.5` for PR 1 design, PR 4 schema consolidation, PR 5 prompt-sensitive migrations, and final review.
- Pre-commit shared contracts before parallel agent dispatch.
- Assign exclusive file ownership per agent.
- Run diff review after every parallel batch.
- Shared files such as `shared/types/intelligence.ts`, `server/workspace-intelligence.ts`, `server/ws-events.ts`, and `src/lib/queryKeys.ts` are sequential-only.

## Assumptions

- This is platform health/refactor work, not a new product feature.
- `FEATURE_AUDIT.md` changes only if a PR creates a user-visible shipped capability.
- `data/roadmap.json` changes only if this sprint is added as an explicit roadmap item.
- `BRAND_DESIGN_LANGUAGE.md` should not change unless a PR touches UI patterns or colors.
- No phase should merge unless its tests prove the actual consumer/read path, not only a nearby helper.
