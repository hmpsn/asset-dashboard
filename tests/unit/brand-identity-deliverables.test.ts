/**
 * Unit + DB-backed tests for server/brand-identity.ts
 *
 * Covers:
 *   - getDeliverableInstructions: all 17 BrandDeliverableType values return non-empty,
 *     type-specific strings (the main bug risk: type added to union but not the
 *     instructions object silently returns the generic fallback)
 *   - exportDeliverables: empty case, approved-only filter, tier filter, markdown format
 *   - approveDeliverable: sets status, cross-workspace guard, missing id guard
 *   - setDeliverableStatus: approved → draft round-trip, cross-workspace isolation
 */

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';

// ─── Mocks (must come before module imports) ──────────────────────────────────

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../server/content-posts-ai.js', () => ({
  callCreativeAI: vi.fn(async () => 'AI generated content'),
}));

vi.mock('../../server/workspace-intelligence.js', () => ({
  buildIntelPrompt: vi.fn(async () => 'intel prompt'),
}));

vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system prompt'),
  buildIntelPrompt: vi.fn(async () => 'intel prompt'),
}));

vi.mock('../../server/brandscript.js', () => ({
  listBrandscripts: vi.fn(() => []),
}));

vi.mock('../../server/voice-calibration.js', () => ({
  getVoiceProfile: vi.fn(() => null),
  buildVoiceCalibrationContext: vi.fn(() => ({ dnaText: '', guardrailsText: '' })),
  addVoiceSample: vi.fn(() => ({
    id: 'vs_mocked',
    voiceProfileId: 'vp_mocked',
    content: 'mocked sample',
    sortOrder: 0,
    createdAt: new Date().toISOString(),
  })),
}));

vi.mock('../../server/discovery-ingestion.js', () => ({
  listExtractions: vi.fn(() => []),
}));

vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: {
    VOICE_PROFILE_UPDATED: 'voice:updated',
    BRAND_IDENTITY_UPDATED: 'brand-identity:updated',
  },
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn(() => false),
}));

