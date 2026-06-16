/**
 * cannibalization deliverable adapter (Strategy Phase 3b-ii).
 *
 * Claims the legacy `client_actions` rows with sourceType `cannibalization` (the Strategy
 * page's keyword-cannibalization triage "Send to client" flow — src/components/strategy/
 * CannibalizationTriage.tsx). Like content_decay, a cannibalization issue is a SINGLE inline
 * decision (one keyword's competing pages + the recommended consolidation), so kind = 'decision'.
 * The keyword + competing pages + recommendation + canonicalPath ride in
 * `client_deliverable.payload` JSON as the single decision item (design §4.1 scoping).
 *
 * sourceRef = `cannibalization:<keyword>` (the stable per-keyword key, mirroring the 3b-i
 * cannibalizationSourceId), read from `payload.metadata.origin.targetKeyword`. A re-send of the
 * same keyword dedupes onto one row.
 *
 * validateSendable: the action MUST carry a targetKeyword (origin) — a cannibalization send with
 * no keyword to consolidate is not a sendable decision.
 *
 * Apply stays DISABLED (D-apply) — a permanent no-op for this family: consolidating cannibalizing
 * pages (canonical tag / 301 / differentiate / noindex) is a manual operator/agency action.
 */
import { registerAdapter, type DeliverableAdapter } from './types.js';
import {
  type ClientActionInput,
  applyDisabledStub,
  buildClientActionPayload,
  originTargetKeyword,
  respondToClientActionSource,
} from './client-action-shared.js';
import type { CannibalizationPayload } from '../../../../shared/types/client-actions.js';

/** Build the single decision item (the issue) from the action payload. */
function cannibalizationIssue(input: ClientActionInput): CannibalizationPayload {
  const p = input.action.payload as Partial<CannibalizationPayload>;
  return {
    keyword: typeof p.keyword === 'string' ? p.keyword : (originTargetKeyword(input.action) ?? ''),
    pages: Array.isArray(p.pages) ? p.pages : [],
    recommendation: typeof p.recommendation === 'string' ? p.recommendation : input.action.summary,
    canonicalPath: typeof p.canonicalPath === 'string' ? p.canonicalPath : undefined,
  };
}

export const cannibalizationAdapter: DeliverableAdapter<ClientActionInput> = {
  type: 'cannibalization',
  // A cannibalization action with no targetKeyword is NOT sendable (mirrors content_decay's B13).
  validateSendable: ({ action }) => {
    const keyword = originTargetKeyword(action);
    if (!keyword) {
      return { ok: false, reason: 'cannibalization action has no targetKeyword' };
    }
    return { ok: true };
  },
  // Single inline decision: the issue (keyword + competing pages + recommendation) is the sole item.
  buildPayload: (input) =>
    buildClientActionPayload('cannibalization', input.action, [cannibalizationIssue(input)], 'page'),
  // Stable per-keyword key: cannibalization:<keyword>. Falls back to the raw sourceId only for a
  // malformed row missing the origin keyword (which validateSendable rejects before insert).
  sourceRef: (input) => {
    const kw = originTargetKeyword(input.action);
    return kw ? `cannibalization:${kw}` : input.action.sourceId ?? null;
  },
  // R2: propagate the client decision back to the legacy client_action. Source path owns the email.
  respondToSource: respondToClientActionSource,
  // apply opt-out — D-apply (permanent for this family). Stub throws if ever reached.
  applyDeliverable: applyDisabledStub,
};

registerAdapter(cannibalizationAdapter as DeliverableAdapter);
