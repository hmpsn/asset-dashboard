import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const CMS_EDITOR_PATH = 'src/components/CmsEditor.tsx';
const CMS_EDITOR_AI_HOOK_PATH = 'src/components/cms-editor/useCmsEditorAiWorkflow.ts';

describe('CmsEditor phase-3 AI workflow hook extraction contract', () => {
  it('wires CmsEditor to the extracted AI workflow hook', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: CmsEditor root should consume extracted AI rewrite workflow hook in phase 3.

    expect(cmsEditorSource).toContain("from './cms-editor/useCmsEditorAiWorkflow'");
    expect(cmsEditorSource).toContain('useCmsEditorAiWorkflow({');
    expect(cmsEditorSource).toContain('aiRewrite,');
    expect(cmsEditorSource).toContain('aiRewriteBoth,');
    expect(cmsEditorSource).toContain('aiError,');
    expect(cmsEditorSource).toContain('variations,');
    expect(cmsEditorSource).toContain('aiLoading,');
  });

  it('keeps AI workflow ownership out of CmsEditor root', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: AI loading/variation state and rewrite orchestration should not drift back into CmsEditor root shell.

    expect(cmsEditorSource).not.toContain('const [variations, setVariations]');
    expect(cmsEditorSource).not.toContain('const [aiLoading, setAiLoading]');
    expect(cmsEditorSource).not.toContain('const aiRewrite = async');
    expect(cmsEditorSource).not.toContain('const aiRewriteBoth = async');
  });

  it('keeps AI workflow orchestration in the extracted hook', () => {
    const hookSource = readFileSync(CMS_EDITOR_AI_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: AI rewrite state and orchestration belongs in extracted hook after phase 3.

    expect(hookSource).toContain('export function useCmsEditorAiWorkflow');
    expect(hookSource).toContain('const [variations, setVariations]');
    expect(hookSource).toContain('const [aiLoading, setAiLoading]');
    expect(hookSource).toContain('const aiRewrite = async');
    expect(hookSource).toContain('const aiRewriteBoth = async');
    expect(hookSource).toContain("post<{ text?: string; variations?: string[] }>('/api/webflow/seo-rewrite'");
  });

  it('prevents invalid duplicate aiError state ownership across shell and hook', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - regression guard: aiError state should remain hook-owned
    const hookSource = readFileSync(CMS_EDITOR_AI_HOOK_PATH, 'utf-8'); // readFile-ok - regression guard: aiError state should remain in hook

    expect(cmsEditorSource).not.toContain('const [aiError, setAiError]');
    expect(hookSource).toContain('const [aiError, setAiError]');
  });
});
