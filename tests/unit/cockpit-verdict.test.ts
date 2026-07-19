import { describe, expect, it } from 'vitest';
import { buildCockpitVerdict } from '../../server/domains/cockpit-verdict.js';
import type { WorkQueueClassification } from '../../shared/types/work-queue.js';

function workQueue(streams: WorkQueueClassification['streams']): WorkQueueClassification {
  return { streams, items: [] };
}

describe('buildCockpitVerdict display vocabulary', () => {
  it('describes the internal unclassified stream as work not yet sorted', () => {
    const verdict = buildCockpitVerdict({
      workQueue: workQueue({ opt: 0, send: 0, money: 0, unclassified: 4 }),
      generatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    expect(verdict.status).toBe('at_risk');
    expect(verdict.narrative).toBe(
      '0 risk signals and 4 items not yet sorted need triage before this workspace reads as steady.',
    );
    expect(verdict.narrative).not.toContain('unclassified');
  });

  it('describes the internal money stream as growth plays', () => {
    const verdict = buildCockpitVerdict({
      workQueue: workQueue({ opt: 1, send: 2, money: 3, unclassified: 0 }),
      generatedAt: new Date('2026-07-17T12:00:00.000Z'),
    });

    expect(verdict.status).toBe('watch');
    expect(verdict.narrative).toBe(
      '2 send items, 1 optimization item, and 3 growth plays are waiting in the shared work queue.',
    );
    expect(verdict.narrative).not.toContain('money item');
  });
});
