import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const PAGE_REWRITE_CHAT_PATH = 'src/components/PageRewriteChat.tsx';
const PAGE_REWRITE_DOCUMENT_PANE_PATH = 'src/components/page-rewrite-chat/PageRewriteDocumentPane.tsx';

describe('PageRewriteChat phase-4 document pane extraction contract', () => {
  it('wires root shell to extracted document pane component', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: root shell must compose extracted document pane in phase 4.

    expect(rewriteChatSource).toContain("from './page-rewrite-chat/PageRewriteDocumentPane'");
    expect(rewriteChatSource).toContain('<PageRewriteDocumentPane');
    expect(rewriteChatSource).toContain('docBodyRefCallback={docBodyRefCallback}');
    expect(rewriteChatSource).toContain('onExport={handleExport}');
  });

  it('keeps right-pane rendering details out of root shell', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: right-pane rendering should not drift back into root shell.

    expect(rewriteChatSource).not.toContain('Export brief');
    expect(rewriteChatSource).not.toContain('No page loaded');
    expect(rewriteChatSource).not.toContain('aria-label="Page content editor"');
  });

  it('keeps extracted right-pane ownership in dedicated module', () => {
    const documentPaneSource = readFileSync(PAGE_REWRITE_DOCUMENT_PANE_PATH, 'utf-8'); // readFile-ok - migration guard: right-pane view ownership must remain centralized.

    expect(documentPaneSource).toContain('export function PageRewriteDocumentPane');
    expect(documentPaneSource).toContain('Export brief');
    expect(documentPaneSource).toContain('No page loaded');
    expect(documentPaneSource).toContain('aria-label="Page content editor"');
  });
});
