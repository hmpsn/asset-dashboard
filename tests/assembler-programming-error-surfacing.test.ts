// tests/assembler-programming-error-surfacing.test.ts
// Verifies that programming errors (TypeError, ReferenceError) inside assembler
// catch blocks surface as log.warn, not silent degradation — the PR #154 pattern.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mock fn refs so they're accessible inside vi.mock factories ──────
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
vi.mock('../server/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(() => false),
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('isProgrammingError utility', () => {
  beforeEach(() => {
    mockWarn.mockClear();
    mockDebug.mockClear();
  });

  it('returns true for TypeError', async () => {
    const { isProgrammingError } = await import('../server/errors.js');
    expect(isProgrammingError(new TypeError('Cannot read properties of undefined'))).toBe(true);
  });

  it('returns true for ReferenceError', async () => {
    const { isProgrammingError } = await import('../server/errors.js');
    expect(isProgrammingError(new ReferenceError('getTopWinsFromActions is not defined'))).toBe(true);
  });

  it('returns true for SyntaxError', async () => {
    const { isProgrammingError } = await import('../server/errors.js');
    expect(isProgrammingError(new SyntaxError('Unexpected token'))).toBe(true);
  });

  it('returns true for RangeError (e.g. stack overflow)', async () => {
    const { isProgrammingError } = await import('../server/errors.js');
    expect(isProgrammingError(new RangeError('Maximum call stack size exceeded'))).toBe(true);
  });

  it('returns false for a plain Error (expected degradation)', async () => {
    const { isProgrammingError } = await import('../server/errors.js');
    expect(isProgrammingError(new Error('no such table: rank_tracking'))).toBe(false);
  });

  it('returns false for a string thrown value', async () => {
    const { isProgrammingError } = await import('../server/errors.js');
    expect(isProgrammingError('something went wrong')).toBe(false);
  });
});

// The assembler-escalation test that used to live here as a
// `describe.skip` block was extracted in Round 2 Task P3.2 to
// `tests/assembler-escalation.test.ts`. The reason: `vi.mock()` inside
// a test body cannot override a top-level `vi.mock()` that was already
// hoisted during module-graph resolution. Giving the escalation test
// its own file provides a clean module graph where the throwing
// `outcome-tracking` mock is hoisted from the start, so
// `buildWorkspaceIntelligence` captures the throwing version on import.
// That test now runs on every CI build — no skip remains.
