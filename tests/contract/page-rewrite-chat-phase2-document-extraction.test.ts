import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const PAGE_REWRITE_CHAT_PATH = 'src/components/PageRewriteChat.tsx';
const PAGE_REWRITE_CHAT_SHELL_HOOK_PATH = 'src/components/page-rewrite-chat/usePageRewriteChatShell.ts';
const PAGE_REWRITE_CHAT_DOCUMENT_PATH = 'src/components/page-rewrite-chat/pageRewriteChatDocument.ts';
const PAGE_REWRITE_DOCX_EXPORT_PATH = 'src/components/page-rewrite-chat/pageRewriteDocxExport.ts';
const REBUILT_REWRITER_HOOK_PATH = 'src/components/page-rewriter-rebuilt/usePageRewriterSurfaceState.ts';
const REBUILT_REWRITER_EXPORT_PATH = 'src/components/page-rewriter-rebuilt/pageRewriterExport.ts';

describe('PageRewriteChat phase-2 document extraction contract', () => {
  it('wires shell workflow layer to extracted document helpers', () => {
    const shellHookSource = readFileSync(PAGE_REWRITE_CHAT_SHELL_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: shell workflow layer must consume extracted document helpers in phase 2.

    expect(shellHookSource).toContain("from './pageRewriteChatDocument'");
    expect(shellHookSource).toContain('buildDocHtml(pageData)');
    expect(shellHookSource).toContain('serializeDocToMarkdown(docBodyRef.current, pageData)');
    expect(shellHookSource).toContain("import('./pageRewriteDocxExport')");
    expect(shellHookSource).not.toContain("from 'docx'");
  });

  it('keeps document serialization/building logic out of root shell', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: document build/serialize logic should not drift back into root shell.

    expect(rewriteChatSource).not.toContain('const buildDocHtml = (data: PageData)');
    expect(rewriteChatSource).not.toContain('const serializeDocToMarkdown = (): string');
    expect(rewriteChatSource).not.toContain('const serializeDocToDocx = (): Paragraph[]');
  });

  it('keeps cheap document helpers separate from the on-demand DOCX boundary', () => {
    const documentSource = readFileSync(PAGE_REWRITE_CHAT_DOCUMENT_PATH, 'utf-8'); // readFile-ok - migration guard: extracted document helper ownership must stay centralized.
    const docxSource = readFileSync(PAGE_REWRITE_DOCX_EXPORT_PATH, 'utf-8'); // readFile-ok - migration guard: DOCX must remain behind its on-demand module boundary.

    expect(documentSource).toContain('export function buildDocHtml');
    expect(documentSource).toContain('export function serializeDocToMarkdown');
    expect(documentSource).not.toContain("from 'docx'");
    expect(documentSource).not.toContain('serializeDocToDocx');
    expect(docxSource).toContain("from 'docx'");
    expect(docxSource).toContain('export function serializeDocToDocx');
    expect(docxSource).toContain('export async function downloadPageRewriteDocx');
  });

  it('starts activation-sensitive rebuilt exports synchronously while keeping DOCX on demand', () => {
    const rebuiltHookSource = readFileSync(REBUILT_REWRITER_HOOK_PATH, 'utf-8'); // readFile-ok - browser contract: clipboard and print exports must begin inside the originating click task.
    const rebuiltExportSource = readFileSync(REBUILT_REWRITER_EXPORT_PATH, 'utf-8'); // readFile-ok - migration guard: the shared exporter owns the nested DOCX boundary.

    expect(rebuiltHookSource).toContain("from './pageRewriterExport'");
    expect(rebuiltHookSource).not.toContain("import('./pageRewriterExport')");
    expect(rebuiltHookSource).not.toContain("from 'docx'");
    expect(rebuiltExportSource).toContain("import('../page-rewrite-chat/pageRewriteDocxExport')");
    expect(rebuiltExportSource).not.toContain("from 'docx'");
  });
});
