import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceSettings } from '../../src/components/WorkspaceSettings';

const getMock = vi.fn();
const patchMock = vi.fn();
const postMock = vi.fn();

vi.mock('../../src/api/client', () => ({
  get: (...args: unknown[]) => getMock(...args),
  patch: (...args: unknown[]) => patchMock(...args),
  post: (...args: unknown[]) => postMock(...args),
}));

vi.mock('../../src/components/settings/ConnectionsTab', () => ({
  ConnectionsTab: () => <div>ConnectionsTabStub</div>,
}));
vi.mock('../../src/components/settings/FeaturesTab', () => ({
  FeaturesTab: () => <div>FeaturesTabStub</div>,
}));
vi.mock('../../src/components/settings/ClientDashboardTab', () => ({
  ClientDashboardTab: () => <div>ClientDashboardTabStub</div>,
}));
vi.mock('../../src/components/settings/BusinessProfileTab', () => ({
  BusinessProfileTab: () => <div>BusinessProfileTabStub</div>,
}));
vi.mock('../../src/components/settings/IntelligenceProfileTab', () => ({
  IntelligenceProfileTab: () => <div>IntelligenceProfileTabStub</div>,
}));
vi.mock('../../src/components/PublishSettings', () => ({
  PublishSettings: () => <div>PublishSettingsStub</div>,
}));

describe('WorkspaceSettings', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    postMock.mockReset();

    getMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/workspaces/')) return Promise.resolve({ id: 'ws-1', name: 'Acme Workspace' });
      if (url === '/api/google/status') return Promise.resolve({ connected: false, configured: true });
      return Promise.resolve([]);
    });
  });

  it('defaults to connections tab when no tab query param is present', async () => {
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <Routes>
          <Route
            path="/workspace"
            element={<WorkspaceSettings workspaceId="ws-1" workspaceName="Acme Workspace" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('ConnectionsTabStub')).toBeInTheDocument();
  });

  it('honors ?tab=features deep link', async () => {
    render(
      <MemoryRouter initialEntries={['/workspace?tab=features']}>
        <Routes>
          <Route
            path="/workspace"
            element={<WorkspaceSettings workspaceId="ws-1" workspaceName="Acme Workspace" />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('FeaturesTabStub')).toBeInTheDocument();
  });
});
