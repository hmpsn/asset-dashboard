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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

export interface TestContext {
  PORT: number;
  BASE: string;
  startServer: () => Promise<void>;
  stopServer: () => void;
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
        NODE_ENV: 'development',
        APP_PASSWORD: '',
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
          clearTimeout(timeout);
          resolve();
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

  function stopServer(): void {
    proc?.kill('SIGTERM');
    proc = null;
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
