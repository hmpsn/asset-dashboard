export type AICachePolicy =
  | { mode: 'none' }
  | { mode: 'inflight' }
  | { mode: 'ttl'; ttlMs: number };

export type AICacheOutcome = 'bypass' | 'miss' | 'inflight' | 'hit';

export interface AIExecutionMetadata {
  runId: string;
  operation: string;
  provider: 'openai' | 'anthropic';
  model: string;
  attempts: number;
  fallbackUsed: boolean;
  cacheOutcome: AICacheOutcome;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

/** Internal durable-artifact attribution. Raw prompts and secrets are never stored. */
export interface GenerationProvenance {
  runId: string;
  operation: string;
  provider: 'openai' | 'anthropic';
  model: string;
  inputFingerprint: string;
  evidenceCapturedAt?: string;
  startedAt: string;
  completedAt: string;
}
