// CWV extraction module for SEO audit engine.
// Extracted from seo-audit.ts for modularity.

import { runSinglePageSpeed } from './pagespeed.js';
import { createLogger } from './logger.js';
import type { SeoIssue } from './audit-page.js';
import type { CwvSummary, CwvStrategyResult } from './seo-audit.js';

const log = createLogger('seo-audit-cwv');

export interface HomepageCwvOpts {
  homepageUrl: string;
  siteWideIssues: SeoIssue[];
}

export async function runHomepageCwv(opts: HomepageCwvOpts): Promise<CwvSummary> {
  const { homepageUrl, siteWideIssues } = opts;
  const cwvSummary: CwvSummary = {};
  if (homepageUrl && process.env.GOOGLE_PSI_KEY) {
    try {
      log.info('Running homepage PageSpeed check (mobile + desktop)...');
      const [psiMobile, psiDesktop] = await Promise.all([
        runSinglePageSpeed(homepageUrl, 'mobile', 'Homepage').catch(() => null),
        runSinglePageSpeed(homepageUrl, 'desktop', 'Homepage').catch(() => null),
      ]);

      // Build CwvStrategyResult from a PSI result
      const buildStrategy = (psi: NonNullable<typeof psiMobile>): CwvStrategyResult => {
        const cwv = psi.cwvAssessment;
        return {
          assessment: cwv?.assessment ?? 'no-data',
          fieldDataAvailable: cwv?.fieldDataAvailable ?? false,
          lighthouseScore: psi.score,
          metrics: cwv?.metrics ?? {
            LCP: { value: psi.vitals.LCP, rating: null },
            INP: { value: psi.vitals.INP, rating: null },
            CLS: { value: psi.vitals.CLS, rating: null },
          },
        };
      };

      if (psiMobile) cwvSummary.mobile = buildStrategy(psiMobile);
      if (psiDesktop) cwvSummary.desktop = buildStrategy(psiDesktop);

      // Only push Lighthouse lab scores into siteWideIssues as info-level diagnostic
      for (const [label, psi] of [['Mobile', psiMobile], ['Desktop', psiDesktop]] as const) {
        if (!psi) continue;
        const scoreLabel = psi.score >= 90 ? 'good' : psi.score >= 50 ? 'needs improvement' : 'poor';
        siteWideIssues.push({
          check: 'cwv-lab', severity: 'info',
          message: `${label} Lighthouse score: ${psi.score}/100 (${scoreLabel})`,
          recommendation: `Lighthouse simulates page load on a mid-tier device. This score is a diagnostic tool — not used by Google for rankings. Use it to identify optimization opportunities.`,
          value: `${psi.score}/100`,
        });
      }
    } catch (err) {
      log.error({ err: err }, 'PageSpeed check failed (non-fatal)');
    }
  }
  return cwvSummary;
}
