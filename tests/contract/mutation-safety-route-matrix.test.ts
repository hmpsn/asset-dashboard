import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface RouteSignal {
  routeId: string;
  routeHints: string[];
  files: string[];
}

const ROUTE_MATRIX: RouteSignal[] = [
  {
    routeId: 'work-orders',
    routeHints: ['/api/work-orders', 'WORK_ORDER_UPDATE'],
    files: ['tests/integration/work-orders-mutation-safety.test.ts'],
  },
  {
    routeId: 'approvals-admin',
    routeHints: ['/api/approvals', 'APPROVAL_UPDATE'],
    files: ['tests/integration/approval-admin-mutation-safety.test.ts'],
  },
  {
    routeId: 'content-requests',
    routeHints: ['/api/content-requests', 'CONTENT_REQUEST_UPDATE'],
    files: ['tests/integration/content-request-mutation-safety.test.ts'],
  },
  {
    routeId: 'client-actions',
    routeHints: ['/api/client-actions', 'CLIENT_ACTION_UPDATE'],
    files: ['tests/integration/client-actions-mutation-safety.test.ts'],
  },
  {
    routeId: 'jobs-schema-generator',
    routeHints: ['schema-generator', '/api/jobs'],
    files: ['tests/integration/schema-generator-job-mutation-safety.test.ts'],
  },
  {
    routeId: 'jobs-keyword-strategy',
    routeHints: ['keyword-strategy', '/api/jobs'],
    files: ['tests/integration/keyword-strategy-job-mutation-safety.test.ts'],
  },
  {
    routeId: 'jobs-page-analysis',
    routeHints: ['page-analysis', '/api/jobs'],
    files: ['tests/integration/page-analysis-job-mutation-safety.test.ts'],
  },
  {
    routeId: 'jobs-deep-diagnostic',
    routeHints: ['deep-diagnostic', '/api/jobs'],
    files: ['tests/integration/deep-diagnostic-mutation-safety.test.ts'],
  },
  {
    routeId: 'jobs-content-post-generation',
    routeHints: ['content-post-generation', '/api/content-posts', 'CONTENT_UPDATED'],
    files: ['tests/integration/content-post-generation-mutation-safety.test.ts'],
  },
  {
    routeId: 'jobs-seo-bulk',
    routeHints: ['seo-bulk-analyze', 'seo-bulk-rewrite', 'seo-bulk-accept-fixes'],
    files: ['tests/integration/seo-background-job-mutation-safety.test.ts'],
  },
  {
    routeId: 'jobs-media',
    routeHints: ['bulk-compress', 'bulk-alt', 'compress'],
    files: ['tests/integration/media-jobs-mutation-safety.test.ts'],
  },
  {
    routeId: 'billing-subscription-lifecycle',
    routeHints: ['content-subscription', 'ws_events.workspace_updated', 'stripe billing mutations'],
    files: ['tests/contract/billing-mutation-lifecycle.test.ts'],
  },
  {
    routeId: 'webflow-cms-writes',
    routeHints: ['/api/webflow/collections', 'PAGE_STATE_UPDATED', 'cms-publish'],
    files: ['tests/integration/webflow-cms-mutation-safety.test.ts'],
  },
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readSignalFile(relativeFile: string): string {
  const absolutePath = path.resolve(ROOT, relativeFile);
  expect(existsSync(absolutePath), `${relativeFile} should exist`).toBe(true);
  return readFileSync(absolutePath, 'utf8').toLowerCase();
}

describe('mutation safety route matrix contract', () => {
  it('maintains at least one mutation-safety signal file for each high-risk route family', () => {
    for (const row of ROUTE_MATRIX) {
      expect(row.files.length, `${row.routeId} should have at least one signal file`).toBeGreaterThan(0);
      for (const file of row.files) {
        expect(existsSync(path.resolve(ROOT, file)), `${row.routeId}: missing ${file}`).toBe(true);
      }
    }
  });

  it('keeps each route family anchored to expected route/event hints', () => {
    for (const row of ROUTE_MATRIX) {
      const merged = row.files.map(readSignalFile).join('\n');
      expect(
        row.routeHints.some(hint => merged.includes(hint.toLowerCase())),
        `${row.routeId} should include at least one expected hint`,
      ).toBe(true);
    }
  });
});
