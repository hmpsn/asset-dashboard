/**
 * The Issue (Client) P1a — typed fetch wrapper for the admin conversion-tracking setup flow.
 *
 * Keeps the admin status/enable/disable calls out of raw component `fetch` (no-raw-fetch convention).
 * The webhook RECEIVER (POST /api/public/webflow-form-webhook/:id) is server-to-server (Webflow → us)
 * and is NOT called from here. PII (lead identity) + the signing secret are admin-internal (D7); the
 * secret is returned exactly once on enable and never re-serialized — copy it immediately.
 */
import { getSafe, post } from './client';

/** Admin verification-readout status. Counts + freshness only — never PII. */
export interface ConversionTrackingStatus {
  /** Pinned events in the workspace eventConfig. */
  pinnedCount: number;
  /** Pinned events that also carry an outcomeType classification. */
  typedCount: number;
  /** True only when setup is confirmed AND a signing secret exists (the provenance-flip basis). */
  formCaptureConnected: boolean;
  /** ISO timestamp of the most recently captured lead, or null if none. */
  lastSubmissionAt: string | null;
  /** Total captured leads (all time). */
  submissionCount: number;
  /** Latest-snapshot pinned-outcome count (anonymous) — powers the admin value-integrity preview. */
  recentOutcomeCount: number;
}

/** Result of enabling form capture — the signing secret is returned ONCE. Copy it immediately. */
export interface FormCaptureEnableResult {
  webhookUrl: string;
  /** The HMAC signing secret — shown exactly once, never re-fetched. */
  webhookSecret: string;
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

  /** Enable Webflow form capture — generates + returns the signing secret ONCE. */
  enableFormCapture: (workspaceId: string) =>
    post<FormCaptureEnableResult>(`/api/workspaces/${workspaceId}/form-capture/enable`, {}),

  /** Disable form capture — clears the secret + sources. Re-enabling mints a fresh secret. */
  disableFormCapture: (workspaceId: string) =>
    post<{ disabled: true }>(`/api/workspaces/${workspaceId}/form-capture/disable`, {}),
};
