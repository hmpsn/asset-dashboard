/**
 * publish-schema-to-live — the single shared domain service for publishing
 * JSON-LD schema to a live Webflow site.
 *
 * BEFORE this module existed there were TWO drifted publish paths:
 *   1. the admin route POST /api/webflow/schema-publish/:siteId (full follow-ons)
 *   2. the MCP `publish_schema` tool (a subset — it OMITTED recordSeoChange,
 *      llms.txt regeneration, and the rec-regen follow-on, and imported
 *      publishSchemaToCmsField straight from the route module).
 *
 * Both now call `publishSchemaToLive()` so the side-effect set can never drift
 * again. This mirrors `server/domains/content/on-content-request-live.ts`:
 * a leaf domain service shared by a route + an MCP tool, with every best-effort
 * follow-on self-guarded so one failure can't abort the publish.
 *
 * The CALLER owns validation + request/response shaping. This service takes
 * already-resolved inputs (siteId, pageId, validated schema, workspaceId, token)
 * and performs ONLY the publish + the post-publish follow-ons.
 *
 * Publish ordering (mirrors the historical admin route):
 *   1. CMS-field write first (publishSchemaToCmsField) — when the page is
 *      CMS-backed and has a mapped schema field.
 *   2. Static-page custom-code injection fallback (publishSchemaToPage) when the
 *      page is not CMS-backed.
 * On success the canonical follow-on set runs (each best-effort step in its own
 * try/catch):
 *   updatePageSchemaInSnapshot → recordSchemaPublish → updatePageState(live) →
 *   recordSeoChange → outcome tracking (idempotent) → queueLlmsTxtRegeneration →
 *   queueKeywordStrategyPostUpdateFollowOns → invalidateIntelligenceCache →
 *   broadcast(SCHEMA_SNAPSHOT_UPDATED) → addActivity.
 */
import { broadcastToWorkspace } from '../../broadcast.js';
import { WS_EVENTS } from '../../ws-events.js';
import { addActivity } from '../../activity-log.js';
import { updatePageSchemaInSnapshot, recordSchemaPublish } from '../../schema-store.js';
import { publishSchemaToCmsField } from './publish-schema-to-cms-field.js';
// Import the live-publish primitives from the webflow.js barrel (NOT directly
// from webflow-pages.js) so they resolve through the same module the admin route
// and existing tests mock. webflow.js re-exports these from webflow-pages.js.
import { publishSchemaToPage, publishSite } from '../../webflow.js';
import { getWorkspaceBySiteId, updatePageState } from '../../workspaces.js';
import { recordSeoChange } from '../../seo-change-tracker.js';
import { queueLlmsTxtRegeneration } from '../../llms-txt-generator.js';
import { queueKeywordStrategyPostUpdateFollowOns } from '../../keyword-strategy-follow-ons.js';
import { recordAction, getActionByWorkspaceAndSource } from '../../outcome-tracking.js';
import { captureBaselineFromGsc } from '../../outcome-measurement.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { normalizePageUrl } from '../../utils/page-address.js';
import { createLogger } from '../../logger.js';

// Re-export so the rest of the codebase has a single canonical home for the CMS
// publish helper. The admin route also re-exports it for backward compatibility.
export { publishSchemaToCmsField } from './publish-schema-to-cms-field.js';

const log = createLogger('schema:publish-to-live');

export interface PublishSchemaToLiveInput {
  siteId: string;
  pageId: string;
  /** The already-VALIDATED JSON-LD to publish. Validation is the caller's job. */
  schema: Record<string, unknown>;
  /** Resolved workspace id. Pass the empty string only when the site has no workspace. */
  workspaceId: string;
  /** Per-site Webflow token (resolved by the caller via getTokenForSite). */
  token?: string;
  /** Page title for the seo-change record / activity log. */
  pageTitle?: string;
  /** Published path or page slug for the seo-change record + outcome baseline. */
  publishedPath?: string;
  /** Whether to publish the Webflow site / CMS item after writing (go live). */
  publishAfter?: boolean;
}

