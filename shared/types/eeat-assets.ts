export const EEAT_ASSET_TYPE = {
  TESTIMONIAL: 'testimonial',
  CASE_STUDY: 'case_study',
  CREDENTIAL: 'credential',
  BEFORE_AFTER_GALLERY: 'before_after_gallery',
  TEAM_BIO: 'team_bio',
  AWARD: 'award',
  RESEARCH: 'research',
  CLIENT_LOGO: 'client_logo',
} as const;

export type EeatAssetType = typeof EEAT_ASSET_TYPE[keyof typeof EEAT_ASSET_TYPE];

export const EEAT_RECOMMENDATION_SURFACE = {
  CONTENT_BRIEF: 'content_brief',
  PAGE_INTELLIGENCE: 'page_intelligence',
  SCHEMA: 'schema',
} as const;

export type EeatRecommendationSurface = typeof EEAT_RECOMMENDATION_SURFACE[keyof typeof EEAT_RECOMMENDATION_SURFACE];

export const TRUST_SIGNAL_SEVERITY = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

export type TrustSignalSeverity = typeof TRUST_SIGNAL_SEVERITY[keyof typeof TRUST_SIGNAL_SEVERITY];

export const EEAT_PAGE_TYPE = {
  HOMEPAGE: 'homepage',
  SERVICE: 'service',
  LOCATION: 'location',
  PRODUCT: 'product',
  LANDING: 'landing',
  ARTICLE: 'article',
  ABOUT: 'about',
  TESTIMONIAL: 'testimonial',
  CASE_STUDY: 'case_study',
  OTHER: 'other',
} as const;

export type EeatPageType = typeof EEAT_PAGE_TYPE[keyof typeof EEAT_PAGE_TYPE];

export interface EeatAssetMetadata {
  attributionName?: string;
  attributionRole?: string;
  sourceName?: string;
  sourceUrl?: string;
  credentialIssuer?: string;
  credentialId?: string;
  expertiseAreas?: string[];
  serviceTypes?: string[];
  locations?: string[];
  metricLabel?: string;
  metricValue?: string;
  metricUnit?: string;
  evidenceDate?: string;
  associatedPagePaths?: string[];
  tags?: string[];
}

export interface EeatAsset {
  id: string;
  workspaceId: string;
  type: EeatAssetType;
  title: string;
  url?: string;
  content?: string;
  metadata?: EeatAssetMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface EeatAssetRecommendation {
  assetId: string;
  type: EeatAssetType;
  title: string;
  reason: string;
  surface: EeatRecommendationSurface;
  url?: string;
}

export interface MissingTrustSignal {
  signal: string;
  rationale: string;
  severity: TrustSignalSeverity;
  recommendedAssetTypes: EeatAssetType[];
}
