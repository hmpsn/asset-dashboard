import { describe, expect, it } from 'vitest';
import type { AIExecutionMetadata } from '../../shared/types/ai-execution.js';
import {
  buildGenerationProvenance,
  canonicalGenerationFingerprint,
} from '../../server/generation-provenance.js';
import {
  canonicalGenerationProvenanceSchema,
  generationProvenanceSchema,
} from '../../server/schemas/generation-provenance.js';

function execution(
  runId: string,
  operation: string,
  startedAt = '2026-07-13T10:00:00.000Z',
): AIExecutionMetadata {
  return {
    runId,
    executionChainId: 'job_chain_1',
    operation,
    provider: 'openai',
    model: 'gpt-5.4',
    attempts: 1,
    cacheOutcome: 'miss',
    startedAt,
    completedAt: '2026-07-13T10:00:01.000Z',
    durationMs: 1_000,
  };
}

describe('generation provenance', () => {
  it('fingerprints recursively key-sorted inputs deterministically', () => {
    expect(canonicalGenerationFingerprint({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(canonicalGenerationFingerprint({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it('stores accepted composite executions without making random run ids part of input identity', () => {
    const firstFingerprint = canonicalGenerationFingerprint({ stage: 'intro' });
    const finalFingerprint = canonicalGenerationFingerprint({ stage: 'section' });
    const provenance = buildGenerationProvenance({
      accepted: { execution: execution('run_final', 'content-post-section'), inputFingerprint: finalFingerprint },
      executions: [
        { execution: execution('run_intro', 'content-post-introduction'), inputFingerprint: firstFingerprint },
        { execution: execution('run_final', 'content-post-section'), inputFingerprint: finalFingerprint },
      ],
      authorityInputs: { briefRevision: 3 },
    });
    const sameInputsDifferentRuns = buildGenerationProvenance({
      accepted: { execution: execution('other_final', 'content-post-section'), inputFingerprint: finalFingerprint },
      executions: [
        { execution: execution('other_intro', 'content-post-introduction'), inputFingerprint: firstFingerprint },
        { execution: execution('other_final', 'content-post-section'), inputFingerprint: finalFingerprint },
      ],
      authorityInputs: { briefRevision: 3 },
    });

    expect(provenance.runId).toBe('run_final');
    expect(provenance.executionChainId).toBe('job_chain_1');
    expect(provenance.executions).toHaveLength(2);
    expect(provenance.inputFingerprint).toBe(sameInputsDifferentRuns.inputFingerprint);
    expect(generationProvenanceSchema.safeParse(provenance).success).toBe(true);
  });

  it('rejects malformed fingerprints at the storage boundary', () => {
    const malformed = {
      ...buildGenerationProvenance({
        accepted: {
          execution: execution('run_1', 'content-brief-generate'),
          inputFingerprint: canonicalGenerationFingerprint({ prompt: 'safe' }),
        },
      }),
      inputFingerprint: 'not-a-sha256',
    };
    expect(generationProvenanceSchema.safeParse(malformed).success).toBe(true);
    expect(canonicalGenerationProvenanceSchema.safeParse(malformed).success).toBe(false);
  });

  it('rejects unsupported or cyclic authority inputs instead of collapsing identities', () => {
    expect(() => canonicalGenerationFingerprint(new Date())).toThrow('plain JSON-compatible objects');
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalGenerationFingerprint(cyclic)).toThrow('must not contain cycles');
  });

  it('rejects a composite envelope that omits its accepted execution', () => {
    const intro = {
      execution: execution('run_intro_only', 'content-post-introduction'),
      inputFingerprint: canonicalGenerationFingerprint({ stage: 'intro' }),
    };
    const accepted = {
      execution: execution('run_missing', 'content-post-section'),
      inputFingerprint: canonicalGenerationFingerprint({ stage: 'section' }),
    };
    expect(() => buildGenerationProvenance({ accepted, executions: [intro] }))
      .toThrow('accepted top-level execution');
  });
});
