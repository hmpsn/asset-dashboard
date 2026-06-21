/**
 * Lane C C4 — Webflow form-capture connect UI (Data-API POLLING model — select forms to track).
 *
 * Capture switched from an HMAC webhook (paste a signing secret) to polling the Webflow Forms API: the
 * admin SELECTS which forms produce leads and maps each to a typed outcome. Flag ON: a "Webflow form
 * capture" subsection renders a "Select forms" button; clicking it lists the site's forms, each with a
 * lead-type <select>; choosing a type and saving calls saveFormSources with the mappings. Flag OFF: the
 * subsection is absent (byte-identical P0).
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

// Stub the conversion-tracking API: list two forms + capture the saved sources.
const getFormsMock = vi.fn(async () => [
  { id: 'form_abc', displayName: 'Contact' },
  { id: 'form_xyz', displayName: 'Newsletter' },
]);
const saveSourcesMock = vi.fn(async () => ({ saved: true, formCaptureConnected: true }));
vi.mock('../../src/api/conversionTracking', () => ({
  conversionTrackingApi: {
    getStatus: vi.fn(async () => ({ pinnedCount: 0, typedCount: 0, formCaptureConnected: false, lastSubmissionAt: null, submissionCount: 0, recentOutcomeCount: 0 })),
    getWebflowForms: (...args: unknown[]) => getFormsMock(...(args as [])),
    saveFormSources: (...args: unknown[]) => saveSourcesMock(...(args as [string, unknown])),
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

function renderTab(ws: Record<string, unknown> = {}, toast: (msg: string, type?: string) => void = vi.fn()) {
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
        toast={toast as (msg: string, type?: 'success' | 'error' | 'info') => void}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagMock.mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

describe('C4 — Webflow connect UI (flag ON)', () => {
  beforeEach(() => featureFlagMock.mockImplementation((flag: string) => flag === 'the-issue-client-measured-capture'));

  it('renders the subsection + a "Select forms" button that lists the site forms with lead-type selects', async () => {
    renderTab();
    const selectBtn = screen.getByRole('button', { name: /Select Webflow forms to track/i });
    expect(selectBtn).toBeInTheDocument();
    fireEvent.click(selectBtn);
    await waitFor(() => expect(getFormsMock).toHaveBeenCalledWith('ws-1'));
    expect(await screen.findByText('Contact')).toBeInTheDocument();
    expect(screen.getByText('Newsletter')).toBeInTheDocument();
    expect(screen.getByLabelText('Lead type for Contact')).toBeInTheDocument();
  });

  it('mapping a form to a lead type and saving calls saveFormSources with the mapping', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Select Webflow forms to track/i }));
    await screen.findByText('Contact');
    fireEvent.change(screen.getByLabelText('Lead type for Contact'), { target: { value: 'form_fill' } });
    fireEvent.click(screen.getByRole('button', { name: /Save tracked Webflow forms/i }));
    await waitFor(() => expect(saveSourcesMock).toHaveBeenCalledWith('ws-1', [
      { formId: 'form_abc', formName: 'Contact', outcomeType: 'form_fill' },
    ]));
  });

  it('seeds the picker from the workspace\'s already-saved sources', async () => {
    renderTab({ webflowFormSources: [{ formId: 'form_xyz', formName: 'Newsletter', outcomeType: 'email' }] });
    // The button reads "Select forms" until the status query reports connected; the picker still seeds
    // its local mapping from ws.webflowFormSources regardless.
    fireEvent.click(screen.getByRole('button', { name: /Select Webflow forms to track/i }));
    await screen.findByText('Newsletter');
    expect((screen.getByLabelText('Lead type for Newsletter') as HTMLSelectElement).value).toBe('email');
  });

  it('shows a real error toast when getWebflowForms THROWS (502 / no-site-linked) — not a silent empty state', async () => {
    // getWebflowForms now THROWS on a real failure (it switched off the swallowing getSafe), so the
    // component catch fires and surfaces a distinguishable error toast instead of the "no forms" empty state.
    getFormsMock.mockRejectedValueOnce(new Error('Could not load Webflow forms'));
    const toast = vi.fn();
    renderTab({}, toast);
    fireEvent.click(screen.getByRole('button', { name: /Select Webflow forms to track/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Could not load Webflow forms', 'error'));
  });

  it('Cancel closes the picker WITHOUT calling saveFormSources and restores the saved selection', async () => {
    renderTab({ webflowFormSources: [{ formId: 'form_xyz', formName: 'Newsletter', outcomeType: 'email' }] });
    fireEvent.click(screen.getByRole('button', { name: /Select Webflow forms to track/i }));
    await screen.findByText('Newsletter');
    // Clear the mapping locally (would clobber all tracked forms on an accidental Save) …
    fireEvent.change(screen.getByLabelText('Lead type for Newsletter'), { target: { value: '' } });
    // … then Cancel: no save call, picker closes.
    fireEvent.click(screen.getByRole('button', { name: /Cancel form selection/i }));
    await waitFor(() => expect(screen.queryByLabelText('Lead type for Newsletter')).toBeNull());
    expect(saveSourcesMock).not.toHaveBeenCalled();
    // Reopening shows the original saved selection restored (Cancel reset formSources to ws sources).
    fireEvent.click(screen.getByRole('button', { name: /Select Webflow forms to track/i }));
    await screen.findByText('Newsletter');
    expect((screen.getByLabelText('Lead type for Newsletter') as HTMLSelectElement).value).toBe('email');
  });
});

describe('C4 — flag OFF parity', () => {
  it('does NOT render the Webflow form capture subsection when the flag is OFF', () => {
    featureFlagMock.mockReturnValue(false);
    renderTab();
    expect(screen.queryByRole('button', { name: /Select Webflow forms to track/i })).toBeNull();
  });
});
