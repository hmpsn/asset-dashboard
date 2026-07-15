import {
  buildPrintableDocHtml,
  serializeDocToMarkdown,
  snapshotPageRewriteDocBody,
} from '../page-rewrite-chat/pageRewriteChatDocument';
import type { PageRewriterExportMode, PageRewriterPageData } from './pageRewriterTypes';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

interface ExportPageRewriterDocumentParams {
  mode: PageRewriterExportMode;
  docBody: HTMLElement | null;
  pageData: PageRewriterPageData | null;
  toast: ToastFn;
}

function slugFromPage(data: PageRewriterPageData | null): string {
  return (data?.slug || 'page').replace(/\//g, '-').replace(/^-/, '') || 'page';
}

async function writeClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
  await navigator.clipboard.writeText(text);
}

export async function exportPageRewriterDocument({
  mode,
  docBody,
  pageData,
  toast,
}: ExportPageRewriterDocumentParams): Promise<void> {
  const slug = slugFromPage(pageData);
  if (mode === 'pdf') {
    try {
      const printRoot = document.getElementById('page-rewrite-print-root') ?? document.createElement('div');
      printRoot.id = 'page-rewrite-print-root';
      printRoot.className = 'page-rewrite-print-root';
      printRoot.innerHTML = buildPrintableDocHtml(docBody, pageData);
      if (!printRoot.parentElement) document.body.appendChild(printRoot);
      const cleanup = () => {
        document.body.classList.remove('page-rewrite-printing');
        printRoot.innerHTML = '';
        window.removeEventListener('afterprint', cleanup);
      };
      document.body.classList.add('page-rewrite-printing');
      window.addEventListener('afterprint', cleanup, { once: true });
      window.print();
      window.setTimeout(cleanup, 60_000);
    } catch {
      toast('PDF export failed. Please try again.', 'error');
    }
    return;
  }

  if (mode === 'docx') {
    const docSnapshot = snapshotPageRewriteDocBody(docBody);
    try {
      const { downloadPageRewriteDocx } = await import('../page-rewrite-chat/pageRewriteDocxExport');
      await downloadPageRewriteDocx({
        docBody: docSnapshot,
        pageData,
        fileName: `${slug}-rewrite.docx`,
        profile: 'rebuilt',
      });
      toast('DOCX export ready', 'success');
    } catch {
      toast('DOCX export failed. Please try again.', 'error');
    }
    return;
  }

  if (mode === 'copyHtml') {
    try {
      await writeClipboard(docBody?.innerHTML ?? '');
      toast('Copied HTML', 'success');
    } catch {
      toast('Could not copy HTML', 'error');
    }
    return;
  }

  const markdown = serializeDocToMarkdown(docBody, pageData);
  if (mode === 'copyMarkdown') {
    try {
      await writeClipboard(markdown);
      toast('Copied Markdown', 'success');
    } catch {
      toast('Could not copy Markdown', 'error');
    }
    return;
  }

  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${slug}-rewrite.md`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
