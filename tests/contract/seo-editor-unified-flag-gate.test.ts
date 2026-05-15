import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_WRAPPER_PATH = 'src/components/SeoEditorWrapper.tsx';

describe('SEO editor unified flag gate', () => {
  it('keeps the unified static/CMS editor behind the seo-editor-unified flag', () => {
    const source = readFileSync(SEO_EDITOR_WRAPPER_PATH, 'utf-8'); // readFile-ok - contract guard: unified SEO Editor is staged behind a rollback flag.

    expect(source).toContain("useFeatureFlag('seo-editor-unified')");
    expect(source).toContain('if (!unifiedEditorEnabled)');
    expect(source).toContain('<LegacySeoEditorWrapper');
    expect(source).toContain('<UnifiedSeoEditorWrapper');
    expect(source).toContain('<PendingApprovals');
    expect(source).toContain('nameFilter="SEO"');
    expect(source).toContain('refreshKey={approvalRefreshKey}');
    expect(source).toContain('onRetracted={handleUnifiedApprovalsRetracted}');
    expect(source).toContain('showPendingApprovals={false}');
    expect(source).toContain('onApprovalBatchMutated={handleUnifiedApprovalMutation}');
  });

  it('preserves the legacy Pages / CMS Collections split for the flag-off path', () => {
    const source = readFileSync(SEO_EDITOR_WRAPPER_PATH, 'utf-8'); // readFile-ok - contract guard: flag-off behavior must keep legacy split editor active.

    expect(source).toContain("label: 'Pages'");
    expect(source).toContain("label: 'CMS Collections'");
    expect(source).toContain('<SeoEditor siteId={siteId} workspaceId={workspaceId} fixContext={fixContext} />');
    expect(source).toContain('<CmsEditor siteId={siteId} workspaceId={workspaceId} />');
  });
});
