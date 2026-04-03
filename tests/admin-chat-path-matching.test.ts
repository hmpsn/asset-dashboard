import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('case-insensitive page path matching in admin-chat-context and helpers', () => {
  const adminChatContextPath = path.join(process.cwd(), 'server/admin-chat-context.ts');
  const helpersPath = path.join(process.cwd(), 'server/helpers.ts');
  const adminChatSrc = readFileSync(adminChatContextPath, 'utf-8');
  const helpersSrc = readFileSync(helpersPath, 'utf-8');

  describe('admin-chat-context.ts page slug matching', () => {
    it('uses .toLowerCase() on pSlug in equality comparison', () => {
      expect(adminChatSrc).toMatch(/pSlug\.toLowerCase\(\)\s*===\s*targetSlug\.toLowerCase\(\)/);
    });

    it('uses .toLowerCase() in the fallback template string comparison', () => {
      expect(adminChatSrc).toMatch(/pSlug\.toLowerCase\(\)\s*===\s*`\$\{targetSlug\}\/`\.toLowerCase\(\)/);
    });

    it('uses .toLowerCase() in the endsWith() check', () => {
      expect(adminChatSrc).toMatch(/targetSlug\.toLowerCase\(\)\.endsWith\(pSlug\.toLowerCase\(\)\)/);
    });

    it('no longer has bare === comparison without toLowerCase', () => {
      // This should not match the fixed code pattern
      const fixedPattern = /return\s+pSlug\.toLowerCase\(\)\s*===\s*targetSlug\.toLowerCase\(\)/;
      expect(adminChatSrc).toMatch(fixedPattern);
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
