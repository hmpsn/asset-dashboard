// tests/assembler-escalation.test.ts
//
// This file is a sibling to tests/assembler-programming-error-surfacing.test.ts.
// The latter covers the `isProgrammingError` pure utility. This file covers
// the end-to-end escalation contract: when an assembler (e.g. `assembleLearnings`)
// catches a programming error thrown by an upstream helper, it must surface
// the failure as `log.warn` (not silent `log.debug`) so the operator sees
// the problem.
//
// ── Why a separate file? ───────────────────────────────────────────────────
// The companion file mocks `outcome-tracking` with stable no-op helpers at
// the module-top level. A `vi.mock()` call inside a test body cannot
// override a top-level mock that was already hoisted during module-graph
// resolution. Putting the escalation test in its own file gives it a clean
// module graph where `outcome-tracking` is hoisted with the THROWING mock
// from the start, so `buildWorkspaceIntelligence` captures the throwing
// version when it imports the helper.
//
// ── Round 2 Task P3.2 ──────────────────────────────────────────────────────
// Previously this test lived in a `describe.skip(...)` block inside the
// companion file with a comment explaining the vitest hoisting limitation.
// The 2026-04-10 pr-check audit flagged the skip as an unenforced test.
// Extracting it into this file removes the skip entirely — the test now
// runs on every CI build.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mock fn refs so they're accessible inside vi.mock factories ─────
const { mockWarn, mockDebug } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockDebug: vi.fn(),
}));

// ── Logger mock ────────────────────────────────────────────────────────────
vi.mock('../server/logger.js', () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: vi.fn(),
    debug: mockDebug,
    error: vi.fn(),
  }),
}));

// ── Minimal dependency mocks (workspace-intelligence.ts needs these) ───────
vi.mock('../server/db/index.js', () => ({
  default: {
    prepare: vi.fn(() => ({ all: vi.fn(() => []), get: vi.fn(() => undefined), run: vi.fn() })),
  },
}));
vi.mock('../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));
vi.mock('../server/seo-context.js', () => ({
  buildSeoContext: vi.fn(() => ({ strategy: null, brandVoiceBlock: '', businessContext: '', knowledgeBlock: '' })),
  getRawBrandVoice: vi.fn(() => ''),
  getRawKnowledge: vi.fn(() => ''),
}));
vi.mock('../server/workspaces.js', () => ({
  getWorkspace: vi.fn(() => ({ id: 'ws-test', personas: [] })),
}));
// `assembleLearnings` has an early-return guard on the `outcome-ai-injection`
// feature flag (server/workspace-intelligence.ts:392). Return `true` so
// the function proceeds to the `outcome-tracking` dynamic import and our
// throwing mock is actually hit. Every other flag can stay false.
vi.mock('../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn((flag: string) => flag === 'outcome-ai-injection'),
}));
vi.mock('../server/workspace-learnings.js', () => ({
  getWorkspaceLearnings: vi.fn(() => null),
}));
vi.mock('../server/outcome-playbooks.js', () => ({
  getPlaybooks: vi.fn(() => []),
}));
vi.mock('../server/analytics-insights-store.js', () => ({
  getInsights: vi.fn(() => []),
}));
vi.mock('../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../server/ws-events.js', () => ({
  WS_EVENTS: { INTELLIGENCE_CACHE_UPDATED: 'intelligence:cache_updated' },
}));

// ── The throwing mock — this is what was unreachable in the companion
//     file. By hoisting it at module-top level we guarantee
//     `workspace-intelligence.ts` captures the throwing version when it
//     resolves its import of `outcome-tracking`. Simulates a renamed
//     helper (`getTopWinsFromActions`) that callers try to access and
//     hit `undefined is not a function` — a textbook programming error.
// Hoisted so the test body can assert that the throwing fn was actually
// invoked (separating "wrong mock wiring" from "escalation contract
// broken"). Without this sanity check both failure modes produce the
// same `expect(mockWarn.calls.length).toBeGreaterThan(0)` assertion
// failure, making regressions ambiguous to diagnose.
const { throwingGetActionsByWorkspace } = vi.hoisted(() => ({
  throwingGetActionsByWorkspace: vi.fn(() => {
    throw new TypeError('getTopWinsFromActions is not a function');
  }),
}));

vi.mock('../server/outcome-tracking.js', () => ({
  getActionsByWorkspace: throwingGetActionsByWorkspace,
  getOutcomesForAction: vi.fn(() => []),
  getTopWinsFromActions: undefined,
  getPendingActions: vi.fn(() => []),
  getActionsByPage: vi.fn(() => []),
}));

vi.mock('../server/roi-attribution.js', () => ({
  getROIAttributionsRaw: vi.fn(() => []),
}));

describe('assembler catch block escalation', () => {
  beforeEach(() => {
    mockWarn.mockClear();
    mockDebug.mockClear();
    throwingGetActionsByWorkspace.mockClear();
  });

  it('assembleLearnings: TypeError in outcome-tracking surfaces as log.warn (not silent)', async () => {
    const { invalidateIntelligenceCache, buildWorkspaceIntelligence } = await import(
      '../server/workspace-intelligence.js'
    );
    invalidateIntelligenceCache('ws-test');

    const result = await buildWorkspaceIntelligence('ws-test', { slices: ['learnings'] });

    // Must still return a result (graceful degradation preserved — the
    // assembler's catch block returns an empty/fallback slice rather
    // than propagating the error).
    expect(result).toBeDefined();
    expect(result.learnings).toBeDefined();

    // Sanity: the throwing mock was actually reached. If this fails but
    // the log.warn assertion below also fails, the regression is in the
    // mock wiring (feature flag, dynamic import path), NOT in the
    // assembler escalation contract. Without this check both failures
    // look identical.
    expect(throwingGetActionsByWorkspace).toHaveBeenCalled();

    // Programming error must surface as warn, not silent debug. The
    // exact log shape is `log.warn({ err, ... }, 'programming error in
    // assembler X')` — any mock call containing 'programming error'
    // satisfies the contract.
    expect(mockWarn.mock.calls.length).toBeGreaterThan(0);
    const warnCalls = mockWarn.mock.calls.map((c) => JSON.stringify(c));
    expect(warnCalls.some((m) => m.includes('programming error'))).toBe(true);
  });
});
