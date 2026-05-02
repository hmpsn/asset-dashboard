import type { BusinessProfileContact } from '../../shared/types/workspace.js';
import type {
  CmsSchemaFieldMapping,
  SchemaCollectionInventory,
  SchemaFieldEvidence,
  SchemaFieldTarget,
  SchemaServiceProfile,
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
import { resolvePagePath } from '../helpers.js';

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
  if (/(^|\/)(?:login|log-in|signin|sign-in|password|protected|search)(?:\/|$)/.test(p)) return { isUtility: true, reason: 'system utility page' };
  if (/(^|\/)(thank-you|thanks|success|confirmation|confirmed)(?:\/|$)/.test(p)) return { isUtility: true, reason: 'post-conversion utility page' };
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

export function detectSchemaFieldTarget(field: SiteInventoryField): SchemaFieldTarget | undefined {
  const key = norm(`${field.slug} ${field.displayName}`);
  if (/\b(schema-json-ld|schema-json|json-ld|jsonld|schema)\b/.test(key)) return 'schemaJsonLd';
  if (/\b(author|writer|written-by|byline)\b/.test(key)) return 'author';
  if (/\b(service-name|treatment-name|procedure-name|solution-name)\b/.test(key)) return 'serviceName';
  if (/\b(role|job-title|position)\b/.test(key)) return 'teamRole';
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
  if (/\b(hours|opening-hours|business-hours|schedule)\b/.test(key)) return 'openingHours';
  if (/\b(service-type|service-category|category|treatment-type|procedure-type)\b/.test(key)) return 'serviceType';
  if (/\b(area-served|service-area|served-area|market|markets|region-served)\b/.test(key)) return 'areaServed';
  if (/\b(credential|credentials|license|certification|degree)\b/.test(key)) return 'credentials';
  if (/\b(price|cost|fee|rate)\b/.test(key)) return 'price';
  if (/\b(currency)\b/.test(key)) return 'priceCurrency';
  if (/\b(video|youtube|vimeo)\b/.test(key)) return 'videoUrl';
  return undefined;
}

export function isOpaqueWebflowIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return /^[a-f0-9]{24}$/i.test(trimmed) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
}

function cleanPublicFieldValue(value: string): string | undefined {
  const trimmed = value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (!trimmed || isOpaqueWebflowIdentifier(trimmed)) return undefined;
  return trimmed;
}

function fieldValueToString(value: unknown): string | undefined {
  if (typeof value === 'string') return cleanPublicFieldValue(value);
  if (typeof value === 'number' || typeof value === 'boolean') return cleanPublicFieldValue(String(value));
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = fieldValueToString(item);
      if (resolved) return resolved;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['name', 'displayName', 'title', 'label', 'text', 'slug', 'url']) {
      const resolved = fieldValueToString(obj[key]);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

function hasOpaqueReferenceValue(value: unknown): boolean {
  if (typeof value === 'string') return isOpaqueWebflowIdentifier(value);
  if (Array.isArray(value)) return value.some(hasOpaqueReferenceValue);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const displayKeys = ['name', 'displayName', 'title', 'label', 'text', 'slug', 'url'];
    if (displayKeys.some(key => fieldValueToString(obj[key]))) return false;
    return Object.values(obj).some(hasOpaqueReferenceValue);
  }
  return false;
}

function resolutionFor(
  fieldData: SiteInventoryFieldData | null | undefined,
  slug: string | undefined,
  field: string,
): { value?: string; evidence: SchemaFieldEvidence } {
  if (!fieldData || !slug) {
    return {
      evidence: {
        field,
        source: 'collection-inference',
        status: 'skipped-empty',
        message: `${field} skipped: no CMS field mapped.`,
      },
    };
  }
  const raw = fieldData[slug];
  const value = fieldValueToString(raw);
  if (value) {
    return {
      value,
      evidence: {
        field,
        source: `cms-field:${slug}`,
        status: 'resolved',
        fieldSlug: slug,
      },
    };
  }
  const status = hasOpaqueReferenceValue(raw) ? 'skipped-unresolved-reference' : 'skipped-empty';
  return {
    evidence: {
      field,
      source: `cms-field:${slug}`,
      status,
      fieldSlug: slug,
      message: status === 'skipped-unresolved-reference'
        ? `${field} skipped: CMS reference value was unresolved.`
        : `${field} skipped: CMS field was empty.`,
    },
  };
}

function withFallback(
  resolved: { value?: string; evidence: SchemaFieldEvidence },
  fallback: string | undefined,
  field: string,
): { value?: string; evidence: SchemaFieldEvidence } {
  if (resolved.value) return resolved;
  const cleanFallback = cleanPublicFieldValue(fallback ?? '');
  if (!cleanFallback) return resolved;
  return {
    value: cleanFallback,
    evidence: {
      field,
      source: 'business-profile',
      status: 'fallback-used',
      message: `${field} used workspace business profile fallback.`,
    },
  };
}

