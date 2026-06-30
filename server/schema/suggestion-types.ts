import type { SchemaGenerationDiagnostics } from '../../shared/types/schema-generation.js';
import type {
  SchemaCmsDeliveryStatus,
  SchemaCollectionIdentity,
} from '../../shared/types/site-inventory.js';
import type { ValidationFinding } from '../../shared/types/schema-validation.js';
import type { EeatAsset } from '../../shared/types/eeat-assets.js';
import type { SiteNode } from '../site-architecture.js';
import type { RichResultEligibility } from './rich-results.js';
import type { SchemaPageType } from './role-type-registry.js';

export interface SchemaSuggestion {
  type: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  template: Record<string, unknown>;
}

export interface SchemaPageSuggestion {
  pageId: string;
  pageTitle: string;
  slug: string;
  publishedPath?: string | null;
  url: string;
  existingSchemas: string[];
  existingSchemaJson?: Record<string, unknown>[];
  suggestedSchemas: SchemaSuggestion[];
  validationErrors?: string[];
  validationFindings?: ValidationFinding[];
  richResultsEligibility?: RichResultEligibility[];
  generationDiagnostics?: SchemaGenerationDiagnostics;
  collectionIdentity?: SchemaCollectionIdentity;
  cmsDeliveryStatus?: SchemaCmsDeliveryStatus;
  savedPageType?: string;
}

export interface SchemaContext {
  companyName?: string;
  liveDomain?: string;
  logoUrl?: string;
  pageKeywords?: { primary: string; secondary: string[] };
  siteKeywords?: string[];
  workspaceId?: string;
  pageType?: SchemaPageType;
  _siteId?: string;
  _architectureTree?: SiteNode;
  _gscPageData?: { clicks: number; impressions: number; position: number; ctr: number };
  _ga4PageData?: { pageviews: number; users: number; avgEngagementTime: number };
  _businessProfile?: {
    phone?: string;
    email?: string;
    address?: { street?: string; city?: string; state?: string; zip?: string; country?: string };
    socialProfiles?: string[];
    openingHours?: string;
    foundedDate?: string;
    numberOfEmployees?: string;
  };
  /** Default site-wide BCP-47 locale from Webflow site.locales.primary.tag. Defaults to 'en' when unset. */
  _defaultLocale?: string;
  /** When true, WebSite.potentialAction (sitelinks SearchAction) is emitted. */
  _siteHasSearch?: boolean;
  /** Validation errors from the prior schema generation for this page. */
  _existingErrors?: Array<{ message: string }>;
  _eeatAssets?: EeatAsset[];
}
