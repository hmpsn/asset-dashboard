export type AICachePolicy =
  | { mode: 'none' }
  | { mode: 'inflight' }
  | { mode: 'ttl'; ttlMs: number };

export type AICacheOutcome = 'bypass' | 'miss' | 'inflight' | 'hit';

export interface AIExecutionMetadata {
  runId: string;
  /** Correlates multiple provider attempts in one logical generation. */
  executionChainId?: string;
  /** Run that performed the provider call when this request reused work. */
  originRunId?: string;
  operation: string;
  provider: 'openai' | 'anthropic';
  model: string;
  attempts: number;
  /** Present only when a dispatcher can prove whether provider fallback occurred. */
  fallbackUsed?: boolean;
  cacheOutcome: AICacheOutcome;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

/** Internal durable-artifact attribution. Raw prompts and secrets are never stored. */
export interface GenerationProvenance {
  runId: string;
  operation: string;
  /** Includes deterministic engines; AIExecutionMetadata remains limited to actual AI providers. */
  provider: 'openai' | 'anthropic' | 'deterministic';
  model: string;
  inputFingerprint: string;
  evidenceCapturedAt?: string;
  startedAt: string;
  completedAt: string;
}
