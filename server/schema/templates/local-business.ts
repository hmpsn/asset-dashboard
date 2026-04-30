/**
 * LocalBusiness template. Emits address/contact/hours ONLY when the workspace
 * business profile has them — never fabricates. Healthcare subtype escalation
 * (Dentist, Physician, etc.) is deferred to the intelligence-layer follow-up.
 */
import type { PageData, BusinessProfile } from '../data-sources.js';
import { dropUndefined, withBreadcrumb } from './helpers.js';

export interface LocalBusinessInput {
  baseUrl: string;
  pageData: PageData;
  businessProfile: BusinessProfile | null;
  /** When true, WebSite.potentialAction (sitelinks SearchAction) is emitted. Mirrors Workspace.siteHasSearch. */
  siteHasSearch?: boolean;
}

export function buildLocalBusinessSchema(input: LocalBusinessInput): Record<string, unknown> {
  const { pageData, businessProfile, baseUrl, siteHasSearch } = input;

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

  // PR2: AggregateRating from rated testimonials
  const ratedTestimonials = (pageData.elements?.testimonials ?? []).filter(t => t.rating != null);
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
    'image': pageData.image,
    'inLanguage': pageData.inLanguage,
    'telephone': businessProfile?.phone,
    'email': businessProfile?.email,
    'openingHours': businessProfile?.openingHours,
    'address': address,
    'sameAs': businessProfile?.socialProfiles?.length ? businessProfile.socialProfiles : undefined,
    'foundedDate': businessProfile?.foundedDate,
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
  const lbId = `${baseUrl}/#localbusiness`;
  const reviews = (pageData.elements?.testimonials ?? [])
    .map((t, idx) => {
      if (!t.author || t.rating == null) return undefined;
      return dropUndefined({
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
      });
    })
    .filter((r): r is Record<string, unknown> => r !== undefined);

  return withBreadcrumb([organization, localBusiness, website, ...reviews], pageData);
}
