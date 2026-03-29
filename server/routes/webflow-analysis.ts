/**
 * webflow-analysis routes — extracted from server/index.ts
 */
import { Router } from 'express';

import { requireWorkspaceAccessFromQuery } from '../auth.js';
const router = Router();

import { addActivity } from '../activity-log.js';
import { analyzeInternalLinks } from '../internal-links.js';
import { checkSiteLinks, getSiteDomains } from '../link-checker.js';
import {
  saveLinkCheck,
  getLinkCheck,
  saveInternalLinks,
  getInternalLinks,
  saveCompetitorCompare,
  getCompetitorCompare,
  getLatestCompetitorCompareForSite,
} from '../performance-store.js';
import { scanRedirects } from '../redirect-scanner.js';
import { saveRedirectSnapshot, getRedirectSnapshot } from '../redirect-store.js';
import { runSalesAudit } from '../sales-audit.js';
import { getAllGscPages } from '../search-console.js';
import { listWorkspaces, getTokenForSite } from '../workspaces.js';
import { createLogger } from '../logger.js';
import { recordAction, getActionBySource } from '../outcome-tracking.js';

const log = createLogger('webflow-analysis');

// --- Competitor SEO Comparison ---
router.post('/api/competitor-compare', async (req, res) => {
  const { myUrl, competitorUrl, maxPages } = req.body as { myUrl: string; competitorUrl: string; maxPages?: number };
  if (!myUrl || !competitorUrl) return res.status(400).json({ error: 'myUrl and competitorUrl required' });
  const limit = Math.min(maxPages || 20, 30);
  try {
    log.info(`Comparing ${myUrl} vs ${competitorUrl} (max ${limit} pages each)`);
    const [myAudit, theirAudit] = await Promise.all([
      runSalesAudit(myUrl, limit),
      runSalesAudit(competitorUrl, limit),
    ]);

    // Build comparison metrics
    const buildMetrics = (audit: typeof myAudit) => {
      const allIssues = [...audit.siteWideIssues, ...audit.pages.flatMap(p => p.issues)];
      const checks = new Map<string, number>();
      for (const i of allIssues) checks.set(i.check, (checks.get(i.check) || 0) + 1);

      // Compute averages
      const titles = audit.pages.map(p => {
        const titleIssue = p.issues.find(i => i.check === 'title');
        return titleIssue?.value?.length || 0;
      });
      const descs = audit.pages.map(p => {
        const descIssue = p.issues.find(i => i.check === 'meta-description');
        return descIssue?.value?.length || 0;
      });
      const pagesWithOG = audit.pages.filter(p => !p.issues.some(i => i.check === 'og-tags' && i.severity === 'error')).length;
      const pagesWithSchema = audit.pages.filter(p => !p.issues.some(i => i.check === 'structured-data')).length;
      const pagesWithH1 = audit.pages.filter(p => !p.issues.some(i => i.check === 'h1' && i.severity === 'error')).length;

      return {
        score: audit.siteScore,
        totalPages: audit.totalPages,
        errors: audit.errors,
        warnings: audit.warnings,
        infos: audit.infos,
        avgTitleLen: titles.length ? Math.round(titles.reduce((a, b) => a + b, 0) / titles.length) : 0,
        avgDescLen: descs.length ? Math.round(descs.reduce((a, b) => a + b, 0) / descs.length) : 0,
        ogCoverage: audit.totalPages ? Math.round((pagesWithOG / audit.totalPages) * 100) : 0,
        schemaCoverage: audit.totalPages ? Math.round((pagesWithSchema / audit.totalPages) * 100) : 0,
        h1Coverage: audit.totalPages ? Math.round((pagesWithH1 / audit.totalPages) * 100) : 0,
        issueCounts: Object.fromEntries(checks),
      };
    };

    const myMetrics = buildMetrics(myAudit);
    const theirMetrics = buildMetrics(theirAudit);

    // Identify advantages and disadvantages
    const advantages: string[] = [];
    const disadvantages: string[] = [];
    const opportunities: string[] = [];

    if (myMetrics.score > theirMetrics.score) advantages.push(`Higher overall SEO score (${myMetrics.score} vs ${theirMetrics.score})`);
    else if (myMetrics.score < theirMetrics.score) disadvantages.push(`Lower overall SEO score (${myMetrics.score} vs ${theirMetrics.score})`);

    if (myMetrics.errors < theirMetrics.errors) advantages.push(`Fewer SEO errors (${myMetrics.errors} vs ${theirMetrics.errors})`);
    else if (myMetrics.errors > theirMetrics.errors) disadvantages.push(`More SEO errors (${myMetrics.errors} vs ${theirMetrics.errors})`);

    if (myMetrics.ogCoverage > theirMetrics.ogCoverage) advantages.push(`Better Open Graph coverage (${myMetrics.ogCoverage}% vs ${theirMetrics.ogCoverage}%)`);
    else if (myMetrics.ogCoverage < theirMetrics.ogCoverage) {
      disadvantages.push(`Lower Open Graph coverage (${myMetrics.ogCoverage}% vs ${theirMetrics.ogCoverage}%)`);
      opportunities.push('Add Open Graph tags to improve social media sharing previews');
    }

    if (myMetrics.schemaCoverage > theirMetrics.schemaCoverage) advantages.push(`Better structured data coverage (${myMetrics.schemaCoverage}% vs ${theirMetrics.schemaCoverage}%)`);
    else if (myMetrics.schemaCoverage < theirMetrics.schemaCoverage) {
      disadvantages.push(`Lower structured data coverage (${myMetrics.schemaCoverage}% vs ${theirMetrics.schemaCoverage}%)`);
      opportunities.push('Add JSON-LD structured data to earn rich snippets in search results');
    }

    if (myMetrics.h1Coverage > theirMetrics.h1Coverage) advantages.push(`Better H1 tag coverage (${myMetrics.h1Coverage}% vs ${theirMetrics.h1Coverage}%)`);
    else if (myMetrics.h1Coverage < theirMetrics.h1Coverage) {
      disadvantages.push(`Lower H1 tag coverage (${myMetrics.h1Coverage}% vs ${theirMetrics.h1Coverage}%)`);
      opportunities.push('Ensure every page has a unique H1 heading');
    }

    if (myMetrics.totalPages > theirMetrics.totalPages * 1.5) advantages.push(`More indexed content (${myMetrics.totalPages} vs ${theirMetrics.totalPages} pages)`);
    else if (theirMetrics.totalPages > myMetrics.totalPages * 1.5) {
      disadvantages.push(`Less indexed content (${myMetrics.totalPages} vs ${theirMetrics.totalPages} pages)`);
      opportunities.push('Expand content strategy — competitor has significantly more pages');
    }

    // Check for issues competitor doesn't have
    for (const [check, count] of Object.entries(myMetrics.issueCounts)) {
      const theirCount = theirMetrics.issueCounts[check] || 0;
      if (count > 0 && theirCount === 0) {
        opportunities.push(`Fix "${check}" issues — competitor has none (you have ${count})`);
      }
    }

    const compareResult = {
      mySite: { url: myAudit.url, name: myAudit.siteName, metrics: myMetrics, quickWins: myAudit.quickWins },
      competitor: { url: theirAudit.url, name: theirAudit.siteName, metrics: theirMetrics, quickWins: theirAudit.quickWins },
      advantages: advantages.slice(0, 8),
      disadvantages: disadvantages.slice(0, 8),
      opportunities: opportunities.slice(0, 8),
      comparedAt: new Date().toISOString(),
    };
    saveCompetitorCompare(myUrl, competitorUrl, compareResult);
    res.json(compareResult);
  } catch (err) {
    log.error({ err: err }, 'Competitor compare error');
    res.status(500).json({ error: 'Comparison failed' });
  }
});

