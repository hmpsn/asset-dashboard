import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(import.meta.dirname, '../server/admin-chat-context.ts'), 'utf-8');

describe('admin-chat-context Task 8 migration', () => {
  it('no longer imports listChurnSignals directly', () => {
    expect(src).not.toMatch(/import.*listChurnSignals.*from/);
  });

  it('no longer imports getPageSpeed, getPageWeight, getLinkCheck directly', () => {
    expect(src).not.toMatch(/import.*getPageSpeed.*from/);
    expect(src).not.toMatch(/import.*getPageWeight.*from/);
    expect(src).not.toMatch(/import.*getLinkCheck.*from/);
  });

  it('no longer imports listActivity directly', () => {
    expect(src).not.toMatch(/import.*listActivity.*from/);
  });

  it('uses GENERAL_INTEL_TOKEN_BUDGET constant', () => {
    expect(src).toMatch(/GENERAL_INTEL_TOKEN_BUDGET/);
    expect(src).toMatch(/tokenBudget.*GENERAL_INTEL_TOKEN_BUDGET/);
  });

  it('uses intel.operational for activity', () => {
    expect(src).toMatch(/intel\.operational\?\.recentActivity/);
  });

  it('uses intel.siteHealth for performance', () => {
    expect(src).toMatch(/intel\.siteHealth/);
    expect(src).toMatch(/performanceSummary/);
  });

  it('uses intel.clientSignals for client health', () => {
    expect(src).toMatch(/intel\.clientSignals/);
    expect(src).toMatch(/compositeHealthScore/);
  });

  it('still imports listBatches (approvals direct call preserved)', () => {
    expect(src).toMatch(/import.*listBatches.*from/);
  });
});
