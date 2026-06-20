/**
 * The Issue (Client) P1a — Webflow form-webhook PURE helpers (no Express, no DB).
 *
 * Split from the route (Lane C, Task C3) so the security-sensitive logic — HMAC verification, payload
 * parsing, outcome-type resolution — is unit-testable without spawning a server. The route mounts via
 * express.raw BEFORE express.json (sibling to the Stripe webhook in app.ts) and feeds the raw body here.
 *
 * Signature model: the operator pastes a per-workspace signing secret into Webflow's form-webhook UI;
 * Webflow signs the raw request body with HMAC-SHA256 and sends the hex digest in X-Webflow-Signature.
 * We recompute and compare timing-safely. (The programmatic-registration / OAuth-app path is NOT built
 * at P1a — see the plan's feasibility verdict.)
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import type { OutcomeType } from '../shared/types/the-issue.js';
import type { WebflowFormMapping } from '../shared/types/form-submission.js';

export interface ParsedWebflowForm {
  formId: string;
  formName: string;
  submissionId: string;
  submittedAt: string;
  leadName: string | null;
  leadEmail: string | null;
  leadMessage: string | null;
}

/** Timing-safe HMAC-SHA256(rawBody, secret) hex comparison. Length-checks first so a wrong-length or
 *  empty signature returns false instead of throwing inside timingSafeEqual. */
export function verifyWebflowSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (signature.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch { // catch-ok: a security boundary — any error verifying the signature MUST mean "not verified" (false), never throw to the route.
    return false;
  }
}

// Tolerant of Webflow payload shape variation across plan tiers / field casing.
const webflowEnvelopeSchema = z.object({
  triggerType: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

/** Case-insensitive extraction of a field value from the Webflow form `data` map. Webflow form field
 *  names are user-defined and arbitrarily cased ("Name" / "name" / "Full Name"), so we match by a set
 *  of candidate keys, case-insensitively, returning the first non-empty string. */
function pickField(data: Record<string, unknown>, candidates: string[]): string | null {
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(data)) lowerMap.set(k.toLowerCase(), v);
  for (const cand of candidates) {
    const v = lowerMap.get(cand.toLowerCase());
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

/** Parse a Webflow webhook envelope into a typed form submission. Returns null on a non-form trigger,
 *  a non-object body, or a malformed payload (no submission id) — never throws. */
export function parseWebflowFormPayload(body: unknown): ParsedWebflowForm | null {
  if (body == null || typeof body !== 'object') return null;
  const env = webflowEnvelopeSchema.safeParse(body);
  if (!env.success) return null;
  // Only form submissions are captured; any other trigger (site_publish, etc.) is ignored.
  if (env.data.triggerType && env.data.triggerType !== 'form_submission') return null;

  const payload = env.data.payload ?? {};
  const submissionId = typeof payload.id === 'string' ? payload.id
    : typeof payload.submissionId === 'string' ? payload.submissionId
    : null;
  if (!submissionId) return null;

  const formId = typeof payload.formId === 'string' ? payload.formId
    : typeof payload.formElementId === 'string' ? payload.formElementId
    : '';
  const formName = typeof payload.name === 'string' ? payload.name
    : typeof payload.formName === 'string' ? payload.formName
    : 'Form';
  const submittedAt = typeof payload.submittedAt === 'string' ? payload.submittedAt
    : typeof payload.dateSubmitted === 'string' ? payload.dateSubmitted
    : new Date().toISOString();

  const rawData = payload.data;
  const data: Record<string, unknown> = (rawData != null && typeof rawData === 'object')
    ? rawData as Record<string, unknown>
    : {};

  return {
    formId,
    formName,
    submissionId,
    submittedAt,
    leadName: pickField(data, ['Name', 'Full Name', 'fullName', 'firstName']),
    leadEmail: pickField(data, ['Email', 'Email Address', 'emailAddress']),
    leadMessage: pickField(data, ['Message', 'Comments', 'Notes', 'Details']),
  };
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
