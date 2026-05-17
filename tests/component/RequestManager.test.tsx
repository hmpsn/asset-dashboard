import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RequestManager } from '../../src/components/RequestManager';

const getSafeMock = vi.fn();
const patchMock = vi.fn();
const postMock = vi.fn();
const delMock = vi.fn();
const postFormMock = vi.fn();

vi.mock('../../src/api/client', () => ({
  getSafe: (...args: unknown[]) => getSafeMock(...args),
  patch: (...args: unknown[]) => patchMock(...args),
  post: (...args: unknown[]) => postMock(...args),
  del: (...args: unknown[]) => delMock(...args),
  postForm: (...args: unknown[]) => postFormMock(...args),
}));

function sampleRequest() {
  return {
    id: 'req-1',
    workspaceId: 'ws-1',
    title: 'Fix homepage CTA contrast',
    description: 'The CTA needs better contrast.',
    category: 'design' as const,
    priority: 'high' as const,
    status: 'new' as const,
    submittedBy: 'Client',
    pageUrl: 'https://acme.test/',
    attachments: [],
    notes: [],
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z',
  };
}

describe('RequestManager', () => {
  beforeEach(() => {
    getSafeMock.mockReset();
    patchMock.mockReset();
    postMock.mockReset();
    delMock.mockReset();
    postFormMock.mockReset();
  });

  it('renders empty state when there are no requests', async () => {
    getSafeMock.mockImplementation((url: string) => {
      if (url === '/api/workspaces') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<RequestManager workspaceId="ws-1" />);

    expect(await screen.findByText('No client requests yet')).toBeInTheDocument();
    expect(screen.getByText('Clients can submit requests from their dashboard.')).toBeInTheDocument();
  });

  it('renders requests and applies search filter', async () => {
    getSafeMock.mockImplementation((url: string) => {
      if (url === '/api/workspaces') return Promise.resolve([{ id: 'ws-1', name: 'Acme Workspace' }]);
      return Promise.resolve([sampleRequest()]);
    });

    render(<RequestManager workspaceId="ws-1" />);

    expect(await screen.findByText('Fix homepage CTA contrast')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search requests...'), { target: { value: 'no-match' } });
    expect(screen.getByText('No requests match filters')).toBeInTheDocument();
  });
});
