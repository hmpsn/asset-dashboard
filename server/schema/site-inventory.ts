import type { BusinessProfileContact } from '../../shared/types/workspace.js';
import type {
  CmsSchemaFieldMapping,
  SchemaCollectionInventory,
  SchemaFieldTarget,
  SiteInventoryFieldData,
  SiteInventoryCmsItem,
  SiteInventoryField,
  SiteInventoryPage,
  SiteInventorySlice,
} from '../../shared/types/site-inventory.js';
import type { SchemaPageRole } from '../../shared/types/schema-plan.js';
import { discoverCmsItemsBySlug, toCmsPageId } from '../webflow-pages.js';
import { getCollectionSchema, listCollections } from '../webflow-cms.js';
import { getSchemaCmsFieldMappings } from '../schema-store.js';
import { createLogger } from '../logger.js';

const log = createLogger('schema/site-inventory');

interface WorkspacePageLike {
  id: string;
  title?: string;
  name?: string;
  slug?: string;
  publishedPath?: string | null;
}

const RECOMMENDED_SCHEMA_FIELD_SLUG = 'schema-json-ld';

function norm(s: string): string {
  return s.toLowerCase().replace(/[_\s]+/g, '-');
}

export function isUtilitySchemaPath(path: string): { isUtility: boolean; reason?: string } {
  const p = path === '/' ? '/' : path.toLowerCase().replace(/\/$/, '');
  if (/^\/(?:401|403|404|500)$/.test(p)) return { isUtility: true, reason: 'system error page' };
  if (/^\/(?:login|log-in|signin|sign-in|password|protected|search)$/.test(p)) return { isUtility: true, reason: 'system utility page' };
  if (/(^|\/)(thank-you|thanks|success|confirmation|confirmed)$/.test(p)) return { isUtility: true, reason: 'post-conversion utility page' };
  return { isUtility: false };
}

function inferRoleFromText(text: string, fields: SiteInventoryField[]): SchemaPageRole | undefined {
  const haystack = `${norm(text)} ${fields.map(f => `${norm(f.slug)} ${norm(f.displayName)} ${norm(f.type)}`).join(' ')}`;
  if (/\b(location|locations|office|offices|clinic|clinics|city|cities|store|stores|branch|branches)\b/.test(haystack)) return 'location';
  if (/\b(blog|blogs|article|articles|post|posts|news|insight|insights|resource|resources|guide|guides)\b/.test(haystack)) return 'blog';
  if (/\b(author|team|staff|doctor|dentist|provider|attorney|lawyer|therapist|bio|person|people|leadership)\b/.test(haystack)) return 'author';
  if (/\b(service|services|treatment|treatments|procedure|procedures|solution|solutions)\b/.test(haystack)) return 'service';
  if (/\b(product|products|shop|sku|inventory|commerce)\b/.test(haystack)) return 'product';
  if (/\b(case-study|case-studies|portfolio|project|projects|work)\b/.test(haystack)) return 'case-study';
  if (/\b(event|events|webinar|workshop)\b/.test(haystack)) return 'event';
  if (/\b(course|courses|class|classes|lesson|training)\b/.test(haystack)) return 'course';
  if (/\b(job|jobs|career|careers|opening|openings|position|positions)\b/.test(haystack)) return 'job-posting';
  if (/\b(faq|faqs|question|questions)\b/.test(haystack)) return 'faq';
  return undefined;
}

