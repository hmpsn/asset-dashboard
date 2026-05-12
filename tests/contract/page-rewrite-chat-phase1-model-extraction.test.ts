import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const PAGE_REWRITE_CHAT_PATH = 'src/components/PageRewriteChat.tsx';
const PAGE_REWRITE_CHAT_SHELL_HOOK_PATH = 'src/components/page-rewrite-chat/usePageRewriteChatShell.ts';
const PAGE_REWRITE_CHAT_MODEL_PATH = 'src/components/page-rewrite-chat/pageRewriteChatModel.ts';

describe('PageRewriteChat phase-1 model extraction contract', () => {
  it('wires shell workflow layer to extracted model/helpers', () => {
    const shellHookSource = readFileSync(PAGE_REWRITE_CHAT_SHELL_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: shell workflow layer must consume extracted model/helpers in phase 1.

    expect(shellHookSource).toContain("from './pageRewriteChatModel'");
    expect(shellHookSource).toContain('createRewriteSessionId()');
    expect(shellHookSource).toContain('const comboQueryIsUrl = isUrlQuery(comboQuery)');
    expect(shellHookSource).toContain('const filteredPages = comboQueryIsUrl');
  });

  it('keeps contracts + prompt/model helpers out of root shell', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: shared contracts/helpers should not drift back into root shell.

    expect(rewriteChatSource).not.toContain('interface PageData');
    expect(rewriteChatSource).not.toContain('interface ChatMessage');
    expect(rewriteChatSource).not.toContain('const QUICK_PROMPTS = [');
    expect(rewriteChatSource).not.toContain('const HEADING_CLASSES: Record<string, string>');
    expect(rewriteChatSource).not.toContain('const isUrlQuery = comboQuery.startsWith');
  });

  it('keeps extracted model ownership in dedicated module', () => {
    const modelSource = readFileSync(PAGE_REWRITE_CHAT_MODEL_PATH, 'utf-8'); // readFile-ok - migration guard: shared contracts/helpers must remain centralized for later phases.

    expect(modelSource).toContain('export interface PageData');
    expect(modelSource).toContain('export interface ChatMessage');
    expect(modelSource).toContain('export const QUICK_PROMPTS');
    expect(modelSource).toContain('export const HEADING_CLASSES');
    expect(modelSource).toContain('export function createRewriteSessionId');
    expect(modelSource).toContain('export function isUrlQuery');
  });
});
