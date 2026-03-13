// ── Approval domain types ───────────────────────────────────────

export interface ApprovalItem {
  id: string;
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  field: string;              // 'seoTitle' | 'seoDescription' for pages, or CMS field slug
  collectionId?: string;      // present for CMS items
  currentValue: string;
  proposedValue: string;
  clientValue?: string;       // client's edited version (if they modify it)
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  clientNote?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalBatch {
  id: string;
  workspaceId: string;
  siteId: string;
  name: string;
  items: ApprovalItem[];
  status: 'pending' | 'partial' | 'approved' | 'applied';
  createdAt: string;
  updatedAt: string;
}
