import type { PageData } from '../data-sources.js';
import { breadcrumbRef, dropUndefined, orgRef, webSiteRef, withBreadcrumb } from './helpers.js';

export interface OfferData {
  name?: string;
  price: string;
  priceCurrency: string;
  description?: string;
}

export function buildPricingPageSchema(input: {
  baseUrl: string;
  pageData: PageData;
  offers: OfferData[];
}): Record<string, unknown> {
  const { baseUrl, pageData } = input;
  const offerNodes = input.offers.map((offer, idx) => dropUndefined({
    '@type': 'Offer' as const,
    '@id': `${pageData.canonicalUrl}#offer-${idx}`,
    'name': offer.name,
    'price': offer.price,
    'priceCurrency': offer.priceCurrency,
    'description': offer.description,
    'url': pageData.canonicalUrl,
  }));
  const primary = dropUndefined({
    '@type': 'WebPage',
    '@id': `${pageData.canonicalUrl}#webpage`,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'mainEntity': offerNodes.length > 0
      ? {
          '@type': 'ItemList',
          'itemListElement': offerNodes.map((offer, idx) => ({
            '@type': 'ListItem',
            'position': idx + 1,
            'item': { '@id': offer['@id'] },
          })),
        }
      : undefined,
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });
  return withBreadcrumb([primary, ...offerNodes], pageData);
}

export function buildProfilePageSchema(input: {
  baseUrl: string;
  pageData: PageData;
}): Record<string, unknown> {
  const { baseUrl, pageData } = input;
  const person = dropUndefined({
    '@type': 'Person',
    '@id': `${pageData.canonicalUrl}#person`,
    'name': pageData.cleanTitle || pageData.title,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'image': pageData.image,
    'worksFor': orgRef(baseUrl),
  });
  const primary = dropUndefined({
    '@type': 'ProfilePage',
    '@id': `${pageData.canonicalUrl}#profilepage`,
    'name': pageData.cleanTitle || pageData.title,
    'description': pageData.description,
    'url': pageData.canonicalUrl,
    'mainEntity': person,
    'isPartOf': webSiteRef(baseUrl),
    'breadcrumb': breadcrumbRef(pageData.canonicalUrl, pageData.breadcrumbs),
    'inLanguage': pageData.inLanguage,
  });
  return withBreadcrumb([primary, person], pageData);
}
