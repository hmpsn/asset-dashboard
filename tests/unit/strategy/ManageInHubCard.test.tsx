import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ManageInHubCard } from '../../../src/components/strategy/ManageInHubCard';

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

describe('ManageInHubCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deep-links to the Keyword Hub in-strategy segment', () => {
    render(<MemoryRouter><ManageInHubCard workspaceId="ws1" /></MemoryRouter>);
    expect(screen.getByText('Site Target Keywords')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /manage in keyword hub/i }));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('seo-keywords'));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining('?tab=in_strategy'));
  });
});
