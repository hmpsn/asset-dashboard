import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC_DIR = path.join(ROOT, 'src');
const CSS_ENTRY = path.join(SRC_DIR, 'index.css');

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(absolutePath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
  });
}

describe('Tailwind production source scope', () => {
  it('builds utilities from every app source without scanning repository prose or tests', async () => {
    const compiled = await compile(readFileSync(CSS_ENTRY, 'utf8'), {
      base: SRC_DIR,
      from: CSS_ENTRY,
      onDependency: () => undefined,
    });

    expect(compiled.root).toBe('none');

    const scanner = new Scanner({ sources: compiled.sources });
    const scannedFiles = scanner.files.map(file => path.resolve(file)).sort();
    const expectedFiles = [...productionSourceFiles(SRC_DIR), path.join(ROOT, 'index.html')].sort();

    expect(scannedFiles).toEqual(expectedFiles);
    expect(scannedFiles).toContain(path.join(SRC_DIR, 'App.tsx'));
    expect(scannedFiles).toContain(path.join(SRC_DIR, 'components/dev/DsHarness.tsx'));
    expect(scannedFiles.some(file => file.startsWith(path.join(ROOT, 'tests') + path.sep))).toBe(false);
    expect(scannedFiles.some(file => file.startsWith(path.join(ROOT, 'docs') + path.sep))).toBe(false);
    expect(scannedFiles.some(file => file.startsWith(path.join(ROOT, 'public') + path.sep))).toBe(false);

    const output = compiled.build(scanner.scan());
    expect(output).toContain('.text-emerald-400');
    expect(output).toContain('.hover\\:bg-white\\/5');
    expect(output).toContain('.sm\\:grid-cols-2');
    expect(output).toContain('.rounded-\\[var\\(--radius-lg\\)\\]');
  });
});
