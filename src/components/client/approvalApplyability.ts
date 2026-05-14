import type { ApprovalBatch, ApprovalItem } from './types';

const STATIC_APPLY_FIELDS = new Set(['seoTitle', 'seoDescription']);
const CMS_NON_SEO_FIELDS = new Set(['name', 'slug']);

function isCmsSeoApplyField(field: string): boolean {
  const normalized = field.trim().toLowerCase();
  return normalized.length > 0 && !CMS_NON_SEO_FIELDS.has(normalized);
}

export function isClientApplyableApprovalItem(item: ApprovalItem): boolean {
  if (!item.field || item.pageId.startsWith('cms-')) return false;
  if (item.collectionId) return isCmsSeoApplyField(item.field);
  return STATIC_APPLY_FIELDS.has(item.field);
}

export function isClientApplyableBatch(batch: ApprovalBatch): boolean {
  return batch.items.length > 0 && batch.items.every(isClientApplyableApprovalItem);
}
