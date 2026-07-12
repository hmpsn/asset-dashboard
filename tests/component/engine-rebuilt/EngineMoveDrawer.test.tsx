import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { EngineMoveDrawer } from '../../../src/components/engine-rebuilt/EngineMoveDrawer';
import type { Recommendation } from '../../../shared/types/recommendations';
import { expectNoA11yViolations } from '../a11y';

const recommendation: Recommendation = {
  id: 'rec-detail',
  workspaceId: 'ws-engine',
  priority: 'fix_now',
  type: 'content',
  title: 'Refresh the implant page',
  description: 'Refresh stale content around dental implants.',
  insight: 'Search demand is rising and the page is stale.',
  impact: 'high',
  effort: 'low',
  impactScore: 88,
  source: 'strategy',
  affectedPages: ['/implant'],
  trafficAtRisk: 120,
  impressionsAtRisk: 2400,
  estimatedGain: 'More qualified implant visits',
  actionType: 'manual',
  status: 'pending',
  clientStatus: 'system',
  lifecycle: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const cannibalizationRecommendation: Recommendation = {
  ...recommendation,
  id: 'rec-cannibalization',
  type: 'cannibalization',
  title: 'Consolidate implant cost pages',
  targetKeyword: 'dental implant cost',
};

const cannibalizationEntries = [{
  keyword: 'dental implant cost',
  severity: 'high' as const,
  recommendation: 'Keep the service page and consolidate the competing guide.',
  canonicalPath: '/services/implants',
  action: 'differentiate' as const,
  pages: [
    { path: '/services/implants', position: 7, impressions: 900, clicks: 70, source: 'gsc' as const },
    { path: '/guides/implant-cost', position: 11, impressions: 640, clicks: 28, source: 'gsc' as const },
  ],
}];

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('EngineMoveDrawer', () => {
  it('keeps detail read-only so lifecycle controls have one home in the backing queue', async () => {
    const { container } = render(
      <EngineMoveDrawer
        open
        rec={recommendation}
        cannibalizationEntries={[]}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Refresh the implant page' });
    expect(within(dialog).getByText('Search demand is rising and the page is stale.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Stage for issue' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Fix' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Park' })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('renders cannibalization rationale and page evidence without writable workflow controls', async () => {
    const { container } = render(
      <EngineMoveDrawer
        open
        rec={cannibalizationRecommendation}
        cannibalizationEntries={cannibalizationEntries}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Consolidate implant cost pages' });
    expect(within(dialog).getByText('Cannibalization evidence')).toBeInTheDocument();
    expect(within(dialog).getByText('dental implant cost')).toBeInTheDocument();
    expect(within(dialog).getByText('/services/implants')).toBeInTheDocument();
    expect(within(dialog).getByText('/guides/implant-cost')).toBeInTheDocument();
    expect(within(dialog).getByText('Keeper')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /send to client/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /mark resolved/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /fix in editor/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /set as keeper/i })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
