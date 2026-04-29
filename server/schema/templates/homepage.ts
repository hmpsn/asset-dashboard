/**
 * Homepage template: Organization + WebSite. These are the SITEWIDE entities
 * that all other pages reference via @id, never duplicating.
 */
import type { PageData, BusinessProfile } from '../data-sources.js';
import { dropUndefined } from './helpers.js';

export interface HomepageInput {
  baseUrl: string;
  pageData: PageData;
  /** Optional — when present, sameAs and foundedDate are emitted on the Organization node. */
  businessProfile?: BusinessProfile | null;
}

export function buildHomepageSchema(input: HomepageInput): Record<string, unknown> {
  const { baseUrl, pageData, businessProfile } = input;

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
    'sameAs': businessProfile?.socialProfiles?.length ? businessProfile.socialProfiles : undefined,
    'foundedDate': businessProfile?.foundedDate,
  });

  // NOTE: WebSite.potentialAction (sitelinks SearchAction) is intentionally NOT emitted.
  // Google requires the site actually expose a working search endpoint at the urlTemplate
  // before claiming this capability. Most workspaces (including hmpsn studio) have no site
  // search; emitting it unconditionally misrepresents capability to Google. Re-add when
  // a workspace-level signal (Workspace.siteHasSearch or auto-detected <form action>)
  // confirms search exists. Tracked: schema-yoast-parity-fields roadmap item.
  const website = {
    '@type': 'WebSite',
    '@id': `${baseUrl}/#website`,
    'name': pageData.publisher.name,
    'url': baseUrl,
    'publisher': { '@id': `${baseUrl}/#organization` },
    'inLanguage': pageData.inLanguage,
  };

  return { '@context': 'https://schema.org', '@graph': [organization, website] };
}
