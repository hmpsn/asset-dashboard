#!/usr/bin/env npx tsx
/**
 * sort-roadmap.ts — Auto-sort roadmap.json
 *
 * Rules:
 *   1. Active sprints (have ≥1 pending/in_progress item) stay at the top, in their current order.
 *   2. Backlog always sits right after the last active sprint.
 *   3. Newly completed sprints (all items "done", not yet archived) get:
 *      - Name prefixed with "✅ SHIPPED —"
 *      - A sprint-level `shippedAt` set to the latest item's shippedAt (or today)
 *   4. All completed/archived sprints live below the backlog, newest first.
 *
 * Usage:
 *   npx tsx scripts/sort-roadmap.ts            # sorts in-place
 *   npx tsx scripts/sort-roadmap.ts --dry-run  # preview without writing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SprintData, RoadmapData } from '../shared/types/roadmap.js';

// When adding new items to roadmap.json manually, include:
//   "createdAt": "YYYY-MM-DD"
// Existing items intentionally omit this field (forward-only policy).

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROADMAP_PATH = path.resolve(__dirname, '../data/roadmap.json');
const dryRun = process.argv.includes('--dry-run');

type Sprint = SprintData;
type Roadmap = RoadmapData;

function isFullyShipped(sprint: Sprint): boolean {
  return sprint.items.length > 0 && sprint.items.every(i => i.status === 'done');
}

function isBacklog(sprint: Sprint): boolean {
  return sprint.id === 'backlog';
}

function isAlreadyArchived(sprint: Sprint): boolean {
  return sprint.name.startsWith('✅');
}

function latestShippedAt(sprint: Sprint): string {
  const dates = sprint.items
    .map(i => i.shippedAt)
    .filter((d): d is string => !!d)
    .sort()
    .reverse();
  return dates[0] || new Date().toISOString().slice(0, 10);
}

// ── Main ──────────────────────────────────────────────────────────

const raw = fs.readFileSync(ROADMAP_PATH, 'utf-8');
const roadmap: Roadmap = JSON.parse(raw);

const active: Sprint[] = [];
const backlog: Sprint[] = [];
const shipped: Sprint[] = [];
const newlyArchived: string[] = []; // track IDs before mutation

let changed = false;

for (const sprint of roadmap.sprints) {
  if (isBacklog(sprint)) {
    backlog.push(sprint);
  } else if (isAlreadyArchived(sprint)) {
    shipped.push(sprint);
  } else if (isFullyShipped(sprint)) {
    // Newly completed — archive it
    newlyArchived.push(sprint.id);
    sprint.name = `✅ SHIPPED — ${sprint.name}`;
    if (!sprint.shippedAt) {
      sprint.shippedAt = latestShippedAt(sprint);
    }
    shipped.push(sprint);
    changed = true;
  } else {
    active.push(sprint);
  }
}

// Sort shipped sprints newest-first by shippedAt
shipped.sort((a, b) => {
  const da = a.shippedAt || '0000';
  const db = b.shippedAt || '0000';
  return db.localeCompare(da);
});

const sorted: Sprint[] = [...active, ...backlog, ...shipped];

// Check if order actually changed
const orderChanged = sorted.some((s, i) => s.id !== roadmap.sprints[i]?.id);

if (!changed && !orderChanged) {
  console.log('✓ Roadmap already sorted — no changes needed.');
  process.exit(0);
}

// Report what moved
if (newlyArchived.length > 0) {
  console.log('Archiving completed sprints:');
  for (const id of newlyArchived) {
    const s = shipped.find(sp => sp.id === id)!;
    console.log(`  → ${s.name} (${s.items.length} items, shipped ${s.shippedAt})`);
  }
} else if (orderChanged) {
  console.log('Reordering shipped sprints (newest-first).');
}

roadmap.sprints = sorted;

if (dryRun) {
  console.log('\n--dry-run: no file written.');
  console.log('New order:');
  for (const s of sorted) {
    const tag = isBacklog(s) ? '[backlog]' : isAlreadyArchived(s) ? '[archived]' : '[active]';
    console.log(`  ${tag} ${s.name}`);
  }
} else {
  fs.writeFileSync(ROADMAP_PATH, JSON.stringify(roadmap, null, 2) + '\n', 'utf-8');
  console.log(`✓ Wrote ${ROADMAP_PATH}`);
}