/** Discriminated publish result so each caller can shape its own response. */
export type PublishSchemaToLiveResult =
  | {
      ok: true;
      mode: 'cms-field' | 'page-custom-code';
      /** Delivery status string from the underlying publish path. */
      deliveryStatus: string;
      deliveryMessage: string;
      /** CMS-field delivery detail (only when mode === 'cms-field'). */
      cmsDelivery?: import('../../../shared/types/site-inventory.ts').SchemaCmsDeliveryStatus;
      /** Static-page publish detail (only when mode === 'page-custom-code'). */
      pageResult?: import('../../../shared/types/schema-generation.js').SchemaPublishResponse;
      /** Whether the site / CMS item was actually published live. */
      published: boolean;
      /** Whether the Webflow site publish call ran (static path only). */
      sitePublished: boolean;
    }
  | {
      /**
       * The publish could not complete automatically. `kind` distinguishes a
       * hard failure (CMS blocked/failed, static failure) from a manual-required
       * fallback (Webflow native-schema-field) so callers can choose an HTTP
       * status / message. No follow-ons ran.
       */
      ok: false;
      kind: 'cms-blocked' | 'cms-failed' | 'page-failed' | 'manual-required';
      message: string;
      /** Present for cms-blocked / cms-failed so callers can echo the CMS status. */
      cmsDelivery?: import('../../../shared/types/site-inventory.ts').SchemaCmsDeliveryStatus;
      /** Present for the manual-required / page-failed paths so callers can echo it. */
      pageResult?: import('../../../shared/types/schema-generation.js').SchemaPublishResponse;
    };

/**
 * Idempotent outcome-tracking write for a schema deploy. Guarded against
 * duplicates (re-deploys/double-clicks) via getActionByWorkspaceAndSource, and
 * wrapped so a tracking failure never aborts the publish. Mirrors both branches
 * of the historical admin route.
 */
function recordSchemaOutcomeAction(workspaceId: string, pageId: string, pageUrl: string): void {
  try {
    if (getActionByWorkspaceAndSource(workspaceId, 'schema', pageId)) return;
    const schemaAction = recordAction({ // recordAction-ok: only reached via runPostPublishFollowOns, which early-returns on falsy workspaceId
      workspaceId,
      actionType: 'schema_deployed',
      sourceType: 'schema',
      sourceId: pageId,
      pageUrl: pageUrl || null,
      targetKeyword: null,
      baselineSnapshot: {
        captured_at: new Date().toISOString(),
        rich_result_eligible: true,
        rich_result_appearing: false,
      },
      attribution: 'platform_executed',
      // R6 (B11): no `source` — a schema deploy is a PAGE-ref (sourceId = pageId) with no
      // ephemeral titled producer. The generic label ("Deployed structured data") is the
      // honest display (FM-2: never fabricate a title). Columns stay NULL.
    });
    if (pageUrl) void captureBaselineFromGsc(schemaAction.id, workspaceId, pageUrl);
  } catch (err) {
    log.warn({ err, workspaceId, pageId }, 'Failed to record outcome action for schema deployment');
  }
}

/**
 * Run the canonical post-publish follow-on set. Every step that is allowed to
 * fail without aborting the publish is wrapped in its own try/catch so one
 * follow-on failure cannot poison the others (mirrors on-content-request-live
 * and the historical route guards).
 *
 * `seoChangeSource` differs by publish path ('schema-cms-field' vs 'schema') to
 * preserve the historical seo-change provenance string.
 */
function runPostPublishFollowOns(
  input: PublishSchemaToLiveInput,
  workspaceId: string,
  normalizedPath: string,
  seoChangeSource: 'schema' | 'schema-cms-field',
): void {
  if (!workspaceId) return;

  // Persist + version history. These two are core (not best-effort) — they are
  // the durable record of the publish, so a throw here surfaces to the caller's
  // catch rather than being swallowed.
  const snapshotUpdated = updatePageSchemaInSnapshot(input.siteId, input.pageId, input.schema);
  recordSchemaPublish(input.siteId, input.pageId, workspaceId, input.schema);
  updatePageState(workspaceId, input.pageId, {
    status: 'live',
    source: 'schema',
    fields: ['schema'],
    updatedBy: 'admin',
  });

  // Broadcast only when the snapshot actually changed (mirrors the route).
  if (snapshotUpdated) {
    broadcastToWorkspace(workspaceId, WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED, {
      siteId: input.siteId,
      action: 'published',
      pageId: input.pageId,
    });
  }

  // ── Best-effort follow-ons (each self-guarded) ──
  try {
    recordSeoChange(workspaceId, input.pageId, normalizedPath, input.pageTitle || '', ['schema'], seoChangeSource);
  } catch (err) {
    log.warn({ err, workspaceId, pageId: input.pageId }, 'recordSeoChange failed after schema publish');
  }

  recordSchemaOutcomeAction(workspaceId, input.pageId, normalizedPath);

  try {
    queueLlmsTxtRegeneration(workspaceId, 'schema_published');
  } catch (err) {
    log.warn({ err, workspaceId }, 'queueLlmsTxtRegeneration failed after schema publish');
  }

  try {
    // Schema deploy changes page SEO signals so recommendations should reflect
    // the new state. The shared regen scheduler dedupes per-workspace execution.
    queueKeywordStrategyPostUpdateFollowOns({ workspaceId }); // rec-refresh-ok
  } catch (err) {
    log.warn({ err, workspaceId }, 'queueKeywordStrategyPostUpdateFollowOns failed after schema publish');
  }

  invalidateIntelligenceCache(workspaceId);
}

