#!/usr/bin/env npx tsx
/**
 * audit-roadmap.ts — Apply a roadmap audit to data/roadmap.json
 *
 * Two operations, applied in one pass:
 *   1. flips     — pending → done, with [Audit YYYY-MM-DD] <evidence> note
 *                  appended and shippedAt set if absent.
 *   2. partials  — append [Audit YYYY-MM-DD partial] <note> without
 *                  changing status, for items where shipping evidence is
 *                  partial. Useful so future planning can see what's
 *                  already wired vs. what's truly missing.
 *
 * Both ops are idempotent — re-running on already-applied items is a no-op.
 *
 * Usage:
 *   npx tsx scripts/audit-roadmap.ts path/to/audit.json
 *   npx tsx scripts/audit-roadmap.ts path/to/audit.json --dry-run
 *
 * Audit file shape (auditDate is ISO YYYY-MM-DD, both arrays optional):
 *   {
 *     "auditDate": "2026-04-22",
 *     "flips":    [ { "id": "42",  "evidence": "Shipped via ..." } ],
 *     "partials": [ { "id": "105", "note":     "Backend ships, UI missing ..." } ]
 *   }
 *
 * Why this script (and not python json.dump):
 *   roadmap.json contains UTF-8 throughout (em-dashes, §, →). Python's
 *   default json.dump escapes those to \uXXXX, producing a giant noise
 *   diff. Node's JSON.stringify writes UTF-8 natively, matching the
 *   canonical format written by sort-roadmap.ts. Always edit roadmap.json
 *   via this script (or sort-roadmap.ts) — never via ad-hoc python.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { RoadmapData } from '../shared/types/roadmap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROADMAP_PATH = path.resolve(__dirname, '../data/roadmap.json');

interface FlipEntry {
  id: string;
  evidence: string;
}
interface PartialEntry {
  id: string;
  note: string;
}
interface AuditFile {
  auditDate: string;
  flips?: FlipEntry[];
  partials?: PartialEntry[];
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function loadAudit(p: string): AuditFile {
  const raw = fs.readFileSync(p, 'utf-8');
  const parsed = JSON.parse(raw) as AuditFile;
  if (!isIsoDate(parsed.auditDate)) {
    throw new Error(`auditDate must be YYYY-MM-DD (got ${JSON.stringify(parsed.auditDate)})`);
  }
  parsed.flips ??= [];
  parsed.partials ??= [];
  // Reject overlap — same id flipped AND annotated would be confusing.
  const flipIds = new Set(parsed.flips.map(e => String(e.id)));
  const partialIds = new Set(parsed.partials.map(e => String(e.id)));
  const overlap = [...flipIds].filter(id => partialIds.has(id));
  if (overlap.length > 0) {
    throw new Error(`ids appear in both flips and partials: ${overlap.join(', ')}`);
  }
  return parsed;
}

function appendNote(existing: string | undefined, note: string): string {
  return existing ? `${existing}\n${note}` : note;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const auditPath = args.find(a => !a.startsWith('--'));

  if (!auditPath) {
    console.error('Usage: npx tsx scripts/audit-roadmap.ts <audit.json> [--dry-run]');
    process.exit(2);
  }

  const audit = loadAudit(path.resolve(process.cwd(), auditPath));
  const TAG_FLIP = `[Audit ${audit.auditDate}]`;
  const TAG_PARTIAL = `[Audit ${audit.auditDate} partial]`;

  const data = JSON.parse(fs.readFileSync(ROADMAP_PATH, 'utf-8')) as RoadmapData;

  const flipMap = new Map(audit.flips!.map(e => [String(e.id), e.evidence]));
  const partialMap = new Map(audit.partials!.map(e => [String(e.id), e.note]));
  const stillPending = new Set([...flipMap.keys(), ...partialMap.keys()]);

  let flipped = 0;
  let flippedSkipped = 0;
  let annotated = 0;
  let annotatedSkipped = 0;

  for (const sprint of data.sprints) {
    for (const item of sprint.items) {
      const key = String(item.id);

      if (flipMap.has(key)) {
        stillPending.delete(key);
        if (item.status === 'done') {
          console.log(`  skip-flip      [${sprint.id}]  #${key}  (already done)`);
          flippedSkipped++;
        } else {
          const note = `${TAG_FLIP} ${flipMap.get(key)}`;
          item.status = 'done';
          item.shippedAt ??= audit.auditDate;
          item.notes = appendNote(item.notes, note);
          console.log(`  FLIP           [${sprint.id}]  #${key}  → done`);
          flipped++;
        }
      }

      if (partialMap.has(key)) {
        stillPending.delete(key);
        if (item.notes && item.notes.includes(TAG_PARTIAL)) {
          console.log(`  skip-annotate  [${sprint.id}]  #${key}  (already annotated)`);
          annotatedSkipped++;
        } else {
          const note = `${TAG_PARTIAL} ${partialMap.get(key)}`;
          item.notes = appendNote(item.notes, note);
          console.log(`  ANNOTATE       [${sprint.id}]  #${key}`);
          annotated++;
        }
      }
    }
  }

  if (stillPending.size > 0) {
    console.error(`\nERROR: ${stillPending.size} id(s) not found in roadmap:`);
    for (const k of stillPending) console.error(`  - ${k}`);
    process.exit(1);
  }

  console.log(
    `\nFlipped ${flipped} (skipped ${flippedSkipped}), annotated ${annotated} (skipped ${annotatedSkipped}).`
  );

  if (dryRun) {
    console.log('--dry-run: no file written.');
    return;
  }

  // Match sort-roadmap.ts: UTF-8 native, 2-space indent, trailing newline.
  fs.writeFileSync(ROADMAP_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`✓ Wrote ${ROADMAP_PATH}`);
}

main();
