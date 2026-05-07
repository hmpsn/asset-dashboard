import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_PATH = 'src/components/SeoEditor.tsx';

describe('SeoEditor page workflow extraction contract', () => {
  it('wires SeoEditor through useSeoEditorPageWorkflow', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).toContain("from './editor/useSeoEditorPageWorkflow'");
    expect(source).toContain('useSeoEditorPageWorkflow({');
  });

  it('keeps inline page workflow handlers out of SeoEditor', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).not.toContain('const saveDraft = async');
    expect(source).not.toContain('const savePage = async');
    expect(source).not.toContain('const aiRewrite = async');
    expect(source).not.toContain('const analyzePage = async');
  });
});
