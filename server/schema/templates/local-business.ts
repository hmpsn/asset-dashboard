/**
 * LocalBusiness template. Emits address/contact/hours ONLY when the workspace
 * business profile or verified page evidence has them — never fabricates.
 * Specific subtypes are emitted only when trusted evidence supplies them.
 */
import type { PageData, BusinessProfile } from '../data-sources.js';
import type { SchemaIndustrySubtype } from '../../../shared/types/schema-plan.js';
import type { SemanticPageData } from '../../../shared/types/page-elements.js';
import { breadcrumbRef, dropUndefined, withBreadcrumb } from './helpers.js';

export interface LocalBusinessInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile: BusinessProfile | null;
  /** When true, WebSite.potentialAction (sitelinks SearchAction) is emitted. Mirrors Workspace.siteHasSearch. */
  siteHasSearch?: boolean;
  industrySubtype?: SchemaIndustrySubtype;
}

function isOpaqueIdentifier(value: string): boolean {
  const trimmed = value.trim();
  return /^[a-f0-9]{24}$/i.test(trimmed) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
}

function safeText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || isOpaqueIdentifier(cleaned)) return undefined;
  return cleaned;
}

function safeHttpUrl(value: string | undefined): string | undefined {
  const cleaned = safeText(value);
  if (!cleaned) return undefined;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
  } catch { // catch-ok: malformed/relative URL evidence is omitted from JSON-LD
    return undefined;
  }
}

function isHtmlLike(value: string | undefined): boolean {
  return !!value && /<[^>]+>/.test(value);
}

function openingHoursSpecification(
  hours: SemanticPageData['hours'] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(hours) || hours.length === 0) return undefined;
  const specs = hours.reduce<Array<Record<string, unknown>>>((acc, item) => {
    if (!item || typeof item !== 'object') return acc;
    const record = item as { dayOfWeek?: string | string[]; opens?: string; closes?: string };
    const hasDays = Array.isArray(record.dayOfWeek) ? record.dayOfWeek.length > 0 : !!record.dayOfWeek;
    if (!hasDays || !record.opens || !record.closes) return acc;
    acc.push({
      '@type': 'OpeningHoursSpecification',
      'dayOfWeek': record.dayOfWeek,
      'opens': record.opens,
      'closes': record.closes,
    });
    return acc;
  }, []);
  return specs.length ? specs : undefined;
}

function localBusinessType(input: LocalBusinessInput): string {
  const verifiedType = input.pageData.elements?.semantics?.businessType;
  if (verifiedType && verifiedType !== 'LocalBusiness') return verifiedType;
  if (input.industrySubtype === 'medical') return 'MedicalOrganization';
  if (input.industrySubtype === 'financial') return 'FinancialService';
  return 'LocalBusiness';
}

