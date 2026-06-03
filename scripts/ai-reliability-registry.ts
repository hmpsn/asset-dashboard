import {
  AI_CRITICAL_PIPELINE_IDS,
  AI_QUALITY_PIPELINE_IDS,
  type AiCriticalPipelineId,
  type AiPipelineTraceDefinition,
  type AiQualityFixture,
  type AiQualityPipelineId,
  type AiReliabilityScenario,
  type AiReliabilityThresholds,
} from '../shared/types/ai-reliability.js';

export const AI_RELIABILITY_THRESHOLDS: AiReliabilityThresholds = {
  minDomainScore: 90,
  minOverallScore: 90,
  maxRegressionDrop: 5,
};

export const AI_RELIABILITY_BASELINE_OVERALL_SCORE = 90;

export const AI_CRITICAL_PIPELINE_TRACES: AiPipelineTraceDefinition[] = [
  {
    id: 'schema-generation-review',
    title: 'Schema Generation + Client Review',
    owningContext: 'schema',
    secondaryContexts: ['client-portal', 'platform-foundation'],
    entryRoutes: [
      'server/routes/webflow-schema.ts',
      'server/routes/public-portal.ts',
      'server/routes/content-plan-review.ts',
    ],
    promptAssemblyModules: [
      'server/helpers.ts',
      'server/prompt-assembly.ts',
      'server/schema-plan.ts',
    ],
    dispatcherModules: [
      'server/ai.ts',
      'server/schema-plan.ts',
      'server/schema/extractors/description.ts',
    ],
    parserOrValidationSignals: [
      'validateForGoogleRichResults',
      'validateLeanSchema',
      'schemaPlanFeedbackSchema',
    ],
    writeSideEffects: [
      'saveSchemaPlan',
      'addActivity',
      'broadcastToWorkspace',
    ],
    wsEvents: [
      'SCHEMA_PLAN_SENT',
      'SCHEMA_SNAPSHOT_UPDATED',
    ],
    queryInvalidationTargets: [
      'queryKeys.admin.schemaSnapshot',
      'queryKeys.client.schemaPlan',
    ],
    existingTestSignals: [
      'tests/integration/schema-plan-public-routes.test.ts',
      'tests/unit/schema-validation-pipeline.test.ts',
      'tests/contract/schema-snapshot-invalidation.test.ts',
    ],
  },
  {
    id: 'content-brief-review',
    title: 'Content Brief + Post Review Generation',
    owningContext: 'content-pipeline',
    secondaryContexts: ['client-portal', 'inbox', 'platform-foundation'],
    entryRoutes: [
      'server/routes/content-briefs.ts',
      'server/routes/content-posts.ts',
      'server/routes/content-plan-review.ts',
    ],
    promptAssemblyModules: [
      'server/content-brief.ts',
      'server/prompt-assembly.ts',
      'server/workspace-intelligence.ts',
    ],
    dispatcherModules: [
      'server/ai.ts',
      'server/content-brief.ts',
      'server/content-posts-ai.ts',
      'server/content-posts-db.ts',
    ],
    parserOrValidationSignals: [
      'zod schema validation',
      "responseFormat: { type: 'json_object' }",
      'validateTransition',
    ],
    writeSideEffects: [
      'saveBrief',
      'savePost',
      'addActivity',
      'broadcastToWorkspace',
    ],
    wsEvents: [
      'CONTENT_UPDATED',
      'CONTENT_REQUEST_UPDATE',
    ],
    queryInvalidationTargets: [
      'queryKeys.admin.briefs',
      'queryKeys.admin.posts',
      'queryKeys.client.contentPlan',
    ],
    existingTestSignals: [
      'tests/integration/content-posts-ai-fix.test.ts',
      'tests/integration/content-posts-workflow.test.ts',
      'tests/integration/public-content-request-workflow-broadcasts.test.ts',
    ],
  },
  {
    id: 'seo-editor-assist',
    title: 'SEO Editor + Rewrite Assist',
    owningContext: 'seo-health',
    secondaryContexts: ['platform-foundation', 'client-portal'],
    entryRoutes: [
      'server/routes/rewrite-chat.ts',
      'server/routes/webflow-seo-page-tools.ts',
      'server/routes/webflow-seo-apply.ts',
    ],
    promptAssemblyModules: [
      'server/prompt-assembly.ts',
      'server/workspace-intelligence.ts',
      'server/internal-links.ts',
    ],
    dispatcherModules: [
      'server/ai.ts',
      'server/routes/rewrite-chat.ts',
      'server/routes/webflow-seo-page-tools.ts',
    ],
    parserOrValidationSignals: [
      'parseJsonSafe',
      'sanitizeForPromptInjection',
      'responseFormat',
    ],
    writeSideEffects: [
      'updatePageSeo',
      'addActivity',
      'broadcastToWorkspace',
    ],
    wsEvents: [
      'PAGE_STATE_UPDATED',
      'STRATEGY_UPDATED',
    ],
    queryInvalidationTargets: [
      'queryKeys.admin.seoEditor',
      'queryKeys.admin.keywordStrategy',
      'queryKeys.admin.workspaceHome',
    ],
    existingTestSignals: [
      'tests/integration/rewrite-chat-pages.test.ts',
      'tests/integration/bulk-accept-webflow-failure.test.ts',
      'tests/contract/external-provider-write-failure-contract.test.ts',
    ],
  },
  {
    id: 'client-decision-support',
    title: 'Client Decision Support + Intelligence Read Paths',
    owningContext: 'client-portal',
    secondaryContexts: ['inbox', 'platform-foundation', 'analytics-intelligence'],
    entryRoutes: [
      'server/routes/public-analytics.ts',
      'server/routes/client-actions.ts',
      'server/routes/public-portal.ts',
    ],
    promptAssemblyModules: [
      'server/workspace-intelligence.ts',
      'server/prompt-assembly.ts',
      'server/admin-chat-context.ts',
    ],
    dispatcherModules: [
      'server/ai.ts',
      'server/routes/public-analytics.ts',
      'server/content-decay.ts',
    ],
    parserOrValidationSignals: [
      'zod route validation',
      'state-machine guards',
      'response-shape contract tests',
    ],
    writeSideEffects: [
      'respondToClientAction',
      'addActivity',
      'broadcastToWorkspace',
    ],
    wsEvents: [
      'CLIENT_ACTION_UPDATE',
      'INTELLIGENCE_SIGNALS_UPDATED',
    ],
    queryInvalidationTargets: [
      'queryKeys.client.clientActions',
      'queryKeys.admin.clientActions',
      'queryKeys.client.intelligence',
    ],
    existingTestSignals: [
      'tests/integration/client-actions-broadcasts.test.ts',
      'tests/integration/client-actions-routes.test.ts',
      'tests/contract/public-workspace-intelligence-contract.test.ts',
    ],
  },
  {
    id: 'diagnostic-synthesis',
    title: 'Deep Diagnostic Synthesis',
    owningContext: 'platform-foundation',
    secondaryContexts: ['analytics-intelligence', 'seo-health'],
    entryRoutes: [
      'server/routes/jobs.ts',
      'server/routes/diagnostics.ts',
      'server/diagnostic-orchestrator.ts',
    ],
    promptAssemblyModules: [
      'server/diagnostic-orchestrator.ts',
    ],
    dispatcherModules: [
      'server/ai.ts',
      'server/diagnostic-orchestrator.ts',
    ],
    parserOrValidationSignals: [
      'parseJsonSafeArray',
      'rootCauseSchema',
      'remediationActionSchema',
    ],
    writeSideEffects: [
      'completeDiagnosticReport',
      'addActivity',
      'broadcastToWorkspace',
    ],
    wsEvents: [
      'DIAGNOSTIC_COMPLETE',
      'DIAGNOSTIC_FAILED',
    ],
    queryInvalidationTargets: [
      'queryKeys.admin.diagnostics',
      'queryKeys.admin.diagnosticForInsight',
      'queryKeys.admin.insightFeed',
    ],
    existingTestSignals: [
      'tests/integration/deep-diagnostic-jobs.test.ts',
      'tests/integration/deep-diagnostic-mutation-safety.test.ts',
      'tests/contract/mutation-safety-route-matrix.test.ts',
    ],
  },
  {
    id: 'admin-insights-chat',
    title: 'Admin Insights Chat Reliability',
    owningContext: 'platform-foundation',
    secondaryContexts: ['analytics-intelligence', 'brand-engine'],
    entryRoutes: [
      'server/routes/ai.ts',
    ],
    promptAssemblyModules: [
      'server/admin-chat-context.ts',
    ],
    dispatcherModules: [
      'server/ai.ts',
      'server/routes/ai.ts',
    ],
    parserOrValidationSignals: [
      'question required',
      'workspaceId required',
      'Workspace not found',
    ],
    writeSideEffects: [
      'addMessage',
      'addActivity',
      'generateSessionSummary',
    ],
    wsEvents: [],
    queryInvalidationTargets: [],
    existingTestSignals: [
      'tests/unit/admin-chat-question-routing.test.ts',
      'tests/unit/chat-context-insights.test.ts',
      'tests/unit/ai-dispatch.test.ts',
    ],
  },
  {
    id: 'client-search-chat',
    title: 'Client Search Chat + Intent Classification',
    owningContext: 'client-portal',
    secondaryContexts: ['analytics-intelligence', 'platform-foundation'],
    entryRoutes: [
      'server/routes/public-analytics.ts',
      'server/routes/public-chat.ts',
      'server/routes/client-signals.ts',
    ],
    promptAssemblyModules: [
      'server/routes/public-analytics.ts',
      'server/workspace-intelligence.ts',
    ],
    dispatcherModules: [
      'server/ai.ts',
      'server/routes/public-analytics.ts',
    ],
    parserOrValidationSignals: [
      'parseJsonSafe',
      'intentSchema',
      'classifyMessageIntent',
    ],
    writeSideEffects: [
      'addMessage',
      'createClientSignal',
      'addActivity',
    ],
    wsEvents: [
      'CLIENT_SIGNAL_CREATED',
    ],
    queryInvalidationTargets: [
      'queryKeys.client.intelligence',
      'queryKeys.admin.clientSignals',
    ],
    existingTestSignals: [
      'tests/integration/public-chat-routes.test.ts',
      'tests/integration/public-analytics.test.ts',
      'tests/integration/client-signals-routes.test.ts',
    ],
  },
  {
    id: 'brand-voice-provenance',
    title: 'Brand Voice + Provenance-Sensitive AI Paths',
    owningContext: 'brand-engine',
    secondaryContexts: ['content-pipeline', 'platform-foundation'],
    entryRoutes: [
      'server/routes/brand-identity.ts',
      'server/routes/voice-calibration.ts',
      'server/routes/content-posts.ts',
    ],
    promptAssemblyModules: [
      'server/prompt-assembly.ts',
      'server/voice-calibration.ts',
      'server/routes/content-posts.ts',
    ],
    dispatcherModules: [
      'server/ai.ts',
      'server/routes/brand-identity.ts',
      'server/routes/content-posts.ts',
    ],
    parserOrValidationSignals: [
      'researchMode: true',
      'sanitizeErrorMessage',
      'human source review required',
    ],
    writeSideEffects: [
      'addActivity',
      'broadcastToWorkspace',
      'updatePostField',
    ],
    wsEvents: [
      'VOICE_PROFILE_UPDATED',
      'BRAND_IDENTITY_UPDATED',
      'POST_UPDATED',
    ],
    queryInvalidationTargets: [
      'queryKeys.admin.voiceProfile',
      'queryKeys.admin.brandIdentity',
      'queryKeys.admin.posts',
    ],
    existingTestSignals: [
      'tests/integration/brand-identity-hardening.test.ts',
      'tests/integration/voice-calibration-hardening.test.ts',
      'tests/integration/content-posts-ai-fix.test.ts',
      'tests/contract/factual-ai-output-contracts.test.ts',
    ],
  },
];

