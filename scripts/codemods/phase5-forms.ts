/**
 * Phase 5 Forms Codemod — DRY-RUN ONLY
 *
 * Detects hand-rolled form elements that should be replaced with design-system
 * primitives: FormInput, FormTextarea, FormSelect, Checkbox.
 *
 * Toggle and Checkbox migrations require human review for label wiring.
 * This script NEVER applies changes — it only reports matches.
 *
 * Usage:
 *   npx tsx scripts/codemods/phase5-forms.ts
 */

import fs from 'fs';
import { globSync } from 'glob';

// ─── Pattern definitions ──────────────────────────────────────────────────────

const PATTERNS: Array<{
  name: string;
  target: string;
  regex: RegExp;
  humanReview?: boolean;
}> = [
  {
    name: 'hand-rolled text input',
    target: '<FormInput>',
    // <input type="text" className="bg-zinc-900 border ... />
    regex: /<input\b[^>]*type\s*=\s*["'](?:text|email|password|search|url|tel)["'][^>]*className\s*=\s*["'][^"']*bg-zinc-900[^"']*["'][^>]*\/?>/g,
  },
  {
    name: 'hand-rolled input (className-first)',
    target: '<FormInput>',
    // <input className="bg-zinc-900 ..." type="text" ... />
    regex: /<input\b[^>]*className\s*=\s*["'][^"']*bg-zinc-900[^"']*["'][^>]*type\s*=\s*["'](?:text|email|password|search|url|tel)["'][^>]*\/?>/g,
  },
  {
    name: 'hand-rolled textarea',
    target: '<FormTextarea>',
    regex: /<textarea\b[^>]*className\s*=\s*["'][^"']*bg-zinc-900[^"']*["'][^>]*>[\s\S]*?<\/textarea>/g,
  },
  {
    name: 'hand-rolled select',
    target: '<FormSelect>',
    // <select className="bg-zinc-900 ...">
    regex: /<select\b[^>]*className\s*=\s*["'][^"']*bg-zinc-900[^"']*["'][^>]*>[\s\S]*?<\/select>/g,
  },
  {
    name: 'hand-rolled checkbox (needs human review)',
    target: '<Checkbox>',
    humanReview: true,
    regex: /<input\b[^>]*type\s*=\s*["']checkbox["'][^>]*\/?>/g,
  },
];

// ─── Scanner ──────────────────────────────────────────────────────────────────

interface FileMatch {
  file: string;
  matches: Array<{
    patternName: string;
    target: string;
    count: number;
    humanReview: boolean;
  }>;
}

const results: FileMatch[] = [];
let grandTotal = 0;

const files = globSync('src/**/*.tsx', {
  cwd: process.cwd(),
  ignore: [
    'node_modules/**',
    'src/components/ui/forms/**', // never rewrite primitives themselves
  ],
});

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  const fileMatches: FileMatch['matches'] = [];

  for (const pattern of PATTERNS) {
    const matches = content.match(pattern.regex) ?? [];
    if (matches.length > 0) {
      fileMatches.push({
        patternName: pattern.name,
        target: pattern.target,
        count: matches.length,
        humanReview: pattern.humanReview ?? false,
      });
      grandTotal += matches.length;
    }
  }

  if (fileMatches.length > 0) {
    results.push({ file, matches: fileMatches });
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('Phase 5 Forms Codemod — DRY-RUN (no changes applied)');
console.log('══════════════════════════════════════════════════════\n');

if (results.length === 0) {
  console.log('No hand-rolled form elements found. Nothing to migrate.\n');
} else {
  for (const { file, matches } of results) {
    console.log(`${file}`);
    for (const m of matches) {
      const flag = m.humanReview ? ' ⚠ human review required' : '';
      console.log(`  [${m.count}] ${m.patternName} → ${m.target}${flag}`);
    }
    console.log('');
  }
}

console.log(`Total matches: ${grandTotal}`);
console.log('');
console.log('Migration notes:');
console.log('  • FormInput   — straightforward; wrap in <FormField> if a <label> is adjacent');
console.log('  • FormTextarea — straightforward; move rows/maxLength to props');
console.log('  • FormSelect  — collect <option> children into options={[]} array prop');
console.log('  • Checkbox    — REQUIRES human review: detect adjacent <label> for label prop');
console.log('  • Toggle      — no auto-detection; identify by design intent, not markup');
console.log('');
console.log('(dry-run — apply changes manually after review)');
console.log('');
