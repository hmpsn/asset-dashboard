export interface SeoField {
  id: string;
  slug: string;
  displayName: string;
  type: string;
}

export interface ApprovalItem {
  id: string;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  field: string;
  collectionId?: string;
  currentValue: string;
  proposedValue: string;
  clientValue?: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CmsItem {
  id: string;
  fieldData: Record<string, unknown>;
}

export interface CmsCollection {
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  seoFields: SeoField[];
  items: CmsItem[];
  total: number;
}

export interface ApprovalBatch {
  id: string;
  name: string;
  items: ApprovalItem[];
}

export interface ApprovalMapItem extends ApprovalItem {
  batchName: string;
  batchId: string;
}

export interface ApprovalPayloadItem {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  field: string;
  collectionId: string;
  currentValue: string;
  proposedValue: string;
}

export function buildInitialEdits(collections: CmsCollection[]): Record<string, Record<string, string>> {
  const editMap: Record<string, Record<string, string>> = {};
  for (const collection of collections) {
    for (const item of collection.items) {
      const fields: Record<string, string> = {};
      for (const seoField of collection.seoFields) {
        fields[seoField.slug] = String(item.fieldData[seoField.slug] || '');
      }
      editMap[item.id] = fields;
    }
  }
  return editMap;
}

export function getExtraSeoFields(seoFields: SeoField[]): SeoField[] {
  return seoFields.filter(field => field.slug !== 'name' && field.slug !== 'slug');
}

export function getTitleAndDescriptionFields(seoFields: SeoField[]): { titleField?: SeoField; descField?: SeoField } {
  const titleField = seoFields.find(field => field.slug.includes('title'));
  const descField = seoFields.find(field => field.slug.includes('description') || field.slug.includes('desc'));
  return { titleField, descField };
}

export function filterAndRankCollectionItems(collection: CmsCollection, search: string): CmsItem[] {
  const query = search.trim().toLowerCase();
  const seoFields = getExtraSeoFields(collection.seoFields);
  const { titleField, descField } = getTitleAndDescriptionFields(seoFields);
  const filteredItems = collection.items.filter(item => {
    if (!query) return true;
    const name = String(item.fieldData.name || '').toLowerCase();
    const slug = String(item.fieldData.slug || '').toLowerCase();
    return name.includes(query) || slug.includes(query);
  });
  return [...filteredItems].sort((a, b) => {
    const scoreA = (!String(a.fieldData.name || '').trim() ? 3 : 0)
      + (titleField && !String(a.fieldData[titleField.slug] || '').trim() ? 2 : 0)
      + (descField && !String(a.fieldData[descField.slug] || '').trim() ? 2 : 0);
    const scoreB = (!String(b.fieldData.name || '').trim() ? 3 : 0)
      + (titleField && !String(b.fieldData[titleField.slug] || '').trim() ? 2 : 0)
      + (descField && !String(b.fieldData[descField.slug] || '').trim() ? 2 : 0);
    return scoreB - scoreA;
  });
}

export function buildItemApprovalMap(approvalBatches: ApprovalBatch[]): Map<string, ApprovalMapItem[]> {
  const map = new Map<string, ApprovalMapItem[]>();
  for (const batch of approvalBatches) {
    for (const item of batch.items) {
      if (!item.collectionId) continue;
      const list = map.get(item.pageId) || [];
      list.push({ ...item, batchName: batch.name, batchId: batch.id });
      map.set(item.pageId, list);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
  return map;
}

export function buildApprovalPayloadItems(
  selectedItemIds: Set<string>,
  edits: Record<string, Record<string, string>>,
  collections: CmsCollection[],
): ApprovalPayloadItem[] {
  const items: ApprovalPayloadItem[] = [];
  for (const itemId of selectedItemIds) {
    const edit = edits[itemId];
    if (!edit) continue;
    let collection: CmsCollection | undefined;
    let originalItem: CmsItem | undefined;
    for (const c of collections) {
      const found = c.items.find(item => item.id === itemId);
      if (found) {
        collection = c;
        originalItem = found;
        break;
      }
    }
    if (!collection || !originalItem) continue;
    const itemName = String(originalItem.fieldData.name || '');
    const itemSlug = String(originalItem.fieldData.slug || '');
    for (const seoField of collection.seoFields) {
      const original = String(originalItem.fieldData[seoField.slug] || '');
      const proposed = edit[seoField.slug] || '';
      if (proposed !== original) {
        items.push({
          pageId: itemId,
          pageTitle: itemName,
          pageSlug: itemSlug,
          field: seoField.slug,
          collectionId: collection.collectionId,
          currentValue: original,
          proposedValue: proposed,
        });
      }
    }
  }
  return items;
}
