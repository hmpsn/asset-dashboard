import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import db from '../../server/db/index.js';
import {
  clearBookingUrl,
  deleteStudioConfig,
  getBookingUrl,
  getStudioConfig,
  setBookingUrl,
  setStudioConfig,
} from '../../server/studio-config.js';

const KEY_PREFIX = 'studio-config-test';
const RAW_KEY = `${KEY_PREFIX}:raw`;
const OTHER_KEY = `${KEY_PREFIX}:other`;

function cleanup(): void {
  db.prepare(`DELETE FROM studio_config WHERE key LIKE ? OR key = 'booking_url'`)
    .run(`${KEY_PREFIX}:%`);
}

function configRow(key: string): {
  key: string;
  value: string;
  updated_at: string;
} | undefined {
  return db.prepare(`
    SELECT key, value, updated_at
    FROM studio_config
    WHERE key = ?
  `).get(key) as {
    key: string;
    value: string;
    updated_at: string;
  } | undefined;
}

beforeEach(cleanup);
afterEach(cleanup);

describe('studio-config', () => {
  it('returns null for missing keys', () => {
    expect(getStudioConfig(RAW_KEY)).toBeNull();
    expect(getBookingUrl()).toBeNull();
  });

  it('sets and updates raw studio config values', () => {
    setStudioConfig(RAW_KEY, 'first value');
    expect(getStudioConfig(RAW_KEY)).toBe('first value');
    expect(configRow(RAW_KEY)).toMatchObject({
      key: RAW_KEY,
      value: 'first value',
    });
    expect(configRow(RAW_KEY)?.updated_at).toEqual(expect.any(String));

    setStudioConfig(RAW_KEY, 'updated value');
    expect(getStudioConfig(RAW_KEY)).toBe('updated value');
    expect(configRow(RAW_KEY)).toMatchObject({
      key: RAW_KEY,
      value: 'updated value',
    });
  });

  it('deletes only the requested raw key', () => {
    setStudioConfig(RAW_KEY, 'delete me');
    setStudioConfig(OTHER_KEY, 'keep me');

    deleteStudioConfig(RAW_KEY);
    expect(getStudioConfig(RAW_KEY)).toBeNull();
    expect(getStudioConfig(OTHER_KEY)).toBe('keep me');

    deleteStudioConfig(RAW_KEY);
    expect(getStudioConfig(RAW_KEY)).toBeNull();
  });

  it('wraps booking URL access through typed helpers', () => {
    setBookingUrl('https://cal.example.com/team');
    expect(getBookingUrl()).toBe('https://cal.example.com/team');
    expect(getStudioConfig('booking_url')).toBe('https://cal.example.com/team');

    setBookingUrl('https://cal.example.com/updated');
    expect(getBookingUrl()).toBe('https://cal.example.com/updated');

    clearBookingUrl();
    expect(getBookingUrl()).toBeNull();
  });
});
