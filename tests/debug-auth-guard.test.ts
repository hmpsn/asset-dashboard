import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('debug intelligence endpoint auth guard', () => {
  const src = readFileSync('server/routes/debug.ts', 'utf-8');

  it('imports getWorkspace', () => {
    expect(src).toMatch(/import.*getWorkspace.*from/);
  });

  it('calls getWorkspace with the workspaceId query param', () => {
    expect(src).toMatch(/getWorkspace\s*\(\s*workspaceId\s*\)/);
  });

  it('returns 404 when workspace not found', () => {
    expect(src).toMatch(/Workspace not found/);
    expect(src).toMatch(/\.status\s*\(\s*404\s*\)/);
  });
});
