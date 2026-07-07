import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeadLinkPanel } from '../../src/components/audit/DeadLinkPanel';
import type { DeadLinkItem } from '../../src/components/audit/types';

const deadLink: DeadLinkItem = {
  url: '/old-page',
  status: 404,
  statusText: 'Not Found',
  foundOn: 'Services',
  foundOnSlug: 'services',
  anchorText: 'Old page',
  type: 'internal',
};

describe('DeadLinkPanel redirect export', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:redirects'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectURL,
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exports queued redirects as CSV without making a network call', async () => {
    render(
      <MemoryRouter>
        <DeadLinkPanel
          deadLinkDetails={[deadLink]}
          siteId="site-1"
          workspaceId="ws-1"
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /add redirect/i }));
    fireEvent.change(screen.getByPlaceholderText('/new-path or https://example.com/new'), {
      target: { value: '/new, page' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    fireEvent.click(screen.getByRole('button', { name: /export redirects \(csv\)/i }));

    const createObjectURL = vi.mocked(URL.createObjectURL);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await expect((createObjectURL.mock.calls[0][0] as Blob).text()).resolves.toBe([
      'Old Path,New Path',
      '/old-page,"/new, page"',
    ].join('\n'));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
