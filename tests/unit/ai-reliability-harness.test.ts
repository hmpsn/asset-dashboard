import { describe, expect, it } from 'vitest';

import { AI_CRITICAL_PIPELINE_IDS } from '../../shared/types/ai-reliability.js';
import {
  AI_CRITICAL_PIPELINE_TRACES,
  AI_QUALITY_FIXTURES,
  AI_RELIABILITY_SCENARIOS,
} from '../../scripts/ai-reliability-registry.js';
import {
  buildAiReliabilityReport,
  formatAiReliabilityMarkdown,
} from '../../scripts/report-ai-reliability.js';
import {
  buildAiQualityReport,
  formatAiQualityMarkdown,
} from '../../scripts/report-ai-quality.js';
import {
  buildAiPipelineWiringReport,
  formatAiPipelineWiringMarkdown,
} from '../../scripts/report-ai-pipeline-wiring.js';
import type { AiQualityFixture } from '../../shared/types/ai-reliability.js';

describe('ai reliability harness', () => {
  it('emits stable advisory JSON for the reliability report', () => {
    const report = buildAiReliabilityReport();
    const parsed = JSON.parse(JSON.stringify(report, null, 2)) as typeof report;

    expect(parsed.generatedBy).toBe('scripts/report-ai-reliability.ts');
    expect(parsed.advisoryOnly).toBe(true);
    expect(parsed.pipelineScores.map(score => score.pipelineId).sort()).toEqual([...AI_CRITICAL_PIPELINE_IDS].sort());
    expect(parsed.traces.map(trace => trace.id).sort()).toEqual([...AI_CRITICAL_PIPELINE_IDS].sort());
    expect(parsed.scenarioResults.length).toBe(AI_RELIABILITY_SCENARIOS.length);
  });

  it('produces one score row per trace definition', () => {
    const report = buildAiReliabilityReport();
    expect(report.pipelineScores).toHaveLength(AI_CRITICAL_PIPELINE_TRACES.length);
    for (const score of report.pipelineScores) {
      expect(score.total, `${score.pipelineId} scenario total`).toBeGreaterThan(0);
    }
  });

  it('defines deterministic quality fixtures for the quality-targeted pipelines', () => {
    expect(AI_QUALITY_FIXTURES.length).toBeGreaterThan(0);
    expect(AI_QUALITY_FIXTURES.map(fixture => fixture.pipelineId)).toContain('brand-voice-provenance');
    expect(AI_QUALITY_FIXTURES.map(fixture => fixture.dimension)).toContain('voice_authority');
    expect(AI_QUALITY_FIXTURES.map(fixture => fixture.dimension)).toContain('output_format');
  });

  it('emits stable advisory JSON for the quality report', () => {
    const report = buildAiQualityReport();
    const parsed = JSON.parse(JSON.stringify(report, null, 2)) as typeof report;

    expect(parsed.generatedBy).toBe('scripts/report-ai-quality.ts');
    expect(parsed.advisoryOnly).toBe(true);
    expect(parsed.fixtures.length).toBe(AI_QUALITY_FIXTURES.length);
    expect(parsed.fixtureResults.length).toBe(AI_QUALITY_FIXTURES.length);
    expect(parsed.pipelineScores.map(score => score.pipelineId).sort()).toEqual([
      'admin-insights-chat',
      'brand-voice-provenance',
      'client-search-chat',
      'content-brief-review',
      'diagnostic-synthesis',
      'seo-editor-assist',
    ]);
  });

  it('marks hard quality fixture failures as hard failures', () => {
    const fixture: AiQualityFixture = {
      id: 'tmp-hard-quality-failure',
      pipelineId: 'brand-voice-provenance',
      title: 'missing hard evidence',
      dimension: 'voice_authority',
      severity: 'hard',
      evidenceFiles: ['tests/unit/does-not-exist.test.ts'],
      assertions: [{ anyOf: ['nope'] }],
      notes: 'test',
    };

    const report = buildAiQualityReport([fixture], ['brand-voice-provenance']);

    expect(report.hardFailures.length).toBeGreaterThan(0);
    expect(report.hardFailures.join(' ')).toContain('tmp-hard-quality-failure');
  });

  it('keeps soft quality fixture failures advisory', () => {
    const fixture: AiQualityFixture = {
      id: 'tmp-soft-quality-warning',
      pipelineId: 'admin-insights-chat',
      title: 'soft warning',
      dimension: 'prose_quality',
      severity: 'soft',
      evidenceFiles: ['docs/rules/ai-quality-evals.md'],
      assertions: [{ allOf: ['definitely-not-present-in-this-file'] }],
      notes: 'test',
    };

    const report = buildAiQualityReport([fixture], ['admin-insights-chat']);

    expect(report.hardFailures).toEqual([]);
    expect(report.warnings.join(' ')).toContain('tmp-soft-quality-warning');
  });

  it('hard-fails missing evidence files even for soft quality fixtures', () => {
    const fixture: AiQualityFixture = {
      id: 'tmp-soft-missing-evidence',
      pipelineId: 'admin-insights-chat',
      title: 'soft missing evidence',
      dimension: 'prose_quality',
      severity: 'soft',
      evidenceFiles: ['tests/unit/does-not-exist.test.ts'],
      assertions: [{ anyOf: ['nope'] }],
      notes: 'test',
    };

    const report = buildAiQualityReport([fixture], ['admin-insights-chat']);

    expect(report.hardFailures.join(' ')).toContain('tmp-soft-missing-evidence');
    expect(report.warnings.join(' ')).not.toContain('tmp-soft-missing-evidence');
  });

  it('emits markdown quality report sections for humans', () => {
    const markdown = formatAiQualityMarkdown();
    expect(markdown).toContain('# AI Quality Fixture Report');
    expect(markdown).toContain('Fixture Results');
    expect(markdown).toContain('brand-voice-authority-layering');
    expect(markdown).toContain('client-search-chat-clean-prose-and-intent-format');
  });

  it('marks missing evidence as hard failures for hard scenarios', () => {
    const report = buildAiReliabilityReport([
      {
        id: 'tmp-missing-evidence',
        pipelineId: 'schema-generation-review',
        title: 'missing file',
        failureClass: 'invalid_output',
        severity: 'hard',
        evidenceFiles: ['tests/integration/does-not-exist.test.ts'],
        assertions: [{ anyOf: ['nope'] }],
        notes: 'test',
      },
    ]);

    expect(report.hardFailures.length).toBeGreaterThan(0);
    expect(report.hardFailures.join(' ')).toContain('tmp-missing-evidence');
  });

  it('emits markdown report sections for humans', () => {
    const markdown = formatAiReliabilityMarkdown();
    expect(markdown).toContain('# AI Reliability Harness Report');
    expect(markdown).toContain('Ranked Optimization Backlog');
    expect(markdown).toContain('schema-generation-review');
    expect(markdown).toContain('brand-voice-provenance');
  });

  it('emits stable advisory JSON for pipeline wiring', () => {
    const report = buildAiPipelineWiringReport();
    const parsed = JSON.parse(JSON.stringify(report, null, 2)) as typeof report;

    expect(parsed.generatedBy).toBe('scripts/report-ai-pipeline-wiring.ts');
    expect(parsed.advisoryOnly).toBe(true);
    expect(parsed.tracesExpected.sort()).toEqual([...AI_CRITICAL_PIPELINE_IDS].sort());
    expect(parsed.checks.map(check => check.pipelineId).sort()).toEqual([...AI_CRITICAL_PIPELINE_IDS].sort());
  });

  it('formats wiring markdown for human review', () => {
    const markdown = formatAiPipelineWiringMarkdown();
    expect(markdown).toContain('# AI Pipeline Wiring Report');
    expect(markdown).toContain('Wiring gaps:');
    expect(markdown).toContain('admin-insights-chat');
  });
});
