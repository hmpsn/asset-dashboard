import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
}));

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: h.getWorkspace,
}));

import {
  buildDashboardUrl,
  mcpConflictError,
  mcpInternalError,
  mcpNotFoundError,
  mcpPreconditionError,
  mcpRateLimitedError,
  mcpSuccess,
  mcpValidationError,
  requireWorkspace,
  zodErrorToMcp,
} from '../../server/mcp/tool-helpers.js';

function errorEnvelope(result: ReturnType<typeof mcpValidationError>) {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('mcp tool helpers', () => {
  it('builds branded json_v1 error and success payloads', () => {
    expect(errorEnvelope(mcpValidationError('Invalid input.', {
      field_path: 'limit',
      constraint: 'Must be at most 100.',
    }))).toEqual({
      code: 'validation_failed',
      message: 'Invalid input.',
      retryable: false,
      details: {
        field_path: 'limit',
        constraint: 'Must be at most 100.',
      },
    });
    expect(errorEnvelope(mcpNotFoundError('The workspace was not found.'))).toMatchObject({
      code: 'not_found',
    });
    expect(errorEnvelope(mcpConflictError('The revision changed.'))).toMatchObject({
      code: 'conflict',
      retryable: true,
    });
    expect(errorEnvelope(mcpPreconditionError('Connect a site first.'))).toMatchObject({
      code: 'precondition_failed',
    });
    expect(errorEnvelope(mcpRateLimitedError('Try again later.'))).toMatchObject({
      code: 'rate_limited',
      retryable: true,
    });
    expect(errorEnvelope(mcpInternalError())).toEqual({
      code: 'internal_error',
      message: 'The tool could not complete because of an internal error.',
      retryable: false,
    });

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
    expect(JSON.parse(missing.content[0]?.text ?? '{}')).toEqual({
      code: 'not_found',
      message: 'Workspace not found.',
      retryable: false,
      details: { resource_type: 'workspace' },
    });
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

  it('formats field-addressed zod validation errors', () => {
    const zodLike = zodErrorToMcp({
      issues: [{ path: ['a'], message: 'required', code: 'custom' }],
    } as never);
    expect(zodLike.isError).toBe(true);
    expect(JSON.parse(zodLike.content[0]?.text ?? '{}')).toEqual({
      code: 'validation_failed',
      message: 'Invalid tool input at a: required',
      retryable: false,
      details: {
        field_path: 'a',
        constraint: 'required',
        issue_code: 'custom',
      },
    });
  });
});