function targetForField(field: SiteInventoryField): SchemaFieldTarget | undefined {
  const key = norm(`${field.slug} ${field.displayName}`);
  if (/\b(schema-json-ld|schema-json|json-ld|jsonld|schema)\b/.test(key)) return 'schemaJsonLd';
  if (/\b(author|writer|written-by|byline)\b/.test(key)) return 'author';
  if (/\b(title|name)\b/.test(key)) return 'title';
  if (/\b(summary|description|excerpt|meta-description)\b/.test(key)) return 'description';
  if (/\b(published|publish-date|date-published|post-date)\b/.test(key)) return 'datePublished';
  if (/\b(updated|modified|last-updated)\b/.test(key)) return 'dateModified';
  if (/\b(image|photo|hero|thumbnail|cover)\b/.test(key)) return 'image';
  if (/\b(street|address-1|street-address)\b/.test(key)) return 'streetAddress';
  if (/\b(city|locality)\b/.test(key)) return 'addressLocality';
  if (/\b(state|region|province)\b/.test(key)) return 'addressRegion';
  if (/\b(zip|postal|postcode)\b/.test(key)) return 'postalCode';
  if (/\b(country)\b/.test(key)) return 'addressCountry';
  if (/\b(phone|telephone|tel)\b/.test(key)) return 'phone';
  if (/\b(email|e-mail)\b/.test(key)) return 'email';
  if (/\b(role|title|position|job-title)\b/.test(key)) return 'teamRole';
  if (/\b(credential|credentials|license|certification|degree)\b/.test(key)) return 'credentials';
  if (/\b(price|cost|fee|rate)\b/.test(key)) return 'price';
  if (/\b(currency)\b/.test(key)) return 'priceCurrency';
  if (/\b(video|youtube|vimeo)\b/.test(key)) return 'videoUrl';
  return undefined;
}

function valueAsString(fieldData: Record<string, unknown> | null | undefined, slug: string | undefined): string | undefined {
  if (!fieldData || !slug) return undefined;
  const value = fieldData[slug];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && 'url' in value && typeof (value as { url?: unknown }).url === 'string') {
    return ((value as { url: string }).url).trim();
  }
  return undefined;
}

function deriveBusinessProfile(
  fieldData: Record<string, unknown> | null,
  targets: Partial<Record<SchemaFieldTarget, string>>,
  fallback: BusinessProfileContact | null | undefined,
): BusinessProfileContact | undefined {
  const address = {
    street: valueAsString(fieldData, targets.streetAddress),
    city: valueAsString(fieldData, targets.addressLocality),
    state: valueAsString(fieldData, targets.addressRegion),
    zip: valueAsString(fieldData, targets.postalCode),
    country: valueAsString(fieldData, targets.addressCountry),
  };
  const hasAddress = Object.values(address).some(Boolean);
  const phone = valueAsString(fieldData, targets.phone) || fallback?.phone;
  const email = valueAsString(fieldData, targets.email) || fallback?.email;
  if (!hasAddress && !phone && !email) return undefined;
  return {
    ...(fallback ?? {}),
    phone,
    email,
    address: hasAddress ? address : fallback?.address,
  };
}

function mappingFor(
  mappings: CmsSchemaFieldMapping[],
  collectionId: string,
): CmsSchemaFieldMapping | undefined {
  return mappings.find(m => m.collectionId === collectionId);
}

function buildFieldTargets(fields: SiteInventoryField[]): Partial<Record<SchemaFieldTarget, string>> {
  const targets: Partial<Record<SchemaFieldTarget, string>> = {};
  for (const field of fields) {
    if (field.target && !targets[field.target]) targets[field.target] = field.slug;
  }
  return targets;
}

function canStoreSchemaJson(field: SiteInventoryField | undefined): boolean {
  if (!field) return false;
  return ['PlainText', 'RichText'].includes(field.type);
}

