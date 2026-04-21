import { discoverCmsUrls, buildStaticPathSet } from './webflow.js';
import { resolvePagePath } from './helpers.js';
import { createLogger } from './logger.js';
import { getWorkspacePages } from './workspace-data.js';
import { listWorkspaces, getWorkspace } from './workspaces.js';
import { getSiteSubdomain } from './webflow-pages.js';

const log = createLogger('pagespeed');
const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export interface CoreWebVitals {
  LCP: number | null;   // Largest Contentful Paint (ms)
  FID: number | null;   // First Input Delay (ms)
  CLS: number | null;   // Cumulative Layout Shift
  FCP: number | null;   // First Contentful Paint (ms)
  INP: number | null;   // Interaction to Next Paint (ms) — replaces FID
  SI: number | null;    // Speed Index (ms) — lab only
  TBT: number | null;   // Total Blocking Time (ms) — lab only
  TTI: number | null;   // Time to Interactive (ms) — lab only
}

export interface PageSpeedResult {
  url: string;
  page: string;
  strategy: 'mobile' | 'desktop';
  score: number;          // Lighthouse lab score (diagnostic, NOT a ranking signal)
  vitals: CoreWebVitals;
  cwvAssessment?: CwvAssessmentResult; // CrUX field-data pass/fail — the actual ranking signal
  opportunities: Opportunity[];
  diagnostics: Diagnostic[];
  fetchedAt: string;
  fieldDataAvailable: boolean; // true = CrUX real-user data used for vitals
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
      log.error({ detail: body.slice(0, 200) }, `PageSpeed API error for ${url}: ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json() as Record<string, unknown>;
  } catch (err) { log.warn({ err }, `pagespeed: fetch error for ${url}`); return null; } // catch-ok: network failure or timeout — expected but warn so API key/billing issues surface
}

// CrUX field data metric keys in the PSI API response
interface CrUXMetric { percentile: number; category?: string }
interface CrUXMetrics {
  LARGEST_CONTENTFUL_PAINT_MS?: CrUXMetric;
  CUMULATIVE_LAYOUT_SHIFT_SCORE?: CrUXMetric;
  FIRST_CONTENTFUL_PAINT_MS?: CrUXMetric;
  FIRST_INPUT_DELAY_MS?: CrUXMetric;
  INTERACTION_TO_NEXT_PAINT?: CrUXMetric;
  EXPERIMENTAL_TIME_TO_FIRST_BYTE?: CrUXMetric;
}
interface LoadingExperience {
  metrics?: CrUXMetrics;
  overall_category?: string;
}

function extractFieldVitals(data: Record<string, unknown>): { vitals: Partial<CoreWebVitals>; available: boolean } {
  const le = (data as { loadingExperience?: LoadingExperience })?.loadingExperience;
  const m = le?.metrics;
  if (!m) return { vitals: {}, available: false };

  const hasAny = !!(m.LARGEST_CONTENTFUL_PAINT_MS || m.CUMULATIVE_LAYOUT_SHIFT_SCORE || m.FIRST_CONTENTFUL_PAINT_MS);
  if (!hasAny) return { vitals: {}, available: false };

  return {
    vitals: {
      LCP: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
      CLS: m.CUMULATIVE_LAYOUT_SHIFT_SCORE ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
      FCP: m.FIRST_CONTENTFUL_PAINT_MS?.percentile ?? null,
      FID: m.FIRST_INPUT_DELAY_MS?.percentile ?? null,
      INP: m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    },
    available: true,
  };
}

// CWV pass/fail assessment — the ACTUAL Google ranking signal (not the Lighthouse score)
export type CwvAssessment = 'good' | 'needs-improvement' | 'poor' | 'no-data';

export interface CwvAssessmentResult {
  assessment: CwvAssessment;
  fieldDataAvailable: boolean;
  metrics: {
    LCP: { value: number | null; rating: 'good' | 'needs-improvement' | 'poor' | null };
    INP: { value: number | null; rating: 'good' | 'needs-improvement' | 'poor' | null };
    CLS: { value: number | null; rating: 'good' | 'needs-improvement' | 'poor' | null };
  };
}

function rateCwvMetric(
  metric: CrUXMetric | undefined,
  thresholds: [number, number],
): 'good' | 'needs-improvement' | 'poor' | null {
  if (!metric) return null;
  const v = metric.percentile;
  if (v <= thresholds[0]) return 'good';
  if (v <= thresholds[1]) return 'needs-improvement';
  return 'poor';
}

export function extractCwvAssessment(data: Record<string, unknown>): CwvAssessmentResult {
  const le = (data as { loadingExperience?: LoadingExperience })?.loadingExperience;
  const m = le?.metrics;

  if (!m || !m.LARGEST_CONTENTFUL_PAINT_MS) {
    return {
      assessment: 'no-data',
      fieldDataAvailable: false,
      metrics: {
        LCP: { value: null, rating: null },
        INP: { value: null, rating: null },
        CLS: { value: null, rating: null },
      },
    };
  }

  const lcpRating = rateCwvMetric(m.LARGEST_CONTENTFUL_PAINT_MS, [2500, 4000]);
  const inpRating = rateCwvMetric(m.INTERACTION_TO_NEXT_PAINT, [200, 500]);
  const clsVal = m.CUMULATIVE_LAYOUT_SHIFT_SCORE;
  const clsRating = clsVal
    ? (clsVal.percentile / 100 <= 0.1 ? 'good' : clsVal.percentile / 100 <= 0.25 ? 'needs-improvement' : 'poor') as 'good' | 'needs-improvement' | 'poor'
    : null;

  const ratings = [lcpRating, inpRating, clsRating].filter(Boolean) as string[];
  let assessment: CwvAssessment = 'good';
  if (ratings.includes('poor')) assessment = 'poor';
  else if (ratings.includes('needs-improvement')) assessment = 'needs-improvement';

  return {
    assessment,
    fieldDataAvailable: true,
    metrics: {
      LCP: { value: m.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null, rating: lcpRating },
      INP: { value: m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null, rating: inpRating },
      CLS: { value: clsVal ? clsVal.percentile / 100 : null, rating: clsRating },
    },
  };
}

function extractLabVitals(data: Record<string, unknown>): CoreWebVitals {
  const audits = (data as { lighthouseResult?: { audits?: Record<string, { numericValue?: number }> } })
    ?.lighthouseResult?.audits || {};

  return {
    LCP: audits['largest-contentful-paint']?.numericValue ?? null,
    FID: audits['max-potential-fid']?.numericValue ?? null,
    CLS: audits['cumulative-layout-shift']?.numericValue ?? null,
    FCP: audits['first-contentful-paint']?.numericValue ?? null,
    INP: null, // lab has no INP equivalent
    SI: audits['speed-index']?.numericValue ?? null,
    TBT: audits['total-blocking-time']?.numericValue ?? null,
    TTI: audits['interactive']?.numericValue ?? null,
  };
}

function extractVitals(data: Record<string, unknown>): { vitals: CoreWebVitals; fieldDataAvailable: boolean } {
  const lab = extractLabVitals(data);
  const field = extractFieldVitals(data);

  if (!field.available) {
    return { vitals: lab, fieldDataAvailable: false };
  }

  // Prefer CrUX field data for ranking-relevant metrics; keep lab-only metrics from Lighthouse
  return {
    vitals: {
      LCP: field.vitals.LCP ?? lab.LCP,
      FID: field.vitals.FID ?? lab.FID,
      CLS: field.vitals.CLS ?? lab.CLS,
      FCP: field.vitals.FCP ?? lab.FCP,
      INP: field.vitals.INP ?? null,
      SI: lab.SI,    // lab only
      TBT: lab.TBT,  // lab only
      TTI: lab.TTI,  // lab only
    },
    fieldDataAvailable: true,
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
  log.info(`PageSpeed: testing single page ${url} (${strategy})`);
  const data = await runPageSpeed(url, strategy);
  if (!data) return null;

  const { vitals, fieldDataAvailable } = extractVitals(data);
  const cwv = extractCwvAssessment(data);
  return {
    url,
    page: pageTitle || url.replace(/https?:\/\/[^/]+\/?/, '/') || '/',
    strategy,
    score: extractScore(data),
    vitals,
    cwvAssessment: cwv.fieldDataAvailable ? cwv : undefined,
    opportunities: extractOpportunities(data),
    diagnostics: extractDiagnostics(data),
    fetchedAt: new Date().toISOString(),
    fieldDataAvailable,
  };
}

export async function runSiteSpeed(
  siteId: string,
  strategy: 'mobile' | 'desktop' = 'mobile',
  maxPages: number = 5,
  workspaceId?: string,
): Promise<SiteSpeedResult> {
  const wsId = workspaceId || listWorkspaces().find(w => w.webflowSiteId === siteId)?.id;
  const ws = wsId ? getWorkspace(wsId) : undefined;
  const token = ws?.webflowToken || process.env.WEBFLOW_API_TOKEN || '';
  let subdomain: string | null = null;
  try { subdomain = await getSiteSubdomain(siteId, token); } catch { /* no token configured */ }
  const baseUrl = subdomain ? `https://${subdomain}.webflow.io` : '';

  if (!baseUrl) {
    return { siteId, strategy, pages: [], averageScore: 0, averageVitals: { LCP: null, FID: null, CLS: null, FCP: null, INP: null, SI: null, TBT: null, TTI: null }, testedAt: new Date().toISOString() };
  }

  const published = wsId ? await getWorkspacePages(wsId, siteId) : [];

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
  log.info(`PageSpeed: testing ${pagesToTest.length} static + ${cmsUrls.length} CMS pages on ${baseUrl} (${strategy})`);

  const results: PageSpeedResult[] = [];

  // Run sequentially to avoid rate limiting
  for (const page of pagesToTest) {
    // Use publishedPath for full URL (handles nested pages like /about/team)
    const pagePath = resolvePagePath(page);
    const url = pagePath ? `${baseUrl}${pagePath}` : baseUrl;
    log.info(`PageSpeed: testing ${url}...`);

    const data = await runPageSpeed(url, strategy);
    if (!data) continue;

    const { vitals, fieldDataAvailable } = extractVitals(data);
    results.push({
      url,
      page: page.title,
      strategy,
      score: extractScore(data),
      vitals,
      opportunities: extractOpportunities(data),
      diagnostics: extractDiagnostics(data),
      fetchedAt: new Date().toISOString(),
      fieldDataAvailable,
    });
  }

  // Run CMS pages sequentially too
  for (const cmsPage of cmsUrls) {
    log.info(`PageSpeed: testing CMS page ${cmsPage.url}...`);
    const data = await runPageSpeed(cmsPage.url, strategy);
    if (!data) continue;
    const { vitals: cmsVitals, fieldDataAvailable: cmsFieldData } = extractVitals(data);
    results.push({
      url: cmsPage.url,
      page: `${cmsPage.pageName} (CMS)`,
      strategy,
      score: extractScore(data),
      vitals: cmsVitals,
      opportunities: extractOpportunities(data),
      diagnostics: extractDiagnostics(data),
      fetchedAt: new Date().toISOString(),
      fieldDataAvailable: cmsFieldData,
    });
  }

  // Compute averages
  const avgScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
    : 0;

  const avgVitals: CoreWebVitals = { LCP: null, FID: null, CLS: null, FCP: null, INP: null, SI: null, TBT: null, TTI: null };
  const vitalKeys: (keyof CoreWebVitals)[] = ['LCP', 'FID', 'CLS', 'FCP', 'INP', 'SI', 'TBT', 'TTI'];
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
