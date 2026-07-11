import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('ContentBriefs workflow extraction boundary', () => {
  const component = read('src/components/ContentBriefs.tsx');
  const hook = read('src/hooks/admin/useAdminBriefWorkflow.ts');

  it('keeps ContentBriefs as the render shell over useAdminBriefWorkflow', () => {
    expect(component).toContain('useAdminBriefWorkflow({ workspaceId, fixContext, clearFixContext, initialBriefId })');
    expect(component).toContain('<BriefGenerator');
    expect(component).toContain('<RequestList');
    expect(component).toContain('<BriefList');
  });

  it('keeps background jobs, query cache writes, and raw API calls out of ContentBriefs', () => {
    expect(component).not.toContain('useBackgroundTasks');
    expect(component).not.toContain('useQueryClient');
    expect(component).not.toContain('queryClient.setQueryData');
    expect(component).not.toContain("post<");
    expect(component).not.toContain("patch<");
    expect(component).not.toContain("del(");
    expect(component).not.toContain("getSafe<");
    expect(component).not.toContain("getText(");
  });

  it('keeps brief/request mutation and job wiring in the workflow hook', () => {
    expect(hook).toContain("type: BACKGROUND_JOB_TYPES.CONTENT_BRIEF_GENERATION");
    expect(hook).toContain('BACKGROUND_JOB_TYPES.CONTENT_BRIEF_REGENERATE');
    expect(hook).toContain('BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION');
    expect(hook).toContain('/api/content-requests/${workspaceId}/${reqId}');
    expect(hook).toContain('/api/content-briefs/${workspaceId}/${briefId}/regenerate');
    expect(hook).toContain('/api/content-posts/${workspaceId}/generate');
  });
});
