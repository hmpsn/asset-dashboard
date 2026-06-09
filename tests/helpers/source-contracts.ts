import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '../..');

export function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf-8'); // readFile-ok — centralized source-contract helper for static wiring guard tests.
}

export function boundedSection(src: string, start: string, boundaryMarkers: string[]): string {
  const startIdx = src.indexOf(start);
  if (startIdx === -1) {
    throw new Error(`boundedSection: start marker not found: ${start}`);
  }

  const after = startIdx + start.length;
  let end = src.length;
  for (const marker of boundaryMarkers) {
    const idx = src.indexOf(marker, after);
    if (idx !== -1 && idx < end) {
      end = idx;
    }
  }

  return src.slice(startIdx, end);
}

export function expectContainsAll(src: string, expected: readonly string[]): void {
  for (const text of expected) {
    expect(src).toContain(text);
  }
}

export function expectOmitsAll(src: string, disallowed: readonly string[]): void {
  for (const text of disallowed) {
    expect(src).not.toContain(text);
  }
}
