/**
 * Integration tests for monthly report generation.
 *
 * Tests:
 * - generateReportHTML assembles data from all sources (analytics, content, SEO)
 * - Report HTML has all required structural sections
 * - Email template renders valid, well-formed HTML with no broken placeholders
 * - Report handles a new workspace with no analytics data gracefully
 * - Report data is workspace-scoped (listMonthlyReports isolates by workspaceId)
 * - triggerMonthlyReport persists a report and returns html + reportId
 * - Monthly report permalink endpoint returns the stored HTML
 * - Public workspace reports list includes generated monthly reports
 *
 * Email sending is not exercised — no SMTP_HOST env vars are set in the test
 * environment, so isEmailConfigured() returns false and sendEmail is never called.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import {
  generateReportHTML,
  listMonthlyReports,
} from '../../server/monthly-report.js';
import { renderMonthlyReport } from '../../server/email-templates.js';
import type { Workspace } from '../../shared/types/workspace.js';

const ctx = createTestContext(13260);
const { api, postJson } = ctx;

// ── Fixture workspaces ──

let richWsId = '';    // workspace with full data (requests, approvals, activity)
let emptyWsId = '';   // brand-new workspace with zero data

// Minimal Workspace object used for unit-level tests (generateReportHTML)
function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws_test_unit',
    name: 'Unit Test WS',
    folder: 'unit-test-ws',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  await ctx.startServer();

  const richWs = createWorkspace('Monthly Report Rich WS');
  richWsId = richWs.id;
  updateWorkspace(richWsId, { clientEmail: 'client@example.com' });

  const emptyWs = createWorkspace('Monthly Report Empty WS');
  emptyWsId = emptyWs.id;
}, 30_000);

afterAll(() => {
  deleteWorkspace(richWsId);
  deleteWorkspace(emptyWsId);
  ctx.stopServer();
});

// ── Unit: generateReportHTML ──

describe('generateReportHTML — data-rich workspace', () => {
  const ws = makeWorkspace({ name: 'Acme Corp', seoClientView: true });

  const richData = {
    workspace: ws,
    siteScore: 82,
    previousScore: 74,
    totalPages: 40,
    errors: 3,
    warnings: 12,
    requestsCompleted: 5,
    requestsOpen: 2,
    approvalsApplied: 3,
    approvalsPending: 1,
    activityCount: 15,
    topActivities: [
      { title: 'Audit completed — score 82', createdAt: new Date().toISOString() },
      { title: 'Meta descriptions updated', createdAt: new Date().toISOString() },
    ],
    traffic: {
      clicks: { current: 1200, previous: 1000, changePct: 20 },
      impressions: { current: 45000, previous: 40000, changePct: 12.5 },
      users: { current: 800, previous: 700, changePct: 14.3 },
      sessions: { current: 950, previous: 820, changePct: 15.9 },
    },
    chatTopics: [
      { title: 'How do I improve my site score?', summary: 'Discussed meta tags and page speed.' },
    ],
  };

  it('returns a non-empty HTML string', () => {
    const html = generateReportHTML(richData);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(100);
  });

  it('opens with valid HTML doctype and html element', () => {
    const html = generateReportHTML(richData);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('contains the workspace name in the output', () => {
    const html = generateReportHTML(richData);
    expect(html).toContain('Acme Corp');
  });

  it('contains the site health score', () => {
    const html = generateReportHTML(richData);
    expect(html).toContain('82');
    expect(html).toContain('Site Health Score');
  });

  it('contains score delta from previous audit', () => {
    const html = generateReportHTML(richData);
    // Delta is 82 - 74 = 8 → displayed as "↑ 8 from last audit"
    expect(html).toContain('8');
    expect(html).toContain('from last audit');
  });

  it('contains page count, error, and warning figures', () => {
    const html = generateReportHTML(richData);
    expect(html).toContain('40');
    expect(html).toContain('3');
    expect(html).toContain('12');
  });

  it('contains the traffic section with click data', () => {
    const html = generateReportHTML(richData);
    expect(html).toContain('1,200');    // current clicks (toLocaleString)
    expect(html).toContain('Search Clicks');
    expect(html).toContain('Traffic Trends');
  });

  it('contains the impressions traffic cell', () => {
    const html = generateReportHTML(richData);
    expect(html).toContain('Impressions');
    expect(html).toContain('45,000');
  });

  it('shows pending approval alert when approvalsPending > 0', () => {
    const html = generateReportHTML(richData);
    expect(html).toContain('awaiting your review');
  });

  it('contains recent activity items', () => {
    const html = generateReportHTML(richData);
    expect(html).toContain('Audit completed');
    expect(html).toContain('Meta descriptions updated');
    expect(html).toContain('Recent Activity');
  });

  it('contains chat topics section', () => {
    const html = generateReportHTML(richData);
    expect(html).toContain('Topics You Asked About');
    expect(html).toContain('How do I improve my site score?');
    expect(html).toContain('Discussed meta tags and page speed.');
  });

  it('has balanced html/body open and close tags', () => {
    const html = generateReportHTML(richData);
    expect(html.match(/<html/g)?.length).toBe(1);
    expect(html.match(/<\/html>/g)?.length).toBe(1);
    expect(html.match(/<body/g)?.length).toBe(1);
    expect(html.match(/<\/body>/g)?.length).toBe(1);
  });

  it('does not contain raw template placeholder tokens', () => {
    const html = generateReportHTML(richData);
    // Template literals should be fully resolved — no ${...} left behind
    expect(html).not.toMatch(/\$\{[^}]+\}/);
    // No "undefined" or "null" leaking into user-visible text nodes
    expect(html).not.toContain('>undefined<');
    expect(html).not.toContain('>null<');
  });
});

describe('generateReportHTML — trial workspace', () => {
  it('shows trial banner when workspace is on active trial', () => {
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);  // 7 days remaining
    const ws = makeWorkspace({ name: 'Trial Co', trialEndsAt: trialEnd.toISOString() });
    const data = {
      workspace: ws,
      requestsCompleted: 0,
      requestsOpen: 0,
      approvalsApplied: 0,
      approvalsPending: 0,
      activityCount: 0,
      topActivities: [],
    };
    const html = generateReportHTML(data);
    expect(html).toContain('Growth Trial');
    // Should show remaining days count
    expect(html).toContain('7');
    expect(html).toContain('day');
  });

  it('does not show trial banner when trial has expired', () => {
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() - 1);  // expired yesterday
    const ws = makeWorkspace({ name: 'Expired Trial Co', trialEndsAt: trialEnd.toISOString() });
    const data = {
      workspace: ws,
      requestsCompleted: 0,
      requestsOpen: 0,
      approvalsApplied: 0,
      approvalsPending: 0,
      activityCount: 0,
      topActivities: [],
    };
    const html = generateReportHTML(data);
    expect(html).not.toContain('Growth Trial');
  });
});

// ── Unit: empty/new workspace ──

describe('generateReportHTML — empty workspace (no analytics)', () => {
  const ws = makeWorkspace({ name: 'Brand New Co' });

  const emptyData = {
    workspace: ws,
    // siteScore, previousScore, totalPages, errors, warnings all absent
    requestsCompleted: 0,
    requestsOpen: 0,
    approvalsApplied: 0,
    approvalsPending: 0,
    activityCount: 0,
    topActivities: [],
    // traffic and chatTopics absent
  };

  it('renders without throwing', () => {
    expect(() => generateReportHTML(emptyData)).not.toThrow();
  });

  it('returns a valid HTML document', () => {
    const html = generateReportHTML(emptyData);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('contains the workspace name', () => {
    const html = generateReportHTML(emptyData);
    expect(html).toContain('Brand New Co');
  });

  it('does not include "Site Health Score" section when no score exists', () => {
    const html = generateReportHTML(emptyData);
    expect(html).not.toContain('Site Health Score');
  });

  it('does not include traffic section when no traffic data', () => {
    const html = generateReportHTML(emptyData);
    expect(html).not.toContain('Traffic Trends');
    expect(html).not.toContain('Search Clicks');
  });

  it('does not include activity section when topActivities is empty', () => {
    const html = generateReportHTML(emptyData);
    expect(html).not.toContain('Recent Activity');
  });

  it('does not include chat topics section when chatTopics is absent', () => {
    const html = generateReportHTML(emptyData);
    expect(html).not.toContain('Topics You Asked About');
  });

  it('still includes the metrics grid with zero counts', () => {
    const html = generateReportHTML(emptyData);
    expect(html).toContain('Requests Completed');
    expect(html).toContain('Activities');
    expect(html).toContain('Approvals Applied');
  });

  it('does not have raw unresolved template tokens', () => {
    const html = generateReportHTML(emptyData);
    expect(html).not.toMatch(/\$\{[^}]+\}/);
    expect(html).not.toContain('>undefined<');
    expect(html).not.toContain('>null<');
  });
});

// ── Unit: renderMonthlyReport (email template layer) ──

describe('renderMonthlyReport — subject and HTML', () => {
  const baseData = {
    workspaceName: 'Stellar Inc',
    monthName: 'March 2026',
    requestsCompleted: 4,
    requestsOpen: 1,
    approvalsApplied: 2,
    approvalsPending: 0,
    activityCount: 10,
    topActivities: [
      { title: 'Audit ran', createdAt: new Date().toISOString() },
    ],
  };

  it('returns both subject and html keys', () => {
    const result = renderMonthlyReport(baseData);
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
  });

  it('subject includes the workspace name and month', () => {
    const { subject } = renderMonthlyReport(baseData);
    expect(subject).toContain('Stellar Inc');
    expect(subject).toContain('March 2026');
  });

  it('subject does not contain newline characters (header injection guard)', () => {
    const injectionData = {
      ...baseData,
      workspaceName: 'Evil\r\nBcc: attacker@evil.com',
    };
    const { subject } = renderMonthlyReport(injectionData);
    expect(subject).not.toContain('\r');
    expect(subject).not.toContain('\n');
  });

  it('html contains the workspace name (HTML-escaped)', () => {
    const { html } = renderMonthlyReport(baseData);
    expect(html).toContain('Stellar Inc');
  });

  it('html contains the month name', () => {
    const { html } = renderMonthlyReport(baseData);
    expect(html).toContain('March 2026');
  });

  it('html escapes XSS in workspace name', () => {
    const xssData = {
      ...baseData,
      workspaceName: '<script>alert("xss")</script>',
    };
    const { html } = renderMonthlyReport(xssData);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('html escapes XSS in activity titles', () => {
    const xssData = {
      ...baseData,
      topActivities: [
        { title: '<img src=x onerror=alert(1)>', createdAt: new Date().toISOString() },
      ],
    };
    const { html } = renderMonthlyReport(xssData);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('html is a complete document (doctype + html + body)', () => {
    const { html } = renderMonthlyReport(baseData);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<body');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
  });

  it('html does not contain raw placeholder tokens', () => {
    const { html } = renderMonthlyReport(baseData);
    expect(html).not.toMatch(/\$\{[^}]+\}/);
    expect(html).not.toContain('>undefined<');
    expect(html).not.toContain('>null<');
  });

  it('renders CWV section when cwvSummary is provided', () => {
    const withCwv = {
      ...baseData,
      cwvSummary: {
        mobile: {
          assessment: 'good' as const,
          lighthouseScore: 91,
          metrics: {
            LCP: { value: 2100, rating: 'good' as const },
            INP: { value: 150, rating: 'good' as const },
            CLS: { value: 0.05, rating: 'good' as const },
          },
        },
      },
    };
    const { html } = renderMonthlyReport(withCwv);
    expect(html).toContain('Page Speed');
    expect(html).toContain('Mobile Speed');
    expect(html).toContain('91');  // lighthouse score
  });

  it('omits CWV section when cwvSummary is absent', () => {
    const { html } = renderMonthlyReport(baseData);
    expect(html).not.toContain('Page Speed (Core Web Vitals)');
  });

  it('renders traffic section when traffic data is present', () => {
    const withTraffic = {
      ...baseData,
      traffic: {
        clicks: { current: 500, previous: 400, changePct: 25 },
        impressions: { current: 20000, previous: 18000, changePct: 11 },
      },
    };
    const { html } = renderMonthlyReport(withTraffic);
    expect(html).toContain('Traffic Trends');
    expect(html).toContain('500');
    expect(html).toContain('25');
  });

  it('renders pending approval alert when approvalsPending > 0', () => {
    const withPending = { ...baseData, approvalsPending: 3 };
    const { html } = renderMonthlyReport(withPending);
    expect(html).toContain('awaiting your review');
    expect(html).toContain('3');
  });

  it('omits pending approval alert when approvalsPending is 0', () => {
    const { html } = renderMonthlyReport(baseData);
    expect(html).not.toContain('awaiting your review');
  });
});

// ── Integration: triggerMonthlyReport via HTTP ──

describe('POST /api/monthly-report/:workspaceId — trigger report', () => {
  it('returns 500 for a non-existent workspace (route does not catch the throw)', async () => {
    const res = await postJson('/api/monthly-report/ws_does_not_exist_xyz', {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('generates a report for an empty workspace and returns html + reportId', async () => {
    const res = await postJson(`/api/monthly-report/${emptyWsId}`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('html');
    expect(body).toHaveProperty('reportId');
    expect(typeof body.html).toBe('string');
    expect(body.html.length).toBeGreaterThan(100);
    expect(body.html).toContain('<!DOCTYPE html>');
    expect(body.sent).toBe(false);  // no SMTP configured in test env
  });

  it('generates a report for the rich workspace and returns html + reportId', async () => {
    const res = await postJson(`/api/monthly-report/${richWsId}`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('html');
    expect(body).toHaveProperty('reportId');
    expect(body.html).toContain('Monthly Report Rich WS');
    // No email configured in test env
    expect(body.sent).toBe(false);
  });
});

// ── Integration: report persistence and retrieval ──

describe('Monthly report persistence', () => {
  let savedReportId = '';

  beforeAll(async () => {
    // Trigger a report so we have something persisted
    const res = await postJson(`/api/monthly-report/${richWsId}`, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    savedReportId = body.reportId;
  });

  it('listMonthlyReports returns a non-empty array after trigger', () => {
    const reports = listMonthlyReports(richWsId);
    expect(reports.length).toBeGreaterThan(0);
  });

  it('listMonthlyReports entries have required fields', () => {
    const reports = listMonthlyReports(richWsId);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every(r =>
      typeof r.id === 'string' &&
      r.id.startsWith('mr_') &&
      typeof r.workspaceId === 'string' &&
      typeof r.workspaceName === 'string' &&
      typeof r.createdAt === 'string' &&
      typeof r.period === 'string',
    )).toBe(true);
  });

  it('listMonthlyReports entries all belong to the correct workspace', () => {
    const reports = listMonthlyReports(richWsId);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every(r => r.workspaceId === richWsId)).toBe(true);
  });

  it('GET /report/monthly/:id returns the persisted HTML', async () => {
    const res = await api(`/report/monthly/${savedReportId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Monthly Report Rich WS');
  });

  it('GET /report/monthly/:id with unknown id returns 404', async () => {
    const res = await api('/report/monthly/mr_nonexistent_abc123');
    expect(res.status).toBe(404);
  });
});

// ── Integration: workspace-scoped isolation ──

describe('Monthly report workspace isolation', () => {
  it('listMonthlyReports for emptyWsId does not include richWsId reports', async () => {
    // Ensure richWsId has at least one report
    await postJson(`/api/monthly-report/${richWsId}`, {});

    const richReports = listMonthlyReports(richWsId);
    const emptyReports = listMonthlyReports(emptyWsId);

    // All rich reports are scoped to richWsId
    expect(richReports.length).toBeGreaterThan(0);
    expect(richReports.every(r => r.workspaceId === richWsId)).toBe(true);

    // Empty workspace reports (if any) must not reference richWsId
    if (emptyReports.length > 0) {
      expect(emptyReports.every(r => r.workspaceId !== richWsId)).toBe(true);
    }
  });

  it('GET /api/public/reports/:workspaceId lists monthly reports for that workspace', async () => {
    const res = await api(`/api/public/reports/${richWsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string; type: string; workspaceId?: string }>;
    expect(Array.isArray(body)).toBe(true);

    const monthlyReports = body.filter(r => r.type === 'monthly');
    expect(monthlyReports.length).toBeGreaterThan(0);
    expect(monthlyReports.every(r => typeof r.id === 'string')).toBe(true);
  });

  it('GET /api/public/reports/:workspaceId for empty workspace contains no richWsId reports', async () => {
    // Trigger a report for empty workspace so the endpoint has something to return
    await postJson(`/api/monthly-report/${emptyWsId}`, {});

    const richRes = await api(`/api/public/reports/${richWsId}`);
    const emptyRes = await api(`/api/public/reports/${emptyWsId}`);

    expect(richRes.status).toBe(200);
    expect(emptyRes.status).toBe(200);

    const richList = await richRes.json() as Array<{ id: string }>;
    const emptyList = await emptyRes.json() as Array<{ id: string }>;

    const richIds = new Set(richList.map(r => r.id));
    const emptyIds = new Set(emptyList.map(r => r.id));

    // No IDs should overlap between the two workspaces
    for (const id of emptyIds) {
      expect(richIds.has(id)).toBe(false);
    }
  });
});
