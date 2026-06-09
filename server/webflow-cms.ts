/**
 * CMS/collection-related Webflow API functions.
 * Extracted from webflow.ts — collections, items, schema.
 */
import { webflowJson, webflowMutation } from './webflow-client.js';

// --- List CMS collections ---
export async function listCollections(siteId: string, tokenOverride?: string): Promise<Array<{ id: string; displayName: string; slug: string }>> {
  const result = await webflowJson<{ collections?: Array<{ id: string; displayName: string; slug: string }> }>(`/sites/${siteId}/collections`, {}, tokenOverride);
  return result.ok ? result.data.collections || [] : [];
}

// --- Get single CMS item by ID ---
export async function getCollectionItem(collectionId: string, itemId: string, tokenOverride?: string): Promise<Record<string, unknown> | null> {
  const result = await webflowJson<Record<string, unknown>>(`/collections/${collectionId}/items/${itemId}`, {}, tokenOverride);
  return result.ok ? result.data : null;
}

// --- List CMS collection items ---
export async function listCollectionItems(collectionId: string, limit = 100, offset = 0, tokenOverride?: string): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const result = await webflowJson<{ items?: Array<Record<string, unknown>>; pagination?: { total?: number } }>(`/collections/${collectionId}/items?limit=${limit}&offset=${offset}`, {}, tokenOverride);
  if (!result.ok) return { items: [], total: 0 };
  return { items: result.data.items || [], total: result.data.pagination?.total || 0 };
}

// --- Get collection schema ---
export async function getCollectionSchema(collectionId: string, tokenOverride?: string): Promise<{ fields: Array<{ id: string; displayName: string; type: string; slug: string }> }> {
  const result = await webflowJson<{ fields?: Array<{ id: string; displayName: string; type: string; slug: string }> }>(`/collections/${collectionId}`, {}, tokenOverride);
  return { fields: result.ok ? result.data.fields || [] : [] };
}

// --- Create CMS item ---
export async function createCollectionItem(
  collectionId: string,
  fieldData: Record<string, unknown>,
  isDraft: boolean = true,
  tokenOverride?: string
): Promise<{ success: boolean; itemId?: string; error?: string }> {
  try {
    const result = await webflowMutation<{ id?: string }>(`/collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify({ isArchived: false, isDraft, fieldData }),
    }, tokenOverride, 'json');
    if (!result.ok) return { success: false, error: `${result.status}: ${result.errorText}` };
    return { success: true, itemId: result.data.id };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Update CMS item ---
export async function updateCollectionItem(
  collectionId: string,
  itemId: string,
  fieldData: Record<string, unknown>,
  tokenOverride?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await webflowMutation(`/collections/${collectionId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fieldData }),
    }, tokenOverride);
    if (!result.ok) return { success: false, error: `${result.status}: ${result.errorText}` };
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Publish CMS items (make draft changes live) ---
export async function publishCollectionItems(
  collectionId: string,
  itemIds: string[],
  tokenOverride?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await webflowMutation(`/collections/${collectionId}/items/publish`, {
      method: 'POST',
      body: JSON.stringify({ itemIds }),
    }, tokenOverride);
    if (!result.ok) return { success: false, error: `${result.status}: ${result.errorText}` };
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
