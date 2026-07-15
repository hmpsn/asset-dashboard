/**
 * verify-deferred-ledger — validates data/ui-rebuild-deferred-ledger.json.
 *
 * Every UI-rebuild trade-off ships with a DEF-* row here (see
 * docs/rules/ui-rebuild-consistency.md). This verifier enforces schema shape,
 * unique ids, expiry review dates, and roadmap linkage for scheduled/done rows.
 *
 * NOTE: hatch-reconciliation (cross-checking `-ok` inline hatches against ledger
 * rows, cross-consistency §5.3 item 4) is deferred to F2b — no `-ok` hatches can
 * exist until rebuilt surfaces land. Add that check when the first one appears.
 */
import { readFileSync } from 'fs';
import { z } from 'zod';

const SURFACES = [
  'foundation', 'cockpit', 'insights', 'engine', 'keywords', 'competitors',
  'content-pipeline', 'local-presence', 'search-traffic', 'site-audit',
  'performance', 'links', 'asset-manager', 'ai-visibility', 'seo-editor',
  'schema', 'page-rewriter', 'brand-ai', 'recommendations', 'client-portal', 'global-ops',
] as const;

const entrySchema = z.object({
  id: z.string().regex(/^DEF-[a-z-]+-\d{3}$/),
  surface: z.enum(SURFACES),
  item: z.string().min(10),
  decision: z.string().min(10),
  class: z.enum(['token', 'primitive', 'behavior', 'data', 'a11y', 'perf', 'copy']),
  upgradeTrigger: z.string().min(5).refine(t => !/^someday$/i.test(t.trim()), '"someday" is not a trigger'),
  owner: z.string().min(2),
  status: z.enum(['open', 'scheduled', 'done', 'retired']),
  roadmapItemId: z.string().nullable(),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviewBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  links: z.record(z.string()).optional(),
});

const ledgerSchema = z.object({ version: z.literal(1), updatedAt: z.string(), entries: z.array(entrySchema) });

const failures: string[] = [];
const ledger = ledgerSchema.parse(JSON.parse(readFileSync('data/ui-rebuild-deferred-ledger.json', 'utf-8')));
const roadmap = JSON.parse(readFileSync('data/roadmap.json', 'utf-8'));
const roadmapById = new Map<string, { status?: string }>();
// Conform this walk to data/roadmap.json's actual shape ({ sprints: [...] });
// collect every item that has an `id`, wherever items nest (sprints/sections).
JSON.stringify(roadmap, (_k, v) => {
  if (v && typeof v === 'object' && typeof v.id === 'string') roadmapById.set(v.id, v);
  return v;
});

const today = new Date().toISOString().slice(0, 10);
const ids = new Set<string>();
for (const e of ledger.entries) {
  if (ids.has(e.id)) failures.push(`${e.id}: duplicate id`);
  ids.add(e.id);
  if (e.status === 'open' && e.reviewBy < today)
    failures.push(`${e.id}: OPEN past reviewBy=${e.reviewBy} (owner: ${e.owner}) — review it: extend with a fresh decision, schedule it, or retire it`);
  if (e.status === 'scheduled') {
    if (!e.roadmapItemId) failures.push(`${e.id}: scheduled but roadmapItemId is null`);
    else if (!roadmapById.has(e.roadmapItemId)) failures.push(`${e.id}: roadmapItemId ${e.roadmapItemId} not found in data/roadmap.json`);
  }
  if (e.status === 'done' && e.roadmapItemId && roadmapById.get(e.roadmapItemId)?.status !== 'done')
    failures.push(`${e.id}: marked done but roadmap item ${e.roadmapItemId} is not done`);
}

if (failures.length) {
  console.error(`✗ deferred-ledger: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ deferred-ledger: ${ledger.entries.length} entries valid (${ledger.entries.filter(e => e.status === 'open').length} open)`);
