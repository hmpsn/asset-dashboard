import type { BadgeTone } from './Badge';

export type PageEditStatus = 'clean' | 'issue-detected' | 'fix-proposed' | 'in-review' | 'approved' | 'rejected' | 'live';
export type StatusBadgeDomain =
  | 'page-edit'
  | 'content'
  | 'approval'
  | 'client-action'
  | 'schema'
  | 'matrix'
  | 'integration'
  | 'job'
  | 'severity'
  | 'priority';

interface StatusStyle {
  label: string;
  border: string;
  bg: string;
  text: string;
  dot: string;
  tone: BadgeTone;
}

export const statusConfig: Record<PageEditStatus, StatusStyle | null> = {
  clean: null,
  'issue-detected': { label: 'Issue Detected', border: 'border-amber-500/30', bg: 'bg-amber-500/8', text: 'text-amber-400/80', dot: 'bg-amber-400/80', tone: 'amber' },
  'fix-proposed':   { label: 'Fix Proposed',   border: 'border-blue-500/30',  bg: 'bg-blue-500/10',  text: 'text-blue-400',  dot: 'bg-blue-400', tone: 'blue' },
  'in-review':      { label: 'In Review',      border: 'border-teal-500/30',   bg: 'bg-teal-500/10',   text: 'text-teal-400',   dot: 'bg-teal-400', tone: 'teal' },
  approved:         { label: 'Approved',        border: 'border-emerald-500/30', bg: 'bg-emerald-500/8', text: 'text-emerald-400/80', dot: 'bg-emerald-400/80', tone: 'emerald' },
  rejected:         { label: 'Rejected',        border: 'border-red-500/30',   bg: 'bg-red-500/8',   text: 'text-red-400/80',   dot: 'bg-red-400/80', tone: 'red' },
  live:             { label: 'Live',            border: 'border-teal-500/30',  bg: 'bg-teal-500/10',  text: 'text-teal-400',  dot: 'bg-teal-400', tone: 'teal' },
};

export interface StatusBadgeConfig {
  label: string;
  tone: BadgeTone;
}

