import fs from 'fs';
import path from 'path';

import { getDataDir } from './data-dir.js';
import { isProgrammingError } from './errors.js';
import {
  createJob,
  updateJob,
} from './jobs.js';
import { createLogger } from './logger.js';
import { runSalesAudit } from './sales-audit.js';
import { BACKGROUND_JOB_TYPES } from '../shared/types/background-jobs.js';

const log = createLogger('sales-report-background-job');

export interface StartedSalesReportJob {
  jobId: string;
}

export function startSalesReportJob(url: string, maxPages: number): StartedSalesReportJob {
  const job = createJob(BACKGROUND_JOB_TYPES.SALES_REPORT, { message: `Auditing ${url}...` });

  void (async () => {
    try {
      updateJob(job.id, { status: 'running', message: 'Crawling site...' });
      const result = await runSalesAudit(url, maxPages);
      const reportsDir = getDataDir('sales-reports');
      const reportId = `sr_${Date.now()}`;
      const reportFile = path.join(reportsDir, `${reportId}.json`);
      fs.writeFileSync(reportFile, JSON.stringify({ id: reportId, ...result, createdAt: new Date().toISOString() }));
      updateJob(job.id, {
        status: 'done',
        result: { id: reportId, ...result },
        message: `Audit complete — score ${result.siteScore}`,
      });
    } catch (err) {
      if (isProgrammingError(err)) {
        log.warn({ err }, 'sales-report background job failed with programming error');
      } else {
        log.debug({ err }, 'sales-report background job failed — degrading gracefully');
      }
      updateJob(job.id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        message: 'Sales report failed',
      });
    }
  })();

  return { jobId: job.id };
}
