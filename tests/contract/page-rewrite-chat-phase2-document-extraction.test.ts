import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const PAGE_REWRITE_CHAT_PATH = 'src/components/PageRewriteChat.tsx';
const PAGE_REWRITE_CHAT_SHELL_HOOK_PATH = 'src/components/page-rewrite-chat/usePageRewriteChatShell.ts';
const PAGE_REWRITE_CHAT_DOCUMENT_PATH = 'src/components/page-rewrite-chat/pageRewriteChatDocument.ts';

describe('PageRewriteChat phase-2 document extraction contract', () => {
  it('wires shell workflow layer to extracted document helpers', () => {
    const shellHookSource = readFileSync(PAGE_REWRITE_CHAT_SHELL_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: shell workflow layer must consume extracted document helpers in phase 2.

    expect(shellHookSource).toContain("from './pageRewriteChatDocument'");
    expect(shellHookSource).toContain('buildDocHtml(pageData)');
    expect(shellHookSource).toContain('serializeDocToMarkdown(docBodyRef.current, pageData)');
    expect(shellHookSource).toContain('serializeDocToDocx(docBodyRef.current, pageData)');
  });

  it('keeps document serialization/building logic out of root shell', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: document build/serialize logic should not drift back into root shell.

    expect(rewriteChatSource).not.toContain('const buildDocHtml = (data: PageData)');
    expect(rewriteChatSource).not.toContain('const serializeDocToMarkdown = (): string');
    expect(rewriteChatSource).not.toContain('const serializeDocToDocx = (): Paragraph[]');
  });

  it('keeps extracted document helper ownership in dedicated module', () => {
    const documentSource = readFileSync(PAGE_REWRITE_CHAT_DOCUMENT_PATH, 'utf-8'); // readFile-ok - migration guard: extracted document helper ownership must stay centralized.

    expect(documentSource).toContain('export function buildDocHtml');
    expect(documentSource).toContain('export function serializeDocToMarkdown');
    expect(documentSource).toContain('export function serializeDocToDocx');
  });
});
