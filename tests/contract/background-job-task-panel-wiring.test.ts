import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

describe('background job task panel wiring', () => {
  it('tracks direct SEO bulk job starters in SeoEditor', () => {
    const seoEditor = read('src/components/SeoEditor.tsx');

    expect(seoEditor).toContain('const { cancelJob, trackJob } = useBackgroundTasks()');
    expect(seoEditor).toContain('trackJob(BACKGROUND_JOB_TYPES.SEO_BULK_ANALYZE, jobId, { workspaceId })');
    expect(seoEditor).toContain('trackJob(BACKGROUND_JOB_TYPES.SEO_BULK_REWRITE, jobId, { workspaceId })');
    expect(seoEditor).toContain('setBulkAnalyzeJobId(jobId)');
    expect(seoEditor).toContain('setBulkRewriteJobId(jobId)');
  });

  it('keys SEO bulk websocket updates by both operation and matching jobId', () => {
    const seoEditor = read('src/components/SeoEditor.tsx');

    expect(seoEditor).toContain("d.operation === 'bulk-analyze' && d.jobId === bulkAnalyzeJobId");
    expect(seoEditor).toContain("d.operation === 'bulk-rewrite' && d.jobId === bulkRewriteJobId");
  });

  it('enforces CMS write filters before bulk write-capable actions', () => {
    const seoEditor = read('src/components/SeoEditor.tsx');

    expect(seoEditor).toContain('filterPagesNeedingFix(pages, field)');
    expect(seoEditor).toContain('filterWritableIds(Array.from(approvalSelected), pages)');
    expect(seoEditor).toContain('filterWritableItems(bulkPreview, pages)');
  });

  it('tracks direct content post generation jobs in ContentBriefs', () => {
    const contentBriefs = read('src/components/ContentBriefs.tsx');

    expect(contentBriefs).toContain('const { trackJob } = useBackgroundTasks()');
    expect(contentBriefs).toContain('trackJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, skeleton.jobId, { workspaceId })');
  });
});