// Load last saved competitor comparison (exact match)
router.get('/api/competitor-compare-snapshot', (req, res) => {
  const myUrl = req.query.myUrl as string;
  const competitorUrl = req.query.competitorUrl as string;
  if (!myUrl || !competitorUrl) return res.json(null);
  const snapshot = getCompetitorCompare(myUrl, competitorUrl);
  res.json(snapshot);
});

// Load most recent competitor comparison for a given site URL (any competitor)
router.get('/api/competitor-compare-latest', (req, res) => {
  const myUrl = req.query.myUrl as string;
  if (!myUrl) return res.json(null);
  const snapshot = getLatestCompetitorCompareForSite(myUrl);
  res.json(snapshot);
});

// --- Dead Link Checker ---

// Get available domains for a site (staging + custom)
router.get('/api/webflow/link-check-domains/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const domains = await getSiteDomains(req.params.siteId, token || '');
    if (!domains) return res.json({ staging: '', customDomains: [], defaultDomain: '' });
    res.json(domains);
  } catch (err) {
    log.error({ err: err }, 'Domain fetch error');
    res.json({ staging: '', customDomains: [], defaultDomain: '' });
  }
});

router.get('/api/webflow/link-check/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const domain = typeof req.query.domain === 'string' ? req.query.domain : undefined;
    const result = await checkSiteLinks(req.params.siteId, token, domain);
    saveLinkCheck(req.params.siteId, result);
    res.json(result);
  } catch (err) {
    log.error({ err: err }, 'Link check error');
    res.status(500).json({ error: 'Link check failed' });
  }
});

