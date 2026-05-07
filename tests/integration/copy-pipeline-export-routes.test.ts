import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

const exportCsv = vi.fn();
const exportCopyDeck = vi.fn();
const exportToWebflow = vi.fn();
const broadcastToWorkspace = vi.fn();
const addActivity = vi.fn();

vi.mock('../../server/copy-export.js', () => ({
  exportCsv: (...args: unknown[]) => exportCsv(...args),
  exportCopyDeck: (...args: unknown[]) => exportCopyDeck(...args),
  exportToWebflow: (...args: unknown[]) => exportToWebflow(...args),
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: (...args: unknown[]) => broadcastToWorkspace(...args),
}));

vi.mock('../../server/activity-log.js', () => ({
  addActivity: (...args: unknown[]) => addActivity(...args),
}));

async function startTestServer(): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const originalAppPassword = process.env.APP_PASSWORD;
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (originalAppPassword === undefined) {
          delete process.env.APP_PASSWORD;
        } else {
          process.env.APP_PASSWORD = originalAppPassword;
        }
        return err ? reject(err) : resolve();
      });
    }),
  };
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<{
  status: number;
  body: unknown;
}> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe('copy pipeline export route', () => {
  let baseUrl = '';
  let stopServer: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    exportCsv.mockReset();
    exportCopyDeck.mockReset();
    exportToWebflow.mockReset();
    broadcastToWorkspace.mockReset();
    addActivity.mockReset();

    exportCsv.mockReturnValue({ csv: 'name\nHome', filename: 'copy-export-test.csv' });
    exportCopyDeck.mockReturnValue({ markdown: '# Copy Deck', filename: 'copy-deck-test.md' });
    exportToWebflow.mockResolvedValue({ success: false, format: 'webflow_cms', error: 'Not connected' });

    const server = await startTestServer();
    baseUrl = server.baseUrl;
    stopServer = server.stop;
  });

  afterEach(async () => {
    await stopServer?.();
    stopServer = null;
  });

  it('rejects selected exports without entryIds before dispatching export work', async () => {
    const { status, body } = await postJson(baseUrl, '/api/copy/ws_export/bp_export/export', {
      format: 'csv',
      scope: 'selected',
    });

    expect(status).toBe(400);
    expect(body).toHaveProperty('error');
    expect(exportCsv).not.toHaveBeenCalled();
  });

  it('dispatches CSV selected exports with entryIds and broadcasts completion', async () => {
    const { status, body } = await postJson(baseUrl, '/api/copy/ws_export/bp_export/export', {
      format: 'csv',
      scope: 'selected',
      entryIds: ['entry_a', 'entry_b'],
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      format: 'csv',
      filename: 'copy-export-test.csv',
      content: 'name\nHome',
    });
    expect(exportCsv).toHaveBeenCalledWith('ws_export', 'bp_export', ['entry_a', 'entry_b']);
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      'ws_export',
      expect.any(String),
      { format: 'csv', filename: 'copy-export-test.csv' },
    );
    expect(addActivity).toHaveBeenCalledWith(
      'ws_export',
      'copy_exported',
      'Exported copy as CSV: copy-export-test.csv',
    );
  });

  it('dispatches single copy deck exports with the single entry id', async () => {
    const { status, body } = await postJson(baseUrl, '/api/copy/ws_export/bp_export/export', {
      format: 'copy_deck',
      scope: 'single',
      entryId: 'entry_single',
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      format: 'copy_deck',
      filename: 'copy-deck-test.md',
      content: '# Copy Deck',
    });
    expect(exportCopyDeck).toHaveBeenCalledWith('ws_export', 'bp_export', ['entry_single']);
  });

  it('dispatches Webflow CMS exports with resolved selected ids', async () => {
    const { status, body } = await postJson(baseUrl, '/api/copy/ws_export/bp_export/export', {
      format: 'webflow_cms',
      scope: 'selected',
      entryIds: ['entry_a'],
      webflowSiteId: 'site_123',
    });

    expect(status).toBe(200);
    expect(body).toEqual({ success: false, format: 'webflow_cms', error: 'Not connected' });
    expect(exportToWebflow).toHaveBeenCalledWith('ws_export', 'bp_export', ['entry_a'], 'site_123');
  });
});
