import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import http from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { getUploadRoot } from '../../server/data-dir.js';

const nativeFetch = globalThis.fetch;
const originalAppPassword = process.env.APP_PASSWORD;

let server: http.Server | undefined;
let baseUrl = '';

const createdWorkspaces: Array<{ id: string; folder: string }> = [];

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function api(pathname: string, opts?: RequestInit): Promise<Response> {
  return nativeFetch(`${baseUrl}${pathname}`, opts);
}

function brandDocsDir(folder: string): string {
  return path.join(getUploadRoot(), folder, 'brand-docs');
}

beforeAll(async () => {
  await startTestServer();
}, 30_000);

afterEach(() => {
  for (const ws of createdWorkspaces) {
    deleteWorkspace(ws.id);
    fs.rmSync(path.join(getUploadRoot(), ws.folder), { recursive: true, force: true });
  }
  createdWorkspaces.length = 0;
});

afterAll(async () => {
  await stopTestServer();
  if (originalAppPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = originalAppPassword;
});

describe('brand-docs routes', () => {
  it('GET /api/brand-docs/:workspaceId returns 404 for unknown workspace', async () => {
    const res = await api('/api/brand-docs/ws-does-not-exist');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Workspace not found' });
  });

  it('POST /api/brand-docs/:workspaceId returns 400 when no files uploaded', async () => {
    const ws = createWorkspace('Brand Docs Empty Upload', 'wf-site-brand-docs-empty', 'Brand Docs Empty');
    createdWorkspaces.push({ id: ws.id, folder: ws.folder });

    const res = await api(`/api/brand-docs/${ws.id}`, { method: 'POST' });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'No files uploaded' });
  });

  it('POST /api/brand-docs/:workspaceId uploads only .txt/.md and GET lists saved files', async () => {
    const ws = createWorkspace('Brand Docs Upload', 'wf-site-brand-docs', 'Brand Docs Site');
    createdWorkspaces.push({ id: ws.id, folder: ws.folder });

    const boundary = '----codex-brand-docs-boundary';
    const multipartBody =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="files"; filename="voice-guide.txt"\r\n' +
      'Content-Type: text/plain\r\n\r\n' +
      'Voice & tone guidance\r\n' +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="files"; filename="positioning.md"\r\n' +
      'Content-Type: text/markdown\r\n\r\n' +
      '# Positioning\nKey differentiators\r\n' +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="files"; filename="logo.png"\r\n' +
      'Content-Type: image/png\r\n\r\n' +
      'not allowed\r\n' +
      `--${boundary}--\r\n`;

    const upload = await api(`/api/brand-docs/${ws.id}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: multipartBody,
    });

    expect(upload.status).toBe(200);
    const uploadBody = await upload.json();
    expect(uploadBody).toMatchObject({
      uploaded: ['voice-guide.txt', 'positioning.md'],
      files: [
        { name: 'positioning.md' },
        { name: 'voice-guide.txt' },
      ],
    });

    const docsDir = brandDocsDir(ws.folder);
    expect(fs.existsSync(path.join(docsDir, 'voice-guide.txt'))).toBe(true);
    expect(fs.existsSync(path.join(docsDir, 'positioning.md'))).toBe(true);
    expect(fs.existsSync(path.join(docsDir, 'logo.png'))).toBe(false);

    const listed = await api(`/api/brand-docs/${ws.id}`);
    expect(listed.status).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.files).toHaveLength(2);
    expect(listedBody.files.map((f: { name: string }) => f.name)).toEqual(['positioning.md', 'voice-guide.txt']);
  });

  it('DELETE /api/brand-docs/:workspaceId/:fileName deletes an existing file', async () => {
    const ws = createWorkspace('Brand Docs Delete', 'wf-site-brand-docs-delete', 'Brand Docs Delete Site');
    createdWorkspaces.push({ id: ws.id, folder: ws.folder });

    const docsDir = brandDocsDir(ws.folder);
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'playbook.txt'), 'Delete me');

    const res = await api(`/api/brand-docs/${ws.id}/playbook.txt`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: 'playbook.txt' });

    expect(fs.existsSync(path.join(docsDir, 'playbook.txt'))).toBe(false);
  });

  it('DELETE /api/brand-docs/:workspaceId/:fileName returns 404 when file is missing', async () => {
    const ws = createWorkspace('Brand Docs Missing Delete', 'wf-site-brand-docs-missing', 'Brand Docs Missing Site');
    createdWorkspaces.push({ id: ws.id, folder: ws.folder });

    const res = await api(`/api/brand-docs/${ws.id}/missing.txt`, { method: 'DELETE' });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'File not found' });
  });
});
