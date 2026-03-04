import { listPages, filterPublishedPages, discoverCmsUrls, buildStaticPathSet } from './webflow.js';

const WEBFLOW_API = 'https://api.webflow.com/v2';
const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export interface CoreWebVitals {
  LCP: number | null;   // Largest Contentful Paint (ms)
  FID: number | null;   // First Input Delay (ms)
  CLS: number | null;   // Cumulative Layout Shift
  FCP: number | null;   // First Contentful Paint (ms)
  SI: number | null;    // Speed Index (ms)
  TBT: number | null;   // Total Blocking Time (ms)
  TTI: number | null;   // Time to Interactive (ms)
}

export interface PageSpeedResult {
  url: string;
  page: string;
  strategy: 'mobile' | 'desktop';
  score: number;
  vitals: CoreWebVitals;
  opportunities: Opportunity[];
  diagnostics: Diagnostic[];
  fetchedAt: string;
}

export interface Opportunity {
  id: string;
  title: string;
  description: string;
  savings: string | null; // e.g. "1.2 s" or "120 KiB"
  score: number;
}

export interface Diagnostic {
  id: string;
  title: string;
  description: string;
  displayValue?: string;
}

export interface SiteSpeedResult {
  siteId: string;
  strategy: 'mobile' | 'desktop';
  pages: PageSpeedResult[];
  averageScore: number;
  averageVitals: CoreWebVitals;
  testedAt: string;
}

async function getSiteSubdomain(siteId: string, token: string): Promise<string | null> {
  const res = await fetch(`${WEBFLOW_API}/sites/${siteId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return null;
  const data = await res.json() as { shortName?: string };
  return data.shortName || null;
}

async function runPageSpeed(url: string, strategy: 'mobile' | 'desktop'): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    url,
    strategy,
    category: 'performance',
  });

  // Use API key if available (25k/day vs 25/day without)
  const apiKey = process.env.GOOGLE_PSI_KEY || process.env.GOOGLE_API_KEY || '';
  if (apiKey) params.set('key', apiKey);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout per page

    const res = await fetch(`${PSI_API}?${params}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`PageSpeed API error for ${url}: ${res.status} ${res.statusText}`, body.slice(0, 200));
      return null;
    }
    return await res.json() as Record<string, unknown>;
  } catch (err) {
    console.error(`PageSpeed fetch error for ${url}:`, err);
    return null;
  }
}

function extractVitals(data: Record<string, unknown>): CoreWebVitals {
  const audits = (data as { lighthouseResult?: { audits?: Record<string, { numericValue?: number }> } })
    ?.lighthouseResult?.audits || {};

  return {
    LCP: audits['largest-contentful-paint']?.numericValue ?? null,
    FID: audits['max-potential-fid']?.numericValue ?? null,
    CLS: audits['cumulative-layout-shift']?.numericValue ?? null,
    FCP: audits['first-contentful-paint']?.numericValue ?? null,
    SI: audits['speed-index']?.numericValue ?? null,
    TBT: audits['total-blocking-time']?.numericValue ?? null,
    TTI: audits['interactive']?.numericValue ?? null,
  };
}

function extractScore(data: Record<string, unknown>): number {
  const cat = (data as { lighthouseResult?: { categories?: { performance?: { score?: number } } } })
    ?.lighthouseResult?.categories?.performance;
  return Math.round((cat?.score ?? 0) * 100);
}

interface LHAudit {
  id?: string;
  title?: string;
  description?: string;
  score?: number | null;
  numericValue?: number;
  displayValue?: string;
  details?: { overallSavingsMs?: number; overallSavingsBytes?: number };
}

function extractOpportunities(data: Record<string, unknown>): Opportunity[] {
  const lh = (data as { lighthouseResult?: { audits?: Record<string, LHAudit> } })?.lighthouseResult;
  const audits = lh?.audits || {};
  const opps: Opportunity[] = [];

  const oppKeys = [
    'render-blocking-resources', 'unused-css-rules', 'unused-javascript',
    'modern-image-formats', 'offscreen-images', 'efficiently-encode-images',
    'uses-text-compression', 'uses-responsive-images', 'unminified-css',
    'unminified-javascript', 'uses-optimized-images', 'uses-rel-preconnect',
    'server-response-time', 'redirects', 'uses-rel-preload',
    'uses-http2', 'efficient-animated-content', 'duplicated-javascript',
    'legacy-javascript', 'preload-lcp-image', 'total-byte-weight',
    'dom-size', 'critical-request-chains', 'largest-contentful-paint-element',
  ];

  for (const key of oppKeys) {
    const audit = audits[key];
    if (!audit || audit.score === 1 || audit.score === null) continue;

    let savings: string | null = null;
    if (audit.details?.overallSavingsMs) {
      savings = `${(audit.details.overallSavingsMs / 1000).toFixed(1)} s`;
    } else if (audit.details?.overallSavingsBytes) {
      const kb = audit.details.overallSavingsBytes / 1024;
      savings = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
    }

    opps.push({
      id: key,
      title: audit.title || key,
      description: (audit.description || '').replace(/\[.*?\]\(.*?\)/g, '').trim(),
      savings,
      score: audit.score ?? 0,
    });
  }

  return opps.sort((a, b) => a.score - b.score);
}

