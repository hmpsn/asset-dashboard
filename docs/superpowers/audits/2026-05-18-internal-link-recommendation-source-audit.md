# Internal Link Recommendation Source Audit (2026-05-18)

Roadmap item: `#631`  
Scope: inventory internal-link recommendation producers/consumers, identify contract drift, and recommend canonical source ownership before model cleanup work in `#632`.

## Executive Summary

Internal-link recommendations currently come from multiple subsystems with different payload shapes and intent:

1. Scanner recommendations for direct implementation/review (`fromPage`, `fromTitle`, `toPage`, `toTitle`, `anchorText`, `reason`, `priority`)
2. SEO copy helper suggestions (`targetPath`, `anchorText`, `context`)
3. Content brief suggestions (`string[]` slugs)
4. Client-action review payload (`anchorText`, `targetUrl`, `targetTitle?`, `sourcePage?`, `contextSnippet?`)

This is functional, but contract drift exists across generation, storage, and client review presentation. The highest-impact drift is in client review payloads where source title is not preserved and `targetUrl` may carry a path slug.

## Producer / Consumer Inventory

## Primary producers

1. Internal link scanner (canonical actionable source)
- Producer: `server/internal-links.ts`
- Contract schema: `server/schemas/internal-links-schemas.ts`
- Shape: `fromPage`, `fromTitle`, `toPage`, `toTitle`, `anchorText`, `reason`, `priority`
- Usage: operational recommendations and admin review/send flow.

2. SEO copy generation helper suggestions
- Producer: `server/routes/webflow-seo-page-tools.ts`
- Shape: `internalLinkSuggestions[]` with `targetPath`, `anchorText`, `context`
- Usage: copy assistance and page optimization guidance.

3. Content brief link suggestions
- Producer: `server/content-brief.ts`
- Shared type: `shared/types/content.ts` (`internalLinkSuggestions: string[]`)
- Usage: brief guidance and post-generation context.

## Bridge / transport producers

1. Admin “Send to Client” mapper for internal links
- Producer: `src/components/InternalLinks.tsx`
- Maps scanner rows into client action payload:
  - `targetUrl <- toPage`
  - `targetTitle <- toTitle`
  - `sourcePage <- fromPage`
  - `contextSnippet <- reason`
- Source type: `internal_link`.

## Key consumers

1. Client action shared payload contract
- `shared/types/client-actions.ts`
- `InternalLinkItem`: `anchorText`, `targetUrl`, `targetTitle?`, `sourcePage?`, `contextSnippet?`

2. Client review UIs
- `src/components/client/DecisionDetailModal.tsx`
- `src/components/client/ClientActionDetailModal.tsx`
- Display model currently emphasizes anchor/target/source path context.

3. Content consumers
- `server/content-posts-ai.ts` uses brief link suggestions as writing constraints.
- `src/components/briefs/BriefDetail.tsx` and `src/components/client/ContentTab.tsx` render brief suggestions.

## Drift Findings

1. **Shape fragmentation**
- Scanner, SEO copy, and brief suggestions all use different contracts.
- No single normalized recommendation type shared across producers.

2. **Source-title loss in client review payload**
- Scanner provides `fromTitle`.
- Client action payload currently keeps `sourcePage` path but not `sourceTitle`.
- This causes ambiguous review context for non-obvious slugs.

3. **Target field semantic mismatch**
- Client payload field name is `targetUrl`, but sender often passes a path slug.
- UI labels “Target URL” while rendering `targetTitle || targetUrl`, which can blur path vs title semantics.

4. **Different product intents sharing naming**
- SEO copy and brief suggestions are assistive writing hints, not equivalent to scanner-level implementation recommendations.
- Contract naming does not clearly encode this distinction today.

## Canonical Ownership Recommendation

For actionable internal-link recommendation review/approval flows, the canonical source should remain the scanner contract from `server/internal-links.ts` (`from*`, `to*`, anchor, rationale, priority). Other link-suggestion producers should be treated as advisory surfaces and mapped explicitly if they ever feed approval/review workflows.

## Follow-on Implementation Queue (points to `#632`)

1. Introduce a single normalized typed model for internal-link review payloads that preserves:
- Source path
- Source title
- Target path
- Target title
- Optional absolute target URL (derived when domain known)
- Anchor text and rationale/context

2. Update client action payload/serializers and modal renderers to use that model without overloading URL vs title fields.

3. Keep scanner as canonical actionable producer; if SEO copy/brief suggestions enter inbox flows, add explicit adapter functions with intent-specific provenance fields.

