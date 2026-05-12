import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const PAGE_REWRITE_CHAT_PATH = 'src/components/PageRewriteChat.tsx';
const PAGE_REWRITE_SHELL_HOOK_PATH = 'src/components/page-rewrite-chat/usePageRewriteChatShell.ts';

describe('PageRewriteChat phase-7 shell hook extraction contract', () => {
  it('wires root shell to extracted workflow hook', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: root shell must consume extracted workflow hook in phase 7.

    expect(rewriteChatSource).toContain("from './page-rewrite-chat/usePageRewriteChatShell'");
    expect(rewriteChatSource).toContain('usePageRewriteChatShell({ workspaceId, initialPageUrl, toast })');
    expect(rewriteChatSource).toContain('onSendMessage={sendMessage}');
    expect(rewriteChatSource).toContain('onToggleExport={toggleExportOpen}');
  });

  it('keeps shell-state ownership out of the root component', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: shell state/effects should not drift back into root.

    expect(rewriteChatSource).not.toContain('const [messages, setMessages]');
    expect(rewriteChatSource).not.toContain('const [comboOpen, setComboOpen]');
    expect(rewriteChatSource).not.toContain('document.addEventListener(\'selectionchange\'');
    expect(rewriteChatSource).not.toContain('const loadPage = useCallback');
  });

  it('keeps shell workflow ownership in dedicated hook module', () => {
    const hookSource = readFileSync(PAGE_REWRITE_SHELL_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: workflow ownership must remain centralized.

    expect(hookSource).toContain('export function usePageRewriteChatShell');
    expect(hookSource).toContain('const [messages, setMessages]');
    expect(hookSource).toContain('document.addEventListener(\'selectionchange\'');
    expect(hookSource).toContain('const loadPage = useCallback');
  });
});