// Load last saved link check snapshot
router.get('/api/webflow/link-check-snapshot/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  const snapshot = getLinkCheck(req.params.siteId);
  res.json(snapshot);
});

// --- Redirect Scanner ---
router.get('/api/webflow/redirect-scan/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    // Resolve live domain + GSC property from workspace
    const allWs = listWorkspaces();
    const ws = allWs.find(w => w.webflowSiteId === req.params.siteId);

    // Fetch GSC ghost URLs — pages Google indexes that may no longer exist
    let gscGhostUrls: Array<{ url: string; path: string; clicks: number; impressions: number }> | undefined;
    if (ws?.gscPropertyUrl) {
      try {
        const gscPages = await getAllGscPages(ws.id, ws.gscPropertyUrl, 90);
        if (gscPages.length > 0) {
          gscGhostUrls = gscPages.map(p => {
            try {
              const parsed = new URL(p.page);
              return { url: p.page, path: parsed.pathname, clicks: p.clicks, impressions: p.impressions };
            } catch { return null; }
          }).filter(Boolean) as typeof gscGhostUrls;
          log.info(`Found ${gscPages.length} GSC pages to cross-check`);
        }
      } catch (err) {
        log.info({ detail: err instanceof Error ? err.message : String(err) }, 'GSC ghost URL fetch skipped');
      }
    }

    const result = await scanRedirects(req.params.siteId, token, ws?.liveDomain, gscGhostUrls);
    // Persist to disk so results survive deploys
    saveRedirectSnapshot(req.params.siteId, result);

    // Log to activity feed
    if (ws) {
      addActivity(ws.id, 'redirects_scanned', 'Redirect scan completed', `${result.summary.totalPages} pages scanned — ${result.summary.redirecting} redirects, ${result.summary.notFound} not found, ${result.chains.length} chains`);
    }

    res.json(result);
  } catch (err) {
    log.error({ err: err }, 'Redirect scan error');
    res.status(500).json({ error: 'Redirect scan failed' });
  }
});

// Load previously saved redirect scan results from disk
router.get('/api/webflow/redirect-snapshot/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  const snapshot = getRedirectSnapshot(req.params.siteId);
  if (!snapshot) return res.json(null);
  res.json(snapshot);
});

// --- Internal Linking Suggestions ---
router.get('/api/webflow/internal-links/:siteId', requireWorkspaceAccessFromQuery(), async (req, res) => {
  try {
    const token = getTokenForSite(req.params.siteId) || undefined;
    const workspaceId = req.query.workspaceId as string | undefined;
    const result = await analyzeInternalLinks(req.params.siteId, workspaceId, token);
    saveInternalLinks(req.params.siteId, result);

    try {
      for (const suggestion of result.suggestions.slice(0, 5)) {
        const sourceId = suggestion.toPage ?? null;
        if (!sourceId) continue;
        if (getActionBySource('internal_link', sourceId)) continue;
        recordAction({
          workspaceId: workspaceId ?? req.params.siteId,
          actionType: 'internal_link_added',
          sourceType: 'internal_link',
          sourceId,
          pageUrl: sourceId,
          targetKeyword: null,
          baselineSnapshot: { captured_at: new Date().toISOString() },
          attribution: 'not_acted_on',
        });
      }
    } catch (err) {
      log.warn({ err }, 'Failed to record outcome actions for internal link suggestions');
    }

    res.json(result);
  } catch (err) {
    log.error({ err: err }, 'Internal links error');
    res.status(500).json({ error: 'Internal link analysis failed' });
  }
});

// Load last saved internal links snapshot
router.get('/api/webflow/internal-links-snapshot/:siteId', requireWorkspaceAccessFromQuery(), (req, res) => {
  const snapshot = getInternalLinks(req.params.siteId);
  res.json(snapshot);
});

export default router;
