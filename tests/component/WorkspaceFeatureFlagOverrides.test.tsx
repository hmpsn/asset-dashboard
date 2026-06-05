import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkspaceFeatureFlagMeta } from '../../shared/types/feature-flags';

const mutateMock = vi.fn();
const useWorkspaceFeatureFlagsMock = vi.fn();

// Mock the admin hooks the component consumes (no raw fetch; typed hooks).
vi.mock('../../src/hooks/admin', () => ({
  useWorkspaceFeatureFlags: (wsId: string | undefined) => useWorkspaceFeatureFlagsMock(wsId),
  useSetWorkspaceFlagOverride: () => ({ mutate: mutateMock, isPending: false }),
}));

vi.mock('../../src/components/Toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

import { WorkspaceFeatureFlagOverrides } from '../../src/components/settings/WorkspaceFeatureFlagOverrides';

function flag(overrides: Partial<WorkspaceFeatureFlagMeta>): WorkspaceFeatureFlagMeta {
  return {
    key: 'keyword-hub',
    enabled: false,
    source: 'default',
    inheritedEnabled: false,
    inheritedSource: 'default',
    default: false,
    label: 'Keyword Hub — unified keyword surface (KCC + Rank Tracker consolidation)',
    group: 'Keyword Hub',
    lifecycle: {
      owner: 'analytics-intelligence',
      createdAt: '2026-06-02',
      rolloutTarget: 'staging-validation',
      removalCondition: 'Remove after rollout.',
      linkedRoadmapItemId: 'keyword-hub-wave4',
      staleAuditCadence: 'weekly',
      lastReviewedAt: '2026-06-02',
    },
    ...overrides,
  };
}

describe('WorkspaceFeatureFlagOverrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the per-workspace flags header', () => {
    useWorkspaceFeatureFlagsMock.mockReturnValue({ data: [flag({})], isLoading: false, isError: false, error: null });
    render(<WorkspaceFeatureFlagOverrides workspaceId="ws-1" />);
    expect(screen.getByText('Per-Workspace Feature Flags')).toBeInTheDocument();
  });

  it('renders the keyword-hub flag with its inherited state and Default source', () => {
    useWorkspaceFeatureFlagsMock.mockReturnValue({ data: [flag({})], isLoading: false, isError: false, error: null });
    render(<WorkspaceFeatureFlagOverrides workspaceId="ws-1" />);
    expect(screen.getByText('keyword-hub')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText(/Inherited OFF from default/i)).toBeInTheDocument();
  });

  it('shows the Workspace override badge and the inherited-on-clear hint when a workspace override exists', () => {
    useWorkspaceFeatureFlagsMock.mockReturnValue({
      data: [flag({ enabled: true, source: 'workspace' })],
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<WorkspaceFeatureFlagOverrides workspaceId="ws-1" />);
    expect(screen.getByText('Workspace override')).toBeInTheDocument();
    expect(screen.getByText(/inherits OFF \(default\) when cleared/i)).toBeInTheDocument();
  });

  it('toggling a flag calls the set-override mutation with enabled=true', () => {
    useWorkspaceFeatureFlagsMock.mockReturnValue({ data: [flag({})], isLoading: false, isError: false, error: null });
    render(<WorkspaceFeatureFlagOverrides workspaceId="ws-1" />);
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    expect(mutateMock).toHaveBeenCalledWith(
      { key: 'keyword-hub', enabled: true },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('toggling an ON flag OFF calls the set-override mutation with enabled=false', () => {
    useWorkspaceFeatureFlagsMock.mockReturnValue({
      data: [flag({ enabled: true, source: 'workspace' })],
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<WorkspaceFeatureFlagOverrides workspaceId="ws-1" />);
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    expect(mutateMock).toHaveBeenCalledWith(
      { key: 'keyword-hub', enabled: false },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('clicking the clear button calls the set-override mutation with enabled=null', () => {
    // source 'workspace' → the RotateCcw clear IconButton is rendered.
    useWorkspaceFeatureFlagsMock.mockReturnValue({
      data: [flag({ enabled: true, source: 'workspace' })],
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<WorkspaceFeatureFlagOverrides workspaceId="ws-1" />);
    const clearButton = screen.getByRole('button', { name: /Clear keyword-hub workspace override/i });
    fireEvent.click(clearButton);
    expect(mutateMock).toHaveBeenCalledWith(
      { key: 'keyword-hub', enabled: null },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('renders an explicit error state when flags fail to load', () => {
    useWorkspaceFeatureFlagsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('upstream unavailable'),
    });
    render(<WorkspaceFeatureFlagOverrides workspaceId="ws-1" />);
    expect(screen.getByText('Failed to load workspace feature flags')).toBeInTheDocument();
    expect(screen.getByText('upstream unavailable')).toBeInTheDocument();
  });
});
