/**
 * Integration tests for Brand Engine Phase 1 routes.
 *
 * Covers the four route modules added in feat/brandscript-engine-phase1:
 *   - /api/voice/:workspaceId              (voice-calibration.ts)
 *   - /api/discovery/:workspaceId          (discovery-ingestion.ts)
 *   - /api/brandscripts/:workspaceId       (brandscript.ts)
 *   - /api/brand-identity/:workspaceId     (brand-identity.ts)
 *
 * Intentionally avoids AI-generating endpoints (calibrate, processSource,
 * generateDeliverable, import) to keep the suite fast. Those paths are:
 *   1. Too slow for CI (real AI call or fake-key retry overhead)
 *   2. Covered separately by the idempotency / workspace-isolation assertions
 *      once test infrastructure matures.
 *
 * Tests that DO matter for a PR gate:
 *   - CRUD happy paths (create → list → get → delete)
 *   - Workspace isolation (data from workspace A must not appear in B)
 *   - 409 guard on processSource (already-processed idempotency)
 *   - Zod validation rejection (unknown keys, missing required fields)
 *   - Auth passthrough — APP_PASSWORD='' means all routes are open in test env
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import type { VoiceProfile, VoiceSample } from '../../shared/types/brand-engine.js';
import type { DiscoverySource, DiscoveryExtraction } from '../../server/discovery-ingestion.js';
import type { Brandscript } from '../../shared/types/brand-engine.js';
import type { BrandDeliverable } from '../../shared/types/brand-engine.js';

const ctx = createTestContext(13317);
const { api, postJson, patchJson, del } = ctx;

let wsId = '';
let wsOtherId = '';
let cleanupA: () => void;
let cleanupB: () => void;

beforeAll(async () => {
  await ctx.startServer();

  const wsA = seedWorkspace({ clientPassword: '' });
  const wsB = seedWorkspace({ clientPassword: '' });
  wsId = wsA.workspaceId;
  wsOtherId = wsB.workspaceId;
  cleanupA = wsA.cleanup;
  cleanupB = wsB.cleanup;
});

afterAll(() => {
  ctx.stopServer();
  cleanupA?.();
  cleanupB?.();
});

// ── Voice Profile ─────────────────────────────────────────────────────────────

describe('GET /api/voice/:workspaceId — get profile (no auto-create)', () => {
  it('returns null when no profile exists (A5 fix: no side-effect creation on GET)', async () => {
    const ws = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/voice/${ws.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBeNull();
    } finally {
      ws.cleanup();
    }
  });
});

describe('POST /api/voice/:workspaceId — explicit create profile', () => {
  it('creates and returns a draft profile with empty samples', async () => {
    // Ensure no profile exists first (workspace was just created in beforeAll)
    const res = await postJson(`/api/voice/${wsId}`, {});
    expect(res.status).toBe(201);
    const body = (await res.json()) as VoiceProfile & { samples: VoiceSample[] };
    expect(body.workspaceId).toBe(wsId);
    expect(body.status).toBe('draft');
    expect(Array.isArray(body.samples)).toBe(true);
  });

  it('second POST returns 409 (already exists)', async () => {
    const res = await postJson(`/api/voice/${wsId}`, {});
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('GET now returns the profile', async () => {
    const res = await api(`/api/voice/${wsId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VoiceProfile & { samples: VoiceSample[] };
    expect(body).not.toBeNull();
    expect(body.status).toBe('draft');
  });
});

describe('PATCH /api/voice/:workspaceId — update profile fields', () => {
  it('updates status to calibrating', async () => {
    // Profile was created in the POST describe above
    const res = await patchJson(`/api/voice/${wsId}`, { status: 'calibrating' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as VoiceProfile;
    expect(body.status).toBe('calibrating');
    // Reset
    await patchJson(`/api/voice/${wsId}`, { status: 'draft' });
  });

  it('rejects unknown keys (strict schema)', async () => {
    const res = await patchJson(`/api/voice/${wsId}`, { unknownField: 'bad' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid status value', async () => {
    const res = await patchJson(`/api/voice/${wsId}`, { status: 'invalid_status' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/voice/:workspaceId/samples — add voice sample', () => {
  it('adds a sample and returns it', async () => {
    // Profile exists from the explicit POST above
    const res = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'We help small businesses grow without the jargon.',
      contextTag: 'headline',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as VoiceSample;
    expect(body.id).toMatch(/^vs_/);
    expect(body.content).toBe('We help small businesses grow without the jargon.');
    expect(body.contextTag).toBe('headline');
    expect(body.source).toBe('manual');
  });

  it('rejects missing content field', async () => {
    const res = await postJson(`/api/voice/${wsId}/samples`, { contextTag: 'body' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/voice/:workspaceId/samples/:sampleId — delete sample', () => {
  it('deletes an existing sample', async () => {
    // Profile exists from the explicit POST above
    const addRes = await postJson(`/api/voice/${wsId}/samples`, {
      content: 'Sample to be deleted.',
    });
    const sample = (await addRes.json()) as VoiceSample;

    const delRes = await del(`/api/voice/${wsId}/samples/${sample.id}`);
    expect(delRes.status).toBe(200);
    const body = await delRes.json();
    expect(body.deleted).toBe(true);
  });

  it('returns 404 for non-existent sample id', async () => {
    const res = await del(`/api/voice/${wsId}/samples/vs_notfound`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when sample exists but belongs to a different workspace (workspace scoping)', async () => {
    // First create a profile for workspace B
    await postJson(`/api/voice/${wsOtherId}`, {});
    // Seed a sample in workspace B
    const addRes = await postJson(`/api/voice/${wsOtherId}/samples`, {
      content: 'Workspace B sample — must not be deletable from workspace A.',
    });
    expect(addRes.status).toBe(200);
    const sample = (await addRes.json()) as VoiceSample;

    // Attempt to delete it via workspace A's endpoint
    const delRes = await del(`/api/voice/${wsId}/samples/${sample.id}`);
    expect(delRes.status).toBe(404);

    // Verify it still exists under workspace B
    const profileRes = await api(`/api/voice/${wsOtherId}`);
    const profile = (await profileRes.json()) as VoiceProfile & { samples: VoiceSample[] };
    const stillThere = profile.samples.some(s => s.id === sample.id);
    expect(stillThere).toBe(true);
  });
});

describe('GET /api/voice/:workspaceId/sessions — calibration sessions', () => {
  it('returns empty array when no sessions exist', async () => {
    const ws = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/voice/${ws.workspaceId}/sessions`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      ws.cleanup();
    }
  });
});

// ── Discovery — Sources ──────────────────────────────────────────────────────

describe('POST /api/discovery/:workspaceId/sources/text — add text source', () => {
  it('creates a source from pasted text', async () => {
    const res = await postJson(`/api/discovery/${wsId}/sources/text`, {
      filename: 'transcript.txt',
      sourceType: 'transcript',
      rawContent: 'The client said: "We really care about authentic relationships with our customers."',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiscoverySource;
    expect(body.id).toMatch(/^src_/);
    expect(body.sourceType).toBe('transcript');
    expect(body.filename).toBe('transcript.txt');
    expect(body.processedAt).toBeUndefined();
  });

  it('rejects invalid sourceType', async () => {
    const res = await postJson(`/api/discovery/${wsId}/sources/text`, {
      filename: 'bad.txt',
      sourceType: 'not_a_real_type',
      content: 'Some content',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/discovery/:workspaceId/sources — list sources', () => {
  it('returns only sources for the requesting workspace (isolation)', async () => {
    // Add a source to workspace B
    const addRes = await postJson(`/api/discovery/${wsOtherId}/sources/text`, {
      filename: 'ws-b-only.txt',
      sourceType: 'brand_doc',
      rawContent: 'Workspace B specific document.',
    });
    expect(addRes.status).toBe(200);
    const wsBSource = (await addRes.json()) as DiscoverySource;

    // Workspace A must not see workspace B's source
    const listRes = await api(`/api/discovery/${wsId}/sources`);
    expect(listRes.status).toBe(200);
    const sources = (await listRes.json()) as DiscoverySource[];
    const leaked = sources.find(s => s.id === wsBSource.id);
    expect(leaked).toBeUndefined();
  });
});

describe('POST /api/discovery/:workspaceId/sources/:id/process — 409 guard', () => {
  it('returns 409 when source is already processed and force is not set', async () => {
    // Create a source
    const addRes = await postJson(`/api/discovery/${wsId}/sources/text`, {
      filename: 'already-processed.txt',
      sourceType: 'brand_doc',
      rawContent: 'Content to process.',
    });
    const source = (await addRes.json()) as DiscoverySource;

    // Seed processed_at directly — avoids a real AI call in tests
    db.prepare('UPDATE discovery_sources SET processed_at = ? WHERE id = ?')
      .run(new Date().toISOString(), source.id);

    // Second process attempt without force must 409
    const processRes = await postJson(
      `/api/discovery/${wsId}/sources/${source.id}/process`,
      {},
    );
    expect(processRes.status).toBe(409);
    const body = await processRes.json();
    expect(body.error).toMatch(/already been processed/i);
  });
});

describe('DELETE /api/discovery/:workspaceId/sources/:id — delete source', () => {
  it('deletes a source', async () => {
    const addRes = await postJson(`/api/discovery/${wsId}/sources/text`, {
      filename: 'to-delete.txt',
      sourceType: 'existing_copy',
      rawContent: 'Will be deleted.',
    });
    const source = (await addRes.json()) as DiscoverySource;

    const delRes = await del(`/api/discovery/${wsId}/sources/${source.id}`);
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).deleted).toBe(true);
  });

  it('returns 404 for a source belonging to a different workspace (workspace scoping)', async () => {
    const addRes = await postJson(`/api/discovery/${wsOtherId}/sources/text`, {
      filename: 'ws-b-source.txt',
      sourceType: 'brand_doc',
      rawContent: 'Belongs to workspace B.',
    });
    const wsBSource = (await addRes.json()) as DiscoverySource;

    // Attempt deletion via workspace A
    const delRes = await del(`/api/discovery/${wsId}/sources/${wsBSource.id}`);
    expect(delRes.status).toBe(404);
  });
});

describe('GET /api/discovery/:workspaceId/extractions — workspace isolation', () => {
  it('returns only extractions for the requesting workspace', async () => {
    // Seed a source for workspace B so we can attach an extraction to it
    const srcRes = await postJson(`/api/discovery/${wsOtherId}/sources/text`, {
      filename: 'for-extraction.txt', sourceType: 'brand_doc',
      rawContent: 'Workspace B brand document content.',
    });
    expect(srcRes.status).toBe(200);
    const wsBSrc = (await srcRes.json()) as DiscoverySource;

    // Seed an extraction directly into the DB for workspace B
    const extId = `ext_isolation_${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO discovery_extractions
      (id, source_id, workspace_id, extraction_type, category, content, source_quote, confidence, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      extId, wsBSrc.id, wsOtherId,
      'voice_pattern', 'signature_phrase',
      'Workspace B only extraction',
      null, 'high', 'pending', now,
    );

    // Workspace A must not see workspace B's extraction
    const listRes = await api(`/api/discovery/${wsId}/extractions`);
    expect(listRes.status).toBe(200);
    const extractions = (await listRes.json()) as DiscoveryExtraction[];
    const leaked = extractions.find(e => e.id === extId);
    expect(leaked).toBeUndefined();
  });
});

// ── Brandscript ───────────────────────────────────────────────────────────────

describe('Brandscript CRUD', () => {
  let bsId = '';

  it('creates a brandscript with sections', async () => {
    const res = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Test Brandscript',
      frameworkType: 'storybrand',
      sections: [
        { title: 'Character', purpose: 'The hero of the story' },
        { title: 'Problem', purpose: 'External problem' },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Brandscript;
    expect(body.id).toMatch(/^bs_/);
    expect(body.name).toBe('Test Brandscript');
    expect(body.sections).toHaveLength(2);
    bsId = body.id;
  });

  it('lists brandscripts for the workspace', async () => {
    const res = await api(`/api/brandscripts/${wsId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Brandscript[];
    expect(body.length).toBeGreaterThan(0);
    expect(body.find(b => b.id === bsId)).toBeDefined();
  });

  it('gets a single brandscript by id', async () => {
    const res = await api(`/api/brandscripts/${wsId}/${bsId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Brandscript;
    expect(body.id).toBe(bsId);
    expect(body.sections).toHaveLength(2);
  });

  it('returns 404 for a brandscript in a different workspace (workspace scoping)', async () => {
    const res = await api(`/api/brandscripts/${wsOtherId}/${bsId}`);
    expect(res.status).toBe(404);
  });

  it('updates brandscript sections', async () => {
    const res = await api(`/api/brandscripts/${wsId}/${bsId}/sections`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
      sections: [
        { title: 'Character', purpose: 'The hero', content: 'A small business owner struggling to grow.' },
        { title: 'Problem', purpose: 'External problem', content: 'Overwhelmed by digital marketing complexity.' },
        { title: 'Guide', purpose: 'The guide who helps', content: 'hmpsn.studio — clarity without jargon.' },
      ],
    }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Brandscript;
    expect(body.sections).toHaveLength(3);
    expect(body.sections[0].content).toBe('A small business owner struggling to grow.');
  });

  it('deletes a brandscript', async () => {
    const res = await del(`/api/brandscripts/${wsId}/${bsId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);

    const getRes = await api(`/api/brandscripts/${wsId}/${bsId}`);
    expect(getRes.status).toBe(404);
  });
});

// ── Brand Identity Deliverables ───────────────────────────────────────────────

describe('GET /api/brand-identity/:workspaceId — list deliverables', () => {
  it('returns empty array for a fresh workspace', async () => {
    const ws = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/brand-identity/${ws.workspaceId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as BrandDeliverable[];
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      ws.cleanup();
    }
  });
});

describe('PATCH /api/brand-identity/:workspaceId/:id — approve deliverable', () => {
  it('returns 404 for a non-existent deliverable id', async () => {
    const res = await patchJson(`/api/brand-identity/${wsId}/bid_notfound`, {
      status: 'approved',
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when deliverable exists but belongs to a different workspace', async () => {
    // Seed a deliverable directly for workspace B
    const now = new Date().toISOString();
    const delivId = `bid_iso_test_${Date.now()}`;
    db.prepare(`INSERT INTO brand_identity_deliverables
      (id, workspace_id, deliverable_type, content, status, version, tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(delivId, wsOtherId, 'mission', 'Workspace B mission.', 'draft', 1, 'essentials', now, now);

    // Attempt to approve it via workspace A
    const res = await patchJson(`/api/brand-identity/${wsId}/${delivId}`, {
      status: 'approved',
    });
    expect(res.status).toBe(404);
  });
});

// ── Brandscript section route ordering sanity check ───────────────────────────

describe('Route ordering — literal routes before param routes', () => {
  it('GET /api/brandscripts/:workspaceId before /:workspaceId/:id does not shadow /templates', async () => {
    // /api/brandscript-templates must resolve without being shadowed by
    // /:workspaceId — Express literal routes are registered first in
    // server/routes/brandscript.ts so this path is safe.
    const res = await api('/api/brandscript-templates');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
