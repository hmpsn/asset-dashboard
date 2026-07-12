import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RebuiltAppChrome,
  RebuiltTopbarActions,
  useRebuildShellEnabled,
  useRebuiltFocusMode,
} from '../../../src/components/layout/RebuiltAppChrome';
import type { Workspace } from '../../../src/components/WorkspaceSelector';
import { FEATURE_FLAGS } from '../../../shared/types/feature-flags';
import { expectNoA11yViolations } from '../a11y';

vi.mock('../../../src/hooks/admin/useNotifications', () => ({
  useNotifications: () => ({ data: [] }),
}));

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

const chromeProps = {
  workspaces: WORKSPACES,
  selected: WORKSPACES[0],
  tab: 'seo-keywords' as const,
  theme: 'dark' as const,
  pendingContentRequests: 0,
  onCreate: vi.fn(),
  onDelete: vi.fn(),
  onLinkSite: vi.fn(),
  onUnlinkSite: vi.fn(),
  toggleTheme: vi.fn(),
  onLogout: vi.fn(),
  connectionHealth: {
    connected: true,
    hasOpenAIKey: true,
    hasWebflowToken: false,
    workspaceCount: 1,
  },
};

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function FlaggedShellProbe() {
  const enabled = useRebuildShellEnabled();
  if (!enabled) return <div data-testid="legacy-shell">legacy shell</div>;
  return (
    <RebuiltAppChrome {...chromeProps}>
      <h1>Keyword pilot body</h1>
    </RebuiltAppChrome>
  );
}

function FocusModeProbe() {
  const { focusMode, setFocusMode } = useRebuiltFocusMode();
  const [draft, setDraft] = useState('');
  return (
    <div>
      <span data-testid="rebuilt-focus-state">{focusMode ? 'focused' : 'standard'}</span>
      <input aria-label="Unsaved focus draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type="button" onClick={() => setFocusMode(!focusMode)}>
        {focusMode ? 'Exit focus probe' : 'Enter focus probe'}
      </button>
    </div>
  );
}

function ControlledFocusShell() {
  const [focusMode, setFocusMode] = useState(false);
  return (
    <RebuiltAppChrome
      {...chromeProps}
      tab="rewrite"
      focusMode={focusMode}
      onFocusModeChange={setFocusMode}
    >
      <FocusModeProbe />
    </RebuiltAppChrome>
  );
}

function TopbarActionProbe() {
  const [visible, setVisible] = useState(true);
  return (
    <RebuiltAppChrome {...chromeProps}>
      {visible && (
        <RebuiltTopbarActions fallback={<button type="button">Inline fallback</button>}>
          <button type="button">Portaled Engine action</button>
        </RebuiltTopbarActions>
      )}
      <button type="button" onClick={() => setVisible(false)}>Remove portaled action</button>
    </RebuiltAppChrome>
  );
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ws/ws-1/seo-keywords']}>
        <FlaggedShellProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderControlledFocusShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ws/ws-1/rewrite?pageUrl=https%3A%2F%2Facme.com%2F']}>
        <ControlledFocusShell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RebuiltAppChrome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockMatchMedia(false);
  });

  it('keeps ui-rebuild-shell default OFF', () => {
    expect(FEATURE_FLAGS['ui-rebuild-shell']).toBe(false);
  });

  it('renders sidebar, breadcrumb, skip link, and children after the flag query resolves ON', async () => {
    renderProbe();

    expect(screen.getByTestId('legacy-shell')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Connection health' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Keyword pilot body')).toBeInTheDocument();
    });

    expect(screen.getByText('Skip to content')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin' })).toHaveTextContent('Keywords');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Keyword Hub');

    const health = screen.getByRole('region', { name: 'Connection health' });
    expect(health.closest('footer')).toBeInTheDocument();
    expect(health).toHaveTextContent('HTTPConnected');
    expect(health).toHaveTextContent('OpenAIActive');
    expect(health).toHaveTextContent('WebflowNo token');
    expect(health).toHaveTextContent('1 workspace');
    expect(within(health).queryByRole('button')).not.toBeInTheDocument();
    expect(within(health).queryByRole('link')).not.toBeInTheDocument();
  });

  it('forces the sidebar rail on narrow viewports and opens mobile navigation without changing the saved desktop preference', async () => {
    localStorage.setItem('admin-sidebar-rail', '0');
    mockMatchMedia(true);

    renderProbe();

    await waitFor(() => {
      expect(screen.getByText('Keyword pilot body')).toBeInTheDocument();
    });

    const expandButton = screen.getByRole('button', { name: 'Expand sidebar' });
    expect(expandButton).toBeEnabled();
    expect(screen.getByLabelText('Workspace Acme. Expand to switch.')).toBeEnabled();

    fireEvent.click(expandButton);

    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    expect(localStorage.getItem('admin-sidebar-rail')).toBe('0');
    expect(screen.getAllByRole('region', { name: 'Connection health' })).toHaveLength(1);
  });

  it('provides controlled focus state to rebuilt surfaces without remounting their work', () => {
    renderControlledFocusShell();

    const draft = screen.getByRole('textbox', { name: 'Unsaved focus draft' });
    fireEvent.change(draft, { target: { value: 'keep this edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter focus probe' }));

    expect(screen.getByTestId('rebuilt-focus-state')).toHaveTextContent('focused');
    expect(screen.getByRole('textbox', { name: 'Unsaved focus draft' })).toHaveValue('keep this edit');
    expect(screen.getByText('Skip to content').parentElement).toHaveStyle({
      gridTemplateColumns: 'var(--shell-sidebar-rail) 1fr',
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.getByTestId('rebuilt-focus-state')).toHaveTextContent('standard');
    expect(screen.getByRole('textbox', { name: 'Unsaved focus draft' })).toHaveValue('keep this edit');
    expect(screen.getAllByRole('region', { name: 'Connection health' })).toHaveLength(1);
  });

  it('hosts surface actions in the topbar without a nested toolbar and cleans up the portal', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ws/ws-1/seo-keywords']}>
          <TopbarActionProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const host = screen.getByTestId('rebuilt-topbar-action-host');
    expect(screen.getByTestId('rebuilt-topbar-shell')).toHaveClass('flex-nowrap', 'overflow-x-auto');
    expect(within(host).getByRole('button', { name: 'Portaled Engine action' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inline fallback' })).not.toBeInTheDocument();
    expect(host.closest('header')).toBeInTheDocument();
    expect(host.closest('[role="toolbar"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove portaled action' }));
    expect(screen.queryByRole('button', { name: 'Portaled Engine action' })).not.toBeInTheDocument();
    expect(host).toBeEmptyDOMElement();
  });

  it('uses an explicit inline fallback only when no rebuilt chrome provider exists', () => {
    render(
      <RebuiltTopbarActions fallback={<button type="button">Isolated fallback</button>}>
        <button type="button">Unhosted action</button>
      </RebuiltTopbarActions>,
    );

    expect(screen.getByRole('button', { name: 'Isolated fallback' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unhosted action' })).not.toBeInTheDocument();
  });

  it('has no accessibility violations once the rebuilt shell is mounted', async () => {
    const { container } = renderProbe();

    // Wait for the flag query to resolve ON so we audit the rebuilt shell, not
    // the legacy-shell fallback.
    await waitFor(() => {
      expect(screen.getByText('Keyword pilot body')).toBeInTheDocument();
    });

    await expectNoA11yViolations(container);
  }, 15_000);
});