function extractDiagnostics(data: Record<string, unknown>): Diagnostic[] {
  const lh = (data as { lighthouseResult?: { audits?: Record<string, LHAudit> } })?.lighthouseResult;
  const audits = lh?.audits || {};
  const diags: Diagnostic[] = [];

  const diagKeys = [
    'font-display', 'uses-passive-event-listeners', 'no-document-write',
    'third-party-summary', 'mainthread-work-breakdown', 'bootup-time',
    'layout-shift-elements', 'long-tasks', 'non-composited-animations',
    'unsized-images', 'viewport',
  ];

  for (const key of diagKeys) {
    const audit = audits[key];
    if (!audit || audit.score === 1) continue;

    diags.push({
      id: key,
      title: audit.title || key,
      description: (audit.description || '').replace(/\[.*?\]\(.*?\)/g, '').trim(),
      displayValue: audit.displayValue,
    });
  }

  return diags;
}

// Single page speed test — user picks the page
export async function runSinglePageSpeed(
  url: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
  pageTitle: string = '',
): Promise<PageSpeedResult | null> {
  console.log(`PageSpeed: testing single page ${url} (${strategy})`);
  const data = await runPageSpeed(url, strategy);
  if (!data) return null;

  return {
    url,
    page: pageTitle || url.replace(/https?:\/\/[^/]+\/?/, '/') || '/',
    strategy,
    score: extractScore(data),
    vitals: extractVitals(data),
    opportunities: extractOpportunities(data),
    diagnostics: extractDiagnostics(data),
    fetchedAt: new Date().toISOString(),
  };
}

export async function runSiteSpeed(
  siteId: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
  maxPages: number = 5,
  tokenOverride?: string,
): Promise<SiteSpeedResult> {
  const token = tokenOverride || process.env.WEBFLOW_API_TOKEN || '';
  const subdomain = await getSiteSubdomain(siteId, token);
  const baseUrl = subdomain ? `https://${subdomain}.webflow.io` : '';

  if (!baseUrl) {
    return { siteId, strategy, pages: [], averageScore: 0, averageVitals: { LCP: null, FID: null, CLS: null, FCP: null, SI: null, TBT: null, TTI: null }, testedAt: new Date().toISOString() };
  }

  const allPages = await listPages(siteId, tokenOverride);
  const published = filterPublishedPages(allPages);

  // Prioritize: homepage first, then shortest slugs (important pages)
  const sorted = [...published].sort((a, b) => {
    if (!a.slug) return -1;
    if (!b.slug) return 1;
    return a.slug.length - b.slug.length;
  });

  // Reserve 1-2 slots for CMS pages if available
  const cmsSlots = Math.min(2, Math.max(1, Math.floor(maxPages * 0.3)));
  const staticSlots = maxPages - cmsSlots;
  const pagesToTest = sorted.slice(0, staticSlots);

  // Discover CMS pages and add a sample
  const staticPaths = buildStaticPathSet(published);
  const { cmsUrls } = await discoverCmsUrls(baseUrl, staticPaths, cmsSlots);
  console.log(`PageSpeed: testing ${pagesToTest.length} static + ${cmsUrls.length} CMS pages on ${baseUrl} (${strategy})`);

  const results: PageSpeedResult[] = [];

  // Run sequentially to avoid rate limiting
  for (const page of pagesToTest) {
    const url = page.slug ? `${baseUrl}/${page.slug}` : baseUrl;
    console.log(`PageSpeed: testing ${url}...`);

    const data = await runPageSpeed(url, strategy);
    if (!data) continue;

    results.push({
      url,
      page: page.title,
      strategy,
      score: extractScore(data),
      vitals: extractVitals(data),
      opportunities: extractOpportunities(data),
      diagnostics: extractDiagnostics(data),
      fetchedAt: new Date().toISOString(),
    });
  }

  // Run CMS pages sequentially too
  for (const cmsPage of cmsUrls) {
    console.log(`PageSpeed: testing CMS page ${cmsPage.url}...`);
    const data = await runPageSpeed(cmsPage.url, strategy);
    if (!data) continue;
    results.push({
      url: cmsPage.url,
      page: `${cmsPage.pageName} (CMS)`,
      strategy,
      score: extractScore(data),
      vitals: extractVitals(data),
      opportunities: extractOpportunities(data),
      diagnostics: extractDiagnostics(data),
      fetchedAt: new Date().toISOString(),
    });
  }

  // Compute averages
  const avgScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
    : 0;

  const avgVitals: CoreWebVitals = { LCP: null, FID: null, CLS: null, FCP: null, SI: null, TBT: null, TTI: null };
  const vitalKeys: (keyof CoreWebVitals)[] = ['LCP', 'FID', 'CLS', 'FCP', 'SI', 'TBT', 'TTI'];
  for (const key of vitalKeys) {
    const vals = results.map(r => r.vitals[key]).filter((v): v is number => v !== null);
    if (vals.length > 0) {
      avgVitals[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }

  return {
    siteId,
    strategy,
    pages: results,
    averageScore: avgScore,
    averageVitals: avgVitals,
    testedAt: new Date().toISOString(),
  };
}
