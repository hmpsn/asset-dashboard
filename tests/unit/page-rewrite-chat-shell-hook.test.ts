import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageRewriteChatShell } from '../../src/components/page-rewrite-chat/usePageRewriteChatShell';

const mockPost = vi.fn();
const mockGet = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../src/api/client', () => ({
  post: (...args: unknown[]) => mockPost(...args),
  get: (...args: unknown[]) => mockGet(...args),
}));

describe('usePageRewriteChatShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockReset();
    mockGet.mockReset();
    mockPost.mockResolvedValue({ answer: 'ok' });
  });

  it('shows toast when chat copy-to-clipboard fails', async () => {
    const toast = vi.fn();
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const { result } = renderHook(() =>
      usePageRewriteChatShell({
        workspaceId: 'ws-copy-failure',
        toast,
      })
    );

    act(() => {
      result.current.copyToClipboard('example', 0);
    });

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Could not copy to clipboard', 'error');
    });
  });

  it('shows toast when markdown export copy fails', async () => {
    const toast = vi.fn();
    const writeText = vi.fn().mockRejectedValue(new Error('blocked'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const { result } = renderHook(() =>
      usePageRewriteChatShell({
        workspaceId: 'ws-export-copy-failure',
        toast,
      })
    );

    act(() => {
      result.current.handleExport('copy');
    });

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Could not copy Markdown', 'error');
    });
  });

  it('prints the editor document for PDF export and cleans up print state', async () => {
    const toast = vi.fn();
    const print = vi.fn();
    Object.defineProperty(window, 'print', {
      value: print,
      configurable: true,
    });

    const { result } = renderHook(() =>
      usePageRewriteChatShell({
        workspaceId: 'ws-pdf-export',
        toast,
      })
    );

    act(() => {
      result.current.docBodyRefCallback(document.createElement('div'));
      result.current.handleExport('pdf');
      window.dispatchEvent(new Event('afterprint'));
    });

    expect(print).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('page-rewrite-printing')).toBe(false);
    expect(document.getElementById('page-rewrite-print-root')?.innerHTML).toBe('');
  });

  it('prevents duplicate sendMessage calls while request is in flight', async () => {
    const toast = vi.fn();
    let resolveRequest: ((value: { answer: string }) => void) | null = null;
    mockPost.mockImplementation(() => new Promise(resolve => {
      resolveRequest = resolve;
    }));

    const { result } = renderHook(() =>
      usePageRewriteChatShell({
        workspaceId: 'ws-send-guard',
        toast,
      })
    );

    act(() => {
      result.current.setInput('Please rewrite this');
    });

    act(() => {
      void result.current.sendMessage();
      void result.current.sendMessage();
    });

    expect(mockPost).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest?.({ answer: 'Done' });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.sending).toBe(false);
    });
  });
});
