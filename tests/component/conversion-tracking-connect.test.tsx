/**
 * Lane C C4 — Webflow form-capture connect UI (guided manual webhook registration).
 *
 * Flag ON: a "Webflow form capture" subsection renders an Enable button; clicking it calls the enable
 * API and, on success, renders a copyable webhook URL + a one-time signing secret + a 3-step guided
 * checklist. Copy buttons call navigator.clipboard.writeText. Flag OFF: the subsection is absent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const featureFlagMock = vi.fn((_flag: string) => false);
vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => featureFlagMock(...(args as [string])),
}));

vi.mock('../../src/hooks/admin/useConversionTrackingStatus', () => ({
  useConversionTrackingStatus: () => ({ status: undefined, isLoading: false, isError: false }),
}));

// Stub the conversion-tracking API enable call.
const enableMock = vi.fn(async () => ({
  webhookUrl: 'https://app.test/api/public/webflow-form-webhook/ws-1',
  webhookSecret: 'whsec_test_one_time_secret_abcdef',
}));
vi.mock('../../src/api/conversionTracking', () => ({
  conversionTrackingApi: {
    getStatus: vi.fn(async () => ({ pinnedCount: 0, typedCount: 0, formCaptureConnected: false, lastSubmissionAt: null, submissionCount: 0, recentOutcomeCount: 0 })),
    enableFormCapture: (...args: unknown[]) => enableMock(...(args as [])),
    disableFormCapture: vi.fn(async () => ({ disabled: true })),
  },
}));

vi.mock('../../src/api/client', () => ({
  get: vi.fn(async () => []),
  getSafe: vi.fn(async (_url: string, fallback: unknown) => fallback),
  post: vi.fn(async () => ({})),
  patch: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
}));

import { ClientDashboardTab } from '../../src/components/settings/ClientDashboardTab';

function renderTab(ws: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ClientDashboardTab
        workspaceId="ws-1"
        webflowSiteId="site-1"
        ws={{ ga4PropertyId: 'GA-123', ...ws }}
        patchWorkspace={vi.fn(async () => ({}))}
        toast={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagMock.mockReturnValue(false);
  const writeText = vi.fn();
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

describe('C4 — Webflow connect UI (flag ON)', () => {
  beforeEach(() => featureFlagMock.mockImplementation((flag: string) => flag === 'the-issue-client-measured-capture'));

  it('renders the subsection + Enable, and on enable shows the copyable URL + one-time secret', async () => {
    renderTab();
    const enableBtn = screen.getByRole('button', { name: /Enable Webflow form capture/i });
    expect(enableBtn).toBeInTheDocument();
    fireEvent.click(enableBtn);
    await waitFor(() => expect(enableMock).toHaveBeenCalledWith('ws-1'));
    expect(await screen.findByDisplayValue(/webflow-form-webhook\/ws-1/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('whsec_test_one_time_secret_abcdef')).toBeInTheDocument();
  });

  it('copy buttons call navigator.clipboard.writeText', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Enable Webflow form capture/i }));
    await screen.findByDisplayValue(/webflow-form-webhook\/ws-1/);
    fireEvent.click(screen.getByLabelText('Copy webhook URL'));
    fireEvent.click(screen.getByLabelText('Copy signing secret'));
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'https://app.test/api/public/webflow-form-webhook/ws-1',
    );
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'whsec_test_one_time_secret_abcdef',
    );
  });
});

describe('C4 — flag OFF parity', () => {
  it('does NOT render the Webflow form capture subsection when the flag is OFF', () => {
    featureFlagMock.mockReturnValue(false);
    renderTab();
    expect(screen.queryByRole('button', { name: /Enable Webflow form capture/i })).toBeNull();
  });
});
