import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BrandOverviewTab } from '../../src/components/brand/BrandOverviewTab';
import { useLocalSeoLocations } from '../../src/hooks/admin/useLocalSeoLocations';

vi.mock('../../src/hooks/admin/useLocalSeoLocations', () => ({
  useLocalSeoLocations: vi.fn(),
}));

const mockUseLocalSeoLocations = vi.mocked(useLocalSeoLocations);

describe('BrandOverviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseLocalSeoLocations.mockReturnValue({
      data: [
        { id: 'loc-1', status: 'confirmed' },
        { id: 'loc-2', status: 'needs_review' },
      ],
    } as ReturnType<typeof useLocalSeoLocations>);
  });

  it('renders overview snapshot cards with canonical business-footprint links', () => {
    render(
      <MemoryRouter>
        <BrandOverviewTab
          workspaceId="ws-1"
          brandVoice="Confident and clear."
          knowledgeBase="We help local businesses grow."
          personasCount={2}
          businessContext="Austin dental practice serving families."
          intelligenceProfile={{ industry: 'Dental', goals: ['Grow'], targetAudience: 'Families' }}
          businessProfile={{ phone: '+1 512 555 0100', address: { city: 'Austin', state: 'TX' } }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Current Context')).toBeInTheDocument();
    expect(screen.getByText('Intelligence Profile')).toBeInTheDocument();
    expect(screen.getByText('Business Profile')).toBeInTheDocument();
    expect(screen.getByText('Locations')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open business footprint/i })).toHaveAttribute('href', '/ws/ws-1/brand?tab=business-footprint&focus=business-profile-section');
    expect(screen.getByRole('link', { name: /manage locations/i })).toHaveAttribute('href', '/ws/ws-1/brand?tab=business-footprint&focus=locations-section');
  });

  it('scrolls to the current-context section when review below is clicked', () => {
    const scrollIntoView = vi.fn();
    const anchor = document.createElement('div');
    anchor.id = 'brand-hub-current-context';
    anchor.scrollIntoView = scrollIntoView;
    document.body.appendChild(anchor);

    render(
      <MemoryRouter>
        <BrandOverviewTab
          workspaceId="ws-1"
          personasCount={0}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /review below/i }));
    expect(scrollIntoView).toHaveBeenCalled();

    document.body.removeChild(anchor);
  });
});
