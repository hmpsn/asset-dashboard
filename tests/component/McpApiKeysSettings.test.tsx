/**
 * Component tests for McpApiKeysSettings.tsx — the admin Settings surface for
 * per-workspace MCP API keys.
 *
 * Verifies the real component renders its states without crashing (loaded list,
 * empty state, master-key status) and that the create flow surfaces the one-time
 * plaintext reveal. The api module is mocked; the component's own hooks run for real
 * (so a Rules-of-Hooks regression would surface here, not be masked).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { McpApiKeySummary, McpApiKeyListResponse, CreateMcpApiKeyResult } from '../../shared/types/mcp-api-keys';

// ── Module mocks (hoisted before component import) ────────────────────────────
const listMock = vi.fn();
const createMock = vi.fn();
const revokeMock = vi.fn();

vi.mock('../../src/api/mcpApiKeys', () => ({
  mcpApiKeysApi: {
    list: (...a: unknown[]) => listMock(...a),
    create: (...a: unknown[]) => createMock(...a),
    revoke: (...a: unknown[]) => revokeMock(...a),
  },
}));

vi.mock('../../src/hooks/admin/useWorkspaces', () => ({
  useWorkspaces: () => ({ data: [{ id: 'ws1', name: 'Acme Dental' }] }),
}));

vi.mock('../../src/components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { McpApiKeysSettings } from '../../src/components/McpApiKeysSettings';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const activeKey: McpApiKeySummary = {
  id: 'k1',
  workspaceId: 'ws1',
  workspaceName: 'Acme Dental',
  label: 'Desktop key',
  createdAt: '2026-06-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  revoked: false,
};

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  revokeMock.mockReset();
});

describe('McpApiKeysSettings', () => {
  it('renders the loaded key list with status + master-key indicator', async () => {
    listMock.mockResolvedValue({ keys: [activeKey], masterKeyConfigured: true } satisfies McpApiKeyListResponse);
    render(<McpApiKeysSettings />, { wrapper: makeWrapper() });

    expect(await screen.findByText('Desktop key')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Master key set')).toBeInTheDocument();
  });

  it('renders the empty state + "No master key" when there are no keys and no master key', async () => {
    listMock.mockResolvedValue({ keys: [], masterKeyConfigured: false } satisfies McpApiKeyListResponse);
    render(<McpApiKeysSettings />, { wrapper: makeWrapper() });

    expect(await screen.findByText('No API keys yet')).toBeInTheDocument();
    expect(screen.getByText('No master key')).toBeInTheDocument();
  });

  it('reveals the one-time plaintext after creating a key', async () => {
    listMock.mockResolvedValue({ keys: [], masterKeyConfigured: true } satisfies McpApiKeyListResponse);
    const result: CreateMcpApiKeyResult = {
      key: { ...activeKey, id: 'k2', label: 'New key' },
      plaintextKeyOnceShown: 'mcp_PLAINTEXT_SHOWN_ONCE',
    };
    createMock.mockResolvedValue(result);

    render(<McpApiKeysSettings />, { wrapper: makeWrapper() });
    await screen.findByText('No API keys yet');

    // Fill the form: workspace select + label input, then create.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ws1' } });
    fireEvent.change(screen.getByPlaceholderText(/Claude desktop/i), { target: { value: 'New key' } });
    fireEvent.click(screen.getByRole('button', { name: /create key/i }));

    expect(await screen.findByText('mcp_PLAINTEXT_SHOWN_ONCE')).toBeInTheDocument();
    expect(createMock).toHaveBeenCalledWith('ws1', 'New key');
  });
});
