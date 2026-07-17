import type { RedirectScanResult } from '../../server/redirect-scanner.js';
import type { SeoAuditResult } from '../../server/seo-audit.js';

/**
 * Captured local-provider payload used to seed the loaded demo without a live crawl.
 * It intentionally carries page-level errors, warnings, and healthy pages so audit
 * filtering and Cockpit classification can be exercised from persisted data.
 */
export const LOADED_DEMO_AUDIT_FIXTURE: SeoAuditResult = {
  siteScore: 68,
  totalPages: 64,
  errors: 7,
  warnings: 12,
  infos: 9,
  pages: [
    {
      pageId: 'loaded-home',
      page: 'Home',
      slug: '',
      url: 'https://loaded-demo.example.com/',
      score: 86,
      issues: [{
        check: 'meta-description',
        severity: 'warning',
        message: 'Meta description is longer than the recommended range.',
        recommendation: 'Tighten the description around the primary service promise.',
      }],
    },
    {
      pageId: 'loaded-services',
      page: 'Enterprise SEO Services',
      slug: 'services/enterprise-seo',
      url: 'https://loaded-demo.example.com/services/enterprise-seo',
      score: 52,
      issues: [
        {
          check: 'title-missing',
          severity: 'error',
          message: 'The page is missing a title tag.',
          recommendation: 'Add a descriptive title aligned to the target keyword.',
        },
        {
          check: 'structured-data',
          severity: 'warning',
          message: 'Service schema is not present.',
          recommendation: 'Add Service schema with the canonical organization entity.',
        },
      ],
    },
    {
      pageId: 'loaded-location',
      page: 'Austin SEO Consulting',
      slug: 'locations/austin',
      url: 'https://loaded-demo.example.com/locations/austin',
      score: 61,
      issues: [
        {
          check: 'internal-links',
          severity: 'error',
          message: 'The page has no contextual inbound links.',
          recommendation: 'Link from the services hub and two relevant case studies.',
        },
        {
          check: 'image-alt',
          severity: 'warning',
          message: 'Three meaningful images have empty alt text.',
          recommendation: 'Describe the location and service context for each image.',
        },
      ],
    },
    {
      pageId: 'loaded-guide',
      page: 'Technical SEO Migration Guide',
      slug: 'guides/technical-seo-migration',
      url: 'https://loaded-demo.example.com/guides/technical-seo-migration',
      score: 78,
      issues: [{
        check: 'link-text',
        severity: 'warning',
        message: 'Several links use generic anchor text.',
        recommendation: 'Replace generic anchors with destination-specific language.',
      }],
    },
  ],
  siteWideIssues: [{
    check: 'robots-sitemap',
    severity: 'warning',
    message: 'The sitemap is referenced with a non-canonical host.',
    recommendation: 'Update robots.txt to reference the canonical HTTPS sitemap URL.',
  }],
};

/** Captured redirect-scanner payload paired with LOADED_DEMO_AUDIT_FIXTURE. */
export const LOADED_DEMO_REDIRECT_FIXTURE: RedirectScanResult = {
  chains: [{
    originalUrl: 'https://loaded-demo.example.com/resources/seo-checklist',
    hops: [
      { url: 'https://loaded-demo.example.com/resources/seo-checklist', status: 301 },
      { url: 'https://loaded-demo.example.com/guides/seo-checklist', status: 301 },
      { url: 'https://loaded-demo.example.com/guides/technical-seo-checklist', status: 200 },
    ],
    finalUrl: 'https://loaded-demo.example.com/guides/technical-seo-checklist',
    totalHops: 2,
    isLoop: false,
    foundOn: ['/', '/resources'],
    type: 'internal',
  }],
  pageStatuses: [
    {
      url: 'https://loaded-demo.example.com/',
      path: '/',
      title: 'Home',
      status: 200,
      statusText: 'OK',
      source: 'static',
    },
    {
      url: 'https://loaded-demo.example.com/resources/seo-checklist',
      path: '/resources/seo-checklist',
      title: 'SEO Checklist',
      status: 301,
      statusText: 'Moved Permanently',
      redirectsTo: 'https://loaded-demo.example.com/guides/seo-checklist',
      source: 'static',
    },
    {
      url: 'https://loaded-demo.example.com/insights/legacy-report',
      path: '/insights/legacy-report',
      title: 'Legacy Report',
      status: 404,
      statusText: 'Not Found',
      recommendedTarget: 'https://loaded-demo.example.com/insights',
      recommendedReason: 'Closest healthy section landing page.',
      source: 'cms',
    },
  ],
  summary: {
    totalPages: 64,
    healthy: 58,
    redirecting: 2,
    notFound: 2,
    errors: 2,
    chainsDetected: 1,
    longestChain: 2,
  },
  scannedAt: '2026-07-15T18:30:00.000Z',
};
