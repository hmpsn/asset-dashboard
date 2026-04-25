/**
 * Codemod hardening regression tests (Gate 3 of Phase 2 kickoff).
 *
 * Each codemod fix described in docs/superpowers/plans/2026-04-24-phase-2-kickoff.md
 * §1 Gate 3 has a dedicated fixture here. Fixtures are small inline .tsx-ish
 * strings crafted to trigger the specific bug each fix addresses. The test
 * boots the codemod logic (via a helper that mirrors the script's internals)
 * and asserts the expected match counts.
 *
 * Purpose: a "migration-count diff test" per the kickoff doc — catches
 * regressions where a codemod refactor accidentally narrows match detection
 * and silently under-reports migration candidates to Phase 2 workers.
 */

import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────
// Phase5 Icons — Pattern 1: classes anywhere in className
// Previously required w-N h-N to be the first tokens. Real-world code
// frequently writes them later: `text-zinc-400 w-4 h-4`.
// ─────────────────────────────────────────────────────────────────────────

const SIZE_CLASS_TO_ENUM: Record<string, string> = {
  'w-2 h-2': 'xs',
  'w-3 h-3': 'sm',
  'w-4 h-4': 'md',
  'w-5 h-5': 'lg',
  'w-6 h-6': 'xl',
  'w-8 h-8': '2xl',
};

const EXCEPTION_PATTERNS = [
  /<EmptyState\s[^>]*icon=/,
  /<Button\s[^>]*icon=/,
  /<IconButton\s[^>]*icon=/,
  /<NextStepsCard\s[^>]*icon=/,
];

function lineContaining(content: string, index: number): string {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  const newlineIdx = content.indexOf('\n', index);
  const lineEnd = newlineIdx === -1 ? content.length : newlineIdx;
  return content.slice(lineStart, lineEnd);
}

function isInExceptionContext(content: string, matchIndex: number): boolean {
  const line = lineContaining(content, matchIndex);
  return EXCEPTION_PATTERNS.some((pattern) => pattern.test(line));
}

