/**
 * Deliverable adapter registry barrel.
 *
 * Each Phase-1 type PR appends ONE line here: `import './<type>.js';` (append-only,
 * the only shared edit across the parallel type PRs). Importing this module triggers
 * each adapter's module-scope `registerAdapter()` call, populating the registry in
 * `./types.js`.
 *
 * Re-export the registry surface so callers `import { getAdapter } from '.../deliverable-adapters/index.js'`
 * and get a fully-populated registry (the adapter imports above have run first).
 */

// --- Adapter registrations ---
// approval_batch family (seo_edit / audit_issue / schema_item / content_plan_*).
import './seo-edit.js';
import './audit-issue.js';
import './schema-item.js';
import './content-plan-sample.js';
import './content-plan-template.js';
// client_action family (redirect / internal_link / aeo_change / content_decay).
import './redirect.js';
import './internal-link.js';
import './aeo-change.js';
import './content-decay.js';
import './cannibalization.js';
// schema_plan (the per-site schema STRATEGY review artifact — distinct from the PR-1a
// schema_item per-page batches).
import './schema-plan.js';
// copy_section — projected type. Its source tables (copy_sections, copy_metadata) are retained;
// the adapter exposes a copy entry through the unified interface at read time via
// `projectFromSource()` (no dual-write, no backfill).
import './copy-section.js';
// content_request — projected type. Its source table (content_topic_requests) is retained; the
// adapter exposes a content request (brief/post review) through the unified interface at read
// time via `projectFromSource()` (no dual-write, no backfill).
import './content-request.js';
// work_order (kind='order') + briefing (kind='notification') are the final physical types.
// work_order is dual-written at the createWorkOrder/updateWorkOrder seams; briefing at the
// publish seams (manual + auto).
import './work-order.js';
import './briefing.js';
// recommendation — the Strategy "The Issue" close-the-loop type. Minted by
// mirrorRecommendationToDeliverable at the rec /send (per-row + bulk) seam; respond-only
// (D-apply). The canonical client decision flows through the public act-on route, not the
// deliverable respond path.
import './recommendation.js';
// Google Business Profile review response approval artifact. Source of truth remains
// google_business_review_responses; this adapter only mirrors client decisions back to it.
import './gbp-review-response.js';
// Grounded brand-generation review bundles. Decisions are committed atomically by
// the brand review service rather than the generic mirror-first response path.
import './brand-generation.js';

export {
  registerAdapter,
  getAdapter,
  tryGetAdapter,
  listAdapterTypes,
  type DeliverableAdapter,
  type BuiltDeliverablePayload,
  type SendableResult,
} from './types.js';
