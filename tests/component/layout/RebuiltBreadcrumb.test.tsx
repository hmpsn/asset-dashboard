import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RebuiltBreadcrumb } from '../../../src/components/layout/RebuiltBreadcrumb';
import type { Workspace } from '../../../src/components/WorkspaceSelector';
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
      list: () => Promise.resolve({}),
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
    await expectNoA11yViolations(container);
  });

  it('uses the legacy fallback label for redirect-only pages', () => {
    renderBreadcrumb('brief', '/ws/ws-1/brief');

    expect(screen.getByText('Meeting Brief')).toBeInTheDocument();
  });

  it('renders Font Awesome separator icons between trail segments', () => {
    renderBreadcrumb('seo-keywords', '/ws/ws-1/seo-keywords');

    expect(screen.getAllByTestId('rebuilt-breadcrumb-separator').length).toBeGreaterThan(0);
  });

  it('renders a ?tab= sub-segment when the current URL carries one', () => {
    renderBreadcrumb('content-pipeline', '/ws/ws-1/content-pipeline?tab=briefs');

    expect(screen.getByText('Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Briefs')).toBeInTheDocument();
  });

  it('renders current sub-segments for routed content and settings deep links', () => {
    const { unmount } = renderBreadcrumb('content-pipeline', '/ws/ws-1/content-pipeline?tab=planner');

    expect(screen.getByText('Planner')).toHaveAttribute('aria-current', 'page');

    unmount();
    renderBreadcrumb('workspace-settings', '/ws/ws-1/workspace-settings?tab=dashboard');

    expect(screen.getByText('Client Dashboard')).toHaveAttribute('aria-current', 'page');
  });

  it('only renders Keyword Hub sub-segments the receiver actually honors', () => {
    const { unmount } = renderBreadcrumb('seo-keywords', '/ws/ws-1/seo-keywords?tab=striking_distance');

    expect(screen.getByText('Striking Distance')).toHaveAttribute('aria-current', 'page');

    unmount();
    renderBreadcrumb('seo-keywords', '/ws/ws-1/seo-keywords?tab=local_candidates');

    expect(screen.queryByText('Local Candidates')).not.toBeInTheDocument();
    expect(screen.getByText('Keyword Hub')).toHaveAttribute('aria-current', 'page');
  });

  it('navigates to the command center when the root crumb is clicked', async () => {
    const user = userEvent.setup();
    renderBreadcrumb('home');

    await user.click(screen.getByRole('button', { name: 'Command Center' }));

    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
