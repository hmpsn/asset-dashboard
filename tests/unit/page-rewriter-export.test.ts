/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const downloadDocx = vi.hoisted(() => vi.fn());

vi.mock('../../src/components/page-rewrite-chat/pageRewriteDocxExport', () => ({
  downloadPageRewriteDocx: (...args: unknown[]) => downloadDocx(...args),
}));

import { exportPageRewriterDocument } from '../../src/components/page-rewriter-rebuilt/pageRewriterExport';
import type { PageRewriterPageData } from '../../src/components/page-rewriter-rebuilt/pageRewriterTypes';

const pageData = {
  title: 'Dental Implants',
  slug: '/services/implants',
  bodyText: '',
  html: '',
  sections: [],
  issues: [],
  primaryKeyword: 'dental implants',
} satisfies PageRewriterPageData;

describe('rebuilt page rewriter export workflow', () => {
  const toast = vi.fn();
  const writeText = vi.fn();
  const createObjectURL = vi.fn(() => 'blob:page-rewriter-export');
  const revokeObjectURL = vi.fn();
  const anchorClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    downloadDocx.mockResolvedValue(undefined);
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(anchorClick);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downloads the rebuilt DOCX once with the preserved filename and success toast', async () => {
    const docBody = document.createElement('div');

    await exportPageRewriterDocument({ mode: 'docx', docBody, pageData, toast });

    expect(downloadDocx).toHaveBeenCalledOnce();
    expect(downloadDocx).toHaveBeenCalledWith({
      docBody,
      pageData,
      fileName: 'services-implants-rewrite.docx',
      profile: 'rebuilt',
    });
    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith('DOCX export ready', 'success');
  });

  it('snapshots the rebuilt editor before the on-demand DOCX module resolves', async () => {
    const docBody = document.createElement('div');
    docBody.innerHTML = '<h1>Click-time draft</h1>';

    const exportPromise = exportPageRewriterDocument({ mode: 'docx', docBody, pageData, toast });
    docBody.innerHTML = '<h1>Later editor state</h1>';
    await exportPromise;

    const exportedBody = downloadDocx.mock.calls[0]?.[0]?.docBody as HTMLElement;
    expect(exportedBody).not.toBe(docBody);
    expect(exportedBody.innerHTML).toBe('<h1>Click-time draft</h1>');
  });

  it('keeps DOCX failures on the existing error toast without claiming success', async () => {
    downloadDocx.mockRejectedValueOnce(new Error('packing failed'));

    await exportPageRewriterDocument({
      mode: 'docx',
      docBody: document.createElement('div'),
      pageData,
      toast,
    });

    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith('DOCX export failed. Please try again.', 'error');
  });

  it('preserves HTML and Markdown clipboard payloads and toasts', async () => {
    const docBody = document.createElement('div');
    docBody.innerHTML = '<h1>Dental Implants</h1><p>Stable replacement teeth.</p>';

    await exportPageRewriterDocument({ mode: 'copyHtml', docBody, pageData, toast });
    await exportPageRewriterDocument({ mode: 'copyMarkdown', docBody, pageData, toast });

    expect(writeText).toHaveBeenNthCalledWith(1, '<h1>Dental Implants</h1><p>Stable replacement teeth.</p>');
    expect(writeText).toHaveBeenNthCalledWith(2, '# Dental Implants\n\nStable replacement teeth.\n');
    expect(toast).toHaveBeenNthCalledWith(1, 'Copied HTML', 'success');
    expect(toast).toHaveBeenNthCalledWith(2, 'Copied Markdown', 'success');
  });

  it('preserves PDF print cleanup and the scoped print document', async () => {
    vi.useFakeTimers();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const docBody = document.createElement('div');
    docBody.innerHTML = '<h1>Dental Implants</h1><p>Stable replacement teeth.</p>';

    await exportPageRewriterDocument({ mode: 'pdf', docBody, pageData, toast });

    expect(print).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('page-rewrite-printing')).toBe(true);
    expect(document.getElementById('page-rewrite-print-root')?.textContent).toContain('Stable replacement teeth.');

    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('page-rewrite-printing')).toBe(false);
    expect(document.getElementById('page-rewrite-print-root')?.innerHTML).toBe('');
  });

  it('downloads Markdown exactly once with the preserved filename and revokes its URL', async () => {
    const docBody = document.createElement('div');
    docBody.innerHTML = '<h1>Dental Implants</h1>';

    await exportPageRewriterDocument({ mode: 'downloadMarkdown', docBody, pageData, toast });

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(anchorClick.mock.instances[0]).toMatchObject({
      download: 'services-implants-rewrite.md',
      href: 'blob:page-rewriter-export',
    });
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:page-rewriter-export');
  });
});
