/**
 * Shared test helpers for integration tests.
 *
 * Provides a factory function `createTestContext(port)` that returns
 * isolated server + HTTP helpers per test file, allowing parallel execution
 * on different ports.
 */
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureIsolatedTestDataDir } from '../test-data-dir.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

export interface TestContext {
  PORT: number;
  BASE: string;
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  api: (urlPath: string, opts?: RequestInit) => Promise<Response>;
  postJson: (urlPath: string, body: unknown) => Promise<Response>;
  patchJson: (urlPath: string, body: unknown) => Promise<Response>;
  del: (urlPath: string) => Promise<Response>;
  clearCookies: () => void;
  setAuthToken: (token: string) => void;
  getAuthToken: () => string;
  authApi: (urlPath: string, opts?: RequestInit) => Promise<Response>;
  authPostJson: (urlPath: string, body: unknown) => Promise<Response>;
  authPatchJson: (urlPath: string, body: unknown) => Promise<Response>;
  authDel: (urlPath: string) => Promise<Response>;
}

/**
 * Create an isolated test context bound to a specific port.
 * Each test file should call this with a unique port number.
 */
export function createTestContext(port: number): TestContext {
  const BASE = `http://localhost:${port}`;
  const dataDir = process.env.DATA_DIR ?? ensureIsolatedTestDataDir();
  let proc: ChildProcess | null = null;
  const cookieJar: Record<string, string> = {};
  let authToken = '';

  function parseCookies(res: Response): void {
    const setCookieHeaders = res.headers.getSetCookie?.() || [];
    for (const header of setCookieHeaders) {
      const [nameVal] = header.split(';');
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx > 0) {
        const name = nameVal.slice(0, eqIdx).trim();
        const value = nameVal.slice(eqIdx + 1).trim();
        if (value) {
          cookieJar[name] = value;
        } else {
          delete cookieJar[name];
        }
      }
    }
  }

  function cookieHeader(): string {
    return Object.entries(cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async function startServer(): Promise<void> {
    if (proc) return;

    proc = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        // Use 'test' so the server skips file watchers (chokidar) that exhaust
        // open file descriptor limits when multiple test servers run concurrently.
        NODE_ENV: 'test',
        APP_PASSWORD: '',
        DATA_DIR: dataDir,
        // startServer watches stdout for the "running on" readiness line. The
        // child stdout is not echoed, so this keeps readiness detection working
        // without making Vitest output noisy.
        LOG_LEVEL: 'info',
      },
      stdio: 'pipe',
    });

    proc.stderr?.on('data', (d: Buffer) => process.stderr.write(d));

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server did not start within 20 seconds'));
      }, 20_000);

      proc!.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        if (text.includes('running on')) {
          // Stage 2: confirm routes are serving before resolving.
          // Keep the timeout active across both stages so a health-check hang
          // still triggers the 20-second deadline.
          waitForServer(BASE)
            .then(() => { clearTimeout(timeout); resolve(); })
            .catch(err => { clearTimeout(timeout); reject(err); });
        }
      });

      proc!.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      proc!.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== null && code !== 0) {
          reject(new Error(`Server exited with code ${code}`));
        }
      });
    });
  }

  async function stopServer(): Promise<void> {
    const child = proc;
    proc = null;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) return;

    await stopChildProcess(child);
  }

  function clearCookies(): void {
    for (const key of Object.keys(cookieJar)) {
      delete cookieJar[key];
    }
  }

  async function api(urlPath: string, opts?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...(opts?.headers as Record<string, string> || {}),
    };
    const cookies = cookieHeader();
    if (cookies) {
      headers['Cookie'] = cookies;
    }
    const res = await fetch(`${BASE}${urlPath}`, {
      ...opts,
      headers,
      redirect: 'manual',
    });
    parseCookies(res);
    return res;
  }

  async function postJson(urlPath: string, body: unknown): Promise<Response> {
    return api(urlPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function patchJson(urlPath: string, body: unknown): Promise<Response> {
    return api(urlPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function del(urlPath: string): Promise<Response> {
    return api(urlPath, { method: 'DELETE' });
  }

  function setAuthToken(token: string): void {
    authToken = token;
  }

  function getAuthToken(): string {
    return authToken;
  }

  async function authApi(urlPath: string, opts?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...(opts?.headers as Record<string, string> || {}),
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return api(urlPath, { ...opts, headers });
  }

  async function authPostJson(urlPath: string, body: unknown): Promise<Response> {
    return authApi(urlPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function authPatchJson(urlPath: string, body: unknown): Promise<Response> {
    return authApi(urlPath, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function authDel(urlPath: string): Promise<Response> {
    return authApi(urlPath, { method: 'DELETE' });
  }

  return {
    PORT: port,
    BASE,
    startServer,
    stopServer,
    api,
    postJson,
    patchJson,
    del,
    clearCookies,
    setAuthToken,
    getAuthToken,
    authApi,
    authPostJson,
    authPatchJson,
    authDel,
  };
}

export async function stopChildProcess(child: ChildProcess | null): Promise<void> {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let gracefulTimer: ReturnType<typeof setTimeout> | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (gracefulTimer) clearTimeout(gracefulTimer);
      if (forceTimer) clearTimeout(forceTimer);
      child.off('exit', finish);
      child.off('error', finish);
      resolve();
    };

    child.once('exit', finish);
    child.once('error', finish);
    gracefulTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 5_000);
    forceTimer = setTimeout(finish, 8_000);

    if (!child.kill('SIGTERM')) finish();
  });
}

// ─── Server readiness helper ──────────────────────────────────────────────────

/**
 * Poll GET {base}/api/health until it returns 200.
 *
 * Called by startServer() after the "running on" stdout signal so tests never
 * fire before routes are actively serving. Also exported for test files that
 * need custom retry parameters.
 */
export async function waitForServer(
  base: string,
  options?: { maxRetries?: number; intervalMs?: number },
): Promise<void> {
  const { maxRetries = 15, intervalMs = 200 } = options ?? {};

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.status === 200) return;
    } catch {
      // ECONNREFUSED or other transient error — retry
    }
    if (attempt < maxRetries - 1) {
      await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(
    `Server on ${base} did not become healthy after ${maxRetries} retries`,
  );
}

// ─── Test assertion factories ─────────────────────────────────────────────────
//
// Reusable helpers for asserting correctness properties that cut across many
// integration tests. Import these alongside createTestContext:
//   import { createTestContext, assertWorkspaceIsolation } from './helpers.js';

/**
 * Assert that a GET endpoint only returns data belonging to the requesting workspace.
 *
 * Calls the endpoint with both workspaceIds and verifies:
 * - wsA's response doesn't contain any wsB data (checked via the `extractId` fn)
 * - wsB's response doesn't contain any wsA data
 *
 * Usage:
 *   await assertWorkspaceIsolation({
 *     ctx,
 *     wsA: 'ws_aaaaaaaa',
 *     wsB: 'ws_bbbbbbbb',
 *     endpoint: (wsId) => `/api/voice/${wsId}`,
 *     extractIds: (body) => body.samples.map((s: any) => s.id),
 *     seedAIds: ['vs_sample1'],  // IDs belonging to wsA that must not appear in wsB's response
 *     seedBIds: ['vs_sample2'],  // IDs belonging to wsB
 *   });
 */
export async function assertWorkspaceIsolation(opts: {
  ctx: TestContext;
  wsA: string;
  wsB: string;
  endpoint: (workspaceId: string) => string;
  extractIds: (body: unknown) => string[];
  seedAIds: string[];
  seedBIds: string[];
}): Promise<void> {
  const { ctx, wsA, wsB, endpoint, extractIds, seedAIds, seedBIds } = opts;
  const { expect } = await import('vitest');

  const [resA, resB] = await Promise.all([
    ctx.api(endpoint(wsA)),
    ctx.api(endpoint(wsB)),
  ]);

  expect(resA.status, `${endpoint(wsA)} should return 200`).toBe(200);
  expect(resB.status, `${endpoint(wsB)} should return 200`).toBe(200);

  const bodyA = await resA.json();
  const bodyB = await resB.json();
  const idsFromA = new Set(extractIds(bodyA));
  const idsFromB = new Set(extractIds(bodyB));

  for (const id of seedBIds) {
    expect(idsFromA.has(id), `wsA response must not contain wsB row ${id}`).toBe(false);
  }
  for (const id of seedAIds) {
    expect(idsFromB.has(id), `wsB response must not contain wsA row ${id}`).toBe(false);
  }
}

/**
 * Assert that two concurrent POST requests to a generator endpoint produce
 * exactly one stored row (not duplicates).
 *
 * Fires both requests simultaneously and checks the count function returns 1.
 *
 * Usage:
 *   await assertConcurrentGenerateSafe({
 *     ctx,
 *     endpoint: `/api/voice/${wsId}/calibrate`,
 *     body: { promptType: 'headline' },
 *     countRows: () => db.prepare('SELECT COUNT(*) as n FROM voice_calibration_sessions WHERE voice_profile_id = ?').get(profileId).n,
 *   });
 */
export async function assertConcurrentGenerateSafe(opts: {
  ctx: TestContext;
  endpoint: string;
  body: unknown;
  countRows: () => number;
}): Promise<void> {
  const { ctx, endpoint, body, countRows } = opts;
  const { expect } = await import('vitest');

  const beforeCount = countRows();

  // Fire both requests simultaneously — they race through the AI call window
  const [res1, res2] = await Promise.all([
    ctx.postJson(endpoint, body),
    ctx.postJson(endpoint, body),
  ]);

  // Both should succeed (200 or 201) — the loser should not 500
  expect([200, 201]).toContain(res1.status);
  expect([200, 201]).toContain(res2.status);

  // Exactly one new row should have been written
  const afterCount = countRows();
  expect(afterCount - beforeCount).toBe(1);
}

/**
 * Assert that a second call to an AI-generating endpoint returns 409
 * (already-processed guard) rather than silently duplicating rows.
 *
 * Usage:
 *   await assertIdempotentGenerate({
 *     ctx,
 *     endpoint: `/api/discovery/${wsId}/sources/${srcId}/process`,
 *     body: {},
 *     expectedStatus: 409,
 *   });
 */
export async function assertIdempotentGenerate(opts: {
  ctx: TestContext;
  endpoint: string;
  body?: unknown;
  expectedStatus?: number;
}): Promise<void> {
  const { ctx, endpoint, body = {}, expectedStatus = 409 } = opts;
  const { expect } = await import('vitest');

  // First call should succeed
  const first = await ctx.postJson(endpoint, body);
  expect([200, 201]).toContain(first.status);

  // Second call without force should return expectedStatus (409 by convention)
  const second = await ctx.postJson(endpoint, body);
  expect(second.status, `second call to ${endpoint} should be ${expectedStatus} (not a silent duplicate)`).toBe(expectedStatus);
}
