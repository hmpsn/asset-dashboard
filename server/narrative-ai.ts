import { z } from 'zod';
import { callAI } from './ai.js';
import { parseStructuredAIOutput, StructuredAIOutputError } from './ai-structured-output.js';
import type { AIOperationId } from './ai-operation-registry.js';

type NarrativeMessage = { role: 'user' | 'assistant'; content: string };

interface NarrativeLogger {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export interface CallNarrativeAIOptions<TParsed, TOutput = TParsed> {
  workspaceId: string;
  operation: AIOperationId;
  systemPrompt: string;
  prompt: string;
  schema: z.ZodType<TParsed>;
  parserContext: string;
  maxTokens: number;
  normalize?: (parsed: TParsed) => TOutput;
  logger: NarrativeLogger;
  retryDebugMessage: string;
  retryFailureLogMessage: string;
  retryFailureMessage: string;
}

export async function callNarrativeAI<TParsed, TOutput = TParsed>({
  workspaceId,
  operation,
  systemPrompt,
  prompt,
  schema,
  parserContext,
  maxTokens,
  normalize,
  logger,
  retryDebugMessage,
  retryFailureLogMessage,
  retryFailureMessage,
}: CallNarrativeAIOptions<TParsed, TOutput>): Promise<TOutput> {
  const mapOutput = normalize ?? ((parsed: TParsed) => parsed as unknown as TOutput);
  const messages: NarrativeMessage[] = [{ role: 'user', content: prompt }];
  const result = await callAI({
    operation,
    system: systemPrompt,
    messages,
    maxTokens,
    workspaceId,
  });

  try {
    return mapOutput(parseStructuredAIOutput(result.text, schema, parserContext));
  } catch (err) {
    logger.debug(
      { err, issues: err instanceof StructuredAIOutputError ? err.issues : undefined },
      retryDebugMessage,
    );
    const retryResult = await callAI({
      operation,
      system: systemPrompt,
      messages: [
        ...messages,
        { role: 'assistant', content: result.text },
        // The corrective prompt IS the retry mechanism. This previously also
        // dropped temperature (0.3 → 0.1) to bias toward valid JSON, but no
        // current model accepts a custom temperature (see model-manifest
        // sampling contracts), so that knob was inert and has been removed.
        { role: 'user', content: 'Your response was not valid JSON. Return only the JSON object, no explanation.' },
      ],
      maxTokens,
      workspaceId,
    });
    try {
      return mapOutput(parseStructuredAIOutput(retryResult.text, schema, parserContext));
    } catch (retryErr) {
      logger.error(
        {
          err: retryErr,
          issues: retryErr instanceof StructuredAIOutputError ? retryErr.issues : undefined,
          workspaceId,
          rawRetry: retryResult.text.slice(0, 500),
        },
        retryFailureLogMessage,
      );
      throw new Error(retryFailureMessage);
    }
  }
}

export interface ContentHashCacheOptions<T> {
  workspaceId: string;
  hash: string;
  cachedHash: string | null | undefined;
  unchangedSignal: string;
  unchangedLogMessage: string;
  logger: Pick<NarrativeLogger, 'debug'>;
  canUseCache?: boolean;
  run: () => Promise<T> | T;
}

export function withContentHashCache<T>({
  workspaceId,
  hash,
  cachedHash,
  unchangedSignal,
  unchangedLogMessage,
  logger,
  canUseCache = true,
  run,
}: ContentHashCacheOptions<T>): Promise<T> | T {
  if (canUseCache && hash === cachedHash) {
    logger.debug({ workspaceId }, unchangedLogMessage);
    throw new Error(unchangedSignal);
  }
  return run();
}
