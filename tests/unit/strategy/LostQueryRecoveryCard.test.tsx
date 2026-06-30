import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LostQueryRecoveryCard } from '../../../src/components/strategy/LostQueryRecoveryCard';
import type { LostVisibilityData } from '../../../shared/types/analytics';

const state = vi.hoisted(() => ({ data: null as LostVisibilityData | null }));
vi.mock('../../../src/hooks/admin/useLostVisibility', () => ({
  useLostVisibility: () => ({ data: state.data, isLoading: false }),
}));
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

describe('LostQueryRecoveryCard', () => {
  beforeEach(() => { vi.clearAllMocks(); state.data = null; });

  it('renders null when there is no lost_visibility insight', () => {
    const { container } = render(<MemoryRouter><LostQueryRecoveryCard workspaceId="ws1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders null when topQueries is empty', () => {
    state.data = { lostCount: 0, detectedAt: '2026-06-01', topQueries: [] };
    const { container } = render(<MemoryRouter><LostQueryRecoveryCard workspaceId="ws1" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders lost queries and routes the recovery CTA with the top query as keyword', () => {
    state.data = {
      lostCount: 2, detectedAt: '2026-06-01',
      topQueries: [
        { query: 'best crm', lastPosition: 7, lastSeen: '2026-05-01', totalImpressions: 900 },
        { query: 'crm pricing', lastPosition: null, lastSeen: '2026-04-01', totalImpressions: 300 },
      ],
    };
    render(<MemoryRouter><LostQueryRecoveryCard workspaceId="ws1" /></MemoryRouter>);
    expect(screen.getByText('best crm')).toBeInTheDocument();
    expect(screen.getByText('unranked')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create recovery content/i }));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.stringContaining('content-pipeline'),
      expect.objectContaining({
        state: { fixContext: expect.objectContaining({ targetRoute: 'content-pipeline', primaryKeyword: 'best crm', autoGenerate: true }) },
      }),
    );
  });
});
