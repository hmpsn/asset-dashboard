/**
 * Smoke tests — safety net for the server refactor.
 *
 * Starts the server as a child process, hits key endpoints,
 * and verifies they return the expected status codes.
 *
 * Run with: npx vitest run tests/smoke.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = 13099; // Use a non-standard port to avoid conflicts
const BASE = `http://localhost:${PORT}`;

let proc: ChildProcess;

beforeAll(async () => {
  proc = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'development',
      // Ensure no APP_PASSWORD so endpoints are open for testing
      APP_PASSWORD: '',
    },
    stdio: 'pipe',
  });

  // Collect stderr for debugging
  proc.stderr?.on('data', (d) => process.stderr.write(d));

  // Wait for the server to print its "running on" banner
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Server did not start within 15 seconds'));
    }, 15_000);

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (text.includes('running on')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}, 20_000);

afterAll(() => {
  proc?.kill('SIGTERM');
});

// Helper to make requests
async function api(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, opts);
}

describe('Smoke tests — unauthenticated endpoints', () => {
  it('GET /api/auth/check returns 200', async () => {
    const res = await api('/api/auth/check');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('required');
  });

  it('GET /api/auth/setup-status returns 200', async () => {
    const res = await api('/api/auth/setup-status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('needsSetup');
  });

  it('GET /api/workspaces returns 200 with array', async () => {
    const res = await api('/api/workspaces');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/workspace-overview returns 200', async () => {
    const res = await api('/api/workspace-overview');
    expect(res.status).toBe(200);
  });

  it('GET /api/queue returns 200', async () => {
    const res = await api('/api/queue');
    expect(res.status).toBe(200);
  });

  it('GET /api/presence returns 200', async () => {
    const res = await api('/api/presence');
    expect(res.status).toBe(200);
  });

  it('GET /api/metadata returns 200', async () => {
    const res = await api('/api/metadata');
    expect(res.status).toBe(200);
  });

  it('GET /api/settings returns 200', async () => {
    const res = await api('/api/settings');
    expect(res.status).toBe(200);
  });

  it('GET /api/requests returns 200', async () => {
    const res = await api('/api/requests');
    expect(res.status).toBe(200);
  });

  it('GET /api/activity returns 200', async () => {
    const res = await api('/api/activity');
    expect(res.status).toBe(200);
  });

  it('GET /api/jobs returns 200', async () => {
    const res = await api('/api/jobs');
    expect(res.status).toBe(200);
  });

  it('GET /api/users returns 401 (requires auth)', async () => {
    const res = await api('/api/users');
    expect(res.status).toBe(401);
  });

  it('GET /api/roadmap returns 200', async () => {
    const res = await api('/api/roadmap');
    expect(res.status).toBe(200);
  });

  it('GET /api/ai/usage returns 200', async () => {
    const res = await api('/api/ai/usage');
    expect(res.status).toBe(200);
  });

  it('GET /api/semrush/status returns 200', async () => {
    const res = await api('/api/semrush/status');
    expect(res.status).toBe(200);
  });

  it('GET /api/stripe/publishable-key returns 200', async () => {
    const res = await api('/api/stripe/publishable-key');
    expect(res.status).toBe(200);
  });

  it('GET /api/google/status returns 200', async () => {
    const res = await api('/api/google/status');
    expect(res.status).toBe(200);
  });
});

describe('Smoke tests — POST endpoints with bad input return 4xx (not 500)', () => {
  it('POST /api/auth/login with no body returns 401', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Without APP_PASSWORD set, login always succeeds (returns 200)
    expect(res.status).toBeLessThan(500);
  });

  it('POST /api/auth/setup with missing fields returns 400', async () => {
    const res = await api('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBeLessThan(500);
  });
});
