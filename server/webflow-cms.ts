/**
 * CMS/collection-related Webflow API functions.
 * Extracted from webflow.ts — collections, items, schema.
 */
import { webflowFetch } from './webflow-client.js';

// --- List CMS collections ---
export async function listCollections(siteId: string, tokenOverride?: string): Promise<Array<{ id: string; displayName: string; slug: string }>> {
  const res = await webflowFetch(`/sites/${siteId}/collections`, {}, tokenOverride);
  if (!res.ok) return [];
  const data = await res.json() as { collections?: Array<{ id: string; displayName: string; slug: string }> };
  return data.collections || [];
}

// --- Get single CMS item by ID ---
export async function getCollectionItem(collectionId: string, itemId: string, tokenOverride?: string): Promise<Record<string, unknown> | null> {
  const res = await webflowFetch(`/collections/${collectionId}/items/${itemId}`, {}, tokenOverride);
  if (!res.ok) return null;
  return await res.json() as Record<string, unknown>;
}

// --- List CMS collection items ---
export async function listCollectionItems(collectionId: string, limit = 100, offset = 0, tokenOverride?: string): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
  const res = await webflowFetch(`/collections/${collectionId}/items?limit=${limit}&offset=${offset}`, {}, tokenOverride);
  if (!res.ok) return { items: [], total: 0 };
  const data = await res.json() as { items?: Array<Record<string, unknown>>; pagination?: { total?: number } };
  return { items: data.items || [], total: data.pagination?.total || 0 };
}

// --- Get collection schema ---
export async function getCollectionSchema(collectionId: string, tokenOverride?: string): Promise<{ fields: Array<{ id: string; displayName: string; type: string; slug: string }> }> {
  const res = await webflowFetch(`/collections/${collectionId}`, {}, tokenOverride);
  if (!res.ok) return { fields: [] };
  const data = await res.json() as { fields?: Array<{ id: string; displayName: string; type: string; slug: string }> };
  return { fields: data.fields || [] };
}

// --- Create CMS item ---
export async function createCollectionItem(
  collectionId: string,
  fieldData: Record<string, unknown>,
  isDraft: boolean = true,
  tokenOverride?: string
): Promise<{ success: boolean; itemId?: string; error?: string }> {
  try {
    const res = await webflowFetch(`/collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify({ isArchived: false, isDraft, fieldData }),
    }, tokenOverride);
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `${res.status}: ${err}` };
    }
    const data = await res.json() as { id?: string };
    return { success: true, itemId: data.id };
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
    const res = await webflowFetch(`/collections/${collectionId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fieldData }),
    }, tokenOverride);
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `${res.status}: ${err}` };
    }
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
    const res = await webflowFetch(`/collections/${collectionId}/items/publish`, {
      method: 'POST',
      body: JSON.stringify({ itemIds }),
    }, tokenOverride);
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `${res.status}: ${err}` };
    }
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
