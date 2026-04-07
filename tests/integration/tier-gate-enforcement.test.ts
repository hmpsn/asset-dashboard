/**
 * Integration tests for tier-gated public endpoints.
 *
 * Tests that tier restrictions are enforced across public-facing API endpoints:
 *   - Free tier  → limited access (reduced limits, no premium slices)
 *   - Growth tier → partial access (expanded limits, learnings enabled)
 *   - Premium tier → full access (unlimited, all slices)
 *
 * Key endpoints tested:
 *   - GET /api/public/usage/:workspaceId         — per-feature limits vary by tier
 *   - GET /api/public/chat-usage/:workspaceId     — chat limits vary by tier
 *   - GET /api/public/tier/:id                    — effective tier info with trial logic
 *   - GET /api/public/workspace/:id               — tier included in workspace response
 *   - GET /api/public/intelligence/:workspaceId   — response shape gated by tier
 *
 * Tier limits reference (from server/usage-tracking.ts):
 *   free:    { ai_chats: 3, strategy_generations: 0 }
 *   growth:  { ai_chats: 50, strategy_generations: 3 }
 *   premium: { ai_chats: Infinity, strategy_generations: Infinity }
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';

const ctx = createTestContext(13312);
const { api } = ctx;

let freeWs: SeededFullWorkspace;
let growthWs: SeededFullWorkspace;
let premiumWs: SeededFullWorkspace;
let trialWs: SeededFullWorkspace;

beforeAll(async () => {
  await ctx.startServer();

  // clientPassword: '' ensures the client-session middleware passes through
  // without requiring authentication cookies (same pattern as contract tests).
  freeWs = seedWorkspace({ tier: 'free', clientPassword: '' });
  growthWs = seedWorkspace({ tier: 'growth', clientPassword: '' });
  premiumWs = seedWorkspace({ tier: 'premium', clientPassword: '' });

  // Trial workspace: free tier with future trialEndsAt → effective tier becomes growth
  trialWs = seedWorkspace({ tier: 'free', clientPassword: '' });
  const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE workspaces SET trial_ends_at = ? WHERE id = ?').run(futureDate, trialWs.workspaceId);
}, 25_000);

afterAll(() => {
  freeWs.cleanup();
  growthWs.cleanup();
  premiumWs.cleanup();
  trialWs.cleanup();
  ctx.stopServer();
});

// ── Usage endpoint: per-feature limits differ by tier ─────────────────────────

describe('GET /api/public/usage/:workspaceId — tier-differentiated limits', () => {
  it('free tier: ai_chats limit is 3, strategy_generations limit is 0', async () => {
    const res = await api(`/api/public/usage/${freeWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.usage).toBeDefined();
    expect(body.usage.ai_chats).toBeDefined();
    expect(body.usage.ai_chats.limit).toBe(3);
    expect(body.usage.ai_chats.used).toBe(0);
    expect(body.usage.ai_chats.remaining).toBe(3);
    expect(body.usage.strategy_generations).toBeDefined();
    expect(body.usage.strategy_generations.limit).toBe(0);
    expect(body.usage.strategy_generations.remaining).toBe(0);
  });

  it('growth tier: ai_chats limit is 50, strategy_generations limit is 3', async () => {
    const res = await api(`/api/public/usage/${growthWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.usage.ai_chats.limit).toBe(50);
    expect(body.usage.ai_chats.remaining).toBe(50);
    expect(body.usage.strategy_generations.limit).toBe(3);
    expect(body.usage.strategy_generations.remaining).toBe(3);
  });

  it('premium tier: ai_chats and strategy_generations are unlimited (Infinity)', async () => {
    const res = await api(`/api/public/usage/${premiumWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('premium');
    // Infinity serializes to null in JSON
    expect(body.usage.ai_chats.limit).toBeNull();
    expect(body.usage.ai_chats.remaining).toBeNull();
    expect(body.usage.strategy_generations.limit).toBeNull();
    expect(body.usage.strategy_generations.remaining).toBeNull();
  });

  it('nonexistent workspace returns 404', async () => {
    const res = await api('/api/public/usage/nonexistent-ws-id');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });
});

// ── Chat usage endpoint: chat-specific tier gating ────────────────────────────

describe('GET /api/public/chat-usage/:workspaceId — chat tier gating', () => {
  it('free tier: returns allowed=true with limit=3 when no chats used', async () => {
    const res = await api(`/api/public/chat-usage/${freeWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.limit).toBe(3);
    expect(body.allowed).toBe(true);
    expect(body.used).toBe(0);
    expect(body.remaining).toBe(3);
  });

  it('growth tier: returns allowed=true with unlimited (Infinity)', async () => {
    const res = await api(`/api/public/chat-usage/${growthWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.allowed).toBe(true);
    // Growth/premium returns Infinity which serializes to null in JSON
    expect(body.limit).toBeNull();
    expect(body.remaining).toBeNull();
  });

  it('premium tier: returns allowed=true with unlimited (Infinity)', async () => {
    const res = await api(`/api/public/chat-usage/${premiumWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('premium');
    expect(body.allowed).toBe(true);
  });

  it('nonexistent workspace returns 404', async () => {
    const res = await api('/api/public/chat-usage/nonexistent-ws-id');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });
});

// ── Tier info endpoint: effective tier with trial logic ───────────────────────

describe('GET /api/public/tier/:id — effective tier resolution', () => {
  it('free tier workspace: returns tier=free, isTrial=false', async () => {
    const res = await api(`/api/public/tier/${freeWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.baseTier).toBe('free');
    expect(body.isTrial).toBe(false);
    expect(body.trialDaysRemaining).toBe(0);
    expect(body.trialEndsAt).toBeNull();
  });

  it('growth tier workspace: returns tier=growth, isTrial=false', async () => {
    const res = await api(`/api/public/tier/${growthWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.baseTier).toBe('growth');
    expect(body.isTrial).toBe(false);
  });

  it('premium tier workspace: returns tier=premium, isTrial=false', async () => {
    const res = await api(`/api/public/tier/${premiumWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('premium');
    expect(body.baseTier).toBe('premium');
    expect(body.isTrial).toBe(false);
  });

  it('trial workspace: baseTier=free but effective tier=growth, isTrial=true', async () => {
    const res = await api(`/api/public/tier/${trialWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.baseTier).toBe('free');
    expect(body.isTrial).toBe(true);
    expect(body.trialDaysRemaining).toBeGreaterThan(0);
    expect(body.trialEndsAt).toBeDefined();
    expect(body.trialEndsAt).not.toBeNull();
  });

  it('nonexistent workspace returns 404', async () => {
    const res = await api('/api/public/tier/nonexistent-ws-id');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });
});

// ── Workspace endpoint: tier included in response ─────────────────────────────

describe('GET /api/public/workspace/:id — tier in workspace response', () => {
  it('free tier workspace: response includes tier=free', async () => {
    const res = await api(`/api/public/workspace/${freeWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.baseTier).toBe('free');
    expect(body.isTrial).toBe(false);
    expect(body.trialDaysRemaining).toBe(0);
  });

  it('growth tier workspace: response includes tier=growth', async () => {
    const res = await api(`/api/public/workspace/${growthWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.baseTier).toBe('growth');
  });

  it('premium tier workspace: response includes tier=premium', async () => {
    const res = await api(`/api/public/workspace/${premiumWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('premium');
    expect(body.baseTier).toBe('premium');
  });

  it('trial workspace: effective tier=growth, baseTier=free, isTrial=true', async () => {
    const res = await api(`/api/public/workspace/${trialWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('growth');
    expect(body.baseTier).toBe('free');
    expect(body.isTrial).toBe(true);
    expect(body.trialDaysRemaining).toBeGreaterThan(0);
  });
});

// ── Intelligence endpoint: response shape gated by tier ───────────────────────

describe('GET /api/public/intelligence/:workspaceId — tier-gated slices', () => {
  it('free tier: returns insightsSummary + pipelineStatus, NO learningHighlights or siteHealthSummary', async () => {
    const res = await api(`/api/public/intelligence/${freeWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(freeWs.workspaceId);
    expect(body.tier).toBe('free');
    expect(body.assembledAt).toBeDefined();
    // Free tier gets basic slices
    expect('insightsSummary' in body).toBe(true);
    expect('pipelineStatus' in body).toBe(true);
    // Free tier does NOT get growth+ or premium slices
    expect('learningHighlights' in body).toBe(false);
    expect('siteHealthSummary' in body).toBe(false);
  });

  it('growth tier: returns insightsSummary + pipelineStatus + learningHighlights, NO siteHealthSummary', async () => {
    const res = await api(`/api/public/intelligence/${growthWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(growthWs.workspaceId);
    expect(body.tier).toBe('growth');
    // Growth tier gets basic + learnings
    expect('insightsSummary' in body).toBe(true);
    expect('pipelineStatus' in body).toBe(true);
    expect('learningHighlights' in body).toBe(true);
    // Growth tier does NOT get premium-only slices
    expect('siteHealthSummary' in body).toBe(false);
  });

  it('premium tier: returns all slices including siteHealthSummary', async () => {
    const res = await api(`/api/public/intelligence/${premiumWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe(premiumWs.workspaceId);
    expect(body.tier).toBe('premium');
    // Premium gets everything
    expect('insightsSummary' in body).toBe(true);
    expect('pipelineStatus' in body).toBe(true);
    expect('learningHighlights' in body).toBe(true);
    expect('siteHealthSummary' in body).toBe(true);
  });

  it('nonexistent workspace returns 404', async () => {
    const res = await api('/api/public/intelligence/nonexistent-ws-id');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Workspace not found');
  });
});

// ── Usage tracking: checkUsageLimit behavior across tiers (unit-level) ────────

describe('Usage tracking: tier-specific limits enforced at the module level', () => {
  // These tests import usage-tracking directly to verify the tier-limit logic
  // without needing external service calls. The module is the same one the
  // endpoints use, so verifying it covers the enforcement layer.

  it('free tier: strategy_generations limit is 0 — always blocked', async () => {
    // Import dynamically since the module initializes DB state
    const { checkUsageLimit } = await import('../../server/usage-tracking.js');
    const result = checkUsageLimit(freeWs.workspaceId, 'free', 'strategy_generations');
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
    expect(result.remaining).toBe(0);
    expect(result.used).toBe(0);
  });

  it('growth tier: strategy_generations limit is 3 — allowed when unused', async () => {
    const { checkUsageLimit } = await import('../../server/usage-tracking.js');
    const result = checkUsageLimit(growthWs.workspaceId, 'growth', 'strategy_generations');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(3);
    expect(result.remaining).toBe(3);
  });

  it('premium tier: strategy_generations is unlimited', async () => {
    const { checkUsageLimit } = await import('../../server/usage-tracking.js');
    const result = checkUsageLimit(premiumWs.workspaceId, 'premium', 'strategy_generations');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(Infinity);
  });

  it('free tier: ai_chats limit is 3', async () => {
    const { checkUsageLimit } = await import('../../server/usage-tracking.js');
    const result = checkUsageLimit(freeWs.workspaceId, 'free', 'ai_chats');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(3);
    expect(result.remaining).toBe(3);
  });

  it('growth tier: ai_chats limit is 50', async () => {
    const { checkUsageLimit } = await import('../../server/usage-tracking.js');
    const result = checkUsageLimit(growthWs.workspaceId, 'growth', 'ai_chats');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(50);
    expect(result.remaining).toBe(50);
  });

  it('premium tier: ai_chats is unlimited', async () => {
    const { checkUsageLimit } = await import('../../server/usage-tracking.js');
    const result = checkUsageLimit(premiumWs.workspaceId, 'premium', 'ai_chats');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(Infinity);
  });

  it('unknown tier falls back to free limits', async () => {
    const { checkUsageLimit } = await import('../../server/usage-tracking.js');
    const result = checkUsageLimit(freeWs.workspaceId, 'nonexistent_tier', 'ai_chats');
    expect(result.limit).toBe(3);
  });
});

// ── Chat rate limit: tier-aware enforcement (unit-level) ──────────────────────

describe('Chat rate limit: tier-aware enforcement at the module level', () => {
  it('free tier with no chats: allowed=true, limit=3', async () => {
    const { checkChatRateLimit } = await import('../../server/chat-memory.js');
    const result = checkChatRateLimit(freeWs.workspaceId, 'free');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(3);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  it('growth tier: always allowed with Infinity limit', async () => {
    const { checkChatRateLimit } = await import('../../server/chat-memory.js');
    const result = checkChatRateLimit(growthWs.workspaceId, 'growth');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(Infinity);
    expect(result.remaining).toBe(Infinity);
  });

  it('premium tier: always allowed with Infinity limit', async () => {
    const { checkChatRateLimit } = await import('../../server/chat-memory.js');
    const result = checkChatRateLimit(premiumWs.workspaceId, 'premium');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(Infinity);
    expect(result.remaining).toBe(Infinity);
  });
});

// ── Expired trial: effective tier reverts to free ─────────────────────────────

describe('Expired trial: effective tier reverts to free', () => {
  let expiredTrialWs: SeededFullWorkspace;

  beforeAll(() => {
    expiredTrialWs = seedWorkspace({ tier: 'free', clientPassword: '' });
    // Set trialEndsAt to the past
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE workspaces SET trial_ends_at = ? WHERE id = ?').run(pastDate, expiredTrialWs.workspaceId);
  });

  afterAll(() => {
    expiredTrialWs.cleanup();
  });

  it('tier endpoint: expired trial returns tier=free, isTrial=false', async () => {
    const res = await api(`/api/public/tier/${expiredTrialWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.baseTier).toBe('free');
    expect(body.isTrial).toBe(false);
    // trialDaysRemaining should be 0 for an expired trial
    expect(body.trialDaysRemaining).toBe(0);
  });

  it('workspace endpoint: expired trial shows tier=free', async () => {
    const res = await api(`/api/public/workspace/${expiredTrialWs.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe('free');
    expect(body.baseTier).toBe('free');
    expect(body.isTrial).toBe(false);
  });
});
