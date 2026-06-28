import type {
  IntelligenceOptions,
  SiteHealthSlice,
  RedirectDetail,
  SchemaValidationSummary,
  PerformanceSummary,
} from '../../shared/types/intelligence.js';
import type { CwvSummary } from '../seo-audit-cwv-types.js';
import { createLogger } from '../logger.js';
import { parseJsonSafe } from '../db/json-validation.js';
import { z } from '../middleware/validate.js';
import { readOptionalSlicePart } from './optional-slice-part.js';

const log = createLogger('workspace-intelligence/site-health');

type AuditSnapshotViewsModule = {
  getLatestEffectiveSnapshot: (
    siteId: string,
    suppressions: unknown[] | undefined,
  ) => {
    audit: {
      siteScore?: number | null;
      cwvSummary?: CwvSummary;
      pages?: unknown[];
      deadLinkDetails?: unknown;
      deadLinkSummary?: { total?: unknown };
    };
    previousScore?: number;
  } | null;
  listEffectiveSnapshotSummaries: (
    siteId: string,
    suppressions: unknown[] | undefined,
  ) => Array<{ siteScore: number }>;
};

type AnomalyDetectionModule = {
  listAnomalies: (workspaceId: string) => Array<{ type: string }>;
};

type WorkspaceMetricsSnapshotsModule = {
  getSnapshots: (workspaceId: string, limit?: number) => Array<{
    snapshotDate: string;
    totalClicks: number;
    totalImpressions: number;
    avgPosition: number;
    auditScore: number | null;
    organicTrafficValue: number;
  }>;
};

function serverModulePath(
  name: 'audit-snapshot-views' | 'anomaly-detection' | 'workspace-metrics-snapshots',
): `../${typeof name}.js` {
  return `../${name}.js`;
}

const aeoReviewPageSchema = z
  .object({
    overallScore: z.unknown().optional(),
  })
  .passthrough();

const aeoReviewLoosePageSchema = z.union([
  aeoReviewPageSchema,
  z.null(),
  z.string(),
  z.number(),
  z.boolean(),
]);

const aeoReviewFileSchema = z
  .object({
    pages: z.array(aeoReviewLoosePageSchema).optional(),
  })
  .passthrough();

