import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rootChild: vi.fn(),
  pino: vi.fn(() => ({ child: vi.fn((meta: unknown) => ({ meta })) })),
}));

vi.mock('pino', () => ({
  default: mocks.pino,
}));

describe('logger module', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.VITEST = 'true';
    process.env.NODE_ENV = 'test';
    delete process.env.LOG_LEVEL;
  });

  it('creates pino with test-friendly default level and base metadata', async () => {
    await import('../../server/logger.js');
    expect(mocks.pino).toHaveBeenCalledWith(expect.objectContaining({
      level: 'silent',
      base: { service: 'asset-dashboard' },
    }));
  });

  it('createLogger returns child logger bound with module field', async () => {
    const { createLogger } = await import('../../server/logger.js');
    const child = createLogger('unit-test-module') as { meta: { module: string } };
    expect(child.meta.module).toBe('unit-test-module');
  });
});
