import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_PATH = 'src/components/SeoEditor.tsx';

describe('SeoEditor workflow panels extraction contract', () => {
  it('wires SeoEditor to extracted workflow panels component', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).toContain("from './editor/SeoEditorWorkflowPanels'");
    expect(source).toContain('<SeoEditorWorkflowPanels');
  });

  it('keeps unsaved/suggestions/bulk markup out of SeoEditor', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).not.toContain('You have unsaved changes. Save individual pages then publish to go live.');
    expect(source).not.toContain('<SeoSuggestionsPanel');
    expect(source).not.toContain('<BulkOperations');
    expect(source).not.toContain('<PendingApprovals');
  });
});
