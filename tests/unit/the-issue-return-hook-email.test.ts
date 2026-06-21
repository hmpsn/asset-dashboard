/**
 * The Issue (Client) P1c — client_return_hook email contract: renderer + payload rule + throttle
 * category + recipient policy. The cron + assembler are tested separately.
 */
import { describe, it, expect } from 'vitest';
import { renderDigest, getEmailEventPayloadIssues, type EmailEvent } from '../../server/email-templates.js';
import { getThrottleCategory } from '../../server/email-throttle.js';
import { CLIENT_NOTIFICATION_RECIPIENT_POLICIES } from '../../server/notification-recipients.js';

function event(data: Record<string, unknown>): EmailEvent {
  return {
    type: 'client_return_hook',
    recipient: 'client@acme.test',
    workspaceName: 'Acme Dental',
    workspaceId: 'ws-1',
    dashboardUrl: 'https://portal.test/c/ws-1',
    data,
    createdAt: new Date().toISOString(),
  };
}

describe('client_return_hook email', () => {
  it('renders all three sections + reply-to-stop footer + dashboard CTA', () => {
    const { subject, html } = renderDigest('client_return_hook', [event({
      outcomeNoun: 'new patients',
      leadCount: 3, recentNames: ['Jane Doe', 'John Roe'],
      moneyValue: 2400, sinceStartDelta: 9,
      pendingCount: 1,
    })]);
    expect(subject).toContain('What came in this week');
    expect(html).toContain('new patients');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('$2,400');
    expect(html).toContain('since we started');
    expect(html).toContain('still waiting for your input');
    expect(html).toMatch(/reply to stop/i);          // DR-6 opt-out courtesy line
    expect(html).toContain('See your dashboard');     // CTA
    expect(html).not.toMatch(/purple|violet|indigo/); // client-facing color discipline
  });

  it('omits sections that have no content', () => {
    const { html } = renderDigest('client_return_hook', [event({ outcomeNoun: 'leads', pendingCount: 2 })]);
    expect(html).toContain('still waiting');
    expect(html).not.toContain('in measured value'); // no money section
    expect(html).not.toContain('this week</span>');  // no leads section header
  });

  it('escapes lead names — no HTML injection from a captured name', () => {
    const { html } = renderDigest('client_return_hook', [event({
      outcomeNoun: 'leads', leadCount: 1, recentNames: ['<script>alert(1)</script>'],
    })]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('payload validation requires outcomeNoun (sections are optional)', () => {
    expect(getEmailEventPayloadIssues(event({ outcomeNoun: 'leads' }))).toEqual([]);
    const issues = getEmailEventPayloadIssues(event({ leadCount: 1 }));
    expect(issues.some((i) => i.includes('outcomeNoun'))).toBe(true);
  });

  it('uses the weekly "return" throttle category', () => {
    expect(getThrottleCategory('client_return_hook')).toBe('return');
  });

  it('recipient policy targets the workspace primary contact', () => {
    expect(CLIENT_NOTIFICATION_RECIPIENT_POLICIES.client_return_hook.authority).toBe('workspace_primary');
  });
});