export const AI_RELIABILITY_SCENARIOS: AiReliabilityScenario[] = [
  {
    id: 'schema-invalid-output-blocked',
    pipelineId: 'schema-generation-review',
    title: 'Schema invalid output is blocked before mutation',
    failureClass: 'invalid_output',
    severity: 'hard',
    evidenceFiles: [
      'tests/unit/schema-validation-pipeline.test.ts',
      'tests/integration/schema-plan-public-routes.test.ts',
    ],
    assertions: [
      { anyOf: ['invalid', 'safeparse', 'status).tobe(400)', 'status).tobe(409)'] },
      { anyOf: ['should not save', 'does not update', 'tobe(0)'] },
    ],
    notes: 'Guards schema parsing and transition failures from writing corrupted state.',
  },
  {
    id: 'content-ai-failures-no-phantom-success',
    pipelineId: 'content-brief-review',
    title: 'Content AI failures never report success',
    failureClass: 'provider_error',
    severity: 'hard',
    evidenceFiles: [
      'tests/integration/content-posts-ai-fix.test.ts',
      'tests/unit/discovery-ingestion-ai-failure.test.ts',
    ],
    assertions: [
      { anyOf: ['status).tobe(500)', 'error', 'failed'] },
      { anyOf: ['does not mutate', 'tohavelength(0)', 'should not save'] },
    ],
    notes: 'Ensures generation/review failures fail closed.',
  },
  {
    id: 'seo-provider-failures-fail-closed',
    pipelineId: 'seo-editor-assist',
    title: 'SEO provider write failures fail closed',
    failureClass: 'timeout',
    severity: 'hard',
    evidenceFiles: [
      'tests/integration/bulk-accept-webflow-failure.test.ts',
      'tests/contract/external-provider-write-failure-contract.test.ts',
    ],
    assertions: [
      { anyOf: ['failed', 'status).tobe(500)', 'rate limited', 'timeout'] },
      { anyOf: ['no phantom success', 'applied).tobe(0)', 'does not mutate'] },
    ],
    notes: 'Prevents stale success reporting when external writes fail.',
  },
  {
    id: 'client-action-lifecycle-hygiene',
    pipelineId: 'client-decision-support',
    title: 'Client action lifecycle preserves side-effect hygiene',
    failureClass: 'side_effect_hygiene',
    severity: 'hard',
    evidenceFiles: [
      'tests/integration/client-actions-broadcasts.test.ts',
      'tests/integration/client-actions-routes.test.ts',
    ],
    assertions: [
      { anyOf: ['client_action_update', 'client action'] },
      { anyOf: ['does not broadcast', 'does not mutate', 'tohavelength(0)'] },
    ],
    notes: 'Invalid or cross-workspace responses must not leak side effects.',
  },
  {
    id: 'diagnostic-synthesis-failure-contract',
    pipelineId: 'diagnostic-synthesis',
    title: 'Diagnostic synthesis failures emit failed/error outcomes',
    failureClass: 'provider_error',
    severity: 'hard',
    evidenceFiles: [
      'tests/integration/deep-diagnostic-mutation-safety.test.ts',
      'tests/integration/deep-diagnostic-jobs.test.ts',
    ],
    assertions: [
      { anyOf: ['status: \'error\'', 'diagnostic failed', 'status).tobe(404)', 'status).tobe(400)'] },
      { anyOf: ['diagnostic_completed', 'countactivities', 'diagnostic:failed', 'diagnostic:complete'] },
    ],
    notes: 'Ensures no phantom completion on failed diagnostic synthesis.',
  },
  {
    id: 'admin-chat-input-and-provider-guards',
    pipelineId: 'admin-insights-chat',
    title: 'Admin chat preserves input and provider guardrails',
    failureClass: 'invalid_output',
    severity: 'hard',
    evidenceFiles: [
      'server/routes/ai.ts',
      'tests/unit/ai-dispatch.test.ts',
      'tests/unit/admin-chat-question-routing.test.ts',
    ],
    assertions: [
      { allOf: ['question required', 'workspaceid required'] },
      { anyOf: ['openai_api_key not configured', 'callai', 'assembleadmincontext'] },
    ],
    notes: 'Pins guardrails that prevent invalid requests from entering the AI flow.',
  },
  {
    id: 'client-search-chat-intent-fallback',
    pipelineId: 'client-search-chat',
    title: 'Client search chat keeps intent detection non-blocking',
    failureClass: 'side_effect_hygiene',
    severity: 'hard',
    evidenceFiles: [
      'server/routes/public-analytics.ts',
      'tests/integration/client-signals-routes.test.ts',
      'tests/integration/tier-gate-enforcement.test.ts',
    ],
    assertions: [
      { allOf: ['promise.allsettled', 'detectedintent', 'classifymessageintent'] },
      { anyOf: ['status).tobe(400)', 'status).tobe(429)', 'error'] },
    ],
    notes: 'Intent classifier failure should never block main chat behavior.',
  },
  {
    id: 'brand-voice-provenance-guardrails',
    pipelineId: 'brand-voice-provenance',
    title: 'Brand/voice and provenance-sensitive paths keep guardrails',
    failureClass: 'provenance',
    severity: 'hard',
    evidenceFiles: [
      'tests/integration/content-posts-ai-fix.test.ts',
      'tests/integration/brand-identity-hardening.test.ts',
      'tests/contract/factual-ai-output-contracts.test.ts',
    ],
    assertions: [
      { anyOf: ['human-review required', 'sanitizeerrormessage', 'researchmode: true'] },
      { anyOf: ['status).tobe(429)', 'status).tobe(500)', 'usage_limit'] },
    ],
    notes: 'Protects provenance-sensitive review gates and voice-quality failure handling.',
  },
];

