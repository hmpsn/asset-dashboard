// tests/bridge-wiring.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const serverDir = path.resolve(import.meta.dirname, '../server');

describe('Bridge #1: outcome→reweight', () => {
  it('recordOutcome imports and calls debouncedOutcomeReweight for actionable scores', () => {
    const src = fs.readFileSync(path.join(serverDir, 'outcome-tracking.ts'), 'utf-8');
    expect(src).toContain('debouncedOutcomeReweight');
    expect(src).toContain('withWorkspaceLock');
    expect(src).toContain('actionableScores');
  });
});

describe('Bridge #10: anomaly→boost insight severity', () => {
  it('anomaly detection calls debouncedAnomalyBoost', () => {
    const src = fs.readFileSync(path.join(serverDir, 'anomaly-detection.ts'), 'utf-8');
    expect(src).toContain('debouncedAnomalyBoost');
  });
});

describe('Bridge #12: audit→page_health insights', () => {
  it('scheduled audits fire bridge-audit-page-health', () => {
    const src = fs.readFileSync(path.join(serverDir, 'scheduled-audits.ts'), 'utf-8');
    expect(src).toContain('bridge-audit-page-health');
  });
});

describe('Bridge #15: audit→site_health insights', () => {
  it('scheduled audits fire bridge-audit-site-health', () => {
    const src = fs.readFileSync(path.join(serverDir, 'scheduled-audits.ts'), 'utf-8');
    expect(src).toContain('bridge-audit-site-health');
  });
});
