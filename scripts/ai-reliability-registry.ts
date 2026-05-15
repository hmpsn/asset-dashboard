import {
  AI_CRITICAL_PIPELINE_IDS,
  type AiCriticalPipelineId,
  type AiPipelineTraceDefinition,
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
      'validateSchemaSitePlan',
      'validateTransition',
      'parseJsonSafe',
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
      'human-review required',
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
