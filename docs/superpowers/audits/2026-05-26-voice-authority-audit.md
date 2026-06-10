# Voice Authority Audit

Date: 2026-05-26  
Base: `origin/staging` at `2f0a936c`  
Owner: `brand-engine`  
Secondary integrations: `analytics-intelligence`, `seo-health`, `content-pipeline`

## Summary

This audit is the control artifact for the voice authority sprint. It classifies server-side AI consumers by how they receive workspace voice instructions.

- `correct`: 20
- `builder-backed`: 5
- `drift`: 0
- `documented-exception`: 17

Authority rules:

- `buildSystemPrompt()` owns calibrated voice DNA, guardrails, custom prompt notes, and universal prose quality rules.
- `seoContext.effectiveBrandVoiceBlock` owns prompt-safe workspace voice context for user/context blocks.
- Raw `brandVoice` is for editing, diagnostics, or non-prompt scoring only; it must not become prompt authority.
- Manual `VOICE DNA` / guardrail prompt blocks belong only in canonical brand-engine helpers that suppress them for calibrated profiles.

## Drift Migrated In PR 2

| File | Current issue | PR 2 target |
| --- | --- | --- |
| `server/anomaly-detection.ts` | Anomaly summaries used a hard-coded system prompt, so calibrated workspace voice/custom notes/prose rules did not apply. | Migrated to `buildSystemPrompt(workspaceId, ...)`. |
| `server/diagnostic-orchestrator.ts` | Diagnostic synthesis had builder-backed evidence but still used a hard-coded system prompt for admin/client summary generation. | Migrated to `buildSystemPrompt(workspaceId, ...)` while preserving JSON response format. |
| `server/routes/webflow-seo-page-tools.ts` | Page copy optimization included builder-backed voice context in the user prompt but used a hard-coded system prompt. | Migrated to `buildSystemPrompt(workspaceId, ...)`. |

## Documented Exceptions

These consumers intentionally do not use client brand voice as writing authority:

- Intent classifiers, chat memory summaries, schema/page extraction helpers, provider factual summaries, and workspace profile autofill use neutral structured or factual system prompts.
- Client advisor chat uses an agency/client-support persona rather than the client's website brand voice.
- Keyword/page analysis jobs that only classify keyword opportunities may consume business terms or page-assist context but should not imitate the client's writing voice.
- Workspace brand-voice generation itself analyzes the client's site to create legacy brand voice; applying the existing workspace voice to that generator would be circular.

## Inventory

