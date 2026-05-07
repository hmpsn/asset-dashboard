# Server-Side Page-Join Assembler Audit

Date: 2026-05-04
Roadmap item: `#594`
Scope: audit only. No server-side assembler is implemented in this PR.

## Summary

The platform already has the client-side join that solved the admin UI drift:

- `src/hooks/admin/usePageJoin.ts` joins Webflow pages with keyword strategy rows.
- `src/lib/pathUtils.ts` and `server/helpers.ts` share the normalized path matching primitives.
- `scripts/pr-check.ts` blocks new inline `pageMap.find()` pairing in `src/`.

A server-side assembler is still worth considering, but only for read paths that need the same resolved page identity across multiple backend consumers. The audit found three good candidates and two areas that should stay out of a generic assembler for now.

## Candidate Surfaces

| Surface | Current Shape | Recommendation |
| --- | --- | --- |
| Webflow page + `page_keywords` | Admin UI uses `usePageJoin`; backend routes read `page_keywords` through `server/page-keywords.ts` and match pages with helpers. | Do not duplicate the client hook yet. Create a server assembler only when at least two backend endpoints need the exact `UnifiedPage` response shape. |
| Workspace intelligence SEO context | `server/workspace-intelligence.ts` already assembles page keyword context and powers AI prompts. | Keep using intelligence slices for AI/schema/prompt consumers. A separate page assembler should not bypass slice authority. |
| Schema plan and schema generation | `server/schema-plan.ts` uses `resolvePagePath()` and `findPageMapEntryForPage()` to connect page roles and keyword strategy. | Good future assembler consumer if schema routes start needing richer page metadata plus keywords plus validation state. |
| Public/client analytics pages | Client surfaces combine strategy data, analytics rows, insight cards, annotations, and recommendations. | Strongest future candidate: a read-only `PagePerformanceProfile` assembler could normalize page identity once and feed client digest/detail routes. |
| Content pipeline ROI/work requests | `server/roi.ts`, content request routes, and client strategy views relate content work to target pages via `targetPageId`/`targetPageSlug`. | Candidate only after target-page identity is normalized. Do not force content work into the page-keyword assembler prematurely. |

## Non-Candidates

- One-off AI prompt enrichment should keep using `buildWorkspaceIntelligence({ slices: [...] })`.
- Frontend admin page lists should keep using `usePageJoin(workspaceId, siteId)` until a server endpoint has a concrete second consumer.
- Webflow API write flows should keep their local page object shape; they need API IDs, not a broad platform page profile.

## Proposed Future Contract

If a server assembler is added later, make it read-only and explicit:

```ts
interface ServerPageProfile {
  workspaceId: string;
  pageId?: string;
  path: string;
  title?: string;
  source: 'webflow-static' | 'webflow-cms' | 'strategy-only' | 'analytics-only';
  strategy?: PageKeywordMap;
  analytics?: {
    clicks?: number;
    impressions?: number;
    sessions?: number;
    conversions?: number;
  };
}
```

Recommended file if/when implemented: `server/page-profile-assembler.ts`.

The assembler should:

- Use `resolvePagePath()` and `findPageMapEntryForPage()` from `server/helpers.ts`.
- Read page keywords through `server/page-keywords.ts`.
- Treat analytics joins as optional enrichment with explicit fallbacks.
- Return normalized paths only; never emit bare slug-derived paths.
- Stay independent from mutation routes so it cannot hide missing broadcasts or activity logs.

## Acceptance Criteria For A Future Implementation PR

- At least two real server consumers migrate in the same PR.
- Contract type lives in `shared/types/` if returned to frontend.
- Integration tests cover nested Webflow paths, legacy `/${slug}` keyword rows, strategy-only pages, and analytics-only pages.
- Any public endpoint using the assembler is tested through the public read path, not just an admin helper.
- `scripts/pr-check.ts` remains the guardrail for ad hoc pageMap pairing.

## Current Decision

Do not build the server assembler yet. The next practical move is a narrow design PR once a concrete endpoint needs page + keyword + analytics in a single backend response. For now, the existing client hook plus shared path helpers are the correct authority.
