// tests/bridge-wiring.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const serverDir = path.resolve(import.meta.dirname, '../server');

describe('Bridge #1: outcome→reweight', () => {
  it('recordOutcome imports and calls debouncedOutcomeReweight for actionable scores', () => {
    const src = fs.readFileSync(path.join(serverDir, 'outcome-tracking.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts Bridge #1 wires outcome→reweight via debouncedOutcomeReweight with withWorkspaceLock and actionableScores.
    expect(src).toContain('debouncedOutcomeReweight');
    expect(src).toContain('withWorkspaceLock');
    expect(src).toContain('actionableScores');
  });
});

describe('Bridge #10: anomaly→boost insight severity', () => {
  it('anomaly detection calls debouncedAnomalyBoost', () => {
    const src = fs.readFileSync(path.join(serverDir, 'anomaly-detection.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts Bridge #10 anomaly detection calls debouncedAnomalyBoost to boost insight severity.
    expect(src).toContain('debouncedAnomalyBoost');
  });
});

describe('Bridge #12: audit→audit_finding insights (page-level)', () => {
  it('scheduled audits fire bridge-audit-page-health with audit_finding type', () => {
    const src = fs.readFileSync(path.join(serverDir, 'scheduled-audits.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts Bridge #12 fires bridge-audit-page-health with audit_finding insight type.
    expect(src).toContain('bridge-audit-page-health');
    expect(src).toContain("insightType: 'audit_finding'");
  });
});

describe('Bridge #15: audit→audit_finding insights (site-level)', () => {
  it('scheduled audits fire bridge-audit-site-health with audit_finding type', () => {
    const src = fs.readFileSync(path.join(serverDir, 'scheduled-audits.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts Bridge #15 fires bridge-audit-site-health with site scope.
    expect(src).toContain('bridge-audit-site-health');
    expect(src).toContain("scope: 'site'");
  });
});

describe('Bridge infrastructure: bridgeSource pattern', () => {
  it('Bridge #12 uses bridgeSource instead of resolveInsight hack', () => {
    const src = fs.readFileSync(path.join(serverDir, 'scheduled-audits.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts Bridge #12 uses bridgeSource immunity pattern instead of the deprecated resolveInsight hack.
    expect(src).toContain("bridgeSource: 'bridge-audit-page-health'");
    // The resolveInsight('in_progress') hack should be gone from bridge sections
    const bridge12Section = src.slice(src.indexOf('Bridge #12'), src.indexOf('Bridge #15'));
    expect(bridge12Section).not.toContain('resolveInsight(insight.id');
  });

  it('Bridge #15 uses bridgeSource instead of resolveInsight hack', () => {
    const src = fs.readFileSync(path.join(serverDir, 'scheduled-audits.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts Bridge #15 uses bridgeSource immunity pattern instead of the deprecated resolveInsight hack.
    expect(src).toContain("bridgeSource: 'bridge-audit-site-health'");
    const bridge15Section = src.slice(src.indexOf('Bridge #15'));
    expect(bridge15Section).not.toContain('resolveInsight(insight.id');
  });
});

describe('Bridge infrastructure: composable score adjustments', () => {
  it('Bridge #1 uses applyScoreAdjustment instead of _outcomeBaseScore', () => {
    const src = fs.readFileSync(path.join(serverDir, 'outcome-tracking.ts'), 'utf-8'); // readFile-ok — migration guard: asserts Bridge #1 replaced the deprecated _outcomeBaseScore field with composable applyScoreAdjustment().
    expect(src).toContain('applyScoreAdjustment');
    expect(src).not.toContain('_outcomeBaseScore');
  });

  it('Bridge #10 uses applyScoreAdjustment instead of _anomalyBaseScore', () => {
    const src = fs.readFileSync(path.join(serverDir, 'anomaly-detection.ts'), 'utf-8'); // readFile-ok — migration guard: asserts Bridge #10 replaced the deprecated _anomalyBaseScore field with composable applyScoreAdjustment().
    expect(src).toContain('applyScoreAdjustment');
    expect(src).not.toContain('_anomalyBaseScore');
  });
});

describe('Bridge infrastructure: auto-broadcast', () => {
  it('no bridge callback manually imports broadcastToWorkspace for bridge events', () => {
    const outcomeTrackingSrc = fs.readFileSync(path.join(serverDir, 'outcome-tracking.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts bridge callbacks return { modified } without manually calling broadcastToWorkspace (executeBridge handles broadcast).
    const anomalyDetectionSrc = fs.readFileSync(path.join(serverDir, 'anomaly-detection.ts'), 'utf-8'); // readFile-ok — bridge wiring guard: asserts bridge callbacks return { modified } without manually calling broadcastToWorkspace (executeBridge handles broadcast).

    // Bridge #1 callback section should not contain broadcastToWorkspace
    // (Other parts of outcome-tracking.ts still use it for non-bridge purposes)
    // Use a specific anchor to avoid matching "Bridge #13" which precedes Bridge #1 in the file
    const bridge1Section = outcomeTrackingSrc.slice(
      outcomeTrackingSrc.indexOf('Bridge #1: Outcome'),
      outcomeTrackingSrc.indexOf('return rowToActionOutcome'),
    );
    expect(bridge1Section).not.toContain('broadcastToWorkspace');
    expect(bridge1Section).toContain('return { modified');

    // Bridge #10 callback section — end at the unique log.error line that follows it
    const bridge10Start = anomalyDetectionSrc.indexOf('Bridge #10');
    const bridge10Section = anomalyDetectionSrc.slice(
      bridge10Start,
      anomalyDetectionSrc.indexOf('log.error({ err', bridge10Start),
    );
    expect(bridge10Section).not.toContain('broadcastToWorkspace');
    expect(bridge10Section).toContain('return { modified');
  });
});

describe('Bridge infrastructure: BridgeResult support', () => {
  it('executeBridge supports BridgeResult return type', () => {
    const src = fs.readFileSync(path.join(serverDir, 'bridge-infrastructure.ts'), 'utf-8'); // readFile-ok — contract guard: asserts executeBridge exports the BridgeResult interface and auto-dispatches INSIGHT_BRIDGE_UPDATED on modified > 0.
    expect(src).toContain('export interface BridgeResult');
    expect(src).toContain('INSIGHT_BRIDGE_UPDATED');
  });
});