export const AI_QUALITY_FIXTURES: AiQualityFixture[] = [
  {
    id: 'brand-voice-authority-layering',
    pipelineId: 'brand-voice-provenance',
    title: 'Brand voice authority layers do not duplicate calibrated DNA or guardrails',
    dimension: 'voice_authority',
    severity: 'hard',
    evidenceFiles: [
      'docs/rules/brand-engine.md',
      'tests/unit/voice-quality-contract-harness.test.ts',
    ],
    assertions: [
      { allOf: ['Four-Layer Architecture', 'Voice Quality Contract Harness', 'strict output-format instructions remain first'] },
      { allOf: ['Voice profile for this client:', 'Voice guardrails:', "not.toContain('VOICE DNA:')"] },
    ],
    notes: 'Pins the post-voice-sprint authority contract: calibrated voice lives in Layer 2 and prompt-facing context blocks do not duplicate DNA/guardrails.',
  },
  {
    id: 'universal-prose-quality-layer',
    pipelineId: 'brand-voice-provenance',
    title: 'Universal prose quality rules remain attached to the layered prompt contract',
    dimension: 'prose_quality',
    severity: 'soft',
    evidenceFiles: [
      'docs/rules/brand-engine.md',
      'server/writing-quality.ts',
      'tests/unit/prompt-assembly.test.ts',
    ],
    assertions: [
      { allOf: ['Layer 4', 'Universal prose quality rules', 'PROSE QUALITY'] },
      { allOf: ['No em dashes', 'No concession-positive pattern', 'PROSE_QUALITY_RULES'] },
    ],
    notes: 'Keeps anti-generic-writing rules visible in the prompt assembly contract without making subjective live output scoring part of CI.',
  },
  {
    id: 'content-review-format-and-provenance',
    pipelineId: 'content-brief-review',
    title: 'Content review keeps JSON output and human provenance gates',
    dimension: 'evidence_grounding',
    severity: 'hard',
    evidenceFiles: [
      'server/routes/content-posts.ts',
      'tests/contract/factual-ai-output-contracts.test.ts',
    ],
    assertions: [
      { allOf: ['Human source review required', 'Return ONLY valid JSON', 'researchMode: true'] },
      { allOf: ["responseFormat: { type: 'json_object' }"], anyOf: ['parseAIJson', 'safeParse'] },
    ],
    notes: 'Protects the factual-review path from quietly treating provenance-sensitive checklist items as auto-verified.',
  },
  {
    id: 'seo-editor-assist-format-sanitization',
    pipelineId: 'seo-editor-assist',
    title: 'SEO editor assist preserves insertion-safe rewrite and JSON contracts',
    dimension: 'output_format',
    severity: 'hard',
    evidenceFiles: [
      'server/routes/rewrite-chat.ts',
      'server/routes/webflow-seo-page-tools.ts',
    ],
    assertions: [
      { allOf: ['BEGIN_REWRITE', 'plain prose only', 'sanitizeForPromptInjection'] },
      { allOf: ['Return ONLY valid JSON', "responseFormat: { type: 'json_object' }", 'researchMode: true'] },
    ],
    notes: 'Covers the prompt-rendering contract where rewrite delimiters feed a live editor and page SEO copy expects strict JSON.',
  },
  {
    id: 'diagnostic-synthesis-json-evidence',
    pipelineId: 'diagnostic-synthesis',
    title: 'Diagnostic synthesis keeps JSON shape and evidence-first reasoning',
    dimension: 'output_format',
    severity: 'hard',
    evidenceFiles: [
      'server/diagnostic-orchestrator.ts',
      'tests/unit/diagnostic-orchestrator-pure.test.ts',
    ],
    assertions: [
      { allOf: ['Respond with ONLY valid JSON', 'Use the evidence from ALL data sources'] },
      { allOf: ["responseFormat: { type: 'json_object' }", 'rootCauseSchema', 'remediationActionSchema'] },
    ],
    notes: 'Pins diagnostic output shape after the voice-authority migration wrapped diagnostic synthesis with buildSystemPrompt().',
  },
  {
    id: 'admin-chat-layered-system-prompt',
    pipelineId: 'admin-insights-chat',
    title: 'Admin chat uses the layered prompt authority without duplicating prose rules',
    dimension: 'duplication_risk',
    severity: 'soft',
    evidenceFiles: [
      'server/admin-chat-context.ts',
      'docs/rules/brand-engine.md',
    ],
    assertions: [
      { allOf: ['buildLayeredSystemPrompt', 'skipProseRules: true'] },
      { allOf: ['Prompt Layers Must Not Duplicate Content', 'buildSystemPrompt(workspaceId, baseInstructions, customNotes?, opts?)'] },
    ],
    notes: 'Documents the intentional admin-chat complete-style-system path so future quality checks do not double-inject prose rules.',
  },
  {
    id: 'client-search-chat-clean-prose-and-intent-format',
    pipelineId: 'client-search-chat',
    title: 'Client search chat preserves intent JSON and clean client-facing prose',
    dimension: 'output_format',
    severity: 'hard',
    evidenceFiles: [
      'server/routes/public-analytics.ts',
      'tests/integration/public-chat-routes.test.ts',
      'tests/integration/public-analytics.test.ts',
    ],
    assertions: [
      { allOf: ['Return ONLY valid JSON', 'classifyMessageIntent'] },
      { allOf: ['NEVER include markdown links'], anyOf: ['parseJsonSafe', 'safeParse'] },
    ],
    notes: 'Pins the client-chat split between machine-readable intent classification and clean prose rendered with UI action buttons.',
  },
  {
    // SEO Generation Quality (Phase 0) — advisory acceptance bar (a): a sparse,
    // Faros-like provider-backed workspace must produce >= 6 content gaps. RED until
    // P1–P2 land (input-starvation fix + deterministic backfill floor). `soft` so it
    // P2 PROMOTION soft→hard: the deterministic backfill floor
    // (`backfillContentGapsToFloor` / `STRATEGY_CONTENT_GAP_FLOOR`, wired into
    // server/keyword-strategy-generation.ts) now GUARANTEES contentGaps >= 6 when
    // real candidates exist, and the contract test asserts it. Both forward tokens
    // now exist in the evidence, so the allOf passes (GREEN) — flipped to hard.
    id: 'seo-gen-quality-sparse-content-gaps',
    pipelineId: 'content-brief-review',
    title: 'Sparse workspace produces a populated content-gap set (>= 6) — deterministic floor (P2)',
    dimension: 'evidence_grounding',
    severity: 'hard',
    evidenceFiles: [
      'tests/contract/seo-generation-quality-evals.test.ts',
      'server/keyword-strategy-generation.ts',
    ],
    assertions: [
      { allOf: ['backfillContentGapsToFloor', 'STRATEGY_CONTENT_GAP_FLOOR'] },
    ],
    notes: 'Encodes the Faros-like sparse-workspace acceptance bar (contentGaps >= 6). GREEN at P2: the deterministic backfill floor guarantees it; promoted soft→hard.',
  },
  {
    // SEO Generation Quality (Phase 3) — acceptance bar (b), PROMOTED soft→hard. P3
    // lands the Zod-validated named ops (`keyword-page-assignment` /
    // `keyword-site-synthesis`), changing the flag-ON semantics: a malformed AI
    // response now triggers retry-once → deterministic backfill → NEVER-EMPTY
    // contentGaps (not a throw). The flag-OFF legacy path STILL throws (byte-identical).
    // Both forward tokens now exist in the evidence so the allOf passes (GREEN) → hard.
    id: 'seo-gen-quality-malformed-ai-throws',
    pipelineId: 'content-brief-review',
    title: 'Malformed AI synthesis: flag-ON retries→backfills→never-empty; flag-OFF still throws (P3)',
    dimension: 'evidence_grounding',
    severity: 'hard',
    evidenceFiles: [
      'tests/contract/seo-generation-quality-evals.test.ts',
      'tests/integration/seo-genquality-p3-fm2-named-ops.test.ts',
      'server/keyword-strategy-ai-synthesis.ts',
      'server/keyword-strategy-generation.ts',
    ],
    assertions: [
      { allOf: ['malformed AI synthesis response makes generation THROW', 'keyword-page-assignment'] },
    ],
    notes: 'Never-silent-empty acceptance bar for the synthesis path. GREEN at P3: flag-ON validates with Zod, retries once, then deterministically backfills to a non-empty content-gap set; flag-OFF preserves the legacy throw. Promoted soft→hard.',
  },
];