vi.mock('../../server/activity.js', () => ({
  addActivity: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  getDeliverableInstructions,
  exportDeliverables,
  approveDeliverable,
  setDeliverableStatus,
} from '../../server/brand-identity.js';
import type { BrandDeliverableType, DeliverableTier } from '../../shared/types/brand-engine.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { randomUUID } from 'crypto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function insertDeliverable(opts: {
  workspaceId: string;
  type: BrandDeliverableType;
  content: string;
  status: 'draft' | 'approved';
  tier: DeliverableTier;
}): string {
  const id = `bid_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO brand_identity_deliverables
     (id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at)
     VALUES (@id, @workspace_id, @deliverable_type, @content, @status, @version, @tier, @created_at, @updated_at)`,
  ).run({
    id,
    workspace_id: opts.workspaceId,
    deliverable_type: opts.type,
    content: opts.content,
    status: opts.status,
    version: 1,
    tier: opts.tier,
    created_at: now,
    updated_at: now,
  });
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// getDeliverableInstructions — return type guarantees
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDeliverableInstructions — return type', () => {
  const ALL_TYPES: BrandDeliverableType[] = [
    'mission', 'vision', 'values', 'tagline', 'elevator_pitch',
    'archetypes', 'personality_traits', 'voice_guidelines', 'tone_examples',
    'messaging_pillars', 'differentiators', 'positioning_matrix', 'brand_story',
    'personas', 'customer_journey', 'objection_handling', 'emotional_triggers',
  ];

  it('always returns a string for every BrandDeliverableType value', () => {
    for (const type of ALL_TYPES) {
      const result = getDeliverableInstructions(type);
      expect(typeof result, `type="${type}" should return string`).toBe('string');
    }
  });

  it('never returns null or undefined for any BrandDeliverableType value', () => {
    for (const type of ALL_TYPES) {
      const result = getDeliverableInstructions(type);
      expect(result, `type="${type}" should not be null/undefined`).toBeTruthy();
    }
  });

  it('never returns an empty string for any BrandDeliverableType value', () => {
    for (const type of ALL_TYPES) {
      const result = getDeliverableInstructions(type);
      expect(result.length, `type="${type}" returned empty string`).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getDeliverableInstructions — all 17 types must be explicitly mapped
// (bug risk: type added to union but not the instructions object returns generic fallback)
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDeliverableInstructions — all 17 types return specific (non-generic) instructions', () => {
  it('mission: contains type-specific content (not pure generic fallback)', () => {
    const result = getDeliverableInstructions('mission');
    const isGeneric = result === 'Write a mission for this brand. Be specific, not generic.';
    expect(isGeneric, 'mission returned generic fallback — missing from instructions map').toBe(false);
    expect(result).toMatch(/mission|action verb|why this business/i);
  });

  it('vision: contains type-specific content', () => {
    const result = getDeliverableInstructions('vision');
    const isGeneric = result === 'Write a vision for this brand. Be specific, not generic.';
    expect(isGeneric, 'vision returned generic fallback').toBe(false);
    expect(result).toMatch(/vision|5-10 years/i);
  });

  it('values: contains type-specific content', () => {
    const result = getDeliverableInstructions('values');
    const isGeneric = result === 'Write a values for this brand. Be specific, not generic.';
    expect(isGeneric, 'values returned generic fallback').toBe(false);
    expect(result).toMatch(/values|3-5/i);
  });

  it('tagline: contains type-specific content', () => {
    const result = getDeliverableInstructions('tagline');
    const isGeneric = result === 'Write a tagline for this brand. Be specific, not generic.';
    expect(isGeneric, 'tagline returned generic fallback').toBe(false);
    expect(result).toMatch(/tagline|8 words/i);
  });

  it('elevator_pitch: contains type-specific content', () => {
    const result = getDeliverableInstructions('elevator_pitch');
    const isGeneric = result === 'Write a elevator pitch for this brand. Be specific, not generic.';
    expect(isGeneric, 'elevator_pitch returned generic fallback').toBe(false);
    expect(result).toMatch(/elevator|30 seconds|brandscript/i);
  });

  it('archetypes: contains type-specific content', () => {
    const result = getDeliverableInstructions('archetypes');
    const isGeneric = result === 'Write a archetypes for this brand. Be specific, not generic.';
    expect(isGeneric, 'archetypes returned generic fallback').toBe(false);
    expect(result).toMatch(/archetype|Hero|Sage/i);
  });

  it('personality_traits: contains type-specific content', () => {
    const result = getDeliverableInstructions('personality_traits');
    const isGeneric = result === 'Write a personality traits for this brand. Be specific, not generic.';
    expect(isGeneric, 'personality_traits returned generic fallback').toBe(false);
    expect(result).toMatch(/trait|not that|framing/i);
  });

  it('voice_guidelines: contains type-specific content', () => {
    const result = getDeliverableInstructions('voice_guidelines');
    const isGeneric = result === 'Write a voice guidelines for this brand. Be specific, not generic.';
    expect(isGeneric, 'voice_guidelines returned generic fallback').toBe(false);
    expect(result).toMatch(/voice|tone/i);
  });

  it('tone_examples: contains type-specific content', () => {
    const result = getDeliverableInstructions('tone_examples');
    const isGeneric = result === 'Write a tone examples for this brand. Be specific, not generic.';
    expect(isGeneric, 'tone_examples returned generic fallback').toBe(false);
    // Actual instruction mentions "do this" and "not this" — match loosely
    expect(result).toMatch(/tone|do|don't/i);
  });

  it('messaging_pillars: contains type-specific content', () => {
    const result = getDeliverableInstructions('messaging_pillars');
    const isGeneric = result === 'Write a messaging pillars for this brand. Be specific, not generic.';
    expect(isGeneric, 'messaging_pillars returned generic fallback').toBe(false);
    expect(result).toMatch(/pillar|messaging/i);
  });

  it('differentiators: contains type-specific content', () => {
    const result = getDeliverableInstructions('differentiators');
    const isGeneric = result === 'Write a differentiators for this brand. Be specific, not generic.';
    expect(isGeneric, 'differentiators returned generic fallback').toBe(false);
    expect(result).toMatch(/differentiator|copy-ready/i);
  });

  it('positioning_matrix: contains type-specific content', () => {
    const result = getDeliverableInstructions('positioning_matrix');
    const isGeneric = result === 'Write a positioning matrix for this brand. Be specific, not generic.';
    expect(isGeneric, 'positioning_matrix returned generic fallback').toBe(false);
    expect(result).toMatch(/positioning|competitive/i);
  });

  it('brand_story: contains type-specific content', () => {
    const result = getDeliverableInstructions('brand_story');
    const isGeneric = result === 'Write a brand story for this brand. Be specific, not generic.';
    expect(isGeneric, 'brand_story returned generic fallback').toBe(false);
    expect(result).toMatch(/story|narrative|brandscript/i);
  });

  it('personas: contains type-specific content', () => {
    const result = getDeliverableInstructions('personas');
    const isGeneric = result === 'Write a personas for this brand. Be specific, not generic.';
    expect(isGeneric, 'personas returned generic fallback').toBe(false);
    expect(result).toMatch(/persona|demographics/i);
  });

  it('customer_journey: contains type-specific content', () => {
    const result = getDeliverableInstructions('customer_journey');
    const isGeneric = result === 'Write a customer journey for this brand. Be specific, not generic.';
    expect(isGeneric, 'customer_journey returned generic fallback').toBe(false);
    expect(result).toMatch(/journey|Awareness/i);
  });

  it('objection_handling: contains type-specific content', () => {
    const result = getDeliverableInstructions('objection_handling');
    const isGeneric = result === 'Write a objection handling for this brand. Be specific, not generic.';
    expect(isGeneric, 'objection_handling returned generic fallback').toBe(false);
    expect(result).toMatch(/objection/i);
  });

  it('emotional_triggers: contains type-specific content', () => {
    const result = getDeliverableInstructions('emotional_triggers');
    const isGeneric = result === 'Write a emotional triggers for this brand. Be specific, not generic.';
    expect(isGeneric, 'emotional_triggers returned generic fallback').toBe(false);
    expect(result).toMatch(/emotional|trigger|fear/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getDeliverableInstructions — unknown/future type fallback
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDeliverableInstructions — unknown/future type uses generic fallback', () => {
  it('unknown type returns a non-empty string', () => {
    // Cast to bypass TypeScript — simulates a type added to the union but not the map
    const result = getDeliverableInstructions('some_future_type' as BrandDeliverableType);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('unknown type returns fallback containing the type name (underscores → spaces)', () => {
    const result = getDeliverableInstructions('some_future_type' as BrandDeliverableType);
    expect(result).toContain('some future type');
  });

  it('unknown type fallback matches the exact generic template', () => {
    const result = getDeliverableInstructions('some_future_type' as BrandDeliverableType);
    expect(result).toBe('Write a some future type for this brand. Be specific, not generic.');
  });

  it('another unknown type also gets underscore replacement in fallback', () => {
    const result = getDeliverableInstructions('brand_promise' as BrandDeliverableType);
    expect(result).toContain('brand promise');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// exportDeliverables — no deliverables
// ═══════════════════════════════════════════════════════════════════════════════

describe('exportDeliverables — no deliverables', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace({ tier: 'growth', clientPassword: '' }); });
  afterAll(() => { ws?.cleanup(); });

  it('returns a string when workspace has no deliverables', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(typeof result).toBe('string');
  });

  it('returns the "no approved" fallback message when workspace has no deliverables', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toContain('No approved deliverables');
  });

  it('returns a "Brand Identity" heading even when empty', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toContain('Brand Identity');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// exportDeliverables — approved deliverables included
// ═══════════════════════════════════════════════════════════════════════════════

describe('exportDeliverables — approved deliverables included', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
    insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'mission',
      content: 'We exist to help businesses grow with clarity.',
      status: 'approved',
      tier: 'essentials',
    });
  });
  afterAll(() => { ws?.cleanup(); });

  it('includes the deliverable content in output', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toContain('We exist to help businesses grow with clarity.');
  });

  it('includes the deliverable type as a title-cased h2 heading', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toContain('## Mission');
  });

  it('output starts with the brand identity h1 heading', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toContain('# Brand Identity Deliverables');
  });

  it('output begins with a markdown heading character', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toMatch(/^#/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// exportDeliverables — draft deliverables excluded
// ═══════════════════════════════════════════════════════════════════════════════

describe('exportDeliverables — draft deliverables excluded', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
    insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'vision',
      content: 'Draft vision content that should not appear.',
      status: 'draft',
      tier: 'essentials',
    });
  });
  afterAll(() => { ws?.cleanup(); });

  it('does not include draft deliverable content in output', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).not.toContain('Draft vision content that should not appear.');
  });

  it('returns the no-approved fallback when all deliverables are draft', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toContain('No approved deliverables');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// exportDeliverables — tier filter (critical correctness test)
// ═══════════════════════════════════════════════════════════════════════════════

describe('exportDeliverables — tier filter', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
    // Insert one deliverable per tier — all approved
    insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'mission',
      content: 'Essentials tier mission content.',
      status: 'approved',
      tier: 'essentials',
    });
    insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'elevator_pitch',
      content: 'Professional tier elevator pitch content.',
      status: 'approved',
      tier: 'professional',
    });
    insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'brand_story',
      content: 'Premium tier brand story content.',
      status: 'approved',
      tier: 'premium',
    });
  });
  afterAll(() => { ws?.cleanup(); });

  it('tier=essentials: includes essentials deliverable', () => {
    const result = exportDeliverables(ws.workspaceId, 'essentials');
    expect(result).toContain('Essentials tier mission content.');
  });

  it('tier=essentials: excludes professional deliverable', () => {
    const result = exportDeliverables(ws.workspaceId, 'essentials');
    expect(result).not.toContain('Professional tier elevator pitch content.');
  });

  it('tier=essentials: excludes premium deliverable', () => {
    const result = exportDeliverables(ws.workspaceId, 'essentials');
    expect(result).not.toContain('Premium tier brand story content.');
  });

  it('tier=professional: includes professional deliverable', () => {
    const result = exportDeliverables(ws.workspaceId, 'professional');
    expect(result).toContain('Professional tier elevator pitch content.');
  });

  it('tier=professional: excludes essentials deliverable', () => {
    const result = exportDeliverables(ws.workspaceId, 'professional');
    expect(result).not.toContain('Essentials tier mission content.');
  });

  it('tier=professional: excludes premium deliverable', () => {
    const result = exportDeliverables(ws.workspaceId, 'professional');
    expect(result).not.toContain('Premium tier brand story content.');
  });

  it('tier=premium: includes premium deliverable', () => {
    const result = exportDeliverables(ws.workspaceId, 'premium');
    expect(result).toContain('Premium tier brand story content.');
  });

  it('tier=premium: excludes essentials deliverable', () => {
    const result = exportDeliverables(ws.workspaceId, 'premium');
    expect(result).not.toContain('Essentials tier mission content.');
  });

  it('tier=premium: excludes professional deliverable', () => {
    const result = exportDeliverables(ws.workspaceId, 'premium');
    expect(result).not.toContain('Professional tier elevator pitch content.');
  });

  it('no tier filter: includes all approved deliverables across all tiers', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toContain('Essentials tier mission content.');
    expect(result).toContain('Professional tier elevator pitch content.');
    expect(result).toContain('Premium tier brand story content.');
  });

  it('tier filter with no matching approved deliverables returns no-approved fallback', () => {
    const ws2 = seedWorkspace({ tier: 'growth', clientPassword: '' });
    insertDeliverable({
      workspaceId: ws2.workspaceId,
      type: 'elevator_pitch',
      content: 'Draft professional that should not appear.',
      status: 'draft',
      tier: 'professional',
    });
    const result = exportDeliverables(ws2.workspaceId, 'professional');
    expect(result).toContain('No approved deliverables');
    ws2.cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// exportDeliverables — multiple deliverables formatting
// ═══════════════════════════════════════════════════════════════════════════════

describe('exportDeliverables — multiple deliverables formatting', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
    insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'mission',
      content: 'Mission content for multi-test.',
      status: 'approved',
      tier: 'essentials',
    });
    insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'values',
      content: 'Values content for multi-test.',
      status: 'approved',
      tier: 'essentials',
    });
  });
  afterAll(() => { ws?.cleanup(); });

  it('multiple approved deliverables are separated by horizontal rules', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toContain('---');
  });

  it('both deliverable types appear as h2 headings', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toContain('## Mission');
    expect(result).toContain('## Values');
  });

  it('both deliverable contents appear in the output', () => {
    const result = exportDeliverables(ws.workspaceId);
    expect(result).toContain('Mission content for multi-test.');
    expect(result).toContain('Values content for multi-test.');
  });

  it('underscore types are title-cased in headings (elevator_pitch → Elevator Pitch)', () => {
    const ws2 = seedWorkspace({ tier: 'growth', clientPassword: '' });
    insertDeliverable({
      workspaceId: ws2.workspaceId,
      type: 'elevator_pitch',
      content: 'Elevator content.',
      status: 'approved',
      tier: 'professional',
    });
    const result = exportDeliverables(ws2.workspaceId);
    expect(result).toContain('## Elevator Pitch');
    ws2.cleanup();
  });

  it('customer_journey type title-cased correctly in heading', () => {
    const ws3 = seedWorkspace({ tier: 'growth', clientPassword: '' });
    insertDeliverable({
      workspaceId: ws3.workspaceId,
      type: 'customer_journey',
      content: 'Journey content.',
      status: 'approved',
      tier: 'premium',
    });
    const result = exportDeliverables(ws3.workspaceId);
    expect(result).toContain('## Customer Journey');
    ws3.cleanup();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// approveDeliverable
// ═══════════════════════════════════════════════════════════════════════════════

describe('approveDeliverable', () => {
  let ws: SeededFullWorkspace;
  let deliverableId: string;

  beforeAll(() => {
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
    deliverableId = insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'mission',
      content: 'Mission for approval test.',
      status: 'draft',
      tier: 'essentials',
    });
  });
  afterAll(() => { ws?.cleanup(); });

  it('returns the deliverable with status="approved"', () => {
    const result = approveDeliverable(ws.workspaceId, deliverableId);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('approved');
  });

  it('returns the deliverable with the correct workspaceId', () => {
    const result = approveDeliverable(ws.workspaceId, deliverableId);
    expect(result!.workspaceId).toBe(ws.workspaceId);
  });

  it('returns the deliverable with the correct id', () => {
    const result = approveDeliverable(ws.workspaceId, deliverableId);
    expect(result!.id).toBe(deliverableId);
  });

  it('returns null for a non-existent deliverable id', () => {
    const result = approveDeliverable(ws.workspaceId, 'bid_nonexistent_xyz');
    expect(result).toBeNull();
  });

  it('returns null when workspaceId does not match deliverable (cross-workspace guard)', () => {
    const ws2 = seedWorkspace({ tier: 'growth', clientPassword: '' });
    const otherId = insertDeliverable({
      workspaceId: ws2.workspaceId,
      type: 'vision',
      content: 'Cross-workspace vision.',
      status: 'draft',
      tier: 'essentials',
    });
    // Attempt to approve ws2's deliverable using ws.workspaceId — must return null
    const result = approveDeliverable(ws.workspaceId, otherId);
    expect(result).toBeNull();
    ws2.cleanup();
  });

  it('re-approving an already-approved deliverable returns approved (idempotent)', () => {
    // The deliverable was approved in the first test above; re-approve should not error
    const result = approveDeliverable(ws.workspaceId, deliverableId);
    expect(result!.status).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// setDeliverableStatus
// ═══════════════════════════════════════════════════════════════════════════════

describe('setDeliverableStatus', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => {
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
  });
  afterAll(() => { ws?.cleanup(); });

  it('draft → approved: sets status to approved', () => {
    const id = insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'tagline',
      content: 'Tagline content.',
      status: 'draft',
      tier: 'essentials',
    });
    const result = setDeliverableStatus(ws.workspaceId, id, 'approved');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('approved');
  });

  it('approved → draft round-trip: sets status back to draft', () => {
    const id = insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'values',
      content: 'Values content.',
      status: 'approved',
      tier: 'essentials',
    });
    const result = setDeliverableStatus(ws.workspaceId, id, 'draft');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('draft');
  });

  it('returns null for a non-existent id', () => {
    const result = setDeliverableStatus(ws.workspaceId, 'bid_no_exist', 'approved');
    expect(result).toBeNull();
  });

  it('returns null when workspaceId does not match the deliverable (cross-workspace guard)', () => {
    const ws2 = seedWorkspace({ tier: 'growth', clientPassword: '' });
    const otherId = insertDeliverable({
      workspaceId: ws2.workspaceId,
      type: 'mission',
      content: 'Other workspace mission.',
      status: 'draft',
      tier: 'essentials',
    });
    const result = setDeliverableStatus(ws.workspaceId, otherId, 'approved');
    expect(result).toBeNull();
    ws2.cleanup();
  });

  it('returns the deliverable with a valid updatedAt timestamp after status change', () => {
    const id = insertDeliverable({
      workspaceId: ws.workspaceId,
      type: 'vision',
      content: 'Vision for timestamp test.',
      status: 'draft',
      tier: 'essentials',
    });
    const result = setDeliverableStatus(ws.workspaceId, id, 'approved');
    expect(result).not.toBeNull();
    expect(new Date(result!.updatedAt).getTime()).toBeGreaterThan(0);
  });

  it('auto-creates voice sample when approving tagline (addVoiceSample called)', async () => {
    const { addVoiceSample } = await import('../../server/voice-calibration.js');
    vi.mocked(addVoiceSample).mockClear();
    // Use a fresh workspace to avoid UNIQUE constraint on (workspace_id, deliverable_type)
    const wsTagline = seedWorkspace({ tier: 'growth', clientPassword: '' });
    const id = insertDeliverable({
      workspaceId: wsTagline.workspaceId,
      type: 'tagline',
      content: 'Short, punchy tagline for voice sample.',
      status: 'draft',
      tier: 'essentials',
    });
    setDeliverableStatus(wsTagline.workspaceId, id, 'approved');
    expect(addVoiceSample).toHaveBeenCalledTimes(1);
    wsTagline.cleanup();
  });

  it('auto-creates voice sample when approving elevator_pitch', async () => {
    const { addVoiceSample } = await import('../../server/voice-calibration.js');
    vi.mocked(addVoiceSample).mockClear();
    const wsElev = seedWorkspace({ tier: 'growth', clientPassword: '' });
    const id = insertDeliverable({
      workspaceId: wsElev.workspaceId,
      type: 'elevator_pitch',
      content: 'Elevator pitch for voice sample.',
      status: 'draft',
      tier: 'professional',
    });
    setDeliverableStatus(wsElev.workspaceId, id, 'approved');
    expect(addVoiceSample).toHaveBeenCalledTimes(1);
    wsElev.cleanup();
  });

  it('does NOT auto-create voice sample for non-sample type (mission)', async () => {
    const { addVoiceSample } = await import('../../server/voice-calibration.js');
    vi.mocked(addVoiceSample).mockClear();
    const wsMission = seedWorkspace({ tier: 'growth', clientPassword: '' });
    const id = insertDeliverable({
      workspaceId: wsMission.workspaceId,
      type: 'mission',
      content: 'Mission for no-sample test.',
      status: 'draft',
      tier: 'essentials',
    });
    setDeliverableStatus(wsMission.workspaceId, id, 'approved');
    expect(addVoiceSample).not.toHaveBeenCalled();
    wsMission.cleanup();
  });

  it('does NOT auto-create voice sample for non-sample type (values)', async () => {
    const { addVoiceSample } = await import('../../server/voice-calibration.js');
    vi.mocked(addVoiceSample).mockClear();
    const wsVals = seedWorkspace({ tier: 'growth', clientPassword: '' });
    const id = insertDeliverable({
      workspaceId: wsVals.workspaceId,
      type: 'values',
      content: 'Values for no-sample test.',
      status: 'draft',
      tier: 'essentials',
    });
    setDeliverableStatus(wsVals.workspaceId, id, 'approved');
    expect(addVoiceSample).not.toHaveBeenCalled();
    wsVals.cleanup();
  });

  it('does NOT auto-create voice sample when reverting to draft', async () => {
    const { addVoiceSample } = await import('../../server/voice-calibration.js');
    vi.mocked(addVoiceSample).mockClear();
    const wsTone = seedWorkspace({ tier: 'growth', clientPassword: '' });
    const id = insertDeliverable({
      workspaceId: wsTone.workspaceId,
      type: 'tone_examples',
      content: 'Tone examples for revert test.',
      status: 'approved',
      tier: 'professional',
    });
    setDeliverableStatus(wsTone.workspaceId, id, 'draft');
    expect(addVoiceSample).not.toHaveBeenCalled();
    wsTone.cleanup();
  });

  it('does NOT auto-create duplicate voice sample on re-approval of already-approved deliverable', async () => {
    const { addVoiceSample } = await import('../../server/voice-calibration.js');
    vi.mocked(addVoiceSample).mockClear();
    // Insert as already-approved — priorStatus check should prevent duplicate
    const wsReapprove = seedWorkspace({ tier: 'growth', clientPassword: '' });
    const id = insertDeliverable({
      workspaceId: wsReapprove.workspaceId,
      type: 'elevator_pitch',
      content: 'Elevator pitch for re-approval idempotency test.',
      status: 'approved',
      tier: 'professional',
    });
    setDeliverableStatus(wsReapprove.workspaceId, id, 'approved');
    expect(addVoiceSample).not.toHaveBeenCalled();
    wsReapprove.cleanup();
  });
});
