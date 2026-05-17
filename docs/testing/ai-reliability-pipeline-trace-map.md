# AI Reliability Pipeline Trace Map

This is the Wave 4 trace and reliability map for `platform-reliability-ai-evals`.

Use this map with:

- `scripts/ai-reliability-registry.ts`
- `scripts/report-ai-reliability.ts`
- `scripts/report-ai-pipeline-wiring.ts`
- `tests/contract/ai-pipeline-trace-map.test.ts`
- `tests/unit/ai-reliability-harness.test.ts`
- `tests/integration/ai-critical-domain-reliability.test.ts`

## Critical Pipelines

| Pipeline | Owning Context | Entry Routes | Prompt/Dispatch Path | Write Side Effects | Events + Invalidations | Reliability Signals |
| --- | --- | --- | --- | --- | --- | --- |
| `schema-generation-review` | `schema` | `server/routes/webflow-schema.ts` | `helpers.ts` + `prompt-assembly.ts` -> `schema-plan.ts` -> `callAI` | `saveSchemaPlan`, `addActivity`, `broadcastToWorkspace` | `WS_EVENTS.SCHEMA_PLAN_SENT`, `WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED`; schema/client review query keys | `tests/integration/schema-plan-public-routes.test.ts`, `tests/unit/schema-validation-pipeline.test.ts` |
| `content-brief-review` | `content-pipeline` | `server/routes/content-briefs.ts`, `content-posts.ts` | `content-brief.ts` + `prompt-assembly.ts` -> `callAI` | `saveBrief`, `savePost`, `addActivity`, `broadcastToWorkspace` | `WS_EVENTS.CONTENT_UPDATED`, `WS_EVENTS.CONTENT_REQUEST_UPDATE`; brief/post/content-plan query keys | `tests/integration/content-posts-ai-fix.test.ts`, `tests/integration/content-posts-workflow.test.ts` |
| `seo-editor-assist` | `seo-health` | `server/routes/rewrite-chat.ts`, `webflow-seo-page-tools.ts`, `webflow-seo-apply.ts` | `prompt-assembly.ts` + intelligence context -> `callAI` | page SEO writes, `addActivity`, `broadcastToWorkspace` | `WS_EVENTS.PAGE_STATE_UPDATED`, `WS_EVENTS.STRATEGY_UPDATED`; seo editor/strategy/workspace-home invalidations | `tests/integration/rewrite-chat-pages.test.ts`, `tests/contract/external-provider-write-failure-contract.test.ts` |
| `client-decision-support` | `client-portal` | `server/routes/public-analytics.ts`, `client-actions.ts` | intelligence + prompt assembly -> `callAI` | client action updates, `addActivity`, `broadcastToWorkspace` | `WS_EVENTS.CLIENT_ACTION_UPDATE`, `WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED`; client/admin action and intelligence keys | `tests/integration/client-actions-routes.test.ts`, `tests/integration/client-actions-broadcasts.test.ts` |
| `diagnostic-synthesis` | `platform-foundation` | `server/routes/jobs.ts`, `diagnostic-orchestrator.ts` | orchestrator synthesis -> `callAI` | `completeDiagnosticReport`, `addActivity`, job state updates, broadcast | `WS_EVENTS.DIAGNOSTIC_COMPLETE`, `WS_EVENTS.DIAGNOSTIC_FAILED`; diagnostics + insight-feed invalidation | `tests/integration/deep-diagnostic-jobs.test.ts`, `tests/integration/deep-diagnostic-mutation-safety.test.ts` |
| `admin-insights-chat` | `platform-foundation` | `server/routes/ai.ts` | `assembleAdminContext` + `buildSystemPrompt` -> `callAI` | chat-memory writes, optional `addActivity`, session summarization | no direct workspace broadcast; admin read paths rely on API pulls | `tests/unit/admin-chat-question-routing.test.ts`, `tests/unit/chat-context-insights.test.ts`, `tests/unit/ai-dispatch.test.ts` |
| `client-search-chat` | `client-portal` | `server/routes/public-analytics.ts`, `public-chat.ts` | chat prompt + intent classification -> `callAI` | chat-memory writes, optional `createClientSignal`, `addActivity` | `WS_EVENTS.CLIENT_SIGNAL_CREATED`; intelligence/client-signal read-model invalidations | `tests/integration/public-analytics.test.ts`, `tests/integration/public-chat-routes.test.ts`, `tests/integration/client-signals-routes.test.ts` |
| `brand-voice-provenance` | `brand-engine` | `server/routes/brand-identity.ts`, `voice-calibration.ts`, `content-posts.ts` | voice/profile context + factual guardrails -> `callAI` | brand/voice/content writes, `addActivity`, broadcasts | `WS_EVENTS.BRAND_IDENTITY_UPDATED`, `WS_EVENTS.VOICE_PROFILE_UPDATED`, `WS_EVENTS.POST_UPDATED`; brand/post query keys | `tests/integration/brand-identity-hardening.test.ts`, `tests/integration/voice-calibration-hardening.test.ts`, `tests/contract/factual-ai-output-contracts.test.ts` |

## Failure Classes In Scope

- `invalid_output`
- `timeout`
- `provider_error`
- `state_transition`
- `side_effect_hygiene`
- `provenance`

## CI Soft Gate

`scripts/report-ai-reliability.ts --soft-gate` behavior:

- **Fail**: registry/trace hard gaps or hard-scenario failures.
- **Warn**: quality regression (threshold drop) without blocking merge.
