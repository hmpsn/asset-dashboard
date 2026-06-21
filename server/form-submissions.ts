/**
 * The Issue (Client) P1a — typed Webflow named-lead store (form_submissions table, migration 148).
 *
 * Modeled on server/ga4-snapshots.ts (createStmtCache, rowToX mapper). The webhook receiver (Lane C
 * route, Lane A pure helpers) writes here; the public ROI payload reads ONLY anonymous counts via
 * countFormSubmissions / reconcileFormCountVsGa4. PII (lead_name/email/message) is admin-only and
 * NEVER serialized into any public/client payload (D7).
 *
 * Idempotency: UNIQUE(workspace_id, submission_id) + INSERT OR IGNORE makes a re-delivered webhook a
 * no-op (res.changes === 0 → { inserted: false }), so a duplicate delivery never double-counts.
 */
import { randomUUID } from 'crypto';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type { FormSubmission } from '../shared/types/form-submission.js';
import type { OutcomeType } from '../shared/types/the-issue.js';

interface FormSubmissionRow {
  id: string; workspace_id: string; form_id: string; submission_id: string; form_name: string;
  lead_name: string | null; lead_email: string | null; lead_message: string | null;
  event_name: string; outcome_type: string; submitted_at: string; captured_at: string;
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT OR IGNORE INTO form_submissions
       (id, workspace_id, form_id, submission_id, form_name, lead_name, lead_email,
        lead_message, event_name, outcome_type, submitted_at, captured_at)
     VALUES (@id, @workspace_id, @form_id, @submission_id, @form_name, @lead_name, @lead_email,
        @lead_message, @event_name, @outcome_type, @submitted_at, @captured_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM form_submissions WHERE workspace_id = ? ORDER BY submitted_at DESC`,
  ),
  selectByWorkspacePaged: db.prepare(
    `SELECT * FROM form_submissions WHERE workspace_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?`,
  ),
  countByWorkspace: db.prepare(
    `SELECT COUNT(*) AS n FROM form_submissions WHERE workspace_id = ?`,
  ),
  countInRange: db.prepare(
    `SELECT COUNT(*) AS n FROM form_submissions
       WHERE workspace_id = ? AND submitted_at >= ? AND submitted_at <= ?`,
  ),
  status: db.prepare(
    `SELECT COUNT(*) AS n, MAX(submitted_at) AS last FROM form_submissions WHERE workspace_id = ?`,
  ),
}));

function rowToFormSubmission(row: FormSubmissionRow): FormSubmission {
  return {
    id: row.id, workspaceId: row.workspace_id, formId: row.form_id, submissionId: row.submission_id,
    formName: row.form_name, leadName: row.lead_name, leadEmail: row.lead_email,
    leadMessage: row.lead_message, eventName: row.event_name,
    outcomeType: row.outcome_type as OutcomeType, submittedAt: row.submitted_at, capturedAt: row.captured_at,
  };
}

/** Idempotent insert. `inserted` is false when a row with the same (workspaceId, submissionId)
 *  already existed (webhook re-delivery) — caller must NOT broadcast/log a duplicate. */
export function saveFormSubmission(s: Omit<FormSubmission, 'id'>): { inserted: boolean; id: string } {
  const id = randomUUID();
  const res = stmts().insert.run({
    id, workspace_id: s.workspaceId, form_id: s.formId, submission_id: s.submissionId,
    form_name: s.formName, lead_name: s.leadName, lead_email: s.leadEmail, lead_message: s.leadMessage,
    event_name: s.eventName, outcome_type: s.outcomeType, submitted_at: s.submittedAt, captured_at: s.capturedAt,
  });
  return { inserted: res.changes > 0, id };
}

/** Admin-only: full named-lead rows (includes PII). NEVER call from a public serializer. */
export function loadFormSubmissions(workspaceId: string): FormSubmission[] {
  return (stmts().selectByWorkspace.all(workspaceId) as FormSubmissionRow[]).map(rowToFormSubmission);
}

/**
 * Admin/client-authed paginated named-lead read (P1b A5). Returns the page of leads (PII included)
 * plus the UNBOUNDED total (rate-display-shares-source: the page length is NOT the total). NEVER call
 * from a public unauthed serializer — the guard on the route (requireWorkspaceAccess /
 * requireAuthenticatedClientPortalAuth) is what authorizes PII exposure (D7).
 */
export function loadFormSubmissionsPaged(
  workspaceId: string,
  opts: { limit: number; offset: number },
): { leads: FormSubmission[]; total: number } {
  const rows = stmts().selectByWorkspacePaged.all(workspaceId, opts.limit, opts.offset) as FormSubmissionRow[];
  const total = (stmts().countByWorkspace.get(workspaceId) as { n: number }).n;
  return { leads: rows.map(rowToFormSubmission), total };
}

/** Anonymous count of captured leads in a date range (inclusive). Safe for the public payload. */
export function countFormSubmissions(workspaceId: string, range: { startDate: string; endDate: string }): number {
  const r = stmts().countInRange.get(workspaceId, range.startDate, `${range.endDate}T23:59:59.999Z`) as { n: number };
  return r.n;
}

/** Feeds the admin verification readout (Lane C) — count + freshness only, no PII. */
export function getFormCaptureStatus(workspaceId: string): { count: number; lastSubmissionAt: string | null } {
  const r = stmts().status.get(workspaceId) as { n: number; last: string | null };
  return { count: r.n, lastSubmissionAt: r.last };
}

/** GA4-vs-captured trust guard (A8). Counts only — never PII. The discrepancy is surfaced, not hidden. */
export function reconcileFormCountVsGa4(
  workspaceId: string,
  ga4Count: number,
  range: { startDate: string; endDate: string },
): { capturedCount: number; ga4Count: number; discrepancy: number } {
  const capturedCount = countFormSubmissions(workspaceId, range);
  return { capturedCount, ga4Count, discrepancy: ga4Count - capturedCount };
}
