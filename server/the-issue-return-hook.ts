/**
 * The Issue (Client) P1c — weekly return-hook digest assembler.
 *
 * assembleReturnHookDigest builds the PURE-READ portion of the weekly "what came in" digest: leads
 * captured in the trailing 7 days + decisions still waiting on the client. The MONEY section is left
 * null here and filled by the cron (server/return-hook-cron.ts), which owns the computeROI call —
 * computeROI writes a snapshot (not pure-read), so it must not run inside this read-only assembler.
 *
 * Recipient is the client's OWN contact (workspace.clientEmail), so lead names (their own customers)
 * are intentionally included — distinct from the PII-free public ROI/count path (D7). The cron, not
 * this assembler, enforces the feature flag + clientEmail + weekly-idempotency gates.
 *
 * Bounded context: outcomes-roi / The Issue (sibling to server/the-issue-outcome.ts).
 */
import { getWorkspace, resolveSegmentProfile } from './workspaces.js';
import { countFormSubmissions, loadRecentFormSubmissions } from './form-submissions.js';
import { listClientActions } from './client-actions.js';
import { listBatches } from './approvals.js';
import type {
  ReturnHookDigest,
  ReturnHookLeadSection,
  ReturnHookDecisionSection,
} from '../shared/types/the-issue.js';

/** Trailing window for "new this week". Aligns with the weekly cron cadence. */
const RETURN_HOOK_LOOKBACK_DAYS = 7;

/**
 * Assemble the pure-read digest (leads + decisions). `money` is always null here — the cron fills it.
 * Returns null only when the workspace is missing. `hasContent` reflects leads+decisions; the cron
 * recomputes it after adding money.
 */
export function assembleReturnHookDigest(workspaceId: string): ReturnHookDigest | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;

  const outcomeNoun = resolveSegmentProfile(ws).outcomeNounPlural;

  // ── New customers / leads captured in the trailing 7-day window ──
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - RETURN_HOOK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const leadCount = countFormSubmissions(ws.id, { startDate, endDate });
  let leads: ReturnHookLeadSection | null = null;
  if (leadCount > 0) {
    // Newest-first sample (no count query); keep only those inside the window (when in-window count < 3
    // the 3rd row could be older). recentNames is a sample (up to 3), not the full count.
    const recent = loadRecentFormSubmissions(ws.id, 3);
    const recentNames = recent
      .filter((l) => l.submittedAt.slice(0, 10) >= startDate)
      .map((l) => l.leadName ?? l.leadEmail ?? '—');
    leads = { count: leadCount, recentNames, outcomeNoun };
  }

  // ── Decisions still waiting on the client (a week-later nudge, not the original send) ──
  const pendingActions = listClientActions(ws.id).filter((a) => a.status === 'pending').length;
  const pendingBatches = listBatches(ws.id).filter(
    (b) => b.status === 'pending' || b.status === 'partial',
  ).length;
  const pendingCount = pendingActions + pendingBatches;
  const decision: ReturnHookDecisionSection | null = pendingCount > 0 ? { pendingCount } : null;

  const hasContent = !!(leads || decision);
  return { workspaceId: ws.id, leads, money: null, decision, hasContent };
}
