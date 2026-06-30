import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { BacklinkData } from '../../src/api/seo';
import { BacklinkProfile } from '../../src/components/strategy/BacklinkProfile';

// BacklinkProfile now reads via the useBacklinkProfile React Query hook — mock the hook
// (mirrors the DecayingPagesCard/useContentDecay test pattern) so no QueryClientProvider is needed.
const state = vi.hoisted(() => ({
  data: null as BacklinkData | null,
  isLoading: false,
  error: null as Error | null,
}));
vi.mock('../../src/hooks/admin/useBacklinkProfile', () => ({
  useBacklinkProfile: () => ({ data: state.data, isLoading: state.isLoading, error: state.error }),
}));

const baseOverview = {
  totalBacklinks: 100,
  referringDomains: 50,
  followLinks: 80,
  nofollowLinks: 20,
  textLinks: 0,
  imageLinks: 0,
  formLinks: 0,
  frameLinks: 0,
};

describe('BacklinkProfile - Link Types stat card visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.data = null;
    state.isLoading = false;
    state.error = null;
  });

  it('hides Link Types stat card when all link type counts are 0', () => {
    state.data = { domain: 'example.com', overview: { ...baseOverview }, referringDomains: [] };
    render(<BacklinkProfile workspaceId="test-workspace" />);
    expect(screen.getByText('Backlink Profile')).toBeInTheDocument();
    expect(screen.queryByText('Link Types')).not.toBeInTheDocument();
  });

  it('shows Link Types stat card when textLinks > 0', () => {
    state.data = { domain: 'example.com', overview: { ...baseOverview, textLinks: 750 }, referringDomains: [] };
    render(<BacklinkProfile workspaceId="test-workspace" />);
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows Link Types stat card when imageLinks > 0', () => {
    state.data = { domain: 'example.com', overview: { ...baseOverview, imageLinks: 50 }, referringDomains: [] };
    render(<BacklinkProfile workspaceId="test-workspace" />);
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows Link Types stat card when formLinks > 0', () => {
    state.data = { domain: 'example.com', overview: { ...baseOverview, formLinks: 5 }, referringDomains: [] };
    render(<BacklinkProfile workspaceId="test-workspace" />);
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows Link Types stat card when frameLinks > 0', () => {
    state.data = { domain: 'example.com', overview: { ...baseOverview, frameLinks: 3 }, referringDomains: [] };
    render(<BacklinkProfile workspaceId="test-workspace" />);
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows Link Types stat card when both textLinks and imageLinks > 0', () => {
    state.data = { domain: 'example.com', overview: { ...baseOverview, textLinks: 750, imageLinks: 50 }, referringDomains: [] };
    render(<BacklinkProfile workspaceId="test-workspace" />);
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows the DataForSEO-required message on a no-provider error', () => {
    state.error = new Error('No SEO data provider configured. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to enable backlink data.');
    render(<BacklinkProfile workspaceId="test-workspace" />);
    expect(screen.getByText(/requires DataForSEO/i)).toBeInTheDocument();
  });
});
