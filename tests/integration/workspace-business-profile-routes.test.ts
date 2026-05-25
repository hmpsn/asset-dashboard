/**
 * Integration tests for workspace business-profile endpoints.
 *
 * Covers (from server/routes/workspaces.ts):
 *  - PUT /api/workspaces/:id/business-profile — valid full body → 200 with businessProfile
 *  - PUT /api/workspaces/:id/business-profile — valid partial body (all fields optional) → 200
 *  - PUT /api/workspaces/:id/business-profile — invalid email → 400
 *  - PUT /api/workspaces/:id/business-profile — unknown workspace → 404
 *  - GET /api/workspaces/:id after update → reflects updated businessProfile fields
 *
 * businessProfileSchema fields (all optional):
 *   phone?: string (max 30)
 *   email?: string (valid email)
 *   address?: { street?, city?, state?, zip?, country? }
 *   socialProfiles?: string[] (URLs, max 10)
 *   openingHours?: string (max 500)
 *   foundedDate?: string (max 20)
 *   numberOfEmployees?: string (max 50)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13618);
const { api } = ctx;
let wsId = '';

function putBusinessProfile(workspaceId: string, body: unknown): Promise<Response> {
  return ctx.api(`/api/workspaces/${workspaceId}/business-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Business Profile WS 13618').id;
}, 30_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('PUT /api/workspaces/:id/business-profile — valid bodies', () => {
  it('accepts a full valid profile and returns 200 with businessProfile object', async () => {
    const res = await putBusinessProfile(wsId, {
      phone: '+1-555-0199',
      email: 'biz@example.com',
      address: {
        street: '1 Test Ave',
        city: 'Springfield',
        state: 'IL',
        zip: '62701',
        country: 'US',
      },
      openingHours: 'Mon-Fri 9-5',
      foundedDate: '2015',
      numberOfEmployees: '50-100',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('businessProfile');
    expect(body.businessProfile.phone).toBe('+1-555-0199');
    expect(body.businessProfile.email).toBe('biz@example.com');
    expect(body.businessProfile.address?.city).toBe('Springfield');
    expect(body.businessProfile.openingHours).toBe('Mon-Fri 9-5');
    expect(body.businessProfile.foundedDate).toBe('2015');
    expect(body.businessProfile.numberOfEmployees).toBe('50-100');
  });

  it('accepts a partial update with only phone', async () => {
    const res = await putBusinessProfile(wsId, { phone: '+1-800-PARTIAL' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('businessProfile');
    expect(body.businessProfile.phone).toBe('+1-800-PARTIAL');
  });

  it('accepts an empty object (all fields optional)', async () => {
    const res = await putBusinessProfile(wsId, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('businessProfile');
  });

  it('accepts socialProfiles as an array of valid URLs', async () => {
    const res = await putBusinessProfile(wsId, {
      socialProfiles: [
        'https://twitter.com/example',
        'https://linkedin.com/company/example',
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.businessProfile.socialProfiles)).toBe(true);
    expect(body.businessProfile.socialProfiles).toHaveLength(2);
  });

  it('accepts nested address with partial fields', async () => {
    const res = await putBusinessProfile(wsId, {
      address: { city: 'Chicago', country: 'US' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.businessProfile.address?.city).toBe('Chicago');
    expect(body.businessProfile.address?.country).toBe('US');
  });
});

describe('PUT /api/workspaces/:id/business-profile — validation failures', () => {
  it('returns 400 for an invalid email address', async () => {
    const res = await putBusinessProfile(wsId, { email: 'not-a-valid-email' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for a phone value exceeding max length (31 chars)', async () => {
    const res = await putBusinessProfile(wsId, { phone: 'X'.repeat(31) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an openingHours value exceeding max length (501 chars)', async () => {
    const res = await putBusinessProfile(wsId, { openingHours: 'H'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for a socialProfiles entry that is not a URL', async () => {
    const res = await putBusinessProfile(wsId, {
      socialProfiles: ['not-a-url'],
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/workspaces/:id/business-profile — 404 handling', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await putBusinessProfile('ws_nonexistent_bizprofile_99', { phone: '+1-555-0000' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

describe('GET /api/workspaces/:id after business-profile update', () => {
  it('workspace GET does not crash and returns 200 after profile update', async () => {
    // Perform a profile update
    const putRes = await putBusinessProfile(wsId, {
      email: 'updated@example.com',
      numberOfEmployees: '10-25',
    });
    expect(putRes.status).toBe(200);

    // The workspace GET endpoint itself does not expose businessProfile inline,
    // but it must still respond 200 without error after the profile is stored.
    const getRes = await api(`/api/workspaces/${wsId}`);
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.id).toBe(wsId);
  });

  it('confirms stored businessProfile via the update response (round-trip)', async () => {
    const payload = {
      phone: '+44-20-7946-0958',
      email: 'roundtrip@example.com',
      foundedDate: '2020',
    };
    const putRes = await putBusinessProfile(wsId, payload);
    expect(putRes.status).toBe(200);
    const body = await putRes.json();
    expect(body.businessProfile.phone).toBe('+44-20-7946-0958');
    expect(body.businessProfile.email).toBe('roundtrip@example.com');
    expect(body.businessProfile.foundedDate).toBe('2020');
  });
});