/** Mirrors the Pattern 1 + exception logic from scripts/codemods/phase5-icons.ts. */
function countIconClassMatches(content: string): { counted: number; skipped: number } {
  const jsxSelfClosingPattern = /<(\w+)\s+className\s*=\s*"([^"]*)"\s*\/>/g;
  let counted = 0;
  let skipped = 0;
  let m: RegExpExecArray | null;
  while ((m = jsxSelfClosingPattern.exec(content)) !== null) {
    const className = m[2];
    const sizeMatch =
      className.match(/\bw-([2-8])\b[^"]*\bh-\1\b/) ??
      className.match(/\bh-([2-8])\b[^"]*\bw-\1\b/);
    if (!sizeMatch) continue;
    const sizeKey = `w-${sizeMatch[1]} h-${sizeMatch[1]}`;
    if (!SIZE_CLASS_TO_ENUM[sizeKey]) continue;
    if (isInExceptionContext(content, m.index)) skipped++;
    else counted++;
  }
  return { counted, skipped };
}

describe('phase5-icons Pattern 1 — size classes anywhere in className', () => {
  it('matches when w-N h-N are the first classes (baseline behavior)', () => {
    const src = `<TrendingUp className="w-4 h-4" />`;
    expect(countIconClassMatches(src).counted).toBe(1);
  });

  it('matches when w-N h-N appear AFTER other classes (Gate 3 bug fix)', () => {
    const src = `<X className="text-zinc-400 w-4 h-4" />`;
    expect(countIconClassMatches(src).counted).toBe(1);
  });

  it('matches when w-N h-N are sandwiched between other classes', () => {
    const src = `<X className="shrink-0 w-4 h-4 ml-2 text-emerald-400" />`;
    expect(countIconClassMatches(src).counted).toBe(1);
  });

  it('matches when h-N precedes w-N (reverse order)', () => {
    const src = `<X className="text-zinc-400 h-4 w-4" />`;
    expect(countIconClassMatches(src).counted).toBe(1);
  });

  it('does NOT match mismatched w-N and h-M', () => {
    const src = `<X className="w-4 h-3" />`;
    expect(countIconClassMatches(src).counted).toBe(0);
  });

  it('does NOT match className without both w-N and h-N', () => {
    const src = `<X className="w-4 text-red-500" />`;
    expect(countIconClassMatches(src).counted).toBe(0);
  });
});

describe('phase5-icons exception filter — match-level, not file-level (Gate 3 bug fix)', () => {
  it('skips icon passed as prop via <EmptyState icon={X} />', () => {
    const src = `<EmptyState icon={Clock} />`;
    expect(countIconClassMatches(src).counted).toBe(0);
  });

  it('does NOT exclude OTHER direct-render icons in a file that also has <EmptyState icon={...} />', () => {
    // This is the bug: previously the entire file was excluded if ANY line
    // contained an exception pattern. With match-level filtering, only the
    // exception line itself is excluded — the 20 direct-render icons below
    // remain countable.
    const src = [
      `<EmptyState icon={Clock} />`,
      `<TrendingUp className="w-3 h-3" />`,
      `<TrendingDown className="w-3 h-3" />`,
      `<ArrowUp className="w-4 h-4 text-emerald-400" />`,
    ].join('\n');
    const result = countIconClassMatches(src);
    expect(result.counted).toBe(3);
    expect(result.skipped).toBe(0);
  });

  it('counts skipped matches when an icon IS directly inside an exception line', () => {
    // A hand-rolled icon inside an <EmptyState icon={...}> prop line should
    // still be detected and reported as skipped. This shape is rare in real
    // code (icon is usually a bare identifier) but worth covering.
    const src = `<EmptyState icon={<Clock className="w-4 h-4" />} />`;
    const result = countIconClassMatches(src);
    expect(result.counted).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase5 Layout — token-set matching (Gate 3 bug fix)
// Previously required exact className substring. Real-world code often
// appends additional classes: `flex items-center gap-2 justify-between`.
// ─────────────────────────────────────────────────────────────────────────

interface LayoutPattern {
  name: string;
  tokens: string[];
}

const LAYOUT_PATTERNS: LayoutPattern[] = [
  { name: 'Row gap="sm"',   tokens: ['flex', 'items-center', 'gap-2'] },
  { name: 'Row gap="md"',   tokens: ['flex', 'items-center', 'gap-3'] },
  { name: 'Stack gap="md"', tokens: ['flex', 'flex-col', 'gap-3'] },
  { name: 'Stack gap="lg"', tokens: ['flex', 'flex-col', 'gap-4'] },
];

function lineMatchesTokens(line: string, required: string[]): boolean {
  const classRe = /className\s*=\s*"([^"]*)"/g;
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(line)) !== null) {
    const tokens = new Set(cm[1].split(/\s+/).filter(Boolean));
    if (required.every((t) => tokens.has(t))) return true;
  }
  return false;
}

function countLayoutMatches(content: string, patternName: string): number {
  const pattern = LAYOUT_PATTERNS.find((p) => p.name === patternName);
  if (!pattern) throw new Error(`unknown pattern: ${patternName}`);
  const lines = content.split('\n');
  let count = 0;
  for (const line of lines) {
    if (lineMatchesTokens(line, pattern.tokens)) count++;
  }
  return count;
}

describe('phase5-layout token-set matching (Gate 3 bug fix)', () => {
  it('matches the minimal className (baseline behavior)', () => {
    const src = `<div className="flex items-center gap-2">`;
    expect(countLayoutMatches(src, 'Row gap="sm"')).toBe(1);
  });

  it('matches with additional trailing classes (the Gate 3 bug)', () => {
    const src = `<div className="flex items-center gap-2 justify-between">`;
    expect(countLayoutMatches(src, 'Row gap="sm"')).toBe(1);
  });

  it('matches with additional leading classes', () => {
    const src = `<div className="w-full flex items-center gap-2">`;
    expect(countLayoutMatches(src, 'Row gap="sm"')).toBe(1);
  });

  it('matches regardless of token order', () => {
    const src = `<div className="gap-2 flex items-center">`;
    expect(countLayoutMatches(src, 'Row gap="sm"')).toBe(1);
  });

  it('does NOT match when a required token is missing', () => {
    const src = `<div className="flex gap-2 justify-between">`; // no items-center
    expect(countLayoutMatches(src, 'Row gap="sm"')).toBe(0);
  });

  it('distinguishes Row gap sizes correctly', () => {
    const src = [
      `<div className="flex items-center gap-2">`, // sm
      `<div className="flex items-center gap-3">`, // md
    ].join('\n');
    expect(countLayoutMatches(src, 'Row gap="sm"')).toBe(1);
    expect(countLayoutMatches(src, 'Row gap="md"')).toBe(1);
  });

  it('Stack patterns require flex-col (not just flex)', () => {
    // `flex items-center gap-3` is Row, not Stack — Stack must have flex-col.
    const src = `<div className="flex items-center gap-3">`;
    expect(countLayoutMatches(src, 'Stack gap="md"')).toBe(0);
    expect(countLayoutMatches(src, 'Row gap="md"')).toBe(1);
  });
});
