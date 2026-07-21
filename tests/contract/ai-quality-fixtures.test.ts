import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AI_QUALITY_FIXTURES,
  findAiQualityFixtureGaps,
} from '../../scripts/ai-reliability-registry.js';
import {
  AI_CRITICAL_PIPELINE_IDS,
  AI_QUALITY_PIPELINE_IDS,
  type AiQualityDimension,
} from '../../shared/types/ai-reliability.js';

const ROOT_DIR = resolve(import.meta.dirname, '../..');
const RULES_DOC = resolve(ROOT_DIR, 'docs/rules/ai-quality-evals.md');

describe('AI quality fixture registry', () => {
  it('covers every quality-targeted pipeline with at least one fixture', () => {
    expect(AI_QUALITY_FIXTURES.length).toBeGreaterThanOrEqual(AI_QUALITY_PIPELINE_IDS.length);
    expect(findAiQualityFixtureGaps()).toEqual([]);

    const covered = new Set(AI_QUALITY_FIXTURES.map(fixture => fixture.pipelineId));
    expect([...covered].sort()).toEqual([...AI_QUALITY_PIPELINE_IDS].sort());
  });

  it('keeps quality fixtures tied to known critical AI pipelines', () => {
    expect(AI_QUALITY_FIXTURES.length).toBeGreaterThan(0);
    for (const fixture of AI_QUALITY_FIXTURES) {
      expect(AI_CRITICAL_PIPELINE_IDS).toContain(fixture.pipelineId);
      expect(fixture.id).toMatch(/^[a-z0-9-]+$/);
      expect(fixture.evidenceFiles.length, `${fixture.id} evidence files`).toBeGreaterThan(0);
      expect(fixture.assertions.length, `${fixture.id} assertions`).toBeGreaterThan(0);
    }
  });

  it('uses the approved deterministic quality dimensions', () => {
    const expectedDimensions: AiQualityDimension[] = [
      'voice_authority',
      'output_format',
      'prose_quality',
      'evidence_grounding',
      'duplication_risk',
    ];
    const usedDimensions = new Set(AI_QUALITY_FIXTURES.map(fixture => fixture.dimension));

    expect(usedDimensions.size).toBeGreaterThan(0);
    for (const dimension of usedDimensions) {
      expect(expectedDimensions).toContain(dimension);
    }
    for (const required of expectedDimensions) {
      expect(usedDimensions).toContain(required);
    }
  });

  it('points every fixture at existing evidence files that contain at least one assertion token', () => {
    expect(AI_QUALITY_FIXTURES.length).toBeGreaterThan(0);

    for (const fixture of AI_QUALITY_FIXTURES) {
      const source = fixture.evidenceFiles.map(file => {
        const absolute = resolve(ROOT_DIR, file);
        expect(existsSync(absolute), `${fixture.id} missing ${file}`).toBe(true);
        return readFileSync(absolute, 'utf-8').toLowerCase(); // readFile-ok - contract test verifies quality fixture evidence files are real and non-empty.
      }).join('\n');

      const tokens = fixture.assertions.flatMap(assertion => [
        ...(assertion.allOf ?? []),
        ...(assertion.anyOf ?? []),
        ...(assertion.noneOf ?? []),
      ]);
      expect(tokens.length, `${fixture.id} assertion tokens`).toBeGreaterThan(0);
      expect(
        tokens.some(token => source.includes(token.toLowerCase())),
        `${fixture.id} has at least one assertion token in evidence`,
      ).toBe(true);
    }
  });

  it('pins the approved-copy benchmark to private deterministic contracts', () => {
    const fixture = AI_QUALITY_FIXTURES.find(candidate => (
      candidate.id === 'approved-copy-benchmark-private-deterministic-contracts'
    ));

    expect(fixture).toMatchObject({
      pipelineId: 'content-brief-review',
      dimension: 'evidence_grounding',
      severity: 'hard',
    });
    expect(fixture?.evidenceFiles).toEqual(expect.arrayContaining([
      'docs/rules/content-quality-benchmark.md',
      'docs/rules/ai-quality-evals.md',
      'shared/types/content-quality-benchmark.ts',
      'server/domains/content/matrix-generation/audit.ts',
    ]));

    const tokens = fixture?.assertions.flatMap(assertion => [
      ...(assertion.allOf ?? []),
      ...(assertion.anyOf ?? []),
      ...(assertion.noneOf ?? []),
    ]) ?? [];
    expect(tokens).toEqual(expect.arrayContaining([
      'Raw approved HTML',
      'Benchmark reads never modify',
      'Subjective ratings are blinded',
      'must not run in default CI',
      'runMatrixGenerationDeterministicAudit',
      'internal-paths',
    ]));
    expect(fixture?.dimension).not.toBe('prose_quality');
  });

  it('pins natural section structure and approved factual authority in content prompts', () => {
    const fixture = AI_QUALITY_FIXTURES.find(candidate => (
      candidate.id === 'content-prompt-natural-structure-and-factual-authority'
    ));

    expect(fixture).toMatchObject({
      pipelineId: 'content-brief-review',
      dimension: 'evidence_grounding',
      severity: 'hard',
    });
    expect(fixture?.evidenceFiles).toEqual(expect.arrayContaining([
      'server/writing-quality.ts',
      'server/page-type-copy-contract.ts',
      'server/content-posts-ai.ts',
      'server/content-brief.ts',
    ]));

    const tokens = fixture?.assertions.flatMap(assertion => [
      ...(assertion.allOf ?? []),
      ...(assertion.anyOf ?? []),
      ...(assertion.noneOf ?? []),
    ]) ?? [];
    expect(tokens).toEqual(expect.arrayContaining([
      'FACTUAL SPECIFICS AUTHORITY',
      'explicitly labeled verified provider, analytics, or source evidence',
      'provided in the brief, knowledge base, source pack, or live SERP context',
      'SHORT CONVERSION SECTION',
      'DEEP EDUCATIONAL SECTION',
    ]));
  });

  it('reports fixture registry gaps for missing coverage and malformed fixtures', () => {
    const gaps = findAiQualityFixtureGaps([
      {
        id: 'tmp-invalid',
        pipelineId: 'brand-voice-provenance',
        title: 'invalid',
        dimension: 'voice_authority',
        severity: 'hard',
        evidenceFiles: [],
        assertions: [],
        notes: 'test',
      },
    ]);

    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.join(' ')).toContain('Missing AI quality fixture');
    expect(gaps.join(' ')).toContain('has no evidence files');
    expect(gaps.join(' ')).toContain('has no assertions');
  });

  it('documents deterministic-first quality eval policy', () => {
    const doc = readFileSync(RULES_DOC, 'utf-8'); // readFile-ok - docs contract locks AI quality eval policy.

    expect(doc).toContain('Keep deterministic checks first');
    expect(doc).toContain('Extend `scripts/ai-reliability-registry.ts`');
    expect(doc).toContain('Live model evals');
    expect(doc).toContain('warn on quality-score regressions');
  });
});
