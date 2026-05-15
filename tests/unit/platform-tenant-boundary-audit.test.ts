import { describe, expect, it } from 'vitest';

import {
  buildTenantBoundaryAuditReport,
  formatTenantBoundaryAuditReportMarkdown,
  type AuditSourceFile,
  type TenantBoundaryAuditInputs,
} from '../../scripts/platform-tenant-boundary-audit.js';

function baselineTestFiles(): AuditSourceFile[] {
  return [
    {
      path: 'tests/integration/wave2b-route-contracts.test.ts',
      source: 'it("does not allow a workspace A admin route to mutate a workspace B client user by id", () => {})',
    },
    {
      path: 'tests/integration/workspace-access-control.test.ts',
      source: 'describe("cross-workspace access forbidden", () => {})',
    },
    {
      path: 'tests/integration/content-request-mutation-safety.test.ts',
      source: 'it("rejects cross-workspace mutation", () => {})',
    },
    {
      path: 'tests/integration/schema-mutation-safety.test.ts',
      source: 'it("rejects cross-workspace schema mutation", () => {})',
    },
    {
      path: 'tests/integration/public-analytics.test.ts',
      source: 'describe("cross-workspace isolation", () => {})',
    },
  ];
}

function baselineInputs(): TenantBoundaryAuditInputs {
  return {
    routeFiles: [
      {
        path: 'server/routes/content-posts.ts',
        source: "router.get('/api/content-posts/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => res.json({ ok: true }));",
      },
      {
        path: 'server/routes/misc.ts',
        source: "router.post('/api/upload/:workspaceId', requireWorkspaceAccess('workspaceId'), upload.array('files'), (req, res) => res.json({ ok: true }));",
      },
      {
        path: 'server/routes/public-chat.ts',
        source: "router.use('/api/public/chat-sessions/:workspaceId', requireClientPortalAuth('workspaceId'), (req, res, next) => next());",
      },
    ],
    appSource: `
      app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
        const sig = req.headers['stripe-signature'] as string;
        if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });
        const event = constructWebhookEvent(req.body, sig);
        await handleWebhookEvent(event);
      });
    `,
    testFiles: baselineTestFiles(),
    clientUsersSource: `
      export function updateClientUser(id: string, expectedWorkspaceId: string): void {
        assertUserInWorkspace(id, expectedWorkspaceId);
      }
      export function changeClientPassword(id: string, expectedWorkspaceId: string): void {
        assertUserInWorkspace(id, expectedWorkspaceId);
      }
      export function deleteClientUser(id: string, expectedWorkspaceId: string): void {
        assertUserInWorkspace(id, expectedWorkspaceId);
      }
    `,
    publicPortalSource: "res.json({ insights: [] });",
  };
}

describe('platform tenant boundary audit', () => {
  it('returns pass-only summary for healthy boundary inputs', () => {
    const report = buildTenantBoundaryAuditReport(baselineInputs());

    expect(report.generatedBy).toBe('scripts/platform-tenant-boundary-audit.ts');
    expect(report.summary.fail).toBe(0);
    expect(report.summary.warn).toBe(0);
    expect(report.summary.pass).toBeGreaterThan(0);
  });

  it('fails when admin workspace-scoped routes are missing explicit route-level guards', () => {
    const inputs = baselineInputs();
    inputs.routeFiles.push({
      path: 'server/routes/unsafe.ts',
      source: "router.get('/api/unsafe/:workspaceId', (req, res) => res.json({ ok: true }));",
    });

    const report = buildTenantBoundaryAuditReport(inputs);
    const finding = report.findings.find(item => item.id === 'workspace-route-guards');

    expect(finding?.status).toBe('fail');
    expect(report.summary.fail).toBeGreaterThan(0);
    expect(finding?.details.join('\n')).toContain('server/routes/unsafe.ts');
  });

  it('fails when upload middleware appears without a workspace/client guard', () => {
    const inputs = baselineInputs();
    inputs.routeFiles.push({
      path: 'server/routes/upload-unsafe.ts',
      source: "router.post('/api/upload/:workspaceId', upload.single('file'), (req, res) => res.json({ ok: true }));",
    });

    const report = buildTenantBoundaryAuditReport(inputs);
    const finding = report.findings.find(item => item.id === 'upload-route-guards');

    expect(finding?.status).toBe('fail');
    expect(finding?.details.join('\n')).toContain('upload-unsafe.ts');
  });

  it('detects mixed guarded+unguarded workspace routes in the same file', () => {
    const inputs = baselineInputs();
    inputs.routeFiles.push({
      path: 'server/routes/mixed.ts',
      source: [
        "router.get('/api/mixed/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => res.json({ ok: true }));",
        "router.get('/api/mixed/:workspaceId/unsafe', (req, res) => res.json({ ok: true }));",
      ].join('\n'),
    });

    const report = buildTenantBoundaryAuditReport(inputs);
    const finding = report.findings.find(item => item.id === 'workspace-route-guards');

    expect(finding?.status).toBe('fail');
    expect(finding?.details.join('\n')).toContain('/api/mixed/:workspaceId/unsafe');
  });

  it('detects mixed guarded+unguarded upload routes in the same file', () => {
    const inputs = baselineInputs();
    inputs.routeFiles.push({
      path: 'server/routes/mixed-upload.ts',
      source: [
        "router.post('/api/mixed-upload/:workspaceId', requireWorkspaceAccess('workspaceId'), upload.array('files', 5), (req, res) => res.json({ ok: true }));",
        "router.post('/api/mixed-upload/:workspaceId/unsafe', upload.single('file'), (req, res) => res.json({ ok: true }));",
      ].join('\n'),
    });

    const report = buildTenantBoundaryAuditReport(inputs);
    const finding = report.findings.find(item => item.id === 'upload-route-guards');

    expect(finding?.status).toBe('fail');
    expect(finding?.details.join('\n')).toContain('/api/mixed-upload/:workspaceId/unsafe');
  });

  it('fails when Stripe webhook trust checks are incomplete', () => {
    const inputs = baselineInputs();
    inputs.appSource = "app.post('/api/stripe/webhook', async () => {});";

    const report = buildTenantBoundaryAuditReport(inputs);
    const finding = report.findings.find(item => item.id === 'stripe-webhook-trust-boundary');

    expect(finding?.status).toBe('fail');
    expect(finding?.details.join('\n')).toContain('express.raw');
    expect(finding?.details.join('\n')).toContain('stripe-signature');
  });

  it('fails when required foreign-id test surfaces are missing', () => {
    const inputs = baselineInputs();
    inputs.testFiles = inputs.testFiles.slice(0, 2);

    const report = buildTenantBoundaryAuditReport(inputs);
    const finding = report.findings.find(item => item.id === 'foreign-id-regression-tests');

    expect(finding?.status).toBe('fail');
    expect(finding?.details.join('\n')).toContain('Missing file');
  });

  it('warns when public-portal serialization uses spread in res.json payloads', () => {
    const inputs = baselineInputs();
    inputs.publicPortalSource = 'res.json({ ...workspace, insights: [] });';

    const report = buildTenantBoundaryAuditReport(inputs);
    const finding = report.findings.find(item => item.id === 'public-serialization-hygiene');
    const markdown = formatTenantBoundaryAuditReportMarkdown(report);

    expect(finding?.status).toBe('warn');
    expect(report.summary.warn).toBeGreaterThan(0);
    expect(markdown).toContain('# Tenant Boundary Audit Report');
    expect(markdown).toContain('[WARN] Public serialization hygiene');
  });
});
