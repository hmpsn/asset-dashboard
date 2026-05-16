import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RedirectManager } from '../../src/components/RedirectManager';

const snapshotMock = vi.fn();
const scanMock = vi.fn();

vi.mock('../../src/api/misc', () => ({
  redirects: {
    snapshot: (...args: unknown[]) => snapshotMock(...args),
    scan: (...args: unknown[]) => scanMock(...args),
  },
}));

vi.mock('../../src/api/clientActions', () => ({
  clientActions: {
    create: vi.fn(),
  },
}));

function sampleResult() {
  return {
    chains: [],
    pageStatuses: [
      {
        url: 'https://acme.test/old-page',
        path: '/old-page',
        title: 'Old Page',
        status: 404,
        statusText: 'Not Found',
        recommendedTarget: '/new-page',
        recommendedReason: 'Consolidated to new URL',
        source: 'static' as const,
      },
    ],
    summary: {
      totalPages: 1,
      healthy: 0,
      redirecting: 0,
      notFound: 1,
      errors: 0,
      chainsDetected: 0,
      longestChain: 0,
    },
    scannedAt: '2026-05-16T00:00:00.000Z',
  };
}

describe('RedirectManager', () => {
  beforeEach(() => {
    snapshotMock.mockReset();
    scanMock.mockReset();
  });

  it('renders the scanner entry state when no snapshot exists', async () => {
    snapshotMock.mockResolvedValue(null);

    render(<RedirectManager siteId="site-1" workspaceId="ws-1" />);

    expect(await screen.findByText('Redirect Scanner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan Redirects' })).toBeInTheDocument();
  });

  it('runs scan and renders redirect manager results', async () => {
    snapshotMock.mockResolvedValue(null);

    let resolveScan: ((value: ReturnType<typeof sampleResult>) => void) | null = null;
    const scanPromise = new Promise<ReturnType<typeof sampleResult>>((resolve) => {
      resolveScan = resolve;
    });
    scanMock.mockReturnValue(scanPromise);

    render(<RedirectManager siteId="site-1" workspaceId="ws-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Scan Redirects' }));
    expect(screen.getByText('Scanning redirects... this may take a minute')).toBeInTheDocument();

    resolveScan?.(sampleResult());

    expect(await screen.findByText('Redirect Manager')).toBeInTheDocument();
    expect(screen.getByText('Redirect Recommendations')).toBeInTheDocument();
    expect(scanMock).toHaveBeenCalledWith('site-1', 'ws-1');
  });
});
