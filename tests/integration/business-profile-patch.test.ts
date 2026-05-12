/**
 * Integration tests for PATCH /api/public/workspaces/:id/business-profile
 *
 * Tests:
 * - Unauthenticated request → 401
 * - Valid authenticated PATCH → 200 + profile persisted
 * - Clearable email field ('' is valid, not 400)
 * - Clearable socialProfiles URL ('' is valid, not 400)
 * - Partial address PATCH deep-merges, preserving sibling fields
 * - PATCH merges with existing profile (does not wipe unrelated fields)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13252);
const { api, postJson, patchJson } = ctx;

const CLIENT_PASSWORD = 'integration-test-pw';

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();
});

let workspaceId = '';
let otherWorkspaceId = '';
let otherSessionCookie = '';

async function getPublicBusinessProfile(workspace = workspaceId) {
  const res = await api(`/api/public/workspace/${workspace}`);
  expect(res.status).toBe(200);
  const ws = await res.json();
  return ws.businessProfile;
}

async function putBusinessProfile(profile: unknown, workspace = workspaceId): Promise<void> {
  const res = await api(`/api/workspaces/${workspace}/business-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  expect(res.status).toBe(200);
}

/** Set up a workspace with client auth and return authenticated context */
async function setupWorkspace() {
  const res = await postJson('/api/workspaces', { name: 'BP Patch Test' });
  const body = await res.json();
  workspaceId = body.id;

  // Set client password via admin route
  await patchJson(`/api/workspaces/${workspaceId}`, { clientPassword: CLIENT_PASSWORD });

  // Login as client → populates cookie jar with client_session_* cookie
  const loginRes = await postJson(`/api/public/auth/${workspaceId}`, { password: CLIENT_PASSWORD });
  expect(loginRes.status).toBe(200);

  const otherRes = await postJson('/api/workspaces', { name: 'BP Patch Other Workspace' });
  const otherBody = await otherRes.json();
  otherWorkspaceId = otherBody.id;
  await patchJson(`/api/workspaces/${otherWorkspaceId}`, { clientPassword: CLIENT_PASSWORD });
  const otherLoginRes = await postJson(`/api/public/auth/${otherWorkspaceId}`, { password: CLIENT_PASSWORD });
  expect(otherLoginRes.status).toBe(200);
  const setCookie = otherLoginRes.headers.getSetCookie?.() || [];
  const sessionCookie = setCookie.find((cookie: string) => cookie.startsWith(`client_session_${otherWorkspaceId}=`));
  expect(sessionCookie).toBeDefined();
  otherSessionCookie = sessionCookie?.split(';')[0] ?? '';
}

describe('PATCH /api/public/workspaces/:id/business-profile', () => {
  beforeAll(setupWorkspace);

  it('returns 401 without a client session', async () => {
    // Use a raw fetch without the cookie jar
    const res = await fetch(`http://localhost:${ctx.PORT}/api/public/workspaces/${workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '555-1234' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 and persists a valid profile', async () => {
    const res = await patchJson(`/api/public/workspaces/${workspaceId}/business-profile`, {
      phone: '+1 (555) 000-0001',
      email: 'contact@example.com',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.businessProfile.phone).toBe('+1 (555) 000-0001');
    expect(body.businessProfile.email).toBe('contact@example.com');

    // Verify persisted via public GET
    const getRes = await api(`/api/public/workspace/${workspaceId}`);
    const ws = await getRes.json();
    expect(ws.businessProfile.phone).toBe('+1 (555) 000-0001');
  });

  it('accepts empty string for email (clearable-field pattern — not 400)', async () => {
    const res = await patchJson(`/api/public/workspaces/${workspaceId}/business-profile`, {
      email: '',
    });
    expect(res.status).toBe(200);
  });

  it('accepts empty string in socialProfiles array (clearable-field pattern — not 400)', async () => {
    const res = await patchJson(`/api/public/workspaces/${workspaceId}/business-profile`, {
      socialProfiles: ['https://twitter.com/example', ''],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.businessProfile.socialProfiles).toEqual(['https://twitter.com/example']);
  });

  it('rejects invalid email without mutating the stored business profile', async () => {
    await putBusinessProfile({
      phone: '+1 (555) 333-3333',
      email: 'valid@example.com',
    });
    const before = await getPublicBusinessProfile();

    const res = await patchJson(`/api/public/workspaces/${workspaceId}/business-profile`, {
      email: 'not-an-email',
    });

    expect(res.status).toBe(400);
    expect(await getPublicBusinessProfile()).toEqual(before);
  });

  it('rejects invalid social profile URLs without mutating the stored business profile', async () => {
    await putBusinessProfile({
      socialProfiles: ['https://twitter.com/example'],
    });
    const before = await getPublicBusinessProfile();

    const res = await patchJson(`/api/public/workspaces/${workspaceId}/business-profile`, {
      socialProfiles: ['https://twitter.com/example', 'not-a-url'],
    });

    expect(res.status).toBe(400);
    expect(await getPublicBusinessProfile()).toEqual(before);
  });

  it('does not allow a client session from another workspace to mutate the profile', async () => {
    await putBusinessProfile({
      phone: '+1 (555) 444-4444',
    });
    const before = await getPublicBusinessProfile();

    const res = await fetch(`http://localhost:${ctx.PORT}/api/public/workspaces/${workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: otherSessionCookie,
      },
      body: JSON.stringify({ phone: '+1 (555) 999-9999' }),
    });

    expect(res.status).toBe(401);
    expect(await getPublicBusinessProfile()).toEqual(before);
  });

  it('merges with existing profile — does not wipe unrelated fields', async () => {
    // Set a full profile first
    await putBusinessProfile({
      phone: '+1 (555) 111-1111',
      email: 'keep@example.com',
      openingHours: 'Mon-Fri 9-5',
    });

    // PATCH only phone — email and openingHours must survive
    const res = await patchJson(`/api/public/workspaces/${workspaceId}/business-profile`, {
      phone: '+1 (555) 222-2222',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.businessProfile.phone).toBe('+1 (555) 222-2222');
    expect(body.businessProfile.email).toBe('keep@example.com');
    expect(body.businessProfile.openingHours).toBe('Mon-Fri 9-5');
  });

  it('deep-merges address — partial address PATCH preserves sibling fields', async () => {
    // Set a full address first
    await putBusinessProfile({
      address: { street: '123 Main St', city: 'Austin', state: 'TX', zip: '78701', country: 'USA' },
    });

    // PATCH only street — city/state/zip/country must survive
    const res = await patchJson(`/api/public/workspaces/${workspaceId}/business-profile`, {
      address: { street: '456 Oak Ave' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.businessProfile.address.street).toBe('456 Oak Ave');
    expect(body.businessProfile.address.city).toBe('Austin');
    expect(body.businessProfile.address.state).toBe('TX');
    expect(body.businessProfile.address.zip).toBe('78701');
    expect(body.businessProfile.address.country).toBe('USA');
  });
});
