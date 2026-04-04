import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock useNotifications (React Query hook that replaced inline fetchNotifications)
vi.mock('../../src/hooks/admin/useNotifications', () => ({
  useNotifications: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

// Mock useClientSignals to return test data
vi.mock('../../src/hooks/admin/useClientSignals', () => ({
  useClientSignals: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

async function getComponent() {
  const mod = await import('../../src/components/NotificationBell.js');
  return mod.NotificationBell;
}

describe('NotificationBell — drawer conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a bell button', async () => {
    const NotificationBell = await getComponent();
    render(
      <MemoryRouter>
        <NotificationBell onSelectWorkspace={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByTitle('Notifications')).toBeInTheDocument();
  });

  it('drawer is NOT rendered on initial load (closed)', async () => {
    const NotificationBell = await getComponent();
    render(
      <MemoryRouter>
        <NotificationBell onSelectWorkspace={vi.fn()} />
      </MemoryRouter>,
    );
    // The drawer should not be visible
    expect(screen.queryByText('Notifications')).toBeNull();
  });

  it('clicking bell opens the drawer', async () => {
    const NotificationBell = await getComponent();
    render(
      <MemoryRouter>
        <NotificationBell onSelectWorkspace={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTitle('Notifications'));
    await waitFor(() => {
      expect(screen.getByText('Notifications')).toBeInTheDocument();
    });
  });

  it('open drawer does NOT have "absolute" class (it uses fixed positioning)', async () => {
    const NotificationBell = await getComponent();
    render(
      <MemoryRouter>
        <NotificationBell onSelectWorkspace={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTitle('Notifications'));
    await waitFor(() => {
      // Drawer must use fixed not absolute
      const drawer = document.querySelector('[data-testid="notification-drawer"]');
      expect(drawer).not.toBeNull();
      expect(drawer?.className).toContain('fixed');
      expect(drawer?.className).not.toContain('absolute');
    });
  });

  it('pressing Escape closes the drawer', async () => {
    const NotificationBell = await getComponent();
    render(
      <MemoryRouter>
        <NotificationBell onSelectWorkspace={vi.fn()} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTitle('Notifications'));
    await waitFor(() => screen.getByText('Notifications'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('notification-drawer')).toBeNull();
    });
  });
});
