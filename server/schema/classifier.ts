/**
 * Deterministic URL → schema.org @type classifier.
 * Pure function. No AI, no DB.
 *
 * MVP page kinds: Homepage, BlogPosting, BlogIndex, Service, ServiceIndex,
 * CaseStudy, CaseStudyIndex, AboutPage, ContactPage, Legal, WebPage.
 */

export type PageKind =
  | 'Homepage'
  | 'BlogPosting'
  | 'BlogIndex'
  | 'Service'
  | 'ServiceIndex'
  | 'CaseStudy'
  | 'CaseStudyIndex'
  | 'AboutPage'
  | 'ContactPage'
  | 'Location'
  | 'Legal'
  | 'WebPage';

export type BusinessKind = 'local' | 'remote' | 'unknown';

export interface ClassifyOpts {
  /** When 'local', the homepage emits LocalBusiness instead of Organization. */
  businessKind?: BusinessKind;
}

export interface ClassifiedPage {
  kind: PageKind;
  /** The primary schema.org @type that should appear in the @graph. */
  primaryType: string;
  /** Path stripped of query/fragment/trailing slash, lowercased. Used for templates. */
  pagePath: string;
}

function normalizePath(url: string, baseUrl: string): string {
  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname;
  } catch { // catch-ok: malformed URL falls back to string replacement
    path = url.replace(baseUrl, '') || '/';
  }
  // Strip query and fragment (URL.pathname already does), then trailing slash (keep '/' for root)
  path = path.split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path.toLowerCase();
}

export function classifyPage(url: string, baseUrl: string, opts: ClassifyOpts = {}): ClassifiedPage {
  const path = normalizePath(url, baseUrl);

  if (path === '' || path === '/') {
    const primaryType = opts.businessKind === 'local' ? 'LocalBusiness' : 'Organization';
    return { kind: 'Homepage', primaryType, pagePath: '/' };
  }

  if (/^\/about(-us)?$/.test(path)) {
    return { kind: 'AboutPage', primaryType: 'AboutPage', pagePath: path };
  }
  if (/^\/contact(-us)?$/.test(path)) {
    return { kind: 'ContactPage', primaryType: 'ContactPage', pagePath: path };
  }
  if (/^\/(privacy(-policy)?|terms(-of-(service|use))?|legal|cookie(-policy)?|disclaimer)$/.test(path)) {
    return { kind: 'Legal', primaryType: 'WebPage', pagePath: path };
  }

  // Blog detail vs blog index
  if (/^\/(blog|insights?|articles?|news|posts?)\/.+/.test(path)) {
    return { kind: 'BlogPosting', primaryType: 'BlogPosting', pagePath: path };
  }
  if (/^\/(blog|insights?|articles?|news|posts?)$/.test(path)) {
    return { kind: 'BlogIndex', primaryType: 'CollectionPage', pagePath: path };
  }

  // Service detail vs index
  if (/^\/services?\/[^/]+/.test(path)) {
    return { kind: 'Service', primaryType: 'Service', pagePath: path };
  }
  if (/^\/services?$/.test(path)) {
    return { kind: 'ServiceIndex', primaryType: 'CollectionPage', pagePath: path };
  }

  // Case study
  if (/^\/(our-work|case-stud(y|ies)|portfolio|projects?|work)\/.+/.test(path)) {
    return { kind: 'CaseStudy', primaryType: 'Article', pagePath: path };
  }
  if (/^\/(our-work|case-stud(y|ies)|portfolio|projects?|work)$/.test(path)) {
    return { kind: 'CaseStudyIndex', primaryType: 'CollectionPage', pagePath: path };
  }

  // Location detail pages (dental/medical/retail chains with per-location pages)
  if (/^\/(locations?|branch(?:es)?|offices?|clinics?|studios?|stores?)\/.+/.test(path)) {
    return { kind: 'Location', primaryType: 'LocalBusiness', pagePath: path };
  }

  return { kind: 'WebPage', primaryType: 'WebPage', pagePath: path };
}
