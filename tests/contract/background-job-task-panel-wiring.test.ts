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
  });

  it('tracks direct content post generation jobs in ContentBriefs', () => {
    const contentBriefs = read('src/components/ContentBriefs.tsx');

    expect(contentBriefs).toContain('const { trackJob } = useBackgroundTasks()');
    expect(contentBriefs).toContain('trackJob(BACKGROUND_JOB_TYPES.CONTENT_POST_GENERATION, skeleton.jobId, { workspaceId })');
  });
});
