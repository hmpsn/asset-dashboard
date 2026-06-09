// tests/bridge-wiring.test.ts
import { describe, it, expect } from 'vitest';
import { boundedSection, expectContainsAll, expectOmitsAll, readProjectFile } from './helpers/source-contracts';

describe('Bridge #1: outcome→reweight', () => {
  it('recordOutcome imports and calls debouncedOutcomeReweight for actionable scores', () => {
    const src = readProjectFile('server/outcome-tracking.ts');
    expectContainsAll(src, ['debouncedOutcomeReweight', 'withWorkspaceLock', 'actionableScores']);
  });
});

describe('Bridge #10: anomaly→boost insight severity', () => {
  it('anomaly detection calls debouncedAnomalyBoost', () => {
    const src = readProjectFile('server/anomaly-detection.ts');
    expect(src).toContain('debouncedAnomalyBoost');
  });
});

describe('Bridge #12: audit→audit_finding insights (page-level)', () => {
  it('scheduled audits fire bridge-audit-page-health with audit_finding type', () => {
    const src = readProjectFile('server/scheduled-audits.ts');
    expectContainsAll(src, ['bridge-audit-page-health', "insightType: 'audit_finding'"]);
  });
});

describe('Bridge #15: audit→audit_finding insights (site-level)', () => {
  it('scheduled audits fire bridge-audit-site-health with audit_finding type', () => {
    const src = readProjectFile('server/scheduled-audits.ts');
    expectContainsAll(src, ['bridge-audit-site-health', "scope: 'site'"]);
  });
});

describe('Bridge infrastructure: bridgeSource pattern', () => {
  it('Bridge #12 uses bridgeSource instead of resolveInsight hack', () => {
    const src = readProjectFile('server/scheduled-audits.ts');
    expect(src).toContain("bridgeSource: 'bridge-audit-page-health'");
    // The resolveInsight('in_progress') hack should be gone from bridge sections
    const bridge12Section = boundedSection(src, 'Bridge #12', ['Bridge #15']);
    expect(bridge12Section).not.toContain('resolveInsight(insight.id');
  });

  it('Bridge #15 uses bridgeSource instead of resolveInsight hack', () => {
    const src = readProjectFile('server/scheduled-audits.ts');
    expect(src).toContain("bridgeSource: 'bridge-audit-site-health'");
    const bridge15Section = boundedSection(src, 'Bridge #15', []);
    expect(bridge15Section).not.toContain('resolveInsight(insight.id');
  });
});

describe('Bridge infrastructure: legacy failure guards', () => {
  it('rejects invalid legacy resolveInsight in_progress bridge pattern', () => {
    const scheduledAuditsSrc = readProjectFile('server/scheduled-audits.ts');
    const outcomeTrackingSrc = readProjectFile('server/outcome-tracking.ts');

    expect(scheduledAuditsSrc).not.toContain("resolveInsight(insight.id, 'in_progress'");
    expect(outcomeTrackingSrc).not.toContain("resolveInsight(insight.id, 'in_progress'");
  });
});

describe('Bridge infrastructure: composable score adjustments', () => {
  it('Bridge #1 uses applyScoreAdjustment instead of _outcomeBaseScore', () => {
    const src = readProjectFile('server/outcome-tracking.ts');
    expect(src).toContain('applyScoreAdjustment');
    expect(src).not.toContain('_outcomeBaseScore');
  });

  it('Bridge #10 uses applyScoreAdjustment instead of _anomalyBaseScore', () => {
    const src = readProjectFile('server/anomaly-detection.ts');
    expect(src).toContain('applyScoreAdjustment');
    expect(src).not.toContain('_anomalyBaseScore');
  });
});

describe('Bridge infrastructure: auto-broadcast', () => {
  it('no bridge callback manually imports broadcastToWorkspace for bridge events', () => {
    const outcomeTrackingSrc = readProjectFile('server/outcome-tracking.ts');
    const anomalyDetectionSrc = readProjectFile('server/anomaly-detection.ts');

    // Bridge #1 callback section should not contain broadcastToWorkspace
    // (Other parts of outcome-tracking.ts still use it for non-bridge purposes)
    // Use a specific anchor to avoid matching "Bridge #13" which precedes Bridge #1 in the file
    const bridge1Section = boundedSection(outcomeTrackingSrc, 'Bridge #1: Outcome', ['return rowToActionOutcome']);
    expectOmitsAll(bridge1Section, ['broadcastToWorkspace']);
    expect(bridge1Section).toContain('return { modified');

    // Bridge #10 callback section — end at the unique log.error line that follows it
    const bridge10Section = boundedSection(anomalyDetectionSrc, 'Bridge #10', ['log.error({ err']);
    expect(bridge10Section).not.toContain('broadcastToWorkspace');
    expect(bridge10Section).toContain('return { modified');
  });
});

describe('Bridge infrastructure: BridgeResult support', () => {
  it('executeBridge supports BridgeResult return type', () => {
    const src = readProjectFile('server/bridge-infrastructure.ts');
    expectContainsAll(src, ['export interface BridgeResult', 'INSIGHT_BRIDGE_UPDATED']);
  });
});
