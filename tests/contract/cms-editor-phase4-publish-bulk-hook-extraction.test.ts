import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const CMS_EDITOR_PATH = 'src/components/CmsEditor.tsx';
const CMS_EDITOR_PUBLISH_BULK_HOOK_PATH = 'src/components/cms-editor/useCmsEditorPublishBulkWorkflow.ts';

describe('CmsEditor phase-4 publish+bulk hook extraction contract', () => {
  it('wires CmsEditor to the extracted publish+bulk workflow hook', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: CmsEditor root should consume extracted publish/bulk workflow hook in phase 4.

    expect(cmsEditorSource).toContain("from './cms-editor/useCmsEditorPublishBulkWorkflow'");
    expect(cmsEditorSource).toContain('useCmsEditorPublishBulkWorkflow({');
    expect(cmsEditorSource).toContain('publishCollection,');
    expect(cmsEditorSource).toContain('bulkAiRewrite,');
    expect(cmsEditorSource).toContain('publishing,');
    expect(cmsEditorSource).toContain('published,');
    expect(cmsEditorSource).toContain('bulkMode,');
    expect(cmsEditorSource).toContain('bulkProgress,');
    expect(cmsEditorSource).toContain('bulkResults,');
  });

  it('keeps publish+bulk orchestration out of CmsEditor root', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: publish + bulk orchestration should not drift back into CmsEditor root shell.

    expect(cmsEditorSource).not.toContain('const [publishing, setPublishing]');
    expect(cmsEditorSource).not.toContain('const [published, setPublished]');
    expect(cmsEditorSource).not.toContain('const [bulkMode, setBulkMode]');
    expect(cmsEditorSource).not.toContain('const [bulkProgress, setBulkProgress]');
    expect(cmsEditorSource).not.toContain('const [bulkResults, setBulkResults]');
    expect(cmsEditorSource).not.toContain('const publishCollection = async');
    expect(cmsEditorSource).not.toContain('const bulkAiRewrite = async');
  });

  it('keeps publish+bulk orchestration in extracted hook', () => {
    const hookSource = readFileSync(CMS_EDITOR_PUBLISH_BULK_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: publish and bulk rewrite orchestration belongs in extracted hook after phase 4.

    expect(hookSource).toContain('export function useCmsEditorPublishBulkWorkflow');
    expect(hookSource).toContain('const [publishing, setPublishing]');
    expect(hookSource).toContain('const [published, setPublished]');
    expect(hookSource).toContain('const [bulkMode, setBulkMode]');
    expect(hookSource).toContain('const [bulkProgress, setBulkProgress]');
    expect(hookSource).toContain('const [bulkResults, setBulkResults]');
    expect(hookSource).toContain('const publishCollection = async');
    expect(hookSource).toContain('const bulkAiRewrite = async');
  });
});
