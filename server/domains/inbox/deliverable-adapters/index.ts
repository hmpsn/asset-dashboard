/**
 * Deliverable adapter registry barrel (Phase 0, dark — empty).
 *
 * Each Phase-1 type PR appends ONE line here: `import './<type>.js';` (append-only,
 * the only shared edit across the parallel type PRs). Importing this module triggers
 * each adapter's module-scope `registerAdapter()` call, populating the registry in
 * `./types.js`. Phase 0 ships zero adapters — the send path is dark until the flags flip.
 *
 * Re-export the registry surface so callers `import { getAdapter } from '.../deliverable-adapters/index.js'`
 * and get a fully-populated registry (the adapter imports above have run first).
 */

// --- Phase-1 adapter registrations go below this line (append-only) ---
// PR-1a: approval_batch family (seo_edit / audit_issue / schema_item / content_plan_*).
// DARK — these self-register on import but are only mirrored when the
// `unified-deliverables-approval-family` flag is on (default off → no-op).
import './seo-edit.js';
import './audit-issue.js';
import './schema-item.js';
import './content-plan-sample.js';
import './content-plan-template.js';
// PR-1b: client_action family (redirect / internal_link / aeo_change / content_decay).
// DARK — these self-register on import but are only mirrored when the
// `unified-deliverables-broken-family` flag is on (default off → no-op).
import './redirect.js';
import './internal-link.js';
import './aeo-change.js';
import './content-decay.js';
// PR-1c: schema_plan (the per-site schema STRATEGY review artifact — distinct from the
// PR-1a schema_item per-page batches). DARK — self-registers on import but is only mirrored
// when the `unified-deliverables-rest` flag is on (default off → no-op).
import './schema-plan.js';

export {
  registerAdapter,
  getAdapter,
  tryGetAdapter,
  listAdapterTypes,
  type DeliverableAdapter,
  type BuiltDeliverablePayload,
  type SendableResult,
} from './types.js';