export function findAiReliabilityRegistryGaps(
  traces: AiPipelineTraceDefinition[] = AI_CRITICAL_PIPELINE_TRACES,
  scenarios: AiReliabilityScenario[] = AI_RELIABILITY_SCENARIOS,
): string[] {
  const gaps: string[] = [];

  for (const pipelineId of AI_CRITICAL_PIPELINE_IDS) {
    const traceMatches = traces.filter(trace => trace.id === pipelineId);
    if (traceMatches.length === 0) {
      gaps.push(`Missing trace definition for ${pipelineId}`);
      continue;
    }
    if (traceMatches.length > 1) {
      gaps.push(`Duplicate trace definitions for ${pipelineId}`);
    }

    const scenarioMatches = scenarios.filter(scenario => scenario.pipelineId === pipelineId);
    if (scenarioMatches.length === 0) {
      gaps.push(`Missing reliability scenarios for ${pipelineId}`);
    }
  }

  for (const scenario of scenarios) {
    if (!AI_CRITICAL_PIPELINE_IDS.includes(scenario.pipelineId)) {
      gaps.push(`Scenario ${scenario.id} references unknown pipeline ${scenario.pipelineId}`);
    }
    if (scenario.evidenceFiles.length === 0) {
      gaps.push(`Scenario ${scenario.id} has no evidence files`);
    }
    if (scenario.assertions.length === 0) {
      gaps.push(`Scenario ${scenario.id} has no assertions`);
    }
  }

  return gaps;
}

