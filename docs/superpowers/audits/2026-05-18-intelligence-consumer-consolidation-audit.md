# Intelligence Consumer Consolidation Audit

Date: `2026-05-18`  
Owner: `analytics-intelligence`

## Goal

Inventory every current server-side AI/recommendation consumer that pulls
workspace intelligence, direct insights, or direct workspace learnings into
prompt assembly. Classify each consumer as:

- `native` — already follows the intelligence facade cleanly
- `hybrid` — uses the intelligence facade but still mixes in bespoke context assembly
- `legacy` — still assembles workspace-derived prompt context outside the shared convention
- `documented-exception` — intentionally outside the shared convention with an inline rationale

This audit is the source of truth for PR1 guardrails and the follow-on migration
plans.

## Findings Summary

- `native`: 33
- `hybrid`: 0
- `legacy`: 0
- `documented-exception`: 0

Root pattern confirmed:

- low-level assembly is healthy
- the original consumer-layer drift has been migrated behind dedicated builders
- future work should focus on optional consolidation only where a builder reduces real duplication

## Exhaustive Findings

| File | Context owner | Class | Current pattern | Target path | Migration order |
|---|---|---|---|---|---|
| `server/aeo-page-review.ts` | `seo-health` | `native` | `buildIntelPrompt(['seoContext'])` for prompt context | keep low-level | completed in PR5 |
| `server/admin-chat-context.ts` | `analytics-intelligence` | `native` | dedicated admin chat intelligence builder owns canonical slice selection and formatted workspace/learnings blocks | chat builder | completed in follow-up builder PR |
| `server/blueprint-generator.ts` | `content-pipeline` | `native` | slice-backed intelligence + `formatForPrompt()` | `buildContentGenerationContext()` later if it reduces local boilerplate | wave 4 |
| `server/brand-identity.ts` | `brand-engine` | `native` | `buildIntelPrompt(['seoContext'])` | keep low-level | only revisit if multi-slice context needed |
| `server/brandscript.ts` | `brand-engine` | `native` | `buildIntelPrompt(['seoContext'])` | keep low-level | only revisit if multi-slice context needed |
| `server/content-brief.ts` | `content-pipeline` | `native` | shared `buildContentGenerationContext()` for seoContext, pageProfile, and formatted insights/learnings plus caller-owned evidence blocks | keep on content builder path | completed in wave 1 |
| `server/content-decay.ts` | `seo-health` | `native` | shared `buildRecommendationGenerationContext()` for prompt context plus caller-owned GSC query breakdown block | keep on recommendation builder path | completed in wave 1 |
| `server/content-posts-ai.ts` | `content-pipeline` | `native` | slice-backed voice context with aligned `slices` usage | `buildContentGenerationContext()` optional later | wave 4 |
| `server/copy-generation.ts` | `brand-engine` | `native` | workspace-intelligence-backed SEO context | keep low-level for now | later only if builder consolidation crosses brand-engine |
| `server/diagnostic-orchestrator.ts` | `analytics-intelligence` | `native` | diagnostic builder resolves anomaly insights, workspace intelligence, and page-scoped insight summaries | diagnostic builder | completed in follow-up builder PR |
| `server/discovery-ingestion.ts` | `workspace-command-center` | `native` | `buildIntelPrompt(['seoContext'])` | keep low-level | only revisit if richer slices are added |
| `server/internal-links.ts` | `seo-health` | `native` | slice-backed SEO context for AI internal-link suggestions | recommendation builder later if it broadens beyond seoContext | wave 4 |
| `server/keyword-recommendations.ts` | `seo-health` | `native` | shared `buildRecommendationGenerationContext()` for ranking context plus deterministic strategic-fit scoring hooks (declines, cannibalization, client signals) | keep on recommendation builder path | completed in wave 2 |
| `server/keyword-strategy-ai-synthesis.ts` | `analytics-intelligence` | `native` | rich slice-backed context with consistent `slices` usage | content/recommendation builder optional later | keep as reference implementation |
| `server/meeting-brief-generator.ts` | `analytics-intelligence` | `native` | intelligence facade only | keep low-level | only revisit if a dedicated briefing builder is introduced |
| `server/monthly-digest.ts` | `analytics-intelligence` | `native` | shared `buildRecommendationGenerationContext()` for insights/learnings-backed digest prompt enrichment | future digest/briefing builder | completed in PR5 |
| `server/page-analysis-job.ts` | `seo-health` | `native` | consistent slice-backed prompt assembly | recommendation builder later if it simplifies page job boilerplate | wave 4 |
| `server/routes/content-posts.ts` | `content-pipeline` | `native` | `buildIntelPrompt(['seoContext', 'learnings'])` for review flows | keep low-level | later only if raw slice access becomes necessary |
| `server/routes/google.ts` | `client-portal` | `native` | aligned slices + formatted block for client search chat | keep low-level | later only if shared client-story builder is added |
| `server/routes/public-analytics.ts` | `client-portal` | `native` | slice-backed intelligence for client advisor context | keep low-level | later only if client-story builder is added |
| `server/routes/rewrite-chat.ts` | `seo-health` | `native` | page-assist builder supplies canonical keyword/voice/page context; route owns conversation and page evidence | page-assist builder | completed in follow-up builder PR |
| `server/routes/webflow-keywords.ts` | `seo-health` | `native` | page-assist builder supplies canonical keyword/learnings/page context; route owns provider metric evidence | page-assist builder | completed in follow-up builder PR |
| `server/routes/webflow-seo-bulk-rewrite.ts` | `seo-health` | `native` | page-assist builder supplies per-page keyword/voice/profile context; route owns bulk GSC/sibling/content evidence | page-assist builder | completed in follow-up builder PR |
| `server/routes/webflow-seo-page-tools.ts` | `seo-health` | `native` | page-assist builder supplies canonical keyword/voice/page-map context; route owns copy-generation payload evidence | page-assist builder | completed in follow-up builder PR |
| `server/routes/webflow-seo-rewrite.ts` | `seo-health` | `native` | page-assist builder supplies canonical keyword/voice/profile/page-insight context; route owns GSC/audit/content evidence | page-assist builder | completed in follow-up builder PR |
| `server/routes/webflow-alt-text.ts` | `seo-health` | `native` | `buildIntelPrompt(['seoContext'])` for compact alt-text context plus caller-owned page/image placement snippets | keep low-level | completed in PR5 |
| `server/routes/workspaces.ts` | `workspace-command-center` | `native` | seoContext-backed AI helper path | keep low-level | revisit only if it needs multi-slice context |
| `server/seo-audit-ai-recs.ts` | `seo-health` | `native` | slice-backed workspace + page prompt assembly | recommendation builder optional later | wave 2 |
| `server/voice-calibration.ts` | `brand-engine` | `native` | `buildIntelPrompt(['seoContext'])` | keep low-level | only revisit if richer slices are added |
| `server/webflow-bulk-alt-background-job.ts` | `seo-health` | `native` | slice-backed SEO context inside extracted bulk alt background job | keep low-level for job-specific prompts | completed in simplification sprint phase 4 |
| `server/webflow-bulk-seo-fix-background-job.ts` | `seo-health` | `native` | slice-backed SEO context inside extracted bulk SEO fix background job | keep low-level for job-specific prompts | completed in simplification sprint phase 6 |
| `server/webflow-seo-bulk-analyze-job.ts` | `seo-health` | `native` | aligned slices + `formatForPrompt()` | keep low-level | wave 4 |
| `server/webflow-seo-bulk-rewrite-job.ts` | `seo-health` | `native` | page-assist builder supplies per-page keyword/voice/profile context inside the background job | page-assist builder | completed in follow-up builder PR |

## Immediate Migration Queue

No hybrid or legacy consumers remain in this audit inventory.

Optional future work:

- reporting/briefing builder if monthly digest and meeting briefs start sharing more prompt context
- low-level native caller consolidation only where a shared builder reduces meaningful duplication

## Notes

- `native` does not mean “must migrate.” It means the file already follows the
  low-level intelligence conventions well enough that PR1 should not disturb it.
- caller-owned evidence blocks remain valid and intentionally outside the shared
  builders for PR1
- the highest-value root fix is still the content/recommendation cluster, not a
  whole-repo migration
