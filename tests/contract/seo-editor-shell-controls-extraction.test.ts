import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_PATH = 'src/components/SeoEditor.tsx';
const TABLE_CONTROLS_PATH = 'src/components/editor/SeoEditorTableControls.tsx';

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

  it('keeps sitemap CMS rows out of the static Pages filter surface', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');
    const controls = fs.readFileSync(TABLE_CONTROLS_PATH, 'utf-8');

    expect(source).toContain('filterWritablePages(pages)');
    expect(source).toContain('filterAndSortSeoPages(writablePages');
    expect(source).toContain('pages: writablePages');
    expect(controls).not.toContain('CMS pages only');
    expect(controls).toContain('CMS items are managed in CMS Collections.');
  });
});
