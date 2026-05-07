import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_PATH = 'src/components/SeoEditor.tsx';

describe('SeoEditor approval workflow extraction contract', () => {
  it('wires SeoEditor through useSeoEditorApprovalWorkflow', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).toContain("from './editor/useSeoEditorApprovalWorkflow'");
    expect(source).toContain('useSeoEditorApprovalWorkflow({');
  });

  it('keeps inline approval orchestration out of SeoEditor', () => {
    const source = fs.readFileSync(SEO_EDITOR_PATH, 'utf-8');

    expect(source).not.toContain('const sendPageToClient = async');
    expect(source).not.toContain('const sendForApproval = async');
    expect(source).not.toContain('const toggleApprovalSelect =');
  });
});
