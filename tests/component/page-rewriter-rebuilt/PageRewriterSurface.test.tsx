import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client';
import { ToastProvider } from '../../../src/components/Toast';
import { PageRewriterSurface } from '../../../src/components/page-rewriter-rebuilt/PageRewriterSurface';
import { queryKeys } from '../../../src/lib/queryKeys';
import type { FeatureFlagKey } from '../../../shared/types/feature-flags';
import { expectNoA11yViolations } from '../a11y';

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('../../../src/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/client')>('../../../src/api/client');
  return {
    ...actual,
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  };
});

const featureFlagResponse: Partial<Record<FeatureFlagKey, boolean>> = { 'ui-rebuild-shell': true };

const sitemapPages = [
  { slug: '/', title: 'Home', url: 'https://acme.com/' },
  { slug: '/services', title: 'Services', url: 'https://acme.com/services' },
  { slug: '/services/implants', title: 'Dental Implants', url: 'https://acme.com/services/implants' },
];

const pagePayload = {
  title: 'Dental Implants',
  slug: 'services/implants',
  url: 'https://acme.com/services/implants',
  bodyText: 'Dental implants restore missing teeth with durable replacement roots.',
  html: '<main><h1>Dental Implants</h1><p>Restore missing teeth.</p></main>',
  preamble: 'Restore missing teeth with durable replacement roots.',
  primaryKeyword: 'dental implants',
  rank: 7,
  optimizationScore: 82,
  monthlyTraffic: 320,
  issues: [
    { check: 'title', severity: 'warning' as const, message: 'Title can lead with the service keyword.' },
    { check: 'faq', severity: 'info' as const, message: 'FAQ schema opportunity.' },
  ],
  sections: [
    { level: 1, heading: 'Dental Implants', body: 'Restore missing teeth.' },
    { level: 2, heading: 'Benefits', body: 'Long lasting and natural looking.' },
  ],
};

function setupApi() {
  apiGetMock.mockResolvedValue(sitemapPages);
  apiPostMock.mockImplementation((url: string, body: { url?: string; question?: string }) => {
    if (url.endsWith('/load-page')) return Promise.resolve({ ...pagePayload, url: body.url });
    return Promise.resolve({
      answer: [
        '**Rewriting: Benefits**',
        'BEGIN_REWRITE',
        'Dental implants give patients a stable replacement that looks natural and protects long-term bite function.',
        'END_REWRITE',
        '',
        '**Rationale:** Leads with a direct patient outcome.',
      ].join('\n'),
    });
  });
}

function renderSurface(
  path = '/ws/ws-1/rewrite',
  props: Partial<ComponentProps<typeof PageRewriterSurface>> = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <PageRewriterSurface workspaceId="ws-1" {...props} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PageRewriterSurface rebuilt', () => {
  beforeAll(() => {
    window.print = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupApi();
  });

  it('mounts with a seeded feature-flag QueryClient and passes the a11y floor', async () => {
    const { container } = renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith(
        '/api/rewrite-chat/ws-1/load-page',
        { url: 'https://acme.com/services/implants' },
      );
    });

    expect(screen.getByRole('heading', { name: 'Page Rewriter' })).toBeInTheDocument();
    expect(screen.getAllByText(/dental implants/i).length).toBeGreaterThan(0);
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  }, 15_000);

  it('receives and validates the pageUrl deep link before auto-loading the page', async () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith(
        '/api/rewrite-chat/ws-1/load-page',
        { url: 'https://acme.com/services/implants' },
      );
    });
    expect(screen.queryByText('Page link ignored')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent('Dental Implants');
  });

  it('rejects an invalid pageUrl param without calling the load-page endpoint', () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=javascript%3Aalert%281%29');

    expect(screen.getByText('Page link ignored')).toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('loads a sitemap page from the keyboard-operable picker', async () => {
    renderSurface();

    fireEvent.click(screen.getAllByRole('button', { name: 'Choose page' })[0]);
    const input = await screen.findByRole('combobox', { name: 'Search pages or paste a full URL' });
    fireEvent.change(input, { target: { value: 'implants' } });

    await screen.findByRole('option', { name: /Dental Implants/i });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith(
        '/api/rewrite-chat/ws-1/load-page',
        { url: 'https://acme.com/services/implants' },
      );
    });
  });

  it('renders editable rewrite answers and applies them to the named section', async () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');
    await screen.findByRole('textbox', { name: 'Page rewrite document editor' });

    fireEvent.change(screen.getByPlaceholderText(/Ask for a rewrite/i), {
      target: { value: 'Rewrite the benefits section' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send rewrite prompt' }));

    await screen.findByRole('button', { name: /Apply to Benefits/i });
    fireEvent.click(screen.getByRole('button', { name: /Apply to Benefits/i }));

    expect(screen.getByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent(
      'stable replacement that looks natural',
    );
  });

  it('shows the AD-020 first-429 quota state and disables AI actions', async () => {
    apiPostMock.mockRejectedValueOnce(new ApiError(429, 'AI quota exceeded'));
    renderSurface();

    fireEvent.change(screen.getByPlaceholderText(/Load a page first/i), {
      target: { value: 'Rewrite the intro' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send rewrite prompt' }));

    await screen.findByText('AI quota reached');
    expect(screen.getByText('0 of 1 responses completed before the quota was hit.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send rewrite prompt' })).toBeDisabled();
  });

  it('navigates back to the SEO audit without carrying the pageUrl param', () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    fireEvent.click(screen.getByRole('button', { name: /Back to audit/i }));

    expect(navigateMock).toHaveBeenCalledWith('/ws/ws-1/seo-audit');
  });
});
