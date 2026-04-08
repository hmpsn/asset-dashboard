/**
 * Light-mode branded HTML email templates.
 * All emails share a common layout with branded styling (#202945 on white).
 * Templates support both single events and batched digests.
 */

import { STUDIO_NAME } from './constants.js';

// ── Shared helpers ──

/** HTML-escape a string for safe interpolation into raw HTML template literals.
 *  layout() escapes: preheader, headline, subtitle, footer, CTA label.
 *  itemRow() escapes: title, detail, badge label.
 *  Do NOT pre-escape values passed to those fields — only use esc() when
 *  injecting directly into a `${...}` inside a raw HTML string (e.g. body content). */
function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Strip newlines/carriage returns from email subject lines to prevent header injection.
 *  Email subjects are plain text (not HTML), so esc() is not needed — but newlines
 *  in a subject string could be exploited for SMTP header injection. */
function sanitizeSubject(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

// ── Layout ──
// layout() escapes preheader, headline, subtitle, footer, and CTA label internally.
// body is intentionally raw HTML (it contains styled divs, links, etc.).
// Do NOT pre-escape values passed to these fields — it causes double-encoding.

function layout(opts: {
  preheader?: string;
  headline: string;
  subtitle?: string;
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
  logoUrl?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  ${opts.preheader ? `<!--[if !mso]><!--><span style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(opts.preheader)}</span><!--<![endif]-->` : ''}
  <style>
    body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
    table { border-collapse:collapse; }
    a { color:#202945; }
    @media (prefers-color-scheme: dark) {
      .email-bg { background-color:#1a1a2e !important; }
      .email-card { background-color:#232340 !important; border-color:#2e2e52 !important; }
      .text-primary { color:#e4e4e7 !important; }
      .text-secondary { color:#a1a1aa !important; }
      .text-muted { color:#71717a !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <div class="email-bg" style="background:#f4f5f7;padding:40px 16px;">
    <div style="max-width:520px;margin:0 auto;">

      <!-- Logo -->
      <div style="text-align:center;margin-bottom:24px;">
        ${opts.logoUrl
          ? `<img src="${esc(opts.logoUrl)}" alt="${esc(STUDIO_NAME)}" height="22" style="height:22px;width:auto;" />`
          : `<span style="font-size:15px;font-weight:700;letter-spacing:0.5px;color:#202945;">${esc(STUDIO_NAME)}</span>`
        }
      </div>

      <!-- Card -->
      <div class="email-card" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">

        <!-- Header -->
        <div style="padding:28px 28px 0;">
          <h1 class="text-primary" style="margin:0 0 2px;font-size:18px;font-weight:600;color:#202945;line-height:1.3;">${esc(opts.headline)}</h1>
          ${opts.subtitle ? `<div class="text-secondary" style="font-size:13px;color:#6b7280;margin-top:4px;">${esc(opts.subtitle)}</div>` : ''}
        </div>

        <!-- Body -->
        <div style="padding:20px 28px 24px;">
          ${opts.body}
        </div>

        ${opts.cta ? `
        <!-- CTA -->
        <div style="padding:0 28px 28px;text-align:center;">
          <a href="${esc(opts.cta.url)}" style="display:inline-block;background:#202945;color:#ffffff;padding:11px 28px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:0.2px;">${esc(opts.cta.label)}</a>
        </div>` : ''}

      </div>

      <!-- Footer -->
      <div style="text-align:center;margin-top:20px;">
        <span class="text-muted" style="font-size:11px;color:#9ca3af;">${esc(opts.footer || `Automated notification from ${STUDIO_NAME}`)}</span>
      </div>

    </div>
  </div>
</body>
</html>`;
}

// ── Item row helper ──

function itemRow(opts: {
  title: string;
  detail?: string;
  badge?: { label: string; color: string; bg: string };
  isLast?: boolean;
}): string {
  const border = opts.isLast ? '' : 'border-bottom:1px solid #f3f4f6;';
  return `
    <div style="padding:12px 0;${border}">
      <div class="text-primary" style="font-size:13px;font-weight:500;color:#1f2937;line-height:1.4;">${esc(opts.title)}</div>
      ${opts.detail ? `<div class="text-secondary" style="font-size:12px;color:#6b7280;margin-top:2px;line-height:1.4;">${esc(opts.detail)}</div>` : ''}
      ${opts.badge ? `<span style="display:inline-block;margin-top:4px;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;color:${opts.badge.color};background:${opts.badge.bg};">${esc(opts.badge.label)}</span>` : ''}
    </div>`;
}

// ── Stat card helper ──

function statRow(label: string, value: string | number, color?: string): string {
  return `
    <td style="padding:12px 16px;text-align:center;background:#f8f9fa;border-radius:8px;">
      <div style="font-size:22px;font-weight:700;color:${color || '#202945'};">${value}</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${esc(label)}</div>
    </td>`;
}

// ── Count summary pill ──

function countPill(count: number, noun: string): string {
  const plural = count !== 1 ? 's' : '';
  return `
    <div style="background:#f0fdf9;border:1px solid #ccfbf1;border-radius:8px;padding:14px 20px;text-align:center;margin-bottom:16px;">
      <span style="font-size:24px;font-weight:700;color:#0d9488;">${count}</span>
      <span style="font-size:14px;color:#374151;margin-left:6px;">${esc(noun)}${plural}</span>
    </div>`;
}

// ── Email type definitions ──

export interface EmailEvent {
  type: EmailEventType;
  recipient: string;
  workspaceName: string;
  workspaceId: string;
  dashboardUrl?: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export type EmailEventType =
  | 'approval_ready'
  | 'request_new'
  | 'request_status'
  | 'request_response'
  | 'content_request'
  | 'content_brief_ready'
  | 'audit_alert'
  | 'client_welcome'
  | 'trial_expiry_warning'
  | 'password_reset'
  | 'churn_signal'
  | 'payment_received'
  | 'fixes_applied'
  | 'recommendations_ready'
  | 'audit_improved'
  | 'anomaly_alert'
  | 'content_published'
  | 'feedback_new'
  | 'audit_complete'
  | 'client_signal';

// ── Template renderers ──

function deriveLogoUrl(dashUrl?: string): string | undefined {
  // APP_URL is the authoritative platform domain where static files are served.
  // Check it first — deriving from dashUrl risks using the marketing-site domain
  // when ADMIN_URL is unset, producing a broken image link.
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    try {
      const u = new URL(appUrl);
      return `${u.origin}/hmpsn-studio-logo-wordmark-navy.png`;
    } catch { /* continue to fallback */ }
  }
  // Fallback: derive from the dashboard URL passed by the caller
  if (dashUrl) {
    try {
      const u = new URL(dashUrl);
      return `${u.origin}/hmpsn-studio-logo-wordmark-navy.png`;
    } catch { /* continue to fallback */ }
  }
  // Final fallback: return undefined (text fallback will be used)
  return undefined;
}

export function renderDigest(type: EmailEventType, events: EmailEvent[]): { subject: string; html: string } {
  const count = events.length;
  const ws = events[0].workspaceName;
  const dashUrl = events.find(e => e.dashboardUrl)?.dashboardUrl;
  const logoUrl = deriveLogoUrl(dashUrl);

  let result: { subject: string; html: string };
  switch (type) {
    case 'approval_ready':
      result = renderApprovalReady(events, count, ws, dashUrl, logoUrl); break;
    case 'request_new':
      result = renderRequestNew(events, count, ws, dashUrl, logoUrl); break;
    case 'request_status':
      result = renderRequestStatus(events, count, ws, dashUrl, logoUrl); break;
    case 'request_response':
      result = renderRequestResponse(events, count, ws, dashUrl, logoUrl); break;
    case 'content_request':
      result = renderContentRequest(events, count, ws, dashUrl, logoUrl); break;
    case 'content_brief_ready':
      result = renderContentBriefReady(events, count, ws, dashUrl, logoUrl); break;
    case 'audit_alert':
      result = renderAuditAlert(events, count, ws, dashUrl, logoUrl); break;
    case 'client_welcome':
      result = renderClientWelcome(events[0], logoUrl); break;
    case 'trial_expiry_warning':
      result = renderTrialExpiryWarning(events[0], logoUrl); break;
    case 'password_reset':
      result = renderPasswordReset(events[0], logoUrl); break;
    case 'churn_signal':
      result = renderChurnSignal(events, count, ws, dashUrl, logoUrl); break;
    case 'payment_received':
      result = renderPaymentReceived(events, count, ws, dashUrl, logoUrl); break;
    case 'fixes_applied':
      result = renderFixesApplied(events, count, ws, dashUrl, logoUrl); break;
    case 'recommendations_ready':
      result = renderRecommendationsReady(events, count, ws, dashUrl, logoUrl); break;
    case 'audit_improved':
      result = renderAuditImproved(events, count, ws, dashUrl, logoUrl); break;
    case 'anomaly_alert':
      result = renderAnomalyAlert(events, count, ws, dashUrl, logoUrl); break;
    case 'content_published':
      result = renderContentPublished(events, count, ws, dashUrl, logoUrl); break;
    case 'feedback_new':
      result = renderFeedbackNew(events, count, ws, dashUrl, logoUrl); break;
    case 'audit_complete':
      result = renderAuditComplete(events[0], logoUrl); break;
    case 'client_signal':
      result = renderClientSignal(events, count, ws, dashUrl, logoUrl); break;
    default:
      result = { subject: 'Notification', html: '' };
  }
  // Sanitize subject at the single exit point — strips newlines to prevent SMTP header injection.
  return { subject: sanitizeSubject(result.subject), html: result.html };
}

// ── Individual template renderers ──

function renderFeedbackNew(events: EmailEvent[], count: number, ws: string, _dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => itemRow({
    title: (e.data.title as string) || 'Feedback',
    detail: (e.data.description as string) || '',
    badge: { label: (e.data.feedbackType as string) || 'general', color: '#6366f1', bg: '#eef2ff' },
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: `${count} new feedback submission${count !== 1 ? 's' : ''} — ${ws}`,
    html: layout({
      preheader: `New client feedback from ${ws}`,
      headline: 'Client Feedback Received',
      subtitle: ws,
      body: countPill(count, 'feedback item') + items,
      logoUrl,
    }),
  };
}

function renderApprovalReady(events: EmailEvent[], _count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const totalItems = events.reduce((sum, e) => sum + ((e.data.itemCount as number) || 1), 0);
  const items = events.map((e, i) => itemRow({
    title: (e.data.batchName as string) || 'SEO Changes',
    detail: `${(e.data.itemCount as number) || 1} change${((e.data.itemCount as number) || 1) !== 1 ? 's' : ''} ready for your review`,
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: `${totalItems} SEO change${totalItems !== 1 ? 's' : ''} ready for your review — ${ws}`,
    html: layout({
      preheader: `${totalItems} items need your approval`,
      headline: 'Changes Ready for Review',
      subtitle: ws,
      body: countPill(totalItems, 'item awaiting approval') + items,
      cta: dashUrl ? { label: 'Review Changes', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderRequestNew(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => itemRow({
    title: (e.data.title as string) || 'New Request',
    detail: (e.data.description as string)?.slice(0, 120) || undefined,
    badge: e.data.category ? { label: e.data.category as string, color: '#4338ca', bg: '#eef2ff' } : undefined,
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: count === 1
      ? `New request: ${(events[0].data.title as string) || 'Untitled'} — ${ws}`
      : `${count} new client requests — ${ws}`,
    html: layout({
      preheader: `${count} new request${count !== 1 ? 's' : ''} from ${ws}`,
      headline: count === 1 ? 'New Client Request' : `${count} New Client Requests`,
      subtitle: ws,
      body: (count > 1 ? countPill(count, 'new request') : '') + items,
      cta: dashUrl ? { label: 'View Requests', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderRequestStatus(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const statusLabels: Record<string, string> = {
    new: 'New', in_review: 'In Review', in_progress: 'In Progress',
    on_hold: 'On Hold', completed: 'Completed', closed: 'Closed',
  };
  const statusColors: Record<string, { color: string; bg: string }> = {
    completed: { color: '#059669', bg: '#ecfdf5' },
    in_progress: { color: '#2563eb', bg: '#eff6ff' },
    in_review: { color: '#7c3aed', bg: '#f5f3ff' },
    on_hold: { color: '#d97706', bg: '#fffbeb' },
    closed: { color: '#6b7280', bg: '#f3f4f6' },
    new: { color: '#0d9488', bg: '#f0fdfa' },
  };

  const items = events.map((e, i) => {
    const status = (e.data.newStatus as string) || '';
    const sc = statusColors[status] || { color: '#6b7280', bg: '#f3f4f6' };
    return itemRow({
      title: (e.data.requestTitle as string) || 'Request',
      badge: { label: statusLabels[status] || status, color: sc.color, bg: sc.bg },
      isLast: i === events.length - 1,
    });
  }).join('');

  return {
    subject: count === 1
      ? `"${(events[0].data.requestTitle as string) || 'Request'}" is now ${statusLabels[(events[0].data.newStatus as string)] || events[0].data.newStatus} — ${ws}`
      : `${count} request updates — ${ws}`,
    html: layout({
      preheader: `${count} request status update${count !== 1 ? 's' : ''}`,
      headline: count === 1 ? 'Request Status Update' : `${count} Request Updates`,
      subtitle: ws,
      body: items,
      cta: dashUrl ? { label: 'View in Dashboard', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderRequestResponse(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => itemRow({
    title: (e.data.requestTitle as string) || 'Request',
    detail: (e.data.noteContent as string)?.slice(0, 150) || `New response from ${STUDIO_NAME}`,
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: count === 1
      ? `Update on "${(events[0].data.requestTitle as string) || 'your request'}" — ${ws}`
      : `${count} new responses on your requests — ${ws}`,
    html: layout({
      preheader: `${STUDIO_NAME} responded to ${count} request${count !== 1 ? 's' : ''}`,
      headline: count === 1 ? 'New Response on Your Request' : `${count} New Responses`,
      subtitle: ws,
      body: items,
      cta: dashUrl ? { label: 'View Conversation', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderContentRequest(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => itemRow({
    title: (e.data.topic as string) || 'Content Topic',
    detail: `Keyword: "${(e.data.targetKeyword as string) || '—'}"`,
    badge: e.data.priority ? { label: (e.data.priority as string), color: '#d97706', bg: '#fffbeb' } : undefined,
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: count === 1
      ? `Content request: "${(events[0].data.topic as string) || 'Topic'}" — ${ws}`
      : `${count} content topic requests — ${ws}`,
    html: layout({
      preheader: `${count} content topic${count !== 1 ? 's' : ''} requested`,
      headline: count === 1 ? 'Content Topic Requested' : `${count} Content Topics Requested`,
      subtitle: ws,
      body: (count > 1 ? countPill(count, 'topic requested') : '') + items,
      cta: dashUrl ? { label: 'View in Dashboard', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderContentBriefReady(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => itemRow({
    title: (e.data.topic as string) || 'Content Brief',
    detail: e.data.targetKeyword ? `Keyword: "${e.data.targetKeyword as string}"` : undefined,
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: count === 1
      ? `Brief ready: "${(events[0].data.topic as string) || 'Topic'}" — ${ws}`
      : `${count} content briefs ready for review — ${ws}`,
    html: layout({
      preheader: `${count} content brief${count !== 1 ? 's' : ''} ready for your review`,
      headline: count === 1 ? 'Content Brief Ready' : `${count} Briefs Ready for Review`,
      subtitle: ws,
      body: (count > 1 ? countPill(count, 'brief ready') : '') + items,
      cta: dashUrl ? { label: 'Review Briefs', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderAuditAlert(events: EmailEvent[], _count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const count = events.length;
  const items = events.map((e, i) => {
    const score = e.data.score as number | undefined;
    const prev = e.data.previousScore as number | undefined;
    const drop = prev != null && score != null ? prev - score : null;
    return itemRow({
      title: (e.data.siteName as string) || ws,
      detail: score != null
        ? `Score: ${score}${drop != null && drop > 0 ? ` (↓ ${drop} from ${prev})` : ''}`
        : 'Site health audit completed',
      badge: drop != null && drop > 0
        ? { label: `↓ ${drop} points`, color: '#dc2626', bg: '#fef2f2' }
        : undefined,
      isLast: i === events.length - 1,
    });
  }).join('');

  return {
    subject: count === 1
      ? `Site health alert — ${ws}`
      : `${count} site health alerts`,
    html: layout({
      preheader: 'Site health score changed',
      headline: 'Site Health Alert',
      subtitle: ws,
      body: items,
      cta: dashUrl ? { label: 'View Audit Results', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

// ── Password reset email ──

function renderPasswordReset(event: EmailEvent, logoUrl?: string) {
  const ws = event.workspaceName;
  const resetUrl = event.data.resetUrl as string;

  return {
    subject: `Reset your password — ${ws}`,
    html: layout({
      preheader: 'Password reset requested',
      headline: 'Reset Your Password',
      subtitle: ws,
      body: `
        <p class="text-primary" style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">
          We received a request to reset your dashboard password. Click the button below to set a new password.
        </p>
        <div style="margin-top:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;text-align:center;">
          <span style="font-size:12px;color:#92400e;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</span>
        </div>`,
      cta: { label: 'Reset Password', url: resetUrl },
      footer: `You're receiving this because a password reset was requested for your account on ${ws}`,
      logoUrl: logoUrl || deriveLogoUrl(resetUrl),
    }),
  };
}

// ── Trial expiry warning email ──

function renderTrialExpiryWarning(event: EmailEvent, logoUrl?: string) {
  const ws = event.workspaceName;
  const daysLeft = (event.data.daysRemaining as number) || 0;
  const dashUrl = event.dashboardUrl || '';
  const isUrgent = daysLeft <= 1;

  const urgencyColor = isUrgent ? '#dc2626' : '#d97706';
  const urgencyBg = isUrgent ? '#fef2f2' : '#fffbeb';
  const urgencyBorder = isUrgent ? '#fecaca' : '#fde68a';

  return {
    subject: isUrgent
      ? `Your Growth trial expires tomorrow — ${ws}`
      : `${daysLeft} days left on your Growth trial — ${ws}`,
    html: layout({
      preheader: `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining on your Growth trial`,
      headline: isUrgent ? 'Your Trial Expires Tomorrow' : `${daysLeft} Days Left on Your Trial`,
      subtitle: ws,
      body: `
        <div style="background:${urgencyBg};border:1px solid ${urgencyBorder};border-radius:8px;padding:20px;text-align:center;margin-bottom:16px;">
          <div style="font-size:36px;font-weight:700;color:${urgencyColor};">${daysLeft}</div>
          <div style="font-size:13px;color:${urgencyColor};margin-top:2px;">day${daysLeft !== 1 ? 's' : ''} remaining</div>
        </div>
        <p class="text-primary" style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">
          Your 14-day Growth trial gives you access to advanced analytics, AI-powered insights, and content tools. When it ends, your dashboard will revert to the Free tier with limited features.
        </p>
        <div style="margin-top:12px;">
          <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">What you'll keep on Free</div>
          ${itemRow({ title: 'Basic site health audits', isLast: false })}
          ${itemRow({ title: 'Search Console overview', isLast: true })}
        </div>
        <div style="margin-top:12px;">
          <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">What you'll lose</div>
          ${itemRow({ title: 'AI Insights Advisor', detail: 'Unlimited conversations and proactive recommendations', isLast: false })}
          ${itemRow({ title: 'Advanced analytics', detail: 'GA4 integration, traffic comparisons, landing pages', isLast: false })}
          ${itemRow({ title: 'Content pipeline', detail: 'Brief generation, content requests, approval workflows', isLast: true })}
        </div>
        <div style="margin-top:16px;background:#f0fdf9;border:1px solid #ccfbf1;border-radius:8px;padding:14px 16px;text-align:center;">
          <span style="font-size:12px;color:#0d9488;">Want to keep Growth features? Contact ${esc(STUDIO_NAME)} to discuss plans.</span>
        </div>`,
      cta: dashUrl ? { label: 'Open Your Dashboard', url: dashUrl } : undefined,
      footer: `You're receiving this because your Growth trial on ${ws} is ending soon`,
      logoUrl: logoUrl || deriveLogoUrl(dashUrl),
    }),
  };
}

// ── Client welcome email ──

function renderClientWelcome(event: EmailEvent, logoUrl?: string) {
  const ws = event.workspaceName;
  const name = (event.data.clientName as string) || 'there';
  const dashUrl = event.dashboardUrl || '';

  const gettingStarted = `
    <div style="margin-top:16px;">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Here's what you can do</div>
      ${itemRow({ title: '� Track your traffic & rankings', detail: 'Search Console and Google Analytics data in one place', isLast: false })}
      ${itemRow({ title: '� View your site health score', detail: 'See how your website stacks up with our automated SEO audits', isLast: false })}
      ${itemRow({ title: '💬 Ask your AI advisor', detail: 'Get instant insights about your traffic, rankings, and content strategy', isLast: false })}
      ${itemRow({ title: '📝 Request content', detail: 'Submit topics and track briefs through your content pipeline', isLast: true })}
    </div>`;

  return {
    subject: `Welcome to your dashboard — ${ws}`,
    html: layout({
      preheader: `Your ${ws} insights dashboard is ready`,
      headline: `Welcome, ${name}!`,
      subtitle: `Your ${ws} dashboard is ready`,
      body: `
        <p class="text-primary" style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">
          ${esc(STUDIO_NAME)} has set up a personalized insights dashboard for you. It's your central hub for tracking website performance, reviewing SEO improvements, and collaborating on content.
        </p>` + gettingStarted + `
        <div style="margin-top:20px;background:#f0fdf9;border:1px solid #ccfbf1;border-radius:8px;padding:14px 16px;text-align:center;">
          <span style="font-size:12px;color:#0d9488;">Questions? Just reply to this email — we're here to help.</span>
        </div>`,
      cta: dashUrl ? { label: 'Open Your Dashboard', url: dashUrl } : undefined,
      footer: `You're receiving this because an account was created for you on ${ws}`,
      logoUrl: logoUrl || deriveLogoUrl(dashUrl),
    }),
  };
}

// ── Monthly report (light-mode rebuild) ──

export function renderMonthlyReport(data: {
  workspaceName: string;
  monthName: string;
  siteScore?: number;
  previousScore?: number;
  totalPages?: number;
  errors?: number;
  warnings?: number;
  cwvSummary?: {
    mobile?: { assessment: string; lighthouseScore: number; metrics: { LCP: { value: number | null; rating: string | null }; INP: { value: number | null; rating: string | null }; CLS: { value: number | null; rating: string | null } } };
    desktop?: { assessment: string; lighthouseScore: number; metrics: { LCP: { value: number | null; rating: string | null }; INP: { value: number | null; rating: string | null }; CLS: { value: number | null; rating: string | null } } };
  };
  requestsCompleted: number;
  requestsOpen: number;
  approvalsApplied: number;
  approvalsPending: number;
  activityCount: number;
  topActivities: { title: string; createdAt: string }[];
  dashboardUrl?: string;
  traffic?: {
    clicks?: { current: number; previous: number; changePct: number };
    impressions?: { current: number; previous: number; changePct: number };
    users?: { current: number; previous: number; changePct: number };
    sessions?: { current: number; previous: number; changePct: number };
    pageviews?: { current: number; previous: number; changePct: number };
  };
  chatTopics?: { title: string; summary: string }[];
  isTrial?: boolean;
  trialDaysRemaining?: number;
}): { subject: string; html: string } {
  const d = data;
  const scoreColor = (d.siteScore ?? 0) >= 80 ? '#059669' : (d.siteScore ?? 0) >= 60 ? '#d97706' : '#dc2626';
  const scoreDelta = d.previousScore != null && d.siteScore != null ? d.siteScore - d.previousScore : null;

  const scoreSection = d.siteScore != null ? `
    <div style="text-align:center;padding:8px 0 20px;">
      <div style="display:inline-block;width:80px;height:80px;border-radius:50%;border:5px solid ${scoreColor};line-height:70px;text-align:center;">
        <span style="font-size:28px;font-weight:700;color:${scoreColor};">${d.siteScore}</span>
      </div>
      <div style="font-size:12px;color:#6b7280;margin-top:6px;">Site Health Score</div>
      ${scoreDelta != null ? `<div style="font-size:12px;color:${scoreDelta >= 0 ? '#059669' : '#dc2626'};margin-top:2px;">${scoreDelta >= 0 ? '↑' : '↓'} ${Math.abs(scoreDelta)} from last audit</div>` : ''}
      ${d.totalPages ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">${d.totalPages} pages · ${d.errors ?? 0} errors · ${d.warnings ?? 0} warnings</div>` : ''}
    </div>` : '';

  // CWV / Page Speed section
  const cwvBadge = (assessment: string) => {
    const config: Record<string, { label: string; color: string; bg: string }> = {
      good: { label: 'Passed', color: '#059669', bg: '#ecfdf5' },
      'needs-improvement': { label: 'Needs Work', color: '#d97706', bg: '#fffbeb' },
      poor: { label: 'Poor', color: '#dc2626', bg: '#fef2f2' },
    };
    const c = config[assessment] || { label: 'No Data', color: '#9ca3af', bg: '#f3f4f6' };
    return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:${c.color};background:${c.bg};">${c.label}</span>`;
  };

  const cwvStrategyCell = (label: string, strategy: { assessment: string; lighthouseScore: number }) => {
    return `<td style="padding:10px;background:#f8f9fa;border-radius:8px;text-align:center;width:50%;">
      <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:4px;">${label}</div>
      ${cwvBadge(strategy.assessment)}
      <div style="font-size:11px;color:#9ca3af;margin-top:4px;">Lighthouse: ${strategy.lighthouseScore}/100</div>
    </td>`;
  };

  let cwvSection = '';
  if (d.cwvSummary && (d.cwvSummary.mobile || d.cwvSummary.desktop)) {
    const cells: string[] = [];
    if (d.cwvSummary.mobile) cells.push(cwvStrategyCell('Mobile Speed', d.cwvSummary.mobile));
    if (d.cwvSummary.desktop) cells.push(cwvStrategyCell('Desktop Speed', d.cwvSummary.desktop));
    cwvSection = `
      <div style="margin-top:16px;">
        <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Page Speed (Core Web Vitals)</div>
        <table style="width:100%;border-collapse:separate;border-spacing:6px;"><tr>${cells.join('')}</tr></table>
      </div>`;
  }

  // Traffic comparison section
  const trafficCell = (label: string, m: { current: number; previous: number; changePct: number }) => {
    const arrow = m.changePct >= 0 ? '↑' : '↓';
    const color = m.changePct >= 0 ? '#059669' : '#dc2626';
    return `<td style="padding:10px;background:#f8f9fa;border-radius:8px;text-align:center;width:50%;">
      <div style="font-size:20px;font-weight:700;color:#111827;">${m.current.toLocaleString()}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:2px;">${label}</div>
      <div style="font-size:11px;color:${color};margin-top:4px;">${arrow} ${Math.abs(m.changePct)}% vs prev period</div>
    </td>`;
  };

  let trafficSection = '';
  if (d.traffic) {
    const rows: string[] = [];
    if (d.traffic.clicks && d.traffic.impressions) {
      rows.push(`<tr>${trafficCell('Search Clicks', d.traffic.clicks)}${trafficCell('Impressions', d.traffic.impressions)}</tr>`);
    }
    if (d.traffic.users && d.traffic.sessions) {
      rows.push(`<tr>${trafficCell('Visitors', d.traffic.users)}${trafficCell('Sessions', d.traffic.sessions)}</tr>`);
    }
    if (d.traffic.pageviews) {
      rows.push(`<tr>${trafficCell('Pageviews', d.traffic.pageviews)}<td></td></tr>`);
    }
    if (rows.length > 0) {
      trafficSection = `
        <div style="margin-top:20px;">
          <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Traffic Trends (28-day comparison)</div>
          <table style="width:100%;border-collapse:separate;border-spacing:6px;">${rows.join('')}</table>
        </div>`;
    }
  }

  const metricsGrid = `
    <table style="width:100%;border-collapse:separate;border-spacing:6px;">
      <tr>
        ${statRow('Requests Completed', d.requestsCompleted, '#2563eb')}
        ${statRow('Open Requests', d.requestsOpen, '#d97706')}
      </tr>
      <tr>
        ${statRow('Approvals Applied', d.approvalsApplied, '#059669')}
        ${statRow('Activities', d.activityCount, '#7c3aed')}
      </tr>
    </table>`;

  const activitySection = d.topActivities.length > 0 ? `
    <div style="margin-top:20px;">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Recent Activity</div>
      ${d.topActivities.map((a) => `
      <div style="padding:8px 12px;margin-bottom:4px;background:#f8f9fa;border-radius:6px;display:flex;justify-content:space-between;">
        <span style="font-size:12px;color:#374151;">${esc(a.title)}</span>
        <span style="font-size:11px;color:#9ca3af;white-space:nowrap;margin-left:12px;">${new Date(a.createdAt).toLocaleDateString()}</span>
      </div>`).join('')}
    </div>` : '';

  const pendingAlert = d.approvalsPending > 0 ? `
    <div style="margin-top:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;text-align:center;">
      <span style="font-size:12px;color:#92400e;">${d.approvalsPending} approval batch${d.approvalsPending > 1 ? 'es' : ''} awaiting your review</span>
    </div>` : '';

  const chatSection = d.chatTopics && d.chatTopics.length > 0 ? `
    <div style="margin-top:20px;">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Topics You Asked About</div>
      ${d.chatTopics.map(t => `
      <div style="padding:8px 12px;margin-bottom:4px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;">
        <div style="font-size:12px;font-weight:600;color:#374151;">${esc(t.title)}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px;">${esc(t.summary)}</div>
      </div>`).join('')}
    </div>` : '';

  const trialBanner = d.isTrial ? `
    <div style="margin-bottom:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;text-align:center;">
      <div style="font-size:13px;font-weight:600;color:#92400e;">Growth Trial${d.trialDaysRemaining != null ? ` · ${d.trialDaysRemaining} day${d.trialDaysRemaining !== 1 ? 's' : ''} remaining` : ''}</div>
      <div style="font-size:11px;color:#a16207;margin-top:4px;">You're currently on a 14-day Growth trial. Contact ${esc(STUDIO_NAME)} to discuss plans and pricing.</div>
    </div>` : '';

  return {
    subject: sanitizeSubject(`Monthly Report — ${d.workspaceName} (${d.monthName})`),
    html: layout({
      preheader: `Your ${d.monthName} summary for ${d.workspaceName}`,
      headline: 'Monthly Report',
      subtitle: `${d.workspaceName} · ${d.monthName}`,
      body: trialBanner + scoreSection + cwvSection + trafficSection + metricsGrid + activitySection + chatSection + pendingAlert,
      cta: d.dashboardUrl ? { label: 'Open Dashboard', url: d.dashboardUrl } : undefined,
      footer: `Automated monthly summary from ${STUDIO_NAME}`,
      logoUrl: deriveLogoUrl(d.dashboardUrl),
    }),
  };
}

function renderFixesApplied(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => itemRow({
    title: ((e.data.productType as string) || 'Fix').replace(/_/g, ' '),
    detail: `${(e.data.pageCount as number) || 0} page${((e.data.pageCount as number) || 0) !== 1 ? 's' : ''} updated`,
    badge: { label: 'Completed', color: '#059669', bg: '#ecfdf5' },
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: count === 1
      ? `✅ Your fixes are live — ${ws}`
      : `✅ ${count} fix orders completed — ${ws}`,
    html: layout({
      preheader: 'Your purchased fixes have been applied',
      headline: 'Fixes Applied',
      subtitle: ws,
      body: (count > 1 ? countPill(count, 'fix completed') : '') + items,
      cta: dashUrl ? { label: 'View Your Dashboard', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderRecommendationsReady(_events: EmailEvent[], _count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const recCount = _events.reduce((s, e) => s + ((e.data.recCount as number) || 0), 0);
  return {
    subject: `📋 ${recCount} new recommendation${recCount !== 1 ? 's' : ''} — ${ws}`,
    html: layout({
      preheader: 'New SEO recommendations are ready for review',
      headline: 'Recommendations Ready',
      subtitle: ws,
      body: `<div style="padding:16px 24px;font-size:14px;color:#a1a1aa;">${recCount} prioritized recommendation${recCount !== 1 ? 's' : ''} based on your latest audit are ready for review.</div>`,
      cta: dashUrl ? { label: 'View Recommendations', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderAuditImproved(_events: EmailEvent[], _count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const e = _events[0];
  const score = (e.data.score as number) || 0;
  const prev = (e.data.previousScore as number) || 0;
  const delta = score - prev;
  return {
    subject: `🎉 Your site health improved to ${score} — ${ws}`,
    html: layout({
      preheader: `Site health went from ${prev} to ${score}`,
      headline: 'Site Health Improved!',
      subtitle: ws,
      body: `<div style="padding:16px 24px;text-align:center;">
        <div style="font-size:48px;font-weight:800;color:#4ade80;">${score}</div>
        <div style="font-size:14px;color:#a1a1aa;margin-top:4px;">Up ${delta} point${delta !== 1 ? 's' : ''} from ${prev}</div>
      </div>`,
      cta: dashUrl ? { label: 'View Your Dashboard', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderAuditComplete(e: EmailEvent, logoUrl?: string) {
  const ws = e.workspaceName;
  const dashUrl = e.dashboardUrl;
  const score = (e.data.score as number) || 0;
  const prev = e.data.previousScore as number | undefined;
  const totalPages = (e.data.totalPages as number) || 0;
  const errors = (e.data.errors as number) || 0;
  const warnings = (e.data.warnings as number) || 0;
  const topIssues = (e.data.topIssues as Array<{ message: string; severity: string }>) || [];
  const fixedCount = (e.data.fixedCount as number) || 0;

  const scoreColor = score >= 80 ? '#4ade80' : score >= 60 ? '#fbbf24' : '#f87171';
  const hasPrev = prev != null && prev > 0;
  const delta = hasPrev ? score - prev : 0;
  const deltaText = hasPrev
    ? delta > 0 ? `<span style="color:#4ade80;">↑ ${delta} pts</span> from ${prev}`
    : delta < 0 ? `<span style="color:#f87171;">↓ ${Math.abs(delta)} pts</span> from ${prev}`
    : `No change from ${prev}`
    : '';

  // Score + stats row
  const statsHtml = `
    <div style="text-align:center;padding:16px 0 20px;">
      <div style="font-size:52px;font-weight:800;color:${scoreColor};line-height:1;">${score}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:6px;">Site Health Score</div>
      ${deltaText ? `<div style="font-size:12px;margin-top:4px;">${deltaText}</div>` : ''}
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr>
        ${statRow('Pages', totalPages)}
        <td style="width:8px;"></td>
        ${statRow('Errors', errors, errors > 0 ? '#ef4444' : '#4ade80')}
        <td style="width:8px;"></td>
        ${statRow('Warnings', warnings, warnings > 0 ? '#f59e0b' : '#4ade80')}
      </tr>
    </table>`;

  // Fixed issues callout
  const fixedHtml = fixedCount > 0 ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:600;color:#15803d;">✓ ${fixedCount} issue${fixedCount !== 1 ? 's' : ''} fixed since last audit</div>
    </div>` : '';

  // Top remaining issues
  const issuesHtml = topIssues.length > 0 ? `
    <div style="margin-bottom:8px;">
      <div style="font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Top Remaining Issues</div>
      ${topIssues.map((issue, i) => {
        const sevColor = issue.severity === 'error' ? '#ef4444' : issue.severity === 'warning' ? '#f59e0b' : '#6b7280';
        const sevBg = issue.severity === 'error' ? '#fef2f2' : issue.severity === 'warning' ? '#fffbeb' : '#f9fafb';
        return itemRow({
          title: issue.message,
          badge: { label: issue.severity, color: sevColor, bg: sevBg },
          isLast: i === topIssues.length - 1,
        });
      }).join('')}
    </div>` : '';

  // Build health tab URL
  const healthUrl = dashUrl ? `${dashUrl}#health` : undefined;

  return {
    subject: hasPrev && delta > 0
      ? `Your site health improved to ${score} — ${ws}`
      : `Site audit complete — score ${score} — ${ws}`,
    html: layout({
      preheader: hasPrev ? `Site health: ${prev} → ${score}` : `Site health score: ${score}`,
      headline: hasPrev && delta > 0 ? 'Site Health Improved!' : 'Site Audit Complete',
      subtitle: ws,
      body: statsHtml + fixedHtml + issuesHtml,
      cta: healthUrl ? { label: 'View Site Health', url: healthUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderPaymentReceived(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => itemRow({
    title: ((e.data.productType as string) || 'Purchase').replace(/_/g, ' '),
    detail: `Amount: ${(e.data.amount as string) || '?'}`,
    badge: { label: 'Paid', color: '#059669', bg: '#ecfdf5' },
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: count === 1
      ? `💰 Payment received — ${ws}`
      : `💰 ${count} payments received`,
    html: layout({
      preheader: `Payment received from ${ws}`,
      headline: 'Payment Received',
      subtitle: ws,
      body: (count > 1 ? countPill(count, 'payment received') : '') + items,
      cta: dashUrl ? { label: 'View Dashboard', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderChurnSignal(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => {
    const severity = e.data.severity as string;
    const badge = severity === 'critical'
      ? { label: 'Critical', color: '#dc2626', bg: '#fef2f2' }
      : severity === 'warning'
        ? { label: 'Warning', color: '#d97706', bg: '#fffbeb' }
        : undefined;
    return itemRow({
      title: (e.data.signalTitle as string) || 'Churn signal detected',
      detail: (e.data.signalDescription as string) || '',
      badge,
      isLast: i === events.length - 1,
    });
  }).join('');

  return {
    subject: count === 1
      ? `⚠ Churn signal: ${(events[0].data.signalTitle as string) || ws}`
      : `⚠ ${count} churn signals detected`,
    html: layout({
      preheader: `${count} churn signal${count !== 1 ? 's' : ''} detected`,
      headline: 'Client Risk Alert',
      subtitle: ws,
      body: (count > 1 ? countPill(count, 'signal detected') : '') + items,
      cta: dashUrl ? { label: 'View Dashboard', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderAnomalyAlert(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => {
    const severity = e.data.severity as string;
    const badge = severity === 'critical'
      ? { label: 'Critical', color: '#dc2626', bg: '#fef2f2' }
      : severity === 'warning'
        ? { label: 'Warning', color: '#d97706', bg: '#fffbeb' }
        : { label: 'Positive', color: '#16a34a', bg: '#f0fdf4' };
    return itemRow({
      title: (e.data.title as string) || 'Anomaly detected',
      detail: (e.data.description as string) || '',
      badge,
      isLast: i === events.length - 1,
    });
  }).join('');

  const criticalCount = events.filter(e => e.data.severity === 'critical').length;
  const emoji = criticalCount > 0 ? '🚨' : '⚠';

  return {
    subject: count === 1
      ? `${emoji} Anomaly detected: ${(events[0].data.title as string) || ws}`
      : `${emoji} ${count} anomalies detected — ${ws}`,
    html: layout({
      preheader: `${count} anomal${count !== 1 ? 'ies' : 'y'} detected for ${ws}`,
      headline: 'Anomaly Alert',
      subtitle: ws,
      body: (count > 1 ? countPill(count, 'anomaly detected') : '') +
        (events[0].data.aiSummary ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#475569;line-height:1.5;">${esc(events[0].data.aiSummary as string)}</div>` : '') +
        items,
      cta: dashUrl ? { label: 'View Dashboard', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

function renderContentPublished(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const items = events.map((e, i) => itemRow({
    title: (e.data.topic as string) || 'Content Published',
    detail: (e.data.targetKeyword as string) ? `Target keyword: ${e.data.targetKeyword as string}` : undefined,
    badge: { label: 'Published', color: '#0d9488', bg: '#f0fdfa' },
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: `${count === 1 ? 'New content published' : `${count} pieces of content published`} — ${ws}`,
    html: layout({
      preheader: `Your new content is live!`,
      headline: 'Content Published',
      subtitle: ws,
      body: `
        <div style="background:#f0fdf9;border:1px solid #ccfbf1;border-radius:8px;padding:14px 20px;text-align:center;margin-bottom:16px;">
          <div style="font-size:14px;color:#0d9488;font-weight:600;">Your new content is live on your website</div>
        </div>
        ${items}`,
      cta: dashUrl ? { label: 'View in Dashboard', url: dashUrl } : undefined,
      logoUrl,
    }),
  };
}

// ── Approval reminder (light-mode rebuild) ──

export function renderApprovalReminder(data: {
  workspaceName: string;
  batchName: string;
  pendingCount: number;
  staleDays: number;
  dashboardUrl?: string;
}): { subject: string; html: string } {
  return {
    subject: sanitizeSubject(`Reminder: ${data.pendingCount} SEO changes awaiting your approval — ${data.workspaceName}`),
    html: layout({
      preheader: `${data.pendingCount} changes have been waiting ${data.staleDays} days`,
      headline: 'Approval Reminder',
      subtitle: data.workspaceName,
      body: `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;text-align:center;margin-bottom:12px;">
          <div style="font-size:28px;font-weight:700;color:#92400e;">${data.pendingCount}</div>
          <div style="font-size:13px;color:#92400e;margin-top:2px;">SEO changes awaiting review</div>
        </div>
        ${itemRow({
          title: data.batchName,
          detail: `Submitted ${data.staleDays} days ago · Approving lets ${STUDIO_NAME} push updates live`,
          isLast: true,
        })}`,
      cta: data.dashboardUrl ? { label: 'Review Changes', url: data.dashboardUrl } : undefined,
      logoUrl: deriveLogoUrl(data.dashboardUrl),
    }),
  };
}

function renderClientSignal(events: EmailEvent[], count: number, ws: string, dashUrl?: string, logoUrl?: string) {
  const adminUrl = dashUrl ?? '';
  const items = events.map((e, i) => itemRow({
    title: (e.data.signalType as string) === 'service_interest' ? 'Service Interest' : 'Content Interest',
    detail: (e.data.triggerMessage as string) ?? '',
    badge: { label: (e.data.signalType as string) === 'service_interest' ? 'Service' : 'Content', color: '#0f766e', bg: '#f0fdfa' },
    isLast: i === events.length - 1,
  }));
  const subject = count === 1
    ? `Client signal from ${ws}`
    : `${count} client signals from ${ws}`;
  const body = `
    <p style="margin:0 0 12px;font-size:14px;color:#202945;">
      ${count === 1 ? 'A client' : `${count} client signals`} at <strong>${esc(ws)}</strong> expressed purchase or service intent.
    </p>
    ${items.join('')}
  `;
  return {
    subject,
    html: layout({ preheader: subject, headline: subject, subtitle: ws, body, cta: { label: 'View in Admin Inbox', url: adminUrl }, logoUrl }),
  };
}
