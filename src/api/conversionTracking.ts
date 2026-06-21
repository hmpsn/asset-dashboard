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
import type { NamedLeadView, OutcomeType, SetupReadinessState } from '../../shared/types/the-issue.ts';
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
  /** P1b (A4): PII-free setup-readiness ✓/⚠ rollup. null when the workspace is missing. Admin-only —
   *  rides ONLY this requireWorkspaceAccess endpoint, never the public payload (D7). Lane B consumes it. */
  readiness: SetupReadinessState | null;
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
  readiness: null,
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

  /** P1b (A6, admin): the operator's captured named-leads (PII), paginated. Safe empty on flag-OFF 404. */
  listLeads: (workspaceId: string, params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return getSafe<{ leads: NamedLeadView[]; total: number }>(
      `/api/workspaces/${workspaceId}/form-submissions${suffix}`,
      { leads: [], total: 0 },
    );
  },
};

/**
 * P1b (A6, client): the forwardable one-pager export. It is a navigable HTML document (print-from-
 * browser — there is NO PDF library), so the wrapper returns the URL to open via window.open, not a
 * fetched body. Lane C consumes this.
 */
export function getOnePagerExportUrl(workspaceId: string): string {
  return `/api/public/export/${workspaceId}/one-pager`;
}

/**
 * P1b (A6, client): the client's OWN captured leads (authed PII). Safe empty on flag-OFF 404. Lane C
 * consumes this.
 */
export function getMyLeads(workspaceId: string): Promise<{ leads: NamedLeadView[] }> {
  return getSafe<{ leads: NamedLeadView[] }>(`/api/public/export/${workspaceId}/my-leads`, { leads: [] });
}

/** Re-export OutcomeType for the picker UI (each selected form maps to one). */
export type { OutcomeType, WebflowFormMapping };
