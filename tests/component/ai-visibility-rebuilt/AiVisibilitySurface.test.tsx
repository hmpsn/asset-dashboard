import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rankTracking, type AiVisibilityReadResponse } from '../../../src/api/seo';
import { AiVisibilitySurface } from '../../../src/components/ai-visibility-rebuilt/AiVisibilitySurface';
import { expectNoA11yViolations } from '../a11y';

const VISIBILITY_DATA: AiVisibilityReadResponse = {
  latest: {
    workspaceId: 'ws-1',
    snapshotDate: '2026-07-16',
    platform: 'chat_gpt',
    domain: 'acme.example',
    mentions: 84,
    aiSearchVolume: 920,
    shareOfVoice: 0.44,
    competitors: [{ name: 'Example competitor', mentions: 22 }],
    sourceDomains: [{ domain: 'source.example', mentions: 18 }],
    fetchedAt: '2026-07-16T12:00:00.000Z',
  },
  trend: [
    { date: '2026-07-01', mentions: 63, shareOfVoice: 0.35 },
    { date: '2026-07-16', mentions: 84, shareOfVoice: 0.44 },
  ],
  competitors: [{ name: 'Example competitor', mentions: 22 }],
  sourceDomains: [{ domain: 'source.example', mentions: 18 }],
};

function renderSurface() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/ws/ws-1/ai-visibility']}>
        <AiVisibilitySurface workspaceId="ws-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AI Visibility rebuilt surface', () => {
  beforeEach(() => {
    vi.spyOn(rankTracking, 'aiVisibility').mockResolvedValue(VISIBILITY_DATA);
    vi.spyOn(rankTracking, 'refreshAiVisibility').mockResolvedValue({ jobId: 'job-existing-llm-refresh' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders share of voice, mention trend, source domains, and Refresh exactly once', async () => {
    renderSurface();

    expect(await screen.findByText('44%')).toBeInTheDocument();
    expect(screen.getAllByText(/share of voice vs co-mentioned brands/i)).toHaveLength(1);
    expect(screen.getAllByText('Mention volume over time')).toHaveLength(1);
    expect(screen.getAllByText('Cited source domains (AEO targets)')).toHaveLength(1);
    expect(screen.getAllByText('source.example')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Refresh AI visibility' })).toHaveLength(1);
  });

  it('fires the existing AI visibility refresh job through the established API client', async () => {
    renderSurface();

    const refresh = await screen.findByRole('button', { name: 'Refresh AI visibility' });
    fireEvent.click(refresh);

    await waitFor(() => {
      expect(rankTracking.refreshAiVisibility).toHaveBeenCalledTimes(1);
      expect(rankTracking.refreshAiVisibility).toHaveBeenCalledWith('ws-1');
    });
  });

  it('carries the @ds-rebuilt accessibility floor', async () => {
    const { container } = renderSurface();

    // Wait for the populated state to render before scanning (the panel loads async).
    await screen.findByText('44%');
    await expectNoA11yViolations(container);
  });
});
