import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('case-insensitive page path matching in admin-chat-context and helpers', () => {
  const adminChatContextPath = path.join(process.cwd(), 'server/admin-chat-context.ts');
  const helpersPath = path.join(process.cwd(), 'server/helpers.ts');
  const adminChatSrc = readFileSync(adminChatContextPath, 'utf-8');
  const helpersSrc = readFileSync(helpersPath, 'utf-8');

  describe('admin-chat-context.ts pageMap find (strategy keyword lookup)', () => {
    it('uses .toLowerCase() on pagePath in primary pageMap find()', () => {
      expect(adminChatSrc).toMatch(/pagePath\.toLowerCase\(\)\s*===\s*normalizedPath\.toLowerCase\(\)/);
    });

    it('uses .toLowerCase() in the fallback endsWith() checks too', () => {
      expect(adminChatSrc).toMatch(/normalizedPath\.toLowerCase\(\)\.endsWith\(p\.pagePath\.toLowerCase\(\)\)/);
    });

    it('no longer has bare === comparison without toLowerCase', () => {
      expect(adminChatSrc).not.toMatch(/p\.pagePath\s*===\s*normalizedPath[^.]/);
    });
  });

  describe('admin-chat-context.ts page slug matching (page context lookup)', () => {
    it('uses .toLowerCase() on pSlug in equality comparison', () => {
      expect(adminChatSrc).toMatch(/pSlug\.toLowerCase\(\)\s*===\s*targetSlug\.toLowerCase\(\)/);
    });

    it('uses .toLowerCase() in the fallback template string comparison', () => {
      expect(adminChatSrc).toMatch(/pSlug\.toLowerCase\(\)\s*===\s*`\$\{targetSlug\}\/`\.toLowerCase\(\)/);
    });

    it('uses .toLowerCase() in the endsWith() check', () => {
      expect(adminChatSrc).toMatch(/targetSlug\.toLowerCase\(\)\.endsWith\(pSlug\.toLowerCase\(\)\)/);
    });
  });

  describe('helpers.ts findPageMapEntry function', () => {
    it('uses .toLowerCase() on normalized path', () => {
      expect(helpersSrc).toMatch(/const norm = normalizePath\(path\)\.toLowerCase\(\)/);
    });

    it('uses .toLowerCase() in the find() check', () => {
      expect(helpersSrc).toMatch(/normalizePath\(p\.pagePath\)\.toLowerCase\(\)\s*===\s*norm/);
    });

    it('has case-insensitive in the comment', () => {
      expect(helpersSrc).toMatch(/Find a pageMap entry by path.*case-insensitive/i);
    });
  });
});
