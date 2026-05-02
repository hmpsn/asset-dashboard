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
  | 'serviceName'
  | 'teamRole'
  | 'credentials'
  | 'price'
  | 'priceCurrency'
  | 'videoUrl'
  | 'schemaJsonLd';

export type SchemaEvidenceSource =
  | 'rendered-html'
  | `cms-field:${string}`
  | 'business-profile'
  | 'workspace-intelligence'
  | 'manual-override'
  | 'collection-inference';

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
  fieldData: Record<string, unknown> | null;
  inferredRole?: SchemaPageRole;
  mappedRole?: SchemaPageRole;
  effectiveRole?: SchemaPageRole;
  roleSource: SchemaCollectionRoleSource;
  schemaFieldSlug?: string;
  schemaFieldAvailable: boolean;
  isUtility: boolean;
  exclusionReason?: string;
  fieldTargets: Partial<Record<SchemaFieldTarget, string>>;
  itemBusinessProfile?: BusinessProfileContact;
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

export interface SchemaFieldEvidence {
  field: string;
  source: SchemaEvidenceSource;
}
