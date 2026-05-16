import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AssetAudit } from '../../src/components/AssetAudit';

const getMock = vi.fn();
const postMock = vi.fn();
const delMock = vi.fn();

vi.mock('../../src/api/client', () => ({
  get: (...args: unknown[]) => getMock(...args),
  post: (...args: unknown[]) => postMock(...args),
  del: (...args: unknown[]) => delMock(...args),
}));

function sampleAudit() {
  return {
    totalAssets: 12,
    issueCount: 3,
    missingAlt: 1,
    oversized: 1,
    unused: 1,
    duplicates: 0,
    lowQualityAlt: 0,
    duplicateAlt: 0,
    issues: [
      {
        assetId: 'asset-1',
        fileName: 'hero.jpg',
        url: 'https://cdn.test/hero.jpg',
        fileSize: 620000,
        issues: ['missing-alt'],
        usedIn: ['/home'],
      },
    ],
  };
}

describe('AssetAudit', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    delMock.mockReset();
  });

  it('renders the pre-scan state', () => {
    render(<AssetAudit siteId="site-1" workspaceId="ws-1" />);

    expect(screen.getByText('Scan your Webflow site for asset issues')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Asset Audit' })).toBeInTheDocument();
  });

  it('runs audit and renders summary cards', async () => {
    getMock.mockResolvedValue(sampleAudit());

    render(<AssetAudit siteId="site-1" workspaceId="ws-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Run Asset Audit' }));

    expect(screen.getByText('Scanning published pages, CMS collections, CSS, and assets...')).toBeInTheDocument();

    expect(await screen.findByText('Health Score')).toBeInTheDocument();
    expect(screen.getAllByText('Missing Alt Text').length).toBeGreaterThan(0);
    expect(screen.getByText('Oversized')).toBeInTheDocument();

    expect(getMock).toHaveBeenCalledWith('/api/webflow/audit/site-1?workspaceId=ws-1');
  });
});
