/**
 * Light-mode branded HTML email templates.
 * All emails share a common layout with hmpsn studio branding (#202945 on white).
 * Templates support both single events and batched digests.
 */

// ── Shared helpers ──

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Layout ──

function layout(opts: {
  preheader?: string;
  headline: string;
  subtitle?: string;
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
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
        <span style="font-size:15px;font-weight:700;letter-spacing:0.5px;color:#202945;">hmpsn studio</span>
      </div>

      <!-- Card -->
      <div class="email-card" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">

        <!-- Header -->
        <div style="padding:28px 28px 0;">
          <h1 class="text-primary" style="margin:0 0 2px;font-size:18px;font-weight:600;color:#202945;line-height:1.3;">${opts.headline}</h1>
          ${opts.subtitle ? `<div class="text-secondary" style="font-size:13px;color:#6b7280;margin-top:4px;">${opts.subtitle}</div>` : ''}
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
        <span class="text-muted" style="font-size:11px;color:#9ca3af;">${opts.footer || 'Automated notification from your web team'}</span>
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
  | 'client_welcome';

// ── Template renderers ──

export function renderDigest(type: EmailEventType, events: EmailEvent[]): { subject: string; html: string } {
  const count = events.length;
  const ws = events[0].workspaceName;
  const dashUrl = events.find(e => e.dashboardUrl)?.dashboardUrl;

  switch (type) {
    case 'approval_ready':
      return renderApprovalReady(events, count, ws, dashUrl);
    case 'request_new':
      return renderRequestNew(events, count, ws, dashUrl);
    case 'request_status':
      return renderRequestStatus(events, count, ws, dashUrl);
    case 'request_response':
      return renderRequestResponse(events, count, ws, dashUrl);
    case 'content_request':
      return renderContentRequest(events, count, ws, dashUrl);
    case 'content_brief_ready':
      return renderContentBriefReady(events, count, ws, dashUrl);
    case 'audit_alert':
      return renderAuditAlert(events, count, ws, dashUrl);
    case 'client_welcome':
      return renderClientWelcome(events[0]);
    default:
      return { subject: 'Notification', html: '' };
  }
}

// ── Individual template renderers ──

function renderApprovalReady(events: EmailEvent[], _count: number, ws: string, dashUrl?: string) {
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
    }),
  };
}

function renderRequestNew(events: EmailEvent[], count: number, ws: string, dashUrl?: string) {
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
    }),
  };
}

function renderRequestStatus(events: EmailEvent[], count: number, ws: string, dashUrl?: string) {
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
    }),
  };
}

function renderRequestResponse(events: EmailEvent[], count: number, ws: string, dashUrl?: string) {
  const items = events.map((e, i) => itemRow({
    title: (e.data.requestTitle as string) || 'Request',
    detail: (e.data.noteContent as string)?.slice(0, 150) || 'New response from your web team',
    isLast: i === events.length - 1,
  })).join('');

  return {
    subject: count === 1
      ? `Update on "${(events[0].data.requestTitle as string) || 'your request'}" — ${ws}`
      : `${count} new responses on your requests — ${ws}`,
    html: layout({
      preheader: `Your web team responded to ${count} request${count !== 1 ? 's' : ''}`,
      headline: count === 1 ? 'New Response on Your Request' : `${count} New Responses`,
      subtitle: ws,
      body: items,
      cta: dashUrl ? { label: 'View Conversation', url: dashUrl } : undefined,
    }),
  };
}

function renderContentRequest(events: EmailEvent[], count: number, ws: string, dashUrl?: string) {
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
    }),
  };
}

function renderContentBriefReady(events: EmailEvent[], count: number, ws: string, dashUrl?: string) {
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
    }),
  };
}

function renderAuditAlert(events: EmailEvent[], _count: number, ws: string, dashUrl?: string) {
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
    }),
  };
}

// ── Client welcome email ──

function renderClientWelcome(event: EmailEvent) {
  const ws = event.workspaceName;
  const name = (event.data.clientName as string) || 'there';
  const dashUrl = event.dashboardUrl || '';

  const gettingStarted = `
    <div style="margin-top:16px;">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Here's what you can do</div>
      ${itemRow({ title: '📊 View your site health score', detail: 'See how your website stacks up with our automated SEO audits', isLast: false })}
      ${itemRow({ title: '📈 Track your traffic & rankings', detail: 'Search Console and Google Analytics data in one place', isLast: false })}
      ${itemRow({ title: '💬 Ask your AI advisor', detail: 'Get instant insights about your traffic, rankings, and content strategy', isLast: false })}
      ${itemRow({ title: '📝 Request content', detail: 'Submit topics and track briefs through your content pipeline', isLast: true })}
    </div>`;

  return {
    subject: `Welcome to your dashboard — ${ws}`,
    html: layout({
      preheader: `Your ${ws} insights dashboard is ready`,
      headline: `Welcome, ${esc(name)}!`,
      subtitle: `Your ${ws} dashboard is ready`,
      body: `
        <p class="text-primary" style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">
          Your web team has set up a personalized insights dashboard for you. It's your central hub for tracking website performance, reviewing SEO improvements, and collaborating on content.
        </p>` + gettingStarted + `
        <div style="margin-top:20px;background:#f0fdf9;border:1px solid #ccfbf1;border-radius:8px;padding:14px 16px;text-align:center;">
          <span style="font-size:12px;color:#0d9488;">Questions? Just reply to this email — we're here to help.</span>
        </div>`,
      cta: dashUrl ? { label: 'Open Your Dashboard', url: dashUrl } : undefined,
      footer: `You're receiving this because an account was created for you on ${esc(ws)}`,
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
      <div style="font-size:11px;color:#a16207;margin-top:4px;">You're currently on a 14-day Growth trial. Contact your web team to discuss plans and pricing.</div>
    </div>` : '';

  return {
    subject: `Monthly Report — ${d.workspaceName} (${d.monthName})`,
    html: layout({
      preheader: `Your ${d.monthName} summary for ${d.workspaceName}`,
      headline: 'Monthly Report',
      subtitle: `${d.workspaceName} · ${d.monthName}`,
      body: trialBanner + scoreSection + trafficSection + metricsGrid + activitySection + chatSection + pendingAlert,
      cta: d.dashboardUrl ? { label: 'Open Dashboard', url: d.dashboardUrl } : undefined,
      footer: 'Automated monthly summary from your web team',
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
    subject: `Reminder: ${data.pendingCount} SEO changes awaiting your approval — ${data.workspaceName}`,
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
          detail: `Submitted ${data.staleDays} days ago · Approving lets your web team push updates live`,
          isLast: true,
        })}`,
      cta: data.dashboardUrl ? { label: 'Review Changes', url: data.dashboardUrl } : undefined,
    }),
  };
}
