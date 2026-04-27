#!/usr/bin/env tsx
/**
 * scripts/codemods/phase5-icons.ts
 *
 * Phase 5 Task 1.2 — Icon migration scanner.
 *
 * Reports candidate sites where hand-rolled Lucide usages can migrate to
 * <Icon as={...} size="..." />. Default and only supported mode is
 * --dry-run; the --write path is intentionally disabled because applying
 * rewrites requires per-file import injection (relative path computation,
 * existing-import detection, ordering) which is out of scope for the
 * scaffold. Phase 2's migration work owns the rewrite pass.
 */
import fs from 'fs';
import { globSync } from 'glob';

// Tailwind size classes → Icon enum
const SIZE_CLASS_TO_ENUM: Record<string, string> = {
  'w-2 h-2': 'xs',
  'w-3 h-3': 'sm',
  'w-4 h-4': 'md',
  'w-5 h-5': 'lg',
  'w-6 h-6': 'xl',
  'w-8 h-8': '2xl',
};

// Lucide-style numeric size prop → Icon enum
const NUMERIC_SIZE_TO_ENUM: Record<string, string> = {
  '8': 'xs',
  '12': 'sm',
  '16': 'md',
  '20': 'lg',
  '24': 'xl',
  '32': '2xl',
};

// Exception list: do not rewrite Lucide icons passed as props to other primitives
const EXCEPTION_PATTERNS = [
  /<EmptyState\s[^>]*icon=/,
  /<Button\s[^>]*icon=/,
  /<IconButton\s[^>]*icon=/,
  /<NextStepsCard\s[^>]*icon=/,
];

const args = process.argv.slice(2);
if (args.includes('--write')) {
  console.error('error: --write is not supported.');
  console.error('  Applying rewrites requires injecting `import { Icon }`');
  console.error('  with a relative path computed per file, which this');
  console.error('  scaffold does not implement. Use the dry-run report');
  console.error('  as a manual checklist or extend the codemod with');
  console.error('  per-file import injection before enabling --write.');
  process.exit(1);
}

interface FileMatch {
  file: string;
  classMatches: number;
  numericMatches: number;
  skippedMatches: number; // matches excluded by match-level exception filter
}

const fileMatches: FileMatch[] = [];
let totalMatches = 0;

/**
 * Extract the set of identifiers imported from `lucide-react` in a file.
 * Pattern 2 (numeric `size={N}` prop) only matches against this set so we
 * don't transform unrelated components like <Avatar size={32} />.
 */
function extractLucideImports(content: string): Set<string> {
  const set = new Set<string>();
  const importRe =
    /import\s*(?:type\s+)?\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    for (const name of m[1].split(',')) {
      const id = name.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (id) set.add(id);
    }
  }
  return set;
}

/**
 * Returns the line of `content` that contains `index`. Used for match-level
 * exception filtering — a file with `<EmptyState icon={Clock} />` on one line
 * should not cause unrelated direct-render icons elsewhere in the same file to
 * be skipped (Gate 3 fix from phase-2-kickoff.md §1).
 */
function lineContaining(content: string, index: number): string {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1;
  const newlineIdx = content.indexOf('\n', index);
  const lineEnd = newlineIdx === -1 ? content.length : newlineIdx;
  return content.slice(lineStart, lineEnd);
}

function isMatchInExceptionContext(content: string, matchIndex: number): boolean {
  const line = lineContaining(content, matchIndex);
  return EXCEPTION_PATTERNS.some((pattern) => pattern.test(line));
}

const files = globSync('src/**/*.tsx', { ignore: 'node_modules/**' });

for (const file of files) {
  // Skip the Icon primitive itself
  if (file.endsWith('src/components/ui/Icon.tsx')) continue;

  const content = fs.readFileSync(file, 'utf-8');

  // Pattern 1 — <X className="...w-N h-N..." /> with size classes appearing
  // ANYWHERE in the className (Gate 3 fix: the previous regex required w-N h-N
  // to be the first tokens, missing real-world cases like
  // `<X className="text-zinc-400 w-4 h-4" />`).
  const jsxSelfClosingPattern = /<(\w+)\s+className\s*=\s*"([^"]*)"\s*\/>/g;
  let classCount = 0;
  let skippedCount = 0;
  let m: RegExpExecArray | null;
  while ((m = jsxSelfClosingPattern.exec(content)) !== null) {
    const className = m[2];
    // Find any w-N h-N pair where N matches (adjacent or with other classes
    // between them). Tailwind auto-sorts but human-written code may not.
    const sizeMatch = className.match(/\bw-([2-8])\b[^"]*\bh-\1\b/) ??
                      className.match(/\bh-([2-8])\b[^"]*\bw-\1\b/);
    if (!sizeMatch) continue;
    const sizeKey = `w-${sizeMatch[1]} h-${sizeMatch[1]}`;
    if (!SIZE_CLASS_TO_ENUM[sizeKey]) continue;
    if (isMatchInExceptionContext(content, m.index)) {
      skippedCount++;
    } else {
      classCount++;
    }
  }

  // Pattern 2 — Lucide-style numeric size: <Icon size={N} /> — narrowed
  // to only match identifiers actually imported from lucide-react. This
  // avoids transforming unrelated components like <Avatar size={32} />.
  const lucideNames = extractLucideImports(content);
  const numericPattern = /<(\w+)\s+size\s*=\s*\{?(\d+)\}?\s*\/>/g;
  let numericCount = 0;
  while ((m = numericPattern.exec(content)) !== null) {
    const componentName = m[1];
    const numericSize = m[2];
    if (
      lucideNames.has(componentName) &&
      NUMERIC_SIZE_TO_ENUM[numericSize] !== undefined
    ) {
      if (isMatchInExceptionContext(content, m.index)) {
        skippedCount++;
      } else {
        numericCount++;
      }
    }
  }

  if (classCount + numericCount + skippedCount === 0) continue;

  fileMatches.push({
    file,
    classMatches: classCount,
    numericMatches: numericCount,
    skippedMatches: skippedCount,
  });

  totalMatches += classCount + numericCount;
}

// ── Report ────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════');
console.log('Phase 5 Icons Codemod (dry-run)');
console.log('══════════════════════════════════════════════════════\n');

const sorted = fileMatches.sort(
  (a, b) =>
    b.classMatches + b.numericMatches - (a.classMatches + a.numericMatches),
);

for (const m of sorted) {
  const total = m.classMatches + m.numericMatches;
  const skip = m.skippedMatches > 0
    ? ` [${m.skippedMatches} skipped in exception context]`
    : '';
  console.log(
    `  ${total.toString().padStart(3)}  ${m.file}` +
      `  (class:${m.classMatches}, numeric:${m.numericMatches})${skip}`,
  );
}

console.log(`\nTotal matches: ${totalMatches}`);
console.log(`Files affected: ${fileMatches.filter((f) => f.classMatches + f.numericMatches > 0).length}`);
console.log('\n(Dry-run only. --write is disabled — see file header for rationale.)\n');
