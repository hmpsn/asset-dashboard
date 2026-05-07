import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function readServerFiles(dir = 'server'): { path: string; content: string }[] {
  const results: { path: string; content: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...readServerFiles(full));
    } else if (full.endsWith('.ts')) {
      results.push({ path: full, content: readFileSync(full, 'utf-8') });
    }
  }
  return results;
}

describe('bridge pairing', () => {
  it('production server files do not import the retired seo-context module', () => {
    const files = readServerFiles();
    const offenders: string[] = [];
    for (const { path, content } of files) {
      if (/(?:from\s+['"][^'"]*seo-context(?:\.js)?['"]|import\s*\(\s*['"][^'"]*seo-context(?:\.js)?['"])/.test(content)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
