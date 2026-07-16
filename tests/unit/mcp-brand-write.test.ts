/**
 * DB-backed tests for the brand-deliverable MCP write tools (brand slice P5).
 *
 * Exercises the real create/update paths in server/brand-identity.ts plus the
 * read-model `getDeliverable` against a seeded SQLite workspace while spying on the
 * side-effect modules (activity log, broadcast, intelligence cache) so we can assert the
 * data-flow contract:
 *   - success  → content persisted, version bumped, status='draft', version snapshot,
 *                activity + broadcast(BRAND_IDENTITY_UPDATED) + cache invalidation fired
 *   - no-op    → identical content, no version bump, NO side effects
 *   - conflict → expectedVersion mismatch rejected, no write
 *   - missing  → unknown id / cross-workspace id → "not found", no write
 *   - guards   → bad workspace, invalid args, unknown tool name
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Mocks (before module imports) ────────────────────────────────────────────

vi.mock('../../server/logger.js', () => ({
  createLogger: () => h.logger,
}));

// Keep server/brand-identity.ts loadable without dragging in the AI stack — none of
// these are exercised by the content-only updateDeliverableContent write path.
vi.mock('../../server/content-posts-ai.js', () => ({ callCreativeAI: vi.fn() }));
vi.mock('../../server/prompt-assembly.js', () => ({
  buildSystemPrompt: vi.fn(() => 'system prompt'),
  buildIntelPrompt: vi.fn(async () => 'intel prompt'),
}));
vi.mock('../../server/voice-calibration.js', () => ({
  getVoiceProfile: vi.fn(() => null),
  buildVoiceCalibrationContext: vi.fn(() => ({ dnaText: '', guardrailsText: '' })),
  addVoiceSample: vi.fn(),
}));
vi.mock('../../server/brandscript.js', () => ({ listBrandscripts: vi.fn(() => []) }));
vi.mock('../../server/discovery-ingestion.js', () => ({ listExtractions: vi.fn(() => []) }));

// brand.ts imports buildWorkspaceIntelligence (used only by get_brand_identity); the
// write path never calls it — mock to avoid loading the whole intelligence engine.
vi.mock('../../server/workspace-intelligence.js', () => ({
  buildWorkspaceIntelligence: h.buildWorkspaceIntelligence,
  buildIntelPrompt: vi.fn(async () => 'intel prompt'),
}));

// Side-effect spies — the assertions of the data-flow contract. Defined via
// vi.hoisted so the hoisted vi.mock factories below can reference them safely.
const h = vi.hoisted(() => ({
  addActivity: vi.fn(),
  broadcastToWorkspace: vi.fn(),
  invalidateIntelligenceCache: vi.fn(),
  buildWorkspaceIntelligence: vi.fn(),
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../server/activity-log.js', () => ({ addActivity: h.addActivity }));
vi.mock('../../server/broadcast.js', () => ({ broadcastToWorkspace: h.broadcastToWorkspace }));
vi.mock('../../server/intelligence/cache-invalidation.js', () => ({ invalidateIntelligenceCache: h.invalidateIntelligenceCache }));
vi.mock('../../server/ws-events.js', () => ({
  WS_EVENTS: { BRAND_IDENTITY_UPDATED: 'brand-identity:updated' },
  BRAND_IDENTITY_UPDATED_PAYLOAD: {},
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { handleBrandTool } from '../../server/mcp/tools/brand.js';
import {
  BrandDeliverableVersionConflictError,
  updateDeliverableContent,
} from '../../server/brand-identity.js';
import { getDeliverable } from '../../server/brand-deliverable-read-model.js';
import { seedWorkspace, seedTwoWorkspaces } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { randomUUID } from 'crypto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function insertDeliverable(workspaceId: string, content: string, status: 'draft' | 'approved' = 'draft'): string {
  const id = `bid_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO brand_identity_deliverables
     (id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at)
     VALUES (@id, @workspace_id, @deliverable_type, @content, @status, @version, @tier, @created_at, @updated_at)`,
  ).run({
    id,
    workspace_id: workspaceId,
    deliverable_type: 'mission',
    content,
    status,
    version: 1,
    tier: 'essentials',
    created_at: now,
    updated_at: now,
  });
  return id;
}

function rawRow(id: string): { content: string; version: number; status: string } | undefined {
  return db
    .prepare('SELECT content, version, status FROM brand_identity_deliverables WHERE id = ?')
    .get(id) as { content: string; version: number; status: string } | undefined;
}

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? 'null');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('update_brand_deliverable MCP tool', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    vi.clearAllMocks();
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
  });
  afterEach(() => { ws?.cleanup(); });

  it('persists new content, bumps version, drafts, snapshots, and fires the data-flow contract', async () => {
    const id = insertDeliverable(ws.workspaceId, 'Old mission', 'approved');

    const result = await handleBrandTool('update_brand_deliverable', {
      workspaceId: ws.workspaceId,
      deliverableId: id,
      content: 'New mission',
      expectedVersion: 1,
    });

    expect(result.isError).toBeFalsy();
    const payload = parse(result);
    expect(payload).toMatchObject({ id, content: 'New mission', status: 'draft', version: 2, changed: true });

    // Persisted to the DB
    const row = rawRow(id);
    expect(row).toMatchObject({ content: 'New mission', version: 2, status: 'draft' });

    // Prior version snapshotted
    const fresh = getDeliverable(ws.workspaceId, id);
    expect(fresh?.versions).toHaveLength(1);
    expect(fresh?.versions[0]?.content).toBe('Old mission');

    // Side effects fired exactly once
    expect(h.addActivity).toHaveBeenCalledTimes(1);
    expect(h.addActivity).toHaveBeenCalledWith(
      ws.workspaceId,
      'brand_deliverable_refined',
      expect.stringContaining('mission'),
      undefined,
      expect.objectContaining({ source: 'mcp-chat', deliverableId: id }),
    );
    expect(h.broadcastToWorkspace).toHaveBeenCalledWith(ws.workspaceId, 'brand-identity:updated', {});
    expect(h.invalidateIntelligenceCache).toHaveBeenCalledWith(ws.workspaceId);
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('treats identical content as a no-op: no version bump, no side effects', async () => {
    const id = insertDeliverable(ws.workspaceId, 'Same mission', 'approved');

    const result = await handleBrandTool('update_brand_deliverable', {
      workspaceId: ws.workspaceId,
      deliverableId: id,
      content: 'Same mission',
    });

    expect(result.isError).toBeFalsy();
    const payload = parse(result);
    expect(payload).toMatchObject({ version: 1, changed: false });
    // Status preserved (no forced draft), version unchanged
    expect(rawRow(id)).toMatchObject({ content: 'Same mission', version: 1, status: 'approved' });

    expect(h.addActivity).not.toHaveBeenCalled();
    expect(h.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(h.invalidateIntelligenceCache).not.toHaveBeenCalled();
  });

  it('keeps the omitted-version compatibility path and logs a content-free deprecation event', async () => {
    const id = insertDeliverable(ws.workspaceId, 'Legacy mission');

    const result = await handleBrandTool('update_brand_deliverable', {
      workspaceId: ws.workspaceId,
      deliverableId: id,
      content: 'Sensitive replacement copy must not reach logs',
    });

    expect(result.isError).toBeFalsy();
    expect(parse(result)).toMatchObject({
      id,
      content: 'Sensitive replacement copy must not reach logs',
      version: 2,
      changed: true,
    });
    expect(h.logger.warn).toHaveBeenCalledWith({
      tool: 'update_brand_deliverable',
      workspaceId: ws.workspaceId,
      deliverableId: id,
      omittedField: 'expectedVersion',
      deprecation: 'legacy_missing_expected_version',
    }, 'Deprecated MCP brand-deliverable update omitted its concurrency guard');
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain('Sensitive replacement copy');
  });

  it('rejects a stale expectedVersion as a conflict without writing', async () => {
    const id = insertDeliverable(ws.workspaceId, 'Mission v1');

    const result = await handleBrandTool('update_brand_deliverable', {
      workspaceId: ws.workspaceId,
      deliverableId: id,
      content: 'Mission v2',
      expectedVersion: 5,
    });

    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({
      code: 'conflict',
      retryable: true,
      details: { current_version: 1 },
    });
    // No write happened
    expect(rawRow(id)).toMatchObject({ content: 'Mission v1', version: 1 });
    expect(getDeliverable(ws.workspaceId, id)?.versions).toHaveLength(0);
    expect(h.addActivity).not.toHaveBeenCalled();
    expect(h.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('throws a typed expected/actual conflict from the domain transaction', () => {
    const id = insertDeliverable(ws.workspaceId, 'Mission v1');

    let conflict: unknown;
    try {
      updateDeliverableContent(ws.workspaceId, id, 'Mission v2', 7);
    } catch (error) {
      conflict = error;
    }

    expect(conflict).toBeInstanceOf(BrandDeliverableVersionConflictError);
    expect(conflict).toMatchObject({
      code: 'conflict',
      expectedVersion: 7,
      actualVersion: 1,
    });
    expect(rawRow(id)).toMatchObject({ content: 'Mission v1', version: 1 });
    expect(getDeliverable(ws.workspaceId, id)?.versions).toHaveLength(0);
  });

  it('returns not found for an unknown deliverable id', async () => {
    const result = await handleBrandTool('update_brand_deliverable', {
      workspaceId: ws.workspaceId,
      deliverableId: 'bid_missing',
      content: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
    expect(h.addActivity).not.toHaveBeenCalled();
  });

  it('isolates across workspaces: cannot write workspace A deliverable via workspace B', () => {
    const { wsA, wsB, cleanup } = seedTwoWorkspaces();
    try {
      const id = insertDeliverable(wsA.workspaceId, 'A mission');
      return handleBrandTool('update_brand_deliverable', {
        workspaceId: wsB.workspaceId,
        deliverableId: id,
        content: 'hijacked',
        expectedVersion: 1,
      }).then(result => {
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('not found');
        expect(rawRow(id)).toMatchObject({ content: 'A mission', version: 1 });
        expect(h.broadcastToWorkspace).not.toHaveBeenCalled();
      });
    } finally {
      cleanup();
    }
  });

  it('errors on a missing workspace', async () => {
    const result = await handleBrandTool('update_brand_deliverable', {
      workspaceId: 'ws-does-not-exist',
      deliverableId: 'bid_x',
      content: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Workspace not found');
  });

  it('rejects invalid args (empty content, missing fields)', async () => {
    const emptyContent = await handleBrandTool('update_brand_deliverable', {
      workspaceId: ws.workspaceId,
      deliverableId: 'bid_x',
      content: '',
    });
    expect(emptyContent.isError).toBe(true);
    expect(parse(emptyContent)).toMatchObject({ code: 'validation_failed' });

    const missing = await handleBrandTool('update_brand_deliverable', { workspaceId: ws.workspaceId });
    expect(missing.isError).toBe(true);
    expect(parse(missing)).toMatchObject({ code: 'validation_failed' });
  });

  it('still rejects unknown tool names after the dispatcher split', async () => {
    const result = await handleBrandTool('bogus_brand_tool', { workspaceId: ws.workspaceId });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Unknown tool');
  });

  it('still routes get_brand_identity through the dispatcher (no regression from the split)', async () => {
    // Intelligence with no brand slice → the read tool degrades to no_data. This
    // asserts the dispatcher still reaches get_brand_identity after the split — the
    // full behavior is covered in mcp-tools-read-models.test.ts.
    h.buildWorkspaceIntelligence.mockResolvedValueOnce({ requestedSlices: ['brand'] });
    const result = await handleBrandTool('get_brand_identity', { workspaceId: ws.workspaceId });
    expect(result.isError).toBeFalsy();
    expect(parse(result)).toMatchObject({ availability: 'no_data', voice_status: 'none' });
  });
});

describe('create_brand_deliverable MCP tool', () => {
  let ws: SeededFullWorkspace;

  beforeEach(() => {
    vi.clearAllMocks();
    ws = seedWorkspace({ tier: 'growth', clientPassword: '' });
  });
  afterEach(() => { ws?.cleanup(); });

  it('creates operator-authored content as a new draft and fires the brand data-flow contract', async () => {
    const result = await handleBrandTool('create_brand_deliverable', {
      workspace_id: ws.workspaceId,
      deliverable_type: 'differentiators',
      content: 'We show every option and explain the tradeoffs before treatment begins.',
    });

    expect(result.isError).toBeFalsy();
    const payload = parse(result);
    expect(payload).toMatchObject({
      deliverable_type: 'differentiators',
      content: 'We show every option and explain the tradeoffs before treatment begins.',
      status: 'draft',
      version: 1,
      tier: 'professional',
      created: true,
    });
    expect(payload.id).toMatch(/^bid_/);

    const stored = getDeliverable(ws.workspaceId, payload.id);
    expect(stored).toMatchObject({
      deliverableType: 'differentiators',
      status: 'draft',
      version: 1,
    });
    expect(stored?.versions).toHaveLength(0);
    expect(h.addActivity).toHaveBeenCalledWith(
      ws.workspaceId,
      'brand_deliverable_generated',
      expect.stringContaining('differentiators'),
      undefined,
      expect.objectContaining({
        source: 'mcp-chat',
        deliverableId: payload.id,
        action: 'mcp_brand_deliverable_created',
      }),
    );
    expect(h.broadcastToWorkspace).toHaveBeenCalledWith(
      ws.workspaceId,
      'brand-identity:updated',
      {},
    );
    expect(h.invalidateIntelligenceCache).toHaveBeenCalledWith(ws.workspaceId);
  });

  it('rejects a duplicate workspace/type without overwriting the existing deliverable', async () => {
    const existingId = insertDeliverable(ws.workspaceId, 'Existing mission', 'approved');

    const result = await handleBrandTool('create_brand_deliverable', {
      workspace_id: ws.workspaceId,
      deliverable_type: 'mission',
      content: 'Replacement mission',
    });

    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ code: 'conflict', retryable: false });
    expect(rawRow(existingId)).toMatchObject({
      content: 'Existing mission',
      version: 1,
      status: 'approved',
    });
    expect(h.addActivity).not.toHaveBeenCalled();
    expect(h.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(h.invalidateIntelligenceCache).not.toHaveBeenCalled();
  });
});