| File | Classification | Authority path |
| --- | --- | --- |
| `server/aeo-page-review.ts` | builder-backed | Uses canonical intelligence prompt context. |
| `server/anomaly-detection.ts` | correct | Uses `buildSystemPrompt()` for anomaly summary generation. |
| `server/blueprint-generator.ts` | documented-exception | Generates page plans from discovery/strategy context, not client-facing prose. |
| `server/brand-identity.ts` | correct | Uses `buildSystemPrompt()` plus `buildVoiceCalibrationContext()`. |
| `server/brandscript.ts` | correct | Uses `buildSystemPrompt()` for brand strategy generation. |
| `server/briefing-prompt.ts` | correct | Instructions are passed through `buildSystemPrompt()` by callers. |
| `server/chat-memory.ts` | documented-exception | Neutral conversation summary, not client brand voice. |
| `server/content-brief.ts` | correct | Uses `buildSystemPrompt()` and shared content-generation context. |
| `server/content-decay.ts` | builder-backed | Uses recommendation-generation context; output is recommendation analysis. |
| `server/content-posts-ai.ts` | correct | Uses `buildSystemPrompt()` for creative/review/voice scoring paths. |
| `server/copy-generation.ts` | correct | Uses `buildSystemPrompt()` and `buildVoiceCalibrationContext()`. |
| `server/copy-intelligence.ts` | documented-exception | Classifies copy patterns/feedback, not final client prose. |
| `server/copy-refresh.ts` | documented-exception | Decides section refresh posture; it does not write client copy. |
| `server/copy-voice-feedback.ts` | correct | Voice-feedback operations are operation-backed and system-prompted. |
| `server/diagnostic-orchestrator.ts` | correct | Uses diagnostic builder evidence and `buildSystemPrompt()` for synthesis. |
| `server/discovery-ingestion.ts` | documented-exception | Extracts source evidence for brand engine; no existing brand voice should bias extraction. |
| `server/internal-links.ts` | correct | Uses `effectiveBrandVoiceBlock` and `buildSystemPrompt()`. |
| `server/keyword-recommendations.ts` | builder-backed | Uses recommendation context; raw voice appears only as business-fit text. |
| `server/keyword-strategy-ai-synthesis.ts` | correct | Wraps strategy messages with `buildSystemPrompt()`. |
| `server/llms-txt-generator.ts` | documented-exception | Factual web-content summarizer for AI-crawl metadata. |
| `server/meeting-brief-generator.ts` | correct | Uses `buildSystemPrompt()` with custom-note cache inputs. |
| `server/monthly-digest.ts` | correct | Uses `buildSystemPrompt()` and recommendation context. |
| `server/page-analysis-job.ts` | documented-exception | Keyword analysis JSON classifier, not voice-bearing prose. |
| `server/schema-plan.ts` | documented-exception | Structured schema planning output. |
| `server/schema/extractors/description.ts` | documented-exception | Short factual schema description extraction. |
| `server/schema/extractors/page-elements/howto-ai-fallback.ts` | documented-exception | Structured HowTo extraction fallback. |
| `server/seo-audit-ai-recs.ts` | correct | Uses `buildSystemPrompt()`. |
| `server/voice-calibration.ts` | correct | Canonical voice context helper and calibration calls. |
| `server/webflow-seo-bulk-analyze-job.ts` | documented-exception | Bulk keyword analysis JSON classifier. |
| `server/webflow-seo-bulk-rewrite-job.ts` | correct | Uses page-assist context and `buildSystemPrompt()`. |
| `server/workspace-context-generation-job.ts` | documented-exception | Generates source workspace context; brand voice generation is circular by design. |
| `server/routes/ai.ts` | documented-exception | Admin chat uses admin-chat persona/context, not client writing voice. |
| `server/routes/content-posts.ts` | correct | Uses `buildSystemPrompt()` for AI fix/rewrite paths. |
| `server/routes/content-publish.ts` | documented-exception | Field mapping helper, not client prose. |
| `server/routes/google.ts` | documented-exception | Google data chat/diagnostic helper, not client prose authority. |
| `server/webflow-bulk-seo-fix-background-job.ts` | correct | Bulk SEO fix background job uses `buildSystemPrompt()`. |
| `server/routes/public-analytics.ts` | documented-exception | Client advisor persona is agency-support voice, not the client's website brand voice. |
| `server/routes/rewrite-chat.ts` | builder-backed | Uses page-assist builder and `buildSystemPrompt()`. |
| `server/routes/webflow-keywords.ts` | builder-backed | Uses page-assist context for keyword analysis; no voice imitation needed. |
| `server/routes/webflow-seo-bulk-rewrite.ts` | correct | Uses page-assist context and `buildSystemPrompt()`. |
| `server/routes/webflow-seo-page-tools.ts` | correct | Uses page-assist context and `buildSystemPrompt()`. |
| `server/routes/webflow-seo-rewrite.ts` | correct | Uses page-assist context and `buildSystemPrompt()`. |
| `server/routes/workspaces.ts` | documented-exception | Intelligence profile autofill is structured business inference. |

## PR 3 Rule

No known voice-authority drift remains in the server AI consumer inventory. PR 3 should add fixture-driven quality/output contracts for the migrated behavior instead of broad consumer migration.
