import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const CMS_EDITOR_PATH = 'src/components/CmsEditor.tsx';
const CMS_EDITOR_MODEL_PATH = 'src/components/cms-editor/cmsEditorModel.ts';

describe('CmsEditor phase-1 model extraction contract', () => {
  it('wires CmsEditor to extracted shared model/helpers', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: CmsEditor root should consume extracted model/helpers in phase 1.

    expect(cmsEditorSource).toContain("from './cms-editor/cmsEditorModel'");
    expect(cmsEditorSource).toContain('buildInitialEdits(collections)');
    expect(cmsEditorSource).toContain('buildItemApprovalMap(approvalBatches)');
    expect(cmsEditorSource).toContain('filterAndRankCollectionItems(coll, search)');
  });

  it('keeps CmsEditor contracts out of the root shell', () => {
    const cmsEditorSource = readFileSync(CMS_EDITOR_PATH, 'utf-8'); // readFile-ok - migration guard: contract/type definitions should live in extracted model module after phase 1.

    expect(cmsEditorSource).not.toContain('interface SeoField');
    expect(cmsEditorSource).not.toContain('interface ApprovalItem');
    expect(cmsEditorSource).not.toContain('interface CmsItem');
    expect(cmsEditorSource).not.toContain('interface CmsCollection');
  });

  it('keeps extracted module ownership for shared contracts and helpers', () => {
    const modelSource = readFileSync(CMS_EDITOR_MODEL_PATH, 'utf-8'); // readFile-ok - migration guard: shared contracts/helpers must remain centralized for subsequent CmsEditor phases.

    expect(modelSource).toContain('export interface SeoField');
    expect(modelSource).toContain('export interface CmsCollection');
    expect(modelSource).toContain('export function buildInitialEdits');
    expect(modelSource).toContain('export function buildItemApprovalMap');
    expect(modelSource).toContain('export function buildApprovalPayloadItems');
    expect(modelSource).toContain('export function filterAndRankCollectionItems');
  });
});
