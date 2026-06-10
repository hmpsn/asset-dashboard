import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(ROOT, relativePath), 'utf8');
}

describe('inbox route-to-service extraction contract', () => {
  it('keeps client action route handlers delegated to inbox domain mutations', () => {
    const route = readSource('server/routes/client-actions.ts'); // readFile-ok - contract guard for route-to-service extraction.
    expect(route).toContain("from '../domains/inbox/client-actions-mutations.js'");
    expect(route).toContain('createAdminClientAction(');
    expect(route).toContain('updateAdminClientAction(');
    expect(route).toContain('respondToPublicClientAction(');
  });

  // R2 — respond propagation: the public bulk-approve route AND the unified-inbox
  // respondToSource path both drive the SAME respondToApprovalBatch service (no divergence).
  it('keeps the public bulk-approve route delegated to respondToApprovalBatch', () => {
    const route = readSource('server/routes/approvals.ts'); // readFile-ok - contract guard for R2 route-to-service extraction.
    expect(route).toContain("from '../domains/inbox/approval-batch-respond.js'");
    expect(route).toContain('respondToApprovalBatch(');
  });

  // R2: the public schema-plan feedback route AND the unified-inbox respondToSource path both
  // drive the SAME respondToSchemaPlanFeedback service (no divergence).
  it('keeps the public schema-plan feedback route delegated to respondToSchemaPlanFeedback', () => {
    const route = readSource('server/routes/webflow-schema.ts'); // readFile-ok - contract guard for R2 route-to-service extraction.
    expect(route).toContain("from '../domains/schema/schema-plan-lifecycle.js'");
    expect(route).toContain('respondToSchemaPlanFeedback(');
  });

  // R2: every PHYSICAL adapter that has a client decision implements respondToSource (so the
  // unified respond is never a silent no-op on the source). work_order/briefing (no decision)
  // and the projected types (copy/content_request) intentionally do NOT.
  it('wires respondToSource into every decision-bearing physical adapter', () => {
    const shared = [
      'server/domains/inbox/deliverable-adapters/seo-edit.ts',
      'server/domains/inbox/deliverable-adapters/audit-issue.ts',
      'server/domains/inbox/deliverable-adapters/schema-item.ts',
      'server/domains/inbox/deliverable-adapters/content-plan-sample.ts',
      'server/domains/inbox/deliverable-adapters/content-plan-template.ts',
      'server/domains/inbox/deliverable-adapters/redirect.ts',
      'server/domains/inbox/deliverable-adapters/internal-link.ts',
      'server/domains/inbox/deliverable-adapters/aeo-change.ts',
      'server/domains/inbox/deliverable-adapters/content-decay.ts',
      'server/domains/inbox/deliverable-adapters/schema-plan.ts',
    ];
    for (const rel of shared) {
      // readFile-ok - contract guard that R2 respondToSource stays wired per physical adapter.
      expect(readSource(rel)).toContain('respondToSource:');
    }
  });
});
