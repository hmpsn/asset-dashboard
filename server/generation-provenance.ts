import { createHash, randomUUID } from 'node:crypto';
import type {
  AIExecutionMetadata,
  GenerationExecutionProvenance,
  GenerationProvenance,
} from '../shared/types/ai-execution.js';
import type { AIRenderedProviderInput } from './ai.js';
import { canonicalGenerationProvenanceSchema } from './schemas/generation-provenance.js';

function canonicalize(value: unknown, stack = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Generation fingerprints require finite numbers');
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported generation fingerprint value: ${typeof value}`);
  }
  if (stack.has(value)) throw new TypeError('Generation fingerprint inputs must not contain cycles');
  stack.add(value);

  if (Array.isArray(value)) {
    const result = value.map(item => {
      if (item === undefined) throw new TypeError('Generation fingerprint arrays must not contain undefined');
      return canonicalize(item, stack);
    });
    stack.delete(value);
    return result;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Generation fingerprints accept only plain JSON-compatible objects');
  }

  const record = value as Record<string, unknown>;
  const result = Object.fromEntries(
    Object.keys(record)
      .filter(key => record[key] !== undefined)
      .sort()
      .map(key => [key, canonicalize(record[key], stack)]),
  );
  stack.delete(value);
  return result;
}

/** Stable SHA-256 over recursively key-sorted JSON-compatible inputs. */
export function canonicalGenerationFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)) ?? 'null')
    .digest('hex');
}

/** Fingerprints the exact provider-shaped instructions returned by renderAIProviderInput(). */
export function fingerprintRenderedAIInput(input: AIRenderedProviderInput): string {
  return canonicalGenerationFingerprint(input);
}

export interface AcceptedGenerationExecution {
  execution: AIExecutionMetadata;
  inputFingerprint: string;
}

/**
 * Server-issued authority for prose generated outside callAI (for example by an MCP client).
 * The platform can attest the exact prepared context and lifecycle timestamps, but not the
 * external model, so the durable provider/model values remain explicitly unreported.
 */
export interface ExternalGenerationPreparation {
  runId: string;
  operation: string;
  inputFingerprint: string;
  startedAt: string;
}

export function prepareExternalGeneration(
  operation: string,
  effectiveInput: unknown,
): ExternalGenerationPreparation {
  return {
    runId: `external_${randomUUID()}`,
    operation,
    inputFingerprint: canonicalGenerationFingerprint(effectiveInput),
    startedAt: new Date().toISOString(),
  };
}

export function completeExternalGeneration(
  preparation: ExternalGenerationPreparation,
  completedAt = new Date().toISOString(),
): GenerationProvenance {
  return canonicalGenerationProvenanceSchema.parse({
    runId: preparation.runId,
    executionChainId: preparation.runId,
    operation: preparation.operation,
    provider: 'external',
    model: 'unreported',
    inputFingerprint: preparation.inputFingerprint,
    startedAt: preparation.startedAt,
    completedAt,
  }) as GenerationProvenance;
}

export function toGenerationExecutionProvenance(
  accepted: AcceptedGenerationExecution,
): GenerationExecutionProvenance {
  return {
    runId: accepted.execution.runId,
    ...(accepted.execution.executionChainId
      ? { executionChainId: accepted.execution.executionChainId }
      : {}),
    operation: accepted.execution.operation,
    provider: accepted.execution.provider,
    model: accepted.execution.model,
    inputFingerprint: accepted.inputFingerprint,
    startedAt: accepted.execution.startedAt,
    completedAt: accepted.execution.completedAt,
  };
}

export interface BuildGenerationProvenanceOptions {
  accepted: AcceptedGenerationExecution;
  /** Ordered executions whose outputs contribute to the adopted artifact. */
  executions?: AcceptedGenerationExecution[];
  executionChainId?: string;
  evidenceCapturedAt?: string;
  /** Deterministic resolved inputs that authorize a composite artifact. */
  authorityInputs?: unknown;
}

export function buildGenerationProvenance(
  options: BuildGenerationProvenanceOptions,
): GenerationProvenance {
  const accepted = toGenerationExecutionProvenance(options.accepted);
  const executions = (options.executions ?? [options.accepted])
    .map(toGenerationExecutionProvenance);
  const hasExecutionList = options.executions !== undefined;
  const hasCompositeFingerprint = executions.length > 1 || options.authorityInputs !== undefined;
  const inputFingerprint = hasCompositeFingerprint
    ? canonicalGenerationFingerprint({
        executions: executions.map(execution => ({
          operation: execution.operation,
          inputFingerprint: execution.inputFingerprint,
        })),
        authorityInputs: options.authorityInputs,
      })
    : accepted.inputFingerprint;

  const executionChainId = options.executionChainId ?? options.accepted.execution.executionChainId;
  const provenance: GenerationProvenance = {
    ...accepted,
    inputFingerprint,
    ...(executionChainId ? { executionChainId } : {}),
    ...(hasExecutionList ? { executions } : {}),
    ...(options.evidenceCapturedAt ? { evidenceCapturedAt: options.evidenceCapturedAt } : {}),
    startedAt: accepted.startedAt,
    completedAt: accepted.completedAt,
  };
  return canonicalGenerationProvenanceSchema.parse(provenance) as GenerationProvenance;
}

export class GenerationRevisionConflictError extends Error {
  readonly code = 'generation_revision_conflict';
  readonly artifactType: 'content_brief' | 'content_post' | 'copy_section';
  readonly artifactId: string;
  readonly expectedRevision: number;

  constructor(
    artifactType: 'content_brief' | 'content_post' | 'copy_section',
    artifactId: string,
    expectedRevision: number,
  ) {
    super(`The ${artifactType.replace(/_/g, ' ')} changed while generation was running`);
    this.name = 'GenerationRevisionConflictError';
    this.artifactType = artifactType;
    this.artifactId = artifactId;
    this.expectedRevision = expectedRevision;
  }
}
