import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_PATH = 'src/components/SeoEditor.tsx';

describe('SeoEditor bulk workflow extraction contract', () => {
  it('wires SeoEditor through useSeoEditorBulkWorkflow', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).toContain("from './editor/useSeoEditorBulkWorkflow'");
    expect(source).toContain('useSeoEditorBulkWorkflow({');
  });

  it('keeps inline bulk orchestration out of SeoEditor', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).not.toContain('useWorkspaceEvents(workspaceId');
    expect(source).not.toContain('const analyzeAllPages = async');
    expect(source).not.toContain('const handleBulkFix = async');
    expect(source).not.toContain('const previewPattern = () =>');
    expect(source).not.toContain('const bulkAiRewrite = async');
  });
});
