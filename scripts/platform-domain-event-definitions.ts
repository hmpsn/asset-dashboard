#!/usr/bin/env tsx

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { WS_EVENTS, type WsEventName } from '../server/ws-events.js';
import {
  CANONICAL_BOUNDED_CONTEXTS,
  type BoundedContextId,
} from './platform-domain-smoke-matrix.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = join(ROOT, 'server');
const CLIENT_DIR = join(ROOT, 'src');

export type WsEventKey = keyof typeof WS_EVENTS;

export type DomainEventDefinition = {
  eventKey: WsEventKey;
  eventName: WsEventName;
  owningContext: BoundedContextId;
  producerModules: string[];
  payloadContractNote: string;
  expectedInvalidations: string[];
  adminListeners: string[];
  clientListeners: string[];
  relatedActivityTypes: string[];
};

export type DomainEventCoverageEntry = DomainEventDefinition & {
  discoveredProducerModules: string[];
  discoveredAdminListenerModules: string[];
  discoveredClientListenerModules: string[];
};

export type DomainEventGap = {
  eventName?: string;
  eventKey?: string;
  issue: string;
};

export type DomainEventWarning = {
  eventName: string;
  eventKey: string;
  issue: string;
};

export type DomainEventDefinitionsReport = {
  generatedBy: 'scripts/platform-domain-event-definitions.ts';
  advisoryOnly: true;
  contextsExpected: BoundedContextId[];
  wsEventKeysExpected: WsEventKey[];
  entries: DomainEventCoverageEntry[];
  gaps: DomainEventGap[];
  warnings: DomainEventWarning[];
};

type DomainEventDiscovery = {
  producerModulesByEvent: Record<string, string[]>;
  adminListenersByEvent: Record<string, string[]>;
  clientListenersByEvent: Record<string, string[]>;
};

type RegistryDefaults = {
  producerModules: string[];
  expectedInvalidations: string[];
  adminListeners: string[];
  clientListeners: string[];
  relatedActivityTypes: string[];
};

