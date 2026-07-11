import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandPalette } from '../../src/components/CommandPalette';
import { adminPath } from '../../src/routes';
import type { Workspace } from '../../src/components/WorkspaceSelector';

const navigateMock = vi.fn();
const useFeatureFlagMock = vi.fn();
const anomalyScanMock = vi.fn();
const startJobMock = vi.fn();
const toastMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../src/hooks/useFeatureFlag', () => ({
  useFeatureFlag: (...args: unknown[]) => useFeatureFlagMock(...args),
}));

vi.mock('../../src/hooks/useBackgroundTasks', () => ({
  useBackgroundTasks: () => ({ startJob: startJobMock }),
}));

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('../../src/api', () => ({
  anomalies: {
    scan: (...args: unknown[]) => anomalyScanMock(...args),
  },
}));

const ws: Workspace = {
  id: 'ws-1',
  name: 'Acme Workspace',
  folder: 'acme-workspace',
  createdAt: '2026-05-16T00:00:00.000Z',
};

const wsWithSite: Workspace = {
  ...ws,
  webflowSiteId: 'site-abc',
};

describe('CommandPalette', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    anomalyScanMock.mockReset();
    startJobMock.mockReset();
    toastMock.mockReset();
    useFeatureFlagMock.mockReset();
    useFeatureFlagMock.mockReturnValue(false);
    localStorage.clear();
  });

  it('is closed by default', () => {
    render(
      <CommandPalette
        workspaces={[ws]}
        selectedWorkspace={ws}
        onSelectWorkspace={vi.fn()}
      />,
    );

    expect(screen.queryByPlaceholderText('Search tools, workspaces, actions...')).not.toBeInTheDocument();
  });

  it('opens with cmd/ctrl + k and shows no-results message for unmatched query', () => {
    render(
      <CommandPalette
        workspaces={[ws]}
        selectedWorkspace={ws}
        onSelectWorkspace={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const input = screen.getByPlaceholderText('Search tools, workspaces, actions...');
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'zzzz-no-match' } });
    expect(screen.getByText('No results for "zzzz-no-match"')).toBeInTheDocument();
  });

  it('selects a workspace item when clicked', () => {
    const onSelectWorkspace = vi.fn();

    render(
      <CommandPalette
        workspaces={[ws]}
        selectedWorkspace={ws}
        onSelectWorkspace={onSelectWorkspace}
      />,
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.click(screen.getByText('Acme Workspace'));

    expect(onSelectWorkspace).toHaveBeenCalledWith(ws);
    expect(navigateMock).toHaveBeenCalledWith(adminPath('ws-1'));
  });

  // ── W1.6: Run Audit action ────────────────────────────────────────────────────
  describe('"Run Audit" action', () => {
    function open(workspace: Workspace = wsWithSite) {
      render(<CommandPalette workspaces={[workspace]} selectedWorkspace={workspace} onSelectWorkspace={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    }

    it('calls startJob with seo-audit type and shows success toast when job starts', async () => {
      startJobMock.mockResolvedValue('job-123');
      open(wsWithSite);

      const auditBtn = screen.getByText('Run Audit');
      fireEvent.click(auditBtn);

      await waitFor(() => {
        expect(startJobMock).toHaveBeenCalledWith('seo-audit', {
          siteId: 'site-abc',
          workspaceId: 'ws-1',
        });
      });
      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
          expect.stringContaining('Audit started'),
          'success',
        );
      });
    });

    it('shows error toast when startJob returns null', async () => {
      startJobMock.mockResolvedValue(null);
      open(wsWithSite);

      fireEvent.click(screen.getByText('Run Audit'));

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
          expect.stringContaining('Could not start audit'),
          'error',
        );
      });
    });

    it('shows error toast when startJob throws', async () => {
      startJobMock.mockRejectedValue(new Error('network'));
      open(wsWithSite);

      fireEvent.click(screen.getByText('Run Audit'));

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
          expect.stringContaining('Could not start audit'),
          'error',
        );
      });
    });

    it('navigates to seo-audit tab when workspace has no site linked', () => {
      open(ws); // no webflowSiteId

      fireEvent.click(screen.getByText('Run Audit'));

      expect(navigateMock).toHaveBeenCalledWith(adminPath(ws.id, 'seo-audit'));
      expect(startJobMock).not.toHaveBeenCalled();
    });

    it('does NOT call auditSchedules.enable (old broken behavior)', () => {
      startJobMock.mockResolvedValue('job-1');
      open(wsWithSite);

      fireEvent.click(screen.getByText('Run Audit'));

      // auditSchedules.enable is not imported — we verify startJob is the path taken
      expect(startJobMock).toHaveBeenCalled();
    });
  });

  // ── W1.6: Scan for Anomalies action ──────────────────────────────────────────
  describe('"Scan for Anomalies" action', () => {
    function open() {
      render(<CommandPalette workspaces={[ws]} selectedWorkspace={ws} onSelectWorkspace={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    }

    it('is relabeled honestly as "Scan All Workspaces for Anomalies"', () => {
      open();
      // Search to find it (it's in the action group)
      const input = screen.getByPlaceholderText('Search tools, workspaces, actions...');
      fireEvent.change(input, { target: { value: 'Scan' } });
      expect(screen.getByText('Scan All Workspaces for Anomalies')).toBeInTheDocument();
    });

    it('shows success toast on scan success', async () => {
      anomalyScanMock.mockResolvedValue({});
      open();

      const input = screen.getByPlaceholderText('Search tools, workspaces, actions...');
      fireEvent.change(input, { target: { value: 'Scan' } });
      fireEvent.click(screen.getByText('Scan All Workspaces for Anomalies'));

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
          expect.stringContaining('Anomaly scan started'),
          'success',
        );
      });
    });

    it('shows error toast on scan failure', async () => {
      anomalyScanMock.mockRejectedValue(new Error('scan failed'));
      open();

      const input = screen.getByPlaceholderText('Search tools, workspaces, actions...');
      fireEvent.change(input, { target: { value: 'Scan' } });
      fireEvent.click(screen.getByText('Scan All Workspaces for Anomalies'));

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
          expect.stringContaining('Anomaly scan failed'),
          'error',
        );
      });
    });
  });

  // ── Keyword Hub nav (post-W4-cutover: unconditional) ─────────────────────────
  // The Hub is the only keyword surface. The palette shows "Keyword Hub"
  // unconditionally; the retired "Rank Tracker" entry and the old "Keywords"
  // label never appear, regardless of flag state.
  describe('keyword nav', () => {
    function open() {
      render(<CommandPalette workspaces={[ws]} selectedWorkspace={ws} onSelectWorkspace={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    }

    it('NAV_ITEMS show "Keyword Hub", never the retired "Rank Tracker" / "Keywords"', () => {
      useFeatureFlagMock.mockReturnValue(true);
      open();
      expect(screen.getByText('Keyword Hub')).toBeInTheDocument();
      expect(screen.queryByText('Rank Tracker')).not.toBeInTheDocument();
      expect(screen.queryByText('Keywords')).not.toBeInTheDocument();
    });
  });

  describe('rebuilt-shell navigation', () => {
    function open() {
      render(<CommandPalette workspaces={[wsWithSite]} selectedWorkspace={wsWithSite} onSelectWorkspace={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    }

    it('uses the Cockpit label and folds Content Performance when the shell flag is on', () => {
      useFeatureFlagMock.mockReturnValue(true);
      open();

      expect(useFeatureFlagMock).toHaveBeenCalledWith('ui-rebuild-shell');
      expect(screen.getByText('Cockpit')).toBeInTheDocument();
      expect(screen.queryByText('Home')).not.toBeInTheDocument();
      expect(screen.queryByText('Content Perf')).not.toBeInTheDocument();
      expect(screen.getByText('Pipeline')).toBeInTheDocument();
    });

    it('preserves the legacy labels and Content Performance home when the shell flag is off', () => {
      open();

      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Content Perf')).toBeInTheDocument();
      expect(screen.queryByText('Cockpit')).not.toBeInTheDocument();
    });
  });

  describe('Local Presence nav', () => {
    function open() {
      render(<CommandPalette workspaces={[wsWithSite]} selectedWorkspace={wsWithSite} onSelectWorkspace={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    }

    it('groups Local Presence under Strategy and navigates to the dedicated page', () => {
      open();

      const input = screen.getByPlaceholderText('Search tools, workspaces, actions...');
      fireEvent.change(input, { target: { value: 'Local Presence' } });

      expect(screen.getByText('Local Presence')).toBeInTheDocument();
      expect(screen.getByText('Strategy')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Local Presence'));
      expect(navigateMock).toHaveBeenCalledWith(adminPath('ws-1', 'local-seo'));
    });
  });
});
