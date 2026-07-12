import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC_DIR = path.join(ROOT, 'src');
const CSS_ENTRY = path.join(SRC_DIR, 'index.css');

type SelectorCandidateReference = {
  candidate: string;
  matcher: 'exact' | 'substring';
};

const DOCUMENTED_COMPATIBILITY_UTILITIES = new Set([
  'bg-accent-orange-soft',
  'bg-accent-cyan-soft',
  'border-accent-orange-soft',
  'border-accent-cyan-soft',
]);

function cssSection(css: string, startMarker: string, endMarker?: string): string {
  const start = css.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing CSS section marker: ${startMarker}`);
  const end = endMarker ? css.indexOf(endMarker, start + startMarker.length) : css.length;
  if (end < 0) throw new Error(`Missing CSS section marker: ${endMarker}`);
  return css.slice(start, end);
}

function selectorCandidateReferences(css: string): SelectorCandidateReference[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...withoutComments.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(match => match[1]);
  const references: SelectorCandidateReference[] = [];

  for (const selector of selectors) {
    const selectorWithoutAttributes = selector.replace(
      /\[class([~*])=(['"])(.*?)\2\]/g,
      (_match, matcher: '~' | '*', _quote, candidate: string) => {
        references.push({
          candidate: candidate.replaceAll('\\', ''),
          matcher: matcher === '*' ? 'substring' : 'exact',
        });
        return '';
      },
    );

    for (const match of selectorWithoutAttributes.matchAll(/\.((?:\\.|[A-Za-z0-9_/-])+)/g)) {
      references.push({ candidate: match[1].replaceAll('\\', ''), matcher: 'exact' });
    }
  }

  return references;
}

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(absolutePath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
  });
}

describe('Tailwind production source scope', () => {
  it('builds utilities from every app source without scanning repository prose or tests', async () => {
    const sourceCss = readFileSync(CSS_ENTRY, 'utf8');
    const compiled = await compile(sourceCss, {
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

    const scannedCandidates = scanner.scan();
    const output = compiled.build(scannedCandidates);
    expect(output).toContain('.text-emerald-400');
    expect(output).toContain('.hover\\:bg-white\\/5');
    expect(output).toContain('.sm\\:grid-cols-2');
    expect(output).toContain('.rounded-\\[var\\(--radius-lg\\)\\]');

    const runtimeCandidates = new Set(scannedCandidates);
    const legacySelectorCss = [
      cssSection(
        sourceCss,
        '/* ─── D-DIN PRO',
        '/* ─── Typography utilities',
      ),
      cssSection(sourceCss, '/* ─── Client Dashboard Light Theme'),
    ].join('\n');
    const deadSelectorCandidates = selectorCandidateReferences(legacySelectorCss)
      .filter(({ candidate, matcher }) => {
        if (candidate === 'dashboard-light') return false;
        if (DOCUMENTED_COMPATIBILITY_UTILITIES.has(candidate)) return false;
        return matcher === 'substring'
          ? !scannedCandidates.some(runtimeCandidate => runtimeCandidate.includes(candidate))
          : !runtimeCandidates.has(candidate);
      })
      .map(({ candidate }) => candidate)
      .filter((candidate, index, candidates) => candidates.indexOf(candidate) === index)
      .sort();

    expect(deadSelectorCandidates).toEqual([]);
  });
});
