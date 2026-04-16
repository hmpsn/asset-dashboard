import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BacklinkProfile } from '../../src/components/strategy/BacklinkProfile';

// Mock the API module
vi.mock('../../src/api', () => ({
  backlinks: {
    get: vi.fn(),
  },
}));

import { backlinks } from '../../src/api';

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
  });

  it('hides Link Types stat card when all link type counts are 0', async () => {
    vi.mocked(backlinks.get).mockResolvedValue({
      domain: 'example.com',
      overview: { ...baseOverview },
      referringDomains: [],
    });

    render(<BacklinkProfile workspaceId="test-workspace" />);
    await screen.findByText('Backlink Profile');
    expect(screen.queryByText('Link Types')).not.toBeInTheDocument();
  });

  it('shows Link Types stat card when textLinks > 0', async () => {
    vi.mocked(backlinks.get).mockResolvedValue({
      domain: 'example.com',
      overview: { ...baseOverview, textLinks: 750 },
      referringDomains: [],
    });

    render(<BacklinkProfile workspaceId="test-workspace" />);
    await screen.findByText('Backlink Profile');
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows Link Types stat card when imageLinks > 0', async () => {
    vi.mocked(backlinks.get).mockResolvedValue({
      domain: 'example.com',
      overview: { ...baseOverview, imageLinks: 50 },
      referringDomains: [],
    });

    render(<BacklinkProfile workspaceId="test-workspace" />);
    await screen.findByText('Backlink Profile');
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows Link Types stat card when formLinks > 0', async () => {
    vi.mocked(backlinks.get).mockResolvedValue({
      domain: 'example.com',
      overview: { ...baseOverview, formLinks: 5 },
      referringDomains: [],
    });

    render(<BacklinkProfile workspaceId="test-workspace" />);
    await screen.findByText('Backlink Profile');
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows Link Types stat card when frameLinks > 0', async () => {
    vi.mocked(backlinks.get).mockResolvedValue({
      domain: 'example.com',
      overview: { ...baseOverview, frameLinks: 3 },
      referringDomains: [],
    });

    render(<BacklinkProfile workspaceId="test-workspace" />);
    await screen.findByText('Backlink Profile');
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows Link Types stat card when both textLinks and imageLinks > 0', async () => {
    vi.mocked(backlinks.get).mockResolvedValue({
      domain: 'example.com',
      overview: { ...baseOverview, textLinks: 750, imageLinks: 50 },
      referringDomains: [],
    });

    render(<BacklinkProfile workspaceId="test-workspace" />);
    await screen.findByText('Backlink Profile');
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });
});
