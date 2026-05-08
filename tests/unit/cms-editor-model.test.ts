import { describe, expect, it } from 'vitest';
import {
  buildApprovalPayloadItems,
  buildInitialEdits,
  buildItemApprovalMap,
  filterAndRankCollectionItems,
  type ApprovalBatch,
  type CmsCollection,
} from '../../src/components/cms-editor/cmsEditorModel';

const baseCollection: CmsCollection = {
  collectionId: 'coll-1',
  collectionName: 'Blog Posts',
  collectionSlug: 'blog',
  seoFields: [
    { id: 'f-1', slug: 'name', displayName: 'Name', type: 'PlainText' },
    { id: 'f-2', slug: 'slug', displayName: 'Slug', type: 'PlainText' },
    { id: 'f-3', slug: 'seo-title', displayName: 'SEO Title', type: 'PlainText' },
    { id: 'f-4', slug: 'meta-description', displayName: 'Meta Description', type: 'PlainText' },
  ],
  items: [
    { id: 'item-1', fieldData: { name: 'Alpha', slug: 'alpha', 'seo-title': 'Alpha Title', 'meta-description': 'Alpha Desc' } },
    { id: 'item-2', fieldData: { name: '', slug: 'beta', 'seo-title': '', 'meta-description': '' } },
    { id: 'item-3', fieldData: { name: 'Gamma', slug: 'gamma', 'seo-title': '', 'meta-description': 'Gamma Desc' } },
  ],
  total: 3,
};

describe('cmsEditorModel', () => {
  it('buildInitialEdits maps seo fields per item', () => {
    const edits = buildInitialEdits([baseCollection]);

    expect(edits['item-1']).toEqual({
      name: 'Alpha',
      slug: 'alpha',
      'seo-title': 'Alpha Title',
      'meta-description': 'Alpha Desc',
    });
    expect(edits['item-2']).toEqual({
      name: '',
      slug: 'beta',
      'seo-title': '',
      'meta-description': '',
    });
  });

  it('filterAndRankCollectionItems filters by name/slug and ranks missing SEO fields first', () => {
    const searchResults = filterAndRankCollectionItems(baseCollection, 'gaM');
    expect(searchResults.map(item => item.id)).toEqual(['item-3']);

    const ranked = filterAndRankCollectionItems(baseCollection, '');
    expect(ranked.map(item => item.id)).toEqual(['item-2', 'item-3', 'item-1']);
  });

  it('buildItemApprovalMap keeps only CMS approvals and sorts latest first', () => {
    const approvalBatches: ApprovalBatch[] = [
      {
        id: 'batch-1',
        name: 'Older batch',
        items: [
          {
            id: 'a-1',
            pageId: 'item-1',
            pageTitle: 'Alpha',
            pageSlug: 'alpha',
            field: 'seo-title',
            collectionId: 'coll-1',
            currentValue: 'Old',
            proposedValue: 'Older',
            status: 'pending',
            createdAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:00:00.000Z',
          },
          {
            id: 'a-ignore',
            pageId: 'static-page',
            pageTitle: 'Static',
            pageSlug: 'static',
            field: 'seoTitle',
            currentValue: 'Current',
            proposedValue: 'Proposed',
            status: 'pending',
            createdAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:00:00.000Z',
          },
        ],
      },
      {
        id: 'batch-2',
        name: 'Newer batch',
        items: [
          {
            id: 'a-2',
            pageId: 'item-1',
            pageTitle: 'Alpha',
            pageSlug: 'alpha',
            field: 'meta-description',
            collectionId: 'coll-1',
            currentValue: 'Desc',
            proposedValue: 'New desc',
            status: 'approved',
            createdAt: '2026-05-08T00:00:00.000Z',
            updatedAt: '2026-05-08T00:00:00.000Z',
          },
        ],
      },
    ];

    const map = buildItemApprovalMap(approvalBatches);
    const approvals = map.get('item-1');

    expect(approvals?.map(item => item.id)).toEqual(['a-2', 'a-1']);
    expect(map.has('static-page')).toBe(false);
  });

  it('buildApprovalPayloadItems includes only changed fields from selected items', () => {
    const edits = buildInitialEdits([baseCollection]);
    edits['item-1']['seo-title'] = 'New title';
    edits['item-1']['meta-description'] = 'Alpha Desc';
    edits['item-2']['name'] = 'Beta';

    const payload = buildApprovalPayloadItems(new Set(['item-1', 'item-2']), edits, [baseCollection]);

    expect(payload).toEqual([
      {
        pageId: 'item-1',
        pageTitle: 'Alpha',
        pageSlug: 'alpha',
        field: 'seo-title',
        collectionId: 'coll-1',
        currentValue: 'Alpha Title',
        proposedValue: 'New title',
      },
      {
        pageId: 'item-2',
        pageTitle: '',
        pageSlug: 'beta',
        field: 'name',
        collectionId: 'coll-1',
        currentValue: '',
        proposedValue: 'Beta',
      },
    ]);
  });
});
