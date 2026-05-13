import type {
  IntelligenceOptions,
  SiteHealthSlice,
  RedirectDetail,
  SchemaValidationSummary,
  PerformanceSummary,
} from '../../shared/types/intelligence.js';
import type { Anomaly } from '../anomaly-detection.js';
import type { CwvSummary } from '../seo-audit.js';
import { createLogger } from '../logger.js';
import { isProgrammingError } from '../errors.js';
import { parseJsonSafe } from '../db/json-validation.js';
import { z } from '../middleware/validate.js';

const log = createLogger('workspace-intelligence/site-health');

const aeoReviewPageSchema = z.object({
  overallScore: z.unknown().optional(),
}).passthrough();

const aeoReviewLoosePageSchema = z.union([
  aeoReviewPageSchema,
  z.null(),
  z.string(),
  z.number(),
  z.boolean(),
]);

const aeoReviewFileSchema = z.object({
  pages: z.array(aeoReviewLoosePageSchema).optional(),
}).passthrough();

function normalizeAeoScore(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function parseAeoReviewPages(pages: unknown[] | undefined): Array<{ overallScore?: number }> {
  if (!pages?.length) return [];
  const valid: Array<{ overallScore?: number }> = [];
  for (const page of pages) {
    const parsed = aeoReviewPageSchema.safeParse(page);
    if (!parsed.success) continue;
    valid.push({ overallScore: normalizeAeoScore(parsed.data.overallScore) });
  }
  return valid;
}

export async function assembleSiteHealth(
  workspaceId: string,
  _opts?: IntelligenceOptions,
): Promise<SiteHealthSlice> {
  const { getWorkspace } = await import('../workspaces.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
  const workspace = getWorkspace(workspaceId);
  const siteId = workspace?.webflowSiteId ?? null;

  // Defaults — each source fills in what it can
  let auditScore: number | null = null;
  let auditScoreDelta: number | null = null;
  let deadLinks = 0;
  let redirectChains = 0;
  let schemaErrors = 0;
  let orphanPages = 0;
  const cwvPassRate: { mobile: number | null; desktop: number | null } = { mobile: null, desktop: null };
  let redirectDetails: RedirectDetail[] | undefined;
  let schemaValidation: SchemaValidationSummary | undefined;
  let performanceSummary: PerformanceSummary | null | undefined;
  let anomalyCount = 0;
  let anomalyTypes: string[] = [];
  let seoChangeVelocity = 0;
  let latestAuditCwvSummary: CwvSummary | undefined;

  // ── Audit snapshot (reports.ts) ──────────────────────────────────────
  if (siteId) {
    try {
      const { getLatestEffectiveSnapshot, listEffectiveSnapshotSummaries } = await import('../audit-snapshot-views.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const latest = getLatestEffectiveSnapshot(siteId, workspace?.auditSuppressions);
      if (latest) {
        auditScore = latest.audit.siteScore ?? null;
        latestAuditCwvSummary = latest.audit.cwvSummary;
        // Delta: compare with previous snapshot
        const summaries = listEffectiveSnapshotSummaries(siteId, workspace?.auditSuppressions);
        if (summaries.length >= 2) {
          const prevScore = summaries[1].siteScore;
          auditScoreDelta = auditScore !== null ? auditScore - prevScore : null;
        } else if (latest.previousScore !== undefined) {
          auditScoreDelta = auditScore !== null ? auditScore - latest.previousScore : null;
        }
      }
    } catch (err) {
      log.debug({ workspaceId, err }, 'siteHealth: audit snapshot failed — skipping');
    }
  }

  // ── Dead links (performance-store.ts / getLinkCheck) ────────────────
  if (siteId) {
    try {
      const { getLinkCheck } = await import('../performance-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const linkSnap = getLinkCheck(siteId);
      if (linkSnap?.result) {
        const result = linkSnap.result as { deadLinks?: unknown[] };
        deadLinks = Array.isArray(result.deadLinks) ? result.deadLinks.length : 0;
      }
    } catch (err) {
      log.debug({ workspaceId, err }, 'siteHealth: link check failed — skipping');
    }
  }

  // ── PageSpeed / CWV (performance-store.ts / getPageSpeed) ───────────
  if (siteId) {
    try {
      const { getPageSpeed } = await import('../performance-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const readSiteSpeed = (strategy: 'mobile' | 'desktop') => {
        const speedSnap = getPageSpeed(siteId, strategy);
        return speedSnap?.result as {
          pages?: Array<{ score?: number; vitals?: { LCP?: number | null; FID?: number | null; CLS?: number | null } }>;
          averageScore?: number;
          averageVitals?: { LCP?: number | null; FID?: number | null; CLS?: number | null };
        } | undefined;
      };
      const passRate = (siteSpeed: ReturnType<typeof readSiteSpeed>) => {
        const pages = siteSpeed?.pages ?? [];
        if (pages.length === 0) return null;
        const passing = pages.filter(p => (p.score ?? 0) >= 90).length;
        return passing / pages.length;
      };

      const mobileSpeed = readSiteSpeed('mobile');
      const desktopSpeed = readSiteSpeed('desktop');
      cwvPassRate.mobile = passRate(mobileSpeed);
      cwvPassRate.desktop = passRate(desktopSpeed);

      const summarySource = mobileSpeed ?? desktopSpeed;
      if (summarySource?.averageVitals) {
        // CWV pass rate: % of pages with score >= 90
        performanceSummary = {
          avgLcp: summarySource.averageVitals.LCP ?? null,
          avgFid: summarySource.averageVitals.FID ?? null,
          avgCls: summarySource.averageVitals.CLS ?? null,
          score: summarySource.averageScore ?? null,
        };
      }
    } catch (err) {
      log.debug({ workspaceId, err }, 'siteHealth: pagespeed failed — skipping');
    }
  }

  const mobileAssessment = latestAuditCwvSummary?.mobile?.assessment;
  if (cwvPassRate.mobile === null && mobileAssessment === 'good') cwvPassRate.mobile = 1;
  else if (cwvPassRate.mobile === null && (mobileAssessment === 'needs-improvement' || mobileAssessment === 'poor')) cwvPassRate.mobile = 0;

  const desktopAssessment = latestAuditCwvSummary?.desktop?.assessment;
  if (cwvPassRate.desktop === null && desktopAssessment === 'good') cwvPassRate.desktop = 1;
  else if (cwvPassRate.desktop === null && (desktopAssessment === 'needs-improvement' || desktopAssessment === 'poor')) cwvPassRate.desktop = 0;

  // ── Redirect chains (redirect-store.ts) ─────────────────────────────
  if (siteId) {
    try {
      const { getRedirectSnapshot } = await import('../redirect-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const redirSnap = getRedirectSnapshot(siteId);
      if (redirSnap?.result) {
        redirectChains = redirSnap.result.summary.chainsDetected ?? 0;
        // Map chains to RedirectDetail[]
        redirectDetails = (redirSnap.result.chains ?? []).map(chain => ({
          url: chain.originalUrl,
          target: chain.finalUrl,
          chainDepth: chain.totalHops,
          status: chain.hops[0]?.status ?? 301,
        }));
      }
    } catch (err) {
      log.debug({ workspaceId, err }, 'siteHealth: redirect snapshot failed — skipping');
    }
  }

  // ── Orphan pages (site-architecture.ts) ─────────────────────────────
  try {
    const { getCachedArchitecture, flattenTree } = await import('../site-architecture.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const arch = await Promise.race([
      getCachedArchitecture(workspaceId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (arch) {
      orphanPages = arch.orphanPaths?.length ?? 0;
      // Verify via flattenTree if orphanPaths is empty but tree has isolated nodes
      if (orphanPages === 0) {
        const nodes = flattenTree(arch.tree);
        orphanPages = nodes.filter(n => n.source === 'existing' && n.hasContent && n.depth === 1 && n.children.length === 0).length;
      }
    }
  } catch (err) {
    log.debug({ workspaceId, err }, 'siteHealth: site architecture failed — skipping');
  }

  // ── Schema errors (schema-validator.ts) ─────────────────────────────
  try {
    const { getValidations } = await import('../schema-validator.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const validations = getValidations(workspaceId);
    if (validations.length > 0) {
      let valid = 0;
      let warnings = 0;
      let errors = 0;
      for (const v of validations) {
        if (v.status === 'valid') valid++;
        else if (v.status === 'warnings') warnings++;
        else if (v.status === 'errors') errors++;
      }
      schemaValidation = { valid, warnings, errors };
      schemaErrors = errors; // count of pages with errors status
    }
  } catch (err) {
    log.debug({ workspaceId, err }, 'siteHealth: schema validation failed — skipping');
  }

  // ── Anomaly count (anomaly-detection.ts) ─────────────────────────────
  try {
    // NOTE: dynamic import required — anomaly-detection.ts statically imports from this module
    const { listAnomalies } = await import('../anomaly-detection.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const anomalies: Anomaly[] = listAnomalies(workspaceId);
    anomalyCount = anomalies.length;
    anomalyTypes = [...new Set(anomalies.map(a => a.type))];
  } catch (err) {
    if (isProgrammingError(err)) {
      log.warn({ err, workspaceId }, 'assembleSiteHealth: programming error in anomaly-detection — check export names');
    } else {
      log.debug({ err, workspaceId }, 'assembleSiteHealth: anomaly detection optional, degrading gracefully');
    }
  }

  // ── SEO change velocity (seo-change-tracker.ts) ──────────────────────
  try {
    const { getSeoChanges } = await import('../seo-change-tracker.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    // Pass 500 limit — the second param is a row limit, not days.
    // Active workspaces may exceed the default 100-row cap within 30 days.
    const changes = getSeoChanges(workspaceId, 500);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    seoChangeVelocity = changes.filter(c => c.changedAt >= thirtyDaysAgo).length;
  } catch (err) {
    log.debug({ workspaceId, err }, 'siteHealth: seo change tracker failed — skipping');
  }

  // ── Recent diagnostic reports (diagnostic-store.ts) ──────────────────
  let recentDiagnostics: SiteHealthSlice['recentDiagnostics'];
  try {
    const { listDiagnosticReports } = await import('../diagnostic-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const reports = listDiagnosticReports(workspaceId);
    recentDiagnostics = reports.slice(0, 5).map(r => ({
      insightId: r.insightId,
      anomalyType: r.anomalyType,
      status: r.status,
      affectedPages: r.affectedPages,
      completedAt: r.completedAt,
      rootCauseTitles: r.status === 'completed' && r.rootCauses.length > 0
        ? r.rootCauses.map(c => c.title)
        : undefined,
    }));
  } catch (err) {
    log.debug({ workspaceId, err }, 'siteHealth: diagnostic reports optional, degrading gracefully');
  }

  // ── AEO readiness (aeo-page-review saved reviews) ──────────────────────
  let aeoReadiness: SiteHealthSlice['aeoReadiness'];
  try {
    const fs = await import('fs'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const pathMod = await import('path'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const { getDataDir } = await import('../data-dir.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
    const reviewDir = getDataDir('aeo-reviews');
    const reviewFile = pathMod.default.join(reviewDir, `${workspaceId}.json`);
    if (fs.default.existsSync(reviewFile)) {
      const raw = parseJsonSafe(
        fs.default.readFileSync(reviewFile, 'utf-8'),
        aeoReviewFileSchema,
        { pages: [] },
        { workspaceId, field: 'aeo_review_file', table: 'aeo-reviews' },
      );
      const pages = parseAeoReviewPages(raw.pages);
      if (pages.length > 0) {
        const passing = pages.filter(p => (p.overallScore ?? 0) >= 70).length;
        aeoReadiness = {
          pagesChecked: pages.length,
          passingRate: passing / pages.length,
        };
      }
    }
  } catch (err) {
    log.debug({ workspaceId, err }, 'siteHealth: AEO readiness optional, degrading gracefully');
  }

  return {
    auditScore,
    auditScoreDelta,
    deadLinks,
    redirectChains,
    schemaErrors,
    orphanPages,
    cwvPassRate,
    redirectDetails,
    aeoReadiness,
    schemaValidation,
    performanceSummary,
    anomalyCount,
    anomalyTypes,
    seoChangeVelocity,
    recentDiagnostics,
  };
}
