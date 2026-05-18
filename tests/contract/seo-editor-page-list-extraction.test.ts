import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_PATH = 'src/components/SeoEditor.tsx';

describe('SeoEditor page list extraction contract', () => {
  it('wires SeoEditor to extracted page list component', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).toContain("from './editor/SeoEditorPageList'");
    expect(source).toContain('<SeoEditorPageList');
  });

  it('keeps page-list rendering markup out of SeoEditor', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).not.toContain('<PageEditRow');
    expect(source).not.toContain('No CMS pages found');
    expect(source).not.toContain('Manual apply required — CMS pages must be updated directly in Webflow');
  });

  it('guards against invalid inline page-list import regressions in SeoEditor', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).not.toContain("from './PageEditRow'");
    expect(source).not.toContain('function PageEditRow(');
    expect(source).not.toContain('const PageEditRow =');
  });
});
