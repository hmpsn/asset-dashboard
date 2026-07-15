import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ClientBrandSummary } from '../../../shared/types/brand-generation';
import { BrandTab } from '../../../src/components/client/BrandTab';

const onSaveBusinessProfile = vi.fn().mockResolvedValue(undefined);

const summary: ClientBrandSummary = {
  workspaceId: 'ws-brand-summary',
  approvedDeliverables: [
    {
      deliverableType: 'mission',
      content: 'Make expert guidance feel **clear and human**.',
      version: 3,
    },
    {
      deliverableType: 'values',
      content: '1. Clarity first\n2. Earn trust',
      version: 2,
    },
  ],
  voiceSummary: 'Warm, clear, and confident — direct sentences with a reassuring rhythm.',
  updatedAt: '2026-07-13T12:00:00.000Z',
};

function renderTab(overrides: Partial<ComponentProps<typeof BrandTab>> = {}) {
  return render(
    <BrandTab
      onSaveBusinessProfile={onSaveBusinessProfile}
      brandSummary={summary}
      {...overrides}
    />,
  );
}

describe('BrandTab client-safe summary', () => {
  it('renders the safe voice summary and approved deliverables', () => {
    renderTab();

    expect(screen.getByText(summary.voiceSummary!)).toBeInTheDocument();
    expect(screen.getByText('Mission Statement')).toBeInTheDocument();
    expect(screen.getByText('Core Values')).toBeInTheDocument();
    expect(screen.getByText(/Make expert guidance feel/)).toBeInTheDocument();
    expect(screen.getByText('2 approved')).toBeInTheDocument();
  });

  it('shows a contextual loading state while the authenticated summary is fetched', () => {
    renderTab({ brandSummary: undefined, brandSummaryLoading: true });

    expect(screen.getByText('Loading your brand foundation...')).toBeInTheDocument();
    expect(screen.queryByText('Brand positioning not yet generated')).not.toBeInTheDocument();
  });

  it('shows an actionable error state and retries the summary request', () => {
    const onRetryBrandSummary = vi.fn();
    renderTab({
      brandSummary: undefined,
      brandSummaryError: true,
      onRetryBrandSummary,
    });

    expect(screen.getByText("We couldn't load your brand foundation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetryBrandSummary).toHaveBeenCalledTimes(1);
  });

  it('shows an honest empty state until an approved brand foundation exists', () => {
    renderTab({
      brandSummary: {
        workspaceId: 'ws-brand-summary',
        approvedDeliverables: [],
        voiceSummary: null,
        updatedAt: '2026-07-13T12:00:00.000Z',
      } satisfies ClientBrandSummary,
    });

    expect(screen.getByText('Brand positioning not yet approved')).toBeInTheDocument();
    expect(screen.getByText(/finalized voice summary and approved brand pieces/i)).toBeInTheDocument();
  });

  it('never renders private review or voice-authority internals', () => {
    const { container } = renderTab();

    expect(container.innerHTML).not.toMatch(/purple-/);
    expect(container).not.toHaveTextContent(/runId|sourceRef|voiceDNA|guardrails|provenance|evidence/i);
  });

  it('identifies the voice as the current finalized authority', () => {
    renderTab({
      brandSummary: {
        ...summary,
        approvedDeliverables: [],
      },
    });

    expect(screen.getByText(/current finalized voice summary/i)).toBeInTheDocument();
    expect(screen.getByText(/authority for brand and content work/i)).toBeInTheDocument();
    expect(screen.queryByText(/calibrated voice summary/i)).not.toBeInTheDocument();
  });

  it('renders malformed reserved fences as prose without instantiating ChatBlocks', () => {
    const malformedRichBlock: ClientBrandSummary = {
      ...summary,
      approvedDeliverables: [{
        deliverableType: 'mission',
        content: 'Approved mission context.\n\n```sparkline\n{}\n```',
        version: 4,
      }],
    };

    expect(() => renderTab({ brandSummary: malformedRichBlock })).not.toThrow();
    const reservedFence = screen.getByText('{}');
    expect(reservedFence.tagName).toBe('CODE');
    expect(reservedFence.closest('pre')).toBeInTheDocument();
  });

  it('keeps approved raw URLs and Markdown destinations visible as inert text', () => {
    const rawUrl = 'https://example.com/approved?one=1&two=2';
    const linkDestination = 'https://docs.example.com/evidence?x=1&y=2';
    const linkedSummary: ClientBrandSummary = {
      ...summary,
      approvedDeliverables: [{
        deliverableType: 'mission',
        content: `Use ${rawUrl}. Read [the evidence](${linkDestination}).`,
        version: 5,
      }],
    };

    const { container } = renderTab({ brandSummary: linkedSummary });

    expect(container).toHaveTextContent(rawUrl);
    expect(container).toHaveTextContent(linkDestination);
    expect(container.querySelector('a')).toBeNull();
  });
});
