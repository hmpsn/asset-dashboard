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
  it('every clearSeoContextCache call is paired with invalidateIntelligenceCache', () => {
    const files = readServerFiles();
    const unpaired: string[] = [];
    for (const { path, content } of files) {
      // Skip the definition files themselves
      if (path.includes('seo-context.ts') || path.includes('bridge-infrastructure.ts')) continue;
      if (content.includes('clearSeoContextCache') && !content.includes('invalidateIntelligenceCache')) {
        unpaired.push(path);
      }
    }
    expect(unpaired).toEqual([]);
  });
});
