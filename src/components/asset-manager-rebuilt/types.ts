// @ds-rebuilt
import type { CmsImageUsage } from '../../../shared/types/cms-images';

export const ASSET_MANAGER_LENSES = [
  { id: 'browse', label: 'Browse' },
  { id: 'audit', label: 'Audit' },
  { id: 'upload', label: 'Upload' },
] as const;

export type AssetManagerLens = typeof ASSET_MANAGER_LENSES[number]['id'];

export const BROWSE_FILTERS = [
  { id: 'missing-alt', label: 'Missing alt' },
  { id: 'oversized', label: 'Oversized' },
  { id: 'images', label: 'Images' },
  { id: 'svg', label: 'SVG' },
  { id: 'unused', label: 'Unused' },
  { id: 'used', label: 'Used' },
  { id: 'cms-images', label: 'CMS images' },
  { id: 'cms-missing-alt', label: 'CMS missing alt' },
] as const;

export type BrowseFilter = typeof BROWSE_FILTERS[number]['id'];

export const CMS_FILTERS = new Set<BrowseFilter>(['cms-images', 'cms-missing-alt']);
export const NON_CMS_FILTERS = new Set<BrowseFilter>(['missing-alt', 'oversized', 'images', 'svg', 'unused', 'used']);

export const AUDIT_ISSUE_FILTERS = [
  { id: 'missing-alt', label: 'Missing alt' },
  { id: 'low-quality-alt', label: 'Low quality alt' },
  { id: 'duplicate-alt', label: 'Duplicate alt' },
  { id: 'oversized', label: 'Oversized' },
  { id: 'unoptimized-png', label: 'Unoptimized PNG' },
  { id: 'legacy-format', label: 'Legacy format' },
  { id: 'duplicate', label: 'Possible duplicate' },
  { id: 'unused', label: 'Unused' },
] as const;

export type AuditIssueFilter = typeof AUDIT_ISSUE_FILTERS[number]['id'];
export type AssetSort = 'createdOn' | 'fileName' | 'fileSize';
export type AssetViewMode = 'grid' | 'table';
export type AuditSort = 'issues' | 'size' | 'name';

export interface Asset {
  id: string;
  displayName?: string;
  originalFileName?: string;
  size: number;
  contentType: string;
  url?: string;
  hostedUrl?: string;
  altText?: string;
  createdOn?: string;
  width?: number;
  height?: number;
  dimensionsDerivedAt?: string;
}

export interface AssetStats {
  total: number;
  missingAlt: number;
  oversized: number;
  unused: number;
  cmsImages: number;
  cmsMissingAlt: number;
  totalWeight: number;
  estimatedSavings: number;
}

export interface BrowseAsset extends Asset {
  source: 'webflow' | 'cms';
  unused: boolean;
  cmsUsages?: CmsImageUsage[];
  richTextOnly?: boolean;
}

export interface AuditIssue {
  assetId: string;
  fileName: string;
  url?: string;
  fileSize?: number;
  issues: string[];
  usedIn: string[];
}

export interface AuditResult {
  totalAssets: number;
  issueCount: number;
  missingAlt: number;
  oversized: number;
  unused: number;
  duplicates: number;
  lowQualityAlt: number;
  duplicateAlt: number;
  healthScore?: number;
  issues: AuditIssue[];
}

export interface BulkProgress {
  done: number;
  total: number;
}

export interface BulkCompressProgress extends BulkProgress {
  saved: number;
}

export interface BulkResult {
  tone: 'info' | 'warning' | 'success' | 'error';
  title: string;
  message: string;
}

export interface OrganizePlan {
  foldersToCreate: string[];
  moves: Array<{ assetId: string; assetName: string; targetFolder: string }>;
  summary: {
    totalAssets: number;
    assetsToMove: number;
    foldersToCreate: number;
    alreadyOrganized: number;
    unused: number;
    shared: number;
    ogImages: number;
  };
}
