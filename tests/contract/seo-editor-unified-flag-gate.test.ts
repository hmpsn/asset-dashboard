import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SEO_EDITOR_WRAPPER_PATH = 'src/components/SeoEditorWrapper.tsx';

describe('SEO editor unified defaults', () => {
  it('renders the unified static/CMS editor as the only path', () => {
    const source = readFileSync(SEO_EDITOR_WRAPPER_PATH, 'utf-8'); // readFile-ok - contract guard: unified editor must remain the default and only runtime path after sunset.

    expect(source).not.toContain("useFeatureFlag('seo-editor-unified')");
    expect(source).not.toContain('LegacySeoEditorWrapper');
    expect(source).toContain('<UnifiedSeoEditorWrapper');
    expect(source).toContain('<PendingApprovals');
    expect(source).toContain('nameFilter="SEO"');
    expect(source).toContain('refreshKey={approvalRefreshKey}');
    expect(source).toContain('onRetracted={handleUnifiedApprovalsRetracted}');
    expect(source).toContain('showPendingApprovals={false}');
    expect(source).toContain('onApprovalBatchMutated={handleUnifiedApprovalMutation}');
  });
});
