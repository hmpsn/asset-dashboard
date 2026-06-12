/**
 * Integration tests for brandscript GET read paths and basic CRUD.
 *
 * Covers:
 * - GET /api/brandscript-templates → 200 with array
 * - GET /api/brandscripts/:workspaceId → 200 with empty array for fresh ws
 * - GET /api/brandscripts/:workspaceId/:id unknown id → 404
 * - POST /api/brandscript-templates with missing name → 400
 * - POST /api/brandscripts/:workspaceId with valid body → 201 with object
 *
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api, postJson } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Brandscript Read WS 13641').id;
}, 40_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brandscript-templates
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brandscript-templates', () => {
  it('returns 200 with an array', async () => {
    const res = await api('/api/brandscript-templates');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brandscripts/:workspaceId
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brandscripts/:workspaceId', () => {
  it('returns 200 with an empty array for a fresh workspace', async () => {
    const res = await api(`/api/brandscripts/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brandscripts/:workspaceId/:id — unknown id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brandscripts/:workspaceId/:id', () => {
  it('returns 404 for an unknown brandscript id', async () => {
    const res = await api(`/api/brandscripts/${wsId}/bs_does_not_exist`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/brandscript-templates — validation
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/brandscript-templates', () => {
  it('returns 400 when name is missing', async () => {
    const res = await postJson('/api/brandscript-templates', {
      // name intentionally omitted
      sections: [{ title: 'Hero', purpose: 'The protagonist' }],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('returns 400 when sections array is empty', async () => {
    const res = await postJson('/api/brandscript-templates', {
      name: 'Empty Sections Template',
      sections: [],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/brandscripts/:workspaceId — create brandscript
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/brandscripts/:workspaceId', () => {
  it('returns 200 with created brandscript object for valid body', async () => {
    const res = await postJson(`/api/brandscripts/${wsId}`, {
      name: 'Test Brandscript',
      frameworkType: 'storybrand',
      sections: [
        { title: 'The Hero', content: 'Our customer is a small business owner.' },
      ],
    });
    // Route uses res.json(bs) without explicit status → defaults to 200
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.id).toBe('string');
    expect(body.name).toBe('Test Brandscript');
    expect(body.workspaceId).toBe(wsId);
    expect(body.frameworkType).toBe('storybrand');
    expect(Array.isArray(body.sections)).toBe(true);
  });

  it('GET after creation returns the brandscript in the list', async () => {
    const res = await api(`/api/brandscripts/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  it('returns 400 when name is missing', async () => {
    const res = await postJson(`/api/brandscripts/${wsId}`, {
      // name intentionally omitted
      sections: [],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });
});
