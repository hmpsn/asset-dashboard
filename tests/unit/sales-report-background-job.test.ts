import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCompletedJobs,
  getJob,
} from '../../server/jobs.js';

const state = vi.hoisted(() => ({
  runSalesAudit: vi.fn(),
  reportsDir: '',
}));

vi.mock('../../server/sales-audit.js', () => ({
  runSalesAudit: (...args: unknown[]) => state.runSalesAudit(...args),
}));

vi.mock('../../server/data-dir.js', () => ({
  getDataDir: vi.fn(() => state.reportsDir),
}));

import { startSalesReportJob } from '../../server/sales-report-background-job.js';

async function waitForTerminalJob(jobId: string): Promise<NonNullable<ReturnType<typeof getJob>>> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const job = getJob(jobId);
    if (job && (job.status === 'done' || job.status === 'error')) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

describe('startSalesReportJob', () => {
  beforeEach(() => {
    state.reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-report-job-'));
    state.runSalesAudit.mockReset();
  });

  afterEach(() => {
    clearCompletedJobs();
    if (state.reportsDir) {
      fs.rmSync(state.reportsDir, { recursive: true, force: true });
      state.reportsDir = '';
    }
  });

  it('writes the persisted report file and keeps the job result shape unchanged', async () => {
    state.runSalesAudit.mockResolvedValue({
      url: 'https://example.com',
      siteName: 'Example',
      siteScore: 67,
      totalPages: 5,
      errors: 1,
      warnings: 2,
      infos: 3,
      pages: [],
      siteWideIssues: [],
      quickWins: [],
      topRisks: [],
      generatedAt: '2026-06-09T00:00:00.000Z',
    });

    const started = startSalesReportJob('https://example.com', 5);
    const job = await waitForTerminalJob(started.jobId);

    expect(state.runSalesAudit).toHaveBeenCalledWith('https://example.com', 5);
    expect(job.status).toBe('done');
    expect(job.message).toBe('Audit complete — score 67');
    expect(job.result).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^sr_/),
      url: 'https://example.com',
      siteName: 'Example',
      siteScore: 67,
      totalPages: 5,
    }));
    expect(job.result).not.toHaveProperty('createdAt');

    const writtenFiles = fs.readdirSync(state.reportsDir);
    expect(writtenFiles).toHaveLength(1);
    const persisted = JSON.parse(fs.readFileSync(path.join(state.reportsDir, writtenFiles[0]), 'utf-8')) as Record<string, unknown>;
    expect(persisted).toEqual(expect.objectContaining({
      id: (job.result as { id: string }).id,
      url: 'https://example.com',
      siteScore: 67,
    }));
    expect(typeof persisted.createdAt).toBe('string');
  });

  it('writes the legacy terminal error shape when the audit throws', async () => {
    state.runSalesAudit.mockRejectedValue(new Error('crawl exploded'));

    const started = startSalesReportJob('https://example.com/fail', 25);
    const job = await waitForTerminalJob(started.jobId);

    expect(job).toMatchObject({
      type: 'sales-report',
      status: 'error',
      message: 'Sales report failed',
      error: 'crawl exploded',
    });
    expect(fs.readdirSync(state.reportsDir)).toHaveLength(0);
  });
});
