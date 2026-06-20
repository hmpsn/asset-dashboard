/**
 * The Issue (Client) P1a — Webflow Forms Data-API ingest (POLLING, not webhook).
 *
 * Owner directive: Webflow's signed-webhook model required an operator-pasted per-workspace secret that
 * doesn't match reality, so outcome capture switched from an HMAC webhook receiver to polling the
 * Webflow Data API. The storage (form_submissions), provenance, and client render are source-agnostic
 * and unchanged — only the ingest path moved here.
 *
 * Two network methods (over the shared webflow-client):
 *   - listWebflowForms(siteId)            → GET /sites/{site_id}/forms              (admin "select forms" picker)
 *   - listWebflowFormSubmissions(siteId, formId) → GET /sites/{site_id}/forms/{form_id}/submissions (poller)
 *
 * Two pure helpers (unit-tested without a server; re-homed from the retired webflow-form-webhook.ts):
 *   - resolveOutcomeType  → maps a Webflow form to its typed outcome (form_fill default)
 *   - mapWebflowSubmission → maps a raw Data-API submission to the FormSubmission shape, extracting
 *     name/email/message PII case-insensitively from the dynamic formResponse map.
 *
 * READ-BEFORE-WRITE deviation from the directive: the live Webflow v2 submissions endpoint is
 * SITE-scoped (`/sites/{site_id}/forms/{form_id}/submissions`), not the bare `/forms/{form_id}/submissions`
 * the brief sketched — confirmed against developers.webflow.com. The response wraps items in
 * `formSubmissions` (forms list wraps in `forms`), each with `{ limit, offset, total }` pagination.
 *
 * D7: leadName/leadEmail/leadMessage are PII — stored only in form_submissions, never broadcast/logged
 * or serialized into any public/client payload.
 */
import { getToken, paginateWebflow } from './webflow-client.js';
import type { FormSubmission, WebflowFormMapping } from '../shared/types/form-submission.js';
import type { OutcomeType } from '../shared/types/the-issue.js';

/** A Webflow form as returned by GET /sites/{site_id}/forms (only the fields the picker needs). */
export interface WebflowForm {
  id: string;
  displayName: string;
}

/** A raw Webflow form submission as returned by the Data API (only the fields the mapper reads). */
export interface WebflowFormSubmission {
  id: string;
  formId?: string;
  displayName?: string;
  dateSubmitted?: string;
  /** Dynamic key-value map of the submitted form fields (user-defined keys, arbitrary casing). */
  formResponse?: Record<string, unknown>;
}

/** List a site's forms for the admin "select which forms to track" picker. Empty on no token / error. */
export async function listWebflowForms(siteId: string, tokenOverride?: string): Promise<WebflowForm[]> {
  const token = tokenOverride || getToken();
  if (!token) return [];
  return paginateWebflow<{ forms?: WebflowForm[]; pagination?: { total?: number } }, WebflowForm>({
    buildEndpoint: (offset, limit) => `/sites/${siteId}/forms?limit=${limit}&offset=${offset}`,
    extractItems: page => page.forms,
    getTotal: page => page.pagination?.total,
    tokenOverride: token,
  });
}

/** List a form's submissions (paginated). Empty on no token / error — the poller degrades per-workspace.
 *  `maxPages` bounds the network cost of a large backfill: the Webflow v2 submissions endpoint does not
 *  guarantee a sort order (in practice ascending by date), so the poller can't safely early-terminate on
 *  an "old" submission; it caps the page count instead and applies a date floor in-memory. */
export async function listWebflowFormSubmissions(
  siteId: string,
  formId: string,
  tokenOverride?: string,
  maxPages?: number,
): Promise<WebflowFormSubmission[]> {
  const token = tokenOverride || getToken();
  if (!token) return [];
  return paginateWebflow<{ formSubmissions?: WebflowFormSubmission[]; pagination?: { total?: number } }, WebflowFormSubmission>({
    buildEndpoint: (offset, limit) => `/sites/${siteId}/forms/${formId}/submissions?limit=${limit}&offset=${offset}`,
    extractItems: page => page.formSubmissions,
    getTotal: page => page.pagination?.total,
    tokenOverride: token,
    maxPages,
  });
}

/** Case-insensitive extraction of a field value from the Webflow `formResponse` map. Field names are
 *  user-defined and arbitrarily cased ("Name" / "name" / "Full Name"), so match a candidate set
 *  case-insensitively and return the first non-empty string. */
function pickField(data: Record<string, unknown>, candidates: string[]): string | null {
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(data)) lowerMap.set(k.toLowerCase(), v);
  for (const cand of candidates) {
    const v = lowerMap.get(cand.toLowerCase());
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

/** Resolve a Webflow form to its mapped outcome type. Reads the workspace's webflowFormSources mapping;
 *  defaults to 'form_fill' for an unmapped form so a captured lead is never silently dropped. */
export function resolveOutcomeType(
  ws: { webflowFormSources?: WebflowFormMapping[] },
  formId: string,
  formName: string,
): OutcomeType {
  const sources = ws.webflowFormSources ?? [];
  const byId = sources.find((m) => m.formId && m.formId === formId);
  if (byId) return byId.outcomeType;
  const byName = sources.find((m) => m.formName && m.formName === formName);
  if (byName) return byName.outcomeType;
  return 'form_fill';
}

/** Map a raw Webflow Data-API submission → the FormSubmission shape (sans id, minted by the store).
 *  submissionId = the Webflow submission id (idempotency key); outcomeType via the workspace mapping. */
export function mapWebflowSubmission(
  ws: { id: string; webflowFormSources?: WebflowFormMapping[] },
  sub: WebflowFormSubmission,
): Omit<FormSubmission, 'id'> {
  const formId = sub.formId ?? '';
  const formName = sub.displayName ?? 'Form';
  const data: Record<string, unknown> = (sub.formResponse && typeof sub.formResponse === 'object')
    ? sub.formResponse
    : {};
  return {
    workspaceId: ws.id,
    formId,
    submissionId: sub.id,
    formName,
    leadName: pickField(data, ['Name', 'Full Name', 'fullName', 'firstName']),
    leadEmail: pickField(data, ['Email', 'Email Address', 'emailAddress']),
    leadMessage: pickField(data, ['Message', 'Comments', 'Notes', 'Details']),
    eventName: 'form_submit',
    outcomeType: resolveOutcomeType(ws, formId, formName),
    submittedAt: typeof sub.dateSubmitted === 'string' ? sub.dateSubmitted : new Date().toISOString(),
    capturedAt: new Date().toISOString(),
  };
}
