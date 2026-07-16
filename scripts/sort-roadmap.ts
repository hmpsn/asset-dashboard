#!/usr/bin/env npx tsx
/**
 * sort-roadmap.ts — Auto-sort roadmap.json
 *
 * Rules:
 *   1. The active roadmap contains only actionable planning rows: pending,
 *      in_progress, and deferred.
 *   2. Done and closed rows move to data/roadmap.archive.json. Closed rows remain
 *      closed and never receive shipment metadata.
 *   3. Mixed sprints are split into an active sprint plus a stable
 *      `<sprint-id>-terminal-history` archive sibling.
 *   4. Fully done archive siblings are labeled "✅ SHIPPED". Any sibling that
 *      contains a closed disposition is labeled "🗃️ TERMINAL HISTORY".
 *   5. Backlog stays after the last named active sprint.
 *
 * Usage:
 *   npx tsx scripts/sort-roadmap.ts            # sorts in-place
 *   npx tsx scripts/sort-roadmap.ts --dry-run  # preview without writing
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { RoadmapItem, SprintData, RoadmapData } from '../shared/types/roadmap.js';

// When adding new items to roadmap.json manually, include:
//   "createdAt": "YYYY-MM-DD"
// Existing items intentionally omit this field (forward-only policy).

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROADMAP_PATH = path.resolve(__dirname, '../data/roadmap.json');
const ROADMAP_ARCHIVE_PATH = path.resolve(__dirname, '../data/roadmap.archive.json');
const dryRun = process.argv.includes('--dry-run');

type Sprint = SprintData;
type Roadmap = RoadmapData;

function isBacklog(sprint: Sprint): boolean {
  return sprint.id === 'backlog';
}

function isTerminal(item: RoadmapItem): boolean {
  return item.status === 'done' || item.status === 'closed';
}

function latestShippedAt(sprint: Sprint): string {
  const dates = sprint.items
    .map(i => i.shippedAt)
    .filter((d): d is string => !!d)
    .sort()
    .reverse();
  return dates[0] || new Date().toISOString().slice(0, 10);
}

function loadArchive(): Roadmap {
  if (!fs.existsSync(ROADMAP_ARCHIVE_PATH)) return { sprints: [] };
  return JSON.parse(fs.readFileSync(ROADMAP_ARCHIVE_PATH, 'utf-8')) as Roadmap;
}

function cleanSprintName(name: string): string {
  return name
    .replace(/^✅ SHIPPED —\s*/, '')
    .replace(/^🗃️ TERMINAL HISTORY —\s*/, '');
}

function terminalArchiveSibling(sprint: Sprint, items: RoadmapItem[]): Sprint {
  const allDone = items.every(item => item.status === 'done');
  const baseName = cleanSprintName(sprint.name);
  return {
    id: `${sprint.id}-terminal-history`,
    name: `${allDone ? '✅ SHIPPED' : '🗃️ TERMINAL HISTORY'} — ${baseName}`,
    ...(sprint.hours ? { hours: sprint.hours } : {}),
    rationale: `Terminal item history split from ${sprint.id}. ${sprint.rationale ?? ''}`.trim(),
    items,
    ...(allDone ? { shippedAt: latestShippedAt({ ...sprint, items }) } : {}),
  };
}

function mergeArchive(existing: Sprint[], incoming: Sprint[]): Sprint[] {
  const byId = new Map<string, Sprint>();
  for (const sprint of existing) byId.set(sprint.id, sprint);
  for (const sprint of incoming) {
    const prior = byId.get(sprint.id);
    if (!prior) {
      byId.set(sprint.id, sprint);
      continue;
    }
    const itemsById = new Map(prior.items.map(item => [String(item.id), item]));
    for (const item of sprint.items) itemsById.set(String(item.id), item);
    const mergedItems = Array.from(itemsById.values());
    const allDone = mergedItems.every(item => item.status === 'done');
    byId.set(sprint.id, {
      ...prior,
      ...sprint,
      name: `${allDone ? '✅ SHIPPED' : '🗃️ TERMINAL HISTORY'} — ${cleanSprintName(sprint.name)}`,
      items: mergedItems,
      ...(allDone
        ? { shippedAt: latestShippedAt({ ...sprint, items: mergedItems }) }
        : { shippedAt: undefined }),
    });
  }
  return Array.from(byId.values()).sort((a, b) => {
    const da = a.shippedAt || '0000';
    const db = b.shippedAt || '0000';
    return db.localeCompare(da);
  });
}

// ── Main ──────────────────────────────────────────────────────────

const raw = fs.readFileSync(ROADMAP_PATH, 'utf-8');
const roadmap: Roadmap = JSON.parse(raw);
const archive = loadArchive();

const active: Sprint[] = [];
const backlog: Sprint[] = [];
const archiveAdditions: Sprint[] = [];
const terminalMoves: Array<{ sprintId: string; count: number }> = [];

let changed = false;

for (const sprint of roadmap.sprints) {
  const terminalItems = sprint.items.filter(isTerminal);
  const actionableItems = sprint.items.filter(item => !isTerminal(item));
  if (terminalItems.length > 0) {
    archiveAdditions.push(terminalArchiveSibling(sprint, terminalItems));
    terminalMoves.push({ sprintId: sprint.id, count: terminalItems.length });
    changed = true;
  }
  if (actionableItems.length > 0) {
    const actionableSprint = { ...sprint, name: cleanSprintName(sprint.name), items: actionableItems };
    delete actionableSprint.shippedAt;
    if (isBacklog(sprint)) backlog.push(actionableSprint);
    else active.push(actionableSprint);
  }
}

const sorted: Sprint[] = [...active, ...backlog];

// Check if order actually changed
const orderChanged = sorted.some((s, i) => s.id !== roadmap.sprints[i]?.id);

if (!changed && !orderChanged) {
  console.log('✓ Roadmap already sorted — no changes needed.');
  process.exit(0);
}

// Report what moved
if (archiveAdditions.length > 0) {
  console.log('Moving terminal roadmap history to roadmap.archive.json:');
  for (const move of terminalMoves) {
    console.log(`  → ${move.sprintId}: ${move.count} done/closed item(s)`);
  }
} else if (orderChanged) {
  console.log('Reordering active roadmap sprints.');
}

roadmap.sprints = sorted;
archive.sprints = mergeArchive(archive.sprints, archiveAdditions);

if (dryRun) {
  console.log('\n--dry-run: no file written.');
  console.log('New order:');
  for (const s of sorted) {
    const tag = isBacklog(s) ? '[backlog]' : '[active]';
    console.log(`  ${tag} ${s.name}`);
  }
} else {
  fs.writeFileSync(ROADMAP_PATH, JSON.stringify(roadmap, null, 2) + '\n', 'utf-8');
  if (archiveAdditions.length > 0) {
    fs.writeFileSync(ROADMAP_ARCHIVE_PATH, JSON.stringify(archive, null, 2) + '\n', 'utf-8');
  }
  console.log(`✓ Wrote ${ROADMAP_PATH}`);
  if (archiveAdditions.length > 0) {
    console.log(`✓ Wrote ${ROADMAP_ARCHIVE_PATH}`);
  }
}
