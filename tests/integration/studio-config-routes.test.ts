import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13345); // port-ok: 13201-13344 already allocated in integration suite
const { api, patchJson } = ctx;

function clearBookingUrl(): void {
  db.prepare(`DELETE FROM studio_config WHERE key = 'booking_url'`).run();
}

beforeAll(async () => {
  await ctx.startServer();
}, 25_000);

beforeEach(clearBookingUrl);

afterAll(async () => {
  clearBookingUrl();
  await ctx.stopServer();
});

describe('studio-config routes', () => {
  it('GET returns an empty booking URL when unset', async () => {
    const res = await api('/api/studio-config');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ bookingUrl: '' });
  });

  it('PATCH requires the bookingUrl field', async () => {
    const res = await patchJson('/api/studio-config', {});

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'bookingUrl required' });
  });

  it('PATCH rejects invalid and non-http URLs', async () => {
    const invalid = await patchJson('/api/studio-config', { bookingUrl: 'not a url' });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: 'Invalid URL' });

    const nonHttp = await patchJson('/api/studio-config', { bookingUrl: 'ftp://example.com/book' });
    expect(nonHttp.status).toBe(400);
    await expect(nonHttp.json()).resolves.toEqual({ error: 'Invalid URL' });
  });

  it('PATCH stores a valid booking URL and GET reads it back', async () => {
    const res = await patchJson('/api/studio-config', {
      bookingUrl: 'https://cal.example.com/team',
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      bookingUrl: 'https://cal.example.com/team',
    });

    const getRes = await api('/api/studio-config');
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toEqual({
      bookingUrl: 'https://cal.example.com/team',
    });
  });

  it('PATCH with an empty string clears the booking URL', async () => {
    await patchJson('/api/studio-config', {
      bookingUrl: 'https://cal.example.com/team',
    });

    const res = await patchJson('/api/studio-config', { bookingUrl: '' });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, bookingUrl: null });

    const getRes = await api('/api/studio-config');
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toEqual({ bookingUrl: '' });
  });
});
