import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const PAGE_REWRITE_CHAT_PATH = 'src/components/PageRewriteChat.tsx';
const PAGE_REWRITE_CHAT_ACTIONS_PATH = 'src/components/page-rewrite-chat/pageRewriteChatActions.ts';

describe('PageRewriteChat phase-3 actions extraction contract', () => {
  it('wires root shell to extracted action helpers', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: root shell must consume extracted action helpers in phase 3.

    expect(rewriteChatSource).toContain("from './page-rewrite-chat/pageRewriteChatActions'");
    expect(rewriteChatSource).toContain('applyRewriteToSection(docBodyRef.current, content, sectionTarget)');
    expect(rewriteChatSource).toContain("wrapSelectionHeading('h2', docBodyRef.current)");
    expect(rewriteChatSource).toContain("execFormatCommand('bold', docBodyRef.current)");
  });

  it('keeps editor action implementation details out of root shell', () => {
    const rewriteChatSource = readFileSync(PAGE_REWRITE_CHAT_PATH, 'utf-8'); // readFile-ok - migration guard: editor actions should not drift back into root shell.

    expect(rewriteChatSource).not.toContain("document.execCommand('formatBlock'");
    expect(rewriteChatSource).not.toContain('const wrapHeading = (tag:');
    expect(rewriteChatSource).not.toContain('const targetSlug = toSectionSlug(sectionTarget)');
    expect(rewriteChatSource).not.toContain("const p = document.createElement('p')");
  });

  it('keeps extracted action ownership in dedicated module', () => {
    const actionsSource = readFileSync(PAGE_REWRITE_CHAT_ACTIONS_PATH, 'utf-8'); // readFile-ok - migration guard: extracted editor actions must remain centralized.

    expect(actionsSource).toContain('export function execFormatCommand');
    expect(actionsSource).toContain('export function clearFormattingSelection');
    expect(actionsSource).toContain('export function wrapSelectionHeading');
    expect(actionsSource).toContain('export function applyRewriteToSection');
  });
});
