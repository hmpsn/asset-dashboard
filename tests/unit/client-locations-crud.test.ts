import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  countClientLocations,
  createClientLocation,
  deleteClientLocation,
  getClientLocationById,
  getClientLocations,
  updateClientLocation,
} from '../../server/client-locations.js';
import { getEffectiveLocations } from '../../server/local-seo.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let workspaceId: string;

beforeEach(() => {
  const ws = createWorkspace('Test Workspace');
  workspaceId = ws.id;
});

afterEach(() => {
  deleteWorkspace(workspaceId);
});

describe('getClientLocations', () => {
  it('returns empty array when no locations configured', () => {
    expect(getClientLocations(workspaceId)).toEqual([]);
  });

  it('uses synthetic workspace identity until at least one location is confirmed', () => {
    const draft = createClientLocation(workspaceId, { name: 'Draft Branch' });
    const effectiveDraftOnly = getEffectiveLocations({
      id: workspaceId,
      name: 'Test Workspace',
      folder: 'test-workspace',
      liveDomain: 'https://test.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(effectiveDraftOnly).toHaveLength(1);
    expect(effectiveDraftOnly[0]?.id).toBe(`synthetic-${workspaceId}`);

    updateClientLocation(draft.id, workspaceId, { status: 'confirmed' });
    const effectiveConfirmed = getEffectiveLocations({
      id: workspaceId,
      name: 'Test Workspace',
      folder: 'test-workspace',
      liveDomain: 'https://test.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(effectiveConfirmed[0]?.id).toBe(draft.id);
  });
});

describe('createClientLocation', () => {
  it('creates a location with required fields', () => {
    const loc = createClientLocation(workspaceId, { name: 'Main Office' });
    expect(loc.id).toBeTruthy();
    expect(loc.name).toBe('Main Office');
    expect(loc.workspaceId).toBe(workspaceId);
    expect(loc.status).toBe('needs_review');
    expect(loc.isPrimary).toBe(false);
  });

  it('creates a confirmed primary location', () => {
    const loc = createClientLocation(workspaceId, {
      name: 'Downtown',
      domain: 'example.com',
      phone: '5125550100',
      streetAddress: '123 Main St',
      city: 'Austin',
      stateOrRegion: 'TX',
      country: 'US',
      isPrimary: true,
      status: 'confirmed',
    });
    expect(loc.isPrimary).toBe(true);
    expect(loc.status).toBe('confirmed');
    expect(loc.domain).toBe('example.com');
    expect(loc.phone).toBe('5125550100');
  });
});

describe('updateClientLocation', () => {
  it('updates specified fields, leaves others unchanged', () => {
    const loc = createClientLocation(workspaceId, { name: 'Original' });
    const updated = updateClientLocation(loc.id, workspaceId, { name: 'Updated', status: 'confirmed' });
    expect(updated?.name).toBe('Updated');
    expect(updated?.status).toBe('confirmed');
    expect(updated?.isPrimary).toBe(false);
  });

  it('returns null for unknown id', () => {
    expect(updateClientLocation('nonexistent', workspaceId, { name: 'X' })).toBeNull();
  });
});

describe('deleteClientLocation', () => {
  it('deletes an existing location', () => {
    const loc = createClientLocation(workspaceId, { name: 'Branch' });
    expect(deleteClientLocation(loc.id, workspaceId)).toBe(true);
    expect(getClientLocationById(loc.id, workspaceId)).toBeUndefined();
  });

  it('returns false for unknown id', () => {
    expect(deleteClientLocation('nonexistent', workspaceId)).toBe(false);
  });
});

describe('countClientLocations', () => {
  it('counts configured locations', () => {
    expect(countClientLocations(workspaceId)).toBe(0);
    createClientLocation(workspaceId, { name: 'A' });
    createClientLocation(workspaceId, { name: 'B' });
    expect(countClientLocations(workspaceId)).toBe(2);
  });
});
