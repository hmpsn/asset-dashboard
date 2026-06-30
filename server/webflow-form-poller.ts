/**
 * The Issue (Client) P1a — daily Webflow form-submission poller (replaces the HMAC webhook receiver).
 *
 * runWebflowFormPoll() — for every workspace with the-issue-client-measured-capture ON + ≥1 tracked
 * form (webflowFormSources), lists that form's submissions via the Webflow Data API, dedup-ingests each
 * via saveFormSubmission (idempotent on submissionId), and on a genuinely-new insert:
 *   - flips conversionTrackingConfirmedAt on the first captured lead (D6 provenance flip),
 *   - broadcasts FORM_SUBMISSION_CAPTURED ({ workspaceId, outcomeType } — PII-free, D7),
 *   - logs the admin-only form_submission_captured activity (formId + outcomeType only — PII-free).
 *
 * Flag-OFF byte-identical: a workspace whose flag is OFF is skipped before any Webflow call, so capture
 * is fully inert. Each workspace + each form is isolated in its own try/catch so a single Webflow API
 * error degrades that workspace only and never throws the pass (FM-2 honest degradation — mirrors
 * ga4-conversion-snapshot-scheduler). Daily cadence (matches the GA4 conversion-snapshot cron).
 */
import { createLogger } from './logger.js';
import { listWorkspaces, getTokenForSite, updateWorkspace } from './workspaces.js';
import { listWebflowFormSubmissions, mapWebflowSubmission } from './webflow-forms.js';
import { saveFormSubmission } from './form-submissions.js';
import { broadcastToWorkspace } from './broadcast.js';
import { WS_EVENTS } from './ws-events.js';
import { addActivity } from './activity-log.js';
import { isFeatureEnabled } from './feature-flags.js';

const log = createLogger('webflow-form-poller');

const FLAG = 'the-issue-client-measured-capture';
const DAILY_MS = 24 * 60 * 60 * 1000;
// Backfill date floor: when a workspace has no confirmed-setup timestamp, only submissions newer than
// (now − 30d) count as fresh measured outcomes. Older history is pre-setup noise and must be skipped.
const DEFAULT_FLOOR_MS = 30 * 24 * 60 * 60 * 1000;
// Network-cost bound for a single form's backfill (the v2 submissions endpoint has no guaranteed sort
// order, so we cap pages rather than early-terminate on an "old" submission). 100/page × 20 pages.
const MAX_SUBMISSION_PAGES = 20;

let pollInterval: ReturnType<typeof setInterval> | null = null;
let pollStartupTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Poll Webflow forms for every measured-capture-enabled workspace with tracked forms. Each workspace —
 * and each tracked form within it — is isolated in its own try/catch so a single Webflow error degrades
 * that workspace/form only (never throws the pass). Flag-OFF workspaces are skipped (no Webflow call).
 */
export async function runWebflowFormPoll(): Promise<void> {
  for (const ws of listWorkspaces()) {
    // Flag-OFF byte-identical: skip before any Webflow API call — capture is fully inert.
    if (!isFeatureEnabled(FLAG, ws.id)) continue;
    const sources = ws.webflowFormSources ?? [];
    const siteId = ws.webflowSiteId;
    if (sources.length === 0 || !siteId) continue;

    const token = getTokenForSite(siteId) || undefined;
    // Dedupe tracked form ids (a name-mapped source may share an id; poll each unique form once).
    const formIds = Array.from(new Set(sources.map(s => s.formId).filter(Boolean)));

    // Date floor: only post-setup submissions count as fresh measured outcomes. A confirmed-setup
    // timestamp is the basis; before that, fall back to (now − 30d) so a first poll never ingests a
    // workspace's entire historical lead backfill as if it were captured today. Pre-floor submissions
    // are skipped entirely (no save → no flip → no broadcast → no activity → never counted by ROI).
    const floor = ws.conversionTrackingConfirmedAt ?? new Date(Date.now() - DEFAULT_FLOOR_MS).toISOString();

    for (const formId of formIds) {
      try {
        // maxPages bounds the backfill network cost (the v2 endpoint has no guaranteed sort order).
        const submissions = await listWebflowFormSubmissions(siteId, formId, token, MAX_SUBMISSION_PAGES);
        for (const sub of submissions) {
          const mapped = mapWebflowSubmission(ws, sub);
          // Skip pre-floor (pre-setup) history: do NOT persist/flip/broadcast/log so ROI's 30-day
          // count (countFormSubmissions by submittedAt) never sees a workspace's lead backfill.
          if (mapped.submittedAt < floor) continue;
          const { inserted } = saveFormSubmission(mapped);
          // A duplicate (already-ingested submissionId) is a no-op — never broadcast/log/flip twice.
          if (!inserted) continue;

          // D6 provenance-flip basis: the first captured real lead confirms setup if not already.
          if (!ws.conversionTrackingConfirmedAt) {
            const confirmedAt = new Date().toISOString();
            updateWorkspace(ws.id, { conversionTrackingConfirmedAt: confirmedAt });
            // Mutate the in-memory copy so a second insert in the same pass doesn't re-flip.
            ws.conversionTrackingConfirmedAt = confirmedAt;
          }
          // PII omitted from metadata (D7) — only the form id + resolved outcome type.
          addActivity(ws.id, 'form_submission_captured', `New ${mapped.formName} submission captured`, undefined, {
            formId: mapped.formId,
            outcomeType: mapped.outcomeType,
          });
          broadcastToWorkspace(ws.id, WS_EVENTS.FORM_SUBMISSION_CAPTURED, { workspaceId: ws.id, outcomeType: mapped.outcomeType });
        }
      } catch (err) {
        log.warn({ err, workspaceId: ws.id, formId }, 'Failed to poll Webflow form submissions — skipping form');
      }
    }
  }
}

/** Register the daily Webflow form poller. Safe to call multiple times (idempotent). */
export function startWebflowFormPoller(): void {
  if (pollInterval || pollStartupTimeout) return;

  // Run 2 minutes after startup, then every 24 hours (matches the GA4 conversion-snapshot cron).
  pollStartupTimeout = setTimeout(() => {
    pollStartupTimeout = null;
    runWebflowFormPoll().catch(err =>
      log.error({ err }, 'Webflow form poller initial run error'),
    );
  }, 2 * 60 * 1000);

  pollInterval = setInterval(() => {
    runWebflowFormPoll().catch(err =>
      log.error({ err }, 'Webflow form poller error'),
    );
  }, DAILY_MS);

  log.info('Webflow form poller started (initial run in 2m, then 24h interval)');
}

/** Stop the Webflow form poller (used during graceful shutdown / tests). */
export function stopWebflowFormPoller(): void {
  if (pollStartupTimeout) {
    clearTimeout(pollStartupTimeout);
    pollStartupTimeout = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
