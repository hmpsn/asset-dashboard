/**
 * Shared types for CMS image scanning and optimization.
 */

export interface CmsImageField {
  slug: string;
  displayName: string;
  type: 'Image' | 'MultiImage' | 'RichText';
}

export interface CmsImageUsage {
  collectionId: string;
  collectionName: string;
  itemId: string;
  itemName: string;
  fieldSlug: string;
  fieldDisplayName: string;
  fieldType: 'Image' | 'MultiImage' | 'RichText';
}

export interface CmsImageAsset {
  assetId: string;
  hostedUrl: string;
  altText: string;
  size: number;
  contentType: string;
  displayName: string;
  isRichTextOnly?: boolean;
  usages: CmsImageUsage[];
}

export interface CmsCollectionImageInfo {
  collectionId: string;
  collectionName: string;
  imageFields: CmsImageField[];
}

export interface CmsImageScanResult {
  collections: CmsCollectionImageInfo[];
  assets: CmsImageAsset[];
  stats: {
    totalCmsImages: number;
    missingAlt: number;
    oversized: number;
  };
}