function normalizeAeoScore(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function parseAeoReviewPages(
  pages: unknown[] | undefined,
): Array<{ overallScore?: number }> {
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
  const cwvPassRate: { mobile: number | null; desktop: number | null } = {
    mobile: null,
    desktop: null,
  };
  let redirectDetails: RedirectDetail[] | undefined;
  let schemaValidation: SchemaValidationSummary | undefined;
  let performanceSummary: PerformanceSummary | null | undefined;
  let anomalyCount = 0;
  let anomalyTypes: string[] = [];
  let seoChangeVelocity = 0;
  let latestAuditCwvSummary: CwvSummary | undefined;
  let auditDeadLinksFallback = 0;

  // ── Audit snapshot (reports.ts) ──────────────────────────────────────
  if (siteId) {
    const auditSnapshot = await readOptionalSlicePart<{
      auditDeadLinksFallback: number;
      auditScore: number | null;
      auditScoreDelta: number | null;
      latestAuditCwvSummary: CwvSummary | undefined;
    }>(
      'siteHealth: audit snapshot',
      workspaceId,
      {
        auditDeadLinksFallback: 0,
        auditScore: null,
        auditScoreDelta: null,
        latestAuditCwvSummary: undefined,
      },
      async () => {
        const { getLatestEffectiveSnapshot, listEffectiveSnapshotSummaries } =
          await import(serverModulePath('audit-snapshot-views')) as AuditSnapshotViewsModule; // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
        const latest = getLatestEffectiveSnapshot(siteId, workspace?.auditSuppressions);
        if (latest) {
          const nextAuditScore = latest.audit.siteScore ?? null;
          let nextAuditScoreDelta: number | null = null;
          const summaries = listEffectiveSnapshotSummaries(siteId, workspace?.auditSuppressions);
          if (summaries.length >= 2) {
            const prevScore = summaries[1].siteScore;
            nextAuditScoreDelta =
              nextAuditScore !== null ? nextAuditScore - prevScore : null;
          } else if (latest.previousScore !== undefined) {
            nextAuditScoreDelta =
              nextAuditScore !== null
                ? nextAuditScore - latest.previousScore
                : null;
          }
          return {
            auditScore: nextAuditScore,
            auditScoreDelta: nextAuditScoreDelta,
            latestAuditCwvSummary: latest.audit.cwvSummary,
            auditDeadLinksFallback: auditDeadLinkCount(latest.audit),
          };
        }
        return {
          auditScore: null,
          auditScoreDelta: null,
          latestAuditCwvSummary: undefined,
          auditDeadLinksFallback: 0,
        };
      },
      {
        logger: log,
        debugMessage: 'siteHealth: audit snapshot failed — skipping',
      },
    );
    auditScore = auditSnapshot.auditScore;
    auditScoreDelta = auditSnapshot.auditScoreDelta;
    latestAuditCwvSummary = auditSnapshot.latestAuditCwvSummary;
    auditDeadLinksFallback = auditSnapshot.auditDeadLinksFallback;
  }

  // ── Dead links (performance-store.ts / getLinkCheck) ────────────────
  if (siteId) {
    deadLinks = await readOptionalSlicePart(
      'siteHealth: link check',
      workspaceId,
      auditDeadLinksFallback,
      async () => {
        const { getLinkCheck } = await import('../performance-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
        const linkSnap = getLinkCheck(siteId);
        if (linkSnap?.result) {
          return deadLinkCount(linkSnap.result) ?? auditDeadLinksFallback;
        }
        return auditDeadLinksFallback;
      },
      {
        logger: log,
        debugMessage: 'siteHealth: link check failed — skipping',
      },
    );
  }

  // ── PageSpeed / CWV (performance-store.ts / getPageSpeedSummary) ────
  if (siteId) {
    const pageSpeedData = await readOptionalSlicePart<{
      cwvDesktop: number | null;
      cwvMobile: number | null;
      performanceSummary: PerformanceSummary | null | undefined;
    }>(
      'siteHealth: pagespeed',
      workspaceId,
      {
        cwvDesktop: cwvPassRate.desktop,
        cwvMobile: cwvPassRate.mobile,
        performanceSummary: performanceSummary,
      },
      async () => {
        const { getPageSpeedSummary } = await import('../performance-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
        const mobileSpeed = getPageSpeedSummary(siteId, 'mobile');
        const desktopSpeed = getPageSpeedSummary(siteId, 'desktop');
        const nextMobile = mobileSpeed?.cwvPassRate ?? null;
        const nextDesktop = desktopSpeed?.cwvPassRate ?? null;

        const summarySource = mobileSpeed ?? desktopSpeed;
        return {
          cwvMobile: nextMobile,
          cwvDesktop: nextDesktop,
          performanceSummary: summarySource?.hasAverageVitals
            ? {
                avgLcp: summarySource.averageVitals.LCP ?? null,
                avgInp: summarySource.averageVitals.INP ?? null,
                avgFid: summarySource.averageVitals.FID ?? null,
                avgCls: summarySource.averageVitals.CLS ?? null,
                score: summarySource.averageScore ?? null,
              }
            : undefined,
        };
      },
      {
        logger: log,
        debugMessage: 'siteHealth: pagespeed failed — skipping',
      },
    );
    cwvPassRate.mobile = pageSpeedData.cwvMobile;
    cwvPassRate.desktop = pageSpeedData.cwvDesktop;
    performanceSummary = pageSpeedData.performanceSummary;
  }

  const mobileAssessment = latestAuditCwvSummary?.mobile?.assessment;
  if (cwvPassRate.mobile === null && mobileAssessment === 'good')
    cwvPassRate.mobile = 1;
  else if (
    cwvPassRate.mobile === null &&
    (mobileAssessment === 'needs-improvement' || mobileAssessment === 'poor')
  )
    cwvPassRate.mobile = 0;

  const desktopAssessment = latestAuditCwvSummary?.desktop?.assessment;
  if (cwvPassRate.desktop === null && desktopAssessment === 'good')
    cwvPassRate.desktop = 1;
  else if (
    cwvPassRate.desktop === null &&
    (desktopAssessment === 'needs-improvement' || desktopAssessment === 'poor')
  )
    cwvPassRate.desktop = 0;

  // ── Redirect chains (redirect-store.ts) ─────────────────────────────
  if (siteId) {
    const redirectSnapshot = await readOptionalSlicePart<{
      redirectChains: number;
      redirectDetails: RedirectDetail[] | undefined;
    }>(
      'siteHealth: redirect snapshot',
      workspaceId,
      { redirectChains: 0, redirectDetails: undefined },
      async () => {
        const { getRedirectSnapshot } = await import('../redirect-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
        const redirSnap = getRedirectSnapshot(siteId);
        if (redirSnap?.result) {
          return {
            redirectChains: redirSnap.result.summary.chainsDetected ?? 0,
            redirectDetails: (redirSnap.result.chains ?? []).map((chain) => ({
              url: chain.originalUrl,
              target: chain.finalUrl,
              chainDepth: chain.totalHops,
              status: chain.hops[0]?.status ?? 301,
            })),
          };
        }
        return { redirectChains: 0, redirectDetails: undefined };
      },
      {
        logger: log,
        debugMessage: 'siteHealth: redirect snapshot failed — skipping',
      },
    );
    redirectChains = redirectSnapshot.redirectChains;
    redirectDetails = redirectSnapshot.redirectDetails;
  }

  // ── Orphan pages (site-architecture.ts) ─────────────────────────────
  orphanPages = await readOptionalSlicePart(
    'siteHealth: site architecture',
    workspaceId,
    0,
    async () => {
      const { getCachedArchitecture, flattenTree } =
        await import('../site-architecture.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const arch = await Promise.race([
        getCachedArchitecture(workspaceId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (arch) {
        let nextOrphanPages = arch.orphanPaths?.length ?? 0;
        if (nextOrphanPages === 0) {
          const nodes = flattenTree(arch.tree);
          nextOrphanPages = nodes.filter(
            (n) =>
              n.source === 'existing' &&
              n.hasContent &&
              n.depth === 1 &&
              n.children.length === 0,
          ).length;
        }
        return nextOrphanPages;
      }
      return 0;
    },
    {
      logger: log,
      debugMessage: 'siteHealth: site architecture failed — skipping',
    },
  );

  // ── Schema errors (schema-validator.ts) ─────────────────────────────
  const schemaData = await readOptionalSlicePart<{
    schemaErrors: number;
    schemaValidation: SchemaValidationSummary | undefined;
  }>(
    'siteHealth: schema validation',
    workspaceId,
    { schemaErrors: 0, schemaValidation: undefined },
    async () => {
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
        return {
          schemaValidation: { valid, warnings, errors },
          schemaErrors: errors,
        };
      }
      return { schemaErrors: 0, schemaValidation: undefined };
    },
    {
      logger: log,
      debugMessage: 'siteHealth: schema validation failed — skipping',
    },
  );
  schemaErrors = schemaData.schemaErrors;
  schemaValidation = schemaData.schemaValidation;

  // ── Anomaly count (anomaly-detection.ts) ─────────────────────────────
  const anomalyData = await readOptionalSlicePart<{
    anomalyCount: number;
    anomalyTypes: string[];
  }>(
    'assembleSiteHealth: anomaly detection',
    workspaceId,
    { anomalyCount: 0, anomalyTypes: [] },
    async () => {
      const { listAnomalies } =
        await import(serverModulePath('anomaly-detection')) as AnomalyDetectionModule; // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const anomalies = listAnomalies(workspaceId);
      return {
        anomalyCount: anomalies.length,
        anomalyTypes: [...new Set(anomalies.map((a) => a.type))],
      };
    },
    {
      logger: log,
      warnProgrammingErrors: true,
      warnMessage:
        'assembleSiteHealth: programming error in anomaly-detection — check export names',
    },
  );
  anomalyCount = anomalyData.anomalyCount;
  anomalyTypes = anomalyData.anomalyTypes;

  // ── SEO change velocity (seo-change-tracker.ts) ──────────────────────
  seoChangeVelocity = await readOptionalSlicePart(
    'siteHealth: seo change tracker',
    workspaceId,
    0,
    async () => {
      const { getSeoChanges } = await import('../seo-change-tracker.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      // Pass 500 limit — the second param is a row limit, not days.
      // Active workspaces may exceed the default 100-row cap within 30 days.
      const changes = getSeoChanges(workspaceId, 500);
      const thirtyDaysAgo = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      return changes.filter((c) => c.changedAt >= thirtyDaysAgo).length;
    },
    {
      logger: log,
      debugMessage: 'siteHealth: seo change tracker failed — skipping',
    },
  );

  // ── Recent diagnostic reports (diagnostic-store.ts) ──────────────────
  const recentDiagnostics = await readOptionalSlicePart<
    SiteHealthSlice['recentDiagnostics']
  >(
    'siteHealth: diagnostic reports',
    workspaceId,
    undefined,
    async () => {
      const { listDiagnosticReports } = await import('../diagnostic-store.js'); // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const reports = listDiagnosticReports(workspaceId);
      return reports.slice(0, 5).map((r) => ({
        insightId: r.insightId,
        anomalyType: r.anomalyType,
        status: r.status,
        affectedPages: r.affectedPages,
        completedAt: r.completedAt,
        rootCauseTitles:
          r.status === 'completed' && r.rootCauses.length > 0
            ? r.rootCauses.map((c) => c.title)
            : undefined,
      }));
    },
    {
      logger: log,
      debugMessage:
        'siteHealth: diagnostic reports optional, degrading gracefully',
    },
  );

  // ── AEO readiness (aeo-page-review saved reviews) ──────────────────────
  const aeoReadiness = await readOptionalSlicePart<
    SiteHealthSlice['aeoReadiness']
  >(
    'siteHealth: AEO readiness',
    workspaceId,
    undefined,
    async () => {
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
          const passing = pages.filter(
            (p) => (p.overallScore ?? 0) >= 70,
          ).length;
          return {
            pagesChecked: pages.length,
            passingRate: passing / pages.length,
          };
        }
      }
      return undefined;
    },
    {
      logger: log,
      debugMessage: 'siteHealth: AEO readiness optional, degrading gracefully',
    },
  );

  // ── Weekly metrics trend (workspace_metrics_snapshots, Task 4.2b) ─────
  const weeklyMetricsTrend = await readOptionalSlicePart<
    SiteHealthSlice['weeklyMetricsTrend']
  >(
    'siteHealth: weekly metrics trend',
    workspaceId,
    undefined,
    async () => {
      const { getSnapshots } =
        await import(serverModulePath('workspace-metrics-snapshots')) as WorkspaceMetricsSnapshotsModule; // dynamic-import-ok - intelligence slices lazy-load optional subsystems for graceful degradation
      const snapshots = getSnapshots(workspaceId, 56); // last 8 weeks
      if (snapshots.length > 0) {
        // getSnapshots returns newest-first
        const latest = snapshots[0];
        return {
          latestWeek: {
            snapshotDate: latest.snapshotDate,
            totalClicks: latest.totalClicks,
            totalImpressions: latest.totalImpressions,
            avgPosition: latest.avgPosition,
            auditScore: latest.auditScore,
            organicTrafficValue: latest.organicTrafficValue,
          },
          snapshotCount: snapshots.length,
        };
      }
      return undefined;
    },
    {
      logger: log,
      debugMessage:
        'siteHealth: weekly metrics trend optional, degrading gracefully',
    },
  );

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
    weeklyMetricsTrend,
  };
}

function deadLinkCount(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const data = result as {
    deadLinks?: unknown;
    brokenLinks?: unknown;
  };
  if (Array.isArray(data.deadLinks)) return data.deadLinks.length;
  if (typeof data.deadLinks === 'number' && Number.isFinite(data.deadLinks))
    return data.deadLinks;
  if (Array.isArray(data.brokenLinks)) return data.brokenLinks.length;
  if (typeof data.brokenLinks === 'number' && Number.isFinite(data.brokenLinks))
    return data.brokenLinks;
  return null;
}

function auditDeadLinkCount(audit: {
  deadLinkDetails?: unknown;
  deadLinkSummary?: { total?: unknown };
}): number {
  if (Array.isArray(audit.deadLinkDetails)) return audit.deadLinkDetails.length;
  const total = audit.deadLinkSummary?.total;
  return typeof total === 'number' && Number.isFinite(total) ? total : 0;
}
