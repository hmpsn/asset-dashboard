#!/usr/bin/env tsx

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-dashboard-api-probe-'));

type ProbeSeverity = 'fail' | 'warn' | 'info';

interface Finding {
  severity: ProbeSeverity;
  name: string;
  detail: string;
}

interface ProbeResponse {
  status: number;
  body: unknown;
  text: string;
}

const PORT = Number(process.env.API_SECURITY_PROBE_PORT || 13410);
const suffix = randomUUID().slice(0, 8);
const sentinels = {
  wsAName: `PROBE_WS_A_SECRET_NAME_${suffix}`,
  wsAKeyword: `PROBE_WS_A_SECRET_KEYWORD_${suffix}`,
  wsATopic: `PROBE_WS_A_SECRET_TOPIC_${suffix}`,
  wsAInsight: `PROBE_WS_A_SECRET_INSIGHT_${suffix}`,
  wsAApproval: `PROBE_WS_A_SECRET_APPROVAL_${suffix}`,
  wsAAction: `PROBE_WS_A_SECRET_ACTION_${suffix}`,
  wsAAnnotation: `PROBE_WS_A_SECRET_ANNOTATION_${suffix}`,
  wsAClientName: `PROBE_WS_A_SECRET_CLIENT_${suffix}`,
};

const findings: Finding[] = [];

function record(severity: ProbeSeverity, name: string, detail: string): void {
  findings.push({ severity, name, detail });
}

function bodyText(body: unknown, fallback: string): string {
  try {
    return JSON.stringify(body);
  } catch {
    return fallback;
  }
}

function containsSentinel(res: ProbeResponse, needles: string[]): string | null {
  const haystack = `${res.text}\n${bodyText(res.body, '')}`;
  return needles.find(needle => haystack.includes(needle)) ?? null;
}

async function readResponse(res: Response): Promise<ProbeResponse> {
  const text = await res.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body, text };
}

