import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RebuiltBreadcrumb } from '../../../src/components/layout/RebuiltBreadcrumb';
import type { Workspace } from '../../../src/components/WorkspaceSelector';
import { STUDIO_NAME } from '../../../src/constants';
import { expectNoA11yViolations } from '../a11y';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../../src/api/misc', async () => {
  const actual = await vi.importActual<typeof import('../../../src/api/misc')>('../../../src/api/misc');
  return {
    ...actual,
    featureFlags: {
      list: () => Promise.resolve({ 'ui-rebuild-shell': true }),
    },
  };
});

const WORKSPACES: Workspace[] = [
  { id: 'ws-1', name: 'Acme', webflowSiteId: 'site-1', webflowSiteName: 'acme.com', folder: 'acme', createdAt: '2026-01-01' },
];

function renderBreadcrumb(tab: Parameters<typeof RebuiltBreadcrumb>[0]['tab'], initialEntry = '/ws/ws-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <RebuiltBreadcrumb workspaces={WORKSPACES} selected={WORKSPACES[0]} tab={tab} pendingContentRequests={0} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RebuiltBreadcrumb', () => {
  it('resolves a real Page label from the nav registry', async () => {
    const { container } = renderBreadcrumb('seo-audit', '/ws/ws-1/seo-audit');

    expect(screen.getByText('Command Center')).toBeInTheDocument();
    expect(screen.getByText('acme.com')).toBeInTheDocument();
    expect(screen.getByText('Site Audit')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Breadcrumb')).toHaveClass('t-ui');
    await expectNoA11yViolations(container);
  });

  it('renders Font Awesome separator icons between trail segments', () => {
    renderBreadcrumb('seo-keywords', '/ws/ws-1/seo-keywords');

    expect(screen.getAllByTestId('rebuilt-breadcrumb-separator').length).toBeGreaterThan(0);
  });

  it('renders a ?tab= sub-segment when the current URL carries one', async () => {
    renderBreadcrumb('content-pipeline', '/ws/ws-1/content-pipeline?tab=briefs');

    expect(await screen.findByText('Content Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Briefs')).toBeInTheDocument();
  });

  it('renders current sub-segments for routed content and settings deep links', () => {
    const { unmount } = renderBreadcrumb('content-pipeline', '/ws/ws-1/content-pipeline?tab=planner');

    expect(screen.getByText('Planner')).toHaveAttribute('aria-current', 'page');

    unmount();
    renderBreadcrumb('workspace-settings', '/ws/ws-1/workspace-settings?tab=dashboard');

    expect(screen.getByText('Client Dashboard')).toHaveAttribute('aria-current', 'page');
  });

  it('only renders Keywords sub-segments the receiver actually honors', async () => {
    const { unmount } = renderBreadcrumb('seo-keywords', '/ws/ws-1/seo-keywords?tab=striking_distance');

    expect(screen.getByText('Striking Distance')).toHaveAttribute('aria-current', 'page');

    unmount();
    renderBreadcrumb('seo-keywords', '/ws/ws-1/seo-keywords?tab=local_candidates');

    expect(screen.queryByText('Local Candidates')).not.toBeInTheDocument();
    expect(await screen.findByText('Keywords')).toHaveAttribute('aria-current', 'page');
  });

  it('updates document.title from the active flag-aware registry label', async () => {
    const { unmount } = renderBreadcrumb('seo-strategy', '/ws/ws-1/seo-strategy');

    await waitFor(() => expect(document.title).toBe(`Insights Engine — ${STUDIO_NAME}`));

    unmount();
    renderBreadcrumb('seo-keywords', '/ws/ws-1/seo-keywords');

    await waitFor(() => expect(document.title).toBe(`Keywords — ${STUDIO_NAME}`));
  });

  it('navigates to the command center when the root crumb is clicked', async () => {
    const user = userEvent.setup();
    renderBreadcrumb('home');

    await user.click(screen.getByRole('button', { name: 'Command Center' }));

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
