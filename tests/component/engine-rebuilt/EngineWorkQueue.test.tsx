import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EngineWorkQueue } from '../../../src/components/engine-rebuilt/EngineWorkQueue';
import type { WorkQueueClassification } from '../../../shared/types/work-queue';

const WORK_QUEUE: WorkQueueClassification = {
  streams: { opt: 0, send: 0, money: 1, unclassified: 1 },
  items: [
    {
      id: 'growth-1',
      stream: 'money',
      sourceType: 'work_order',
      title: 'Package the measured expansion opportunity',
      meta: 'Measured client value',
    },
    {
      id: 'triage-1',
      stream: 'unclassified',
      sourceType: 'churn_signal',
      title: 'Review the new client signal',
      meta: 'Needs an operator decision',
    },
  ],
};

describe('EngineWorkQueue say-it-aloud vocabulary', () => {
  it('uses Growth and Needs triage with plain-language descriptions', () => {
    render(
      <EngineWorkQueue
        workQueue={WORK_QUEUE}
        stream="all"
        onStreamChange={vi.fn()}
        activeSourceTypes={new Set()}
        sourceTypeCounts={{ work_order: 1, churn_signal: 1 }}
        onToggleSourceType={vi.fn()}
        onClearSourceTypes={vi.fn()}
        clientName="Acme"
        clientInitials="AC"
        onOpenItem={vi.fn()}
      />,
    );

    expect(screen.getByText('Growth')).toBeInTheDocument();
    expect(screen.getByText('Growth queue')).toBeInTheDocument();
    expect(screen.getAllByText('Upsell and value-proof work backed by measured results.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Needs triage').length).toBeGreaterThan(0);
    expect(screen.getByText('Client signals and anything not yet sorted')).toBeInTheDocument();
    expect(screen.queryByText('Money')).not.toBeInTheDocument();
    expect(screen.queryByText('Risk and unclassified')).not.toBeInTheDocument();
  });
});
