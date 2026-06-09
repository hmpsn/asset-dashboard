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

    expect(isIntegrationTestPortReserved(testFileUrl)).toBe(true);

    await ctx.stopServer();

    expect(isIntegrationTestPortReserved(testFileUrl)).toBe(false);
  });

  it('requires import.meta.url style file URLs for ephemeral contexts', () => {
    expect(() => createEphemeralTestContext('/tmp/example-f.test.ts')).toThrow(
      'createEphemeralTestContext() requires import.meta.url as its first argument',
    );
  });

  it('allows only one ephemeral context per test file id', async () => {
    const testFileUrl = 'file:///tmp/example-g.test.ts';
    const ctx = createEphemeralTestContext(testFileUrl);

    expect(() => createEphemeralTestContext(testFileUrl)).toThrow(
      'Only one createEphemeralTestContext(import.meta.url) is allowed per test file',
    );

    await ctx.stopServer();
  });
});
