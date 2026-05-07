import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_PATH = 'src/components/SeoEditor.tsx';

describe('SeoEditor shell controls extraction contract', () => {
  it('wires SeoEditor to extracted table controls + tracking summary components', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).toContain("from './editor/SeoEditorTableControls'");
    expect(source).toContain("from './editor/SeoEditorTrackingSummary'");
    expect(source).toContain('<SeoEditorTableControls');
    expect(source).toContain('<SeoEditorTrackingSummary');
  });

  it('keeps large inline controls markup out of SeoEditor', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).not.toContain('Analyzing {bulkAnalyzeProgress.done}/{bulkAnalyzeProgress.total} pages...');
    expect(source).not.toContain('CMS pages only');
    expect(source).not.toContain('reset all');
  });
});
