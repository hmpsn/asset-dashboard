/**
 * The Issue (Client) P1a — typed fetch wrappers for the admin conversion-tracking setup flow.
 *
 * Keeps the admin status / forms / form-sources calls out of raw component `fetch` (no-raw-fetch
 * convention). Outcome capture is via Webflow Data-API POLLING (server/webflow-form-poller.ts), not a
 * webhook — so this surface no longer mints a signing secret. The setup is: list the site's Webflow
 * forms → map each to a typed outcome → save. PII (lead identity) is admin-internal (D7) and never
 * crosses this boundary; the status readout exposes counts + freshness only.
 */
import { get, getSafe, put } from './client';
import type { OutcomeType } from '../../shared/types/the-issue.ts';
import type { WebflowFormMapping } from '../../shared/types/form-submission.ts';

/** Admin verification-readout status. Counts + freshness only — never PII. */
export interface ConversionTrackingStatus {
  /** Pinned events in the workspace eventConfig. */
  pinnedCount: number;
  /** Pinned events that also carry an outcomeType classification. */
  typedCount: number;
  /** True only when setup is confirmed AND ≥1 Webflow form is selected (the provenance-flip basis). */
  formCaptureConnected: boolean;
  /** ISO timestamp of the most recently captured lead, or null if none. */
  lastSubmissionAt: string | null;
  /** Total captured leads (all time). */
  submissionCount: number;
  /** Latest-snapshot pinned-outcome count (anonymous) — powers the admin value-integrity preview. */
  recentOutcomeCount: number;
}

/** A Webflow form available for selection in the "track these forms" picker. */
export interface WebflowFormOption {
  id: string;
  displayName: string;
}

/** Result of saving the form-source mappings. */
export interface FormSourcesSaveResult {
  saved: boolean;
  formCaptureConnected: boolean;
}

const STATUS_FALLBACK: ConversionTrackingStatus = {
  pinnedCount: 0,
  typedCount: 0,
  formCaptureConnected: false,
  lastSubmissionAt: null,
  submissionCount: 0,
  recentOutcomeCount: 0,
};

export const conversionTrackingApi = {
  /** GET the verification readout. Returns a safe zero-state fallback on any error / flag-OFF 404. */
  getStatus: (workspaceId: string) =>
    getSafe<ConversionTrackingStatus>(
      `/api/workspaces/${workspaceId}/conversion-tracking-status`,
      STATUS_FALLBACK,
    ),

  /** GET the site's Webflow forms for the picker. THROWS on any error (502 Webflow-unreachable / 400
   *  no-site-linked / flag-OFF 404) so the caller can distinguish a real failure from a genuinely
   *  zero-form site (an empty `forms` array on a 200). Using the swallowing getSafe here would collapse
   *  both cases into the same empty state and make the component's error toast dead code. */
  getWebflowForms: (workspaceId: string) =>
    get<{ forms: WebflowFormOption[] }>(
      `/api/workspaces/${workspaceId}/webflow-forms`,
    ).then((r) => r.forms),

  /** Save the formId→outcomeType mappings. Confirms setup server-side when ≥1 form is mapped. */
  saveFormSources: (workspaceId: string, sources: WebflowFormMapping[]) =>
    put<FormSourcesSaveResult>(`/api/workspaces/${workspaceId}/form-sources`, { sources }),
};

/** Re-export OutcomeType for the picker UI (each selected form maps to one). */
export type { OutcomeType, WebflowFormMapping };
