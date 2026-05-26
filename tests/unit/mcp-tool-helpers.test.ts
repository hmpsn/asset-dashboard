import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: h.getWorkspace,
}));

import {
  buildDashboardUrl,
  mcpError,
  mcpSuccess,
  requireWorkspace,
  zodErrorToMcp,
} from '../../server/mcp/tool-helpers.js';

describe('mcp tool helpers', () => {
  it('builds error/success payloads', () => {
    const err = mcpError('bad');
    expect(err.isError).toBe(true);
    expect(err.content[0]?.text).toBe('bad');

    const ok = mcpSuccess({ ok: true });
    expect(ok.isError).toBeUndefined();
    expect(JSON.parse(ok.content[0]?.text ?? '{}')).toEqual({ ok: true });
  });

  it('requires an existing workspace', () => {
    h.getWorkspace.mockReturnValue({ id: 'ws-1' });
    const exists = requireWorkspace('ws-1');
    expect('id' in exists && exists.id).toBe('ws-1');

    h.getWorkspace.mockReturnValue(undefined);
    const missing = requireWorkspace('ws-missing');
    expect('isError' in missing && missing.isError).toBe(true);
    expect(missing.content[0]?.text).toContain('Workspace not found: ws-missing');
  });

  it('buildDashboardUrl uses public/app URL and trims trailing slashes', () => {
    const prevPublic = process.env.PUBLIC_APP_URL;
    const prevApp = process.env.APP_URL;

    process.env.PUBLIC_APP_URL = 'https://app.example.com///';
    process.env.APP_URL = 'https://fallback.example.com';
    expect(buildDashboardUrl('ws-1', 'content')).toBe('https://app.example.com/ws/ws-1/content');
    expect(buildDashboardUrl('ws-1')).toBe('https://app.example.com/ws/ws-1');

    delete process.env.PUBLIC_APP_URL;
    process.env.APP_URL = 'https://fallback.example.com/';
    expect(buildDashboardUrl('ws-1', 'jobs')).toBe('https://fallback.example.com/ws/ws-1/jobs');

    delete process.env.APP_URL;
    expect(buildDashboardUrl('ws-1', 'jobs')).toBe('/ws/ws-1/jobs');

    if (prevPublic === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = prevPublic;
    if (prevApp === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevApp;
  });

  it('formats zod-style and unknown validation errors', () => {
    const zodLike = zodErrorToMcp({ issues: [{ path: ['a'], message: 'required' }] });
    expect(zodLike.isError).toBe(true);
    expect(zodLike.content[0]?.text).toContain('Validation failed:');
    expect(zodLike.content[0]?.text).toContain('"required"');

    const unknown = zodErrorToMcp('boom');
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]?.text).toBe('Validation failed: boom');
  });
});
