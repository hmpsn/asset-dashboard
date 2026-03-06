import nodemailer from 'nodemailer';

// Configure via env vars:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// NOTIFICATION_EMAIL — where team gets notified (your inbox)

interface EmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

function getConfig(): EmailConfig | null {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass) return null;
  return { host, port, user, pass, from: from! };
}

function createTransport() {
  const cfg = getConfig();
  if (!cfg) return null;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

export function isEmailConfigured(): boolean {
  return getConfig() !== null;
}

export function getNotificationEmail(): string | undefined {
  return process.env.NOTIFICATION_EMAIL;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const cfg = getConfig();
  const transport = createTransport();
  if (!cfg || !transport) return false;
  try {
    await transport.sendMail({ from: cfg.from, to, subject, html });
    return true;
  } catch (err) {
    console.error('[email] Failed to send:', err);
    return false;
  }
}

// ── Notification emails ──

export async function notifyTeamNewRequest(opts: {
  workspaceName: string;
  title: string;
  description: string;
  category: string;
  submittedBy?: string;
  pageUrl?: string;
}): Promise<boolean> {
  const to = getNotificationEmail();
  if (!to) return false;
  const subject = `New Request: ${opts.title} — ${opts.workspaceName}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #0f1219; color: #e4e4e7; padding: 24px; border-radius: 12px;">
        <div style="font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">New Client Request</div>
        <h2 style="margin: 0 0 4px; font-size: 16px; color: #f4f4f5;">${escHtml(opts.title)}</h2>
        <div style="font-size: 12px; color: #a1a1aa; margin-bottom: 16px;">
          ${opts.submittedBy ? `<strong>${escHtml(opts.submittedBy)}</strong> · ` : ''}${escHtml(opts.workspaceName)} · ${escHtml(opts.category)}
        </div>
        <div style="background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.5; color: #d4d4d8; white-space: pre-wrap;">${escHtml(opts.description)}</div>
        ${opts.pageUrl ? `<div style="margin-top: 12px; font-size: 11px; color: #71717a;">Related page: <a href="${escHtml(opts.pageUrl.startsWith('http') ? opts.pageUrl : 'https://' + opts.pageUrl)}" style="color: #2dd4bf;">${escHtml(opts.pageUrl)}</a></div>` : ''}
        <div style="margin-top: 20px; font-size: 11px; color: #52525b;">Log in to your dashboard to respond.</div>
      </div>
    </div>
  `;
  return sendEmail(to, subject, html);
}

export async function notifyClientTeamResponse(opts: {
  clientEmail: string;
  workspaceName: string;
  requestTitle: string;
  noteContent: string;
  dashboardUrl?: string;
}): Promise<boolean> {
  const subject = `Update on your request: ${opts.requestTitle}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #0f1219; color: #e4e4e7; padding: 24px; border-radius: 12px;">
        <div style="font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Request Update — ${escHtml(opts.workspaceName)}</div>
        <h2 style="margin: 0 0 16px; font-size: 16px; color: #f4f4f5;">${escHtml(opts.requestTitle)}</h2>
        <div style="background: rgba(45,212,191,0.08); border: 1px solid rgba(45,212,191,0.15); border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.5; color: #d4d4d8; white-space: pre-wrap;">${escHtml(opts.noteContent)}</div>
        ${opts.dashboardUrl ? `<div style="margin-top: 20px; text-align: center;"><a href="${escHtml(opts.dashboardUrl)}" style="display: inline-block; background: #0d9488; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 500;">View in Dashboard</a></div>` : ''}
        <div style="margin-top: 20px; font-size: 11px; color: #52525b;">You can reply directly from your dashboard.</div>
      </div>
    </div>
  `;
  return sendEmail(opts.clientEmail, subject, html);
}

export async function notifyClientStatusChange(opts: {
  clientEmail: string;
  workspaceName: string;
  requestTitle: string;
  newStatus: string;
  dashboardUrl?: string;
}): Promise<boolean> {
  const statusLabels: Record<string, string> = {
    new: 'New', in_review: 'In Review', in_progress: 'In Progress',
    on_hold: 'On Hold', completed: 'Completed', closed: 'Closed',
  };
  const label = statusLabels[opts.newStatus] || opts.newStatus;
  const subject = `Request "${opts.requestTitle}" is now ${label}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #0f1219; color: #e4e4e7; padding: 24px; border-radius: 12px;">
        <div style="font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Status Update — ${escHtml(opts.workspaceName)}</div>
        <h2 style="margin: 0 0 8px; font-size: 16px; color: #f4f4f5;">${escHtml(opts.requestTitle)}</h2>
        <div style="display: inline-block; background: ${opts.newStatus === 'completed' ? 'rgba(74,222,128,0.1)' : 'rgba(45,212,191,0.1)'}; border: 1px solid ${opts.newStatus === 'completed' ? 'rgba(74,222,128,0.3)' : 'rgba(45,212,191,0.2)'}; border-radius: 6px; padding: 4px 12px; font-size: 12px; color: ${opts.newStatus === 'completed' ? '#4ade80' : '#2dd4bf'}; font-weight: 500;">${escHtml(label)}</div>
        ${opts.dashboardUrl ? `<div style="margin-top: 20px; text-align: center;"><a href="${escHtml(opts.dashboardUrl)}" style="display: inline-block; background: #0d9488; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 500;">View in Dashboard</a></div>` : ''}
      </div>
    </div>
  `;
  return sendEmail(opts.clientEmail, subject, html);
}

export async function notifyTeamContentRequest(opts: {
  workspaceName: string;
  topic: string;
  targetKeyword: string;
  priority: string;
  rationale: string;
}): Promise<boolean> {
  const to = getNotificationEmail();
  if (!to) return false;
  const subject = `Content Request: "${opts.topic}" — ${opts.workspaceName}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #0f1219; color: #e4e4e7; padding: 24px; border-radius: 12px;">
        <div style="font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Content Topic Request — ${escHtml(opts.workspaceName)}</div>
        <h2 style="margin: 0 0 4px; font-size: 16px; color: #f4f4f5;">${escHtml(opts.topic)}</h2>
        <div style="font-size: 12px; color: #2dd4bf; margin-bottom: 16px;">Keyword: "${escHtml(opts.targetKeyword)}" · Priority: ${escHtml(opts.priority)}</div>
        <div style="background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.5; color: #d4d4d8; white-space: pre-wrap;">${escHtml(opts.rationale)}</div>
        <div style="margin-top: 20px; font-size: 11px; color: #52525b;">Log in to your dashboard → Content Briefs to generate a brief.</div>
      </div>
    </div>
  `;
  return sendEmail(to, subject, html);
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