/**
 * Publish validated JSON-LD schema to the live site (CMS-field first, then
 * static-page custom-code), then run the canonical follow-on set. The CALLER
 * must validate the schema first and shape the response.
 *
 * Returns a discriminated result; on `ok: false` NO follow-ons have run.
 */
export async function publishSchemaToLive(
  input: PublishSchemaToLiveInput,
): Promise<PublishSchemaToLiveResult> {
  const { siteId, pageId, schema, token } = input;
  // Resolve the workspace id once. Prefer the caller-provided id; fall back to a
  // site lookup so a route that passed '' (no workspace known yet) still records.
  const workspaceId = input.workspaceId || getWorkspaceBySiteId(siteId)?.id || '';
  const normalizedPath = input.publishedPath ? normalizePageUrl(input.publishedPath) : '';

  // ── 1. CMS-field write first ──
  const cmsDelivery = await publishSchemaToCmsField({
    siteId,
    pageId,
    schema,
    publishAfter: input.publishAfter ?? false,
    token,
  });

  if (cmsDelivery) {
    if (cmsDelivery.status === 'blocked') {
      return { ok: false, kind: 'cms-blocked', message: cmsDelivery.message, cmsDelivery };
    }
    if (cmsDelivery.status === 'failed') {
      return { ok: false, kind: 'cms-failed', message: cmsDelivery.message, cmsDelivery };
    }
    runPostPublishFollowOns(input, workspaceId, normalizedPath, 'schema-cms-field');
    if (workspaceId) {
      addActivity(
        workspaceId,
        'schema_published',
        'Schema written to CMS field',
        cmsDelivery.message,
        { source: 'schema-publish', siteId, pageId, mode: 'cms-field' },
      );
    }
    return {
      ok: true,
      mode: 'cms-field',
      deliveryStatus: cmsDelivery.status,
      deliveryMessage: cmsDelivery.message,
      cmsDelivery,
      published: input.publishAfter ?? false,
      sitePublished: false,
    };
  }

  // ── 2. Static-page custom-code fallback ──
  const pageResult = await publishSchemaToPage(siteId, pageId, schema, token);
  if (pageResult.delivery.status === 'manual-required') {
    return { ok: false, kind: 'manual-required', message: pageResult.delivery.message, pageResult };
  }
  if (!pageResult.success) {
    return {
      ok: false,
      kind: 'page-failed',
      message: pageResult.error || 'Webflow rejected the schema script.',
      pageResult,
    };
  }

  // Optionally publish the site so changes go live (non-fatal on failure).
  let sitePublished = false;
  if (input.publishAfter) {
    try {
      const pubResult = await publishSite(siteId, token);
      sitePublished = pubResult.success;
      if (!pubResult.success) log.error({ detail: pubResult.error, siteId }, 'Site publish failed');
    } catch (err) {
      log.warn({ err, siteId }, 'publishSite threw after schema write');
    }
  }

  runPostPublishFollowOns(input, workspaceId, normalizedPath, 'schema');
  if (workspaceId) {
    addActivity(
      workspaceId,
      'schema_published',
      'Schema published to Webflow',
      `Page ${pageId.slice(0, 8)}… — ${sitePublished ? 'site published' : 'saved as draft'}`,
      { source: 'schema-publish', siteId, pageId, mode: 'page-custom-code' },
    );
  }

  return {
    ok: true,
    mode: 'page-custom-code',
    deliveryStatus: pageResult.delivery.status,
    deliveryMessage: pageResult.delivery.message,
    pageResult,
    published: pageResult.published ?? true,
    sitePublished,
  };
}
