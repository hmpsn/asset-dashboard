import { describe, expect, it } from 'vitest';

import {
  AI_CRITICAL_PIPELINE_IDS,
} from '../../shared/types/ai-reliability.js';
import {
  AI_CRITICAL_PIPELINE_TRACES,
  AI_RELIABILITY_SCENARIOS,
  findAiReliabilityRegistryGaps,
} from '../../scripts/ai-reliability-registry.js';
import {
  buildAiPipelineWiringReport,
} from '../../scripts/report-ai-pipeline-wiring.js';

describe('AI pipeline trace map contracts', () => {
  it('defines exactly one trace per critical pipeline id', () => {
    const ids = AI_CRITICAL_PIPELINE_TRACES.map(trace => trace.id).sort();
    const expected = [...AI_CRITICAL_PIPELINE_IDS].sort();

    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(AI_CRITICAL_PIPELINE_IDS.length);
  });

  it('requires at least one reliability scenario per critical pipeline', () => {
    for (const pipelineId of AI_CRITICAL_PIPELINE_IDS) {
      const count = AI_RELIABILITY_SCENARIOS.filter(scenario => scenario.pipelineId === pipelineId).length;
      expect(count, `${pipelineId} scenario count`).toBeGreaterThan(0);
    }
  });

  it('keeps registry structure gap-free', () => {
    expect(findAiReliabilityRegistryGaps()).toEqual([]);
  });

  it('includes every critical pipeline in the wiring report', () => {
    const report = buildAiPipelineWiringReport();
    expect(report.tracesExpected.sort()).toEqual([...AI_CRITICAL_PIPELINE_IDS].sort());
    expect(report.checks.map(check => check.pipelineId).sort()).toEqual([...AI_CRITICAL_PIPELINE_IDS].sort());
    expect(report.advisoryOnly).toBe(true);
  });
});
