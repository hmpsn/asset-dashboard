import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const PAGE_REWRITE_CHAT_PATH = 'src/components/PageRewriteChat.tsx';
const PAGE_REWRITE_HEADER_PATH = 'src/components/page-rewrite-chat/PageRewriteHeaderBar.tsx';

describe('PageRewriteChat phase-6 header extraction contract', () => {
  it('wires root shell to extracted header component', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: root shell must compose extracted header in phase 6.

    expect(rewriteChatSource).toContain("from './page-rewrite-chat/PageRewriteHeaderBar'");
    expect(rewriteChatSource).toContain('<PageRewriteHeaderBar');
    expect(rewriteChatSource).toContain('onComboKeyDown={handleComboKeyDown}');
    expect(rewriteChatSource).toContain('onSelectPage={selectPage}');
  });

  it('keeps header and page-picker rendering details out of root shell', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: header rendering should not drift back into root shell.

    expect(rewriteChatSource).not.toContain('Search pages or paste a URL…');
    expect(rewriteChatSource).not.toContain('No sitemap — paste a full URL above');
    expect(rewriteChatSource).not.toContain('title="Back"');
  });

  it('keeps header ownership in dedicated module', () => {
    const headerSource = readFileSync(PAGE_REWRITE_HEADER_PATH, 'utf-8'); // readFile-ok - migration guard: header ownership must remain centralized.

    expect(headerSource).toContain('export function PageRewriteHeaderBar');
    expect(headerSource).toContain('Search pages or paste a URL…');
    expect(headerSource).toContain('No sitemap — paste a full URL above');
    expect(headerSource).toContain('title="Back"');
  });
});
