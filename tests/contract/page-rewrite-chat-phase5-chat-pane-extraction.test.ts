import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const PAGE_REWRITE_CHAT_PATH = 'src/components/PageRewriteChat.tsx';
const PAGE_REWRITE_CHAT_PANE_PATH = 'src/components/page-rewrite-chat/PageRewriteChatPane.tsx';

describe('PageRewriteChat phase-5 chat pane extraction contract', () => {
  it('wires root shell to extracted chat pane component', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: root shell must compose extracted chat pane in phase 5.

    expect(rewriteChatSource).toContain("from './page-rewrite-chat/PageRewriteChatPane'");
    expect(rewriteChatSource).toContain('<PageRewriteChatPane');
    expect(rewriteChatSource).toContain('onSendMessage={sendMessage}');
    expect(rewriteChatSource).toContain('onApplyToSection={applyToSection}');
  });

  it('keeps left-pane rendering details out of root shell', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: left-pane rendering should not drift back into root shell.

    expect(rewriteChatSource).not.toContain('is loaded. Ask me to rewrite sections, optimize headings, add FAQ blocks, or improve AEO.');
    expect(rewriteChatSource).not.toContain('Analyzing and writing...');
    expect(rewriteChatSource).not.toContain('Ask me to rewrite a section, optimize headings, add FAQs...');
  });

  it('keeps extracted left-pane ownership in dedicated module', () => {
    const chatPaneSource = readFileSync(PAGE_REWRITE_CHAT_PANE_PATH, 'utf-8'); // readFile-ok - migration guard: left-pane view ownership must remain centralized.

    expect(chatPaneSource).toContain('export function PageRewriteChatPane');
    expect(chatPaneSource).toContain('AI Page Rewriter');
    expect(chatPaneSource).toContain('Analyzing and writing...');
    expect(chatPaneSource).toContain('Ask me to rewrite a section, optimize headings, add FAQs...');
  });
});
