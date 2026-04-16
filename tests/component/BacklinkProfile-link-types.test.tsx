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

describe('BacklinkProfile - Link Types stat card visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides Link Types stat card when textLinks and imageLinks are both 0', async () => {
    const mockData = {
      domain: 'example.com',
      overview: {
        totalBacklinks: 100,
        referringDomains: 50,
        followLinks: 80,
        nofollowLinks: 20,
        textLinks: 0,
        imageLinks: 0,
      },
      referringDomains: [],
    };

    vi.mocked(backlinks.get).mockResolvedValue(mockData as any);

    render(<BacklinkProfile workspaceId="test-workspace" />);

    // Wait for data to load
    await screen.findByText('Backlink Profile');

    // Assert that "Link Types" label is NOT present
    expect(screen.queryByText('Link Types')).not.toBeInTheDocument();
  });

  it('shows Link Types stat card when textLinks > 0', async () => {
    const mockData = {
      domain: 'example.com',
      overview: {
        totalBacklinks: 100,
        referringDomains: 50,
        followLinks: 80,
        nofollowLinks: 20,
        textLinks: 750,
        imageLinks: 0,
      },
      referringDomains: [],
    };

    vi.mocked(backlinks.get).mockResolvedValue(mockData as any);

    render(<BacklinkProfile workspaceId="test-workspace" />);

    // Wait for data to load
    await screen.findByText('Backlink Profile');

    // Assert that "Link Types" label IS present
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows Link Types stat card when imageLinks > 0', async () => {
    const mockData = {
      domain: 'example.com',
      overview: {
        totalBacklinks: 100,
        referringDomains: 50,
        followLinks: 80,
        nofollowLinks: 20,
        textLinks: 0,
        imageLinks: 50,
      },
      referringDomains: [],
    };

    vi.mocked(backlinks.get).mockResolvedValue(mockData as any);

    render(<BacklinkProfile workspaceId="test-workspace" />);

    // Wait for data to load
    await screen.findByText('Backlink Profile');

    // Assert that "Link Types" label IS present
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });

  it('shows Link Types stat card when both textLinks and imageLinks > 0', async () => {
    const mockData = {
      domain: 'example.com',
      overview: {
        totalBacklinks: 100,
        referringDomains: 50,
        followLinks: 80,
        nofollowLinks: 20,
        textLinks: 750,
        imageLinks: 50,
      },
      referringDomains: [],
    };

    vi.mocked(backlinks.get).mockResolvedValue(mockData as any);

    render(<BacklinkProfile workspaceId="test-workspace" />);

    // Wait for data to load
    await screen.findByText('Backlink Profile');

    // Assert that "Link Types" label IS present
    expect(screen.getByText('Link Types')).toBeInTheDocument();
  });
});
