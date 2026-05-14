export const SEO_EDITOR_TARGET_TYPES = {
  staticPage: 'static-page',
  cmsItem: 'cms-item',
  manual: 'manual',
} as const;

export type SeoEditorTargetType = typeof SEO_EDITOR_TARGET_TYPES[keyof typeof SEO_EDITOR_TARGET_TYPES];

export interface SeoEditorTargetCapabilities {
  canSave: boolean;
  canPublish: boolean;
  canSendToClient: boolean;
  canAnalyze: boolean;
  canBulkRewrite: boolean;
}

interface SeoEditorWriteTargetBase {
  id: string;
  targetType: SeoEditorTargetType;
  title: string;
  canonicalPath: string;
  canonicalUrl?: string;
  rawSlug: string | null;
  sourceLabel: string;
  seo: {
    title: string;
    description: string;
  };
  capabilities: SeoEditorTargetCapabilities;
  manualApplyReason?: string;
}

export interface SeoEditorStaticPageTarget extends SeoEditorWriteTargetBase {
  targetType: typeof SEO_EDITOR_TARGET_TYPES.staticPage;
  pageId: string;
}

export interface SeoEditorCmsItemTarget extends SeoEditorWriteTargetBase {
  targetType: typeof SEO_EDITOR_TARGET_TYPES.cmsItem;
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  itemId: string;
  titleFieldSlug?: string;
  descriptionFieldSlug?: string;
}

export interface SeoEditorManualTarget extends SeoEditorWriteTargetBase {
  targetType: typeof SEO_EDITOR_TARGET_TYPES.manual;
  syntheticPageId: string;
}

export type SeoEditorWriteTarget =
  | SeoEditorStaticPageTarget
  | SeoEditorCmsItemTarget
  | SeoEditorManualTarget;

export interface SeoEditorCollectionFilterOption {
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  itemCount: number;
}
