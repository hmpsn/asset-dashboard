import nodemailer from 'nodemailer';
import { queueEmail, registerSendFn, restoreQueue } from './email-queue.js';
import type { EmailEvent } from './email-templates.js';

// Configure via env vars:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// SMTP_FROM_NAME — display name for outgoing emails (e.g. "hmpsn studio")
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
  const fromAddr = process.env.SMTP_FROM || user;
  const fromName = process.env.SMTP_FROM_NAME;
  const from = fromName ? `"${fromName}" <${fromAddr}>` : fromAddr;
  if (!host || !user || !pass) return null;
  return { host, port, user, pass, from: from! };
}

// ── Shared transport (singleton) ──

let _transport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  if (_transport) return _transport;
  const cfg = getConfig();
  if (!cfg) return null;
  _transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  return _transport;
}

export function isEmailConfigured(): boolean {
  return getConfig() !== null;
}

export function getNotificationEmail(): string | undefined {
  return process.env.NOTIFICATION_EMAIL;
}

/**
 * Low-level send. Used by the queue flusher and for one-off emails
 * (monthly reports, approval reminders) that bypass the queue.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const cfg = getConfig();
  const transport = getTransport();
  if (!cfg || !transport) return false;
  try {
    await transport.sendMail({ from: cfg.from, to, subject, html });
    return true;
  } catch (err) {
    console.error('[email] Failed to send:', err);
    return false;
  }
}

// ── Initialize queue ──

export function initEmailQueue() {
  registerSendFn(sendEmail);
  restoreQueue();
  console.log('[email] Queue initialized');
}

// ── Queue-based notification helpers ──
// These replace the old direct-send functions. Each pushes an event onto
// the batching queue instead of sending immediately.

function makeEvent(
  type: EmailEvent['type'],
  recipient: string,
  workspaceId: string,
  workspaceName: string,
  dashboardUrl: string | undefined,
  data: Record<string, unknown>,
): EmailEvent {
  return { type, recipient, workspaceId, workspaceName, dashboardUrl, data, createdAt: new Date().toISOString() };
}

export function notifyTeamNewRequest(opts: {
  workspaceName: string;
  workspaceId?: string;
  title: string;
  description: string;
  category: string;
  submittedBy?: string;
  pageUrl?: string;
}): void {
  const to = getNotificationEmail();
  if (!to || !isEmailConfigured()) return;
  queueEmail(makeEvent('request_new', to, opts.workspaceId || '', opts.workspaceName, undefined, {
    title: opts.title, description: opts.description, category: opts.category,
    submittedBy: opts.submittedBy, pageUrl: opts.pageUrl,
  }));
}

export function notifyClientTeamResponse(opts: {
  clientEmail: string;
  workspaceName: string;
  workspaceId?: string;
  requestTitle: string;
  noteContent: string;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) return;
  queueEmail(makeEvent('request_response', opts.clientEmail, opts.workspaceId || '', opts.workspaceName, opts.dashboardUrl, {
    requestTitle: opts.requestTitle, noteContent: opts.noteContent,
  }));
}

export function notifyClientStatusChange(opts: {
  clientEmail: string;
  workspaceName: string;
  workspaceId?: string;
  requestTitle: string;
  newStatus: string;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) return;
  queueEmail(makeEvent('request_status', opts.clientEmail, opts.workspaceId || '', opts.workspaceName, opts.dashboardUrl, {
    requestTitle: opts.requestTitle, newStatus: opts.newStatus,
  }));
}

export function notifyTeamContentRequest(opts: {
  workspaceName: string;
  workspaceId?: string;
  topic: string;
  targetKeyword: string;
  priority: string;
  rationale: string;
}): void {
  const to = getNotificationEmail();
  if (!to || !isEmailConfigured()) return;
  queueEmail(makeEvent('content_request', to, opts.workspaceId || '', opts.workspaceName, undefined, {
    topic: opts.topic, targetKeyword: opts.targetKeyword, priority: opts.priority, rationale: opts.rationale,
  }));
}

export function notifyClientBriefReady(opts: {
  clientEmail: string;
  workspaceName: string;
  workspaceId?: string;
  topic: string;
  targetKeyword: string;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) return;
  queueEmail(makeEvent('content_brief_ready', opts.clientEmail, opts.workspaceId || '', opts.workspaceName, opts.dashboardUrl, {
    topic: opts.topic, targetKeyword: opts.targetKeyword,
  }));
}

export function notifyApprovalReady(opts: {
  clientEmail: string;
  workspaceName: string;
  workspaceId?: string;
  batchName: string;
  itemCount: number;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) return;
  queueEmail(makeEvent('approval_ready', opts.clientEmail, opts.workspaceId || '', opts.workspaceName, opts.dashboardUrl, {
    batchName: opts.batchName, itemCount: opts.itemCount,
  }));
}

export function notifyClientWelcome(opts: {
  clientEmail: string;
  clientName: string;
  workspaceName: string;
  workspaceId: string;
  dashboardUrl: string;
}): void {
  if (!isEmailConfigured()) return;
  queueEmail(makeEvent('client_welcome', opts.clientEmail, opts.workspaceId, opts.workspaceName, opts.dashboardUrl, {
    clientName: opts.clientName,
  }));
}

export function notifyAuditAlert(opts: {
  workspaceName: string;
  workspaceId?: string;
  siteName?: string;
  score: number;
  previousScore?: number;
}): void {
  const to = getNotificationEmail();
  if (!to || !isEmailConfigured()) return;
  queueEmail(makeEvent('audit_alert', to, opts.workspaceId || '', opts.workspaceName, undefined, {
    siteName: opts.siteName, score: opts.score, previousScore: opts.previousScore,
  }));
}

export function notifyClientFixesApplied(opts: {
  clientEmail: string;
  workspaceName: string;
  workspaceId: string;
  productType: string;
  pageCount: number;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) return;
  queueEmail(makeEvent('fixes_applied', opts.clientEmail, opts.workspaceId, opts.workspaceName, opts.dashboardUrl, {
    productType: opts.productType, pageCount: opts.pageCount,
  }));
}

export function notifyTeamPaymentReceived(opts: {
  workspaceName: string;
  workspaceId: string;
  productType: string;
  amount: string;
}): void {
  const to = getNotificationEmail();
  if (!to || !isEmailConfigured()) return;
  queueEmail(makeEvent('payment_received', to, opts.workspaceId, opts.workspaceName, undefined, {
    productType: opts.productType, amount: opts.amount,
  }));
}

export function notifyClientRecommendationsReady(opts: {
  clientEmail: string;
  workspaceName: string;
  workspaceId: string;
  recCount: number;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) return;
  queueEmail(makeEvent('recommendations_ready', opts.clientEmail, opts.workspaceId, opts.workspaceName, opts.dashboardUrl, {
    recCount: opts.recCount,
  }));
}

export function notifyClientAuditImproved(opts: {
  clientEmail: string;
  workspaceName: string;
  workspaceId: string;
  score: number;
  previousScore: number;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) return;
  queueEmail(makeEvent('audit_improved', opts.clientEmail, opts.workspaceId, opts.workspaceName, opts.dashboardUrl, {
    score: opts.score, previousScore: opts.previousScore,
  }));
}

export function notifyAnomalyAlert(opts: {
  workspaceName: string;
  workspaceId: string;
  anomalies: Array<{ title: string; description: string; severity: string; source: string; changePct: number }>;
  aiSummary?: string;
  clientEmail?: string;
  dashboardUrl?: string;
}): void {
  if (!isEmailConfigured()) return;
  // Notify admin team
  const to = getNotificationEmail();
  if (to) {
    for (const a of opts.anomalies) {
      queueEmail(makeEvent('anomaly_alert', to, opts.workspaceId, opts.workspaceName, undefined, {
        title: a.title, description: a.description, severity: a.severity, source: a.source, changePct: a.changePct, aiSummary: opts.aiSummary,
      }));
    }
  }
  // Notify client if email configured and any critical anomalies
  const hasCritical = opts.anomalies.some(a => a.severity === 'critical');
  if (opts.clientEmail && hasCritical) {
    for (const a of opts.anomalies.filter(x => x.severity === 'critical')) {
      queueEmail(makeEvent('anomaly_alert', opts.clientEmail, opts.workspaceId, opts.workspaceName, opts.dashboardUrl, {
        title: a.title, description: a.description, severity: a.severity, source: a.source, changePct: a.changePct, aiSummary: opts.aiSummary,
      }));
    }
  }
}

export function notifyTeamChurnSignal(opts: {
  workspaceName: string;
  workspaceId: string;
  signalTitle: string;
  signalDescription: string;
  severity: string;
}): void {
  const to = getNotificationEmail();
  if (!to || !isEmailConfigured()) return;
  queueEmail(makeEvent('churn_signal', to, opts.workspaceId, opts.workspaceName, undefined, {
    signalTitle: opts.signalTitle, signalDescription: opts.signalDescription, severity: opts.severity,
  }));
}
