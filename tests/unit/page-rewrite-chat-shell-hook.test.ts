import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePageRewriteChatShell } from '../../src/components/page-rewrite-chat/usePageRewriteChatShell';

const mockPost = vi.fn();
const mockGet = vi.fn();
const downloadDocx = vi.hoisted(() => vi.fn());

vi.mock('../../src/components/page-rewrite-chat/pageRewriteDocxExport', () => ({
  downloadPageRewriteDocx: (...args: unknown[]) => downloadDocx(...args),
}));

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
    downloadDocx.mockReset();
    downloadDocx.mockResolvedValue(undefined);
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

  it('loads the legacy DOCX exporter on demand with the preserved profile and filename', async () => {
    const toast = vi.fn();
    mockPost.mockResolvedValueOnce({
      title: 'Dental Implants',
      slug: '/services/implants',
      bodyText: '',
      html: '',
      sections: [],
      issues: [],
    });
    const { result } = renderHook(() =>
      usePageRewriteChatShell({
        workspaceId: 'ws-docx-export',
        initialPageUrl: 'https://acme.com/services/implants',
        toast,
      })
    );
    await waitFor(() => expect(result.current.pageData?.slug).toBe('/services/implants'));
    const docBody = document.createElement('div');
    act(() => result.current.docBodyRefCallback(docBody));
    docBody.innerHTML = '<h1>Click-time draft</h1>';
    act(() => result.current.toggleExportOpen());

    act(() => result.current.handleExport('docx'));
    docBody.innerHTML = '<h1>Later editor state</h1>';

    await waitFor(() => expect(downloadDocx).toHaveBeenCalledOnce());
    expect(downloadDocx).toHaveBeenCalledWith({
      docBody: expect.any(HTMLElement),
      pageData: expect.objectContaining({ slug: '/services/implants' }),
      fileName: 'services-implants-brief.docx',
      profile: 'legacy',
    });
    const exportedBody = downloadDocx.mock.calls[0]?.[0]?.docBody as HTMLElement;
    expect(exportedBody).not.toBe(docBody);
    expect(exportedBody.innerHTML).toBe('<h1>Click-time draft</h1>');
    await waitFor(() => expect(result.current.exportOpen).toBe(false));
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps legacy DOCX failures on the existing error toast', async () => {
    const toast = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    downloadDocx.mockRejectedValueOnce(new Error('packing failed'));
    const { result } = renderHook(() =>
      usePageRewriteChatShell({ workspaceId: 'ws-docx-failure', toast })
    );

    act(() => result.current.handleExport('docx'));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('DOCX export failed. Please try again.', 'error');
    });
    expect(downloadDocx).toHaveBeenCalledOnce();
    expect(result.current.exportOpen).toBe(false);
    consoleError.mockRestore();
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
