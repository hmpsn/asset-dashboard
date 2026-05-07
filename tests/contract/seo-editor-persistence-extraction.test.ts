import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_PATH = 'src/components/SeoEditor.tsx';
const PERSISTENCE_MODULE_PATH = 'src/components/editor/seoEditorPersistence.ts';
const SESSION_STATE_HOOK_PATH = 'src/components/editor/useSeoEditorSessionState.ts';

describe('SeoEditor persistence extraction contract', () => {
  it('keeps SeoEditor wired to the extracted session-state hook', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).toContain("from './editor/useSeoEditorSessionState'");
    expect(source).toContain('useSeoEditorSessionState({');
    expect(source).not.toContain("from './editor/seoEditorPersistence'");
  });

  it('keeps persistence helper wiring owned by the session-state hook', () => {
    const source = fs.readFileSync(SESSION_STATE_HOOK_PATH, 'utf-8');

    expect(source).toContain("from './seoEditorPersistence'");
    expect(source).toContain('readCachedSeoEdits(');
    expect(source).toContain('persistCachedSeoEdits(');
  });

  it('prevents direct inline storage-key parsing from returning to SeoEditor', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).not.toContain('sessionStorage.getItem(`seo-editor-edits-');
    expect(source).not.toContain('sessionStorage.getItem(`seo-editor-expanded-');
    expect(source).not.toContain('sessionStorage.getItem(`seo-editor-vars-');
  });

  it('stores all SeoEditor storage-key helpers in the dedicated module', () => {
    const source = fs.readFileSync(PERSISTENCE_MODULE_PATH, 'utf-8');

    expect(source).toContain('getSeoEditorEditsKey');
    expect(source).toContain('getSeoEditorExpandedKey');
    expect(source).toContain('getSeoEditorVariationsKey');
    expect(source).toContain('getSeoDraftKey');
  });
});
