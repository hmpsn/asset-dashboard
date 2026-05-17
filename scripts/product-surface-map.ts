#!/usr/bin/env tsx

import { pathToFileURL } from 'node:url';
import {
  CANONICAL_BOUNDED_CONTEXTS,
  type BoundedContextId,
} from './platform-domain-smoke-matrix.js';

export const SURFACE_PLACEMENTS = [
  'first-class-navigation',
  'context-triggered',
  'progressive-disclosure',
  'internal-only',
] as const;

export const CAPABILITY_ROLES = [
  'client-differentiator',
  'agency-operations',
  'support-system',
  'platform-infrastructure',
] as const;

export const LIFECYCLE_STATES = [
  'active',
  'flagged-dark-launch',
  'deprecated-but-present',
  'legacy-alias',
] as const;

export const RECOMMENDATIONS = [
  'promote',
  'keep',
  'hide-behind-progressive-disclosure',
  'deprecate-after-redirect-window',
] as const;

export type SurfacePlacement = (typeof SURFACE_PLACEMENTS)[number];
export type CapabilityRole = (typeof CAPABILITY_ROLES)[number];
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];
export type SurfaceRecommendation = (typeof RECOMMENDATIONS)[number];

export interface ProductSurfaceEntry {
  id: string;
  capability: string;
  boundedContextId: BoundedContextId;
  placement: SurfacePlacement;
  role: CapabilityRole;
  lifecycle: LifecycleState;
  recommendation: SurfaceRecommendation;
  clientFacing: boolean;
  monetizable: boolean;
  requiresHumanVerification: boolean;
  owner: string;
  notes: string;
  evidence: string[];
}

export interface ProductSurfaceCoverageGap {
  contextId: string;
  issue: string;
}

export interface ProductSurfacePolicyGap {
  id: string;
  issue: string;
}

export interface ProductSurfaceReport {
  generatedBy: 'scripts/product-surface-map.ts';
  totalCapabilities: number;
  humanReviewRequired: number;
  coverageGaps: ProductSurfaceCoverageGap[];
  policyGaps: ProductSurfacePolicyGap[];
  counts: {
    placements: Record<SurfacePlacement, number>;
    roles: Record<CapabilityRole, number>;
    lifecycle: Record<LifecycleState, number>;
    recommendations: Record<SurfaceRecommendation, number>;
  };
  entries: ProductSurfaceEntry[];
}

function makeCountMap<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map(value => [value, 0])) as Record<T, number>;
}

