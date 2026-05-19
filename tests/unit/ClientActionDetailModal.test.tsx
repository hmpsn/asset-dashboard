import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ClientActionDetailModal } from '../../src/components/client/ClientActionDetailModal';
import type { ClientAction } from '../../shared/types/client-actions';

const baseAction: ClientAction = {
  id: 'ca_1',
  workspaceId: 'ws_1',
  sourceType: 'internal_link',
  sourceId: 'internal-links:test',
  title: 'Internal link recommendations',
  summary: 'Review these links.',
  payload: {
    suggestions: [
      {
        anchorText: 'Learn more',
        targetUrl: '/services',
        sourcePageUrl: '/about',
        sourcePageTitle: 'About Us',
      },
    ],
  },
  status: 'pending',
  priority: 'medium',
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
};

describe('ClientActionDetailModal internal link rendering', () => {
  it('renders title and URL in separate columns and keeps missing titles as em dash', () => {
    render(
      <ClientActionDetailModal
        action={baseAction}
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Target title')).toBeInTheDocument();
    expect(screen.getByText('Target URL')).toBeInTheDocument();
    expect(screen.getByText('Source title')).toBeInTheDocument();
    expect(screen.getByText('Source URL')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1];
    const cells = within(firstDataRow).getAllByRole('cell');

    expect(cells[1].textContent).toBe('—');
    expect(cells[2].textContent).toContain('/services');
    expect(cells[3].textContent).toBe('About Us');
    expect(cells[4].textContent).toBe('/about');
  });
});
