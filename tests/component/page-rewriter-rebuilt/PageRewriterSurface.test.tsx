import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client';
import { ToastProvider } from '../../../src/components/Toast';
import { PageRewriterSurface } from '../../../src/components/page-rewriter-rebuilt/PageRewriterSurface';
import { useFeatureFlag } from '../../../src/hooks/useFeatureFlag';
import { queryKeys } from '../../../src/lib/queryKeys';
import type { FeatureFlagKey } from '../../../shared/types/feature-flags';
import { expectNoA11yViolations } from '../a11y';

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
const navigateMock = vi.fn();
const featureFlagsListMock = vi.fn();
const focusModeMock = vi.hoisted(() => ({
  enabled: false,
  setFocusMode: vi.fn(),
}));

vi.mock('../../../src/components/layout/RebuiltAppChrome', () => ({
  useRebuiltFocusMode: () => ({
    focusMode: focusModeMock.enabled,
    setFocusMode: focusModeMock.setFocusMode,
  }),
}));

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

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      list: () => featureFlagsListMock(),
    },
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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderSurface(
  path = '/ws/ws-1/rewrite',
  props: Partial<ComponentProps<typeof PageRewriterSurface>> = {},
  showUrlControls = false,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <PageRewriterSurface workspaceId="ws-1" {...props} />
          {showUrlControls && <PageRewriterUrlControls />}
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function PageRewriterUrlControls() {
  const [, setSearchParams] = useSearchParams();
  return (
    <>
      <button
        type="button"
        onClick={() => setSearchParams({ pageUrl: 'https://acme.com/services' })}
      >
        Select services URL
      </button>
      <button
        type="button"
        onClick={() => setSearchParams({ pageUrl: 'https://acme.com/services/implants' })}
      >
        Select implants URL
      </button>
      <button
        type="button"
        onClick={() => setSearchParams({})}
      >
        Clear page URL
      </button>
    </>
  );
}

function FlaggedPageRewriter() {
  const enabled = useFeatureFlag('ui-rebuild-shell');
  return enabled ? <PageRewriterSurface workspaceId="ws-1" /> : <div data-testid="legacy-rewrite">Legacy Page Rewriter</div>;
}

function renderFlagged(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ws/ws-1/rewrite']}>
          <ToastProvider>
            <FlaggedPageRewriter />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('PageRewriterSurface rebuilt', () => {
  beforeAll(() => {
    window.print = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    focusModeMock.enabled = false;
    featureFlagsListMock.mockReturnValue(new Promise(() => {}));
    setupApi();
  });

  it('mounts through a real feature-flag loading to loaded transition', async () => {
    const { queryClient } = renderFlagged();

    expect(screen.getByTestId('legacy-rewrite')).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(queryKeys.shared.featureFlags(), featureFlagResponse);
    });

    expect(await screen.findByText('Page rewriter · AI rewrite workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('legacy-rewrite')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rewrite chat' })).toBeInTheDocument();
  });

  it('mounts with a seeded feature-flag QueryClient and passes the a11y floor', async () => {
    const { container } = renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith(
        '/api/rewrite-chat/ws-1/load-page',
        { url: 'https://acme.com/services/implants' },
      );
    });

    expect(screen.getByText('Page rewriter · AI rewrite workspace')).toBeInTheDocument();
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

  it('synchronizes same-route pageUrl changes and resets the selected document and transcript when the param clears', async () => {
    apiPostMock.mockImplementation((url: string, body: { url?: string; question?: string }) => {
      if (url.endsWith('/load-page')) {
        if (body.url === 'https://acme.com/services') {
          return Promise.resolve({
            ...pagePayload,
            title: 'Dental Services',
            slug: 'services',
            url: body.url,
            bodyText: 'Dental services for the whole family.',
            html: '<main><h1>Dental Services</h1><p>Care for the whole family.</p></main>',
            primaryKeyword: 'dental services',
            sections: [{ level: 1, heading: 'Dental Services', body: 'Care for the whole family.' }],
          });
        }
        return Promise.resolve({ ...pagePayload, url: body.url });
      }
      return Promise.resolve({ answer: 'Transcript response for the selected page.' });
    });

    renderSurface(
      '/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants',
      {},
      true,
    );

    expect(await screen.findByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent('Dental Implants');

    fireEvent.click(screen.getByRole('button', { name: 'Select services URL' }));

    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledWith(
        '/api/rewrite-chat/ws-1/load-page',
        { url: 'https://acme.com/services' },
      );
    });
    expect(await screen.findByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent('Dental Services');
    expect(screen.getByRole('link', { name: /Open live page/i })).toHaveAttribute('href', 'https://acme.com/services');

    fireEvent.change(screen.getByPlaceholderText(/Ask for a rewrite/i), {
      target: { value: 'Keep this only while a page is selected' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send rewrite prompt' }));
    expect(await screen.findByText('Transcript response for the selected page.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear page URL' }));

    expect(await screen.findByText('No page loaded')).toBeInTheDocument();
    expect(screen.getByText('Load a page to begin')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Page rewrite document editor' })).not.toBeInTheDocument();
    expect(screen.queryByText('Keep this only while a page is selected')).not.toBeInTheDocument();
    expect(screen.queryByText('Transcript response for the selected page.')).not.toBeInTheDocument();
  });

  it('ignores an older same-URL page-load success after an A-to-B-to-A request sequence', async () => {
    const staleServicesLoad = createDeferred<typeof pagePayload>();
    const currentServicesLoad = createDeferred<typeof pagePayload>();
    let servicesLoadCount = 0;
    apiPostMock.mockImplementation((url: string, body: { url?: string }) => {
      if (!url.endsWith('/load-page')) return Promise.resolve({ answer: 'Unused response' });
      if (body.url === 'https://acme.com/services') {
        servicesLoadCount += 1;
        return servicesLoadCount === 1 ? staleServicesLoad.promise : currentServicesLoad.promise;
      }
      return Promise.resolve({ ...pagePayload, url: body.url });
    });

    renderSurface('/ws/ws-1/rewrite', {}, true);

    fireEvent.click(screen.getByRole('button', { name: 'Select services URL' }));
    await waitFor(() => expect(servicesLoadCount).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: 'Select implants URL' }));
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent('Dental Implants');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Select services URL' }));
    await waitFor(() => expect(servicesLoadCount).toBe(2));

    await act(async () => {
      currentServicesLoad.resolve({
        ...pagePayload,
        title: 'Current Dental Services',
        slug: 'services',
        url: 'https://acme.com/services',
        html: '<main><h1>Current Dental Services</h1></main>',
        sections: [{ level: 1, heading: 'Current Dental Services', body: 'Current copy.' }],
      });
      await currentServicesLoad.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent('Current Dental Services');
    });

    await act(async () => {
      staleServicesLoad.resolve({
        ...pagePayload,
        title: 'Stale Dental Services',
        slug: 'services',
        url: 'https://acme.com/services',
        html: '<main><h1>Stale Dental Services</h1></main>',
        sections: [{ level: 1, heading: 'Stale Dental Services', body: 'Stale copy.' }],
      });
      await staleServicesLoad.promise;
      await Promise.resolve();
    });

    expect(screen.getByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent('Current Dental Services');
    expect(screen.queryByText('Stale Dental Services')).not.toBeInTheDocument();
  });

  it('ignores an older same-URL page-load error after a newer request succeeds', async () => {
    const staleServicesLoad = createDeferred<typeof pagePayload>();
    const currentServicesLoad = createDeferred<typeof pagePayload>();
    let servicesLoadCount = 0;
    apiPostMock.mockImplementation((url: string, body: { url?: string }) => {
      if (!url.endsWith('/load-page')) return Promise.resolve({ answer: 'Unused response' });
      if (body.url === 'https://acme.com/services') {
        servicesLoadCount += 1;
        return servicesLoadCount === 1 ? staleServicesLoad.promise : currentServicesLoad.promise;
      }
      return Promise.resolve({ ...pagePayload, url: body.url });
    });

    renderSurface('/ws/ws-1/rewrite', {}, true);

    fireEvent.click(screen.getByRole('button', { name: 'Select services URL' }));
    await waitFor(() => expect(servicesLoadCount).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: 'Select implants URL' }));
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent('Dental Implants');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Select services URL' }));
    await waitFor(() => expect(servicesLoadCount).toBe(2));

    await act(async () => {
      currentServicesLoad.resolve({
        ...pagePayload,
        title: 'Current Dental Services',
        slug: 'services',
        url: 'https://acme.com/services',
        html: '<main><h1>Current Dental Services</h1></main>',
        sections: [{ level: 1, heading: 'Current Dental Services', body: 'Current copy.' }],
      });
      await currentServicesLoad.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent('Current Dental Services');
    });

    await act(async () => {
      staleServicesLoad.reject(new ApiError(500, 'Stale same-URL failure'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent('Current Dental Services');
    expect(screen.queryByText(/Stale same-URL failure/i)).not.toBeInTheDocument();
  });

  it('ignores a stale chat success and stale finally after the page context changes', async () => {
    const staleChat = createDeferred<{ answer: string }>();
    const currentChat = createDeferred<{ answer: string }>();
    let chatRequestCount = 0;
    apiPostMock.mockImplementation((url: string, body: { url?: string; question?: string }) => {
      if (url.endsWith('/load-page')) {
        return Promise.resolve(body.url === 'https://acme.com/services'
          ? {
              ...pagePayload,
              title: 'Dental Services',
              slug: 'services',
              url: body.url,
              bodyText: 'Dental services for the whole family.',
              html: '<main><h1>Dental Services</h1><p>Care for the whole family.</p></main>',
            }
          : { ...pagePayload, url: body.url });
      }
      chatRequestCount += 1;
      return chatRequestCount === 1 ? staleChat.promise : currentChat.promise;
    });

    renderSurface(
      '/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants',
      {},
      true,
    );
    await screen.findByRole('textbox', { name: 'Page rewrite document editor' });

    fireEvent.change(screen.getByPlaceholderText(/Ask for a rewrite/i), {
      target: { value: 'Answer for the implants page' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send rewrite prompt' }));
    expect(await screen.findByText('Analyzing page context...')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select services URL' }));
    expect(await screen.findByRole('textbox', { name: 'Page rewrite document editor' })).toHaveTextContent('Dental Services');

    fireEvent.change(screen.getByPlaceholderText(/Ask for a rewrite/i), {
      target: { value: 'Answer for the services page' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send rewrite prompt' }));
    expect(screen.getByText('Analyzing page context...')).toBeInTheDocument();

    await act(async () => {
      staleChat.resolve({ answer: 'Stale implants response' });
      await staleChat.promise;
      await Promise.resolve();
    });

    expect(screen.queryByText('Stale implants response')).not.toBeInTheDocument();
    expect(screen.getByText('Analyzing page context...')).toBeInTheDocument();

    await act(async () => {
      currentChat.resolve({ answer: 'Current services response' });
      await currentChat.promise;
      await Promise.resolve();
    });

    expect(await screen.findByText('Current services response')).toBeInTheDocument();
    expect(screen.queryByText('Analyzing page context...')).not.toBeInTheDocument();
  });

  it('ignores a stale chat error after the selected page clears', async () => {
    const staleChat = createDeferred<{ answer: string }>();
    apiPostMock.mockImplementation((url: string, body: { url?: string }) => {
      if (url.endsWith('/load-page')) return Promise.resolve({ ...pagePayload, url: body.url });
      return staleChat.promise;
    });

    renderSurface(
      '/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants',
      {},
      true,
    );
    await screen.findByRole('textbox', { name: 'Page rewrite document editor' });

    fireEvent.change(screen.getByPlaceholderText(/Ask for a rewrite/i), {
      target: { value: 'This request will become stale' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send rewrite prompt' }));
    expect(await screen.findByText('Analyzing page context...')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear page URL' }));
    expect(await screen.findByText('No page loaded')).toBeInTheDocument();

    await act(async () => {
      staleChat.reject(new ApiError(429, 'AI quota exceeded'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText('AI quota reached')).not.toBeInTheDocument();
    expect(screen.queryByText(/AI quota exceeded/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Analyzing page context...')).not.toBeInTheDocument();
    expect(screen.getByText('Load a page to begin')).toBeInTheDocument();
  });

  it('seeds a page-specific AI greeting with message avatars', async () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    await screen.findByRole('textbox', { name: 'Page rewrite document editor' });

    expect(screen.getByText((_, element) => element?.hasAttribute('data-message-bubble') && element.textContent?.includes('I’ve loaded Dental Implants') === true)).toHaveTextContent(
      'I’ve loaded Dental Implants. Its target is “dental implants”.',
    );
    expect(screen.getByLabelText('Rewrite AI')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Ask for a rewrite/i), {
      target: { value: 'Rewrite the benefits section' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send rewrite prompt' }));

    expect(await screen.findByLabelText('You')).toBeInTheDocument();
  });

  it('decodes scraped HTML entities in visible page titles', async () => {
    apiPostMock.mockImplementation((url: string, body: { url?: string; question?: string }) => {
      if (url.endsWith('/load-page')) {
        return Promise.resolve({ ...pagePayload, title: 'Dental Implants &amp; Restorations', url: body.url });
      }
      return Promise.resolve({ answer: 'Rewrite ready.' });
    });

    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    await screen.findByRole('textbox', { name: 'Page rewrite document editor' });
    expect(screen.getAllByText('Dental Implants & Restorations').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/&amp;/)).not.toBeInTheDocument();
  });

  it('keeps the prototype chat and document hierarchy in viewport-bound pane order', async () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    const editor = await screen.findByRole('textbox', { name: 'Page rewrite document editor' });
    const workspace = screen.getByTestId('page-rewriter-workspace');
    const transcript = screen.getByTestId('page-rewriter-transcript');
    const playbook = screen.getByTestId('page-rewriter-playbook');
    const composer = screen.getByTestId('page-rewriter-composer');

    expect(workspace).toHaveClass('max-w-[var(--page-max)]', 'lg:min-h-0');
    expect(transcript.compareDocumentPosition(playbook) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(playbook.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editor).toHaveClass('min-h-0', 'overflow-y-auto');
  });

  it('auto-scrolls only the transcript pane when messages arrive', async () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    const transcript = await screen.findByTestId('page-rewriter-transcript');
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 420 });
    transcript.scrollTop = 0;

    fireEvent.change(screen.getByPlaceholderText(/Ask for a rewrite/i), {
      target: { value: 'Rewrite the benefits section' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send rewrite prompt' }));

    await waitFor(() => expect(transcript.scrollTop).toBe(420));
  });

  it('keeps picker identity, evidence, formatting, live-page, and export controls in their exact-once homes', async () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    const editor = await screen.findByRole('textbox', { name: 'Page rewrite document editor' });
    const picker = screen.getByRole('button', { name: /Dental Implants.*acme\.com\/services\/implants.*Change page/i });

    expect(picker).toHaveAttribute('aria-haspopup', 'listbox');
    expect(screen.getAllByTestId('page-rewriter-evidence-band')).toHaveLength(1);
    expect(screen.getByText('Optimization')).toBeInTheDocument();
    expect(screen.getByText('82/100')).toBeInTheDocument();
    expect(screen.getAllByRole('toolbar', { name: 'Document formatting' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /Open live page/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Export' })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 }).every((heading) => editor.contains(heading))).toBe(true);
  });

  it('renders honest no-page and failed-page states without inventing a document action', async () => {
    const { unmount } = renderSurface();

    expect(screen.getByText('No page loaded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    unmount();

    apiPostMock.mockRejectedValueOnce(new ApiError(502, 'Snapshot unavailable'));
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    expect(await screen.findByText('Page did not load')).toBeInTheDocument();
    expect(screen.getByText(/Snapshot unavailable \(HTTP 502\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('renders the prototype two-pane workspace without a top view switcher', async () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    expect(await screen.findByRole('heading', { name: 'Rewrite chat' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live document' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Page rewrite document editor' })).toBeInTheDocument();
    expect(screen.getByText('Export-only draft')).toBeInTheDocument();
    expect(screen.getByText('Not saved or published to the CMS.')).toBeInTheDocument();
    expect(screen.queryByTestId('page-rewriter-loading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish rewrite/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByText('Split')).not.toBeInTheDocument();
  });

  it('enters rebuilt shell focus mode without remounting the loaded editor', async () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    const editor = await screen.findByRole('textbox', { name: 'Page rewrite document editor' });
    fireEvent.click(screen.getByRole('button', { name: 'Enter focus mode' }));

    expect(focusModeMock.setFocusMode).toHaveBeenCalledWith(true);
    expect(editor).toHaveTextContent('Dental Implants');
    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Save draft|Publish rewrite/i })).not.toBeInTheDocument();
  });

  it('offers the same control for exiting an active rebuilt focus mode', () => {
    focusModeMock.enabled = true;
    renderSurface();

    fireEvent.click(screen.getByRole('button', { name: 'Exit focus mode' }));

    expect(focusModeMock.setFocusMode).toHaveBeenCalledWith(false);
  });

  it('wraps compact playbooks inside the assistant pane without a horizontal strip', () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    const prompt = screen.getByRole('button', { name: 'Add an FAQ' });
    expect(prompt).toHaveAttribute('title', 'Suggest an FAQ section with schema-ready Q&A pairs');
    expect(screen.getByTestId('page-rewriter-playbook')).toHaveClass('flex-wrap');
    expect(screen.getByTestId('page-rewriter-playbook')).not.toHaveClass('overflow-x-auto');
  });

  it('maps the workspace copy to styleguide typography roles', async () => {
    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    await screen.findByRole('textbox', { name: 'Page rewrite document editor' });

    expect(screen.getByText('Instruct the AI — it drafts, you apply')).toHaveClass('t-caption');
    expect(screen.getByText((_, element) => element?.hasAttribute('data-message-bubble') && element.textContent?.includes('I’ve loaded Dental Implants') === true)).toHaveClass('t-ui');
    expect(screen.getByText('acme.com/services/implants')).toHaveClass('t-mono');
    expect(screen.getByText('Export-only draft')).toHaveClass('t-ui');
    expect(screen.getByText('Not saved or published to the CMS.')).toHaveClass('t-caption');

    fireEvent.change(screen.getByPlaceholderText(/Ask for a rewrite/i), {
      target: { value: 'Rewrite the benefits section' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send rewrite prompt' }));

    const applyButton = await screen.findByRole('button', { name: /Apply to Benefits/i });
    const rewriteBlock = applyButton.closest('.max-w-\\[88\\%\\]')?.querySelector('[contenteditable="true"]');
    expect(rewriteBlock).not.toBeNull();
    expect(rewriteBlock).toHaveClass('t-ui');
  });

  it('keeps internal rebuild and projection language out of visible loaded states', async () => {
    apiPostMock.mockImplementation((url: string, body: { url?: string; question?: string }) => {
      if (url.endsWith('/load-page')) return Promise.resolve({ ...pagePayload, optimizationScore: null, url: body.url });
      return Promise.resolve({ answer: 'Rewrite answer' });
    });

    renderSurface('/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2Fservices%2Fimplants');

    const evidenceBand = await screen.findByTestId('page-rewriter-evidence-band');
    expect(evidenceBand).toHaveTextContent('Optimization');
    expect(evidenceBand).toHaveTextContent('—');
    expect(screen.queryByText(/page-keyword projection|T1|carry-over|rebuild|migration|server-backed|endpoint/i)).not.toBeInTheDocument();
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
    expect(apiPostMock.mock.calls.filter(([url]) => String(url).endsWith('/load-page'))).toHaveLength(1);
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