export const PRODUCT_SURFACE_MAP: ProductSurfaceEntry[] = [
  {
    id: 'command-center-home',
    capability: 'Admin Command Center Home',
    boundedContextId: 'workspace-command-center',
    placement: 'first-class-navigation',
    role: 'agency-operations',
    lifecycle: 'active',
    recommendation: 'keep',
    clientFacing: false,
    monetizable: false,
    requiresHumanVerification: false,
    owner: 'workspace-command-center',
    notes: 'Primary operator landing surface for multi-workspace triage and follow-up work.',
    evidence: ['src/routes.ts (Page: home)', 'src/components/layout/Sidebar.tsx (Home nav item)'],
  },
  {
    id: 'search-traffic-hub',
    capability: 'Search & Traffic Hub',
    boundedContextId: 'analytics-intelligence',
    placement: 'first-class-navigation',
    role: 'client-differentiator',
    lifecycle: 'active',
    recommendation: 'promote',
    clientFacing: true,
    monetizable: true,
    requiresHumanVerification: false,
    owner: 'analytics-intelligence',
    notes: 'High-value narrative surface that connects analytics, anomalies, and insight priorities.',
    evidence: ['src/components/layout/Sidebar.tsx (Search & Traffic nav item)'],
  },
  {
    id: 'site-health-cluster',
    capability: 'Site Health Cluster (Audit, Performance, Links, Assets)',
    boundedContextId: 'seo-health',
    placement: 'first-class-navigation',
    role: 'client-differentiator',
    lifecycle: 'active',
    recommendation: 'keep',
    clientFacing: true,
    monetizable: true,
    requiresHumanVerification: false,
    owner: 'seo-health',
    notes: 'Core deliverable cluster directly tied to visible client outcomes.',
    evidence: ['src/components/layout/Sidebar.tsx (SITE HEALTH group)'],
  },
  {
    id: 'strategy-intelligence',
    capability: 'SEO Strategy + Page Intelligence',
    boundedContextId: 'seo-health',
    placement: 'first-class-navigation',
    role: 'client-differentiator',
    lifecycle: 'active',
    recommendation: 'keep',
    clientFacing: true,
    monetizable: true,
    requiresHumanVerification: false,
    owner: 'seo-health',
    notes: 'Directly informs planned work and connects strategy with page-level execution.',
    evidence: ['src/components/layout/Sidebar.tsx (SEO STRATEGY group)'],
  },
  {
    id: 'schema-workbench',
    capability: 'Schema Workbench',
    boundedContextId: 'schema',
    placement: 'first-class-navigation',
    role: 'client-differentiator',
    lifecycle: 'active',
    recommendation: 'keep',
    clientFacing: true,
    monetizable: true,
    requiresHumanVerification: false,
    owner: 'schema',
    notes: 'Schema generation and validation are premium-facing differentiators and should stay obvious.',
    evidence: ['src/components/layout/Sidebar.tsx (OPTIMIZATION > Schema)'],
  },
  {
    id: 'content-pipeline',
    capability: 'Content Pipeline',
    boundedContextId: 'content-pipeline',
    placement: 'first-class-navigation',
    role: 'client-differentiator',
    lifecycle: 'active',
    recommendation: 'keep',
    clientFacing: true,
    monetizable: true,
    requiresHumanVerification: false,
    owner: 'content-pipeline',
    notes: 'Brief-to-post lifecycle is a principal client outcome system and should remain first-class.',
    evidence: ['src/components/layout/Sidebar.tsx (CONTENT > Pipeline)'],
  },
  {
    id: 'client-inbox',
    capability: 'Client Inbox (Decisions, Conversations, Reviews)',
    boundedContextId: 'inbox',
    placement: 'first-class-navigation',
    role: 'client-differentiator',
    lifecycle: 'active',
    recommendation: 'keep',
    clientFacing: true,
    monetizable: true,
    requiresHumanVerification: false,
    owner: 'inbox',
    notes: 'Primary collaboration loop between agency and client.',
    evidence: ['src/components/ClientDashboard.tsx (InboxTab)', 'src/routes.ts (ClientTab: inbox)'],
  },
  {
    id: 'billing-upgrade-flow',
    capability: 'Tier Gating + Stripe Checkout Flow',
    boundedContextId: 'billing-monetization',
    placement: 'context-triggered',
    role: 'support-system',
    lifecycle: 'active',
    recommendation: 'keep',
    clientFacing: true,
    monetizable: true,
    requiresHumanVerification: false,
    owner: 'billing-monetization',
    notes: 'Monetization path should appear contextually at upgrade moments, not as primary navigation.',
    evidence: ['src/components/client/UpgradeModal.tsx', 'src/components/ui/TierGate.tsx'],
  },
  {
    id: 'provider-connections-health',
    capability: 'Integrations + Connection Health',
    boundedContextId: 'integrations',
    placement: 'context-triggered',
    role: 'support-system',
    lifecycle: 'active',
    recommendation: 'keep',
    clientFacing: false,
    monetizable: false,
    requiresHumanVerification: false,
    owner: 'integrations',
    notes: 'Operational trust surface best exposed through settings and diagnostics, not first-class nav.',
    evidence: ['src/components/settings/ConnectionsTab.tsx', 'FEATURE_AUDIT.md (Integration Health Center)'],
  },
  {
    id: 'outcomes-action-results',
    capability: 'Action Results (Workspace-level outcomes)',
    boundedContextId: 'outcomes-roi',
    placement: 'first-class-navigation',
    role: 'client-differentiator',
    lifecycle: 'active',
    recommendation: 'keep',
    clientFacing: true,
    monetizable: true,
    requiresHumanVerification: false,
    owner: 'outcomes-roi',
    notes: 'Outcome narratives are differentiators and should stay visible for retention and upsell.',
    evidence: ['src/components/layout/Sidebar.tsx (MONITORING > Action Results)'],
  },
  {
    id: 'team-outcomes-overview',
    capability: 'Team Outcomes Overview (cross-workspace)',
    boundedContextId: 'outcomes-roi',
    placement: 'internal-only',
    role: 'agency-operations',
    lifecycle: 'active',
    recommendation: 'hide-behind-progressive-disclosure',
    clientFacing: false,
    monetizable: false,
    requiresHumanVerification: true,
    owner: 'workspace-command-center',
    notes: 'Useful for operators but likely too advanced for primary admin navigation density.',
    evidence: ['src/components/layout/Sidebar.tsx (ADMIN > Team Outcomes)'],
  },
  {
    id: 'prospect-tooling',
    capability: 'Prospect Tooling',
    boundedContextId: 'workspace-command-center',
    placement: 'internal-only',
    role: 'agency-operations',
    lifecycle: 'active',
    recommendation: 'hide-behind-progressive-disclosure',
    clientFacing: false,
    monetizable: false,
    requiresHumanVerification: true,
    owner: 'workspace-command-center',
    notes: 'Internal sales utility is valuable but can be progressively disclosed from the core nav.',
    evidence: ['src/components/layout/Sidebar.tsx (ADMIN > Prospect)'],
  },
  {
    id: 'ai-usage-ledger',
    capability: 'AI Usage Ledger',
    boundedContextId: 'platform-foundation',
    placement: 'internal-only',
    role: 'platform-infrastructure',
    lifecycle: 'active',
    recommendation: 'hide-behind-progressive-disclosure',
    clientFacing: false,
    monetizable: false,
    requiresHumanVerification: true,
    owner: 'platform-foundation',
    notes: 'High-utility operator view but not a core daily workflow for most admins.',
    evidence: ['src/components/layout/Sidebar.tsx (ADMIN > AI Usage)'],
  },
  {
    id: 'deep-diagnostics',
    capability: 'Deep Diagnostics',
    boundedContextId: 'platform-foundation',
    placement: 'progressive-disclosure',
    role: 'platform-infrastructure',
    lifecycle: 'flagged-dark-launch',
    recommendation: 'hide-behind-progressive-disclosure',
    clientFacing: false,
    monetizable: false,
    requiresHumanVerification: false,
    owner: 'platform-foundation',
    notes: 'Already hidden behind feature flag and should stay opt-in until operational playbook is complete.',
    evidence: ['src/components/layout/Sidebar.tsx (diagnostics nav item hidden by deep-diagnostics flag)'],
  },
  {
    id: 'brand-hub-copy-engine',
    capability: 'Brand & AI Hub (Copy Engine)',
    boundedContextId: 'brand-engine',
    placement: 'progressive-disclosure',
    role: 'support-system',
    lifecycle: 'flagged-dark-launch',
    recommendation: 'keep',
    clientFacing: true,
    monetizable: true,
    requiresHumanVerification: false,
    owner: 'brand-engine',
    notes: 'Gated rollout is correct while phased copy-engine contracts continue to stabilize.',
    evidence: ['src/components/layout/Sidebar.tsx (Brand nav item hidden by copy-engine flag)'],
  },
  {
    id: 'client-brand-tab',
    capability: 'Client Brand Tab',
    boundedContextId: 'client-portal',
    placement: 'progressive-disclosure',
    role: 'support-system',
    lifecycle: 'flagged-dark-launch',
    recommendation: 'keep',
    clientFacing: true,
    monetizable: true,
    requiresHumanVerification: false,
    owner: 'client-portal',
    notes: 'Client-facing brand surface is correctly controlled while content maturity is assessed.',
    evidence: ['src/components/ClientDashboard.tsx (useFeatureFlag: client-brand-section)'],
  },
  {
    id: 'client-inbox-legacy-aliases',
    capability: 'Legacy Client Inbox Aliases',
    boundedContextId: 'inbox',
    placement: 'context-triggered',
    role: 'support-system',
    lifecycle: 'legacy-alias',
    recommendation: 'deprecate-after-redirect-window',
    clientFacing: true,
    monetizable: false,
    requiresHumanVerification: true,
    owner: 'inbox',
    notes: 'Legacy route aliases prevent bookmark breakage; remove only after measured alias traffic cool-down.',
    evidence: ['src/routes.ts (CLIENT_INBOX_ALIASES approvals/requests/content)'],
  },
  {
    id: 'schema-review-standalone-tab-retirement',
    capability: 'Standalone Schema Review Tab Retirement',
    boundedContextId: 'inbox',
    placement: 'context-triggered',
    role: 'support-system',
    lifecycle: 'deprecated-but-present',
    recommendation: 'deprecate-after-redirect-window',
    clientFacing: true,
    monetizable: false,
    requiresHumanVerification: true,
    owner: 'inbox',
    notes: 'Already migrated into Inbox > Reviews with redirects preserved; monitor and eventually trim legacy links.',
    evidence: ['src/components/client/InboxTab.tsx (SchemaReviewModal mounted in Reviews section)'],
  },
];

