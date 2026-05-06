import { describe, expect, it } from 'vitest';
import {
  renderApprovalReminder,
  renderDigest,
  renderMonthlyReport,
  type EmailEvent,
  type EmailEventType,
} from '../../server/email-templates.js';

function event(type: EmailEventType, data: Record<string, unknown> = {}): EmailEvent {
  return {
    type,
    recipient: 'client@example.com',
    workspaceName: 'Acme & Sons',
    workspaceId: 'ws_email_templates',
    dashboardUrl: 'https://dashboard.example.com/client/ws_email_templates',
    data,
    createdAt: '2026-05-05T00:00:00.000Z',
  };
}

describe('email templates', () => {
  it('escapes digest HTML fields while sanitizing subject headers', () => {
    const { subject, html } = renderDigest('request_new', [
      event('request_new', {
        title: 'Need <script>alert("x")</script>\r\nBcc: bad@example.com',
        description: 'Please review <b>unsafe</b> content & notes.',
        category: 'SEO <audit>',
      }),
    ]);

    expect(subject).not.toContain('\n');
    expect(subject).not.toContain('\r');
    expect(subject).toContain('Bcc: bad@example.com');
    expect(html).toContain('Acme &amp; Sons');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('Please review &lt;b&gt;unsafe&lt;/b&gt; content &amp; notes.');
    expect(html).toContain('SEO &lt;audit&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('renders monthly traffic sections without template implementation artifacts', () => {
    const { subject, html } = renderMonthlyReport({
      workspaceName: 'Acme & Sons',
      monthName: 'May 2026',
      siteScore: 82,
      previousScore: 78,
      requestsCompleted: 3,
      requestsOpen: 1,
      approvalsApplied: 2,
      approvalsPending: 1,
      activityCount: 6,
      topActivities: [{ title: 'Published <unsafe> update', createdAt: '2026-05-04T12:00:00.000Z' }],
      dashboardUrl: 'https://dashboard.example.com/client/ws_email_templates',
      traffic: {
        clicks: { current: 1234, previous: 1000, changePct: 23.4 },
        impressions: { current: 98765, previous: 90000, changePct: 9.7 },
        users: { current: 4321, previous: 4500, changePct: -4 },
        sessions: { current: 5432, previous: 5000, changePct: 8.6 },
        pageviews: { current: 7654, previous: 7000, changePct: 9.3 },
      },
      chatTopics: [{ title: 'Ranking <wins>', summary: 'Client asked about & growth.' }],
    });

    expect(subject).toBe('Monthly Report — Acme & Sons (May 2026)');
    expect(html).toContain('Traffic Trends (28-day comparison)');
    expect(html).toContain('Search Clicks');
    expect(html).toContain('1,234');
    expect(html).toContain('98,765');
    expect(html).toContain('Published &lt;unsafe&gt; update');
    expect(html).toContain('Ranking &lt;wins&gt;');
    expect(html).toContain('Client asked about &amp; growth.');
    expect(html).not.toContain('trafficSection =');
  });

  it('escapes approval reminder content and strips subject newlines', () => {
    const { subject, html } = renderApprovalReminder({
      workspaceName: 'Acme\r\nBcc: bad@example.com',
      batchName: 'Homepage <script>alert("x")</script>',
      pendingCount: 2,
      staleDays: 5,
      dashboardUrl: 'https://dashboard.example.com/review?next="bad"',
    });

    expect(subject).toBe('Reminder: 2 SEO changes awaiting your approval — Acme Bcc: bad@example.com');
    expect(html).toContain('Homepage &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('href="https://dashboard.example.com/review?next=&quot;bad&quot;"');
    expect(html).not.toContain('<script>alert');
  });
});
