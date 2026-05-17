import {
  SEO_EDITOR_TARGET_TYPES,
  type SeoEditorCollectionFilterOption,
  type SeoEditorWriteTarget,
} from '../../../shared/types/seo-editor-write-target';
import type { PageMeta } from '../../hooks/admin/useSeoEditor';
import { normalizePageUrl, resolvePagePath } from '../../lib/pathUtils';
import {
  getExtraSeoFields,
  getTitleAndDescriptionFields,
  type CmsCollection,
} from '../cms-editor/cmsEditorModel';

export interface ResolveSeoEditorWriteTargetsInput {
  pages: PageMeta[];
  collections: CmsCollection[];
}

export interface ResolvedSeoEditorWriteTargets {
  targets: SeoEditorWriteTarget[];
  staticTargets: SeoEditorWriteTarget[];
  cmsTargets: SeoEditorWriteTarget[];
  manualTargets: SeoEditorWriteTarget[];
  collectionOptions: SeoEditorCollectionFilterOption[];
}

function normalizeTargetKey(path: string): string {
  return normalizePageUrl(path).toLowerCase();
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function resolveCmsItemPath(collectionSlug: string, itemSlug: string): string {
  return normalizePageUrl(`/${collectionSlug}/${itemSlug}`);
}

export function resolveSeoEditorWriteTargets({
  pages,
  collections,
}: ResolveSeoEditorWriteTargetsInput): ResolvedSeoEditorWriteTargets {
  const staticTargets = pages
    .filter(page => page.source !== 'cms')
    .map(page => ({
      id: page.id,
      targetType: SEO_EDITOR_TARGET_TYPES.staticPage,
      pageId: page.id,
      title: page.title || page.slug || 'Untitled page',
      canonicalPath: resolvePagePath(page),
      rawSlug: page.slug || null,
      sourceLabel: 'Static page',
      seo: {
        title: page.seo?.title || '',
        description: page.seo?.description || '',
      },
      capabilities: {
        canSave: true,
        canPublish: true,
        canSendToClient: true,
        canAnalyze: true,
        canBulkRewrite: true,
      },
    })) satisfies SeoEditorWriteTarget[];

  const cmsTargets: SeoEditorWriteTarget[] = [];
  const collectionOptions: SeoEditorCollectionFilterOption[] = [];

  for (const collection of collections) {
    collectionOptions.push({
      collectionId: collection.collectionId,
      collectionName: collection.collectionName,
      collectionSlug: collection.collectionSlug,
      itemCount: collection.items.length,
    });

    const extraSeoFields = getExtraSeoFields(collection.seoFields);
    const { titleField, descField } = getTitleAndDescriptionFields(extraSeoFields);

    for (const item of collection.items) {
      const itemSlug = stringValue(item.fieldData.slug);
      const itemName = stringValue(item.fieldData.name);
      const rawSeoTitle = titleField ? stringValue(item.fieldData[titleField.slug]) : '';
      const seoTitle = rawSeoTitle.trim() || itemName;
      const canonicalPath = resolveCmsItemPath(collection.collectionSlug, itemSlug);
      cmsTargets.push({
        id: item.id,
        targetType: SEO_EDITOR_TARGET_TYPES.cmsItem,
        itemId: item.id,
        collectionId: collection.collectionId,
        collectionName: collection.collectionName,
        collectionSlug: collection.collectionSlug,
        title: itemName || itemSlug || 'Untitled CMS item',
        canonicalPath,
        rawSlug: itemSlug || null,
        sourceLabel: collection.collectionName,
        seo: {
          title: seoTitle,
          description: descField ? stringValue(item.fieldData[descField.slug]) : '',
        },
        titleFieldSlug: titleField?.slug,
        descriptionFieldSlug: descField?.slug,
        capabilities: {
          canSave: true,
          canPublish: true,
          canSendToClient: true,
          canAnalyze: false,
          canBulkRewrite: true,
        },
      });
    }
  }

  const cmsPathKeys = new Set(cmsTargets.map(target => normalizeTargetKey(target.canonicalPath)));
  const manualTargets = pages
    .filter(page => page.source === 'cms')
    .filter(page => !cmsPathKeys.has(normalizeTargetKey(resolvePagePath(page))))
    .map(page => ({
      id: `manual:${page.id}`,
      targetType: SEO_EDITOR_TARGET_TYPES.manual,
      syntheticPageId: page.id,
      title: page.title || page.slug || 'Unmapped CMS page',
      canonicalPath: resolvePagePath(page),
      rawSlug: page.slug || null,
      sourceLabel: 'Unmapped CMS page',
      seo: {
        title: page.seo?.title || '',
        description: page.seo?.description || '',
      },
      capabilities: {
        canSave: false,
        canPublish: false,
        canSendToClient: false,
        canAnalyze: false,
        canBulkRewrite: false,
      },
      manualApplyReason: 'This sitemap CMS URL could not be matched to a Webflow collection item.',
    })) satisfies SeoEditorWriteTarget[];

  return {
    targets: [...staticTargets, ...cmsTargets, ...manualTargets],
    staticTargets,
    cmsTargets,
    manualTargets,
    collectionOptions,
  };
}
