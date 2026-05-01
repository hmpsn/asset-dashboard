/**
 * LocalBusiness template. Emits address/contact/hours ONLY when the workspace
 * business profile has them — never fabricates. Healthcare subtype escalation
 * (Dentist, Physician, etc.) is deferred to the intelligence-layer follow-up.
 */
import type { PageData, BusinessProfile } from '../data-sources.js';
import type { SemanticPageData } from '../../../shared/types/page-elements.js';
import { dropUndefined, withBreadcrumb } from './helpers.js';

export interface LocalBusinessInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile: BusinessProfile | null;
  /** When true, WebSite.potentialAction (sitelinks SearchAction) is emitted. Mirrors Workspace.siteHasSearch. */
  siteHasSearch?: boolean;
  /** Semantic data extracted from page content. Enriches NAP, hours, staff, services, rating. */
  semantics?: SemanticPageData;
}

export function buildLocalBusinessSchema(input: LocalBusinessInput): Record<string, unknown> {
  const { pageData, businessProfile, baseUrl, siteHasSearch } = input;

  const { semantics } = input;

  // Prefer semantics (page-level) over businessProfile (workspace-level) for location-specific data
  const phone = semantics?.phone || businessProfile?.phone;
  const email = semantics?.email || businessProfile?.email;

  const semanticsAddress = semantics?.address ? {
    '@type': 'PostalAddress' as const,
    'streetAddress': semantics.address.street,
    'addressLocality': semantics.address.city,
    'addressRegion': semantics.address.state,
    'postalCode': semantics.address.postalCode,
    'addressCountry': semantics.address.country,
  } : undefined;

  const openingHoursSpec = semantics?.hours?.length
    ? semantics.hours.map(h => dropUndefined({
        '@type': 'OpeningHoursSpecification' as const,
        'dayOfWeek': h.dayOfWeek,
        'opens': h.opens,
        'closes': h.closes,
      }))
    : undefined;

  // semantics.aggregateRating (page-extracted) overrides testimonial-derived rating
  const semanticsRating = semantics?.aggregateRating
    ? dropUndefined({
        '@type': 'AggregateRating' as const,
        'ratingValue': semantics.aggregateRating.ratingValue,
        'reviewCount': semantics.aggregateRating.reviewCount,
        'bestRating': 5,
        'worstRating': 1,
      })
    : undefined;

  const staffNodes: Array<Record<string, unknown>> = (semantics?.staff ?? []).map((s, i) => dropUndefined({
    '@type': 'Person' as const,
    '@id': `${baseUrl}/#person-${i}`,
    'name': s.name,
    'jobTitle': s.jobTitle,
    'hasCredential': s.credentials,
    'image': s.image,
    'worksFor': { '@id': `${baseUrl}/#localbusiness` },
  }));

  const hasOfferCatalog = semantics?.services?.length
    ? {
        '@type': 'OfferCatalog' as const,
        'name': `${pageData.publisher.name} Services`,
        'itemListElement': semantics.services.map((svc, i) => ({
          '@type': 'ListItem' as const,
          'position': i + 1,
          'item': { '@type': 'Service' as const, 'name': svc },
        })),
      }
    : undefined;

  const sameAsUrls = [
    ...(semantics?.sameAs ?? []),
    ...(businessProfile?.socialProfiles ?? []),
  ].filter(Boolean);
  const sameAs = sameAsUrls.length > 0 ? [...new Set(sameAsUrls)] : undefined;

  const areaServedList = semantics?.areaServed?.length
    ? semantics.areaServed.map(a => ({ '@type': 'Place' as const, 'name': a }))
    : (pageData.areaServed ? [{ '@type': 'Place' as const, 'name': pageData.areaServed }] : undefined);

  const address = businessProfile?.address
    ? dropUndefined({
        '@type': 'PostalAddress',
        'streetAddress': businessProfile.address.street,
        'addressLocality': businessProfile.address.city,
        'addressRegion': businessProfile.address.state,
        'postalCode': businessProfile.address.zip,
        'addressCountry': businessProfile.address.country,
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
    '@type': 'LocalBusiness',
    '@id': `${baseUrl}/#localbusiness`,
    'name': pageData.publisher.name,
    'description': pageData.description,
    'url': baseUrl,
    'image': semantics?.primaryImage || pageData.image,
    'inLanguage': pageData.inLanguage,
    'telephone': phone,
    'email': email,
    'openingHoursSpecification': openingHoursSpec,
    'openingHours': !openingHoursSpec ? businessProfile?.openingHours : undefined,
    'address': semanticsAddress || address,
    'sameAs': sameAs,
    'foundedDate': semantics?.foundingDate || businessProfile?.foundedDate,
    'hasOfferCatalog': hasOfferCatalog,
    'parentOrganization': { '@id': `${baseUrl}/#organization` },
    'areaServed': areaServedList,
    'aggregateRating': semanticsRating || aggregateRating,
    'amenityFeature': semantics?.accessibility?.length
      ? semantics.accessibility.map(a => ({ '@type': 'LocationFeatureSpecification' as const, 'name': a, 'value': true }))
      : undefined,
    'knowsLanguage': semantics?.languagesSpoken,
    'currenciesAccepted': semantics?.paymentOptions?.join(', '),
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
  const lbId = `${baseUrl}/#localbusiness`;
  const reviews: Array<Record<string, unknown>> = (pageData.elements?.testimonials ?? [])
    .reduce<Array<Record<string, unknown>>>((acc, t, idx) => {
      if (!t.author || t.rating == null) return acc;
      acc.push(dropUndefined({
        '@type': 'Review' as const,
        '@id': `${baseUrl}/#review-${idx}`,
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

  return withBreadcrumb([organization, localBusiness, website, ...reviews, ...staffNodes], pageData);
}
