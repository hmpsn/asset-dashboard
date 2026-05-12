/**
 * Homepage template: Organization + WebSite. These are the SITEWIDE entities
 * that all other pages reference via @id, never duplicating.
 */
import type { PageData, BusinessProfile } from '../data-sources.js';
import { breadcrumbRef, dropUndefined } from './helpers.js';

export interface HomepageInput {
  baseUrl: string;
  pageData: PageData;
  /** Optional — when present, sameAs and foundingDate are emitted on the Organization node. */
  businessProfile?: BusinessProfile | null;
  /** When true, WebSite.potentialAction (sitelinks SearchAction) is emitted. Mirrors Workspace.siteHasSearch. */
  siteHasSearch?: boolean;
}

export function buildHomepageSchema(input: HomepageInput): Record<string, unknown> {
  const { baseUrl, pageData, businessProfile, siteHasSearch } = input;
  const safeSocialProfiles = businessProfile?.socialProfiles
    ?.map(url => url.trim())
    .filter(Boolean);

  const organization = dropUndefined({
    '@type': 'Organization',
    '@id': `${baseUrl}/#organization`,
    'name': pageData.publisher.name,
    'url': baseUrl,
    'description': pageData.description,
    'image': pageData.image,
    'logo': pageData.publisher.logoUrl
      ? { '@type': 'ImageObject', 'url': pageData.publisher.logoUrl }
      : undefined,
    'sameAs': safeSocialProfiles?.length ? safeSocialProfiles : undefined,
    'foundingDate': businessProfile?.foundedDate,
    'knowsAbout': pageData.knowsAbout?.length ? pageData.knowsAbout : undefined,
  });

  // NOTE: WebSite.potentialAction (sitelinks SearchAction) is gated on siteHasSearch.
  // Google requires the site actually expose a working search endpoint at the urlTemplate
  // before claiming this capability. Most workspaces have no site search, so emitting it
  // unconditionally misrepresents capability to Google. PR2 ships the admin toggle UI.
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

  const webPage = dropUndefined({
    '@type': 'WebPage' as const,
    '@id': `${baseUrl}/#webpage`,
    'url': baseUrl,
    'name': pageData.cleanTitle,
    'description': pageData.description,
    'isPartOf': { '@id': `${baseUrl}/#website` },
    'about': { '@id': `${baseUrl}/#organization` },
    'inLanguage': pageData.inLanguage,
    'breadcrumb': breadcrumbRef(baseUrl, pageData.breadcrumbs),
  });

  return { '@context': 'https://schema.org', '@graph': [organization, website, webPage] };
}