function deriveBusinessProfile(
  fieldData: SiteInventoryFieldData | null,
  targets: Partial<Record<SchemaFieldTarget, string>>,
  fallback: BusinessProfileContact | null | undefined,
): { profile?: BusinessProfileContact; fieldEvidence: SchemaFieldEvidence[] } {
  const street = withFallback(resolutionFor(fieldData, targets.streetAddress, 'streetAddress'), fallback?.address?.street, 'streetAddress');
  const city = withFallback(resolutionFor(fieldData, targets.addressLocality, 'addressLocality'), fallback?.address?.city, 'addressLocality');
  const state = withFallback(resolutionFor(fieldData, targets.addressRegion, 'addressRegion'), fallback?.address?.state, 'addressRegion');
  const zip = withFallback(resolutionFor(fieldData, targets.postalCode, 'postalCode'), fallback?.address?.zip, 'postalCode');
  const country = withFallback(resolutionFor(fieldData, targets.addressCountry, 'addressCountry'), fallback?.address?.country, 'addressCountry');
  const phone = withFallback(resolutionFor(fieldData, targets.phone, 'phone'), fallback?.phone, 'phone');
  const email = withFallback(resolutionFor(fieldData, targets.email, 'email'), fallback?.email, 'email');
  const openingHours = withFallback(resolutionFor(fieldData, targets.openingHours, 'openingHours'), fallback?.openingHours, 'openingHours');
  const address = {
    street: street.value,
    city: city.value,
    state: state.value,
    zip: zip.value,
    country: country.value,
  };
  const hasAddress = Object.values(address).some(Boolean);
  const evidence = [street, city, state, zip, country, phone, email, openingHours].map(r => r.evidence);
  if (!hasAddress && !phone.value && !email.value && !openingHours.value) return { fieldEvidence: evidence };
  return {
    fieldEvidence: evidence,
    profile: {
      ...(fallback ?? {}),
      phone: phone.value,
      email: email.value,
      openingHours: openingHours.value,
      address: hasAddress ? address : fallback?.address,
    },
  };
}

function deriveServiceProfile(
  fieldData: SiteInventoryFieldData | null,
  targets: Partial<Record<SchemaFieldTarget, string>>,
  fallbackName: string,
): { profile?: SchemaServiceProfile; fieldEvidence: SchemaFieldEvidence[] } {
  const serviceName = resolutionFor(fieldData, targets.serviceName ?? targets.title, 'serviceName');
  const serviceType = resolutionFor(fieldData, targets.serviceType, 'serviceType');
  const areaServed = resolutionFor(fieldData, targets.areaServed, 'areaServed');
  const price = resolutionFor(fieldData, targets.price, 'price');
  const priceCurrency = resolutionFor(fieldData, targets.priceCurrency, 'priceCurrency');
  const evidence = [serviceName, serviceType, areaServed, price, priceCurrency].map(r => r.evidence);
  const hasOffer = !!(price.value && priceCurrency.value);
  const profile: SchemaServiceProfile = {
    serviceName: serviceName.value || cleanPublicFieldValue(fallbackName),
    serviceType: serviceType.value,
    areaServed: areaServed.value,
    offers: hasOffer ? [{
      name: serviceName.value || cleanPublicFieldValue(fallbackName),
      price: price.value!,
      priceCurrency: priceCurrency.value!,
    }] : undefined,
  };
  return {
    profile: Object.values(profile).some(Boolean) ? profile : undefined,
    fieldEvidence: evidence,
  };
}

function mappingFor(
  mappings: CmsSchemaFieldMapping[],
  collectionId: string,
): CmsSchemaFieldMapping | undefined {
  return mappings.find(m => m.collectionId === collectionId);
}

function buildFieldTargets(
  fields: SiteInventoryField[],
  mapping?: CmsSchemaFieldMapping,
): Partial<Record<SchemaFieldTarget, string>> {
  const targets: Partial<Record<SchemaFieldTarget, string>> = {};
  for (const field of fields) {
    if (field.target && !targets[field.target]) targets[field.target] = field.slug;
  }
  for (const [target, slug] of Object.entries(mapping?.fieldMappings ?? {}) as Array<[SchemaFieldTarget, string]>) {
    if (slug) targets[target] = slug;
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
    const path = resolvePagePath(page);
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
      field.target = detectSchemaFieldTarget(field);
      return field;
    });
    collectionFields.set(collection.id, fields);
  }));

  const staticPaths = new Set(opts.pages.map(page => resolvePagePath(page).replace(/\/$/, '').toLowerCase()));
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
      fieldMappings: mapping?.fieldMappings,
      schemaFieldAvailable: canStoreSchemaJson(schemaField),
      itemCount: itemCountByCollection.get(collection.id) ?? 0,
    };
  });
  const collectionMap = new Map(collectionInventory.map(c => [c.collectionId, c]));

  const cmsItems: SiteInventoryCmsItem[] = items.map(item => {
    const collection = collectionMap.get(item.collectionId);
    const fields = collection?.fields ?? [];
    const mapping = mappingFor(mappings, item.collectionId);
    const targets = buildFieldTargets(fields, mapping);
    const fieldData = item.fieldData as SiteInventoryFieldData | null;
    const mappedRole = collection?.mappedRole;
    const inferredRole = collection?.inferredRole;
    const effectiveRole = mappedRole ?? inferredRole;
    const exclusion = isUtilitySchemaPath(item.path);
    const businessResolution = effectiveRole === 'location'
      ? deriveBusinessProfile(fieldData, targets, opts.businessProfile)
      : { fieldEvidence: [] };
    const serviceResolution = effectiveRole === 'service'
      ? deriveServiceProfile(fieldData, targets, item.pageName)
      : { fieldEvidence: [] };
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
      fieldEvidence: [...businessResolution.fieldEvidence, ...serviceResolution.fieldEvidence],
      itemBusinessProfile: businessResolution.profile,
      itemServiceProfile: serviceResolution.profile,
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
