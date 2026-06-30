/**
 * publish-schema-to-cms-field — write validated JSON-LD into a CMS collection
 * item's mapped schema field on Webflow.
 *
 * Extracted out of `server/routes/webflow-schema.ts` (it formerly lived inline in
 * the route and the MCP tool imported it FROM the route — a tool→route smell).
 * It now lives in the schema domain so both the admin route and the MCP
 * `publish_schema` tool consume it via `publishSchemaToLive()` with no
 * tool→route coupling. The route re-exports it for backward compatibility.
 *
 * Returns `null` when the page is NOT CMS-backed (no mapped collection/item) so
 * the caller falls through to the static-page custom-code publish path. A
 * non-null SchemaCmsDeliveryStatus carries the CMS write outcome (written /
 * unchanged / blocked / failed).
 */
import { createHash } from 'node:crypto';

import {
  getCollectionSchema,
  getCollectionItem,
  updateCollectionItem,
  publishCollectionItems,
} from '../../webflow.js';
import { getSchemaSnapshot, getSchemaCmsFieldMappings } from '../../schema-store.js';
import type { SchemaCmsDeliveryStatus } from '../../../shared/types/site-inventory.ts';

function schemaHash(schema: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(schema)).digest('hex').slice(0, 16);
}

function sanitizeSchemaJsonForCms(schema: Record<string, unknown>): string {
  return JSON.stringify(schema).replace(/<\/script/gi, '<\\/script');
}

export async function publishSchemaToCmsField(opts: {
  siteId: string;
  pageId: string;
  schema: Record<string, unknown>;
  publishAfter?: boolean;
  token?: string;
}): Promise<SchemaCmsDeliveryStatus | null> {
  const snapshot = getSchemaSnapshot(opts.siteId);
  const page = snapshot?.results.find(r => r.pageId === opts.pageId);
  const collection = page?.generationDiagnostics?.collection;
  if (!collection?.collectionId || !collection.itemId) return null;

  const mappings = getSchemaCmsFieldMappings(opts.siteId);
  const mapping = mappings.find(m => m.collectionId === collection.collectionId);
  const fieldSlug = mapping?.schemaFieldSlug || page?.generationDiagnostics?.cmsDeliveryStatus?.fieldSlug;
  if (!fieldSlug) {
    return {
      mode: 'cms-field',
      status: 'blocked',
      message: `CMS publish blocked: no mapped schema field for collection ${collection.collectionName}.`,
    };
  }
  const collectionSchema = await getCollectionSchema(collection.collectionId, opts.token);
  const mappedField = collectionSchema.fields.find(f => f.slug === fieldSlug);
  if (!mappedField || !['PlainText', 'RichText'].includes(mappedField.type)) {
    return {
      mode: 'cms-field',
      status: 'blocked',
      fieldSlug,
      message: mappedField
        ? `CMS publish blocked: mapped field ${fieldSlug} is ${mappedField.type}, not a text field.`
        : `CMS publish blocked: mapped field ${fieldSlug} was not found on ${collection.collectionName}.`,
    };
  }

  const schemaJson = sanitizeSchemaJsonForCms(opts.schema);
  const hash = schemaHash(opts.schema);
  const currentItem = await getCollectionItem(collection.collectionId, collection.itemId, opts.token);
  const currentFieldData = (currentItem?.fieldData || currentItem || {}) as Record<string, unknown>;
  if (currentFieldData[fieldSlug] === schemaJson) {
    if (opts.publishAfter) {
      const publishResult = await publishCollectionItems(collection.collectionId, [collection.itemId], opts.token);
      if (!publishResult.success) {
        return {
          mode: 'cms-field',
          status: 'failed',
          fieldSlug,
          hash,
          message: publishResult.error || `CMS item publish failed for unchanged ${fieldSlug}.`,
        };
      }
    }
    return {
      mode: 'cms-field',
      status: 'unchanged',
      fieldSlug,
      hash,
      message: opts.publishAfter
        ? `CMS field unchanged: ${fieldSlug}; CMS item published.`
        : `CMS field unchanged: ${fieldSlug}.`,
    };
  }

  const updateResult = await updateCollectionItem(collection.collectionId, collection.itemId, { [fieldSlug]: schemaJson }, opts.token);
  if (!updateResult.success) {
    return {
      mode: 'cms-field',
      status: 'failed',
      fieldSlug,
      hash,
      message: updateResult.error || `CMS field write failed: ${fieldSlug}.`,
    };
  }

  if (opts.publishAfter) {
    const publishResult = await publishCollectionItems(collection.collectionId, [collection.itemId], opts.token);
    if (!publishResult.success) {
      return {
        mode: 'cms-field',
        status: 'failed',
        fieldSlug,
        hash,
        message: publishResult.error || `CMS item publish failed after writing ${fieldSlug}.`,
      };
    }
  }

  return {
    mode: 'cms-field',
    status: 'written',
    fieldSlug,
    hash,
    message: `CMS field written: ${fieldSlug}, hash changed.`,
  };
}
