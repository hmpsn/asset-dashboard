import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  COVERAGE_GROUPS,
  buildOrganizationReport,
  extractCanonicalContextIds,
  formatOrganizationReportJson,
  runOrganizationReportCli,
} from '../../scripts/report-platform-organization.js';

const PLATFORM_ORGANIZATION_DOC = `
# Platform Organization

Current canonical contexts:

- \`workspace-command-center\`
- \`client-portal\`
- \`inbox\`
- \`content-pipeline\`
- \`schema\`
- \`seo-health\`
- \`analytics-intelligence\`
- \`brand-engine\`
- \`outcomes-roi\`
- \`billing-monetization\`
- \`integrations\`
- \`platform-foundation\`
`;

const SYNTHETIC_FILES = [
  'server/routes/brandscript.ts',
  'server/routes/client-actions.ts',
  'server/routes/client-intelligence.ts',
  'server/routes/content-briefs.ts',
  'server/routes/diagnostics.ts',
  'server/routes/brand-docs.ts',
  'server/routes/content-publish.ts',
  'server/app.ts',
  'server/analytics-intelligence.ts',
  'server/brandscript.ts',
  'server/client-users.ts',
  'server/content-posts.ts',
  'server/outcome-tracking.ts',
  'server/payments.ts',
  'src/api/analytics.ts',
  'src/api/brand-engine.ts',
  'src/api/client.ts',
  'src/api/clientActions.ts',
  'src/api/content.ts',
  'src/api/diagnostics.ts',
  'src/api/index.ts',
  'src/api/outcomes.ts',
  'src/api/seo.ts',
  'src/hooks/admin/useActionQueue.ts',
  'src/hooks/admin/useAdminROI.ts',
  'src/hooks/admin/useAdminSeo.ts',
  'src/hooks/admin/useAnalyticsOverview.ts',
  'src/hooks/admin/useBlueprints.ts',
  'src/hooks/admin/useContentPipeline.ts',
  'src/hooks/admin/useDiagnostics.ts',
  'src/hooks/admin/useWorkspaceHome.ts',
  'src/hooks/client/useClientInsights.ts',
  'src/hooks/client/useClientOutcomes.ts',
  'src/hooks/client/useClientQueries.ts',
  'src/hooks/useBackgroundTasks.tsx',
  'src/components/admin/MeetingBrief/MeetingBriefPage.tsx',
  'src/components/admin/outcomes/OutcomeScoreCard.tsx',
  'src/components/brand/BrandHub.tsx',
  'src/components/client/DecisionCard.tsx',
  'src/components/client/Overview.tsx',
  'src/components/insights/InsightCards.tsx',
  'src/components/page-intelligence/PageHealth.tsx',
  'src/components/pipeline/CopyPipeline.tsx',
  'src/components/schema/SchemaPanel.tsx',
  'src/components/settings/BillingSettings.tsx',
  'src/components/ui/SectionCard.tsx',
  'src/components/workspace-home/WorkspaceHome.tsx',
  'tests/integration/brand-engine-routes.test.ts',
  'tests/integration/client-actions-routes.test.ts',
  'tests/integration/client-strategy.test.ts',
  'tests/integration/content-brief-routes.test.ts',
  'tests/integration/health-routes.test.ts',
  'tests/integration/outcome-pipeline.test.ts',
  'tests/unit/analytics-intelligence.test.ts',
  'tests/unit/background-jobs.test.ts',
  'docs/rules/brand-engine.md',
  'docs/rules/content-quality-grounding.md',
  'docs/rules/inbox-section-routing.md',
  'docs/rules/platform-organization.md',
  'docs/rules/workspace-intelligence.md',
  'docs/workflows/auth-system.md',
  'docs/workflows/client-debug.md',
  'docs/workflows/feature-integration.md',
  'MONETIZATION.md',
];

describe('platform organization report', () => {
  it('extracts all canonical contexts from the platform organization doc', () => {
    expect(extractCanonicalContextIds(PLATFORM_ORGANIZATION_DOC)).toEqual([
      'workspace-command-center',
      'client-portal',
      'inbox',
      'content-pipeline',
      'schema',
      'seo-health',
      'analytics-intelligence',
      'brand-engine',
      'outcomes-roi',
      'billing-monetization',
      'integrations',
      'platform-foundation',
    ]);
  });

  it('emits stable JSON with context ids and coverage groups', () => {
    const report = buildOrganizationReport(
      SYNTHETIC_FILES,
      extractCanonicalContextIds(PLATFORM_ORGANIZATION_DOC),
    );

    const parsed = JSON.parse(formatOrganizationReportJson(report)) as {
      canonicalContextIds: string[];
      coverageGroups: string[];
      contexts: Array<{
        id: string;
        coverage: Record<string, { count: number; files: string[] }>;
      }>;
    };

    expect(parsed.canonicalContextIds).toEqual(extractCanonicalContextIds(PLATFORM_ORGANIZATION_DOC));
    expect(parsed.coverageGroups).toEqual([...COVERAGE_GROUPS]);
    expect(parsed.contexts.map((context) => context.id)).toEqual(parsed.canonicalContextIds);
    expect(Object.keys(parsed.contexts[0].coverage)).toEqual([...COVERAGE_GROUPS]);
    expect(parsed.contexts.find((context) => context.id === 'brand-engine')?.coverage.docs.files).toEqual([
      'docs/rules/brand-engine.md',
    ]);
  });

  it('treats missing groups as advisory gaps and keeps the CLI exit code at 0', () => {
    const report = buildOrganizationReport(
      ['server/routes/content-publish.ts', 'server/requests.ts'],
      ['integrations'],
    );

    expect(report.contexts[0].coveredGroups).toEqual(['routes', 'serverModules']);
    expect(report.contexts[0].advisoryGaps).toEqual([
      'apiWrappers',
      'hooks',
      'components',
      'tests',
      'docs',
    ]);

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'organization-report-'));
    fs.mkdirSync(path.join(tempRoot, 'docs', 'rules'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'server', 'routes'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, 'docs', 'rules', 'platform-organization.md'),
      PLATFORM_ORGANIZATION_DOC,
      'utf8',
    );
    fs.writeFileSync(path.join(tempRoot, 'server', 'routes', 'content-publish.ts'), '', 'utf8');
    fs.writeFileSync(path.join(tempRoot, 'server', 'requests.ts'), '', 'utf8');

    const logs: string[] = [];
    const exitCode = runOrganizationReportCli(
      ['--json'],
      { log: (line) => logs.push(line), error: () => {} },
      tempRoot,
    );

    expect(exitCode).toBe(0);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]).totals.advisoryGapCount).toBeGreaterThan(0);
  });
});