const DEFAULTS_BY_CONTEXT: Record<BoundedContextId, RegistryDefaults> = {
  'workspace-command-center': {
    producerModules: ['server/routes/workspaces.ts', 'server/routes/workspace-home.ts'],
    expectedInvalidations: ['queryKeys.admin.workspace*', 'queryKeys.admin.workspaceHome'],
    adminListeners: ['src/hooks/useWsInvalidation.ts', 'src/components/WorkspaceHome.tsx'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['workspace_updated', 'workspace_settings_updated'],
  },
  'client-portal': {
    producerModules: ['server/routes/public-portal.ts', 'server/routes/public-auth.ts'],
    expectedInvalidations: ['queryKeys.client.*', 'queryKeys.shared.*'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['portal_session', 'client_profile_updated'],
  },
  inbox: {
    producerModules: ['server/routes/approvals.ts', 'server/routes/public-content.ts', 'server/routes/public-requests.ts'],
    expectedInvalidations: ['queryKeys.admin.approvals', 'queryKeys.client.approvals', 'queryKeys.client.clientActions'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['approval_sent', 'approval_applied', 'changes_requested'],
  },
  'content-pipeline': {
    producerModules: ['server/routes/content-briefs.ts', 'server/routes/content-posts.ts', 'server/routes/content-plan-review.ts'],
    expectedInvalidations: ['queryKeys.admin.briefs', 'queryKeys.admin.posts', 'queryKeys.client.contentRequests', 'queryKeys.client.contentPlan'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['content_requested', 'post_updated', 'content_published'],
  },
  schema: {
    producerModules: ['server/routes/webflow-schema.ts', 'server/schema-generation-job.ts'],
    expectedInvalidations: ['queryKeys.admin.schema*'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['schema_plan_sent', 'schema_published', 'schema_validation_run'],
  },
  'seo-health': {
    producerModules: ['server/routes/webflow-seo-apply.ts', 'server/routes/webflow-seo-suggestions.ts', 'server/routes/jobs.ts'],
    expectedInvalidations: ['queryKeys.admin.seo*', 'queryKeys.shared.recommendations', 'queryKeys.shared.auditSummary'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['seo_updated', 'audit_completed', 'recommendations_updated'],
  },
  'analytics-intelligence': {
    producerModules: ['server/routes/insights.ts', 'server/routes/briefing.ts', 'server/anomaly-detection.ts'],
    expectedInvalidations: ['queryKeys.admin.intelligence*', 'queryKeys.client.intelligence', 'queryKeys.client.clientInsights'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['insight_resolved', 'briefing_published', 'anomaly_detected'],
  },
  'brand-engine': {
    producerModules: ['server/routes/brandscript.ts', 'server/routes/voice-calibration.ts', 'server/routes/copy-pipeline.ts'],
    expectedInvalidations: ['queryKeys.admin.brand*', 'queryKeys.admin.copy*'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['brandscript_updated', 'voice_profile_updated', 'copy_approved'],
  },
  'outcomes-roi': {
    producerModules: ['server/routes/outcomes.ts', 'server/outcome-playbooks.ts', 'server/external-detection.ts'],
    expectedInvalidations: ['queryKeys.admin.outcome*', 'queryKeys.client.outcome*'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['client_action_completed', 'outcome_scored', 'outcome_learning_updated'],
  },
  'billing-monetization': {
    producerModules: ['server/stripe.ts', 'server/routes/content-subscriptions.ts'],
    expectedInvalidations: ['queryKeys.admin.workspaceDetail', 'queryKeys.admin.contentPipeline', 'queryKeys.client.contentSubscription'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['content_subscription', 'tier_updated', 'invoice_paid'],
  },
  integrations: {
    producerModules: ['server/webflow-client.ts', 'server/search-console.ts'],
    expectedInvalidations: ['queryKeys.admin.integrations*'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['integration_connected', 'integration_sync_completed'],
  },
  'platform-foundation': {
    producerModules: ['server/routes/jobs.ts', 'server/activity-log.ts', 'server/broadcast.ts'],
    expectedInvalidations: ['queryKeys.admin.backgroundTasks', 'queryKeys.admin.workspaceOverview'],
    adminListeners: ['src/hooks/useWsInvalidation.ts'],
    clientListeners: ['src/components/ClientDashboard.tsx'],
    relatedActivityTypes: ['job_started', 'job_completed', 'activity_logged'],
  },
};

const CONTEXT_BY_EVENT_KEY: Record<WsEventKey, BoundedContextId> = {
  WORKSPACE_UPDATED: 'workspace-command-center',
  PAGE_STATE_UPDATED: 'seo-health',
  CONTENT_SUBSCRIPTION_CREATED: 'billing-monetization',
  CONTENT_SUBSCRIPTION_UPDATED: 'billing-monetization',
  CONTENT_SUBSCRIPTION_RENEWED: 'billing-monetization',
  APPROVAL_UPDATE: 'inbox',
  APPROVAL_APPLIED: 'inbox',
  REQUEST_CREATED: 'inbox',
  REQUEST_UPDATE: 'inbox',
  CONTENT_REQUEST_CREATED: 'content-pipeline',
  CONTENT_REQUEST_UPDATE: 'content-pipeline',
  CONTENT_UPDATED: 'content-pipeline',
  ACTIVITY_NEW: 'platform-foundation',
  AUDIT_COMPLETE: 'seo-health',
  WORK_ORDER_UPDATE: 'inbox',
  ANOMALIES_UPDATE: 'analytics-intelligence',
  CONTENT_PUBLISHED: 'content-pipeline',
  POST_UPDATED: 'content-pipeline',
  INSIGHT_RESOLVED: 'analytics-intelligence',
  INTELLIGENCE_SIGNALS_UPDATED: 'analytics-intelligence',
  SCHEMA_PLAN_SENT: 'schema',
  SCHEMA_CMS_MAPPING_UPDATED: 'schema',
  SCHEMA_SNAPSHOT_UPDATED: 'schema',
  OUTCOME_ACTION_RECORDED: 'outcomes-roi',
  OUTCOME_SCORED: 'outcomes-roi',
  OUTCOME_EXTERNAL_DETECTED: 'outcomes-roi',
  OUTCOME_LEARNINGS_UPDATED: 'outcomes-roi',
  OUTCOME_PLAYBOOK_DISCOVERED: 'outcomes-roi',
  INTELLIGENCE_CACHE_UPDATED: 'analytics-intelligence',
  SUGGESTED_BRIEF_UPDATED: 'content-pipeline',
  INSIGHT_BRIDGE_UPDATED: 'analytics-intelligence',
  ANNOTATION_BRIDGE_CREATED: 'analytics-intelligence',
  CLIENT_SIGNAL_CREATED: 'analytics-intelligence',
  CLIENT_SIGNAL_UPDATED: 'analytics-intelligence',
  CLIENT_ACTION_UPDATE: 'inbox',
  MEETING_BRIEF_GENERATED: 'analytics-intelligence',
  BRANDSCRIPT_UPDATED: 'brand-engine',
  DISCOVERY_UPDATED: 'brand-engine',
  VOICE_PROFILE_UPDATED: 'brand-engine',
  BRAND_IDENTITY_UPDATED: 'brand-engine',
  BLUEPRINT_UPDATED: 'brand-engine',
  BLUEPRINT_GENERATED: 'brand-engine',
  COPY_SECTION_UPDATED: 'brand-engine',
  COPY_METADATA_UPDATED: 'brand-engine',
  COPY_BATCH_PROGRESS: 'brand-engine',
  COPY_BATCH_COMPLETE: 'brand-engine',
  COPY_INTELLIGENCE_UPDATED: 'brand-engine',
  COPY_EXPORT_COMPLETE: 'brand-engine',
  BRIEFING_GENERATED: 'analytics-intelligence',
  BRIEFING_PUBLISHED: 'analytics-intelligence',
  DIAGNOSTIC_COMPLETE: 'seo-health',
  DIAGNOSTIC_FAILED: 'seo-health',
  BULK_OPERATION_PROGRESS: 'seo-health',
  BULK_OPERATION_COMPLETE: 'seo-health',
  BULK_OPERATION_FAILED: 'seo-health',
  RECOMMENDATIONS_UPDATED: 'seo-health',
  STRATEGY_UPDATED: 'seo-health',
};

const PAYLOAD_NOTE_BY_EVENT_KEY: Partial<Record<WsEventKey, string>> = {
  WORKSPACE_UPDATED: 'Workspace metadata and billing/tier updates propagated to admin/client caches.',
  PAGE_STATE_UPDATED: 'Page edit-state payload with page identity + operation details for SEO/CMS editors.',
  CONTENT_UPDATED: 'Content domain payload with `domain` discriminator and resource identifiers.',
  APPROVAL_UPDATE: 'Approval batch/item status changes with `batchId` and optional `itemId`/`action`.',
  CLIENT_ACTION_UPDATE: 'Client-action lifecycle payload with action id/state metadata.',
  SCHEMA_SNAPSHOT_UPDATED: 'Schema snapshot payload with `siteId` and update intent.',
  BRIEFING_PUBLISHED: 'Briefing publication signal for weekly briefing consumers.',
  DIAGNOSTIC_FAILED: 'Diagnostic failure payload with report id and failure context.',
  STRATEGY_UPDATED: 'Strategy keyword/score updates and related summary invalidation payload.',
};

const INVALIDATION_OVERRIDES: Partial<Record<WsEventKey, string[]>> = {
  WORKSPACE_UPDATED: ['queryKeys.admin.workspaceHome', 'queryKeys.admin.workspaceDetail', 'queryKeys.admin.workspaceOverview'],
  PAGE_STATE_UPDATED: ['queryKeys.shared.pageEditStates', 'queryKeys.admin.seoEditorAll', 'queryKeys.admin.cmsEditorAll'],
  CONTENT_UPDATED: ['queryKeys.admin.content*', 'queryKeys.client.contentRequests', 'queryKeys.client.contentPlan', 'queryKeys.client.intelligence'],
  APPROVAL_UPDATE: ['queryKeys.admin.approvals', 'queryKeys.client.approvals', 'queryKeys.admin.workspaceHome'],
  APPROVAL_APPLIED: ['queryKeys.admin.approvals', 'queryKeys.client.approvals', 'queryKeys.admin.seoEditorAll'],
  CLIENT_ACTION_UPDATE: ['queryKeys.admin.clientActions', 'queryKeys.client.clientActions', 'queryKeys.admin.workspaceHome'],
  SCHEMA_SNAPSHOT_UPDATED: ['queryKeys.admin.schemaSnapshot*', 'queryKeys.admin.schemaGraphValidation*'],
  BRIEFING_PUBLISHED: ['queryKeys.client.briefing', 'queryKeys.admin.briefing'],
  STRATEGY_UPDATED: ['queryKeys.admin.keywordStrategy', 'queryKeys.client.strategy', 'queryKeys.admin.workspaceHome'],
};

const ACTIVITY_OVERRIDES: Partial<Record<WsEventKey, string[]>> = {
  APPROVAL_UPDATE: ['approval_sent', 'approval_deleted', 'changes_requested'],
  APPROVAL_APPLIED: ['approval_applied', 'changes_requested'],
  CONTENT_REQUEST_CREATED: ['content_requested'],
  CONTENT_REQUEST_UPDATE: ['brief_approved', 'post_changes_requested'],
  CONTENT_PUBLISHED: ['content_published'],
  POST_UPDATED: ['post_client_edit', 'post_approved'],
  SCHEMA_PLAN_SENT: ['schema_plan_sent'],
  SCHEMA_SNAPSHOT_UPDATED: ['schema_published'],
  CLIENT_ACTION_UPDATE: ['client_action_completed'],
  WORK_ORDER_UPDATE: ['fix_completed'],
  BRIEFING_GENERATED: ['briefing_generated'],
  BRIEFING_PUBLISHED: ['briefing_published'],
  DIAGNOSTIC_COMPLETE: ['diagnostic_completed'],
  DIAGNOSTIC_FAILED: ['diagnostic_failed'],
  RECOMMENDATIONS_UPDATED: ['recommendation_resolved'],
  STRATEGY_UPDATED: ['client_keyword_feedback', 'client_keyword_tracked'],
};

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

function pushUnique(map: Record<string, string[]>, key: string, value: string): void {
  if (!map[key]) map[key] = [];
  if (!map[key].includes(value)) map[key].push(value);
}

function sortRecordValues(record: Record<string, string[]>): Record<string, string[]> {
  const sorted: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(record)) {
    sorted[key] = [...values].sort((a, b) => a.localeCompare(b));
  }
  return sorted;
}

function discoverProducerModulesByEvent(): Record<string, string[]> {
  const producersByEvent: Record<string, string[]> = {};
  const eventNameByKey = new Map<WsEventKey, WsEventName>(
    (Object.keys(WS_EVENTS) as WsEventKey[]).map(key => [key, WS_EVENTS[key]]),
  );

  const callPattern = /broadcastToWorkspace\s*\([^,]+,\s*(WS_EVENTS\.([A-Z_]+)|'([^']+)'|"([^"]+)")/g;
  const files = collectTsFiles(SERVER_DIR);

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    callPattern.lastIndex = 0;

    while ((match = callPattern.exec(source)) !== null) {
      const keyCandidate = match[2] as WsEventKey | undefined;
      const literalCandidate = match[3] ?? match[4];
      const eventName = keyCandidate ? eventNameByKey.get(keyCandidate) : literalCandidate;
      if (!eventName) continue;
      pushUnique(producersByEvent, eventName, relative(ROOT, file));
    }
  }

  return sortRecordValues(producersByEvent);
}

function discoverListenerModulesByEvent(): {
  adminListenersByEvent: Record<string, string[]>;
  clientListenersByEvent: Record<string, string[]>;
} {
  const adminListenersByEvent: Record<string, string[]> = {};
  const clientListenersByEvent: Record<string, string[]> = {};
  const wsEventNameSet = new Set(Object.values(WS_EVENTS));
  const eventNameByKey = new Map<WsEventKey, WsEventName>(
    (Object.keys(WS_EVENTS) as WsEventKey[]).map(key => [key, WS_EVENTS[key]]),
  );

  const computedKeyPattern = /\[WS_EVENTS\.([A-Z_]+)\]/g;
  const literalKeyPattern = /['"]([a-z][a-z0-9-]*:[a-z][a-z0-9_-]*)['"]\s*:/g;
  const files = collectTsFiles(CLIENT_DIR);

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('useWorkspaceEvents') && !source.includes('useWsInvalidation') && !source.includes('useGlobalAdminEvents')) {
      continue;
    }

    const relPath = relative(ROOT, file);
    const listenerMap = relPath.includes('/client/') || relPath.includes('ClientDashboard.tsx')
      ? clientListenersByEvent
      : adminListenersByEvent;

    let match: RegExpExecArray | null;
    computedKeyPattern.lastIndex = 0;
    while ((match = computedKeyPattern.exec(source)) !== null) {
      const key = match[1] as WsEventKey;
      const eventName = eventNameByKey.get(key);
      if (!eventName) continue;
      pushUnique(listenerMap, eventName, relPath);
    }

    literalKeyPattern.lastIndex = 0;
    while ((match = literalKeyPattern.exec(source)) !== null) {
      const literalEventName = match[1];
      if (!wsEventNameSet.has(literalEventName as WsEventName)) continue;
      pushUnique(listenerMap, literalEventName, relPath);
    }
  }

  return {
    adminListenersByEvent: sortRecordValues(adminListenersByEvent),
    clientListenersByEvent: sortRecordValues(clientListenersByEvent),
  };
}

export function discoverDomainEventUsage(): DomainEventDiscovery {
  const producerModulesByEvent = discoverProducerModulesByEvent();
  const {
    adminListenersByEvent,
    clientListenersByEvent,
  } = discoverListenerModulesByEvent();

  return {
    producerModulesByEvent,
    adminListenersByEvent,
    clientListenersByEvent,
  };
}

function buildDefinitionForEvent(eventKey: WsEventKey): DomainEventDefinition {
  const owningContext = CONTEXT_BY_EVENT_KEY[eventKey];
  const defaults = DEFAULTS_BY_CONTEXT[owningContext];
  const eventName = WS_EVENTS[eventKey];

  return {
    eventKey,
    eventName,
    owningContext,
    producerModules: [...defaults.producerModules],
    payloadContractNote: PAYLOAD_NOTE_BY_EVENT_KEY[eventKey] ?? 'Workspace-scoped event payload; see route/service producer contract tests.',
    expectedInvalidations: [...(INVALIDATION_OVERRIDES[eventKey] ?? defaults.expectedInvalidations)],
    adminListeners: [...defaults.adminListeners],
    clientListeners: [...defaults.clientListeners],
    relatedActivityTypes: [...(ACTIVITY_OVERRIDES[eventKey] ?? defaults.relatedActivityTypes)],
  };
}

export const PLATFORM_DOMAIN_EVENT_DEFINITIONS: DomainEventDefinition[] = (Object.keys(WS_EVENTS) as WsEventKey[])
  .map(buildDefinitionForEvent)
  .sort((a, b) => a.eventName.localeCompare(b.eventName));

export function findDomainEventDefinitionGaps(
  entries: DomainEventDefinition[] = PLATFORM_DOMAIN_EVENT_DEFINITIONS,
  discovery: DomainEventDiscovery = discoverDomainEventUsage(),
): DomainEventGap[] {
  const gaps: DomainEventGap[] = [];
  const expectedKeys = new Set<WsEventKey>(Object.keys(WS_EVENTS) as WsEventKey[]);
  const definitionsByKey = new Map(entries.map(entry => [entry.eventKey, entry]));
  const definitionsByName = new Map(entries.map(entry => [entry.eventName, entry]));

  for (const key of expectedKeys) {
    if (!definitionsByKey.has(key)) gaps.push({ eventKey: key, eventName: WS_EVENTS[key], issue: 'Missing registry definition' });
  }

  for (const entry of entries) {
    if (!expectedKeys.has(entry.eventKey)) gaps.push({ eventKey: entry.eventKey, eventName: entry.eventName, issue: 'Unknown WS_EVENTS key in registry' });
    if (!CANONICAL_BOUNDED_CONTEXTS.includes(entry.owningContext)) {
      gaps.push({ eventKey: entry.eventKey, eventName: entry.eventName, issue: 'Unknown bounded context' });
    }
    if (entry.producerModules.length === 0) gaps.push({ eventKey: entry.eventKey, eventName: entry.eventName, issue: 'Missing producer module mapping' });
    if (entry.expectedInvalidations.length === 0) gaps.push({ eventKey: entry.eventKey, eventName: entry.eventName, issue: 'Missing invalidation mapping' });
    if (entry.adminListeners.length === 0 && entry.clientListeners.length === 0) {
      gaps.push({ eventKey: entry.eventKey, eventName: entry.eventName, issue: 'Missing listener surface mapping' });
    }
  }

  const producerEventNames = Object.keys(discovery.producerModulesByEvent);
  for (const eventName of producerEventNames) {
    if (!definitionsByName.has(eventName as WsEventName)) {
      gaps.push({ eventName, issue: 'Orphan producer mapping (broadcast without registry definition)' });
    }
  }

  const listenerEventNames = [
    ...Object.keys(discovery.adminListenersByEvent),
    ...Object.keys(discovery.clientListenersByEvent),
  ];
  for (const eventName of new Set(listenerEventNames)) {
    if (!definitionsByName.has(eventName as WsEventName)) {
      gaps.push({ eventName, issue: 'Orphan listener mapping (frontend handler without registry definition)' });
    }
  }

  return gaps.sort((a, b) => `${a.eventName ?? a.eventKey ?? ''}:${a.issue}`.localeCompare(`${b.eventName ?? b.eventKey ?? ''}:${b.issue}`));
}

function findDomainEventDefinitionWarnings(
  entries: DomainEventCoverageEntry[],
): DomainEventWarning[] {
  const warnings: DomainEventWarning[] = [];
  for (const entry of entries) {
    const unexpectedProducerModules = entry.discoveredProducerModules.filter(
      module => !entry.producerModules.includes(module),
    );
    if (unexpectedProducerModules.length > 0) {
      warnings.push({
        eventKey: entry.eventKey,
        eventName: entry.eventName,
        issue: `Discovered producer modules not listed in registry: ${unexpectedProducerModules.join(', ')}`,
      });
    }

    const unexpectedAdminListenerModules = entry.discoveredAdminListenerModules.filter(
      module => !entry.adminListeners.includes(module),
    );
    if (unexpectedAdminListenerModules.length > 0) {
      warnings.push({
        eventKey: entry.eventKey,
        eventName: entry.eventName,
        issue: `Discovered admin listener modules not listed in registry: ${unexpectedAdminListenerModules.join(', ')}`,
      });
    }

    const unexpectedClientListenerModules = entry.discoveredClientListenerModules.filter(
      module => !entry.clientListeners.includes(module),
    );
    if (unexpectedClientListenerModules.length > 0) {
      warnings.push({
        eventKey: entry.eventKey,
        eventName: entry.eventName,
        issue: `Discovered client listener modules not listed in registry: ${unexpectedClientListenerModules.join(', ')}`,
      });
    }
  }
  return warnings.sort((a, b) => `${a.eventName}:${a.issue}`.localeCompare(`${b.eventName}:${b.issue}`));
}

export function buildDomainEventDefinitionsReport(
  entries: DomainEventDefinition[] = PLATFORM_DOMAIN_EVENT_DEFINITIONS,
  discovery: DomainEventDiscovery = discoverDomainEventUsage(),
): DomainEventDefinitionsReport {
  const coverageEntries: DomainEventCoverageEntry[] = entries
    .map(entry => ({
      ...entry,
      discoveredProducerModules: discovery.producerModulesByEvent[entry.eventName] ?? [],
      discoveredAdminListenerModules: discovery.adminListenersByEvent[entry.eventName] ?? [],
      discoveredClientListenerModules: discovery.clientListenersByEvent[entry.eventName] ?? [],
    }))
    .sort((a, b) => a.eventName.localeCompare(b.eventName));

  return {
    generatedBy: 'scripts/platform-domain-event-definitions.ts',
    advisoryOnly: true,
    contextsExpected: [...CANONICAL_BOUNDED_CONTEXTS],
    wsEventKeysExpected: (Object.keys(WS_EVENTS) as WsEventKey[]).sort((a, b) => a.localeCompare(b)),
    entries: coverageEntries,
    gaps: findDomainEventDefinitionGaps(entries, discovery),
    warnings: findDomainEventDefinitionWarnings(coverageEntries),
  };
}

export function formatDomainEventDefinitionsReportAsMarkdown(
  report: DomainEventDefinitionsReport = buildDomainEventDefinitionsReport(),
): string {
  const lines = [
    '# Platform Domain Event Definitions',
    '',
    '_Read-only advisory report. Structural gaps are reported but do not fail the command._',
    '',
    `WS events expected: ${report.wsEventKeysExpected.length}`,
    `Registry entries: ${report.entries.length}`,
    `Structural gaps: ${report.gaps.length}`,
    `Mapping warnings: ${report.warnings.length}`,
    '',
    '| Event | Context | Producers | Listeners (admin/client) | Invalidations | Activity types |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const entry of report.entries) {
    const listeners = `${entry.adminListeners.join('; ')} / ${entry.clientListeners.join('; ')}`;
    lines.push(
      `| \`${entry.eventName}\` | \`${entry.owningContext}\` | ${entry.producerModules.join('; ')} | ${listeners} | ${entry.expectedInvalidations.join('; ')} | ${entry.relatedActivityTypes.join('; ')} |`,
    );
  }

  if (report.gaps.length > 0) {
    lines.push('', '## Structural Gaps', '');
    for (const gap of report.gaps) {
      const eventLabel = gap.eventName ?? gap.eventKey ?? 'unknown';
      lines.push(`- \`${eventLabel}\`: ${gap.issue}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('', '## Mapping Drift Warnings', '');
    for (const warning of report.warnings) {
      lines.push(`- \`${warning.eventName}\`: ${warning.issue}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function runCli(): void {
  const report = buildDomainEventDefinitionsReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatDomainEventDefinitionsReportAsMarkdown(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
