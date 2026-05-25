import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsPanel } from '../../src/components/SettingsPanel';

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
const getOptionalMock = vi.fn();
const getSafeMock = vi.fn();

vi.mock('../../src/api/client', () => ({
  get: (...args: unknown[]) => getMock(...args),
  post: (...args: unknown[]) => postMock(...args),
  patch: (...args: unknown[]) => patchMock(...args),
  getOptional: (...args: unknown[]) => getOptionalMock(...args),
  getSafe: (...args: unknown[]) => getSafeMock(...args),
}));

vi.mock('../../src/components/StripeSettings', () => ({
  StripeSettings: () => <div>StripeSettingsStub</div>,
}));

vi.mock('../../src/components/FeatureFlagSettings', () => ({
  FeatureFlagSettings: () => <div>FeatureFlagSettingsStub</div>,
}));

function seedCommonApi() {
  getSafeMock.mockResolvedValue([{ id: 'ws-1', name: 'Acme Workspace', webflowSiteId: 'site-1', webflowSiteName: 'Acme Site' }]);
  getMock.mockImplementation((url: string) => {
    if (url === '/api/studio-config') return Promise.resolve({ bookingUrl: '' });
    if (url === '/api/google/status') return Promise.resolve({ connected: false, configured: true });
    if (url === '/api/health') {
      return Promise.resolve({
        hasOpenAIKey: true,
        hasWebflowToken: true,
        hasGoogleAuth: false,
        hasEmailConfig: true,
        hasStripe: true,
      });
    }
    return Promise.resolve({});
  });
  getOptionalMock.mockResolvedValue(null);
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    getOptionalMock.mockReset();
    getSafeMock.mockReset();
    seedCommonApi();
  });

  it('renders core sections and placeholder integration blocks', async () => {
    render(<SettingsPanel />);

    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Google Account')).toBeInTheDocument();
    expect(screen.getByText('Webflow Connections')).toBeInTheDocument();
    expect(screen.getByText('Platform Health')).toBeInTheDocument();
    expect(screen.getByText('StripeSettingsStub')).toBeInTheDocument();
    expect(screen.getByText('FeatureFlagSettingsStub')).toBeInTheDocument();
  });

  it('invokes storage refresh endpoint', async () => {
    render(<SettingsPanel />);

    const refresh = await screen.findByRole('button', { name: 'Refresh storage stats' });
    fireEvent.click(refresh);

    expect(getOptionalMock).toHaveBeenCalledWith('/api/admin/storage-stats');
  });

  it('handles storage refresh error without crashing', async () => {
    getOptionalMock.mockRejectedValueOnce(new Error('storage unavailable'));
    render(<SettingsPanel />);

    const refresh = await screen.findByRole('button', { name: 'Refresh storage stats' });
    fireEvent.click(refresh);

    await waitFor(() => {
      expect(getOptionalMock).toHaveBeenCalledWith('/api/admin/storage-stats');
    });
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Platform Health')).toBeInTheDocument();
  });
});
