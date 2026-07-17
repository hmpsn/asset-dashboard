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
const publishSiteMock = vi.fn();
const pagespeedBulkMock = vi.fn();

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
  webflow: {
    publish: (...args: unknown[]) => publishSiteMock(...args),
  },
  pageWeight: {
    pagespeedBulk: (...args: unknown[]) => pagespeedBulkMock(...args),
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
    publishSiteMock.mockReset();
    pagespeedBulkMock.mockReset();
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

      const auditBtn = screen.getByText('Run Site Audit');
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

      fireEvent.click(screen.getByText('Run Site Audit'));

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

      fireEvent.click(screen.getByText('Run Site Audit'));

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
          expect.stringContaining('Could not start audit'),
          'error',
        );
      });
    });

    it('is honestly disabled when the workspace has no linked site', () => {
      open(ws); // no webflowSiteId

      const action = screen.getByText('Run Site Audit').closest('button');

      expect(action).toBeDisabled();
      expect(screen.getByText('Link a site to run audits')).toBeInTheDocument();
      expect(navigateMock).not.toHaveBeenCalled();
      expect(startJobMock).not.toHaveBeenCalled();
    });

    it('does NOT call auditSchedules.enable (old broken behavior)', () => {
      startJobMock.mockResolvedValue('job-1');
      open(wsWithSite);

      fireEvent.click(screen.getByText('Run Site Audit'));

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

  // ── Keyword navigation (registry label resolves with shell state) ─────────────
  describe('keyword nav', () => {
    function open() {
      render(<CommandPalette workspaces={[ws]} selectedWorkspace={ws} onSelectWorkspace={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    }

    it('shows the canonical rebuilt label when the shell flag is on', () => {
      useFeatureFlagMock.mockReturnValue(true);
      open();
      expect(screen.getByText('Keywords')).toBeInTheDocument();
      expect(screen.queryByText('Rank Tracker')).not.toBeInTheDocument();
      expect(screen.queryByText('Keyword Hub')).not.toBeInTheDocument();
    });

    it('preserves the legacy registry label when the shell flag is off', () => {
      open();
      expect(screen.getByText('Keyword Hub')).toBeInTheDocument();
      expect(screen.queryByText('Keywords')).not.toBeInTheDocument();
    });
  });

  describe('rebuilt-shell navigation', () => {
    function open() {
      render(<CommandPalette workspaces={[wsWithSite]} selectedWorkspace={wsWithSite} onSelectWorkspace={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    }

    it('uses registry labels and rebuilt registry zones when the shell flag is on', () => {
      useFeatureFlagMock.mockReturnValue(true);
      open();

      expect(useFeatureFlagMock).toHaveBeenCalledWith('ui-rebuild-shell');
      for (const label of ['Cockpit', 'Insights Engine', 'Keywords', 'Asset Manager', 'AI Visibility', 'Content Pipeline']) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      for (const legacyLabel of ['Home', 'Strategy', 'Keyword Hub', 'Assets', 'Pipeline']) {
        expect(screen.queryByText(legacyLabel)).not.toBeInTheDocument();
      }
      expect(screen.getAllByText('Strategy & Content').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Search & Site Health').length).toBeGreaterThan(0);
      expect(screen.queryByText('Content Perf')).not.toBeInTheDocument();
    });

    it('exposes the all-workspaces Command Center and navigates to the book root', () => {
      useFeatureFlagMock.mockReturnValue(true);
      render(<CommandPalette workspaces={[ws]} selectedWorkspace={null} onSelectWorkspace={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });

      const input = screen.getByPlaceholderText('Search tools, workspaces, actions...');
      fireEvent.change(input, { target: { value: 'Command Center' } });

      expect(screen.getByText('All workspaces')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Command Center'));

      expect(navigateMock).toHaveBeenCalledTimes(1);
      expect(navigateMock).toHaveBeenCalledWith('/');
    });

    it('preserves the legacy labels and Content Performance home when the shell flag is off', () => {
      open();

      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getAllByText('Strategy').length).toBeGreaterThan(0);
      expect(screen.getByText('Keyword Hub')).toBeInTheDocument();
      expect(screen.getByText('Assets')).toBeInTheDocument();
      expect(screen.getByText('Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Content Perf')).toBeInTheDocument();
      expect(screen.queryByText('AI Visibility')).not.toBeInTheDocument();
      expect(screen.queryByText('Cockpit')).not.toBeInTheDocument();
      expect(screen.queryByText('Command Center')).not.toBeInTheDocument();
    });
  });

  describe('content planner quick actions', () => {
    it.each([
      ['Open Content Template Planner', 'action:create-template'],
      ['Open Content Matrix Builder', 'action:build-matrix'],
    ])('routes %s to the Planner and preserves recent-action tracking', (label, recentId) => {
      render(<CommandPalette workspaces={[wsWithSite]} selectedWorkspace={wsWithSite} onSelectWorkspace={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });

      const input = screen.getByPlaceholderText('Search tools, workspaces, actions...');
      fireEvent.change(input, { target: { value: label } });
      fireEvent.click(screen.getByText(label));

      expect(navigateMock).toHaveBeenCalledWith(`${adminPath(wsWithSite.id, 'content-pipeline')}?tab=planner`);
      expect(JSON.parse(localStorage.getItem('admin-palette-recent') ?? '[]')).toContain(recentId);
    });
  });

  describe('W1.2 command verbs', () => {
    function open(workspace: Workspace | null = wsWithSite, workspaces: Workspace[] = workspace ? [workspace] : []) {
      render(<CommandPalette workspaces={workspaces} selectedWorkspace={workspace} onSelectWorkspace={vi.fn()} />);
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    }

    it('relabels legacy navigate-only actions with Open and exposes the D4 top-10 verbs', () => {
      open();

      for (const label of [
        'Open Schema Generator',
        'Open Content Briefs',
        'Open Content Template Planner',
        'Open Content Matrix Builder',
        'Open Content Plan',
      ]) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }

      for (const label of [
        'Run Site Audit',
        'Scan All Workspaces for Anomalies',
        'Review & send staged moves',
        'Fix missing titles/metas',
        'Reply to client requests',
        'Record published work',
        'Publish site to Webflow',
        'Refresh strategy',
        'Re-run PageSpeed',
        'New content brief',
      ]) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }

      for (const staleLabel of ['Generate Schema', 'Create Brief', 'Create Content Template', 'Build Content Matrix', 'View Content Plan']) {
        expect(screen.queryByText(staleLabel)).not.toBeInTheDocument();
      }
    });

    it('filters fixture/debug workspace names with the documented predicate', () => {
      const debugWorkspaces: Workspace[] = [
        { ...ws, id: 'debug-1', name: 'cascade-debug-1783977240399' },
        { ...ws, id: 'debug-2', name: 'dbgSmoke' },
        { ...ws, id: 'debug-3', name: 'Trigger Check WS' },
        { ...ws, id: 'debug-4', name: 'Check Set WS' },
      ];
      open(ws, [ws, ...debugWorkspaces]);

      expect(screen.getByText('Acme Workspace')).toBeInTheDocument();
      for (const workspace of debugWorkspaces) {
        expect(screen.queryByText(workspace.name)).not.toBeInTheDocument();
      }
    });

    it('keeps workspace verbs visible but disabled when no workspace is selected', () => {
      open(null, [ws]);

      expect(screen.getByText('Run Site Audit').closest('button')).toBeDisabled();
      expect(screen.getByText('Review & send staged moves').closest('button')).toBeDisabled();
      expect(screen.getByText('Publish site to Webflow').closest('button')).toBeDisabled();
      expect(screen.getAllByText('No workspace selected').length).toBeGreaterThan(0);
      expect(screen.getByText('Scan All Workspaces for Anomalies').closest('button')).not.toBeDisabled();
    });

    it.each([
      ['Review & send staged moves', `${adminPath(ws.id, 'seo-strategy')}?lens=moves`],
      ['Fix missing titles/metas', `${adminPath(ws.id, 'seo-editor')}?filter=needs-title`],
      ['Reply to client requests', `${adminPath(ws.id, 'requests')}?tab=requests`],
      ['Record published work', adminPath(ws.id, 'outcomes')],
      ['New content brief', `${adminPath(ws.id, 'content-pipeline')}?tab=briefs`],
    ])('routes %s to its exact action site', (label, destination) => {
      open();

      fireEvent.click(screen.getByText(label));

      expect(navigateMock).toHaveBeenCalledTimes(1);
      expect(navigateMock).toHaveBeenCalledWith(destination);
    });

    it('publishes through the shared Webflow handler only after confirmation', async () => {
      publishSiteMock.mockResolvedValue({ success: true });
      open();

      fireEvent.click(screen.getByText('Publish site to Webflow'));
      expect(publishSiteMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Publish site' }));

      await waitFor(() => {
        expect(publishSiteMock).toHaveBeenCalledTimes(1);
        expect(publishSiteMock).toHaveBeenCalledWith('site-abc', 'ws-1');
      });
      expect(toastMock).toHaveBeenCalledWith('Site publish started', 'success');
    });

    it('refreshes strategy through the existing background-job platform', async () => {
      startJobMock.mockResolvedValue('strategy-job-1');
      open();

      fireEvent.click(screen.getByText('Refresh strategy'));

      await waitFor(() => {
        expect(startJobMock).toHaveBeenCalledTimes(1);
        expect(startJobMock).toHaveBeenCalledWith('keyword-strategy', {
          workspaceId: 'ws-1',
          mode: 'full',
        });
      });
      expect(toastMock).toHaveBeenCalledWith('Strategy generation started', 'success');
    });

    it('re-runs PageSpeed through the existing bulk handler with workspace context', async () => {
      pagespeedBulkMock.mockResolvedValue({ pages: [{ id: 'page-1' }] });
      open();

      fireEvent.click(screen.getByText('Re-run PageSpeed'));

      await waitFor(() => {
        expect(pagespeedBulkMock).toHaveBeenCalledTimes(1);
        expect(pagespeedBulkMock).toHaveBeenCalledWith('site-abc', 'mobile', 3, 'ws-1');
      });
      expect(toastMock).toHaveBeenCalledWith('Mobile PageSpeed test complete', 'success');
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
