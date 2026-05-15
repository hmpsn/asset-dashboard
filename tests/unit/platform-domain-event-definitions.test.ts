import { describe, expect, it } from 'vitest';

import { WS_EVENTS } from '../../server/ws-events.js';
import {
  PLATFORM_DOMAIN_EVENT_DEFINITIONS,
  buildDomainEventDefinitionsReport,
  findDomainEventDefinitionGaps,
  formatDomainEventDefinitionsReportAsMarkdown,
  type DomainEventDefinition,
} from '../../scripts/platform-domain-event-definitions.js';

describe('platform domain event definitions', () => {
  it('includes exactly one registry entry for every WS_EVENTS key', () => {
    const expectedKeys = Object.keys(WS_EVENTS).sort();
    const actualKeys = PLATFORM_DOMAIN_EVENT_DEFINITIONS.map(entry => entry.eventKey).sort();

    expect(actualKeys).toEqual(expectedKeys);
    expect(new Set(actualKeys).size).toBe(expectedKeys.length);
  });

  it('emits stable advisory JSON with no structural gaps for current registry', () => {
    const report = buildDomainEventDefinitionsReport();
    const parsed = JSON.parse(JSON.stringify(report, null, 2)) as typeof report;

    expect(parsed.generatedBy).toBe('scripts/platform-domain-event-definitions.ts');
    expect(parsed.advisoryOnly).toBe(true);
    expect(parsed.wsEventKeysExpected).toEqual(Object.keys(WS_EVENTS).sort((a, b) => a.localeCompare(b)));
    expect(parsed.entries.length).toBe(Object.keys(WS_EVENTS).length);
    expect(parsed.gaps).toEqual([]);
    expect(Array.isArray(parsed.warnings)).toBe(true);
  });

  it('reports orphan producer/listener mappings as advisory gaps', () => {
    const minimalRegistry: DomainEventDefinition[] = PLATFORM_DOMAIN_EVENT_DEFINITIONS.filter(
      entry => entry.eventKey !== 'APPROVAL_UPDATE',
    );

    const mockedDiscovery = {
      producerModulesByEvent: {
        [WS_EVENTS.APPROVAL_UPDATE]: ['server/routes/approvals.ts'],
      },
      adminListenersByEvent: {
        [WS_EVENTS.APPROVAL_UPDATE]: ['src/hooks/useWsInvalidation.ts'],
      },
      clientListenersByEvent: {},
    };

    const gaps = findDomainEventDefinitionGaps(minimalRegistry, mockedDiscovery);
    expect(gaps).toContainEqual({
      eventKey: 'APPROVAL_UPDATE',
      eventName: WS_EVENTS.APPROVAL_UPDATE,
      issue: 'Missing registry definition',
    });
    expect(gaps).toContainEqual({
      eventName: WS_EVENTS.APPROVAL_UPDATE,
      issue: 'Orphan producer mapping (broadcast without registry definition)',
    });
    expect(gaps).toContainEqual({
      eventName: WS_EVENTS.APPROVAL_UPDATE,
      issue: 'Orphan listener mapping (frontend handler without registry definition)',
    });
  });

  it('reports mapping drift warnings when discovered modules are not in registry lists', () => {
    const singleEntryRegistry: DomainEventDefinition[] = [
      {
        eventKey: 'APPROVAL_UPDATE',
        eventName: WS_EVENTS.APPROVAL_UPDATE,
        owningContext: 'inbox',
        producerModules: ['server/routes/approvals.ts'],
        payloadContractNote: 'test',
        expectedInvalidations: ['queryKeys.admin.approvals'],
        adminListeners: ['src/hooks/useWsInvalidation.ts'],
        clientListeners: ['src/components/ClientDashboard.tsx'],
        relatedActivityTypes: ['approval_sent'],
      },
    ];

    const mockedDiscovery = {
      producerModulesByEvent: {
        [WS_EVENTS.APPROVAL_UPDATE]: ['server/routes/approvals.ts', 'server/routes/content-plan-review.ts'],
      },
      adminListenersByEvent: {
        [WS_EVENTS.APPROVAL_UPDATE]: ['src/hooks/useWsInvalidation.ts', 'src/components/AdminInbox.tsx'],
      },
      clientListenersByEvent: {
        [WS_EVENTS.APPROVAL_UPDATE]: ['src/components/ClientDashboard.tsx', 'src/components/client/DecisionCard.tsx'],
      },
    };

    const report = buildDomainEventDefinitionsReport(singleEntryRegistry, mockedDiscovery);
    expect(report.warnings).toContainEqual({
      eventKey: 'APPROVAL_UPDATE',
      eventName: WS_EVENTS.APPROVAL_UPDATE,
      issue: 'Discovered producer modules not listed in registry: server/routes/content-plan-review.ts',
    });
    expect(report.warnings).toContainEqual({
      eventKey: 'APPROVAL_UPDATE',
      eventName: WS_EVENTS.APPROVAL_UPDATE,
      issue: 'Discovered admin listener modules not listed in registry: src/components/AdminInbox.tsx',
    });
    expect(report.warnings).toContainEqual({
      eventKey: 'APPROVAL_UPDATE',
      eventName: WS_EVENTS.APPROVAL_UPDATE,
      issue: 'Discovered client listener modules not listed in registry: src/components/client/DecisionCard.tsx',
    });
  });

  it('formats markdown for human review', () => {
    const markdown = formatDomainEventDefinitionsReportAsMarkdown();
    expect(markdown).toContain('# Platform Domain Event Definitions');
    expect(markdown).toContain('Structural gaps: 0');
    expect(markdown).toContain('Mapping warnings:');
    expect(markdown).toContain('`approval:update`');
    expect(markdown).toContain('Listeners (admin/client)');
  });
});
