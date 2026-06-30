import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BusinessFootprintTab } from '../../src/components/settings/BusinessFootprintTab';

vi.mock('../../src/components/settings/BusinessProfileTab', () => ({
  BusinessProfileTab: () => <div data-testid="business-profile-tab">BusinessProfileTabStub</div>,
}));

vi.mock('../../src/components/settings/LocationsTab', () => ({
  LocationsTab: () => <div data-testid="locations-tab">LocationsTabStub</div>,
}));

// The flag-gated <FeatureFlag flag="geo-targeting"> wrapper calls useFeatureFlag →
// useQuery; mock it OFF so these structure tests don't need a QueryClientProvider and
// the geo editor (covered by TargetGeoEditor.test.tsx) stays hidden.
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => false,
}));

describe('BusinessFootprintTab', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders both business profile and locations editors in one surface', () => {
    render(
      <MemoryRouter>
        <BusinessFootprintTab
          workspaceId="ws-1"
          workspaceName="Acme Corp"
          toast={vi.fn()}
          onBusinessProfileSave={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Business Footprint')).toBeInTheDocument();
    expect(screen.getByTestId('business-profile-tab')).toBeInTheDocument();
    expect(screen.getByTestId('locations-tab')).toBeInTheDocument();
  });

  it('keeps business profile and locations sections separately labeled', () => {
    render(
      <MemoryRouter>
        <BusinessFootprintTab
          workspaceId="ws-1"
          workspaceName="Acme Corp"
          toast={vi.fn()}
          onBusinessProfileSave={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/schema and contact authority/i)).toBeInTheDocument();
    expect(screen.getByText(/local seo business matching and market setup/i)).toBeInTheDocument();
  });

  it('supports canonical focus links to the locations section', async () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <MemoryRouter initialEntries={['/ws/ws-1/brand?tab=business-footprint&focus=locations-section']}>
        <BusinessFootprintTab
          workspaceId="ws-1"
          workspaceName="Acme Corp"
          toast={vi.fn()}
          onBusinessProfileSave={vi.fn()}
        />
      </MemoryRouter>,
    );

    vi.advanceTimersByTime(60);
    expect(scrollIntoView).toHaveBeenCalled();

    Element.prototype.scrollIntoView = original;
  });

  it('supports canonical focus links to the business profile section', () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <MemoryRouter initialEntries={['/ws/ws-1/brand?tab=business-footprint&focus=business-profile-section']}>
        <BusinessFootprintTab
          workspaceId="ws-1"
          workspaceName="Acme Corp"
          toast={vi.fn()}
          onBusinessProfileSave={vi.fn()}
        />
      </MemoryRouter>,
    );

    vi.advanceTimersByTime(60);
    expect(scrollIntoView).toHaveBeenCalled();

    Element.prototype.scrollIntoView = original;
  });
});