export const STATUS_BADGE_REGISTRY: Record<StatusBadgeDomain, Record<string, StatusBadgeConfig | null>> = {
  'page-edit': statusConfig,
  content: {
    draft: { label: 'Draft', tone: 'zinc' },
    generating: { label: 'Generating', tone: 'amber' },
    requested: { label: 'Requested', tone: 'blue' },
    new: { label: 'New', tone: 'blue' },
    open: { label: 'Open', tone: 'teal' },
    queued: { label: 'Queued', tone: 'amber' },
    pending: { label: 'Pending', tone: 'amber' },
    in_progress: { label: 'In Progress', tone: 'amber' },
    review: { label: 'In Review', tone: 'teal' },
    in_review: { label: 'In Review', tone: 'teal' },
    client_review: { label: 'Needs Your Review', tone: 'teal' },
    post_review: { label: 'Needs Your Review', tone: 'teal' },
    ready_for_review: { label: 'Ready for Review', tone: 'teal' },
    changes_requested: { label: 'Changes Requested', tone: 'orange' },
    pending_payment: { label: 'Awaiting Payment', tone: 'amber' },
    approved: { label: 'Approved', tone: 'emerald' },
    delivered: { label: 'Delivered', tone: 'emerald' },
    published: { label: 'Published', tone: 'emerald' },
    failed: { label: 'Failed', tone: 'red' },
    cancelled: { label: 'Cancelled', tone: 'zinc' },
  },
  approval: {
    pending: { label: 'Awaiting Review', tone: 'teal' },
    partial: { label: 'Partially Reviewed', tone: 'amber' },
    approved: { label: 'Approved', tone: 'emerald' },
    rejected: { label: 'Rejected', tone: 'red' },
    changes_requested: { label: 'Changes Requested', tone: 'orange' },
    client_review: { label: 'Needs Review', tone: 'teal' },
    ready_for_review: { label: 'Ready for Review', tone: 'teal' },
    applied: { label: 'Applied', tone: 'blue' },
  },
  'client-action': {
    pending: { label: 'Pending', tone: 'amber' },
    new: { label: 'New', tone: 'blue' },
    open: { label: 'Open', tone: 'teal' },
    approved: { label: 'Approved', tone: 'emerald' },
    awaiting_implementation: { label: 'Awaiting Implementation', tone: 'amber' },
    completed: { label: 'Completed', tone: 'emerald' },
    archived: { label: 'Archived', tone: 'zinc' },
    declined: { label: 'Declined', tone: 'red' },
    rejected: { label: 'Rejected', tone: 'red' },
    changes_requested: { label: 'Changes Requested', tone: 'orange' },
    implemented: { label: 'Implemented', tone: 'emerald' },
    resolved: { label: 'Resolved', tone: 'emerald' },
  },
  schema: {
    draft: { label: 'Awaiting Review', tone: 'amber' },
    sent_to_client: { label: 'Sent to client', tone: 'teal' },
    client_approved: { label: 'Approved', tone: 'emerald' },
    client_changes_requested: { label: 'Changes Requested', tone: 'orange' },
    active: { label: 'Active', tone: 'emerald' },
    published: { label: 'Published', tone: 'emerald' },
    valid: { label: 'Valid', tone: 'emerald' },
    warnings: { label: 'Warnings', tone: 'amber' },
    errors: { label: 'Errors', tone: 'red' },
    failed: { label: 'Failed', tone: 'red' },
  },
  matrix: {
    planned: { label: 'Planned', tone: 'zinc' },
    keyword_validated: { label: 'Keyword Validated', tone: 'blue' },
    brief_generated: { label: 'Brief Generated', tone: 'amber' },
    review: { label: 'Review', tone: 'teal' },
    flagged: { label: 'Flagged', tone: 'orange' },
    approved: { label: 'Approved', tone: 'emerald' },
    draft: { label: 'Draft', tone: 'teal' },
    published: { label: 'Published', tone: 'emerald' },
  },
  integration: {
    connected: { label: 'Connected', tone: 'emerald' },
    configured: { label: 'Configured', tone: 'emerald' },
    active: { label: 'Active', tone: 'emerald' },
    degraded: { label: 'Degraded', tone: 'amber' },
    warning: { label: 'Warning', tone: 'amber' },
    missing: { label: 'Missing', tone: 'red' },
    critical: { label: 'Critical', tone: 'red' },
    disconnected: { label: 'Disconnected', tone: 'red' },
    error: { label: 'Error', tone: 'red' },
    unknown: { label: 'Unknown', tone: 'zinc' },
    ok: { label: 'OK', tone: 'emerald' },
  },
  job: {
    queued: { label: 'Queued', tone: 'amber' },
    pending: { label: 'Pending', tone: 'amber' },
    running: { label: 'Running', tone: 'amber' },
    completed: { label: 'Completed', tone: 'emerald' },
    failed: { label: 'Failed', tone: 'red' },
    cancelled: { label: 'Cancelled', tone: 'zinc' },
    paused: { label: 'Paused', tone: 'zinc' },
    past_due: { label: 'Past Due', tone: 'red' },
  },
  severity: {
    critical: { label: 'Critical', tone: 'red' },
    high: { label: 'High', tone: 'red' },
    warning: { label: 'Warning', tone: 'amber' },
    medium: { label: 'Medium', tone: 'amber' },
    opportunity: { label: 'Opportunity', tone: 'blue' },
    info: { label: 'Info', tone: 'blue' },
    positive: { label: 'Positive', tone: 'emerald' },
    win: { label: 'Win', tone: 'emerald' },
    low: { label: 'Low', tone: 'zinc' },
  },
  priority: {
    p0: { label: 'P0', tone: 'red' },
    p1: { label: 'P1', tone: 'amber' },
    p2: { label: 'P2', tone: 'blue' },
    p3: { label: 'P3', tone: 'zinc' },
    fix_now: { label: 'Fix Now', tone: 'red' },
    fix_soon: { label: 'Fix Soon', tone: 'amber' },
    fix_later: { label: 'Fix Later', tone: 'blue' },
    ongoing: { label: 'Ongoing', tone: 'zinc' },
    urgent: { label: 'Urgent', tone: 'red' },
    high: { label: 'High', tone: 'red' },
    medium: { label: 'Medium', tone: 'amber' },
    low: { label: 'Low', tone: 'zinc' },
  },
};

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replaceAll('-', '_').replace(/\s+/g, '_');
}

function titleizeStatus(status: string): string {
  return status
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function resolveStatusBadgeConfig(
  domain: StatusBadgeDomain,
  status: string | null | undefined,
  fallback?: 'neutral',
): StatusBadgeConfig | null {
  if (!status) return null;
  const registry = STATUS_BADGE_REGISTRY[domain];
  const direct = registry[status];
  if (direct !== undefined) return direct;
  const normalized = normalizeStatus(status);
  const normalizedMatch = registry[normalized] ?? registry[normalized.replaceAll('_', '-')];
  if (normalizedMatch !== undefined) return normalizedMatch;
  if (fallback === 'neutral') return { label: titleizeStatus(status), tone: 'zinc' };
  return null;
}

export function statusBorderClass(status: PageEditStatus | undefined | null): string {
  if (!status || status === 'clean') return '';
  const c = statusConfig[status];
  return c ? `border-l-2 ${c.border.replace('/30', '/40')}` : '';
}

export function statusDotClass(status: PageEditStatus | undefined | null): string {
  if (!status || status === 'clean') return '';
  const c = statusConfig[status];
  return c?.dot || '';
}
