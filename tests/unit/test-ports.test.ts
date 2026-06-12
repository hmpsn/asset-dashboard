import { describe, expect, it } from 'vitest';

import { createEphemeralTestContext } from '../integration/helpers.js';
import {
  isIntegrationTestPortReserved,
  releaseIntegrationTestPort,
  reserveIntegrationTestPort,
} from '../helpers/ports.js';

describe('reserveIntegrationTestPort', () => {
  it('returns a stable port for the same test id', () => {
    const first = reserveIntegrationTestPort('/tmp/example-a.test.ts');
    const second = reserveIntegrationTestPort('/tmp/example-a.test.ts');

    expect(second).toBe(first);
  });

  it('allocates different ports for different test ids', () => {
    const first = reserveIntegrationTestPort('/tmp/example-b.test.ts');
    const second = reserveIntegrationTestPort('/tmp/example-c.test.ts');

    expect(second).not.toBe(first);
  });

  it('uses the dedicated ephemeral integration port range', () => {
    const port = reserveIntegrationTestPort('/tmp/example-d.test.ts');

    expect(port).toBeGreaterThanOrEqual(14000);
    expect(port).toBeLessThanOrEqual(14999);
  });

  it('releases the reserved port when an ephemeral context stops', async () => {
    const testFileUrl = 'file:///tmp/example-e.test.ts';
    const ctx = createEphemeralTestContext(testFileUrl);

    expect(isIntegrationTestPortReserved('/tmp/example-e.test.ts#default')).toBe(true);

    await ctx.stopServer();

    expect(isIntegrationTestPortReserved('/tmp/example-e.test.ts#default')).toBe(false);
  });

  it('requires import.meta.url style file URLs for ephemeral contexts', () => {
    expect(() => createEphemeralTestContext('/tmp/example-f.test.ts')).toThrow(
      'createEphemeralTestContext() requires import.meta.url as its first argument',
    );
  });

  it('allows only one ephemeral context per test file id and context name', async () => {
    const testFileUrl = 'file:///tmp/example-g.test.ts';
    const ctx = createEphemeralTestContext(testFileUrl);

    expect(() => createEphemeralTestContext(testFileUrl)).toThrow(
      'Only one createEphemeralTestContext(import.meta.url) context named "default" is allowed per test file',
    );

    await ctx.stopServer();
  });

  it('allows multiple named ephemeral contexts for the same test file id', async () => {
    const testFileUrl = 'file:///tmp/example-h.test.ts';
    const main = createEphemeralTestContext(testFileUrl, { contextName: 'main' });
    const authGated = createEphemeralTestContext(testFileUrl, { contextName: 'auth-gated' });

    expect(main.PORT).not.toBe(authGated.PORT);
    expect(isIntegrationTestPortReserved('/tmp/example-h.test.ts#main')).toBe(true);
    expect(isIntegrationTestPortReserved('/tmp/example-h.test.ts#auth-gated')).toBe(true);

    await main.stopServer();
    await authGated.stopServer();

    expect(isIntegrationTestPortReserved('/tmp/example-h.test.ts#main')).toBe(false);
    expect(isIntegrationTestPortReserved('/tmp/example-h.test.ts#auth-gated')).toBe(false);
  });
});