export function findProductSurfaceCoverageGaps(entries: ProductSurfaceEntry[] = PRODUCT_SURFACE_MAP): ProductSurfaceCoverageGap[] {
  const gaps: ProductSurfaceCoverageGap[] = [];

  for (const contextId of CANONICAL_BOUNDED_CONTEXTS) {
    const matches = entries.filter(entry => entry.boundedContextId === contextId);
    if (matches.length === 0) {
      gaps.push({
        contextId,
        issue: 'No product-surface entry mapped to canonical bounded context',
      });
    }
  }

  return gaps;
}

export function findProductSurfacePolicyGaps(entries: ProductSurfaceEntry[] = PRODUCT_SURFACE_MAP): ProductSurfacePolicyGap[] {
  const gaps: ProductSurfacePolicyGap[] = [];

  for (const entry of entries) {
    // Deprecations always require explicit human approval.
    if (
      entry.recommendation === 'deprecate-after-redirect-window'
      && !entry.requiresHumanVerification
    ) {
      gaps.push({
        id: entry.id,
        issue: 'Deprecation recommendation requires human verification',
      });
    }

    // Demoting a first-class surface to progressive disclosure requires approval.
    if (
      entry.recommendation === 'hide-behind-progressive-disclosure'
      && entry.placement === 'first-class-navigation'
      && !entry.requiresHumanVerification
    ) {
      gaps.push({
        id: entry.id,
        issue: 'First-class nav demotion requires human verification',
      });
    }
  }

  return gaps;
}