async function main(): Promise<void> {
  const { createTestContext } = await import('../tests/integration/helpers.js');
  const ctx = createTestContext(PORT);

  await ctx.startServer();

  try {
    const [{ default: db, runMigrations }, { seedWorkspace }, clientUsers, insights, requests, approvals, actions, annotations] = await Promise.all([
      import('../server/db/index.js'),
      import('../tests/fixtures/workspace-seed.js'),
      import('../server/client-users.js'),
      import('../server/analytics-insights-store.js'),
      import('../server/content-requests.js'),
      import('../server/approvals.js'),
      import('../server/client-actions.js'),
      import('../server/annotations.js'),
    ]);

    runMigrations();

    const wsA = seedWorkspace({ clientPassword: 'probe-password-a', tier: 'premium' });
    const wsB = seedWorkspace({ clientPassword: 'probe-password-b', tier: 'premium' });
    const wsOpen = seedWorkspace({ clientPassword: '', tier: 'premium' });

    db.prepare(`
      UPDATE workspaces
      SET name = ?,
          client_portal_enabled = 1,
          seo_client_view = 1,
          analytics_client_view = 1,
          site_intelligence_client_view = 1
      WHERE id = ?
    `).run(sentinels.wsAName, wsA.workspaceId);
    db.prepare(`
      UPDATE workspaces
      SET client_portal_enabled = 1,
          seo_client_view = 1,
          analytics_client_view = 1,
          site_intelligence_client_view = 1
      WHERE id IN (?, ?)
    `).run(wsB.workspaceId, wsOpen.workspaceId);

    const clientA = await clientUsers.createClientUser(
      `probe-a-${suffix}@test.local`,
      'ClientPass1!',
      sentinels.wsAClientName,
      wsA.workspaceId,
      'client_member',
    );
    const clientB = await clientUsers.createClientUser(
      `probe-b-${suffix}@test.local`,
      'ClientPass1!',
      `Probe B Client ${suffix}`,
      wsB.workspaceId,
      'client_member',
    );
    const tokenA = clientUsers.signClientToken(clientA);
    const tokenB = clientUsers.signClientToken(clientB);

    const insightA = insights.upsertInsight({
      workspaceId: wsA.workspaceId,
      pageId: `/probe-a-${suffix}`,
      insightType: 'ranking_opportunity',
      data: { query: sentinels.wsAInsight, currentPosition: 8 },
      severity: 'opportunity',
      impactScore: 88,
    });
    const requestA = requests.createContentRequest(wsA.workspaceId, {
      topic: sentinels.wsATopic,
      targetKeyword: sentinels.wsAKeyword,
      intent: 'informational',
      priority: 'high',
      rationale: `Probe rationale ${suffix}`,
      source: 'strategy',
      dedupe: false,
    });
    const batchA = approvals.createBatch(wsA.workspaceId, wsA.webflowSiteId, `Probe Approval ${suffix}`, [
      {
        pageId: `probe-page-${suffix}`,
        pageSlug: `/probe-${suffix}`,
        pageTitle: `Probe Page ${suffix}`,
        field: 'seoTitle',
        currentValue: 'Current',
        proposedValue: sentinels.wsAApproval,
      },
    ]);
    const actionA = actions.createClientAction({
      workspaceId: wsA.workspaceId,
      sourceType: 'keyword_strategy',
      sourceId: `probe-source-${suffix}`,
      title: sentinels.wsAAction,
      summary: `Probe action summary ${suffix}`,
      payload: { keyword: sentinels.wsAKeyword },
      priority: 'high',
    });
    annotations.addAnnotation(wsA.workspaceId, '2026-05-06', sentinels.wsAAnnotation, `Probe annotation ${suffix}`);

    const leakNeedles = [
      wsA.workspaceId,
      wsA.webflowSiteId,
      insightA.id,
      requestA.id,
      batchA.id,
      actionA.id,
      ...Object.values(sentinels),
    ];

    async function api(
      method: string,
      urlPath: string,
      options: { token?: string; tokenWorkspaceId?: string; body?: unknown } = {},
    ): Promise<ProbeResponse> {
      const headers: Record<string, string> = {};
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.token && options.tokenWorkspaceId) {
        headers.Cookie = `client_user_token_${options.tokenWorkspaceId}=${options.token}`;
      }
      const res = await fetch(`${ctx.BASE}${urlPath}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: 'manual',
      });
      return readResponse(res);
    }

    const gatedPublicReads = [
      '/api/public/insights/:workspaceId',
      '/api/public/insights/:workspaceId/narrative',
      '/api/public/content-requests/:workspaceId',
      '/api/public/approvals/:workspaceId',
      '/api/public/client-actions/:workspaceId',
      '/api/public/content-performance/:workspaceId',
      '/api/public/tracked-keywords/:workspaceId',
      '/api/public/requests/:workspaceId',
      '/api/public/intelligence/:workspaceId',
      '/api/public/content-decay/:workspaceId',
      '/api/public/content-plan/:workspaceId',
      '/api/public/outcomes/:workspaceId/summary',
      '/api/public/schema-plan/:workspaceId',
      '/api/public/stripe/status/:workspaceId/cs_probe_missing',
    ];

    const exemptPublicReads = [
      '/api/public/workspace/:workspaceId',
      '/api/public/tier/:workspaceId',
      '/api/public/pricing/:workspaceId',
      '/api/public/usage/:workspaceId',
      '/api/public/chat-usage/:workspaceId',
      '/api/public/activity/:workspaceId',
      '/api/public/annotations/:workspaceId',
      '/api/public/recommendations/:workspaceId',
      '/api/public/roi/:workspaceId',
    ];

    const adminScopedReads = [
      '/api/content-requests/:workspaceId',
      '/api/approvals/:workspaceId',
      '/api/client-actions/:workspaceId',
      '/api/annotations/:workspaceId',
      '/api/export/:workspaceId/requests',
      '/api/export/:workspaceId/activity',
      '/api/export/:workspaceId/payments',
    ];

    for (const template of gatedPublicReads) {
      const pathA = template.replace(':workspaceId', wsA.workspaceId);
      const pathB = template.replace(':workspaceId', wsB.workspaceId);
      const noAuth = await api('GET', pathA);
      if (noAuth.status !== 401) {
        record('fail', `Protected public route without auth: ${template}`, `Expected 401, got ${noAuth.status}`);
      }
      const wrongAuth = await api('GET', pathA, { token: tokenB, tokenWorkspaceId: wsA.workspaceId });
      if (wrongAuth.status !== 401) {
        record('fail', `Protected public route with wrong token: ${template}`, `Expected 401, got ${wrongAuth.status}`);
      }
      const rightAuth = await api('GET', pathA, { token: tokenA, tokenWorkspaceId: wsA.workspaceId });
      if (rightAuth.status === 401) {
        record('fail', `Protected public route with valid token: ${template}`, 'Valid workspace token still got 401');
      } else if (rightAuth.status >= 500) {
        record('fail', `Protected public route server error: ${template}`, `Got ${rightAuth.status}`);
      }
      const bAuth = await api('GET', pathB, { token: tokenB, tokenWorkspaceId: wsB.workspaceId });
      const leaked = containsSentinel(bAuth, leakNeedles);
      if (leaked) {
        record('fail', `Cross-workspace leak in public route: ${template}`, `Workspace B response contained ${leaked}`);
      }
    }

    for (const template of exemptPublicReads) {
      const pathB = template.replace(':workspaceId', wsB.workspaceId);
      const res = await api('GET', pathB);
      if (res.status >= 500) {
        record('fail', `Public/exempt route server error: ${template}`, `Got ${res.status}`);
      }
      const leaked = containsSentinel(res, leakNeedles);
      if (leaked) {
        record('fail', `Cross-workspace leak in public/exempt route: ${template}`, `Workspace B response contained ${leaked}`);
      }
    }

    for (const template of adminScopedReads) {
      const pathB = template.replace(':workspaceId', wsB.workspaceId);
      const res = await api('GET', pathB);
      if (res.status >= 500) {
        record('fail', `Admin scoped route server error: ${template}`, `Got ${res.status}`);
      }
      const leaked = containsSentinel(res, leakNeedles);
      if (leaked) {
        record('fail', `Cross-workspace leak in admin route: ${template}`, `Workspace B response contained ${leaked}`);
      }
    }

    const nestedChecks: Array<{ method: string; path: string; allowed: number[]; body?: unknown; token?: string; tokenWorkspaceId?: string }> = [
      { method: 'GET', path: `/api/public/approvals/${wsB.workspaceId}/${batchA.id}`, allowed: [404], token: tokenB, tokenWorkspaceId: wsB.workspaceId },
      { method: 'GET', path: `/api/approvals/${wsB.workspaceId}/${batchA.id}`, allowed: [404] },
      { method: 'GET', path: `/api/content-requests/${wsB.workspaceId}/${requestA.id}`, allowed: [404] },
      { method: 'PATCH', path: `/api/client-actions/${wsB.workspaceId}/${actionA.id}`, allowed: [404], body: { status: 'completed' } },
      { method: 'PATCH', path: `/api/public/client-actions/${wsB.workspaceId}/${actionA.id}/respond`, allowed: [404], body: { status: 'approved', clientNote: 'Cross-workspace probe' }, token: tokenB, tokenWorkspaceId: wsB.workspaceId },
      { method: 'PATCH', path: `/api/workspaces/${wsB.workspaceId}/client-users/${clientA.id}`, allowed: [404], body: { name: 'Probe Mutated' } },
    ];

    for (const check of nestedChecks) {
      const res = await api(check.method, check.path, {
        token: check.token,
        tokenWorkspaceId: check.tokenWorkspaceId,
        body: check.body,
      });
      if (!check.allowed.includes(res.status)) {
        record('fail', `Wrong-workspace nested id: ${check.method} ${check.path}`, `Expected one of ${check.allowed.join(', ')}, got ${res.status}`);
      }
      const leaked = containsSentinel(res, leakNeedles);
      if (leaked) {
        record('fail', `Wrong-workspace nested id leaked data: ${check.method} ${check.path}`, `Response contained ${leaked}`);
      }
    }

    const beforeRequest = requests.getContentRequest(wsA.workspaceId, requestA.id);
    const invalidRequestPatch = await api('PATCH', `/api/content-requests/${wsA.workspaceId}/${requestA.id}`, {
      body: { status: 'definitely_not_valid' },
    });
    const afterRequest = requests.getContentRequest(wsA.workspaceId, requestA.id);
    if (invalidRequestPatch.status < 400 || beforeRequest?.status !== afterRequest?.status) {
      record('fail', 'Invalid content request status mutation', `Status ${invalidRequestPatch.status}; before=${beforeRequest?.status}; after=${afterRequest?.status}`);
    }

    const beforeAction = actions.getClientAction(wsA.workspaceId, actionA.id);
    const invalidActionPatch = await api('PATCH', `/api/client-actions/${wsA.workspaceId}/${actionA.id}`, {
      body: { status: 'definitely_not_valid' },
    });
    const afterAction = actions.getClientAction(wsA.workspaceId, actionA.id);
    if (invalidActionPatch.status < 400 || beforeAction?.status !== afterAction?.status) {
      record('fail', 'Invalid client action status mutation', `Status ${invalidActionPatch.status}; before=${beforeAction?.status}; after=${afterAction?.status}`);
    }

    const unauthCreate = await api('POST', `/api/public/content-request/${wsA.workspaceId}`, {
      body: { topic: `Unauth ${suffix}`, targetKeyword: `unauth-${suffix}` },
    });
    if (unauthCreate.status !== 401) {
      record('fail', 'Protected public mutation without auth', `Expected 401, got ${unauthCreate.status}`);
    }

    const wrongAuthCreate = await api('POST', `/api/public/content-request/${wsA.workspaceId}`, {
      token: tokenB,
      tokenWorkspaceId: wsA.workspaceId,
      body: { topic: `Wrong auth ${suffix}`, targetKeyword: `wrong-auth-${suffix}` },
    });
    if (wrongAuthCreate.status !== 401) {
      record('fail', 'Protected public mutation with wrong token', `Expected 401, got ${wrongAuthCreate.status}`);
    }

    const publicWorkspaceB = await api('GET', `/api/public/workspace/${wsB.workspaceId}`);
    const wsBLeak = containsSentinel(publicWorkspaceB, leakNeedles);
    if (wsBLeak) {
      record('fail', 'Public workspace endpoint leak', `Workspace B public metadata contained ${wsBLeak}`);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      branch: process.env.GIT_BRANCH ?? '',
      dataDir: process.env.DATA_DIR,
      port: PORT,
      workspaces: { wsA: wsA.workspaceId, wsB: wsB.workspaceId, wsOpen: wsOpen.workspaceId },
      summary: {
        failures: findings.filter(f => f.severity === 'fail').length,
        warnings: findings.filter(f => f.severity === 'warn').length,
        info: findings.filter(f => f.severity === 'info').length,
      },
      findings,
    };
    const reportPath = path.join(process.env.DATA_DIR!, `api-security-probe-report-${suffix}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${reportPath}`);

    if (report.summary.failures > 0) process.exitCode = 1;
  } finally {
    await ctx.stopServer();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
