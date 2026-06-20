// shared/types/form-submission.ts — The Issue (Client) P1a Webflow named-lead capture contracts.
//
// A new file (not the-issue.ts) so FormSubmission can import OutcomeType one-way without risking
// an import cycle with outcome-tracking.ts. PII (leadName/leadEmail/leadMessage) is stored ONLY in
// the form_submissions table and is NEVER serialized into the public ROI/workspace payload — the
// public count is anonymous (see D7).
import type { OutcomeType } from './the-issue.js';

/** P1a: a real, named on-site form submission captured via the Webflow form webhook.
 *  PII (leadName/leadEmail/leadMessage) is stored ONLY in form_submissions and is NEVER
 *  serialized into the public ROI payload — the public count is anonymous. */
export interface FormSubmission {
  id: string;
  workspaceId: string;
  formId: string;                 // Webflow form id
  submissionId: string;           // Webflow submission id (dedup key, UNIQUE per workspace)
  formName: string;
  leadName: string | null;        // PII — admin-only
  leadEmail: string | null;       // PII — admin-only
  leadMessage: string | null;     // PII — admin-only
  eventName: string;              // mirrors the GA4 event used for reconciliation (default 'form_submit')
  outcomeType: OutcomeType;       // resolved from the workspace WebflowFormMapping; 'form_fill' default
  submittedAt: string;            // ISO — when Webflow recorded the submission
  capturedAt: string;             // ISO — when our webhook received it
}

/** Per-workspace mapping of a Webflow form to a typed outcome (admin sets this in the setup flow). */
export interface WebflowFormMapping {
  formId: string;
  formName: string;
  outcomeType: OutcomeType;
}
