import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function expectEveryDetachedLaunchObserved(
  file: string,
  launch: string,
  expectedCount: number,
): void {
  const text = source(file);
  const starts: number[] = [];
  let cursor = 0;
  while (true) {
    const index = text.indexOf(launch, cursor);
    if (index === -1) break;
    starts.push(index);
    cursor = index + launch.length;
  }
  expect(starts, `${file} detached launch census`).toHaveLength(expectedCount);
  for (const index of starts) {
    expect(
      text.slice(index, index + 1_200),
      `${file}: ${launch} must observe/log its outer promise rejection`,
    ).toMatch(/\.catch\(err\s*=>/);
  }
}

describe('detached content worker rejection observers', () => {
  it('observes every C2 brief, post, and copy worker launched after the response', () => {
    expectEveryDetachedLaunchObserved(
      'server/content-brief-generation-job.ts',
      'void runContentBriefGenerationJob(',
      1,
    );
    expectEveryDetachedLaunchObserved(
      'server/content-brief-regenerate-job.ts',
      'void runContentBriefRegenerateJob(',
      1,
    );
    expectEveryDetachedLaunchObserved(
      'server/content-posts-ai-jobs.ts',
      'void runResourceScopedJobWorker(',
      1,
    );
    expectEveryDetachedLaunchObserved(
      'server/routes/copy-pipeline.ts',
      'void runCopyEntryGenerationJob(',
      1,
    );
    expectEveryDetachedLaunchObserved(
      'server/routes/copy-pipeline.ts',
      'void runCopyBatchGenerationJob(',
      1,
    );
    expectEveryDetachedLaunchObserved(
      'server/routes/jobs.ts',
      'void runCopyEntryGenerationJob(',
      1,
    );
    expectEveryDetachedLaunchObserved(
      'server/routes/jobs.ts',
      'void runCopyBatchGenerationJob(',
      1,
    );
  });
});
