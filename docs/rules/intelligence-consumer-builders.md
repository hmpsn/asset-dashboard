# Intelligence Consumer Builders

Use this rule for server-side AI/recommendation paths that consume workspace intelligence.

## Purpose

The platform already standardizes low-level intelligence assembly through:

- `buildWorkspaceIntelligence(workspaceId, { slices })`
- `buildIntelPrompt(workspaceId, slices, opts)`
- `formatForPrompt(intel, { sections: slices, ... })`

The remaining failure mode is consumer drift: individual generators mix direct
`getInsights()` / `getWorkspaceLearnings()` blocks, bespoke formatter calls, and
slice reads in different ways. This document defines the allowed consumption
patterns so new code does not reintroduce hand-rolled context assembly.

Primary owner: `analytics-intelligence`  
Secondary integrations: `content-pipeline`, `seo-health`, `outcomes-roi`, `brand-engine`

## Allowed Patterns

### 1. `buildIntelPrompt(...)`

Use this when a caller only needs a formatted intelligence block and does not
need raw slice access.

Example use cases:

- inject workspace SEO context into a single AI prompt
- build a client-safe intelligence block for chat/advisor flows

## 2. Shared generation context builders

Use `server/intelligence/generation-context-builders.ts` when a caller needs
both:

- the raw assembled `WorkspaceIntelligence` object
- the formatted prompt-safe intelligence block

Current builders:

- `buildContentGenerationContext(workspaceId, opts?)`
- `buildRecommendationGenerationContext(workspaceId, opts?)`
- `buildAdminChatIntelligenceContext(workspaceId, question, categories)`
- `buildDiagnosticIntelligenceContext(workspaceId, opts?)`
- `buildPageAssistContext(workspaceId, opts?)`

Each builder is responsible for:

- declaring canonical default slices
- threading `pagePath`
- threading `learningsDomain`
- keeping one `slices` source of truth for assembly and formatting

Admin chat and diagnostics use the chat/diagnostic builders so conversation
surfaces do not own their own canonical slice selection. Page-assist SEO tools
use `buildPageAssistContext()` for keyword, voice, personas, knowledge, page
profile, page element, local SEO, learnings, and page-insight prompt blocks.
Route-owned add-ons such as scraped page content, GSC query excerpts, selected
text, Webflow write targets, and user rewrite instructions remain outside the
builder.

## 3. Caller-owned add-on blocks

Callers may still append context that does not belong in intelligence slices.
These blocks stay caller-owned and are intentionally out of scope for the shared
builders in PR1.

Allowed examples:

- scraped reference URLs and excerpts
- live SERP result summaries
- style examples
- per-page GSC query breakdowns
- template-specific constraints

These are evidence or workflow-specific enrichments, not universal workspace
intelligence.

## Disallowed Drift

Avoid introducing new high-value AI/recommendation consumers that:

- call `getInsights()` only to build prompt context that belongs in the `insights` slice
- call `getWorkspaceLearnings()` / `formatLearningsForPrompt()` directly for prompt assembly when a shared builder or `buildIntelPrompt()` can supply the same data
- mix `buildWorkspaceIntelligence()` with separate direct prompt blocks for workspace-derived data without documenting why the data is not yet slice-backed

## Exception Rule

If the required signal is not yet available from the right intelligence slice:

1. keep the exception local to the caller
2. add an inline comment explaining why the direct read is still needed
3. document the follow-up in roadmap/PR notes instead of silently normalizing the exception

Do not widen the shared builder API with ad hoc direct workspace reads.

## Enforcement Status

`pr-check` now enforces this contract for builder-enforced server AI/
recommendation consumers. Direct calls to `getInsights()`,
`getWorkspaceLearnings()`, or `formatLearningsForPrompt()` in those consumers
are blocked unless a documented `// intel-builder-ok` exception is present.

Scope is intentionally narrow to high-value consumer paths so we catch real
prompt-assembly drift without flagging store-layer or deterministic analytics
usage.
