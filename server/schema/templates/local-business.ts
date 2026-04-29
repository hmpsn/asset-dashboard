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
}

export function buildLocalBusinessSchema(input: LocalBusinessInput): Record<string, unknown> {
  const { pageData, businessProfile, baseUrl } = input;

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
  });

  const localBusiness = dropUndefined({
    '@type': 'LocalBusiness',
    '@id': `${baseUrl}/#localbusiness`,
    'name': pageData.cleanTitle ?? pageData.publisher.name,
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
  });

  // Emit the same WebSite sitewide entity that buildHomepageSchema does — Google
  // uses this for the sitelinks search box and site-name display in search results.
  // Local business homepages need it just as much as regular homepages.
  const website = {
    '@type': 'WebSite',
    '@id': `${baseUrl}/#website`,
    'name': pageData.publisher.name,
    'url': baseUrl,
    'publisher': { '@id': `${baseUrl}/#organization` },
  };

  return withBreadcrumb([organization, localBusiness, website], pageData);
}
