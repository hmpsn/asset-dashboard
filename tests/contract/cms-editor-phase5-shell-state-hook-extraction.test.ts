import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const CMS_EDITOR_PATH = 'src/components/CmsEditor.tsx';
const CMS_EDITOR_SHELL_HOOK_PATH = 'src/components/cms-editor/useCmsEditorShellState.ts';

describe('CmsEditor phase-5 shell state hook extraction contract', () => {
  it('wires CmsEditor to the extracted shell-state hook', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: CmsEditor root should consume extracted shell-state hook in phase 5.

    expect(cmsEditorSource).toContain("from './cms-editor/useCmsEditorShellState'");
    expect(cmsEditorSource).toContain('useCmsEditorShellState({ siteId, collections })');
    expect(cmsEditorSource).toContain('expandedCollections,');
    expect(cmsEditorSource).toContain('expandedItems,');
    expect(cmsEditorSource).toContain('edits,');
    expect(cmsEditorSource).toContain('dirty,');
    expect(cmsEditorSource).toContain('saved,');
    expect(cmsEditorSource).toContain('toggleCollection,');
    expect(cmsEditorSource).toContain('toggleItem,');
    expect(cmsEditorSource).toContain('toggleHistory,');
    expect(cmsEditorSource).toContain('togglePreview,');
    expect(cmsEditorSource).toContain('updateField,');
  });

  it('keeps shell state/session orchestration out of CmsEditor root', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: shell state/session orchestration should not drift back into CmsEditor root shell.

    expect(cmsEditorSource).not.toContain('const restoredFromCache = useRef(false)');
    expect(cmsEditorSource).not.toContain('sessionStorage.getItem(');
    expect(cmsEditorSource).not.toContain('sessionStorage.setItem(');
    expect(cmsEditorSource).not.toContain('const [expandedCollections, setExpandedCollections]');
    expect(cmsEditorSource).not.toContain('const [expandedItems, setExpandedItems]');
    expect(cmsEditorSource).not.toContain('const [edits, setEdits]');
    expect(cmsEditorSource).not.toContain('const [dirty, setDirty]');
    expect(cmsEditorSource).not.toContain('const toggleCollection = (');
    expect(cmsEditorSource).not.toContain('const toggleItem = (');
    expect(cmsEditorSource).not.toContain('const toggleHistory = (');
    expect(cmsEditorSource).not.toContain('const togglePreview = (');
    expect(cmsEditorSource).not.toContain('const updateField = (');
  });

  it('keeps shell state/session orchestration in extracted hook', () => {
    const hookSource = readFileSync(CMS_EDITOR_SHELL_HOOK_PATH, 'utf-8'); // readFile-ok - migration guard: shell state/session orchestration belongs in extracted hook after phase 5.

    expect(hookSource).toContain('export function useCmsEditorShellState');
    expect(hookSource).toContain('const restoredFromCache = useRef(false)');
    expect(hookSource).toContain('sessionStorage.getItem(');
    expect(hookSource).toContain('sessionStorage.setItem(');
    expect(hookSource).toContain('const [expandedCollections, setExpandedCollections]');
    expect(hookSource).toContain('const [expandedItems, setExpandedItems]');
    expect(hookSource).toContain('const [edits, setEdits]');
    expect(hookSource).toContain('const [dirty, setDirty]');
    expect(hookSource).toContain('const toggleCollection = (');
    expect(hookSource).toContain('const toggleItem = (');
    expect(hookSource).toContain('const toggleHistory = (');
    expect(hookSource).toContain('const togglePreview = (');
    expect(hookSource).toContain('const updateField = (');
  });
});
