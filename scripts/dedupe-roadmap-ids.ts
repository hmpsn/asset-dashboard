/**
 * dedupe-roadmap-ids.ts
 *
 * One-time-ish migration: scan data/roadmap.json for items whose `id` collides
 * across sprints (same id appears in two or more sprints) and renumber later
 * occurrences to fresh numeric IDs starting from `max(numericId) + 1`.
 *
 * Walks sprints in file order; the FIRST occurrence keeps its id, subsequent
 * occurrences get renumbered. String IDs (e.g. "meeting-brief-phase1") are
 * left alone — they're hand-curated and uniqueness is assumed.
 *
 * Idempotent: running again on a deduped file is a no-op.
 *
 * Usage: npx tsx scripts/dedupe-roadmap-ids.ts [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RoadmapData } from '../shared/types/roadmap.js';

const ROOT = path.join(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'data', 'roadmap.json');
const DRY = process.argv.includes('--dry-run');

const data = JSON.parse(readFileSync(FILE, 'utf8')) as RoadmapData;

let maxNumeric = 0;
for (const s of data.sprints) {
  for (const it of s.items) {
    if (typeof it.id === 'number' && it.id > maxNumeric) maxNumeric = it.id;
  }
}

const seen = new Set<string>();
const remap: Array<{ from: number | string; to: number; sprint: string; title: string }> = [];
let nextId = maxNumeric + 1;

for (const sprint of data.sprints) {
  for (const item of sprint.items) {
    const key = String(item.id);
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    const newId = nextId++;
    remap.push({ from: item.id, to: newId, sprint: sprint.id, title: String(item.title ?? '') });
    item.id = newId;
    seen.add(String(newId));
  }
}

if (remap.length === 0) {
  console.log('roadmap-dedupe: no duplicate IDs found');
  process.exit(0);
}

console.log(`roadmap-dedupe: renumbered ${remap.length} duplicate(s)`);
for (const r of remap) {
  console.log(`  ${r.from} → ${r.to}  [sprint=${r.sprint}]  ${r.title}`);
}

if (DRY) {
  console.log('\n--dry-run: not writing file');
  process.exit(0);
}

writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
console.log(`\nwrote ${path.relative(ROOT, FILE)}`);
