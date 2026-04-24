import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';

const SIZE_TO_CLASS: Record<string, string> = {
  'w-2 h-2': 'xs',
  'w-3 h-3': 'sm',
  'w-4 h-4': 'md',
  'w-5 h-5': 'lg',
  'w-6 h-6': 'xl',
  'w-8 h-8': '2xl',
};

const CLASS_TO_SIZE: Record<string, string> = {
  xs: 'w-2 h-2',
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
  xl: 'w-6 h-6',
  '2xl': 'w-8 h-8',
};

// Exception list: do not rewrite Lucide icons passed as props to other primitives
const EXCEPTION_PATTERNS = [
  /icon\s*=\s*\{?\w+\}?/, // icon={Clock} or icon=Clock
  /<EmptyState\s[^>]*icon=/,
  /<Button\s[^>]*icon=/,
  /<IconButton\s[^>]*icon=/,
];

const isDryRun = !process.argv.includes('--write');

interface Match {
  file: string;
  pattern: string;
  line: number;
  count: number;
}

const matches: Match[] = [];
let totalMatches = 0;

const files = globSync('src/**/*.tsx', { ignore: 'node_modules/**' });

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  let fileMatches = 0;

  // Pattern 1: <TrendingUp className="w-3 h-3 text-teal-400" /> → <Icon as={TrendingUp} size="sm" className="text-teal-400" />
  const pattern1 = /<(\w+)\s+className\s*=\s*"((?:w-[248]|w-[356])\s+(?:h-[248]|h-[356]))([^"]*)"\s*\/>/g;
  const pattern1Matches = content.match(pattern1) || [];
  fileMatches += pattern1Matches.length;

  // Pattern 2: <Send size={12} /> → <Icon as={Send} size="sm" />
  const pattern2 = /<(\w+)\s+size\s*=\s*\{?(\d+)\}?\s*\/>/g;
  const pattern2Matches = content.match(pattern2) || [];
  fileMatches += pattern2Matches.length;

  // Pattern 3: <X className="w-4 h-4" /> → <Icon as={X} size="md" />
  const pattern3 = /<(\w+)\s+className\s*=\s*"((?:w-[248]|w-[356])\s+(?:h-[248]|h-[356]))"\s*\/>/g;
  const pattern3Matches = content.match(pattern3) || [];
  fileMatches += pattern3Matches.length;

  if (fileMatches > 0) {
    // Check if file contains exception patterns
    const hasException = EXCEPTION_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    matches.push({
      file,
      pattern: hasException
        ? 'SKIP (contains exception patterns)'
        : `${pattern1Matches.length} + ${pattern2Matches.length} + ${pattern3Matches.length}`,
      line: 0,
      count: hasException ? 0 : fileMatches,
    });

    if (!hasException && !isDryRun) {
      // Apply transformations here (not implemented in dry-run mode)
      let transformed = content;

      // Transform pattern 1
      transformed = transformed.replace(pattern1, (match, component, sizeClass, additionalClasses) => {
        const size = SIZE_TO_CLASS[sizeClass] || 'md';
        return `<Icon as={${component}} size="${size}"${additionalClasses ? ` className="${additionalClasses.trim()}"` : ''} />`;
      });

      // Transform pattern 2
      const sizeMap = { 12: 'sm', 16: 'md', 20: 'lg', 24: 'xl', 32: '2xl', 8: 'xs' };
      transformed = transformed.replace(pattern2, (match, component, size) => {
        const mappedSize = (sizeMap as Record<string, string>)[size] || 'md';
        return `<Icon as={${component}} size="${mappedSize}" />`;
      });

      // Transform pattern 3
      transformed = transformed.replace(pattern3, (match, component, sizeClass) => {
        const size = SIZE_TO_CLASS[sizeClass] || 'md';
        return `<Icon as={${component}} size="${size}" />`;
      });

      fs.writeFileSync(file, transformed, 'utf-8');
      totalMatches += fileMatches;
    } else if (!hasException) {
      totalMatches += fileMatches;
    }
  }
}

// Report
console.log('\n══════════════════════════════════════════════════════');
console.log(`Phase 5 Icons Codemod (${isDryRun ? 'dry-run' : 'write'})`);
console.log('══════════════════════════════════════════════════════\n');

matches.forEach(({ file, pattern, count }) => {
  if (count > 0) {
    console.log(`${file}`);
    console.log(`  Matches: ${pattern}\n`);
  }
});

console.log(`Total matches: ${totalMatches}`);
if (isDryRun) {
  console.log('(dry-run — use --write to apply transformations)');
}
console.log('');
