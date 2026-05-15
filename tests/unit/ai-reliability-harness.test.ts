import { describe, expect, it } from 'vitest';

import { AI_CRITICAL_PIPELINE_IDS } from '../../shared/types/ai-reliability.js';
import {
  AI_CRITICAL_PIPELINE_TRACES,
  AI_RELIABILITY_SCENARIOS,
} from '../../scripts/ai-reliability-registry.js';
import {
  buildAiReliabilityReport,
  formatAiReliabilityMarkdown,
} from '../../scripts/report-ai-reliability.js';
import {
  buildAiPipelineWiringReport,
  formatAiPipelineWiringMarkdown,
} from '../../scripts/report-ai-pipeline-wiring.js';

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
