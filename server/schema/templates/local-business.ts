/**
 * LocalBusiness template. Emits address/contact/hours ONLY when the workspace
 * business profile has them — never fabricates. Healthcare subtype escalation
 * (Dentist, Physician, etc.) is deferred to the intelligence-layer follow-up.
 */
import type { PageData, BusinessProfile } from '../data-sources.js';
import type { SchemaIndustrySubtype } from '../../../shared/types/schema-plan.js';
import { breadcrumbRef, dropUndefined, withBreadcrumb } from './helpers.js';

export interface LocalBusinessInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile: BusinessProfile | null;
  /** When true, WebSite.potentialAction (sitelinks SearchAction) is emitted. Mirrors Workspace.siteHasSearch. */
  siteHasSearch?: boolean;
  industrySubtype?: SchemaIndustrySubtype;
}

export function buildLocalBusinessSchema(input: LocalBusinessInput): Record<string, unknown> {
  const { pageData, businessProfile, baseUrl, siteHasSearch } = input;
  const isHomepageUsage = pageData.canonicalUrl === baseUrl || pageData.canonicalUrl === `${baseUrl}/`;
  const lbId = isHomepageUsage
    ? `${baseUrl}/#localbusiness`
    : `${pageData.canonicalUrl}#localbusiness`;
  const lbUrl = isHomepageUsage ? baseUrl : pageData.canonicalUrl;
  const localBusinessType = input.industrySubtype === 'medical'
    ? 'MedicalOrganization'
    : input.industrySubtype === 'financial'
      ? 'FinancialService'
      : 'LocalBusiness';

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
    '@type': localBusinessType,
    '@id': lbId,
    'name': pageData.publisher.name,
    'description': pageData.description,
    'url': lbUrl,
    'image': pageData.image,
    'inLanguage': pageData.inLanguage,
    'telephone': businessProfile?.phone,
    'email': businessProfile?.email,
    'openingHours': businessProfile?.openingHours,
    'address': address,
    'sameAs': businessProfile?.socialProfiles?.length ? businessProfile.socialProfiles : undefined,
    'foundingDate': businessProfile?.foundedDate,
    'parentOrganization': { '@id': `${baseUrl}/#organization` },
    'areaServed': pageData.areaServed ? { '@type': 'Place' as const, name: pageData.areaServed } : undefined,
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
