#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COVERAGE_GROUPS = [
  'routes',
  'serverModules',
  'apiWrappers',
  'hooks',
  'components',
  'tests',
  'docs',
] as const;

export type CoverageGroup = typeof COVERAGE_GROUPS[number];

export interface CoverageEntry {
  count: number;
  files: string[];
}

export interface ContextCoverage {
  id: string;
  coverage: Record<CoverageGroup, CoverageEntry>;
  coveredGroups: CoverageGroup[];
  advisoryGaps: CoverageGroup[];
}

export interface OrganizationReport {
  canonicalContextIds: string[];
  coverageGroups: CoverageGroup[];
  contexts: ContextCoverage[];
  totals: {
    contextCount: number;
    advisoryGapCount: number;
    coveredGroupCount: number;
  };
}

type GroupMatchers = Record<CoverageGroup, ReadonlyArray<string | RegExp>>;

const INFRA_DIRS = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const CONTEXT_ALIASES: Record<string, Partial<GroupMatchers>> = {
  'workspace-command-center': {
    routes: [/server\/routes\/(?:activity|ai-stats|audit-schedules|data-export|debug)\.ts$/],
    serverModules: [
      /server\/(?:activity-log|admin-chat-context|monthly-report|reports|workspace-data|workspace-validation)\.ts$/,
    ],
    apiWrappers: [/src\/api\/(?:workspaces|diagnostics)\.ts$/],
    hooks: [/src\/hooks\/admin\/useWorkspace(?:Home|Overview|Intelligence)\.ts$/],
    components: [/src\/components\/workspace-home\//, /src\/components\/admin\//],
    tests: [/tests\/(?:integration|component|contract)\/.*workspace/i],
    docs: [/docs\/rules\/platform-organization\.md$/, /docs\/workflows\/client-debug\.md$/],
  },
  'client-portal': {
    routes: [
      /server\/route-groups\/public\.ts$/,
      /server\/routes\/client-intelligence\.ts$/,
      /server\/routes\/content-plan-review\.ts$/,
    ],
    serverModules: [/server\/client-users\.ts$/, /server\/middleware\.ts$/, /server\/monthly-digest\.ts$/],
    apiWrappers: [/src\/api\/client\.ts$/],
    hooks: [/src\/hooks\/client\//, /src\/hooks\/useClientAuth\.ts$/],
    components: [/src\/components\/client\//],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*client/i, /tests\/e2e\/client-/],
    docs: [/docs\/migration-inventory\.md$/, /docs\/workflows\/client-debug\.md$/],
  },
  inbox: {
    routes: [/server\/routes\/(?:approvals|client-actions|content-requests|content-posts)\.ts$/],
    serverModules: [/server\/(?:approvals|client-actions|content-requests|content-posts)\.ts$/],
    apiWrappers: [/src\/api\/clientActions\.ts$/, /src\/api\/content\.ts$/],
    hooks: [/src\/hooks\/admin\/(?:useActionQueue|useQueue)\.ts$/],
    components: [/src\/components\/client\/(?:Decision|Approval|Priority|SchemaReview)/],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*(?:approval|decision|inbox|content-request)/i],
    docs: [/docs\/rules\/inbox-section-routing\.md$/],
  },
  'content-pipeline': {
    routes: [
      /server\/routes\/(?:content-briefs|content-decay|content-matrices|content-posts|content-publish|content-requests|content-subscriptions|content-templates|copy-pipeline)\.ts$/,
    ],
    serverModules: [
      /server\/(?:content-|copy-|briefing-|brief-export|post-export|monthly-digest)/,
      /server\/intelligence\/content-pipeline-slice\.ts$/,
    ],
    apiWrappers: [/src\/api\/(?:content|briefing|suggested-briefs)\.ts$/],
    hooks: [
      /src\/hooks\/admin\/(?:useAdminBriefs|useAdminPosts|useContentPipeline|useCopyPipeline)\.ts$/,
      /src\/hooks\/useContentRequests\.ts$/,
    ],
    components: [/src\/components\/(?:briefs|pipeline|post-editor|editor)\//],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*(?:content|brief|copy|post)/i],
    docs: [/docs\/rules\/content-quality-grounding\.md$/, /docs\/rules\/rich-text-content\.md$/],
  },
  schema: {
    routes: [/server\/routes\/(?:content-plan-review|competitor-schema)\.ts$/],
    serverModules: [/server\/(?:competitor-schema|page-elements-store)/, /server\/schema\//, /server\/helpers\.ts$/],
    apiWrappers: [/src\/api\/seo\.ts$/],
    hooks: [/src\/hooks\/admin\/useSchemaValidation\.ts$/],
    components: [/src\/components\/schema\//],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*schema/i],
    docs: [/docs\/rules\/route-removal-checklist\.md$/],
  },
  'seo-health': {
    routes: [
      /server\/routes\/(?:aeo-review|anomalies|audit-schedules|backlinks|diagnostics)\.ts$/,
      /server\/route-groups\/webflow\.ts$/,
    ],
    serverModules: [
      /server\/(?:aeo-page-review|anomaly-detection|audit-page|diagnostic-|link-checker|page-analysis-job|pagespeed|quick-wins|redirect-)/,
      /server\/intelligence\/site-health-slice\.ts$/,
    ],
    apiWrappers: [/src\/api\/(?:diagnostics|seo)\.ts$/],
    hooks: [/src\/hooks\/admin\/(?:useDiagnostics|useHealthCheck|useAdminSeo|useSeoEditor)\.ts$/],
    components: [/src\/components\/(?:audit|page-intelligence|cms-editor)\//],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*(?:seo|health|audit|diagnostic|pagespeed)/i],
    docs: [/docs\/rules\/workspace-intelligence\.md$/],
  },
  'analytics-intelligence': {
    routes: [/server\/routes\/(?:annotations|anomalies|churn-signals|client-intelligence)\.ts$/],
    serverModules: [
      /server\/(?:analytics-|anomaly-|churn-signals|content-calendar-intelligence|insight-|intelligence-cache|recommendations|roi-attribution)/,
      /server\/intelligence\/(?:insights|learnings|operational|page-profile|site-inventory)-slice\.ts$/,
      /server\/workspace-intelligence\.ts$/,
    ],
    apiWrappers: [/src\/api\/(?:analytics|intelligence|outcomes)\.ts$/],
    hooks: [
      /src\/hooks\/admin\/(?:useAnalyticsOverview|useAnalyticsAnnotations|useAnomalyAlerts|useInsightFeed|useIntelligenceSignals|useWorkspaceIntelligence)\.ts$/,
      /src\/hooks\/client\/(?:useClientInsights|useClientIntelligence)\.ts$/,
    ],
    components: [/src\/components\/(?:insights|charts|strategy)\//],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*(?:analytics|insight|intelligence|roi|recommendation|anomaly)/i],
    docs: [/docs\/rules\/analytics-insights\.md$/, /docs\/rules\/workspace-intelligence\.md$/],
  },
  'brand-engine': {
    routes: [/server\/routes\/(?:brand-docs|brand-identity|brandscript)\.ts$/],
    serverModules: [
      /server\/(?:brand-identity|brandscript|copy-voice-feedback|prompt-assembly|prompt-rich-blocks)/,
      /server\/voice-/,
    ],
    apiWrappers: [/src\/api\/brand-engine\.ts$/],
    hooks: [/src\/hooks\/admin\/useBlueprints\.ts$/],
    components: [/src\/components\/brand\//],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*(?:brand|voice|blueprint)/i],
    docs: [/docs\/rules\/brand-engine\.md$/],
  },
  'outcomes-roi': {
    routes: [/server\/routes\/(?:activity|client-signals|data-export)\.ts$/],
    serverModules: [
      /server\/(?:client-signals-store|outcome-|playbooks|roi(?:-attribution)?|workspace-metrics-snapshots)/,
      /server\/intelligence\/client-signals-slice\.ts$/,
    ],
    apiWrappers: [/src\/api\/outcomes\.ts$/],
    hooks: [/src\/hooks\/admin\/useAdminROI\.ts$/, /src\/hooks\/client\/useClientOutcomes\.ts$/],
    components: [/src\/components\/admin\/outcomes\//],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*(?:outcome|roi|signal|playbook)/i],
    docs: [/docs\/rules\/outcome-engine-stubs\.md$/],
  },
  'billing-monetization': {
    routes: [/server\/routes\/(?:auth|data-export)\.ts$/],
    serverModules: [/server\/(?:payments|stripe|usage-tracking|content-subscriptions|auth|jwt-config)/],
    apiWrappers: [/src\/api\/workspaces\.ts$/, /src\/api\/misc\.ts$/],
    hooks: [/src\/hooks\/usePayments\.ts$/, /src\/hooks\/useAuth\.ts$/],
    components: [/src\/components\/settings\//],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*(?:billing|payment|stripe|tier|auth)/i],
    docs: [/MONETIZATION\.md$/, /docs\/workflows\/stripe-integration\.md$/, /docs\/workflows\/auth-system\.md$/],
  },
  integrations: {
    routes: [/server\/routes\/(?:backlinks|content-publish)\.ts$/],
    serverModules: [
      /server\/(?:google-|openai-|anthropic-|seo-data-provider|webflow|providers\/|requests\.ts$|search-console|semrush|dataforseo)/,
    ],
    apiWrappers: [/src\/api\/seo\.ts$/, /src\/api\/meetingBrief\.ts$/],
    hooks: [/src\/hooks\/admin\/(?:useAdminGA4|useAdminMeetingBrief|useAdminSearch)\.ts$/, /src\/hooks\/shared\/useGA4Base\.ts$/],
    components: [/src\/components\/admin\/MeetingBrief\//],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*(?:webflow|google|ga4|semrush|dataforseo|meeting-brief|provider)/i],
    docs: [/docs\/workflows\/feature-integration\.md$/],
  },
  'platform-foundation': {
    routes: [/server\/routes\/(?:auth|debug)\.ts$/, /server\/route-groups\/(?:content|public|webflow)\.ts$/],
    serverModules: [
      /server\/(?:app|broadcast|constants|errors|feature-flags|helpers|index|jobs|logger|middleware|ws-events)\.ts$/,
      /server\/db\//,
    ],
    apiWrappers: [/src\/api\/index\.ts$/, /src\/api\/streamUtils\.ts$/],
    hooks: [
      /src\/hooks\/(?:useBackgroundTasks|useFeatureFlag|useGlobalAdminEvents|useWorkspaceEvents|useWsInvalidation|workspaceEventBus)\.tsx?$/,
    ],
    components: [/src\/components\/(?:layout|shared|ui)\//],
    tests: [/tests\/(?:integration|contract|component|unit)\/.*(?:background|ws-|workspace-event|feature-flag|middleware|constants)/i],
    docs: [/docs\/rules\/(?:platform-organization|development-patterns|data-flow|multi-agent-coordination)\.md$/],
  },
};

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

export function extractCanonicalContextIds(docSource: string): string[] {
  const lines = docSource.split(/\r?\n/);
  const ids: string[] = [];
  let inSection = false;
  let sawListItem = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      !inSection &&
      (trimmed === '## Canonical Bounded Contexts' || line.includes('Current canonical contexts:'))
    ) {
      inSection = true;
      continue;
    }

    if (!inSection) continue;

    const match = trimmed.match(/^- `([^`]+)`$/);
    if (match) {
      ids.push(match[1]);
      sawListItem = true;
      continue;
    }

    if (sawListItem && trimmed === '') {
      break;
    }
  }

  return ids;
}

export function readCanonicalContextIds(projectRoot: string): string[] {
  const docPath = path.join(projectRoot, 'docs', 'rules', 'platform-organization.md');
  const docSource = fs.readFileSync(docPath, 'utf8');
  return extractCanonicalContextIds(docSource);
}

export function collectRepoFiles(projectRoot: string): string[] {
  const results: string[] = [];

  function walk(dirPath: string): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (INFRA_DIRS.has(entry.name)) continue;
      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      results.push(toPosix(path.relative(projectRoot, absolutePath)));
    }
  }

  walk(projectRoot);
  return results.sort((a, b) => a.localeCompare(b));
}

function isGroupFile(filePath: string, group: CoverageGroup): boolean {
  switch (group) {
    case 'routes':
      return /^server\/(?:routes|route-groups)\//.test(filePath);
    case 'serverModules':
      return /^server\//.test(filePath) && !/^server\/(?:routes|route-groups|db\/migrations|__tests__)\//.test(filePath);
    case 'apiWrappers':
      return /^src\/api\/.+\.(?:ts|tsx)$/.test(filePath);
    case 'hooks':
      return /^src\/hooks\/.+\.(?:ts|tsx)$/.test(filePath);
    case 'components':
      return /^src\/components\/.+\.(?:ts|tsx)$/.test(filePath);
    case 'tests':
      return /^(?:tests|server\/__tests__)\/.+\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/.test(filePath);
    case 'docs':
      return /^(?:docs\/.+\.md|[A-Z0-9_-]+\.md)$/.test(filePath);
    default:
      return false;
  }
}

function matchesAny(filePath: string, patterns: ReadonlyArray<string | RegExp> | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => {
    if (typeof pattern === 'string') return filePath.includes(pattern);
    return pattern.test(filePath);
  });
}

function uniqueSorted(items: string[]): string[] {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}

export function buildOrganizationReport(
  files: string[],
  canonicalContextIds: string[],
): OrganizationReport {
  const normalizedFiles = uniqueSorted(files.map((filePath) => toPosix(filePath)));

  const contexts: ContextCoverage[] = canonicalContextIds.map((contextId) => {
    const matchers = CONTEXT_ALIASES[contextId] ?? {};
    const coverage = Object.fromEntries(
      COVERAGE_GROUPS.map((group) => {
        const filesForGroup = normalizedFiles.filter(
          (filePath) => isGroupFile(filePath, group) && matchesAny(filePath, matchers[group]),
        );

        return [
          group,
          {
            count: filesForGroup.length,
            files: filesForGroup,
          },
        ];
      }),
    ) as Record<CoverageGroup, CoverageEntry>;

    const coveredGroups = COVERAGE_GROUPS.filter((group) => coverage[group].count > 0);
    const advisoryGaps = COVERAGE_GROUPS.filter((group) => coverage[group].count === 0);

    return {
      id: contextId,
      coverage,
      coveredGroups,
      advisoryGaps,
    };
  });

  const coveredGroupCount = contexts.reduce((sum, context) => sum + context.coveredGroups.length, 0);
  const advisoryGapCount = contexts.reduce((sum, context) => sum + context.advisoryGaps.length, 0);

  return {
    canonicalContextIds: [...canonicalContextIds],
    coverageGroups: [...COVERAGE_GROUPS],
    contexts,
    totals: {
      contextCount: canonicalContextIds.length,
      advisoryGapCount,
      coveredGroupCount,
    },
  };
}

export function createOrganizationReport(projectRoot: string): OrganizationReport {
  const canonicalContextIds = readCanonicalContextIds(projectRoot);
  const files = collectRepoFiles(projectRoot);
  return buildOrganizationReport(files, canonicalContextIds);
}

export function formatOrganizationReportMarkdown(report: OrganizationReport): string {
  const lines: string[] = [
    '# Platform Organization Report',
    '',
    '_Filesystem-only advisory scan. Coverage gaps do not fail the report._',
    '',
    `- Canonical contexts: ${report.totals.contextCount}`,
    `- Coverage groups: ${report.coverageGroups.join(', ')}`,
    `- Advisory gaps: ${report.totals.advisoryGapCount}`,
    '',
  ];

  for (const context of report.contexts) {
    lines.push(`## ${context.id}`);
    lines.push('');

    for (const group of report.coverageGroups) {
      const entry = context.coverage[group];
      if (entry.count === 0) {
        lines.push(`- ${group}: gap (advisory)`);
        continue;
      }

      const preview = entry.files.slice(0, 3).join(', ');
      const suffix = entry.count > 3 ? `, +${entry.count - 3} more` : '';
      lines.push(`- ${group}: ${entry.count} (${preview}${suffix})`);
    }

    if (context.advisoryGaps.length > 0) {
      lines.push(`- Advisory gaps: ${context.advisoryGaps.join(', ')}`);
    } else {
      lines.push('- Advisory gaps: none');
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function formatOrganizationReportJson(report: OrganizationReport): string {
  return JSON.stringify(report, null, 2);
}

export function runOrganizationReportCli(
  argv: string[],
  io: Pick<typeof console, 'log' | 'error'> = console,
  projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
): number {
  const args = new Set(argv);
  const report = createOrganizationReport(projectRoot);
  const output = args.has('--json')
    ? formatOrganizationReportJson(report)
    : formatOrganizationReportMarkdown(report);

  io.log(output);
  return 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentPath = fileURLToPath(import.meta.url);

if (invokedPath === currentPath) {
  process.exit(runOrganizationReportCli(process.argv.slice(2)));
}
