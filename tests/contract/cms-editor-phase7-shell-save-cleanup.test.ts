import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const CMS_EDITOR_PATH = 'src/components/CmsEditor.tsx';
const CMS_EDITOR_SHELL_PANELS_PATH = 'src/components/cms-editor/CmsEditorShellPanels.tsx';
const CMS_EDITOR_SAVE_HOOK_PATH = 'src/components/cms-editor/useCmsEditorSaveWorkflow.ts';

describe('CmsEditor phase-7 shell + save cleanup contract', () => {
  it('wires CmsEditor root to extracted shell-panels and save workflow modules', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: CmsEditor root should consume extracted shell/save modules in phase 7.

    expect(cmsEditorSource).toContain("from './cms-editor/CmsEditorShellPanels'");
    expect(cmsEditorSource).toContain("from './cms-editor/useCmsEditorSaveWorkflow'");
    expect(cmsEditorSource).toContain('useCmsEditorSaveWorkflow({');
    expect(cmsEditorSource).toContain('<CmsEditorShellPanels');
    expect(cmsEditorSource).toContain('onBulkAiRewrite={bulkAiRewrite}');
  });

  it('keeps save mutation + shell chrome ownership out of CmsEditor root', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: root should remain composition-first after phase-7 extraction.

    expect(cmsEditorSource).not.toContain('const saveItem = async');
    expect(cmsEditorSource).not.toContain('/api/webflow/collections/${collectionId}/items/${itemId}');
    expect(cmsEditorSource).not.toContain('setSaving(prev => new Set(prev).add(itemId))');
    expect(cmsEditorSource).not.toContain('Edit SEO-relevant fields on collection items');
    expect(cmsEditorSource).not.toContain('Send for Approval (');
    expect(cmsEditorSource).not.toContain('placeholder="Search items..."');
  });

  it('keeps shell + save logic in extracted phase-7 modules', () => {
    const shellPanelsSource = readFileSync(CMS_EDITOR_SHELL_PANELS_PATH, 'utf-8'); // readFile-ok - migration guard: shell chrome ownership belongs to extracted panel module.
    const saveHookSource = readFileSync(CMS_EDITOR_SAVE_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: save mutation ownership belongs to extracted save workflow hook.

    expect(shellPanelsSource).toContain('export function CmsEditorShellPanels');
    expect(shellPanelsSource).toContain('Edit SEO-relevant fields on collection items');
    expect(shellPanelsSource).toContain('Send for Approval (');
    expect(shellPanelsSource).toContain('placeholder="Search items..."');

    expect(saveHookSource).toContain('export function useCmsEditorSaveWorkflow');
    expect(saveHookSource).toContain('/api/webflow/collections/${collectionId}/items/${itemId}');
    expect(saveHookSource).toContain("'Save failed'");
    expect(saveHookSource).toContain("'Network error'");
  });
});
