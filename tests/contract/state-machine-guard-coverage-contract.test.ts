import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface GuardSignal {
  entity: string;
  file: string;
  transitionToken: string;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const GUARD_SIGNALS: GuardSignal[] = [
  { entity: 'approval_item', file: 'server/approvals.ts', transitionToken: 'APPROVAL_ITEM_TRANSITIONS' },
  { entity: 'content_request', file: 'server/content-requests.ts', transitionToken: 'CONTENT_REQUEST_TRANSITIONS' },
  { entity: 'post', file: 'server/content-posts-db.ts', transitionToken: 'POST_STATUS_TRANSITIONS' },
  { entity: 'work_order', file: 'server/work-orders.ts', transitionToken: 'WORK_ORDER_TRANSITIONS' },
  { entity: 'content_subscription', file: 'server/content-subscriptions.ts', transitionToken: 'CONTENT_SUB_TRANSITIONS' },
  { entity: 'client_action', file: 'server/client-actions.ts', transitionToken: 'CLIENT_ACTION_TRANSITIONS' },
  { entity: 'briefing_draft', file: 'server/briefing-store.ts', transitionToken: 'BRIEFING_DRAFT_TRANSITIONS' },
  { entity: 'background_job', file: 'server/jobs.ts', transitionToken: 'BACKGROUND_JOB_TRANSITIONS' },
  { entity: 'recommendation', file: 'server/recommendations.ts', transitionToken: 'RECOMMENDATION_TRANSITIONS' },
  { entity: 'keyword', file: 'server/keyword-command-center.ts', transitionToken: 'TRACKED_KEYWORD_TRANSITIONS' },
  // G2: newly wired machines
  { entity: 'request', file: 'server/requests.ts', transitionToken: 'REQUEST_TRANSITIONS' },
  { entity: 'matrix_cell', file: 'server/content-matrices.ts', transitionToken: 'MATRIX_CELL_TRANSITIONS' },
];

function readSource(file: string): string {
  const absolutePath = path.resolve(ROOT, file);
  expect(existsSync(absolutePath), `${file} should exist`).toBe(true);
  return readFileSync(absolutePath, 'utf8');
}

describe('state machine guard coverage contracts', () => {
  it('keeps validateTransition guard calls wired for each critical status entity', () => {
    for (const signal of GUARD_SIGNALS) {
      const source = readSource(signal.file);
      expect(
        source.includes('validateTransition(') && source.includes(signal.transitionToken),
        `${signal.entity} should be guarded by validateTransition + ${signal.transitionToken}`,
      ).toBe(true);
    }
  });
});