export function buildLocalBusinessSchema(input: LocalBusinessInput): Record<string, unknown> {
  const { pageData, businessProfile, baseUrl, siteHasSearch } = input;
  const safeSocialProfiles = Array.from(new Set([
    ...(businessProfile?.socialProfiles ?? []),
    ...(pageData.elements?.semantics?.sameAs ?? []),
  ]
    ?.map(url => url.trim())
    .map(safeHttpUrl)
    .filter((url): url is string => Boolean(url))));
  const isHomepageUsage = pageData.canonicalUrl === baseUrl || pageData.canonicalUrl === `${baseUrl}/`;
  const lbId = isHomepageUsage
    ? `${baseUrl}/#localbusiness`
    : `${pageData.canonicalUrl}#localbusiness`;
  const lbUrl = isHomepageUsage ? baseUrl : pageData.canonicalUrl;
  const schemaType = localBusinessType(input);
  const semanticHours = openingHoursSpecification(pageData.elements?.semantics?.hours);
  const openingHoursText = !semanticHours && !isHtmlLike(businessProfile?.openingHours)
    ? safeText(businessProfile?.openingHours)
    : undefined;
  const semanticGeo = pageData.elements?.semantics?.geo;
  const geo = semanticGeo
    ? {
        '@type': 'GeoCoordinates',
        'latitude': semanticGeo.latitude,
        'longitude': semanticGeo.longitude,
      }
    : undefined;

  const addressFields = businessProfile?.address
    ? {
        streetAddress: safeText(businessProfile.address.street),
        addressLocality: safeText(businessProfile.address.city),
        addressRegion: safeText(businessProfile.address.state),
        postalCode: safeText(businessProfile.address.zip),
        addressCountry: safeText(businessProfile.address.country),
      }
    : undefined;
  const address = addressFields && Object.values(addressFields).some(Boolean)
    ? dropUndefined({
        '@type': 'PostalAddress',
        ...addressFields,
      })
    : undefined;

  // PR2: AggregateRating from rated testimonials.
  // Filter must match the Review[] emission gate below — both require author + rating.
  // Review nodes are skipped when either is missing, so AggregateRating.reviewCount
  // must use the same filter or it can exceed the visible Review count in @graph.
  const ratedTestimonials = (pageData.elements?.testimonials ?? []).filter(t => t.rating != null && !!t.author);
  const aggregateRating = ratedTestimonials.length > 0
    ? dropUndefined({
        '@type': 'AggregateRating' as const,
        'ratingValue': Number((ratedTestimonials.reduce((s, t) => s + (t.rating ?? 0), 0) / ratedTestimonials.length).toFixed(2)),
        'reviewCount': ratedTestimonials.length,
        'bestRating': 5,
        'worstRating': 1,
      })
    : undefined;

  // Emit a sibling Organization node so orgRef (@id: /#organization) used by
  // Service/AboutPage templates on other pages resolves to a real entity.
  const organization = dropUndefined({
    '@type': 'Organization',
    '@id': `${baseUrl}/#organization`,
    'name': pageData.publisher.name,
    'url': baseUrl,
    'logo': pageData.publisher.logoUrl
      ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
      : undefined,
    'knowsAbout': pageData.knowsAbout?.length ? pageData.knowsAbout : undefined,
  });

  const localBusiness = dropUndefined({
    '@type': schemaType,
    '@id': lbId,
    'name': safeText(pageData.elements?.semantics?.businessName) ?? pageData.publisher.name,
    'description': pageData.description,
    'url': lbUrl,
    'image': safeHttpUrl(pageData.elements?.semantics?.primaryImage) ?? safeHttpUrl(pageData.image),
    'inLanguage': pageData.inLanguage,
    'telephone': safeText(businessProfile?.phone),
    'email': safeText(businessProfile?.email),
    'openingHours': openingHoursText,
    'openingHoursSpecification': semanticHours,
    'address': address,
    'geo': geo,
    'priceRange': safeText(pageData.elements?.semantics?.priceRange),
    'sameAs': safeSocialProfiles?.length ? safeSocialProfiles : undefined,
    'foundingDate': businessProfile?.foundedDate,
    'parentOrganization': { '@id': `${baseUrl}/#organization` },
    'areaServed': safeText(pageData.areaServed) ? { '@type': 'Place' as const, name: safeText(pageData.areaServed) } : undefined,
    'aggregateRating': aggregateRating,
  });

  // Emit the same WebSite sitewide entity that buildHomepageSchema does — Google
  // uses this for the site-name display in search results.
  // potentialAction (sitelinks SearchAction) gated on siteHasSearch — see homepage.ts
  // for rationale. PR2 ships the admin toggle UI.
  const website = {
    '@type': 'WebSite',
    '@id': `${baseUrl}/#website`,
    'name': pageData.publisher.name,
    'url': baseUrl,
    'publisher': { '@id': `${baseUrl}/#organization` },
    'inLanguage': pageData.inLanguage,
    ...(siteHasSearch ? {
      'potentialAction': {
        '@type': 'SearchAction',
        'target': { '@type': 'EntryPoint', 'urlTemplate': `${baseUrl}/?s={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    } : {}),
  };

  // PR2: Review[] graph nodes
  const reviews: Array<Record<string, unknown>> = (pageData.elements?.testimonials ?? [])
    .reduce<Array<Record<string, unknown>>>((acc, t, idx) => {
      if (!t.author || t.rating == null) return acc;
      acc.push(dropUndefined({
        '@type': 'Review' as const,
        '@id': `${lbUrl}#review-${idx}`,
        'itemReviewed': { '@id': lbId },
        'reviewRating': dropUndefined({
          '@type': 'Rating' as const,
          'ratingValue': t.rating,
          'bestRating': 5,
          'worstRating': 1,
        }),
        'author': { '@type': 'Person' as const, 'name': t.author },
        'reviewBody': t.quote,
      }) as Record<string, unknown>);
      return acc;
    }, []);

  const webPageNode = !isHomepageUsage ? dropUndefined({
    '@type': 'WebPage' as const,
    '@id': `${pageData.canonicalUrl}#webpage`,
    'url': pageData.canonicalUrl,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'isPartOf': { '@id': `${baseUrl}/#website` },
    'about': { '@id': lbId },
    'inLanguage': pageData.inLanguage,
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
  }) : undefined;

  const nodes: Array<Record<string, unknown>> = [organization, localBusiness, website, ...reviews];
  if (webPageNode) nodes.push(webPageNode);

  return withBreadcrumb(nodes, pageData);
}
