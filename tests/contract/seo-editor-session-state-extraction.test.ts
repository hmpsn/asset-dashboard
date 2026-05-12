import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_PATH = 'src/components/SeoEditor.tsx';

describe('SeoEditor session state extraction contract', () => {
  it('wires SeoEditor to extracted session-state hook', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).toContain("from './editor/useSeoEditorSessionState'");
    expect(source).toContain('useSeoEditorSessionState({');
  });

  it('keeps cache hydration/persistence/fix-context session logic out of SeoEditor', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).not.toContain('readCachedSeoEdits');
    expect(source).not.toContain('persistCachedSeoVariations');
    expect(source).not.toContain('buildSeoEditsFromPages');
    expect(source).not.toContain('fixConsumed');
    expect(source).not.toContain('const hasUnsaved =');
    expect(source).not.toContain('const toggleExpand =');
    expect(source).not.toContain('const togglePreview =');
  });
});