export async function buildSiteInventory(opts: {
  siteId: string;
  baseUrl: string;
  pages: WorkspacePageLike[];
  tokenOverride?: string;
  businessProfile?: BusinessProfileContact | null;
}): Promise<SiteInventorySlice> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const mappings = getSchemaCmsFieldMappings(opts.siteId);
  const pages: SiteInventoryPage[] = opts.pages.map(page => {
    const slug = page.slug || '';
    const path = page.publishedPath || (slug ? `/${slug}` : '/');
    const exclusion = isUtilitySchemaPath(path);
    return {
      pageId: page.id,
      title: page.title || page.name || slug || '/',
      path,
      url: path === '/' ? baseUrl : `${baseUrl}${path}`,
      isUtility: exclusion.isUtility,
      exclusionReason: exclusion.reason,
    };
  });

  const collections = await listCollections(opts.siteId, opts.tokenOverride);
  const collectionFields = new Map<string, SiteInventoryField[]>();
  await Promise.all(collections.map(async collection => {
    const schema = await getCollectionSchema(collection.id, opts.tokenOverride);
    const fields = schema.fields.map(f => {
      const field: SiteInventoryField = {
        id: f.id,
        slug: f.slug,
        displayName: f.displayName,
        type: f.type,
      };
      field.target = targetForField(field);
      return field;
    });
    collectionFields.set(collection.id, fields);
  }));

  const staticPaths = new Set(opts.pages.map(page => page.publishedPath || (page.slug ? `/${page.slug}` : '/')));
  const { items } = await discoverCmsItemsBySlug(opts.siteId, baseUrl, staticPaths, 1000, opts.tokenOverride);
  const itemCountByCollection = new Map<string, number>();
  for (const item of items) {
    if (!item.collectionId) continue;
    itemCountByCollection.set(item.collectionId, (itemCountByCollection.get(item.collectionId) ?? 0) + 1);
  }

  const collectionInventory: SchemaCollectionInventory[] = collections.map(collection => {
    const fields = collectionFields.get(collection.id) ?? [];
    const mapping = mappingFor(mappings, collection.id);
    const inferredRole = inferRoleFromText(`${collection.displayName} ${collection.slug}`, fields);
    const schemaFieldSlug = mapping?.schemaFieldSlug || fields.find(f => f.slug === RECOMMENDED_SCHEMA_FIELD_SLUG || f.target === 'schemaJsonLd')?.slug;
    const schemaField = fields.find(f => f.slug === schemaFieldSlug);
    return {
      collectionId: collection.id,
      name: collection.displayName,
      slug: collection.slug,
      inferredRole,
      mappedRole: mapping?.collectionRole,
      roleSource: mapping?.collectionRole ? 'mapped' : inferredRole ? 'inferred' : 'none',
      fields,
      schemaFieldSlug,
      schemaFieldAvailable: canStoreSchemaJson(schemaField),
      itemCount: itemCountByCollection.get(collection.id) ?? 0,
    };
  });
  const collectionMap = new Map(collectionInventory.map(c => [c.collectionId, c]));

  const cmsItems: SiteInventoryCmsItem[] = items.map(item => {
    const collection = collectionMap.get(item.collectionId);
    const fields = collection?.fields ?? [];
    const targets = buildFieldTargets(fields);
    const fieldData = item.fieldData as SiteInventoryFieldData | null;
    const mappedRole = collection?.mappedRole;
    const inferredRole = collection?.inferredRole;
    const effectiveRole = mappedRole ?? inferredRole;
    const exclusion = isUtilitySchemaPath(item.path);
    return {
      pageId: toCmsPageId(item.path),
      title: item.pageName,
      path: item.path,
      url: item.url,
      collectionId: item.collectionId,
      collectionName: collection?.name ?? '',
      collectionSlug: collection?.slug ?? '',
      itemId: item.itemId,
      lastPublished: item.lastPublished,
      createdOn: item.createdOn,
      fieldData,
      inferredRole,
      mappedRole,
      effectiveRole,
      roleSource: mappedRole ? 'mapped' : inferredRole ? 'inferred' : 'none',
      schemaFieldSlug: collection?.schemaFieldSlug,
      schemaFieldAvailable: collection?.schemaFieldAvailable ?? false,
      isUtility: exclusion.isUtility,
      exclusionReason: exclusion.reason,
      fieldTargets: targets,
      itemBusinessProfile: effectiveRole === 'location'
        ? deriveBusinessProfile(fieldData, targets, opts.businessProfile)
        : undefined,
    };
  });

  log.info({
    siteId: opts.siteId,
    pages: pages.length,
    collections: collectionInventory.length,
    cmsItems: cmsItems.length,
  }, 'Assembled schema site inventory');

  return {
    siteId: opts.siteId,
    baseUrl,
    assembledAt: new Date().toISOString(),
    pages,
    collections: collectionInventory,
    cmsItems,
  };
}

export function getRecommendedSchemaFieldSlug(): string {
  return RECOMMENDED_SCHEMA_FIELD_SLUG;
}
