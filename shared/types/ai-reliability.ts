export const AI_CRITICAL_PIPELINE_IDS = [
  'schema-generation-review',
  'content-brief-review',
  'seo-editor-assist',
  'client-decision-support',
  'diagnostic-synthesis',
  'admin-insights-chat',
  'client-search-chat',
  'brand-voice-provenance',
] as const;

export type AiCriticalPipelineId = (typeof AI_CRITICAL_PIPELINE_IDS)[number];

export const AI_QUALITY_PIPELINE_IDS = [
  'brand-voice-provenance',
  'content-brief-review',
  'seo-editor-assist',
  'diagnostic-synthesis',
  'admin-insights-chat',
  'client-search-chat',
] as const;

export type AiQualityPipelineId = (typeof AI_QUALITY_PIPELINE_IDS)[number];

export type AiReliabilityFailureClass =
  | 'invalid_output'
  | 'timeout'
  | 'provider_error'
  | 'state_transition'
  | 'side_effect_hygiene'
  | 'provenance';

export type AiPipelineContextId =
  | 'workspace-command-center'
  | 'client-portal'
  | 'inbox'
  | 'content-pipeline'
  | 'schema'
  | 'seo-health'
  | 'analytics-intelligence'
  | 'brand-engine'
  | 'outcomes-roi'
  | 'billing-monetization'
  | 'integrations'
  | 'platform-foundation';

export type AiPipelineTraceDefinition = {
  id: AiCriticalPipelineId;
  title: string;
  owningContext: AiPipelineContextId;
  secondaryContexts: AiPipelineContextId[];
  entryRoutes: string[];
  promptAssemblyModules: string[];
  dispatcherModules: string[];
  parserOrValidationSignals: string[];
  writeSideEffects: string[];
  wsEvents: string[];
  queryInvalidationTargets: string[];
  existingTestSignals: string[];
};

export type AiScenarioSeverity = 'hard' | 'soft';

export type AiReliabilityScenarioAssertion = {
  allOf?: string[];
  anyOf?: string[];
  noneOf?: string[];
};

export type AiReliabilityScenario = {
  id: string;
  pipelineId: AiCriticalPipelineId;
  title: string;
  failureClass: AiReliabilityFailureClass;
  severity: AiScenarioSeverity;
  evidenceFiles: string[];
  assertions: AiReliabilityScenarioAssertion[];
  notes: string;
};

export type AiQualityDimension =
  | 'voice_authority'
  | 'output_format'
  | 'prose_quality'
  | 'evidence_grounding'
  | 'duplication_risk';

export type AiQualityFixture = {
  id: string;
  pipelineId: AiQualityPipelineId;
  title: string;
  dimension: AiQualityDimension;
  severity: AiScenarioSeverity;
  evidenceFiles: string[];
  assertions: AiReliabilityScenarioAssertion[];
  notes: string;
};

export type AiQualityFixtureResult = {
  fixtureId: string;
  pipelineId: AiQualityPipelineId;
  dimension: AiQualityDimension;
  severity: AiScenarioSeverity;
  passed: boolean;
  score: number;
  reasons: string[];
  evidenceFiles: string[];
};

export type AiQualityPipelineScore = {
  pipelineId: AiQualityPipelineId;
  title: string;
  score: number;
  passed: number;
  total: number;
  dimensions: AiQualityDimension[];
  failingFixtureIds: string[];
};

export type AiQualityReport = {
  generatedBy: 'scripts/report-ai-quality.ts';
  advisoryOnly: true;
  generatedAt: string;
  fixtures: AiQualityFixture[];
  fixtureResults: AiQualityFixtureResult[];
  pipelineScores: AiQualityPipelineScore[];
  overallScore: number;
  hardFailures: string[];
  warnings: string[];
};

export type AiReliabilityThresholds = {
  minDomainScore: number;
  minOverallScore: number;
  maxRegressionDrop: number;
};

export type AiScenarioResult = {
  scenarioId: string;
  pipelineId: AiCriticalPipelineId;
  failureClass: AiReliabilityFailureClass;
  severity: AiScenarioSeverity;
  passed: boolean;
  score: number;
  reasons: string[];
  evidenceFiles: string[];
};

export type AiPipelineScore = {
  pipelineId: AiCriticalPipelineId;
  title: string;
  score: number;
  passed: number;
  total: number;
  failingScenarioIds: string[];
};

export type AiReliabilityReport = {
  generatedBy: 'scripts/report-ai-reliability.ts';
  advisoryOnly: true;
  generatedAt: string;
  thresholds: AiReliabilityThresholds;
  baselineOverallScore: number;
  traces: AiPipelineTraceDefinition[];
  scenarioResults: AiScenarioResult[];
  pipelineScores: AiPipelineScore[];
  overallScore: number;
  hardFailures: string[];
  warnings: string[];
  optimizationBacklog: Array<{
    id: string;
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    pipelineId: AiCriticalPipelineId;
    recommendation: string;
    evidenceScenarioIds: string[];
  }>;
};

export type AiPipelineWiringCheck = {
  pipelineId: AiCriticalPipelineId;
  routeCoverage: { required: string[]; missing: string[] };
  dispatcherCoverage: { required: string[]; missing: string[] };
  promptAssemblyCoverage: { required: string[]; missing: string[] };
  parserSignalCoverage: { required: string[]; missing: string[] };
  eventCoverage: { required: string[]; missing: string[] };
  queryKeyCoverage: { required: string[]; missing: string[] };
  testSignalCoverage: { required: string[]; missing: string[] };
};

export type AiPipelineWiringReport = {
  generatedBy: 'scripts/report-ai-pipeline-wiring.ts';
  generatedAt: string;
  advisoryOnly: true;
  tracesExpected: AiCriticalPipelineId[];
  checks: AiPipelineWiringCheck[];
  gaps: Array<{ pipelineId: string; issue: string }>;
};
