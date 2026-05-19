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

This audit is the source of truth for PR1 guardrails and the follow-on migration
plans.

## Findings Summary

- `native`: 27
- `hybrid`: 3
- `legacy`: 2

Root pattern confirmed:

- low-level assembly is healthy
- the remaining drift is almost entirely at the consumer layer
- content/recommendation workflows are the main hybrid/legacy cluster

## Exhaustive Findings

| File | Context owner | Class | Current pattern | Target path | Migration order |
|---|---|---|---|---|---|
| `server/aeo-page-review.ts` | `seo-health` | `native` | `buildWorkspaceIntelligence({ slices: ['seoContext'] })` for prompt context | keep low-level | later only if shared builder adds AEO-specific defaults |
| `server/admin-chat-context.ts` | `analytics-intelligence` | `hybrid` | mixed slice assembly plus direct `getInsights()` / `formatLearningsForPrompt()` shaping | dedicated chat builder later, not PR1 | wave 3 |
| `server/blueprint-generator.ts` | `content-pipeline` | `native` | slice-backed intelligence + `formatForPrompt()` | `buildContentGenerationContext()` later if it reduces local boilerplate | wave 4 |
| `server/brand-identity.ts` | `brand-engine` | `native` | `buildIntelPrompt(['seoContext'])` | keep low-level | only revisit if multi-slice context needed |
| `server/brandscript.ts` | `brand-engine` | `native` | `buildIntelPrompt(['seoContext'])` | keep low-level | only revisit if multi-slice context needed |
| `server/content-brief.ts` | `content-pipeline` | `native` | shared `buildContentGenerationContext()` for seoContext, pageProfile, and formatted insights/learnings plus caller-owned evidence blocks | keep on content builder path | completed in wave 1 |
| `server/content-decay.ts` | `seo-health` | `native` | shared `buildRecommendationGenerationContext()` for prompt context plus caller-owned GSC query breakdown block | keep on recommendation builder path | completed in wave 1 |
| `server/content-posts-ai.ts` | `content-pipeline` | `native` | slice-backed voice context with aligned `slices` usage | `buildContentGenerationContext()` optional later | wave 4 |
| `server/copy-generation.ts` | `brand-engine` | `native` | workspace-intelligence-backed SEO context | keep low-level for now | later only if builder consolidation crosses brand-engine |
| `server/diagnostic-orchestrator.ts` | `analytics-intelligence` | `hybrid` | broad intelligence assembly plus direct `getInsights()` synthesis context | future diagnostics/chat-style builder, not PR1 | wave 3 |
| `server/discovery-ingestion.ts` | `workspace-command-center` | `native` | `buildIntelPrompt(['seoContext'])` | keep low-level | only revisit if richer slices are added |
| `server/internal-links.ts` | `seo-health` | `native` | slice-backed SEO context for AI internal-link suggestions | recommendation builder later if it broadens beyond seoContext | wave 4 |
| `server/keyword-recommendations.ts` | `seo-health` | `hybrid` | direct `getWorkspaceLearnings()` weighting plus slice-backed ranking prompt | `buildRecommendationGenerationContext()` + separate scoring hooks | wave 2 |
| `server/keyword-strategy-ai-synthesis.ts` | `analytics-intelligence` | `native` | rich slice-backed context with consistent `slices` usage | content/recommendation builder optional later | keep as reference implementation |
| `server/meeting-brief-generator.ts` | `analytics-intelligence` | `native` | intelligence facade only | keep low-level | only revisit if a dedicated briefing builder is introduced |
| `server/monthly-digest.ts` | `analytics-intelligence` | `legacy` | direct `getInsights()` + direct `getWorkspaceLearnings()` prompt enrichment | future digest/briefing builder | wave 3 |
| `server/page-analysis-job.ts` | `seo-health` | `native` | consistent slice-backed prompt assembly | recommendation builder later if it simplifies page job boilerplate | wave 4 |
| `server/routes/content-briefs.ts` | `content-pipeline` | `legacy` | route-level direct `getWorkspaceLearnings()` enrichment around brief generation | move learnings/context orchestration into shared builder path | wave 1 |
| `server/routes/content-posts.ts` | `content-pipeline` | `native` | `buildIntelPrompt(['seoContext', 'learnings'])` for review flows | keep low-level | later only if raw slice access becomes necessary |
| `server/routes/google.ts` | `client-portal` | `native` | aligned slices + formatted block for client search chat | keep low-level | later only if shared client-story builder is added |
| `server/routes/jobs.ts` | `seo-health` | `native` | slice-backed SEO context inside bulk AI jobs | keep low-level for job-specific prompts | wave 4 |
| `server/routes/public-analytics.ts` | `client-portal` | `native` | slice-backed intelligence for client advisor context | keep low-level | later only if client-story builder is added |
| `server/routes/rewrite-chat.ts` | `seo-health` | `native` | slice-backed page/SEO context with caller-owned rewrite add-ons | future page-assist builder | wave 4 |
| `server/routes/webflow-keywords.ts` | `seo-health` | `native` | page-scoped slice-backed keyword context | keep low-level | later only if page-assist builder is standardized |
| `server/routes/webflow-seo-bulk-rewrite.ts` | `seo-health` | `native` | workspace seoContext + per-page pageProfile slices | keep low-level | wave 4 |
| `server/routes/webflow-seo-page-tools.ts` | `seo-health` | `native` | slice-backed page-scoped SEO assist context | future page-assist builder | wave 4 |
| `server/routes/webflow-seo-rewrite.ts` | `seo-health` | `native` | workspace seoContext + per-page pageProfile slices | keep low-level | wave 4 |
| `server/routes/workspaces.ts` | `workspace-command-center` | `native` | seoContext-backed AI helper path | keep low-level | revisit only if it needs multi-slice context |
| `server/seo-audit-ai-recs.ts` | `seo-health` | `native` | slice-backed workspace + page prompt assembly | recommendation builder optional later | wave 2 |
| `server/voice-calibration.ts` | `brand-engine` | `native` | `buildIntelPrompt(['seoContext'])` | keep low-level | only revisit if richer slices are added |
| `server/webflow-seo-bulk-analyze-job.ts` | `seo-health` | `native` | aligned slices + `formatForPrompt()` | keep low-level | wave 4 |
| `server/webflow-seo-bulk-rewrite-job.ts` | `seo-health` | `native` | slice-backed SEO context in job worker | keep low-level | wave 4 |

## Immediate Migration Queue

Wave 1:

- `server/routes/content-briefs.ts`

Wave 2:

- `server/keyword-recommendations.ts`
- `server/seo-audit-ai-recs.ts`

Wave 3:

- `server/admin-chat-context.ts`
- `server/monthly-digest.ts`

Wave 4:

- page-scoped SEO assist consolidation
- bulk SEO job prompt consolidation
- optional migration of already-healthy native callers where shared builders reduce duplication

## Notes

- `native` does not mean “must migrate.” It means the file already follows the
  low-level intelligence conventions well enough that PR1 should not disturb it.
- caller-owned evidence blocks remain valid and intentionally outside the shared
  builders for PR1
- the highest-value root fix is still the content/recommendation cluster, not a
  whole-repo migration
