import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const CMS_EDITOR_PATH = 'src/components/CmsEditor.tsx';
const CMS_EDITOR_APPROVAL_HOOK_PATH = 'src/components/cms-editor/useCmsEditorApprovalWorkflow.ts';

describe('CmsEditor phase-2 approval hook extraction contract', () => {
  it('wires CmsEditor to the extracted approval workflow hook', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: CmsEditor root should consume extracted approval workflow hook in phase 2.

    expect(cmsEditorSource).toContain("from './cms-editor/useCmsEditorApprovalWorkflow'");
    expect(cmsEditorSource).toContain('useCmsEditorApprovalWorkflow({');
    expect(cmsEditorSource).toContain('approvalSelected,');
    expect(cmsEditorSource).toContain('sendForApproval,');
  });

  it('keeps approval workflow ownership out of CmsEditor root', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: approval workflow state and send handler should not drift back into CmsEditor root shell.

    expect(cmsEditorSource).not.toContain('const sendForApproval = async');
    expect(cmsEditorSource).not.toContain('setApprovalSelected(');
    expect(cmsEditorSource).not.toContain('setSendingApproval(');
    expect(cmsEditorSource).not.toContain('setApprovalSent(');
    expect(cmsEditorSource).not.toContain('setApprovalRefreshKey(');
    expect(cmsEditorSource).not.toContain('setErrorStates(');
  });

  it('keeps approval workflow orchestration in the extracted hook', () => {
    const hookSource = readFileSync(CMS_EDITOR_APPROVAL_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: approval state/select-all/send logic belongs in extracted hook after phase 2.

    expect(hookSource).toContain('export function useCmsEditorApprovalWorkflow');
    expect(hookSource).toContain('const [approvalSelected, setApprovalSelected]');
    expect(hookSource).toContain('const [sendingApproval, setSendingApproval]');
    expect(hookSource).toContain('buildApprovalPayloadItems(approvalSelected, edits, collections)');
    expect(hookSource).toContain('const sendForApproval = useCallback(async (note?: string) => {');
  });
});
