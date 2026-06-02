/**
 * shared/applyability.ts — the SINGLE source of truth for "can the client apply this to the
 * live website?" (R3b — Apply to Website, DARK).
 *
 * Pure string logic, no server/client-only imports, so it is safe to import from both the
 * server route gate and the client UI (the same predicate must drive both halves).
 *
 * IMPORTANT — this predicate intentionally mirrors the LEGACY ROUTE GATE
 * (server/routes/approvals.ts `POST .../apply`, which keys on field / pageId / collectionId),
 * NOT the per-item `ClientDeliverableItem.applyable` column. That column is deliberately
 * hardcoded `false` for the entire approval family under D-apply (it gates the disabled
 * `applyDeliverable` opt-in path — see `applyDisabledStub` in approval-batch-shared.ts).
 *
 * R3b's client "Apply to Website" is a SEPARATE path: it calls the proven legacy
 * `/api/public/approvals/:workspaceId/:batchId/apply` route, which itself ignores the
 * `applyable` column and gates on field/pageId/collectionId. So the unified predicate must
 * match the ROUTE, not the column — a `seo_edit` deliverable whose items all carry
 * `applyable:false` is still client-applyable through this path (see the unit test that
 * asserts exactly this divergence).
 */

/**
 * The minimal applyability inputs shared by the legacy `ApprovalItem` (field/pageId/collectionId)
 * and the unified `ClientDeliverableItem` (field/targetRef/collectionId). Callers map their own
 * shape onto this: `pageId` → `targetRef` for the unified model.
 */
export interface ApplyableFields {
  field: string | null;
  targetRef: string | null;
  collectionId: string | null;
}

/** Static page SEO fields the legacy route can write via updatePageSeo. */
const STATIC_APPLY_FIELDS = new Set(['seoTitle', 'seoDescription']);
/** CMS fields that are NOT SEO metadata — the legacy route refuses to write these. */
const CMS_NON_SEO_FIELDS = new Set(['name', 'slug']);

/**
 * A CMS collection field is applicable iff it is a non-empty field that is NOT one of the
 * structural CMS fields (`name`/`slug`). Mirrors the legacy route's `isCmsSeoApprovalField`.
 */
export function isCmsSeoApplyField(field: string): boolean {
  const n = field.trim().toLowerCase();
  return n.length > 0 && !CMS_NON_SEO_FIELDS.has(n);
}

/**
 * The blessed applyability check, keyed exactly like the legacy route gate:
 *   - no field, or a synthetic `cms-` targetRef → not applyable (synthetic ids 404 in Webflow)
 *   - real CMS item (collectionId present)      → any SEO field (not name/slug)
 *   - static page (no collectionId)             → seoTitle / seoDescription only
 */
export function isClientApplyableFields(f: ApplyableFields): boolean {
  if (!f.field || (f.targetRef?.startsWith('cms-') ?? false)) return false;
  if (f.collectionId) return isCmsSeoApplyField(f.field);
  return STATIC_APPLY_FIELDS.has(f.field);
}

/** Unified-model item predicate (maps `targetRef` onto the shared shape). */
export function isClientApplyableDeliverableItem(item: {
  field: string | null;
  targetRef: string | null;
  collectionId: string | null;
}): boolean {
  return isClientApplyableFields(item);
}

/**
 * A unified deliverable is client-applyable iff it has at least one item and EVERY item is
 * applyable (matches the legacy batch gate: the route rejects the whole batch if any approved
 * item is non-applyable).
 */
export function isClientApplyableDeliverableBatch(
  items: Array<{ field: string | null; targetRef: string | null; collectionId: string | null }>,
): boolean {
  return items.length > 0 && items.every(isClientApplyableDeliverableItem);
}
