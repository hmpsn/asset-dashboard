import type { SchemaPageRole } from './schema-plan';
import type { BusinessProfileContact } from './workspace';

export type SchemaCollectionRoleSource = 'mapped' | 'inferred' | 'none';

export type SchemaFieldTarget =
  | 'title'
  | 'description'
  | 'author'
  | 'datePublished'
  | 'dateModified'
  | 'image'
  | 'locationName'
  | 'streetAddress'
  | 'addressLocality'
  | 'addressRegion'
  | 'postalCode'
  | 'addressCountry'
  | 'phone'
  | 'email'
  | 'openingHours'
  | 'serviceName'
  | 'serviceType'
  | 'areaServed'
  | 'teamRole'
  | 'credentials'
  | 'price'
  | 'priceCurrency'
  | 'videoUrl'
  | 'schemaJsonLd'
  | 'breadcrumb'
  | 'softwareApplication'
  | 'audienceType'
  | 'featureList'
  | 'logo';

export type SchemaEvidenceSource =
  | 'rendered-html'
  | 'existing-json-ld'
  | `cms-field:${string}`
  | 'business-profile'
  | 'workspace-intelligence'
  | 'manual-override'
  | 'collection-inference';

export type SiteInventoryFieldValue =
  | string
  | number
  | boolean
  | null
  | SiteInventoryFieldValue[]
  | { [field: string]: SiteInventoryFieldValue | undefined };

export interface SiteInventoryFieldData {
  [fieldSlug: string]: SiteInventoryFieldValue | undefined;
}

export interface SiteInventoryField {
  id?: string;
  slug: string;
  displayName: string;
  type: string;
  target?: SchemaFieldTarget;
}

export interface CmsSchemaFieldMapping {
  siteId: string;
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  schemaFieldSlug?: string;
  collectionRole?: SchemaPageRole;
  fieldMappings?: Partial<Record<SchemaFieldTarget, string>>;
  updatedAt: string;
}

export interface SchemaCollectionInventory {
  collectionId: string;
  name: string;
  slug: string;
  inferredRole?: SchemaPageRole;
  mappedRole?: SchemaPageRole;
  roleSource: SchemaCollectionRoleSource;
  fields: SiteInventoryField[];
  schemaFieldSlug?: string;
  fieldMappings?: Partial<Record<SchemaFieldTarget, string>>;
  schemaFieldAvailable: boolean;
  itemCount: number;
}

export interface SiteInventoryPage {
  pageId: string;
  title: string;
  path: string;
  url: string;
  isUtility: boolean;
  exclusionReason?: string;
}

export interface SiteInventoryCmsItem {
  pageId: string;
  title: string;
  path: string;
  url: string;
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  itemId: string;
  lastPublished: string | null;
  createdOn: string | null;
  fieldData: SiteInventoryFieldData | null;
  inferredRole?: SchemaPageRole;
  mappedRole?: SchemaPageRole;
  effectiveRole?: SchemaPageRole;
  roleSource: SchemaCollectionRoleSource;
  schemaFieldSlug?: string;
  schemaFieldAvailable: boolean;
  isUtility: boolean;
  exclusionReason?: string;
  fieldTargets: Partial<Record<SchemaFieldTarget, string>>;
  fieldEvidence?: SchemaFieldEvidence[];
  itemBusinessProfile?: BusinessProfileContact;
  itemServiceProfile?: SchemaServiceProfile;
}

export interface SiteInventorySlice {
  siteId: string;
  baseUrl: string;
  assembledAt: string;
  pages: SiteInventoryPage[];
  collections: SchemaCollectionInventory[];
  cmsItems: SiteInventoryCmsItem[];
}

export interface SchemaCollectionIdentity {
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  itemId?: string;
  itemPath?: string;
}

export interface SchemaCmsDeliveryStatus {
  mode: 'page-custom-code' | 'cms-field';
  status: 'not-applicable' | 'ready' | 'blocked' | 'written' | 'unchanged' | 'failed';
  fieldSlug?: string;
  message: string;
  hash?: string;
}

export type SchemaFieldResolutionStatus =
  | 'resolved'
  | 'skipped-unresolved-reference'
  | 'skipped-empty'
  | 'skipped-invalid'
  | 'fallback-used';

export interface SchemaFieldEvidence {
  field: string;
  source: SchemaEvidenceSource;
  status?: SchemaFieldResolutionStatus;
  fieldSlug?: string;
  message?: string;
}

export interface SchemaServiceOffer {
  name?: string;
  price: string;
  priceCurrency: string;
  description?: string;
}

export interface SchemaServiceProfile {
  serviceName?: string;
  serviceType?: string;
  areaServed?: string;
  offers?: SchemaServiceOffer[];
}
