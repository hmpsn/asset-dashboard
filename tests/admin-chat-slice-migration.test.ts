import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { classifyQuestion } from '../server/admin-chat-context.js';

const src = readFileSync(join(import.meta.dirname, '../server/admin-chat-context.ts'), 'utf-8');

// ── Structural: verify removed imports / preserved wiring ────────────────────

describe('admin-chat-context Task 8 migration — structural checks', () => {
  it('no longer imports listChurnSignals directly', () => {
    expect(src).not.toMatch(/import.*listChurnSignals.*from/);
  });

  it('imports getLinkCheck, getPageSpeed, and getPageWeight for supplemental performance detail', () => {
    // All three re-imported as supplemental direct calls — siteHealth slice stores aggregate
    // counts/averages only; raw snapshots hold per-URL dead links, worst-page scores, and
    // per-page asset weight data. Same pattern as listBatches() supplement for approvals.
    expect(src).toMatch(/import.*getLinkCheck.*from/);
    expect(src).toMatch(/import.*getPageSpeed.*from/);
    expect(src).toMatch(/import.*getPageWeight.*from/);
  });

  it('no longer imports listActivity directly', () => {
    expect(src).not.toMatch(/import.*listActivity.*from/);
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

  it('tokenBudget is not passed to buildWorkspaceIntelligence (no-op removed)', () => {
    // tokenBudget has no effect in buildWorkspaceIntelligence — only formatForPrompt applies it.
    // admin-chat-context never calls formatForPrompt, so the option was dead code. Confirmed gone.
    expect(src).not.toMatch(/tokenBudget.*GENERAL_INTEL_TOKEN_BUDGET/);
  });
});

// ── Behavioural: classifyQuestion slice routing ──────────────────────────────

describe('classifyQuestion — slice routing logic', () => {
  it('activity questions route to operational slice', () => {
    const cats = classifyQuestion('what happened recently with this workspace?');
    expect(cats.has('activity')).toBe(true);
  });

  it('performance questions route to siteHealth slice', () => {
    const cats = classifyQuestion('how is site performance looking?');
    expect(cats.has('performance')).toBe(true);
  });

  it('client questions route to clientSignals slice', () => {
    const cats = classifyQuestion('how is the client doing?');
    expect(cats.has('client')).toBe(true);
  });

  it('approvals questions route to approvals category', () => {
    const cats = classifyQuestion('what approvals are pending?');
    expect(cats.has('approvals')).toBe(true);
  });

  it('general questions are classified as general category (triggers broadest slice union in assembleAdminContext)', () => {
    // classifyQuestion returns 'general'; assembleAdminContext then unions operational+siteHealth+clientSignals
    const cats = classifyQuestion('give me a full overview of this workspace');
    expect(cats.has('general')).toBe(true);
  });

  it('specific category questions do NOT trigger general expansion', () => {
    // A targeted activity question should NOT also trigger performance/client slices
    const cats = classifyQuestion('show me recent activity');
    expect(cats.has('activity')).toBe(true);
    expect(cats.has('general')).toBe(false);
  });

  it('churn-related question routes to client category', () => {
    const cats = classifyQuestion('is this client at risk of churning?');
    expect(cats.has('client')).toBe(true);
  });

  it('competitor questions route to competitors category', () => {
    const cats = classifyQuestion('how do we compare to competitors?');
    expect(cats.has('competitors')).toBe(true);
  });
});
