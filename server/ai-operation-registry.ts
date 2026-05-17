export type AIOperationProvider = 'openai' | 'anthropic';
export type AIOperationOutputMode = 'prose' | 'json';
export type AIOperationResearchMode = 'required' | 'optional' | 'forbidden';
export type AIOperationExecutionMode = 'sync-only' | 'background-only' | 'sync-or-background';
export type AIOperationRetryPolicy = 'none' | 'standard' | 'aggressive';
export type AIOperationTimeoutProfile = 'short' | 'standard' | 'long';

export interface AIOperationContract {
  id: string;
  domain: string;
  feature: string;
  providerIntent: AIOperationProvider | 'either';
  modelIntent: string;
  outputMode: AIOperationOutputMode;
  parserExpectation: string;
  researchMode: AIOperationResearchMode;
  executionMode: AIOperationExecutionMode;
  retryPolicy: AIOperationRetryPolicy;
  timeoutProfile: AIOperationTimeoutProfile;
  defaultProvider?: AIOperationProvider;
  defaultModel?: string;
  defaultResponseFormat?: { type: 'json_object' };
  defaultMaxRetries?: number;
  defaultTimeoutMs?: number;
  defaultResearchMode?: boolean;
}

export const AI_OPERATION_REGISTRY = {
  'content-brief-regenerate': {
    id: 'content-brief-regenerate',
    domain: 'content-pipeline',
    feature: 'content-brief-regenerate',
    providerIntent: 'openai',
    modelIntent: 'high-fidelity structured regeneration',
    outputMode: 'json',
    parserExpectation: 'parseAiJson(content-brief)',
    researchMode: 'required',
    executionMode: 'sync-or-background',
    retryPolicy: 'standard',
    timeoutProfile: 'long',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4',
    defaultResponseFormat: { type: 'json_object' },
    defaultMaxRetries: 3,
    defaultTimeoutMs: 90_000,
    defaultResearchMode: true,
  },
  'schema-plan': {
    id: 'schema-plan',
    domain: 'schema',
    feature: 'schema-plan',
    providerIntent: 'openai',
    modelIntent: 'high-precision role classification',
    outputMode: 'json',
    parserExpectation: 'strict JSON.parse + schema-plan guards',
    researchMode: 'forbidden',
    executionMode: 'sync-or-background',
    retryPolicy: 'standard',
    timeoutProfile: 'standard',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4-mini',
    defaultResponseFormat: { type: 'json_object' },
    defaultMaxRetries: 3,
    defaultTimeoutMs: 90_000,
    defaultResearchMode: false,
  },
  'client-search-chat': {
    id: 'client-search-chat',
    domain: 'client-portal',
    feature: 'client-search-chat',
    providerIntent: 'openai',
    modelIntent: 'client conversational SEO advisor',
    outputMode: 'prose',
    parserExpectation: 'plain assistant text',
    researchMode: 'optional',
    executionMode: 'sync-only',
    retryPolicy: 'standard',
    timeoutProfile: 'standard',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4',
    defaultMaxRetries: 3,
    defaultTimeoutMs: 60_000,
    defaultResearchMode: false,
  },
  'content-decay': {
    id: 'content-decay',
    domain: 'content-pipeline',
    feature: 'content-decay',
    providerIntent: 'openai',
    modelIntent: 'concise optimization recommendations',
    outputMode: 'prose',
    parserExpectation: 'plain recommendation bullets',
    researchMode: 'optional',
    executionMode: 'sync-or-background',
    retryPolicy: 'standard',
    timeoutProfile: 'standard',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4-mini',
    defaultMaxRetries: 3,
    defaultTimeoutMs: 60_000,
    defaultResearchMode: false,
  },
  'keyword-strategy': {
    id: 'keyword-strategy',
    domain: 'analytics-intelligence',
    feature: 'keyword-strategy',
    providerIntent: 'openai',
    modelIntent: 'strategy synthesis with deterministic JSON instructions',
    outputMode: 'json',
    parserExpectation: 'instruction-based JSON parse + stripCodeFences',
    researchMode: 'optional',
    executionMode: 'background-only',
    retryPolicy: 'standard',
    timeoutProfile: 'long',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4-mini',
    defaultMaxRetries: 3,
    defaultTimeoutMs: 90_000,
    defaultResearchMode: false,
  },
  'knowledge-base-gen': {
    id: 'knowledge-base-gen',
    domain: 'platform-foundation',
    feature: 'knowledge-base-gen',
    providerIntent: 'openai',
    modelIntent: 'knowledge extraction summarization',
    outputMode: 'prose',
    parserExpectation: 'plain structured prose',
    researchMode: 'forbidden',
    executionMode: 'background-only',
    retryPolicy: 'standard',
    timeoutProfile: 'long',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4',
    defaultMaxRetries: 3,
    defaultTimeoutMs: 90_000,
    defaultResearchMode: false,
  },
  'brand-voice-gen': {
    id: 'brand-voice-gen',
    domain: 'brand-engine',
    feature: 'brand-voice-gen',
    providerIntent: 'openai',
    modelIntent: 'voice pattern extraction from site corpus',
    outputMode: 'prose',
    parserExpectation: 'plain structured prose',
    researchMode: 'forbidden',
    executionMode: 'background-only',
    retryPolicy: 'standard',
    timeoutProfile: 'long',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4',
    defaultMaxRetries: 3,
    defaultTimeoutMs: 90_000,
    defaultResearchMode: false,
  },
  'personas-gen': {
    id: 'personas-gen',
    domain: 'brand-engine',
    feature: 'personas-gen',
    providerIntent: 'openai',
    modelIntent: 'persona extraction JSON synthesis',
    outputMode: 'json',
    parserExpectation: 'JSON.parse + normalizePersonaResults',
    researchMode: 'forbidden',
    executionMode: 'background-only',
    retryPolicy: 'standard',
    timeoutProfile: 'long',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4',
    defaultMaxRetries: 3,
    defaultTimeoutMs: 90_000,
    defaultResearchMode: false,
  },
} as const satisfies Record<string, AIOperationContract>;

export type AIOperationId = keyof typeof AI_OPERATION_REGISTRY;

export function isAIOperationId(value: string): value is AIOperationId {
  return Object.prototype.hasOwnProperty.call(AI_OPERATION_REGISTRY, value);
}

export function getAIOperationContract(operationId: AIOperationId): AIOperationContract {
  return AI_OPERATION_REGISTRY[operationId];
}

