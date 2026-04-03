import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('admin-chat-context case-insensitive pageMap lookup', () => {
  const src = readFileSync('server/admin-chat-context.ts', 'utf-8');

  it('uses .toLowerCase() on pagePath in primary pageMap find()', () => {
    expect(src).toMatch(/pagePath\.toLowerCase\(\)\s*===\s*normalizedPath\.toLowerCase\(\)/);
  });

  it('uses .toLowerCase() in the fallback endsWith() checks too', () => {
    expect(src).toMatch(/normalizedPath\.toLowerCase\(\)\.endsWith\(p\.pagePath\.toLowerCase\(\)\)/);
  });

  it('no longer has bare === comparison without toLowerCase', () => {
    expect(src).not.toMatch(/p\.pagePath\s*===\s*normalizedPath[^.]/);
  });
});
