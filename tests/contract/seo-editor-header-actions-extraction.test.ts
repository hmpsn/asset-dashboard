import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_PATH = 'src/components/SeoEditor.tsx';

describe('SeoEditor header actions extraction contract', () => {
  it('wires SeoEditor to extracted header actions component', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).toContain("from './editor/SeoEditorHeaderActions'");
    expect(source).toContain('<SeoEditorHeaderActions');
  });

  it('keeps toolbar/publish markup out of SeoEditor', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).not.toContain('AI Fix Titles (');
    expect(source).not.toContain('AI Fix Descriptions (');
    expect(source).not.toContain('Publish Site');
    expect(source).not.toContain('<ApprovalPanel');
    expect(source).not.toContain('AI is generating content for');
    expect(source).not.toContain('Published!');
  });
});
