import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('background job task panel wiring', () => {
  it('tracks SEO bulk job starters through the extracted SeoEditor bulk workflow hook', () => {
    const seoEditor = read('src/components/SeoEditor.tsx');
    const bulkWorkflow = read('src/components/editor/useSeoEditorBulkWorkflow.ts');

    expect(seoEditor).toContain('const { cancelJob, trackJob } = useBackgroundTasks()');
    expect(seoEditor).toContain('useSeoEditorBulkWorkflow({');
    expect(seoEditor).toContain('trackJob,');
    expect(seoEditor).toContain('cancelJob,');
    expect(bulkWorkflow).toContain('trackJob(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, jobId, { workspaceId })');
    expect(bulkWorkflow).toContain('trackJob(BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE, jobId, { workspaceId })');
    expect(bulkWorkflow).toContain('setBulkAnalyzeJobId(jobId)');
    expect(bulkWorkflow).toContain('setBulkRewriteJobId(jobId)');
  });

  it('keys SEO bulk websocket updates by both operation and matching jobId', () => {
    const bulkWorkflow = read('src/components/editor/useSeoEditorBulkWorkflow.ts');

    expect(bulkWorkflow).toContain("detail.operation === 'bulk-analyze' && detail.jobId === bulkAnalyzeJobId");
    expect(bulkWorkflow).toContain("detail.operation === 'bulk-rewrite' && detail.jobId === bulkRewriteJobId");
  });

  it('enforces CMS write filters before bulk write-capable actions', () => {
    const bulkWorkflow = read('src/components/editor/useSeoEditorBulkWorkflow.ts');

    expect(bulkWorkflow).toContain('filterPagesNeedingFix(pages, field)');
    expect(bulkWorkflow).toContain('filterWritableIds(Array.from(approvalSelected), pages)');
    expect(bulkWorkflow).toContain('filterWritableItems(bulkPreview, pages)');
  });

  it('tracks direct content post generation jobs in ContentBriefs', () => {
    const contentBriefs = read('src/components/ContentBriefs.tsx');

    expect(contentBriefs).toContain('const { trackJob } = useBackgroundTasks()');
    expect(contentBriefs).toContain('trackJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, skeleton.jobId, { workspaceId })');
  });
});
