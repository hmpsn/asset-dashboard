import { describe, expect, it } from 'vitest';

import { resolveSeoEditorWriteTargets } from '../../src/components/editor/seoWriteTargetResolver';
import type { CmsCollection } from '../../src/components/cms-editor/cmsEditorModel';
import type { PageMeta } from '../../src/hooks/admin/useSeoEditor';
import { SEO_EDITOR_TARGET_TYPES } from '../../shared/types/seo-editor-write-target';

const pages: PageMeta[] = [
  {
    id: 'page-services-invisalign',
    title: 'Invisalign',
    slug: 'invisalign',
    publishedPath: '/services/invisalign/',
    source: 'static',
    seo: { title: 'Static Invisalign', description: 'Static description' },
  },
  {
    id: 'cms-services-invisalign',
    title: 'Invisalign CMS',
    slug: 'services/invisalign',
    publishedPath: '/services/invisalign',
    source: 'cms',
    seo: { title: 'Sitemap title', description: 'Sitemap description' },
  },
  {
    id: 'cms-case-studies-missing',
    title: 'Missing Case Study',
    slug: 'case-studies/missing',
    publishedPath: '/case-studies/missing/',
    source: 'cms',
  },
];

const collections: CmsCollection[] = [
  {
    collectionId: 'collection-services',
    collectionName: 'Services',
    collectionSlug: 'services',
    seoFields: [
      { id: 'name', slug: 'name', displayName: 'Name', type: 'PlainText' },
      { id: 'slug', slug: 'slug', displayName: 'Slug', type: 'PlainText' },
      { id: 'seo-title', slug: 'seo-title', displayName: 'SEO Title', type: 'PlainText' },
      { id: 'meta-description', slug: 'meta-description', displayName: 'Meta Description', type: 'PlainText' },
    ],
    items: [
      {
        id: 'item-invisalign',
        fieldData: {
          name: 'Invisalign',
          slug: 'invisalign',
          'seo-title': 'CMS Invisalign',
          'meta-description': 'CMS description',
        },
      },
    ],
    total: 1,
  },
];

describe('resolveSeoEditorWriteTargets', () => {
  it('keeps nested static paths canonical instead of collapsing to the leaf slug', () => {
    const result = resolveSeoEditorWriteTargets({ pages, collections });
    const target = result.staticTargets.find(item => item.id === 'page-services-invisalign');

    expect(target?.targetType).toBe(SEO_EDITOR_TARGET_TYPES.staticPage);
    expect(target?.canonicalPath).toBe('/services/invisalign');
    expect(target?.rawSlug).toBe('invisalign');
  });

  it('resolves real CMS collection items with collection and item identity', () => {
    const result = resolveSeoEditorWriteTargets({ pages, collections });
    const target = result.cmsTargets.find(item => item.id === 'item-invisalign');

    expect(target).toMatchObject({
      targetType: SEO_EDITOR_TARGET_TYPES.cmsItem,
      collectionId: 'collection-services',
      collectionName: 'Services',
      itemId: 'item-invisalign',
      canonicalPath: '/services/invisalign',
      seo: {
        title: 'CMS Invisalign',
        description: 'CMS description',
      },
    });
  });

  it('falls back to CMS item name when SEO title field is present but blank', () => {
    const result = resolveSeoEditorWriteTargets({
      pages: [],
      collections: [{
        ...collections[0],
        items: [{
          id: 'item-blank-seo-title',
          fieldData: {
            name: 'Fallback Name Title',
            slug: 'fallback-name-title',
            'seo-title': '',
            'meta-description': 'Meta present',
          },
        }],
      }],
    });
    const target = result.cmsTargets.find(item => item.id === 'item-blank-seo-title');
    expect(target?.seo.title).toBe('Fallback Name Title');
  });

  it('does not create a manual target when a trailing-slash sitemap row matches a real CMS item', () => {
    const result = resolveSeoEditorWriteTargets({
      pages: [
        {
          id: 'cms-services-invisalign-trailing',
          title: 'Invisalign CMS',
          slug: 'services/invisalign',
          publishedPath: '/services/invisalign/',
          source: 'cms',
        },
      ],
      collections,
    });

    expect(result.manualTargets).toHaveLength(0);
  });

  it('keeps sitemap-only CMS rows manual and non-writable', () => {
    const result = resolveSeoEditorWriteTargets({ pages, collections });
    const target = result.manualTargets.find(item => item.id === 'manual:cms-case-studies-missing');

    expect(target).toMatchObject({
      targetType: SEO_EDITOR_TARGET_TYPES.manual,
      syntheticPageId: 'cms-case-studies-missing',
      canonicalPath: '/case-studies/missing',
      capabilities: {
        canSave: false,
        canPublish: false,
        canSendToClient: false,
        canAnalyze: false,
        canBulkRewrite: false,
      },
    });
  });
});