export function findAiQualityFixtureGaps(
  fixtures: AiQualityFixture[] = AI_QUALITY_FIXTURES,
  expectedPipelineIds: readonly AiQualityPipelineId[] = AI_QUALITY_PIPELINE_IDS,
): string[] {
  const gaps: string[] = [];

  for (const pipelineId of expectedPipelineIds) {
    const fixtureMatches = fixtures.filter(fixture => fixture.pipelineId === pipelineId);
    if (fixtureMatches.length === 0) {
      gaps.push(`Missing AI quality fixture for ${pipelineId}`);
    }
  }

  const seenIds = new Set<string>();
  for (const fixture of fixtures) {
    if (seenIds.has(fixture.id)) {
      gaps.push(`Duplicate AI quality fixture id ${fixture.id}`);
    }
    seenIds.add(fixture.id);

    if (!AI_QUALITY_PIPELINE_IDS.includes(fixture.pipelineId)) {
      gaps.push(`AI quality fixture ${fixture.id} references non-quality pipeline ${fixture.pipelineId}`);
    }
    if (fixture.evidenceFiles.length === 0) {
      gaps.push(`AI quality fixture ${fixture.id} has no evidence files`);
    }
    if (fixture.assertions.length === 0) {
      gaps.push(`AI quality fixture ${fixture.id} has no assertions`);
    }
  }

  return gaps;
}

export function getPipelineTitleMap(
  traces: AiPipelineTraceDefinition[] = AI_CRITICAL_PIPELINE_TRACES,
): Record<AiCriticalPipelineId, string> {
  return traces.reduce<Record<AiCriticalPipelineId, string>>((acc, trace) => {
    acc[trace.id] = trace.title;
    return acc;
  }, {
    'schema-generation-review': 'Schema Generation + Client Review',
    'content-brief-review': 'Content Brief + Post Review Generation',
    'seo-editor-assist': 'SEO Editor + Rewrite Assist',
    'client-decision-support': 'Client Decision Support + Intelligence Read Paths',
    'diagnostic-synthesis': 'Deep Diagnostic Synthesis',
    'admin-insights-chat': 'Admin Insights Chat Reliability',
    'client-search-chat': 'Client Search Chat + Intent Classification',
    'brand-voice-provenance': 'Brand Voice + Provenance-Sensitive AI Paths',
  });
}
