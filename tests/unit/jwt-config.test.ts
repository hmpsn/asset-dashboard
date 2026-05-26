import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('jwt-config', () => {
  it('uses provided JWT_SECRET when set', async () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'my-custom-secret';

    const mod = await import('../../server/jwt-config.js');
    expect(mod.JWT_SECRET).toBe('my-custom-secret');
  });

  it('falls back to dev secret outside production when unset', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;

    const mod = await import('../../server/jwt-config.js');
    expect(mod.JWT_SECRET).toBe('hmpsn-studio-dev-secret-change-in-prod');
  });

  it('throws on import in production when JWT_SECRET is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    await expect(import('../../server/jwt-config.js')).rejects.toThrow(
      'JWT_SECRET environment variable must be set in production',
    );
  });
});