export function buildProductSurfaceReport(entries: ProductSurfaceEntry[] = PRODUCT_SURFACE_MAP): ProductSurfaceReport {
  const placementCounts = makeCountMap(SURFACE_PLACEMENTS);
  const roleCounts = makeCountMap(CAPABILITY_ROLES);
  const lifecycleCounts = makeCountMap(LIFECYCLE_STATES);
  const recommendationCounts = makeCountMap(RECOMMENDATIONS);

  for (const entry of entries) {
    placementCounts[entry.placement] += 1;
    roleCounts[entry.role] += 1;
    lifecycleCounts[entry.lifecycle] += 1;
    recommendationCounts[entry.recommendation] += 1;
  }

  return {
    generatedBy: 'scripts/product-surface-map.ts',
    totalCapabilities: entries.length,
    humanReviewRequired: entries.filter(entry => entry.requiresHumanVerification).length,
    coverageGaps: findProductSurfaceCoverageGaps(entries),
    policyGaps: findProductSurfacePolicyGaps(entries),
    counts: {
      placements: placementCounts,
      roles: roleCounts,
      lifecycle: lifecycleCounts,
      recommendations: recommendationCounts,
    },
    entries: [...entries].sort((a, b) => a.capability.localeCompare(b.capability)),
  };
}

export function formatProductSurfaceReportAsMarkdown(report: ProductSurfaceReport = buildProductSurfaceReport()): string {
  const lines: string[] = [];

  lines.push('# Product Surface Map');
  lines.push('');
  lines.push(`Generated by: \`${report.generatedBy}\``);
  lines.push(`Total capabilities: ${report.totalCapabilities}`);
  lines.push(`Requires human verification: ${report.humanReviewRequired}`);
  lines.push(`Coverage gaps: ${report.coverageGaps.length}`);
  lines.push(`Policy gaps: ${report.policyGaps.length}`);
  lines.push('');

  lines.push('## Placement Counts');
  lines.push('');
  lines.push('| Placement | Count |');
  lines.push('| --- | ---: |');
  for (const placement of SURFACE_PLACEMENTS) {
    lines.push(`| \`${placement}\` | ${report.counts.placements[placement]} |`);
  }
  lines.push('');

  lines.push('## Human Verification Queue');
  lines.push('');
  lines.push('| Capability | Recommendation | Owner | Notes |');
  lines.push('| --- | --- | --- | --- |');
  for (const entry of report.entries.filter(item => item.requiresHumanVerification)) {
    lines.push(`| ${entry.capability} | \`${entry.recommendation}\` | \`${entry.owner}\` | ${entry.notes} |`);
  }
  lines.push('');

  lines.push('## Capability Map');
  lines.push('');
  lines.push('| Capability | Context | Placement | Lifecycle | Recommendation |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const entry of report.entries) {
    lines.push(`| ${entry.capability} | \`${entry.boundedContextId}\` | \`${entry.placement}\` | \`${entry.lifecycle}\` | \`${entry.recommendation}\` |`);
  }
  lines.push('');

  return lines.join('\n');
}

function runCli(): void {
  const report = buildProductSurfaceReport();
  const asJson = process.argv.includes('--json');
  const asMarkdown = process.argv.includes('--markdown');

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else if (asMarkdown) {
    console.log(formatProductSurfaceReportAsMarkdown(report));
  } else {
    console.log(`[product-surface-map] capabilities=${report.totalCapabilities} human_review=${report.humanReviewRequired} gaps=${report.coverageGaps.length}`);
    for (const placement of SURFACE_PLACEMENTS) {
      console.log(`  placement:${placement}=${report.counts.placements[placement]}`);
    }
    if (report.coverageGaps.length > 0) {
      console.log('[product-surface-map] coverage gaps:');
      for (const gap of report.coverageGaps) {
        console.log(`  - ${gap.contextId}: ${gap.issue}`);
      }
    }
  }

  if (report.coverageGaps.length > 0) {
    process.exitCode = 1;
  }
  if (report.policyGaps.length > 0) {
    process.exitCode = 1;
  }
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl && import.meta.url === entryUrl) {
  runCli();
}
